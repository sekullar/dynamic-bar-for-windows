// Üstte boşluk bırakma: Windows AppBar (görev çubuğunun kullandığı mekanizma) ile ekranın üst kenarını rezerve eder;
// böylece büyütülmüş pencereler barın altından başlar. AppBar bir pencereye bağlanır; ana ada penceresi şekle kırpılı ve
// yeniden oluşturulabildiği için buna dokunmayız, yalnızca boşluğu tutan ayrı, görünmez ve tıklamayı geçiren bir pencere kullanırız.
// Süreç kapanınca (çökse bile) Windows pencereyle birlikte AppBar kaydını da temizler.
const { BrowserWindow, screen } = require('electron');

const ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABE_TOP = 1, CALLBACK = 0x8001;
let win = null, fn = null, size = 0, tried = false, registered = false, lastKey = '';

function init() {
  if (tried) return !!fn;
  tried = true;
  if (process.platform !== 'win32') return false;
  try {
    const K = require('koffi');
    const RECT = K.struct('DB_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const ABD = K.struct('DB_APPBARDATA', { cbSize: 'uint32', hWnd: 'uintptr_t', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr_t' });
    size = K.sizeof(ABD);
    fn = K.load('shell32.dll').func('uintptr_t __stdcall SHAppBarMessage(uint32_t dwMessage, _Inout_ DB_APPBARDATA *pData)');
  } catch (e) { fn = null; console.error('[appbar] kullanılamıyor (koffi yüklü mü?):', e.message); }
  return !!fn;
}

const hwnd = () => { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)); };
const data = (rc) => ({ cbSize: size, hWnd: hwnd(), uCallbackMessage: CALLBACK, uEdge: ABE_TOP, rc: rc || { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 });

function remove() {
  lastKey = '';
  const had = !!win;
  if (win && !win.isDestroyed()) {
    if (registered && fn) { try { fn(ABM_REMOVE, data()); } catch {} }
    win.destroy();
  }
  win = null; registered = false;
  return had;
}

// on: boşluk bırakılsın mı, displayIndex: hangi ekran, heightDip: ayrılacak yükseklik (DIP)
// Ayrılan alan değiştiyse true döner: Windows o sırada diğer pencereleri (ada penceresi dahil) yeni çalışma alanına iter,
// çağıran ada penceresini yerine geri koymalıdır.
function update(on, displayIndex, heightDip) {
  if (!on || !init()) return remove();
  const d = screen.getAllDisplays()[displayIndex] || screen.getPrimaryDisplay();
  const dip = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: Math.max(1, Math.round(heightDip)) };
  const key = [dip.x, dip.y, dip.width, dip.height].join(',');
  if (key === lastKey && win && !win.isDestroyed()) return false;

  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      ...dip, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, hasShadow: false, type: 'toolbar', webPreferences: { backgroundThrottling: false }
    });
    win.setIgnoreMouseEvents(true);
    registered = false;
  } else win.setBounds(dip);
  win.showInactive();

  try {
    const r = screen.dipToScreenRect(win, dip); // AppBar fiziksel piksel ister
    if (!registered) { fn(ABM_NEW, data()); registered = true; }
    const abd = data({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });
    fn(ABM_QUERYPOS, abd);
    abd.rc.bottom = abd.rc.top + r.height;
    fn(ABM_SETPOS, abd);
    lastKey = key;
  } catch (e) { console.error('[appbar]', e.message); remove(); }
  return true;
}

module.exports = { update, remove };
