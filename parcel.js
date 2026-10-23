// Kargo: bir dosyayı sürükleyip adanın üstüne getirince bırakma bölgesi açılır, hedef seçilir, maskot dosyayı götürür.
// Ana ada penceresi odaklanamaz ve şekle kırpılıdır; bu yüzden bırakma ve seçim için (arama hapı gibi) ayrı bir pencere kullanılır,
// götürme animasyonu ise ana adada, ilerleme bildirimi olarak oynar (key: "parcel", mood: "courier").
const { BrowserWindow, screen, ipcMain, app } = require('electron');
const path = require('path'), fs = require('fs');
const destinations = require('./destinations');

const W = 800; // hap 440-520 geniş; ölçek 1.3'e ve gölgeye yetecek kadar boşluk
const MAX_FILES = 50;
let ctx, zone = null, closing = false, phase = 'zone', picked = [], dests = [], hideT, shrinkT, shownAt = 0, jobs = Promise.resolve();
let downSince = 0, start = null, startInBand = false, releasedAt = 0, leftAt = 0, tickT = null;

// Windows API'leri (koffi yoksa sürükleme algılanmaz; bırakma yine de çalışır ama bölge kendiliğinden açılmaz)
let getKey = null, getGui = null, guiSize = 0, keybd = null;
try {
  if (process.platform === 'win32') {
    const K = require('koffi'), u = K.load('user32.dll');
    getKey = u.func('int16_t __stdcall GetAsyncKeyState(int vk)');
    keybd = u.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
    const GTI = K.struct('DB_GUITHREADINFO', { cbSize: 'uint32', flags: 'uint32', hwndActive: 'uintptr_t', hwndFocus: 'uintptr_t', hwndCapture: 'uintptr_t',
      hwndMenuOwner: 'uintptr_t', hwndMoveSize: 'uintptr_t', hwndCaret: 'uintptr_t', cl: 'int32', ct: 'int32', cr: 'int32', cb: 'int32' });
    guiSize = K.sizeof(GTI);
    getGui = u.func('int __stdcall GetGUIThreadInfo(uint32_t idThread, _Inout_ DB_GUITHREADINFO *pgui)');
  }
} catch {}
const nudge = () => { try { if (keybd) { keybd(0x87, 0, 0, 0); keybd(0x87, 0, 2, 0); } } catch {} }; // F24: ön plana geçme izni (spotlight.js'teki gibi)

const alive = (w) => w && !w.isDestroyed();
const enabled = () => ctx.settings().parcel !== false && !!getKey;
const isOpen = () => alive(zone) && !closing;
const own = (e) => alive(zone) && e.sender === zone.webContents;

// Bir pencere taşınıyor/boyutlandırılıyorsa (başlık çubuğundan sürükleme) bu bir dosya sürüklemesi değildir
function moving() {
  if (!getGui) return false;
  try { const i = { cbSize: guiSize, flags: 0, hwndActive: 0, hwndFocus: 0, hwndCapture: 0, hwndMenuOwner: 0, hwndMoveSize: 0, hwndCaret: 0, cl: 0, ct: 0, cr: 0, cb: 0 }; return getGui(0, i) !== 0 && (i.flags & 0x2) !== 0; }
  catch { return false; }
}

function band() { // adanın üstündeki "tetik" bölgesi (DIP): ekranın üstünden ~130 px, adanın iki yanında ~320 px
  const w = ctx.win(); if (!alive(w)) return null;
  const b = w.getBounds(), d = screen.getDisplayMatching(b);
  return { cx: b.x + b.width / 2, top: d.bounds.y, bottom: d.bounds.y + 130, half: 320, d };
}
const inBand = (p, bd) => bd && p.y >= bd.top - 2 && p.y < bd.bottom && Math.abs(p.x - bd.cx) < bd.half;

