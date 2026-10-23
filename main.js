const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, nativeImage, powerMonitor, clipboard, shell, safeStorage } = require('electron');
const http = require('http'), path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const extras = require('./extras');
const vdesk = require('./vdesk');
const spotlight = require('./spotlight');
const appbar = require('./appbar');
const parcel = require('./parcel');

// Windows, pencere başka bir sanal masaüstündeyken (veya 4 parmakla masaüstü/çalışma alanı geçişinde) Chromium'a pencerenin
// "örtülü" olduğunu bildirir; Chromium da çizimi ve fare girdisini durdurur, geri dönünce arayüz tepkisiz kalır. Bu takibi kapat.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const PORT = 47800;
const preload = path.join(__dirname, 'preload.js');
const WIN_W = 620, WIN_H = 250; // şeffaf pencere; ölçek 1.3'e kadar sığar, boş alan tıklamayı arkaya geçirir

const DEFAULTS = {
  // maskot
  color: 'pink', accent: '', character: 'cat', accessory: 'none', eyes: true, pet: true,
  // görünüm
  uiScale: 1, offsetY: 10, bg: 'black', bgAlpha: 100, shadow: 'soft', anim: 'spring',
  // konum ve davranış (mode: float | dock | desktop (yüzen, sadece masaüstünde) | dock-desktop (yapışık, sadece masaüstünde))
  // reserveSpace: bar her zaman görünürken ekranın üstünde pencerelere yer bırakmaz (görev çubuğu gibi); sadece masaüstü modlarında uygulanmaz
  mode: 'float', reserveSpace: true, display: 0, hideFullscreen: true, autostart: false,
  openOn: 'click', closeDelay: 3.5, sleepAfter: 20, ttlScale: 1, startupToast: true, swipe: 160,
  panelKey: 'Control+Alt+B', testKey: 'Control+Alt+N',
  // sayfalar
  pageMedia: true, pageSystem: true, pageClipboard: false, pagePomodoro: true, pageStopwatch: true, pageCalendar: true, icsUrl: '',
  pageWeather: true, city: '', tempUnit: 'c', pageShortcuts: true, shortcuts: 'Hesap makinesi|calc.exe\nGitHub|https://github.com',
  pageHistory: true, pageQuick: true, pageRecent: true, pageTodo: true,
  pageCountdown: false, countdownName: '', countdownDate: '',
  pageWorld: false, worldClocks: 'Tokyo|Asia/Tokyo\nNew York|America/New_York\nLondon|Europe/London',
  pageRates: false, rates: 'USD,EUR,GBP', rateBase: 'TRY',
  clock24: true, clockSeconds: false, timerPresets: '1,5,10,25',
  pomoFocus: 25, pomoBreak: 5, pomoLong: 15, pomoRounds: 4,
  // bildirimler ve ekosistem
  batteryToasts: true, dnd: false, quietOn: false, quietFrom: '23:00', quietTo: '07:00', waterEvery: 0, eyeBreak: false,
  mediaToasts: true, artOnline: true, osd: true, api: true, apiToken: '', mutedApps: '', focusDnd: true, sound: 'off', spotlightSearch: true,
  // Claude Code: canlı durum (laptop maskotu), bardan onay, yapay zekâ özeti
  claudeLive: true, claudeAsk: true, claudeAi: true, pageClaude: true,
  // kargo: dosyayı adaya sürükleyip bırak, maskot götürsün. Gizli değerler (parcelTgToken, parcelDiscord) şifreli saklanır (aşağıda SECRET)
  parcel: true, parcelAutoFolders: true, parcelFolders: '', parcelTgToken: '', parcelTgChat: '', parcelDiscord: '', parcelWaPhone: '',
  // maskotun günlük yaşamı, su hedefi, toplantı modu
  lifeMascot: true, waterGoal: 8, meetingMode: true,
  todos: []
};
let settings = { ...DEFAULTS };
// Yalnızca bilinen anahtarlar ve doğru türler kabul edilir (ayar içe aktarma ve API için güvenlik)
const okType = (k, v) => (Array.isArray(DEFAULTS[k]) ? Array.isArray(v) : typeof v === typeof DEFAULTS[k]);
const pickKnown = (p) => { const o = {}; if (p && typeof p === 'object') for (const k of Object.keys(DEFAULTS)) if (k in p && okType(k, p[k]) && !(typeof p[k] === 'number' && !isFinite(p[k]))) o[k] = p[k]; return o; };

if (!app.requestSingleInstanceLock()) app.quit();
let win, settingsWin, tray, demoIndex = 0;
const alive = (w) => w && !w.isDestroyed();
let onDesktop = true, fullscreen = false, raised = false, watcher, mediaProc, media = { none: true }, focus = false, missed = [], held = [];
const settingsFocused = () => alive(settingsWin) && settingsWin.isFocused();

