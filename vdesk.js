// Windows sanal masaüstleri.
// Electron'un win.setVisibleOnAllWorkspaces() fonksiyonu Windows'ta HİÇBİR ŞEY yapmaz; pencere yalnızca oluşturulduğu masaüstünde görünür.
// Belgelenmiş IVirtualDesktopManager::MoveWindowToDesktop ise kendi sürecimizin penceresini istediğimiz masaüstüne taşıyabilir.
// Bu dosya onu koffi ile çağırır. koffi yoksa veya çağrı başarısız olursa false döner; main.js bu durumda yedek yola geçer.
let K = null, state = 'init', mgr = null, P_Move = null, P_Id = null, P_Cur = null, CoCreate = null;

const CLSID_VDM = 'AA509086-5CA9-4C25-8F95-589D3C07B48A', IID_VDM = 'A5CD92FF-29BE-454C-8D04-D82879FB3F1B';

// "AA509086-5CA9-..." -> 16 baytlık GUID yapısı (ilk üç alan little-endian)
function guid(s) {
  const h = String(s || '').replace(/[{}-]/g, '');
  if (!/^[0-9a-f]{32}$/i.test(h)) return null;
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0); b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4); b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), 'hex').copy(b, 8);
  return b;
}

// COM nesnesinin sanal tablosundan i. yöntemi çağırır (nesnenin ilk işaretçisi vtable'ı gösterir)
function slot(obj, i, proto, ...args) {
  const vtbl = K.decode(obj, 'void *');
  const fn = K.decode(vtbl, 'void *', i + 1)[i];
  return K.call(fn, proto, obj, ...args);
}

function connect() {
  const out = [null], hr = CoCreate(guid(CLSID_VDM), null, 23, guid(IID_VDM), out); // 23 = CLSCTX_ALL
  if (hr !== 0 || !out[0]) throw new Error('CoCreateInstance 0x' + (hr >>> 0).toString(16));
  mgr = out[0];
}

function init() {
  if (state === 'ok') return true;
  if (state === 'fail') return false;
  try {
    K = K || require('koffi');
    const ole = K.load('ole32.dll');
    ole.func('long __stdcall CoInitializeEx(void *reserved, uint32_t flags)')(null, 2); // Chromium zaten başlatmıştır; sonucu önemli değil
    CoCreate = ole.func('long __stdcall CoCreateInstance(const void *clsid, void *outer, uint32_t ctx, const void *iid, _Out_ void **ppv)');
    P_Move = K.proto('long __stdcall VdmMove(void *self, uintptr_t hwnd, const void *guid)');
    P_Id = K.proto('long __stdcall VdmGetId(void *self, uintptr_t hwnd, void *guid)');
    P_Cur = K.proto('long __stdcall VdmOnCur(void *self, uintptr_t hwnd, _Out_ int32_t *on)');
    connect();
    state = 'ok';
  } catch (e) {
    state = 'fail';
    console.error('[vdesk] kullanılamıyor (koffi yüklü mü? "npm install" çalıştır):', e.message);
  }
  return state === 'ok';
}

// handleBuf: win.getNativeWindowHandle() çıktısı, guidStr: hedef masaüstü kimliği. Başarılıysa true.
function moveHere(handleBuf, guidStr) {
  if (process.platform !== 'win32') return false;
  const g = guid(guidStr);
  if (!g || !init()) return false;
  const h = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : BigInt(handleBuf.readUInt32LE(0));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const hr = slot(mgr, 5, P_Move, h, g); // IUnknown (0-2), IsWindowOnCurrentVirtualDesktop (3), GetWindowDesktopId (4), MoveWindowToDesktop (5)
      if (hr === 0) return true;
      console.error('[vdesk] MoveWindowToDesktop 0x' + (hr >>> 0).toString(16));
    } catch (e) { console.error('[vdesk]', e.message); }
    if (attempt === 0) { try { connect(); } catch { return false; } } // Explorer yeniden başladıysa eski COM nesnesi geçersizdir
  }
  return false;
}

const str = (b) => {
  const h = (n) => n.toString(16).padStart(8, '0');
  return (h(b.readUInt32LE(0)) + '-' + h(b.readUInt16LE(4)).slice(4) + '-' + h(b.readUInt16LE(6)).slice(4) + '-' + b.subarray(8, 10).toString('hex') + '-' + b.subarray(10, 16).toString('hex')).toUpperCase();
};
// Pencere geçerli masaüstünde mi? true / false; bilinmiyorsa null
function isOnCurrent(h) {
  if (process.platform !== 'win32' || !init()) return null;
  try { const o = [0]; return slot(mgr, 3, P_Cur, BigInt(h), o) === 0 ? !!o[0] : null; } catch { return null; }
}
// Pencerenin masaüstü kimliği (büyük harfli GUID dizgisi) ya da null
function windowDesktop(h) {
  if (process.platform !== 'win32' || !init()) return null;
  try { const b = Buffer.alloc(16); if (slot(mgr, 4, P_Id, BigInt(h), b) !== 0 || b.every((x) => x === 0)) return null; return str(b); } catch { return null; }
}
module.exports = { isOnCurrent, windowDesktop, moveHere, guid, _slot: slot, _setKoffi: (k) => (K = k) };
