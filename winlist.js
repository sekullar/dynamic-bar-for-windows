// Windows pencere ve görev çubuğu işlemleri (koffi ile user32/dwmapi/shell32). macOS görünümü (macbar.js) kullanır:
// açık pencereleri listeler, öne getirir, küçültür, kapatır, Windows görev çubuğunu gizler/geri getirir.
let K = null, f = null;
const cache = new Map(); // pid -> exe yolu
let cacheAt = 0, acc = [];

function init() {
  if (f) return true;
  if (process.platform !== 'win32') return false;
  try {
    K = require('koffi');
    const u = K.load('user32.dll'), dwm = K.load('dwmapi.dll'), k32 = K.load('kernel32.dll'), sh = K.load('shell32.dll');
    const Enum = K.proto('bool __stdcall DB_EnumProc(uintptr_t hwnd, intptr_t lp)');
    const RECT = K.struct('DB_RECT2', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    K.struct('DB_BIH', { biSize: 'uint32', biWidth: 'int32', biHeight: 'int32', biPlanes: 'uint16', biBitCount: 'uint16', biCompression: 'uint32', biSizeImage: 'uint32', x: 'int32', y: 'int32', used: 'uint32', imp: 'uint32' });
    const ABD = K.struct('DB_ABD2', { cbSize: 'uint32', hWnd: 'uintptr_t', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr_t' });
    f = {
      ABD, size: K.sizeof(ABD),
      EnumWindows: u.func('bool __stdcall EnumWindows(DB_EnumProc *cb, intptr_t lp)'),
      IsWindowVisible: u.func('bool __stdcall IsWindowVisible(uintptr_t h)'),
      IsIconic: u.func('bool __stdcall IsIconic(uintptr_t h)'),
      GetWindowLongW: u.func('int32_t __stdcall GetWindowLongW(uintptr_t h, int idx)'),
      GetWindow: u.func('uintptr_t __stdcall GetWindow(uintptr_t h, uint32_t cmd)'),
      GetWindowTextLengthW: u.func('int __stdcall GetWindowTextLengthW(uintptr_t h)'),
      GetWindowTextW: u.func('int __stdcall GetWindowTextW(uintptr_t h, void *buf, int max)'),
      GetWindowThreadProcessId: u.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t h, _Out_ uint32_t *pid)'),
      GetForegroundWindow: u.func('uintptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: u.func('bool __stdcall SetForegroundWindow(uintptr_t h)'),
      BringWindowToTop: u.func('bool __stdcall BringWindowToTop(uintptr_t h)'),
      ShowWindow: u.func('bool __stdcall ShowWindow(uintptr_t h, int cmd)'),
      PostMessageW: u.func('bool __stdcall PostMessageW(uintptr_t h, uint32_t msg, uintptr_t w, intptr_t l)'),
      AttachThreadInput: u.func('bool __stdcall AttachThreadInput(uint32_t a, uint32_t b, bool attach)'),
      keybd_event: u.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
      FindWindowW: u.func('uintptr_t __stdcall FindWindowW(str16 cls, str16 name)'),
      FindWindowExW: u.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 cls, str16 name)'),
      SendMessageTimeoutW: u.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t h, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t to, _Out_ uintptr_t *res)'),
      GetClassLongPtrW: u.func('uintptr_t __stdcall GetClassLongPtrW(uintptr_t h, int idx)'),
      DrawIconEx: u.func('bool __stdcall DrawIconEx(uintptr_t dc, int x, int y, uintptr_t icon, int cx, int cy, uint32_t step, uintptr_t br, uint32_t flags)'),
      CreateCompatibleDC: K.load('gdi32.dll').func('uintptr_t __stdcall CreateCompatibleDC(uintptr_t dc)'),
      CreateDIBSection: K.load('gdi32.dll').func('uintptr_t __stdcall CreateDIBSection(uintptr_t dc, DB_BIH *bi, uint32_t usage, _Out_ void **bits, uintptr_t sec, uint32_t off)'),
      SelectObject: K.load('gdi32.dll').func('uintptr_t __stdcall SelectObject(uintptr_t dc, uintptr_t obj)'),
      DeleteObject: K.load('gdi32.dll').func('bool __stdcall DeleteObject(uintptr_t obj)'),
      DeleteDC: K.load('gdi32.dll').func('bool __stdcall DeleteDC(uintptr_t dc)'),
      SendMessageTimeoutStr: u.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t h, uint32_t msg, uintptr_t w, str16 l, uint32_t flags, uint32_t to, _Out_ uintptr_t *res)'),
      PrivateExtractIconsW: u.func('uint32_t __stdcall PrivateExtractIconsW(str16 file, int idx, int cx, int cy, _Out_ uintptr_t *phicon, _Out_ uint32_t *id, uint32_t n, uint32_t flags)'),
      DestroyIcon: u.func('bool __stdcall DestroyIcon(uintptr_t h)'),
      IsZoomed: u.func('bool __stdcall IsZoomed(uintptr_t h)'),
      GetCurrentThreadId: k32.func('uint32_t __stdcall GetCurrentThreadId()'),
      OpenProcess: k32.func('uintptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      CloseHandle: k32.func('bool __stdcall CloseHandle(uintptr_t h)'),
      QueryFullProcessImageNameW: k32.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t h, uint32_t flags, void *buf, _Inout_ uint32_t *size)'),
      DwmGetWindowAttribute: dwm.func('int32_t __stdcall DwmGetWindowAttribute(uintptr_t h, uint32_t attr, _Out_ int32_t *val, uint32_t cb)'),
      SHAppBarMessage: sh.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ DB_ABD2 *pData)')
    };
    f.enumCb = K.register((h) => { try { collect(h); } catch {} return true; }, K.pointer(Enum));
  } catch (e) { f = null; console.error('[winlist] kullanılamıyor:', e.message); }
  return !!f;
}