// --- tıklama bölgesi: pencere şeffaf ve büyük; yalnızca adanın üstündeyken fareyi yakalar, diğer yerde arkadaki uygulamalara geçirir.
// Windows, masaüstünü gösterme (Win+D) veya üst katman değişiminde bu durumu sessizce sıfırlayabiliyor; bu yüzden durum
// yalnızca değişimde değil, periyodik olarak da yeniden uygulanıyor ve masaüstü geçişlerinde art arda toparlama yapılıyor.
// Yeni yaklaşım: fareyi geçirmek için setIgnoreMouseEvents'i açıp kapamak yerine pencere doğrudan ada şekline kırpılır (SetWindowRgn).
// Bölge dışı Windows tarafından yerel olarak arkadaki uygulamaya geçer; masaüstü geçişi veya Win+D bu durumu bozamaz.
let hit = { x: 240, y: 0, width: 140, height: 62 }, ignoring = null, lastApply = 0, isHovered = false, shapeKey = '', shapeAt = 0;
function applyShape(force) {
  if (!alive(win)) return;
  const k = hit.x + ',' + hit.y + ',' + hit.width + ',' + hit.height;
  if (!force && k === shapeKey && Date.now() - shapeAt < 1500) return;
  shapeKey = k; shapeAt = Date.now();
  try { win.setShape([{ x: hit.x, y: hit.y, width: Math.max(1, hit.width), height: Math.max(1, hit.height) }]); } catch (e) { LOG('setShape', e.message); }
}
function setIgn() { // pencere her zaman fare alır; kırpma bölgesi dışını zaten geçirir
  if (!alive(win)) return; ignoring = false; lastApply = Date.now();
  try { win.setIgnoreMouseEvents(false); } catch {}
}
// Yedek tıklama: arayüz (DOM) fare olaylarını almıyorsa sol tuşu ana süreçten izleyip adaya tıklamayı kendimiz ilet.
let getKey = null, btnDown = false, lastDomClick = 0;
try { if (process.platform === 'win32') getKey = require('koffi').load('user32.dll').func('int16_t __stdcall GetAsyncKeyState(int vk)'); } catch {}
function pollClick(inside) {
  if (!getKey) return;
  let down = false; try { down = (getKey(0x01) & 0x8000) !== 0; } catch { getKey = null; return; }
  if (down && !btnDown && inside) {
    const t = Date.now(), p = screen.getCursorScreenPoint(), bb = win.getBounds();
    setTimeout(() => { // sayfa 120 ms içinde mousedown almadıysa (4 parmakla masaüstüne dönüş sonrası olur) tıklamayı biz ilet
      if (lastDomClick < t && alive(win) && win.isVisible()) { try { win.webContents.send('synthetic-click', { x: p.x - bb.x, y: p.y - bb.y }); } catch {} }
    }, 120);
  }
  btnDown = down;
}
function hitTest() {
  if (!alive(win) || !win.isVisible()) return;
  if (ignoring !== false || Date.now() - lastApply > 1000) setIgn();
  applyShape(false);
  const p = screen.getCursorScreenPoint();
  if (!p || p.x < -10000 || p.x > 10000 || p.y < -10000 || p.y > 10000) return;
  const bb = win.getBounds(), x = p.x - bb.x, y = p.y - bb.y;
  pollClick(x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height);
}
function reassert() { // Windows bazen en üst katmanı düşürür: periyodik olarak geri al
  if (!alive(win) || !win.isVisible()) return;
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); ignoring = null; isHovered = false; applyShape(true);
  try { win.webContents.invalidate(); } catch {}
}
function burst() { [0, 80, 200, 500, 1200, 2500].forEach((t) => setTimeout(reassert, t)); }
// Electron'un setVisibleOnAllWorkspaces'i Windows'ta çalışmaz: pencere oluşturulduğu masaüstünde kalır, masaüstü değişince kaybolur.
// Çözüm: watcher.ps1 pencerenin geçerli masaüstünde olmadığını görünce VDESK|<masaüstü-kimliği> yollar; pencereyi o masaüstüne taşırız
// (vdesk.js, belgelenmiş MoveWindowToDesktop). Taşıma 3 kez üst üste başarısız olursa pencere yeniden oluşturulur (yeni pencere geçerli masaüstünde açılır).
let vFail = 0, vLast = 0, lastRehome = 0, quitting = false;
const hwndOf = (w) => { const b = w.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0)); };
function sendHwnd() { try { if (watcher && alive(win) && watcher.stdin.writable) watcher.stdin.write('HWND|' + hwndOf(win) + '\n'); } catch {} }
function rehome() {
  if (!alive(win)) return createWindow();
  const old = win;
  createWindow(true);
  ignoring = null;
  win.webContents.once('did-finish-load', () => { try { old.destroy(); } catch {} extras.place(); sendHwnd(); burst(); });
}
function onWorkspaceSwitch(guid) {
  if (!alive(win)) return;
  const now = Date.now(); if (now - vLast < 400) return; vLast = now; // watcher tekrar tekrar bildirir; seyrelt
  if (guid && vdesk.moveHere(win.getNativeWindowHandle(), guid)) vFail = 0;
  else if (win.isVisible() && ++vFail >= 3 && now - lastRehome > 5000) { vFail = 0; lastRehome = now; return rehome(); }
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  extras.place();
  ignoring = null;
  hitTest();
  burst();
  try { win.webContents.send('workspace-switched'); } catch {}
}
function recover() { setTimeout(() => { extras.place(); updateVisibility(); burst(); reserve(); }, 800); }