function tick() {
  if (!enabled() || ctx.busy()) return;
  const p = screen.getCursorScreenPoint(), now = Date.now(), bd = band();
  let down = false; try { down = (getKey(0x01) & 0x8000) !== 0; } catch { return; }
  if (!down) {
    downSince = 0;
    if (isOpen() && phase === 'zone') { // bırakmadan fare bırakıldı: kısa bir süre bırakma olayı beklenir
      if (!releasedAt) releasedAt = now; else if (now - releasedAt > 700) close();
    } else releasedAt = 0;
    return;
  }
  releasedAt = 0;
  if (!downSince) { downSince = now; start = p; startInBand = inBand(p, bd); }
  if (isOpen()) { // sürüklerken bölgeden çok uzaklaşıldıysa kapat
    if (phase === 'zone' && bd && (p.y > bd.top + 280 || Math.abs(p.x - bd.cx) > 460)) { if (!leftAt) leftAt = now; else if (now - leftAt > 900) close(); } else leftAt = 0;
    return;
  }
  if (startInBand || now - downSince < 200) return;
  if (Math.hypot(p.x - start.x, p.y - start.y) < 30 || !inBand(p, bd) || moving()) return;
  open();
}

function open() {
  if (isOpen() || closing) { if (closing) destroyNow(); else return; }
  const main = ctx.win(); if (!alive(main)) return;
  const b = main.getBounds(), d = screen.getDisplayMatching(b);
  const x = Math.round(Math.max(d.bounds.x, Math.min(b.x + b.width / 2 - W / 2, d.bounds.x + d.bounds.width - W)));
  phase = 'zone'; picked = []; dests = []; leftAt = 0; releasedAt = 0;
  zone = new BrowserWindow({
    width: W, height: 160, x, y: b.y, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, fullscreenable: false, alwaysOnTop: true,
    webPreferences: { preload: ctx.preload, backgroundThrottling: false }
  });
  const w = zone;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.on('blur', () => { if (w === zone && phase === 'pick' && Date.now() - shownAt > 600) close(); });
  w.on('closed', () => { if (w === zone) { zone = null; closing = false; ctx.onState(false); } });
  w.loadFile(path.join(__dirname, 'parcel.html'));
  ctx.onState(true);
}

function destroyNow() {
  clearTimeout(hideT); clearTimeout(shrinkT);
  if (alive(zone)) zone.destroy();
  zone = null; closing = false;
}
function close() {
  if (!alive(zone) || closing) return;
  closing = true;
  try { zone.webContents.send('parcel-hide'); } catch {}
  clearTimeout(hideT); hideT = setTimeout(destroyNow, 460);
  setTimeout(() => ctx.onState(false), 280); // hap adanın boyutuna inerken ada geri gelir (arama hapıyla aynı)
}

// ---------- IPC (yalnızca bırakma penceresinden) ----------
ipcMain.handle('parcel:init', (e) => (own(e) ? { settings: ctx.settings() } : null));
ipcMain.on('parcel:ready', (e) => {
  if (!own(e)) return;
  shownAt = Date.now(); zone.showInactive(); zone.webContents.send('parcel-show');
});
ipcMain.handle('parcel:files', async (e, paths) => {
  if (!own(e) || !Array.isArray(paths)) return null;
  const files = [];
  for (const p of paths.slice(0, MAX_FILES)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    try { const st = fs.statSync(p); files.push({ path: p, name: path.basename(p), isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size }); } catch {}
  }
  if (!files.length) return null;
  await Promise.all(files.filter((f) => f.isDir).map(async (f) => { try { f.size = await destinations.sizeOf(f.path); } catch {} }));
  picked = files; phase = 'pick';
  dests = destinations.list(ctx.settings(), ctx.secret);
  let icon = '';
  try { icon = (await app.getFileIcon(files[0].path, { size: 'large' })).toDataURL(); } catch {}
  nudge(); try { zone.focus(); zone.webContents.focus(); } catch {} // seçim klavyeyle de yapılabilsin
  return { files: files.map((f) => ({ name: f.name, size: f.size, isDir: f.isDir })), icon, dests: dests.map((d) => ({ id: d.id, name: d.name, icon: d.icon })) };
});
ipcMain.on('parcel:fit', (e, h) => {
  if (!own(e)) return;
  h = Math.max(60, Math.min(900, h | 0));
  const set = () => { if (alive(zone)) { const b = zone.getBounds(); zone.setBounds({ x: b.x, y: b.y, width: W, height: h }); } };
  clearTimeout(shrinkT);
  if (h >= zone.getBounds().height) set(); else shrinkT = setTimeout(set, 450);
});
ipcMain.on('parcel:close', (e) => { if (own(e)) close(); });
ipcMain.handle('parcel:send', (e, id) => {
  if (!own(e)) return false;
  const dest = dests.find((d) => d.id === id);
  if (!dest || !picked.length) return false;
  const files = picked;
  close(); // hap adaya iner; kargo animasyonu adada başlar
  deliver(dest, files);
  return true;
});

