// macOS görünümü: açıkken Windows görev çubuğu tamamen gizlenir; yerine üstte macOS menü çubuğu, altta Dock gelir.
//  - Görev çubuğu: otomatik gizle açılır (çalışma alanı geri verilir) ve çubuk penceresi gizlenir. Kapanınca (çökse bile) geri gelir:
//    normal çıkışta stop(), çökmede scripts/taskbar-guard.ps1 bekçisi eski hale döndürür.
//  - Menü çubuğu (macmenu.html): şeffaf; yazı rengi duvar kağıdının üst şeridine göre siyah/beyaz seçilir. Ortada ada için boşluk bırakılır.
//    Sağdaki denetim simgesi macOS "Denetim Merkezi" benzeri paneli (maccc.html) açar.
//  - Dock (macdock.html): sabitlenen ve açık uygulamalar, pencerenin kendi simgesiyle. Boyutu ayarlardan değişir.
//  - Her ikisi de AppBar ile yer ayırır: büyütülmüş pencereler menü çubuğunun altında ve Dock'un üstünde kalır.
const { BrowserWindow, screen, ipcMain, Menu, app, shell, nativeImage, desktopCapturer, dialog } = require('electron');
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const wl = require('./winlist');
const appbar = require('./appbar');
const vdesk = require('./vdesk');

const MENU_H = 25, TIP_H = 200; // TIP_H: Dock penceresinde ipucu ve pencere önizlemesi için ayrılmış ek yükseklik (üstü tıklamaya kapalı) // TIP_H: Dock penceresinde ipucu balonu için ayrılmış ek yükseklik (şekille kırpılır)
const BLOCK = new Set(['textinputhost.exe', 'searchhost.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe', 'lockapp.exe']);
const NAMES = { chrome: 'Google Chrome', msedge: 'Microsoft Edge', explorer: 'Dosya Gezgini', code: 'Visual Studio Code', windowsterminal: 'Terminal', firefox: 'Firefox',
  wt: 'Terminal', cmd: 'Komut İstemi', powershell: 'PowerShell', notepad: 'Not Defteri', calc: 'Hesap Makinesi', taskmgr: 'Görev Yöneticisi', applicationframehost: 'Uygulama' };
const SETTINGS_URIS = new Set(['ms-settings:network-wifi', 'ms-settings:bluetooth', 'ms-settings:display', 'ms-settings:sound', 'ms-settings:', 'ms-settings:about', 'ms-settings:nightlight', 'ms-settings:network-airplanemode']);

let ctx = null, menuWin = null, dockWin = null, ccProc = null, timer = null, hiddenFs = false, tick = 0;
let taskbarOn = false, origAutohide = false, sig = '', activeSig = '', themeSig = '';
let items = [], groups = new Map(), order = [], active = { name: 'Masaüstü', title: '' }, fgNow = null, target = null, menuSig = '';
let cc = { vol: 50, muted: false, bri: null };
let wallM = 0, wallL = null;
const icons = new Map(); // anahtar -> dataURL ya da '' (alınamadı) ya da null (bekliyor)
const menuBar = appbar.create('top'), dockBar = appbar.create('bottom');

const alive = (w) => w && !w.isDestroyed();