const isDock = () => /^dock/.test(settings.mode), desktopOnly = () => /desktop$/.test(settings.mode);
// Bar her zaman görünürken ekranın üstünde yer ayırır; adanın kapladığı yükseklik kadar (ölçekle birlikte)
function reserve() {
  const ui = Math.max(0.8, Math.min(1.3, +settings.uiScale || 1)), h = isDock() ? 36 : (settings.offsetY ?? 10) + 42;
  if (appbar.update(settings.reserveSpace !== false && !desktopOnly(), settings.display, h * ui)) {
    // Windows ada penceresini ayrılan şeridin altına iter; ada ekranın en üstüne (şeridin içine) geri konur
    [120, 400, 1000].forEach((t) => setTimeout(extras.place, t));
  }
}

// "Sadece masaüstünde": masaüstü öndeyse, bildirim varsa veya ayarlar açıksa görünür; aksi halde gizlenir
let hideT = 0; // yapışık modda çıkış animasyonu bitince pencereyi gizleyen zamanlayıcı
function updateVisibility() {
  if (!alive(win)) return;
  const show = !(settings.hideFullscreen && fullscreen) && (!desktopOnly() || onDesktop || raised || settingsFocused());
  if (show) {
    const leaving = !!hideT; // çıkış animasyonu sürerken geri dönüldüyse giriş animasyonu yeniden oynar
    if (leaving) { clearTimeout(hideT); hideT = 0; }
    const was = win.isVisible();
    win.showInactive();
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!was || leaving) { ignoring = null; win.webContents.send('entrance'); }
  } else if (isDock() && settings.anim !== 'off' && win.isVisible()) {
    // yapışık modda ada üst kenara geri çekilir, sonra pencere gizlenir
    if (!hideT) { win.webContents.send('exit'); hideT = setTimeout(() => { hideT = 0; if (alive(win)) win.hide(); }, 260); }
  } else win.hide();
}
const mins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const quiet = () => {
  if (!settings.quietOn) return false;
  const n = new Date(), c = n.getHours() * 60 + n.getMinutes(), a = mins(settings.quietFrom), b = mins(settings.quietTo);
  return a === b ? false : a < b ? c >= a && c < b : c >= a || c < b;
};
const mutedApp = (a) => a.app && String(settings.mutedApps || '').toLowerCase().split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).includes(String(a.app).toLowerCase());
const suppressed = (a) => !a.force && (settings.dnd || quiet() || (focus && settings.focusDnd !== false));
const send = (a) => {
  if (!alive(win)) return;
  if (!a.force && mutedApp(a)) return;
  if (suppressed(a)) { // bastırılan bildirimler "kaçırılanlar" listesine girer
    if (a.title && !a.key) { missed.push({ title: a.title, text: a.text || '', app: a.app || '', t: Date.now() }); if (missed.length > 20) missed.shift(); }
    return;
  }
  if (overlayOpen()) { // arama hapı veya kargo bölgesi adanın üstünde: bildirimler o bitince gösterilir, yüksek öncelikli olan kapatır
    if (a.priority !== 'high') {
      if (a.key) held = held.filter((x) => x.key !== a.key);
      held.push(a); if (held.length > 20) held.shift();
      return;
    }
    spotlight.close(); parcel.close();
  }
  raised = true; updateVisibility(); win.webContents.send('activity', a);
};
const overlayOpen = () => spotlight.isOpen() || parcel.isOpen();
function overlayChanged() { // arama hapı / kargo bölgesi açılırken ada gizlenir, kapanınca geri gelir ve tutulan bildirimler gösterilir
  const open = overlayOpen();
  if (alive(win)) win.webContents.send('hush', open);
  if (!open) held.splice(0).forEach(send);
}
function flushMissed() {
  const list = missed; missed = [];
  if (!list.length || !alive(win)) return;
  win.webContents.send('missed', list);
  send({ title: 'Kaçırdığın bildirimler', text: list.length + ' bildirim, "Son bildirimler" sayfasında', mood: 'happy', ttl: 5, force: true });
}
const file = () => path.join(app.getPath('userData'), 'settings.json');
const load = () => { try { settings = { ...DEFAULTS, ...pickKnown(JSON.parse(fs.readFileSync(file(), 'utf8'))) }; } catch {} };
const save = () => { try { fs.writeFileSync(file(), JSON.stringify(settings)); } catch {} };
// Gizli değerler (bot anahtarı, webhook) diskte Windows DPAPI ile şifreli ("enc:...") durur; arayüze yalnızca "••••" gider.
const SECRET = ['parcelTgToken', 'parcelDiscord'], MASK = '••••';
function getSecret(k) {
  const v = settings[k];
  if (typeof v !== 'string') return '';
  try { return v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.startsWith('raw:') ? v.slice(4) : ''; } catch { return ''; }
}
const masked = () => { const o = { ...settings }; for (const k of SECRET) if (o[k]) o[k] = MASK; return o; };
function sealSecrets(p) { // düz metin gelen gizli değerleri şifrele; "••••" gelen değişmedi demektir
  if (!p || typeof p !== 'object') return p;
  const o = { ...p };
  for (const k of SECRET) {
    if (typeof o[k] !== 'string') continue;
    if (o[k] === MASK || o[k].startsWith('enc:') || o[k].startsWith('raw:')) { delete o[k]; continue; }
    o[k] = !o[k] ? '' : safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(o[k]).toString('base64') : 'raw:' + o[k];
  }
  return o;
}
const broadcast = () => [win, settingsWin].forEach((w) => alive(w) && w.webContents.send('settings', masked()));
function applyPatch(p, reset) {
  const wasDnd = settings.dnd;
  settings = reset ? { ...DEFAULTS, todos: settings.todos } : { ...settings, ...pickKnown(sealSecrets(p)) };
  save(); updateVisibility(); broadcast(); extras.apply(); regKeys(); reserve();
  if (wasDnd && !settings.dnd) flushMissed();
}