// ---------- teslimat ----------
const sizeText = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function deliver(dest, files) { // işler sırayla çalışır: aynı anda birden çok kargo "parcel" bildirimini karıştırmasın
  const p = jobs.then(() => run(dest, files));
  jobs = p.catch(() => {});
  return p;
}

// Dış programlar için (POST /send, dynbar send): yollar ve hedef adı/kimliği ile doğrudan teslimat. Seçim penceresi açılmaz.
function match(query) {
  const all = destinations.list(ctx.settings(), ctx.secret), q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  return all.find((d) => d.id.toLowerCase() === q || d.name.toLowerCase() === q) || all.find((d) => d.name.toLowerCase().startsWith(q) || d.type === q) || all.find((d) => d.name.toLowerCase().includes(q)) || null;
}
const list = () => destinations.list(ctx.settings(), ctx.secret).map((d) => ({ id: d.id, name: d.name }));
async function sendTo(paths, query) {
  if (ctx.settings().parcel === false) throw new Error('kargo ayarlardan kapalı');
  const dest = match(query); if (!dest) throw new Error('hedef bulunamadı: ' + query);
  const files = [];
  for (const p of (Array.isArray(paths) ? paths : []).slice(0, MAX_FILES)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    try { const st = fs.statSync(p); files.push({ path: p, name: path.basename(p), isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size }); } catch {}
  }
  if (!files.length) throw new Error('geçerli dosya yok (tam yol ver)');
  await Promise.all(files.filter((f) => f.isDir).map(async (f) => { try { f.size = await destinations.sizeOf(f.path); } catch {} }));
  const r = await deliver(dest, files);
  return { dest: dest.name, files: files.length, ...r };
}
async function run(dest, files) {
  const what = files.length === 1 ? files[0].name : files.length + ' dosya', total = files.reduce((a, f) => a + f.size, 0);
  const base = { key: 'parcel', parcel: { icon: dest.icon, name: dest.name }, priority: 'high', force: true };
  ctx.send({ ...base, mood: 'courier', title: `${dest.name}'a götürüyorum`, text: `${what} · ${sizeText(total)}`, progress: 0, ttl: 60 });
  let last = 0;
  const progress = (f) => { const n = Date.now(); if (n - last < 120) return; last = n; ctx.send({ ...base, mood: 'courier', title: `${dest.name}'a götürüyorum`, text: `${what} · %${Math.round(f * 100)}`, progress: f, ttl: 60 }); };
  try {
    const r = await destinations.send(dest, files, { progress, secret: ctx.secret, settings: ctx.settings() });
    ctx.send({ ...base, parcel: { ...base.parcel, done: true }, mood: 'happy', title: 'Teslim edildi', text: r.text || `${what} · ${dest.name}`, progress: 1, ttl: r.ttl || 5, url: r.url });
    return { ok: true, text: r.text || '' };
  } catch (err) {
    const msg = String((err && err.message) || err).slice(0, 110);
    ctx.send({ ...base, mood: 'sad', title: 'Teslim edilemedi', text: msg, ttl: 9 });
    return { ok: false, error: msg };
  }
}

module.exports = {
  init: (c) => { ctx = c; if (!tickT) tickT = setInterval(tick, 60); }, // {win, settings, secret, preload, send, onState, busy}
  isOpen, close, destroy: () => { clearInterval(tickT); tickT = null; destroyNow(); },
  deliver, sendTo, list, _open: open
};