function exeOf(pid) {
  if (Date.now() - cacheAt > 60000) { cache.clear(); cacheAt = Date.now(); }
  if (cache.has(pid)) return cache.get(pid);
  let p = '';
  const h = f.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (h) {
    const buf = Buffer.alloc(2080), n = [1040];
    if (f.QueryFullProcessImageNameW(h, 0, buf, n)) p = buf.toString('utf16le', 0, n[0] * 2);
    f.CloseHandle(h);
  }
  cache.set(pid, p);
  return p;
}
function titleOf(h) {
  const n = f.GetWindowTextLengthW(h); if (!n) return '';
  const buf = Buffer.alloc(1024 * 2), len = f.GetWindowTextW(h, buf, 1024);
  return buf.toString('utf16le', 0, len * 2);
}
const pidOf = (h) => { const p = [0]; f.GetWindowThreadProcessId(h, p); return p[0]; };

// Görev çubuğunda görünecek türden bir pencere mi? (görünür, araç penceresi değil, sahipsiz, gizlenmemiş, başlıklı)
function collect(h) {
  if (!f.IsWindowVisible(h)) return;
  const ex = f.GetWindowLongW(h, -20) >>> 0;
  if (ex & 0x80 && !(ex & 0x40000)) return; // WS_EX_TOOLWINDOW (WS_EX_APPWINDOW ise yine de göster)
  if (f.GetWindow(h, 4) && !(ex & 0x40000)) return; // sahibi olan pencere (iletişim kutuları)
  if (ex & 0x08000000 && !(ex & 0x40000)) return; // WS_EX_NOACTIVATE
  const cl = [0]; f.DwmGetWindowAttribute(h, 14, cl, 4); if (cl[0]) return; // DWMWA_CLOAKED: başka masaüstünde ya da gizli UWP
  const title = titleOf(h); if (!title || title === 'Program Manager') return;
  const exe = exeOf(pidOf(h)); if (!exe) return;
  acc.push({ hwnd: h, title, exe, minimized: !!f.IsIconic(h) });
}

// Açık pencereler, üstteki ilk (z sırası)
function list() {
  if (!init()) return [];
  acc = [];
  try { f.EnumWindows(f.enumCb, 0); } catch (e) { console.error('[winlist]', e.message); }
  const r = acc; acc = []; return r;
}
function foreground() {
  if (!init()) return null;
  const h = f.GetForegroundWindow(); if (!h) return null;
  return { hwnd: h, exe: exeOf(pidOf(h)), title: titleOf(h) };
}
function activate(h) {
  if (!init()) return;
  if (f.IsIconic(h)) f.ShowWindow(h, 9); // SW_RESTORE
  // Windows arka plandan öne almayı engeller: ön plandaki iş parçacığına geçici bağlanarak izin al
  const fg = f.GetForegroundWindow(), ft = fg ? f.GetWindowThreadProcessId(fg, [0]) : 0, me = f.GetCurrentThreadId();
  let att = false;
  if (ft && ft !== me) att = f.AttachThreadInput(me, ft, true);
  f.BringWindowToTop(h); f.SetForegroundWindow(h);
  if (att) f.AttachThreadInput(me, ft, false);
}
const minimize = (h) => init() && f.ShowWindow(h, 6); // SW_MINIMIZE
const isZoomed = (h) => init() && !!f.IsZoomed(h);
const toggleMaximize = (h) => init() && f.ShowWindow(h, f.IsZoomed(h) ? 9 : 3); // SW_RESTORE / SW_MAXIMIZE
const restore = (h) => init() && f.ShowWindow(h, 9);
const close = (h) => init() && f.PostMessageW(h, 0x10, 0, 0); // WM_CLOSE
function startMenu() { // Win tuşu
  if (!init()) return;
  f.keybd_event(0x5b, 0, 0, 0); f.keybd_event(0x5b, 0, 2, 0);
}