const demos = [
  { title: 'Merhaba!', text: 'Ben burada yaşıyorum 🌸', mood: 'happy', ttl: 3 },
  { title: 'Yeni mesaj', text: "Ahmet: toplantı 15:00'te", mood: 'alert', ttl: 4 },
  { type: 'timer', title: 'Zamanlayıcı', seconds: 10 },
  { title: 'Build tamamlandı', text: '0 hata, 0 uyarı', mood: 'happy', ttl: 3 }
];
const demo = () => send({ ...demos[demoIndex++ % demos.length], force: true });

function createWindow(quiet) {
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, x: Math.round(bounds.x + (bounds.width - WIN_W) / 2), y: bounds.y,
    frame: false, transparent: true, skipTaskbar: true, resizable: false, focusable: false, hasShadow: false,
    type: 'toolbar',
    webPreferences: { preload, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  setIgn(); applyShape(true);
  updateVisibility();
  win.loadFile('index.html');
  // arayüzdeki hatalar günlüğe düşsün (panel boş kalırsa sebebi görülebilsin)
  win.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) LOG('arayüz hatası:', msg, String(src).split('/').pop() + ':' + line); });
  win.webContents.on('render-process-gone', (_e, d) => LOG('arayüz süreci kapandı:', d.reason));
  sendHwnd();
  win.webContents.once('did-finish-load', () => { broadcast(); if (!quiet && settings.startupToast !== false) send(demos[0]); });
}

function openSettings() {
  if (alive(settingsWin)) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 460, height: 780, resizable: false, autoHideMenuBar: true,
    title: 'Dynamic Bar Ayarları', backgroundColor: '#14121a', webPreferences: { preload }
  });
  settingsWin.loadFile('settings.html');
  ['focus', 'blur', 'closed'].forEach((ev) => settingsWin.on(ev, updateVisibility));
}