// ---------- Yerel (C# / GPU) kabuk: menü çubuğu ve Dock ----------
// native/MacShell.exe aynı IPC kanallarını konuşur; menuWin/dockWin yerine bu sahte pencereler kullanılır.
let nat = null, natHwnd = { menu: 0, dock: 0 };
const nativeExe = () => { for (const p of [path.join(__dirname, 'native', 'bin', 'MacShell.exe'), path.join(__dirname, 'native', 'MacShell', 'bin', 'Release', 'net9.0-windows10.0.19041.0', 'MacShell.exe')]) { const q = ctx.unpacked(p); if (fs.existsSync(q)) return q; } return null; };
const useNative = () => ctx.settings().macNative !== false && !!nativeExe();
function natSend(w, ch, d) { if (nat && nat.stdin.writable) { try { nat.stdin.write(JSON.stringify({ w, ch, d }) + '\n'); } catch {} } }
function natStart() {
  if (nat) return; const exe = nativeExe(); if (!exe) return;
  nat = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  nat.stdin.on('error', () => {});
  ctx.lines(nat, (l) => {
    let j; try { j = JSON.parse(l); } catch { return; }
    if (j.ch === 'native:hwnd') natHwnd = j.d || natHwnd;
    else if (j.ch === 'native:error') ctx.log('native', j.d);
    else if (typeof j.ch === 'string' && j.ch.startsWith('mac')) ipcMain.emit(j.ch, { sender: null }, j.d);
  });
  nat.on('exit', () => { nat = null; });
}
class NatWin {
  constructor(role, rect) { this.role = role; this.alive = true; this.vis = true; natStart(); this.setBounds(rect); this.webContents = { send: (ch, d) => natSend(role, ch, d), isLoading: () => false }; }
  isDestroyed() { return !this.alive; }
  setBounds(r) { const d = display(), sf = d.scaleFactor || 1, o = screen.dipToScreenPoint({ x: d.bounds.x, y: d.bounds.y }); natSend(this.role, 'bounds', { x: Math.round(o.x + (r.x - d.bounds.x) * sf), y: Math.round(o.y + (r.y - d.bounds.y) * sf), w: Math.round(r.width * sf), h: Math.round(r.height * sf), scale: sf }); }
  setShape() {}
  showInactive() { this.vis = true; natSend(this.role, 'vis', true); }
  hide() { this.vis = false; natSend(this.role, 'vis', false); }
  isVisible() { return this.vis; }
  setAlwaysOnTop() {}
  moveTop() { natSend(this.role, 'top', true); }
  getNativeWindowHandle() { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(natHwnd[this.role] || 0)); return b; }
  destroy() { if (!this.alive) return; this.alive = false; natSend(this.role, 'destroy', true); setTimeout(() => { if (nat && !alive(menuWin) && !alive(dockWin)) { try { nat.stdin.end(); nat.kill(); } catch {} nat = null; } }, 300); }
}
const stateFile = () => path.join(app.getPath('userData'), 'taskbar-orig.json');
const lc = (s) => String(s || '').toLowerCase();
const base = (p) => path.win32.basename(String(p || ''));
const clampN = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
function pretty(exe) {
  const n = base(exe).replace(/\.exe$/i, ''), k = n.toLowerCase();
  if (NAMES[k]) return NAMES[k];
  const t = n.replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const display = () => { const all = screen.getAllDisplays(), s = ctx.settings(); return all[s.display] || screen.getPrimaryDisplay(); };
const pins = () => String(ctx.settings().dockPins || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const MENU_ARCHIVED = true; // üst menü çubuğu arşivde (kod duruyor); yalnızca Dock açılabilir
const autoHide = () => ctx.settings().macDockHide === true;
const wantMenu = () => !MENU_ARCHIVED && ctx.settings().macMenu !== false, wantDock = () => ctx.settings().macDock !== false;
const enabled = () => process.platform === 'win32' && ctx && ctx.settings().macbar === true;
const dockSize = () => Math.round(clampN(ctx.settings().macDockSize || 40, 28, 72)); // simge boyutu (DIP)
const dockReserve = () => dockSize() + 10 + 28; // simge kutusu + dolgu + alt boşluk (macdock.html ile aynı)

// ---------- Windows görev çubuğu ----------
function hideTaskbar() {
  if (!taskbarOn) {
    try { origAutohide = !!JSON.parse(fs.readFileSync(stateFile(), 'utf8')).autohide; } // önceki oturum geri yüklemeden kapandıysa asıl değer dosyada kalır
    catch { origAutohide = wl.getAutohide(); try { fs.writeFileSync(stateFile(), JSON.stringify({ autohide: origAutohide })); } catch {} }
    try { // bekçi: ana süreç (çökse bile) kapanınca görev çubuğunu geri getirir
      // libuv doğrudan çocuk süreçleri ana süreçle birlikte öldürür (job nesnesi); torun süreçler kurtulur. Bu yüzden bekçi Start-Process ile torun olarak başlatılır.
      const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
      const script = ctx.unpacked(path.join(__dirname, 'scripts', 'taskbar-guard.ps1'));
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '"' + script + '"', String(process.pid), origAutohide ? '1' : '0', '"' + stateFile() + '"'];
      const launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList ' + args.map(q).join(',')], { windowsHide: true, stdio: 'ignore' });
      launcher.on('error', () => {});
    } catch (e) { ctx.log('taskbar-guard', e.message); }
    taskbarOn = true;
  }
  if (!wl.getAutohide()) wl.setAutohide(true);
  wl.showTaskbar(false);
}
function restoreTaskbar() {
  if (!taskbarOn) return;
  taskbarOn = false;
  try { wl.setAutohide(origAutohide); wl.showTaskbar(true); } catch (e) { ctx.log('görev çubuğu geri yüklenemedi', e.message); }
  try { fs.unlinkSync(stateFile()); } catch {} // dosya silinince bekçi bir şey yapmadan çıkar
}

// ---------- Pencereler ----------
// minWidth/minHeight şart: Windows küçük pencereleri sistem alt sınırına (~51 DIP) büyütür; menü çubuğu pencere başlıklarının üstüne biner ve sürüklemeyi engellerdi.
function mk(file, rect, extra) {
  const w = new BrowserWindow({
    ...rect, minWidth: 1, minHeight: 1, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, type: 'toolbar',
    webPreferences: { preload: ctx.preload, backgroundThrottling: false }, ...extra
  });
  try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  w.setAlwaysOnTop(true, 'screen-saver');
  w.webContents.on('console-message', (_e, level, msg, line) => { if (level >= 3) ctx.log('macbar arayüz', file, msg, line); });
  w.loadFile(file);
  w.once('ready-to-show', () => { if (!hiddenFs) w.showInactive(); });
  return w;
}
const rects = () => {
  const b = display().bounds, dh = dockReserve() + TIP_H;
  return {
    menu: { x: b.x, y: b.y, width: b.width, height: MENU_H },
    dock: { x: b.x, y: b.y + b.height - dh, width: b.width, height: dh }
  };
};
function place() {
  const r = rects();
  if (alive(menuWin)) { menuWin.setBounds(r.menu); if (!(menuWin instanceof NatWin)) try { menuWin.setShape([{ x: 0, y: 0, width: r.menu.width, height: MENU_H }]); } catch {} } // pencere Windows'ta ~51 DIP'e büyürse alt kısım başlıkları kapatmasın: şekille kırp
  if (alive(dockWin)) dockWin.setBounds(r.dock);
}
function reserve() {
  const di = ctx.settings().display;
  const a = menuBar.update(wantMenu() && !hiddenFs, di, MENU_H), b = dockBar.update(wantDock() && !hiddenFs && !autoHide(), di, dockReserve());
  if (a || b) { [100, 400, 1000].forEach((t) => setTimeout(() => { place(); ctx.onReserve(); }, t)); } // Windows çalışma alanını değiştirirken pencereleri iter
}
function sync() {
  const r = rects();
  if (wantMenu()) { if (!alive(menuWin)) menuWin = useNative() ? new NatWin('menu', r.menu) : mk('macmenu.html', r.menu); } else if (alive(menuWin)) { menuWin.destroy(); menuWin = null; }
  if (wantDock()) { if (!alive(dockWin)) dockWin = useNative() ? new NatWin('dock', r.dock) : mk('macdock.html', r.dock); } else if (alive(dockWin)) { dockWin.destroy(); dockWin = null; }
  place();
  [menuWin, dockWin].forEach((w) => { if (alive(w)) { if (hiddenFs) w.hide(); else if (w.webContents && !w.webContents.isLoading()) w.showInactive(); } });
  reserve();
  themeSig = ''; sig = '';
}

// ---------- Menü çubuğu rengi: duvar kağıdının üst şeridi açıksa siyah, koyuysa beyaz yazı ----------
function wallpaperLum() {
  try {
    const f = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
    const m = fs.statSync(f).mtimeMs;
    if (m === wallM && wallL != null) return wallL;
    const img = nativeImage.createFromBuffer(fs.readFileSync(f)), { width: iw, height: ih } = img.getSize();
    if (!iw || !ih) return null;
    const d = display(), sf = d.scaleFactor, sw = d.bounds.width * sf, sh = d.bounds.height * sf;
    const scale = Math.max(sw / iw, sh / ih), y0 = Math.max(0, Math.round((ih - sh / scale) / 2)); // "Doldur" yerleşimi varsayılır
    const strip = Math.max(2, Math.min(ih - y0, Math.round((MENU_H + 6) * sf / scale)));
    const bmp = img.crop({ x: 0, y: y0, width: iw, height: strip }).resize({ width: 96, height: 4 }).toBitmap(); // BGRA
    let sum = 0, n = 0;
    for (let i = 0; i + 3 < bmp.length; i += 4) { sum += 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]; n++; }
    wallM = m; wallL = n ? sum / n / 255 : null;
    return wallL;
  } catch { return null; }
}
function pushTheme() {
  const mode = ctx.settings().macMenuText || 'auto';
  let light = true; // true: beyaz yazı
  if (mode === 'black') light = false;
  else if (mode === 'auto') { const l = wallpaperLum(); light = l == null ? true : l < 0.5; }
  const s = String(light);
  if (s === themeSig) return;
  themeSig = s;
  if (alive(menuWin)) menuWin.webContents.send('macmenu:theme', { light });
}