// Pencerenin kendi simgesi (görev çubuğunun gösterdiği): {width, height, bgra} ya da null
function drawIcon(hi, size) {
  const dc = f.CreateCompatibleDC(0), bits = [null];
  const bmp = f.CreateDIBSection(dc, { biSize: 40, biWidth: size, biHeight: -size, biPlanes: 1, biBitCount: 32, biCompression: 0, biSizeImage: 0, x: 0, y: 0, used: 0, imp: 0 }, 0, bits, 0, 0);
  if (!bmp || !bits[0]) { f.DeleteDC(dc); return null; }
  const old = f.SelectObject(dc, bmp);
  let out = null;
  if (f.DrawIconEx(dc, 0, 0, hi, size, size, 0, 0, 3)) { // DI_NORMAL
    const buf = Buffer.from(K.decode(bits[0], 'uint8_t', size * size * 4));
    let any = false; for (let i = 3; i < buf.length; i += 4) if (buf[i]) { any = true; break; }
    if (any) out = { width: size, height: size, bgra: buf };
  }
  f.SelectObject(dc, old); f.DeleteObject(bmp); f.DeleteDC(dc);
  return out;
}
function windowIcon(h, size = 64) {
  if (!init()) return null;
  let hi = 0;
  for (const t of [1, 2, 0]) { const r = [0]; try { f.SendMessageTimeoutW(h, 0x7f, t, 0, 2, 120, r); } catch {} if (r[0]) { hi = r[0]; break; } } // WM_GETICON: büyük, küçük2, küçük
  if (!hi) hi = f.GetClassLongPtrW(h, -14) || f.GetClassLongPtrW(h, -34); // GCLP_HICON, GCLP_HICONSM
  return hi ? drawIcon(hi, size) : null;
}
// Çalıştırılabilir dosyanın en büyük simgesi (256px'e kadar) — keskin Dock simgeleri için
function exeIcon(file, size = 128) {
  if (!init() || !file) return null;
  try {
    const hic = [0], id = [0];
    const n = f.PrivateExtractIconsW(file, 0, 256, 256, hic, id, 1, 0);
    if (!n || n === 0xffffffff || !hic[0]) return null;
    const out = drawIcon(hic[0], size); f.DestroyIcon(hic[0]); return out;
  } catch { return null; }
}

// ---- Windows görev çubuğu ----
const trays = () => {
  const out = [], a = f.FindWindowW('Shell_TrayWnd', null); if (a) out.push(a);
  let h = 0; for (let i = 0; i < 8; i++) { h = f.FindWindowExW(0, h, 'Shell_SecondaryTrayWnd', null); if (!h) break; out.push(h); }
  return out;
};
const abd = (state) => ({ cbSize: f.size, hWnd: 0, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: state || 0 });
function getAutohide() { if (!init()) return false; return (Number(f.SHAppBarMessage(4, abd())) & 1) === 1; } // ABM_GETSTATE
function setAutohide(on) { // ABM_SETSTATE: otomatik gizle açılınca Windows çalışma alanını geri verir
  if (!init()) return;
  const cur = Number(f.SHAppBarMessage(4, abd())) & ~1;
  f.SHAppBarMessage(10, abd(cur | (on ? 1 : 0)));
}
function showTaskbar(show) { if (!init()) return; for (const h of trays()) f.ShowWindow(h, show ? 5 : 0); }
function taskbarVisible() { if (!init()) return false; const t = trays(); return t.length > 0 && t.some((h) => f.IsWindowVisible(h)); }

// tema/ayar değişikliğini tüm pencerelere duyur (ör. 'ImmersiveColorSet': koyu/açık mod)
function broadcastSetting(name) { if (!init()) return; f.SendMessageTimeoutStr(0xffff, 0x1a, 0, name, 2, 1500, [0]); }

module.exports = { init, broadcastSetting, windowIcon, exeIcon, list, foreground, activate, minimize, isZoomed, toggleMaximize, restore, close, startMenu, getAutohide, setAutohide, showTaskbar, taskbarVisible };