// ---------- Ekosistem API ----------
// Dış programlar HTTP (POST /notify ...) veya WebSocket (ws://127.0.0.1:47800) ile bildirim gönderir. Ayrıntı: API.md
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function sanitize(o) { // dışarıdan gelen veriyi yalnızca bilinen alanlarla sınırla
  if (!o || typeof o !== 'object') return null;
  const a = {};
  for (const k of ['title', 'text', 'app', 'icon']) if (typeof o[k] === 'string') a[k] = o[k].slice(0, k === 'text' ? 200 : k === 'icon' ? 8 : 80);
  if (['happy', 'alert', 'music', 'idle', 'claude', 'working', 'sad', 'drink', 'yawn', 'hungry', 'sleepy'].includes(o.mood)) a.mood = o.mood;
  if (o.type === 'timer') { a.type = 'timer'; a.seconds = clamp(+o.seconds || 10, 1, 86400); }
  if (isFinite(+o.ttl) && +o.ttl > 0) a.ttl = Math.min(+o.ttl, 600);
  if (o.progress != null && isFinite(+o.progress)) a.progress = clamp(+o.progress, 0, 1);
  if (typeof o.key === 'string' && o.key) a.key = o.key.slice(0, 60);
  if (typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)) a.color = o.color;
  if (typeof o.url === 'string' && /^(https?:\/\/|mailto:)/i.test(o.url)) a.url = o.url.slice(0, 500);
  if (o.sticky === true) a.sticky = true;
  if (o.priority === 'high') { a.priority = 'high'; a.force = true; } // yüksek öncelik: rahatsız etmeyi aşar, sıranın başına geçer
  if (o.force === true) a.force = true;
  return a;
}
const rateLog = [];
const allowRate = () => { const n = Date.now(); while (rateLog.length && n - rateLog[0] > 5000) rateLog.shift(); if (rateLog.length >= 25) return false; rateLog.push(n); return true; };
const reminders = new Set();
function remind(o) {
  const s = Math.min(86400, (+o.seconds || 0) + (+o.minutes || 0) * 60);
  if (!(s > 0)) return 'hata: seconds veya minutes gerekli';
  if (reminders.size >= 50) return 'hata: çok fazla hatırlatıcı';
  const a = sanitize({ title: 'Hatırlatıcı', mood: 'alert', ttl: 8, ...o, force: true });
  const t = setTimeout(() => { reminders.delete(t); send({ ...a, force: true }); }, s * 1000);
  reminders.add(t); return 'ok';
}
function todo(o) {
  let t = Array.isArray(settings.todos) ? [...settings.todos] : [];
  if (typeof o.add === 'string' && o.add.trim()) t.unshift({ t: o.add.trim().slice(0, 80), d: false });
  if (Number.isInteger(o.toggle) && t[o.toggle]) t[o.toggle] = { ...t[o.toggle], d: !t[o.toggle].d };
  if (o.clear) t = t.filter((x) => !x.d);
  settings = { ...settings, todos: t.slice(0, 30) }; save(); broadcast();
}
function handleApi(cmd, o) {
  o = o && typeof o === 'object' ? o : {};
  switch (cmd) {
    case 'notify':
      (Array.isArray(o) ? o : [o]).slice(0, 10).forEach((x) => {
        if (!allowRate()) return; const a = sanitize(x);
        if (x && typeof x.stat === 'string') recordStat(x.stat);
        if (a && a.key === 'claude' && settings.claudeLive === false) return; // Claude Code canlı durumu ayarlardan kapatıldı
        if (a && (a.title || a.text || a.type === 'timer')) send(a);
      });
      return 'ok';
    case 'dismiss': if (alive(win)) win.webContents.send('dismiss', { key: typeof o.key === 'string' ? o.key : '' }); return 'ok';
    case 'dnd': applyPatch({ dnd: typeof o.on === 'boolean' ? o.on : !settings.dnd }); return 'ok';
    case 'panel': if (alive(win)) win.webContents.send('toggle', o.mode === 'open' || o.mode === 'close' ? o.mode : 'toggle'); return 'ok';
    case 'remind': return remind(o);
    case 'water': if (alive(win)) win.webContents.executeJavaScript('window.barApi && window.barApi.waterAsk && window.barApi.waterAsk()').catch(() => {}); return 'ok';
    case 'todo': todo(o); return 'ok';
    case 'status':
      return JSON.stringify({ app: 'dynamic-bar', version: app.getVersion(), dnd: !!settings.dnd, focus, quiet: quiet(), todos: (settings.todos || []).filter((x) => !x.d).length,
        claude: { live: settings.claudeLive !== false, ask: settings.claudeAsk !== false, ai: settings.claudeAi !== false },
        media: media.none || !media.title ? null : { title: media.title, artist: media.artist || '', status: media.status || '' } });
  }
  return 'bilinmeyen komut';
}
const hostOk = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || ''); // DNS rebinding koruması
const authed = (req, u) => { const t = settings.apiToken; return !t || (req.headers.authorization || '') === 'Bearer ' + t || u.searchParams.get('token') === t; };
const POST_CMDS = ['notify', 'dismiss', 'dnd', 'panel', 'remind', 'todo', 'water'], WS_CMDS = ['dismiss', 'dnd', 'panel', 'remind', 'todo'];

// Bardan onay: POST /ask {title, text, timeout} yanıtı kullanıcı Onayla/Reddet'e basana (veya zaman aşımına) kadar bekletir.
// Yanıt: {"answer":"allow"|"deny"|"dismissed"|"timeout"|"unavailable"|"closed"}. Claude Code izin hook'u bunu kullanır.
const asks = new Map();
function handleAsk(req, res) {
  let body = '';
  req.on('data', (d) => { if (body.length < 65536) body += d; });
  req.on('end', () => {
    let o = {}; try { o = JSON.parse(body || '{}'); } catch {}
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), secs = clamp(+o.timeout || 60, 5, 300);
    const finish = (answer) => {
      const x = asks.get(id); if (!x) return; asks.delete(id); clearTimeout(x.timer);
      try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ answer })); } catch {}
      if (alive(win)) win.webContents.send('dismiss', { key: 'ask-' + id });
    };
    asks.set(id, { finish, timer: setTimeout(() => finish('timeout'), secs * 1000) });
    res.on('close', () => finish('closed')); // hook öldüyse (terminalden yanıtlandı) bildirimi kaldır
    if (!alive(win) || settings.claudeAsk === false) return finish('unavailable');
    const a = sanitize({ title: o.title || 'Claude Code onay istiyor', text: o.text || '', icon: '🔐', mood: 'alert', app: 'Claude Code', priority: 'high', sticky: true, key: 'ask-' + id });
    a.actions = [{ id: 'allow', label: 'Onayla' }, { id: 'deny', label: 'Reddet' }]; a.askId = id; a.ttl = secs;
    send(a);
  });
}
ipcMain.on('ask-answer', (_e, d) => {
  const x = d && asks.get(d.id); if (x) x.finish(d.answer === 'allow' || d.answer === 'deny' ? d.answer : 'dismissed');
});