// ---------- Açık pencereler ve Dock öğeleri ----------
let packMap = null;
const packIcon = (exe) => { // macOS tarzı simge paketi (assets/iconpack): exe adına göre
  try {
    if (!packMap) packMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'iconpack', 'map.json'), 'utf8'));
    const n = lc(base(exe)).replace(/\.exe$/, ''), f = packMap[n]; if (!f) return null;
    return 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'iconpack', f + '.png')).toString('base64');
  } catch { return null; }
};
const packed = new Set();
function fetchIcon(key, exe, hwnd) {
  if (icons.has(key)) return;
  icons.set(key, null);
  const pk = ctx.settings().macIconPack !== false && packIcon(exe); if (pk) { packed.add(key); icons.set(key, pk); sig = ''; return; }
  const done = (url) => { icons.set(key, url); sig = ''; };
  try { // önce exe'nin büyük simgesi (keskin), olmazsa pencerenin kendi simgesi
    const w = (exe && wl.exeIcon(exe, 128)) || (hwnd ? wl.windowIcon(hwnd, 96) : null);
    if (w) { const img = nativeImage.createFromBitmap(w.bgra, { width: w.width, height: w.height }); if (!img.isEmpty()) return done(img.toDataURL()); }
  } catch (e) { ctx.log('pencere simgesi', e.message); }
  app.getFileIcon(exe, { size: 'large' }).then((img) => done(img.isEmpty() ? '' : img.toDataURL())).catch(() => done(''));
}
function pushPrefs() { if (alive(dockWin)) dockWin.webContents.send('prefs', { autohide: autoHide(), previews: ctx.settings().macDockPreview !== false }); }
function poll() {
  if (!enabled()) return;
  if (tick++ % 2 === 0) { try { if (wl.taskbarVisible()) wl.showTaskbar(false); if (tick % 10 === 1 && !wl.getAutohide()) wl.setAutohide(true); } catch {} }
  if (tick % 40 === 1) pushTheme();
  const me = lc(process.execPath), all = wl.list(), g = new Map();
  for (const w of all) {
    const e = lc(w.exe), b = base(e);
    if (e === me || BLOCK.has(b)) continue;
    const frame = b === 'applicationframehost.exe', key = frame ? e + '#' + w.hwnd : e;
    let x = g.get(key); if (!x) { x = { key, exe: w.exe, name: frame ? w.title : pretty(w.exe), pin: !frame, wins: [] }; g.set(key, x); }
    x.wins.push(w);
  }
  groups = g;
  fgNow = wl.foreground();
  const fgH = fgNow && String(fgNow.hwnd), fgE = fgNow && lc(fgNow.exe);
  const isActive = (x) => !!fgNow && (x.wins.some((w) => String(w.hwnd) === fgH) || (x.pin && x.key === fgE));

  order = order.filter((k) => g.has(k)); for (const k of g.keys()) if (!order.includes(k)) order.push(k);
  const pinList = pins(), seen = new Set(), out = [];
  const push = (key, exe, name, x, pinned) => {
    const ik = key.replace(/#.*/, '');
    fetchIcon(ik, exe, x && x.wins[0].hwnd);
    out.push({ key, name, icon: icons.get(ik) || '', pack: packed.has(ik), running: !!x, count: x ? x.wins.length : 0, active: !!x && isActive(x), minimized: !!x && x.wins.every((w) => w.minimized), pinned, wins: x ? x.wins.slice(0, 5).map((w) => ({ h: String(w.hwnd), t: w.title, m: !!w.minimized })) : [] });
  };
  for (const p of pinList) { const k = lc(p), x = g.get(k); seen.add(k); push(k, p, x ? x.name : pretty(p), x, true); }
  for (const k of order) if (!seen.has(k)) { const x = g.get(k); push(k, x.exe, x.name, x, false); }
  items = out;

  if (fgNow && lc(fgNow.exe) !== me) {
    const desk = !fgNow.title || fgNow.title === 'Program Manager';
    active = desk ? { name: 'Masaüstü', title: '' } : { name: pretty(fgNow.exe), title: fgNow.title };
    const gk = [...g.values()].find((x) => x.wins.some((w) => String(w.hwnd) === fgH) || (x.pin && x.key === fgE));
    const nt = desk || !gk ? null : { hwnd: fgNow.hwnd, key: gk.key, name: gk.name };
    if ((nt && nt.hwnd) !== (target && target.hwnd) || (!nt) !== (!target)) { target = nt; targetChanged(); }
    else if (nt) target = nt;
  }
  const payload = { size: dockSize(), items };
  const s = JSON.stringify(payload);
  if (s !== sig) { sig = s; if (alive(dockWin)) dockWin.webContents.send('macdock:items', payload); }
  const as = active.name + '|' + active.title;
  if (as !== activeSig) { activeSig = as; }
  if (tick % 40 === 1 && alive(dockWin)) { const b = dockBackdrop(); if (b) dockWin.webContents.send('macdock:bd', b); }
}

function openApp(p) { shell.openPath(p).then((err) => { if (err) ctx.log('Dock: açılamadı', p, err); }); }
function click(key) {
  const x = groups.get(key);
  if (!x) { const p = pins().find((q) => lc(q) === key); if (p) openApp(p); return; }
  const fgH = fgNow && String(fgNow.hwnd), act = items.find((i) => i.key === key);
  if (act && act.active) {
    if (x.wins.length > 1) { const i = x.wins.findIndex((w) => String(w.hwnd) === fgH), n = x.wins[(i + 1) % x.wins.length]; wl.activate(n.hwnd); } // aynı uygulamanın sıradaki penceresi
    else wl.minimize(x.wins[0].hwnd);
  } else wl.activate((x.wins.find((w) => !w.minimized) || x.wins[0]).hwnd);
  setTimeout(poll, 150);
}
function contextMenu(key) {
  const x = groups.get(key), it = items.find((i) => i.key === key); if (!it) return;
  const t = [{ label: it.name, enabled: false }, { type: 'separator' }];
  if (x && x.wins.length > 1) { x.wins.slice(0, 12).forEach((w) => t.push({ label: (w.title.length > 48 ? w.title.slice(0, 47) + '…' : w.title), click: () => wl.activate(w.hwnd) })); t.push({ type: 'separator' }); }
  const exe = x ? x.exe : pins().find((q) => lc(q) === key);
  if (x ? x.pin : true) {
    t.push(it.pinned ? { label: "Dock'tan kaldır", click: () => ctx.patch({ dockPins: pins().filter((q) => lc(q) !== key).join('\n') }) }
      : { label: "Dock'ta tut", click: () => ctx.patch({ dockPins: [...pins(), exe].join('\n') }) });
  }
  if (x) { if (exe && x.pin) t.push({ label: 'Yeni pencere aç', click: () => openApp(exe) }); t.push({ label: 'Kapat', click: () => x.wins.forEach((w) => wl.close(w.hwnd)) }); }
  else t.push({ label: 'Aç', click: () => openApp(exe) });
  Menu.buildFromTemplate(t).popup({ window: alive(dockWin) && !(dockWin instanceof NatWin) ? dockWin : undefined });
}

// ---------- Denetim Merkezi yardımcısı (ses/parlaklık) ----------
const ccSend = (l) => { try { if (ccProc && ccProc.stdin.writable) ccProc.stdin.write(l + '\n'); } catch {} };
let darkNow = null;
const REGP = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
function readDark() { try { const o = require('child_process').execFileSync('reg', ['query', REGP, '/v', 'AppsUseLightTheme'], { windowsHide: true, encoding: 'utf8', timeout: 2500 }); darkNow = /0x0\s*$/m.test(o.trim()); } catch { darkNow = false; } return darkNow; }
function toggleDark() {
  const v = readDark() ? '1' : '0';
  for (const k of ['AppsUseLightTheme', 'SystemUsesLightTheme']) spawn('reg', ['add', REGP, '/v', k, '/t', 'REG_DWORD', '/d', v, '/f'], { windowsHide: true, stdio: 'ignore' });
  darkNow = v === '0'; setTimeout(() => { try { wl.broadcastSetting('ImmersiveColorSet'); } catch {} }, 250);
  if (alive(popWin)) setTimeout(() => popWin.webContents.send('maccc:state', ccState()), 300);
}
const ccState = () => ({ ...cc, dnd: !!ctx.settings().dnd, dark: darkNow == null ? readDark() : darkNow });
function ccStart() {
  if (ccProc || !ctx.ps) return;
  try {
    ccProc = ctx.ps('cc.ps1'); ccProc.stdin.on('error', () => {});
    ctx.lines(ccProc, (l) => {
      const p = l.split(' ');
      if (p[0] === 'vol') cc = { ...cc, vol: +p[1] || 0, muted: p[2] === '1' };
      else if (p[0] === 'bri') cc = { ...cc, bri: +p[1] };
      else if (p[0] === 'nobri') cc = { ...cc, bri: null };
      else if (p[0] === 'ready') ccSend('get');
      else return;
      if (alive(popWin)) popWin.webContents.send('maccc:state', ccState());
    });
    ccProc.on('exit', () => { ccProc = null; });
  } catch (e) { ctx.log('cc.ps1', e.message); ccProc = null; }
}

// ---------- Uygulamanın kendi menü çubuğu (UI Automation) ----------
let menusProc = null, menusReady = false, uia = new Map(), uiaTry = new Map(), scanT = 0;
function menusStart() {
  if (menusProc || !ctx.ps) return;
  try {
    menusProc = ctx.ps('menus.ps1'); menusProc.stdin.on('error', () => {});
    ctx.lines(menusProc, (l) => {
      if (l === 'ready') { menusReady = true; return; }
      const m = l.match(/^menus (\d+) (.*)$/); if (!m) return;
      const labels = m[2] === '-' ? [] : m[2].split('|');
      uia.set(m[1], labels);
      if (!labels.length && !uiaTry.get(m[1])) { uiaTry.set(m[1], 1); setTimeout(() => menusSend('scan ' + m[1]), 1600); } // Chromium tabanlı uygulamalar ilk sorguda erişilebilirliği açar
      if (target && String(target.hwnd) === m[1]) pushMenus();
    });
    menusProc.on('exit', () => { menusProc = null; menusReady = false; });
  } catch (e) { ctx.log('menus.ps1', e.message); menusProc = null; }
}
const menusSend = (l) => { try { if (menusProc && menusProc.stdin.writable) menusProc.stdin.write(l + '\n'); } catch {} };
function pushMenus() { // sol üst menüler: uygulama adı, (uygulamanın kendi menüleri), Pencere
  if (!alive(menuWin)) return;
  const labels = target ? (uia.get(String(target.hwnd)) || []) : [];
  const list = target
    ? [{ kind: 'app', label: target.name }, ...labels.slice(0, 12).map((label, i) => ({ kind: 'uia', i, label })), { kind: 'win', label: 'Pencere' }]
    : [{ kind: 'app', label: 'Masaüstü' }];
  const s = JSON.stringify(list);
  if (s === menuSig) return; menuSig = s;
  menuWin.webContents.send('macmenu:menus', list);
}
function targetChanged() {
  menuSig = ''; pushMenus();
  if (!target) return;
  menusStart(); clearTimeout(scanT); const h = String(target.hwnd);
  scanT = setTimeout(() => { if (menusReady) menusSend('scan ' + h); else setTimeout(() => menusSend('scan ' + h), 1500); }, 250);
}

// ---------- Açılır paneller (menüler, Wi‑Fi, Denetim Merkezi): tek pencere, sıvı cam ----------
const POP_PAD = 16;
let popWin = null, popReady = false, pop = null, popHiddenAt = 0, popActs = new Map(), popClosing = false, popTimer = null, lastKey = '';
const sh = (cmd) => new Promise((res) => { // netsh çıktısı UTF-8 olsun (chcp 65001)
  let out = ''; const p = spawn('cmd.exe', ['/d', '/c', 'chcp 65001>nul & ' + cmd], { windowsHide: true });
  p.stdout.setEncoding('utf8'); p.stdout.on('data', (d) => { out += d; }); p.on('error', () => res('')); p.on('close', () => res(out));
  setTimeout(() => { try { p.kill(); } catch {} res(out); }, 9000);
});
let bdCache = null, bdBusy = false;
async function warmBackdrop(force) { // menü çubuğunun üstüne gelinince ya da panel kapanınca önceden yakala; tıklamada beklemeyelim
  if (bdBusy || (!force && bdCache && Date.now() - bdCache.t < 2500) || (alive(popWin) && popWin.isVisible())) return;
  bdBusy = true; try { const b = await captureBackdrop(); if (b) bdCache = { t: Date.now(), bd: b }; } finally { bdBusy = false; }
}
async function captureBackdrop() { // panelin arkası: ekranın o anki görüntüsü (panel henüz görünmüyor)
  const d = display();
  try {
    const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * .6), height: Math.round(d.bounds.height * .6) } });
    const s = src.find((x) => String(x.display_id) === String(d.id)) || src[0];
    return s ? { url: 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(70).toString('base64'), mode: 'exact', sw: d.bounds.width, sh: d.bounds.height } : null;
  } catch (e) { ctx.log('ekran yakalanamadı', e.message); return null; }
}
let wallBd = null, wallBdM = 0;
function dockBackdrop() { // dock'un arkası: duvar kağıdı (dock ayrılmış alanda durur, altında genelde yalnızca duvar kağıdı vardır)
  try {
    const f = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'), m = fs.statSync(f).mtimeMs;
    if (!wallBd || m !== wallBdM) {
      const img = nativeImage.createFromBuffer(fs.readFileSync(f)), small = img.resize({ width: Math.min(2560, img.getSize().width) }), sz = small.getSize();
      wallBd = { url: 'data:image/jpeg;base64,' + small.toJPEG(82).toString('base64'), iw: sz.width, ih: sz.height }; wallBdM = m;
    }
    const d = display();
    return { ...wallBd, mode: 'cover', sw: d.bounds.width, sh: d.bounds.height, ox: 0, oy: d.bounds.height - rects().dock.height };
  } catch { return null; }
}
const act = (id, label, fn, o = {}) => { popActs.set(id, fn); return { id, label, ...o }; };
const SEP = { sep: true };
function confirmThen(msg, btn, fn) {
  dialog.showMessageBox({ type: 'question', buttons: ['İptal', btn], defaultId: 1, cancelId: 0, message: msg, noLink: true }).then((r) => { if (r.response === 1) fn(); });
}
function appleItems() {
  const run = (exe, args) => () => { try { spawn(exe, args, { windowsHide: true, stdio: 'ignore', detached: true }).unref(); } catch {} };
  return [
    act('about', 'Bu Bilgisayar Hakkında', () => shell.openExternal('ms-settings:about')),
    act('sets', 'Sistem Ayarları…', () => shell.openExternal('ms-settings:')),
    SEP,
    act('start', 'Başlat Menüsü', () => wl.startMenu()),
    act('task', 'Uygulamayı Zorla Kapat…', run('taskmgr.exe', [])),
    SEP,
    act('sleep', 'Uyku', run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])),
    act('restart', 'Yeniden Başlat…', () => confirmThen('Bilgisayar yeniden başlatılsın mı?', 'Yeniden Başlat', run('shutdown.exe', ['/r', '/t', '0']))),
    act('off', 'Kapat…', () => confirmThen('Bilgisayar kapatılsın mı?', 'Kapat', run('shutdown.exe', ['/s', '/t', '0']))),
    SEP,
    act('lock', 'Ekranı Kilitle', run('rundll32.exe', ['user32.dll,LockWorkStation'])),
    act('logout', 'Oturumu Kapat…', () => confirmThen('Oturum kapatılsın mı?', 'Oturumu Kapat', run('shutdown.exe', ['/l'])))
  ];
}
function appItems() {
  const t = target, g = t && groups.get(t.key);
  if (!t || !g) return [
    act('min-all', 'Tüm Pencereleri Küçült', () => { for (const x of groups.values()) x.wins.forEach((w) => wl.minimize(w.hwnd)); }),
    act('show-all', 'Tüm Pencereleri Göster', () => { for (const x of groups.values()) x.wins.forEach((w) => w.minimized && wl.restore(w.hwnd)); })
  ];
  return [
    act('hide', 'Gizle: ' + t.name, () => g.wins.forEach((w) => wl.minimize(w.hwnd))),
    act('hide-others', 'Diğerlerini Gizle', () => { for (const [k, x] of groups) if (k !== t.key) x.wins.forEach((w) => wl.minimize(w.hwnd)); }),
    act('show-all', 'Tümünü Göster', () => { for (const x of groups.values()) x.wins.forEach((w) => w.minimized && wl.restore(w.hwnd)); }),
    SEP,
    act('quit', 'Çık: ' + t.name, () => g.wins.forEach((w) => wl.close(w.hwnd)))
  ];
}
function windowItems() {
  const t = target, g = t && groups.get(t.key); if (!g) return [];
  const main = g.wins.find((w) => String(w.hwnd) === String(t.hwnd)) || g.wins[0], zoomed = wl.isZoomed(main.hwnd);
  return [
    act('w-min', 'Küçült', () => wl.minimize(main.hwnd)),
    act('w-max', zoomed ? 'Geri Yükle' : 'Yakınlaştır', () => wl.toggleMaximize(main.hwnd)),
    act('w-close', 'Kapat', () => wl.close(main.hwnd)),
    SEP, { hd: true, label: 'Pencereler' },
    ...g.wins.slice(0, 14).map((w, i) => act('w-' + i, w.title.length > 40 ? w.title.slice(0, 39) + '…' : w.title, () => wl.activate(w.hwnd), { checked: String(w.hwnd) === String(t.hwnd) }))
  ];
}
async function wifiData() {
  const [ifc, nets, prof] = await Promise.all([sh('netsh wlan show interfaces'), sh('netsh wlan show networks mode=bssid'), sh('netsh wlan show profiles')]);
  const cm = ifc.match(/^\s*SSID\s*:\s*(.+?)\s*$/m), current = cm ? cm[1] : '';
  const known = new Set(prof.split(/\r?\n/).filter((l) => /rofil/i.test(l) && l.includes(':')).map((l) => l.slice(l.indexOf(':') + 1).trim()).filter(Boolean));
  const map = new Map(); let cur = null;
  for (const l of nets.split(/\r?\n/)) {
    const m = l.match(/^SSID\s+\d+\s*:\s*(.*?)\s*$/);
    if (m) { cur = null; if (m[1]) { cur = map.get(m[1]) || { ssid: m[1], signal: 0, secured: true }; map.set(m[1], cur); } continue; }
    if (!cur) continue;
    if (/^\s*(Authentication|Kimlik Do)/i.test(l)) cur.secured = !/open|a[cç][ıi]k/i.test(l.split(':').slice(1).join(':'));
    const s = l.match(/^\s*(?:Signal|Sinyal)\s*:\s*(\d+)\s*%/i); if (s) cur.signal = Math.max(cur.signal, +s[1]);
  }
  if (current && !map.has(current)) map.set(current, { ssid: current, signal: 60, secured: true });
  const list = [...map.values()].sort((a, b) => (b.ssid === current) - (a.ssid === current) || b.signal - a.signal).slice(0, 10)
    .map((n, i) => ({ ...n, id: 'n' + i, current: n.ssid === current, known: known.has(n.ssid) }));
  list.forEach((n) => popActs.set(n.id, () => { if (n.current) return; if (n.known) spawn('netsh', ['wlan', 'connect', 'name=' + n.ssid], { windowsHide: true, stdio: 'ignore' }); else shell.openExternal('ms-settings:network-wifi'); }));
  popActs.set('settings', () => shell.openExternal('ms-settings:network-wifi'));
  return { current, nets: list };
}
function ensurePop() {
  if (alive(popWin)) return;
  popReady = false;
  popWin = new BrowserWindow({ width: 360, height: 400, minWidth: 1, minHeight: 1, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: ctx.preload, backgroundThrottling: false } });
  popWin.setAlwaysOnTop(true, 'screen-saver');
  popWin.on('blur', () => closePop());
  popWin.webContents.on('console-message', (_e, level, msg, line) => { if (level >= 3) ctx.log('macpop arayüz', msg, line); });
  popWin.loadFile('macpop.html');
}
function popReadyP() {
  return new Promise((r) => {
    if (popReady && alive(popWin)) return r(); ensurePop();
    const t = setInterval(() => { if (popReady) { clearInterval(t); r(); } }, 20); setTimeout(() => { clearInterval(t); r(); }, 3000);
  });
}
function closePop() {
  if (!alive(popWin) || !popWin.isVisible() || popClosing || !pop) return;
  popClosing = true; popHiddenAt = Date.now();
  popWin.webContents.send('macpop:out', { ax: pop.axL, ay: pop.ayL });
  clearTimeout(popTimer); popTimer = setTimeout(popDone, 450);
}
function popDone() {
  clearTimeout(popTimer); popClosing = false;
  if (alive(popWin)) popWin.hide();
  if (alive(menuWin)) menuWin.webContents.send('macpop:closed');
  pop = null;
}
async function openPop(kind, m) {
  const view = kind === 'cc' ? 'cc' : kind === 'wifi' ? 'wifi' : 'menu', key = kind + (m.i ?? '') + (m.label || '');
  const visible = alive(popWin) && popWin.isVisible() && !!pop && !popClosing;
  if (visible && pop.key === key) return closePop();
  if (!visible && lastKey === key && Date.now() - popHiddenAt < 300) return; // paneli kapatan tıklama onu yeniden açmasın
  lastKey = key; popActs = new Map();
  let data = {};
  if (kind === 'apple') data = { items: appleItems() };
  else if (kind === 'app') data = { items: appItems() };
  else if (kind === 'win') data = { items: windowItems() };
  else if (kind === 'cc') { ccStart(); ccSend('get'); data = { cc: ccState() }; }
  else if (kind === 'wifi') data = { loading: true, nets: [] };
  await popReadyP();
  let bd = visible ? pop.bd : bdCache && bdCache.bd;
  if (!bd && !visible) bd = await captureBackdrop(); // ilk açılış: önbellek yoksa bir kez yakala
  if (!visible) setTimeout(() => warmBackdrop(true), 900); // sonraki açılış için (panel kapanınca değil, kapalıyken yakalanır)
  pop = { view, key, ay: MENU_H / 2, ax: m.x + m.w / 2, aw: m.w, ax0: m.x, bd, right: view !== 'menu', played: false, swap: visible };
  popClosing = false; clearTimeout(popTimer);
  popWin.webContents.send('macpop:show', { view, data });
  if (kind === 'wifi') wifiData().then((d) => { if (pop && pop.key === key && alive(popWin)) popWin.webContents.send('macpop:data', { view: 'wifi', data: d }); });
}
function placePop(w, h) {
  if (!pop || !alive(popWin)) return;
  const b = display().bounds, pw = w - 2 * POP_PAD;
  let left = pop.right ? Math.min(pop.ax0 + pop.aw + 8, b.width - 8) - pw : pop.ax0 - 4;
  left = Math.max(8, Math.min(b.width - 8 - pw, left));
  const wx = Math.round(left - POP_PAD), wy = MENU_H + 4 - POP_PAD;
  popWin.setBounds({ x: b.x + wx, y: b.y + wy, width: w, height: h });
  pop.axL = pop.ax - wx; pop.ayL = pop.ay - wy;
  if (!pop.played) {
    pop.played = true; popWin.show(); popWin.moveTop(); popWin.focus();
    popWin.webContents.send('macpop:play', { bd: pop.bd ? { ...pop.bd, ox: wx, oy: wy } : null, ax: pop.axL, ay: pop.ayL, swap: pop.swap });
  }
}

