// Spotlight entegrasyonu: Spotlight (spotlight-clone) kısayola basılınca POST /search ile bizi çağırır, biz de ada konumunda
// bir arama hapı açarız. Sonuçlar Spotlight'ın yerel API'sinden gelir (Spotlight açıkken ~/.dynbar-ecosystem/spotlight.json yazar).
// Ana pencere focusable:false ve şekle kırpılı olduğundan arama için ayrı, odaklanabilir bir pencere kullanılır.
const { BrowserWindow, screen, ipcMain } = require('electron');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');

const LINK = path.join(os.homedir(), '.dynbar-ecosystem', 'spotlight.json');
const W = 800; // hap 560 geniş; ölçek 1.3'e ve gölgeye yetecek kadar boşluk
let ctx, sw = null, closing = false, opening = false, shownAt = 0, shrinkT, hideT;

// Windows, ön plana geçme iznini yalnızca son girdiyi alan sürece verir. Kısayolu Spotlight aldığı için burada izin yok;
// kullanılmayan F24 tuşuna basıp bırakmak (yan etkisiz) sürecimizi "girdi alan" yapar.
let keybd = null;
try { if (process.platform === 'win32') keybd = require('koffi').load('user32.dll').func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'); } catch {}
const nudge = () => { try { if (keybd) { keybd(0x87, 0, 0, 0); keybd(0x87, 0, 2, 0); } } catch {} };

const alive = (w) => w && !w.isDestroyed();
const readLink = () => {
  try { const l = JSON.parse(fs.readFileSync(LINK, 'utf8')); if (l && l.port > 0 && typeof l.token === 'string') return l; } catch {}
  return null;
};

function call(method, route, body, timeout = 800) { // {code, json} veya Spotlight yoksa null
  return new Promise((resolve) => {
    const l = readLink(); if (!l) return resolve(null);
    const req = http.request({ host: '127.0.0.1', port: l.port, path: route, method, timeout,
      headers: { Authorization: 'Bearer ' + l.token, 'Content-Type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => { if (d.length < 2e6) d += c; });
      res.on('end', () => { try { resolve({ code: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ code: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const isOpen = () => alive(sw) && !closing;
const own = (e) => alive(sw) && e.sender === sw.webContents;

function destroyNow() {
  clearTimeout(hideT); clearTimeout(shrinkT);
  if (alive(sw)) sw.destroy();
  sw = null; closing = false;
}

function close() {
  if (!alive(sw) || closing) return;
  closing = true;
  try { sw.webContents.send('search-hide'); } catch {}
  clearTimeout(hideT);
  hideT = setTimeout(destroyNow, 460);
  setTimeout(() => ctx.onState(false), 280); // hap adanın boyutuna inerken ada altında geri gelir, hap sonra kalkar
}

// mode: 'toggle' | 'open' | 'close'. Açılabildiyse (veya zaten istenen durumdaysa) true; Spotlight yoksa false (Spotlight kendi çubuğunu açar).
async function open(mode) {
  if (mode === 'close') { close(); return true; }
  if (isOpen()) { if (mode === 'toggle') close(); return true; }
  if (opening || ctx.settings().spotlightSearch === false) return false;
  opening = true;
  try {
    const st = await call('GET', '/status');
    if (!st || st.code !== 200 || !st.json) return false;
    if (closing) destroyNow();
    create(st.json);
    return true;
  } finally { opening = false; }
}

function create(info) {
  const main = ctx.win(); if (!alive(main)) return;
  const b = main.getBounds(), d = screen.getDisplayMatching(b);
  const x = Math.round(Math.max(d.bounds.x, Math.min(b.x + b.width / 2 - W / 2, d.bounds.x + d.bounds.width - W)));
  sw = new BrowserWindow({
    width: W, height: 140, x, y: b.y, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, fullscreenable: false, alwaysOnTop: true,
    webPreferences: { preload: ctx.preload, backgroundThrottling: false }
  });
  const w = sw;
  w.info = info; w.setAlwaysOnTop(true, 'screen-saver');
  w.on('blur', () => { if (w === sw && Date.now() - shownAt > 400) close(); });
  w.on('closed', () => { if (w === sw) { sw = null; closing = false; ctx.onState(false); } });
  w.loadFile(path.join(__dirname, 'search.html'));
  ctx.onState(true);
}

ipcMain.handle('search:init', (e) => (own(e) ? { info: sw.info, settings: ctx.settings() } : null));
ipcMain.on('search:ready', (e) => {
  if (!own(e)) return;
  shownAt = Date.now(); nudge(); sw.show(); sw.focus(); sw.webContents.focus();
  sw.webContents.send('search-show');
});
ipcMain.handle('search:query', async (e, q) => {
  if (!own(e)) return null;
  const r = await call('GET', '/search?q=' + encodeURIComponent(String(q).slice(0, 200)), null, 3000);
  return r && r.code === 200 ? r.json : null;
});
ipcMain.handle('search:icon', async (e, id) => {
  if (!own(e)) return '';
  const r = await call('GET', '/icon?id=' + (id | 0), null, 3000);
  return r && r.json && typeof r.json.icon === 'string' ? r.json.icon : '';
});
ipcMain.handle('search:open', async (e, o) => {
  if (!own(e) || !o) return false;
  const r = await call('POST', '/open', { id: o.id | 0, mode: o.mode === 'reveal' ? 'reveal' : 'open' }, 3000);
  close();
  return !!(r && r.code === 200);
});
ipcMain.on('search:close', (e) => { if (own(e)) close(); });
ipcMain.on('search:fit', (e, h) => { // büyürken hemen, küçülürken hap animasyonu bitince
  if (!own(e)) return;
  h = Math.max(60, Math.min(900, h | 0));
  const set = () => { if (alive(sw)) { const b = sw.getBounds(); sw.setBounds({ x: b.x, y: b.y, width: W, height: h }); } };
  clearTimeout(shrinkT);
  if (h >= sw.getBounds().height) set(); else shrinkT = setTimeout(set, 450);
});

module.exports = {
  init: (c) => { ctx = c; }, // {win, settings, preload, onState(open)}
  open, close, isOpen, destroy: destroyNow
};