// Spotlight araması: POST /search {mode: "toggle"|"open"|"close"}. Spotlight kısayola basılınca çağırır. Spotlight yoksa 503 döner
// ve Spotlight kendi çubuğunu açar.
function handleSearch(req, reply) {
  let body = '';
  req.on('data', (d) => { if (body.length < 1024) body += d; });
  req.on('end', async () => {
    let o = {}; try { o = JSON.parse(body || '{}'); } catch {}
    const ok = await spotlight.open(o.mode === 'open' || o.mode === 'close' ? o.mode : 'toggle');
    reply(ok ? 200 : 503, ok ? 'ok' : 'spotlight yok');
  });
}

// Hata günlüğü: userData/log.txt (en çok ~200 KB; aşınca yarıya kırpılır). Tray menüsünden açılır.
function LOG(...a) {
  try {
    const f = path.join(app.getPath('userData'), 'log.txt');
    const line = new Date().toISOString() + ' ' + a.map((x) => (x && x.stack) || String(x)).join(' ') + '\n';
    try { if (fs.statSync(f).size > 200000) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').slice(-100000)); } catch {}
    fs.appendFileSync(f, line);
  } catch {}
}
process.on('uncaughtException', (e) => LOG('uncaughtException', e));
process.on('unhandledRejection', (e) => LOG('unhandledRejection', e));

// Claude Code günlük istatistiği: hook'un yolladığı stat=work|done|failed olaylarından görev sayısı ve çalışma süresi
const statFile = () => path.join(app.getPath('userData'), 'claude-stats.json');
const dayKey = () => new Date().toLocaleDateString('sv');
let cstat = null, activeSince = 0;
function stats() {
  if (!cstat) { try { cstat = JSON.parse(fs.readFileSync(statFile(), 'utf8')); } catch { cstat = {}; } }
  if (cstat.day !== dayKey()) cstat = { day: dayKey(), tasks: 0, failed: 0, ms: 0, summarized: false };
  return cstat;
}
function recordStat(kind) {
  const s = stats(), now = Date.now();
  if (kind === 'work') { if (!activeSince || now - activeSince > 3 * 3600000) activeSince = now; }
  else if (kind === 'done' || kind === 'failed') {
    if (activeSince) s.ms += Math.min(now - activeSince, 3 * 3600000);
    activeSince = 0; s.tasks++; if (kind === 'failed') s.failed++;
    try { fs.writeFileSync(statFile(), JSON.stringify(s)); } catch {}
  } else return;
  if (alive(win)) win.webContents.send('claude', s);
}
const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' sa ' + (m % 60) + ' dk' : m + ' dk'; };
function claudeSummary(force) {
  const s = stats(); if (!s.tasks) return;
  send({ title: 'Bugün Claude Code', text: s.tasks + ' görev · ' + fmtDur(s.ms) + (s.failed ? ' · ' + s.failed + ' takıldı' : ''), icon: '📊', mood: 'happy', ttl: 7, force: !!force });
}
setInterval(() => { // gün sonu özeti: 21:00'den sonra bir kez
  if (!app.isReady()) return;
  const s = stats(); if (new Date().getHours() >= 21 && s.tasks && !s.summarized) { s.summarized = true; try { fs.writeFileSync(statFile(), JSON.stringify(s)); } catch {} claudeSummary(false); }
}, 60000);
ipcMain.handle('claude:get', () => stats());