// ---------- Dış arayüz ----------
function apply() {
  if (!ctx) return;
  if (!enabled() || !wl.init()) return stop();
  hideTaskbar(); setTimeout(() => { ensurePop(); warmBackdrop(true); }, 1500);
  sync();
  if (!timer) { timer = setInterval(poll, 700); poll(); }
  pushTheme(); pushPrefs();
  if (alive(popWin)) popWin.webContents.send('maccc:state', ccState());
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  [menuWin, dockWin, popWin].forEach((w) => { if (alive(w)) w.destroy(); }); menuWin = dockWin = popWin = null; popReady = false; pop = null;
  [ccProc, menusProc].forEach((p) => { if (p) { try { p.kill(); } catch {} } }); ccProc = menusProc = null; menusReady = false;
  target = null; menuSig = '';
  menuBar.remove(); dockBar.remove();
  restoreTaskbar();
  sig = activeSig = themeSig = '';
}
function setFullscreen(v) {
  v = !!v; if (v === hiddenFs) return; hiddenFs = v;
  if (enabled()) sync();
}
function reassert() { // adanın moveTop'undan önce çağrılır; ada her zaman bunların üstünde kalır
  [menuWin, dockWin].forEach((w) => { if (alive(w) && w.isVisible()) { w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); } });
}
function onWorkspaceSwitch(guid) { // pencereler oluşturuldukları sanal masaüstünde kalır: geçerli masaüstüne taşı
  if (!guid) return;
  [menuWin, dockWin].forEach((w) => { if (alive(w)) { try { vdesk.moveHere(w.getNativeWindowHandle(), guid); } catch {} } });
}