// Toplantı modu: takvimdeki etkinlik sürerken rahatsız etme otomatik açılır, bitince kaçırılanlar özetlenir
let meetingOn = false, meetingPrevDnd = false;
function setMeeting(title) {
  if (settings.meetingMode === false) title = null;
  if (title && !meetingOn) {
    meetingOn = true; meetingPrevDnd = !!settings.dnd;
    send({ title: 'Toplantı modu', text: title + ' · bildirimler kapalı', icon: '📅', mood: 'idle', ttl: 4, force: true });
    if (!meetingPrevDnd) applyPatch({ dnd: true });
  } else if (!title && meetingOn) {
    meetingOn = false; if (!meetingPrevDnd && settings.dnd) applyPatch({ dnd: false }); // applyPatch kaçırılanları özetler
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const reply = (code, body) => { if (res.writableEnded) return; res.statusCode = code; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(body); };
    let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return reply(400, 'bad url'); }
    if (req.headers.origin || !hostOk(req)) return reply(403, 'forbidden'); // web siteleri istek atamasın
    if (req.method === 'GET' && u.pathname === '/') return reply(200, 'dynamic-bar');
    if (!settings.api) return reply(403, 'api disabled');
    if (!authed(req, u)) return reply(401, 'unauthorized');
    if (req.method === 'GET' && u.pathname === '/status') return reply(200, handleApi('status'));
    if (req.method === 'POST' && u.pathname === '/ask') return handleAsk(req, res);
    if (req.method === 'POST' && u.pathname === '/search') return handleSearch(req, reply);
    const cmd = u.pathname.slice(1);
    if (req.method !== 'POST' || !POST_CMDS.includes(cmd)) return reply(404, 'not found');
    let body = '', size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > 65536) { if (!res.writableEnded) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); reply(413, 'too large'); } } else body += d;
    });
    req.on('end', () => { try { reply(200, handleApi(cmd, body ? JSON.parse(body) : {})); } catch { reply(400, 'bad json'); } });
  });
  server.on('error', (e) => { console.error('API başlatılamadı:', e.message); LOG('API başlatılamadı', e.message); });
  extras.attachWs(server);
  server.listen(PORT, '127.0.0.1');
}
// WebSocket: düz bildirim JSON'u veya {"cmd":"dnd","on":true} gibi komutlar
const wsMessage = (o) => handleApi(o && typeof o === 'object' && !Array.isArray(o) && WS_CMDS.includes(o.cmd) ? o.cmd : 'notify', o);
const allowReq = (req) => { try { return hostOk(req) && authed(req, new URL(req.url, 'http://127.0.0.1')); } catch { return false; } };

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Dynamic Bar');
  tray.on('click', openSettings);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ayarlar', click: openSettings },
    { label: "Claude Code hook'larını kur", click: () => {
      const p = spawn(process.execPath, [unpacked(path.join(__dirname, 'cli.js')), 'setup-claude'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
      p.on('exit', (c) => send({ title: c === 0 ? "Claude Code hook'ları kuruldu" : 'Kurulum başarısız', text: c === 0 ? 'Claude Code oturumunu yeniden başlat' : 'Günlüğe bak veya dynbar setup-claude çalıştır', icon: c === 0 ? '✅' : '⚠️', mood: c === 0 ? 'happy' : 'alert', ttl: 6, force: true }));
    } },
    { label: 'Test: Su içme', click: () => handleApi('water', {}) },
    { label: 'Bugünün Claude özeti', click: () => claudeSummary(true) },
    { label: 'Günlüğü aç', click: () => shell.openPath(path.join(app.getPath('userData'), 'log.txt')) },
    { label: 'Paneli aç/kapat', click: () => alive(win) && win.webContents.send('toggle', 'toggle') },
    { label: 'Rahatsız etmeyi aç/kapat', click: () => handleApi('dnd', {}) },
    { label: 'Panodaki metni yapılacaklara ekle', click: () => todo({ add: clipboard.readText() }) },
    { type: 'separator' },
    ...demos.map((d, i) => ({ label: 'Test: ' + d.title, click: () => send({ ...demos[i], force: true }) })),
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() }
  ]));
}

const unpacked = (p) => p.replace(/app.asar(?!.unpacked)/, 'app.asar.unpacked'); // paketlenmiş uygulamada betikler asar dışına açılır; PowerShell asar içini okuyamaz
const ps = (f) => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked(path.join(__dirname, 'scripts', f))], { windowsHide: true });
function lines(proc, cb) {
  let buf = ''; proc.on('error', () => {}); proc.stderr && proc.stderr.on('data', (d) => { console.error('[ps]', String(d).trim()); LOG('[ps]', String(d).trim()); }); proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { cb(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
}

// Kapak yedeği: sistem kapak vermezse (Spotify, tarayıcılar vb.) iTunes arama API'sinden bulunur (anahtar gerekmez)
let artFor = '';
async function artFallback(m) {
  const id = m.key + '|' + m.title;
  if (!m.title || artFor === id) return; artFor = id;
  await new Promise((r) => setTimeout(r, 1500)); // sistemin kendi kapağı gelirse onu kullan
  if (media.key + '|' + media.title !== id || media.art) return;
  try {
    const q = encodeURIComponent([m.title, m.artist].filter(Boolean).join(' '));
    const j = await (await fetch('https://itunes.apple.com/search?media=music&entity=song&limit=1&term=' + q, { signal: AbortSignal.timeout(6000) })).json();
    const u = j.results && j.results[0] && j.results[0].artworkUrl100; if (!u) return;
    const buf = Buffer.from(await (await fetch(u.replace('100x100', '300x300'), { signal: AbortSignal.timeout(6000) })).arrayBuffer());
    if (media.key + '|' + media.title !== id || media.art) return;
    media = { ...media, art: buf.toString('base64'), artMime: 'jpeg' };
    if (alive(win)) win.webContents.send('media', media);
  } catch {}
}

function startWatcher() {
  watcher = ps('watcher.ps1');
  lines(watcher, (l) => {
    if (!l) return;
    if (l.startsWith('VDESK|')) {
      onWorkspaceSwitch(l.slice(6));
      return;
    }
    const [c, f] = l.split('|');
    const prev = onDesktop + '|' + fullscreen;
    onDesktop = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'XamlExplorerHostIslandWindow', 'MultitaskingViewFrame'].includes(c);
    fullscreen = f === '1' && !onDesktop;
    updateVisibility();
    if (prev !== onDesktop + '|' + fullscreen) burst(); // masaüstüne geçiş: üst katmanı ve tıklama durumunu art arda tazele
  });
  watcher.stdin.on('error', () => {}); sendHwnd();
  watcher.on('exit', (c) => { if (!quitting) { LOG('watcher kapandı, kod', c); setTimeout(startWatcher, 2000); } }); // PowerShell çökerse tekrar başlat
}
function startWatchers() {
  if (process.platform !== 'win32') return;
  startWatcher();
  mediaProc = ps('media.ps1'); mediaProc.stdin.on('error', () => {});
  lines(mediaProc, (l) => {
    try {
      const m = JSON.parse(l), changed = m.key !== media.key;
      media = { ...m, art: m.art || (changed ? null : media.art), artMime: m.art ? null : (changed ? null : media.artMime) };
      if (alive(win)) win.webContents.send('media', media);
      if (!media.art && media.title && settings.artOnline !== false) artFallback(media);
    } catch {}
  });
}

let keysSig = '';
function regKeys() {
  const sig = settings.panelKey + '|' + settings.testKey; if (sig === keysSig) return; keysSig = sig;
  globalShortcut.unregisterAll();
  const add = (acc, fn) => { try { if (acc) globalShortcut.register(acc, fn); } catch {} };
  add(settings.testKey, demo);
  add(settings.panelKey, () => alive(win) && win.webContents.send('toggle', 'toggle'));
}

ipcMain.handle('media:get', () => media);
ipcMain.on('media:cmd', (_e, c) => ['playpause', 'next', 'prev'].includes(c) && mediaProc && mediaProc.stdin.write(c + '\n'));
ipcMain.handle('settings:get', () => masked());
ipcMain.on('settings:set', (_e, p) => applyPatch(p));
ipcMain.on('settings:reset', () => applyPatch(null, true));
ipcMain.on('open-settings', openSettings);
ipcMain.on('open-url', (_e, u) => { if (typeof u === 'string' && /^(https?:\/\/|mailto:)/i.test(u)) shell.openExternal(u); });
ipcMain.on('todo', (_e, o) => todo(o && typeof o === 'object' ? o : {}));
ipcMain.on('focus', (_e, v) => { const was = focus; focus = !!v; if (was && !focus) flushMissed(); });
ipcMain.on('shape', (_e, r) => { if (r) { hit = { x: r.x | 0, y: r.y | 0, width: r.width | 0, height: r.height | 0 }; hitTest(); } });
ipcMain.on('interactive', (_e, v) => {
  if (!alive(win)) return;
  isHovered = !!v;
  if (v) {
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }
});
ipcMain.on('dom-click', () => { lastDomClick = Date.now(); });ipcMain.on('raise', (_e, v) => { raised = v; updateVisibility(); });
ipcMain.on('test', demo);

app.whenReady().then(() => {
  load(); createWindow(); createTray(); startServer(); startWatchers();
  spotlight.init({ win: () => win, settings: masked, preload, onState: overlayChanged });
  parcel.init({ win: () => win, settings: () => settings, secret: getSecret, preload, send, onState: overlayChanged, busy: () => spotlight.isOpen() });
  if (process.platform === 'win32') { // koffi yoksa sanal masaüstü taşıma ve yedek tıklama çalışmaz: sessizce bozulmasın, kullanıcıya söyle
    try { require('koffi'); } catch (e) {
      LOG('koffi yüklü değil, "npm install" çalıştır:', e.message);
      setTimeout(() => send({ title: 'Eksik bağımlılık', text: 'npm install çalıştır (koffi); bazı özellikler kısıtlı', icon: '⚠️', mood: 'alert', ttl: 8, force: true }), 4000);
    }
  }
  extras.init({ settings: () => settings, win: () => win, send, ps, lines, ws: wsMessage, allowReq, meeting: setMeeting });
  regKeys(); reserve();
  setInterval(hitTest, 30); setInterval(reassert, 4000);
  ['display-added', 'display-removed', 'display-metrics-changed'].forEach((e) => screen.on(e, recover));
  ['resume', 'unlock-screen'].forEach((e) => powerMonitor.on(e, recover));
});
app.on('will-quit', () => { quitting = true; spotlight.destroy(); parcel.destroy(); appbar.remove(); globalShortcut.unregisterAll(); [watcher, mediaProc].forEach((p) => p && p.kill()); extras.stop(); });
app.on('window-all-closed', (e) => e.preventDefault()); // ayar penceresi kapanınca uygulama kapanmasın