// c: { settings(), preload, unpacked(p), ps(f), lines(proc, cb), log(...), patch(obj), onReserve(), panel(), openSettings() }
function init(c) {
  ctx = c;
  ipcMain.handle('macdock:get', () => ({ size: dockSize(), items }));
  ipcMain.handle('macdock:bd', () => dockBackdrop());
  ipcMain.on('macdock:click', (_e, k) => typeof k === 'string' && click(k));
  ipcMain.on('macdock:menu', (_e, k) => typeof k === 'string' && contextMenu(k));
  ipcMain.on('macdock:shape', (_e, r) => {
    if (!alive(dockWin) || !Array.isArray(r)) return;
    const list = r.slice(0, 4).map((q) => ({ x: q.x | 0, y: q.y | 0, width: Math.max(1, q.width | 0), height: Math.max(1, q.height | 0) }));
    if (list.length) try { dockWin.setShape(list); } catch {}
  });
  ipcMain.on('macmenu:ready', () => { themeSig = ''; pushTheme(); menuSig = ''; pushMenus(); });
  ipcMain.on('macdock:win', (_e, h) => { const n = Number(h); if (Number.isFinite(n)) { wl.activate(n); setTimeout(poll, 150); } });
  ipcMain.on('macdock:unpin', (_e, k) => { if (typeof k === 'string') ctx.patch({ dockPins: pins().filter((q) => lc(q) !== k).join('\n') }); });
  ipcMain.on('macdock:reorder', (_e, keys) => {
    if (!Array.isArray(keys)) return;
    const pm = new Map(pins().map((p) => [lc(p), p])), np = keys.filter((k) => pm.has(k)).map((k) => pm.get(k));
    for (const [k, p] of pm) if (!keys.includes(k)) np.push(p);
    order = [...keys.filter((k) => !pm.has(k) && groups.has(k)), ...order.filter((k) => !keys.includes(k))];
    sig = ''; ctx.patch({ dockPins: np.join('\n') }); setTimeout(poll, 50);
  });
  ipcMain.on('macdock:ready', () => { pushPrefs(); sig = ''; const b = dockBackdrop(); if (b && alive(dockWin)) dockWin.webContents.send('macdock:bd', b); });
  ipcMain.on('macmenu:hover', () => warmBackdrop());
  ipcMain.on('macmenu:panel', () => ctx.panel());
  ipcMain.on('macmenu:open', (_e, m) => {
    if (!m || typeof m.kind !== 'string') return;
    if (m.kind === 'uia') { if (target && Number.isInteger(m.i)) menusSend('open ' + target.hwnd + ' ' + m.i); return; }
    if (['apple', 'app', 'win', 'wifi', 'cc'].includes(m.kind)) openPop(m.kind, { x: +m.x || 0, w: +m.w || 0, i: m.i, label: String(m.label || '') });
  });
  ipcMain.on('macpop:ready', () => { popReady = true; });
  ipcMain.on('macpop:size', (_e, d) => { if (d && d.w > 0 && d.h > 0) placePop(Math.ceil(d.w), Math.ceil(d.h)); });
  ipcMain.on('macpop:done', popDone);
  ipcMain.on('macpop:act', (_e, id) => { const fn = popActs.get(id); closePop(); if (fn) setTimeout(() => { try { fn(); } catch (e) { ctx.log('menü eylemi', e.message); } }, 120); });
  ipcMain.on('macpop:switch', (_e, v) => { if (v === 'wifi' && pop && menuWin) { const m = { x: pop.ax0, w: pop.aw, label: '' }; openPop('wifi', m); } });
  ipcMain.on('maccc:vol', (_e, v) => ccSend('vol ' + Math.round(clampN(v, 0, 100))));
  ipcMain.on('maccc:mute', () => ccSend('mute'));
  ipcMain.on('maccc:bri', (_e, v) => ccSend('bri ' + Math.round(clampN(v, 0, 100))));
  ipcMain.on('maccc:dnd', () => { ctx.patch({ dnd: !ctx.settings().dnd }); });
  ipcMain.on('maccc:open', (_e, u) => { if (SETTINGS_URIS.has(u)) shell.openExternal(u); closePop(); });
  ipcMain.handle('maccc:getmedia', () => {
    const m = ctx.media && ctx.media(); if (!m || m.none || !m.title) return null;
    let art = null; if (m.art) { const b = String(m.art), mime = m.artMime || (b.startsWith('/9j') ? 'jpeg' : b.startsWith('iVBOR') ? 'png' : 'jpeg'); art = 'data:image/' + mime + ';base64,' + b; }
    return { title: m.title, artist: m.artist || '', playing: /play/i.test(String(m.status || '')), art };
  });
  ipcMain.on('maccc:media', (_e, c) => ctx.mediaCmd && ctx.mediaCmd(c));
  ipcMain.on('maccc:dark', toggleDark);
  ipcMain.on('maccc:cast', () => { closePop(); try { wl.startMenu && require('child_process').spawn('powershell', ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).SendKeys('^{ESC}')"], { windowsHide: true, stdio: 'ignore' }); } catch {} setTimeout(() => shell.openExternal('ms-settings:display'), 50); });
  ipcMain.on('maccc:launch', (_e, w) => {
    closePop();
    if (w === 'calc') spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
    else if (w === 'clock') shell.openExternal('ms-clock:');
    else if (w === 'shot') shell.openExternal('ms-screenclip:');
  });
  ipcMain.on('maccc:settings', () => { closePop(); ctx.openSettings(); });
}

module.exports = { init, apply, stop, setFullscreen, reassert, onWorkspaceSwitch, menuActive: () => enabled() && wantMenu() && !hiddenFs };
