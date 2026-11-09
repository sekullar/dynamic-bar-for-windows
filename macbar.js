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

let wifiTimer = null;
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
let nat = null, natHwnd = { menu: 0, dock: 0 }, nPopKey = '';
const nativeExe = () => { for (const p of [path.join(__dirname, 'native', 'bin', 'MacShell.exe'), path.join(__dirname, 'native', 'MacShell', 'bin', 'Release', 'net9.0-windows10.0.19041.0', 'MacShell.exe')]) { const q = ctx.unpacked(p); if (fs.existsSync(q)) return q; } return null; };
const useNative = () => ctx.settings().macNative !== false && !!nativeExe();
function natSend(w, ch, d) { if (nat && nat.stdin.writable) { try { nat.stdin.write(JSON.stringify({ w, ch, d }) + '\n'); } catch {} } }
function natStart() {
  if (nat) return; const exe = nativeExe(); if (!exe) return;
  nat = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  nat.stdin.on('error', () => {});
  let errTail = ''; nat.stderr.on('data', (c) => { errTail = (errTail + c).slice(-1500); });
  ctx.lines(nat, (l) => {
    let j; try { j = JSON.parse(l); } catch { return; }
    if (j.ch === 'native:hwnd') natHwnd = j.d || natHwnd;
    else if (j.ch === 'native:error') ctx.log('native', j.d);
    else if (typeof j.ch === 'string' && j.ch.startsWith('mac')) ipcMain.emit(j.ch, { sender: null }, j.d);
  });
  const me = nat;
  me.on('exit', (code, sig) => { if (nat !== me) return; ctx.log('native kapandı', 'kod=' + code, sig ? 'sinyal=' + sig : '', errTail.trim()); nat = null; nPopKey = ''; if (enabled()) { menuWin = dockWin = null; setTimeout(() => { if (enabled() && !nat) { sync(); pushPrefs(); } }, 800); } }); // yerel süreç çökerse yeniden başlat
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
const MENU_ARCHIVED = false;
const menuHide = () => ctx.settings().macMenuHide === true;
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
  const a = menuBar.update(wantMenu() && !hiddenFs && !menuHide(), di, MENU_H), b = dockBar.update(wantDock() && !hiddenFs && !autoHide(), di, dockReserve());
  if (a || b) { [100, 400, 1000].forEach((t) => setTimeout(() => { place(); ctx.onReserve(); }, t)); } // Windows çalışma alanını değiştirirken pencereleri iter
}
// Elle gizleme (kısayol): imleç ekranın üstüne/altına dayanınca ilgili çubuk geçici belirir
let fsHide = false, manHide = false, peek = '', peekAt = 0, peekT = null;
const peeked = (w) => manHide && !fsHide && ((w === menuWin && peek === 'menu') || (w === dockWin && peek === 'dock'));
function applyVis() {
  [menuWin, dockWin].forEach((w) => { if (alive(w)) { if (hiddenFs && !peeked(w)) w.hide(); else if (w.webContents && !w.webContents.isLoading()) w.showInactive(); } });
}
function peekPoll() {
  if (!(manHide && !fsHide) || !enabled()) { if (peek) { peek = ''; applyVis(); } return; }
  if (ctx.settings().barsPeek === false) return;
  const p = screen.getCursorScreenPoint(), b = display().bounds, now = Date.now(), inX = p.x >= b.x && p.x < b.x + b.width;
  let want = peek;
  if (!peek) {
    const top = inX && p.y <= b.y, bot = inX && p.y >= b.y + b.height - 1;
    if (top || bot) { if (!peekAt) peekAt = now; if (now - peekAt > 350) want = top ? 'menu' : 'dock'; } else peekAt = 0;
  } else {
    const r = peek === 'menu' ? rects().menu : rects().dock;
    const inside = p.x >= r.x && p.x < r.x + r.width && p.y >= r.y - 8 && p.y < r.y + r.height + 8;
    if (!inside && !nPopKey) { want = ''; peekAt = 0; }
  }
  if (want !== peek) { peek = want; applyVis(); }
}
function toggleBars() {
  manHide = !manHide; peek = ''; peekAt = 0; hiddenFs = fsHide || manHide;
  if (manHide && !peekT) peekT = setInterval(peekPoll, 120);
  if (!manHide && peekT) { clearInterval(peekT); peekT = null; }
  if (enabled()) sync();
}
function sync() {
  const r = rects();
  if (wantMenu()) { if (!alive(menuWin)) menuWin = useNative() ? new NatWin('menu', r.menu) : mk('macmenu.html', r.menu); } else if (alive(menuWin)) { menuWin.destroy(); menuWin = null; }
  if (wantDock()) { if (!alive(dockWin)) dockWin = useNative() ? new NatWin('dock', r.dock) : mk('macdock.html', r.dock); } else if (alive(dockWin)) { dockWin.destroy(); dockWin = null; }
  place();
  applyVis();
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
function pushPrefs() { if (alive(menuWin)) menuWin.webContents.send('prefs', { menuhide: menuHide(), anim: ctx.settings().macDockAnim || 'lively', island: Math.round(100 * clampN(ctx.settings().uiScale || 1, 0.8, 1.3)) + 4 }); if (alive(dockWin)) dockWin.webContents.send('prefs', { autohide: autoHide(), previews: ctx.settings().macDockPreview !== false, anim: ctx.settings().macDockAnim || 'lively', hover: ctx.settings().macDockHover || 'normal' }); }
const winByH = new Map();
function deskOrder() { // masaüstlerinin sırası (kayıt defterinde birleşik GUID'ler)
  try {
    const o = require('child_process').execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops', '/v', 'VirtualDesktopIDs'], { windowsHide: true, encoding: 'utf8', timeout: 2000 });
    const m = /REG_BINARY\s+([0-9A-Fa-f]+)/.exec(o); if (!m) return [];
    const b = Buffer.from(m[1], 'hex'), r = [];
    for (let i = 0; i + 16 <= b.length; i += 16) { const g = b.subarray(i, i + 16), h = (n, l) => n.toString(16).padStart(l, '0'); r.push((h(g.readUInt32LE(0), 8) + '-' + h(g.readUInt16LE(4), 4) + '-' + h(g.readUInt16LE(6), 4) + '-' + g.subarray(8, 10).toString('hex') + '-' + g.subarray(10, 16).toString('hex')).toUpperCase()); }
    return r;
  } catch { return []; }
}
function curDesk() { // geçerli masaüstündeki pencerelerin çoğunluğunun kimliği
  const v = new Map(); let n = 0;
  for (const w of winByH.values()) { if (w.other) continue; const g = require('./vdesk').windowDesktop(w.hwnd); if (g) { v.set(g, (v.get(g) || 0) + 1); if (++n >= 6) break; } }
  return [...v.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || null;
}
function goActivate(h) { // başka masaüstündeki pencere: o masaüstüne Windows animasyonuyla git, sonra pencereyi öne al
  const w = winByH.get(String(h));
  if (!w || !w.other) return wl.activate(h);
  const ids = deskOrder(), ti = ids.indexOf(w.desk), ci = ids.indexOf(curDesk());
  if (ti < 0 || ci < 0 || ti === ci) return wl.activate(h);
  const dir = ti > ci ? 'right' : 'left', n = Math.abs(ti - ci); let i = 0;
  const step = () => { wl.deskKey(dir); if (++i < n) setTimeout(step, 120); else setTimeout(() => { wl.activate(h); setTimeout(poll, 250); }, 380); };
  step();
}
function poll() {
  if (!enabled()) return;
  if (tick++ % 2 === 0) { try { if (wl.taskbarVisible()) wl.showTaskbar(false); if (tick % 10 === 1 && !wl.getAutohide()) wl.setAutohide(true); } catch {} }
  if (tick % 40 === 1) pushTheme();
  const me = lc(process.execPath), all = wl.list(), g = new Map();
  winByH.clear(); for (const w of all) winByH.set(String(w.hwnd), w);
  for (const w of all) {
    const e = lc(w.exe), b = base(e);
    if (e === me || BLOCK.has(b)) continue;
    const frame = b === 'applicationframehost.exe', key = frame ? e + '#' + w.hwnd : e;
    let x = g.get(key); if (!x) { x = { key, exe: w.exe, iconExe: (frame && w.real) || w.exe, name: frame ? w.title : pretty(w.exe), pin: !frame, wins: [] }; g.set(key, x); }
    x.wins.push(w);
  }
  groups = g;
  fgNow = wl.foreground();
  const fgH = fgNow && String(fgNow.hwnd), fgE = fgNow && lc(fgNow.exe);
  const isActive = (x) => !!fgNow && (x.wins.some((w) => String(w.hwnd) === fgH) || (x.pin && x.key === fgE));

  order = order.filter((k) => g.has(k)); for (const k of g.keys()) if (!order.includes(k)) order.push(k);
  const pinList = pins(), seen = new Set(), out = [];
  const push = (key, exe, name, x, pinned) => {
    const ik = x && x.iconExe ? lc(x.iconExe) : key.replace(/#.*/, ''); // UWP pencereler gerçek uygulamalarına göre ayrı simge alır
    fetchIcon(ik, (x && x.iconExe) || exe, x && x.wins[0].hwnd);
    out.push({ key, name, icon: icons.get(ik) || '', pack: packed.has(ik), running: !!x, count: x ? x.wins.length : 0, active: !!x && isActive(x), minimized: !!x && x.wins.every((w) => w.minimized), pinned, wins: x ? x.wins.filter((w) => !w.other).slice(0, 5).map((w) => ({ h: String(w.hwnd), t: w.title, m: !!w.minimized })) : [] });
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
  if (tick % 40 === 1) { const bw = alive(dockWin) ? dockWin : alive(menuWin) ? menuWin : null, b = bw && dockBackdrop(); if (b) bw.webContents.send('macdock:bd', b); }
}

function openApp(p) { shell.openPath(p).then((err) => { if (err) ctx.log('Dock: açılamadı', p, err); }); }
function click(key) {
  const x = groups.get(key);
  if (!x) { const p = pins().find((q) => lc(q) === key); if (p) openApp(p); return; }
  const fgH = fgNow && String(fgNow.hwnd), act = items.find((i) => i.key === key);
  if (act && act.active) {
    const here = x.wins.filter((w) => !w.other);
    if (here.length > 1) { const i = here.findIndex((w) => String(w.hwnd) === fgH), n = here[(i + 1) % here.length]; wl.activate(n.hwnd); } // aynı uygulamanın sıradaki penceresi
    else wl.minimize(x.wins[0].hwnd);
  } else goActivate((x.wins.find((w) => !w.minimized && !w.other) || x.wins.find((w) => !w.other) || x.wins[0]).hwnd);
  setTimeout(poll, 150);
}
function contextMenu(key) {
  const x = groups.get(key), it = items.find((i) => i.key === key); if (!it) return;
  const t = [{ label: it.name, enabled: false }, { type: 'separator' }];
  if (x && x.wins.length > 1) { x.wins.slice(0, 12).forEach((w) => t.push({ label: (w.title.length > 48 ? w.title.slice(0, 47) + '…' : w.title), click: () => goActivate(w.hwnd) })); t.push({ type: 'separator' }); }
  const exe = x ? x.exe : pins().find((q) => lc(q) === key);
  if (x ? x.pin : true) {
    t.push(it.pinned ? { label: "Dock'tan kaldır", click: () => ctx.patch({ dockPins: pins().filter((q) => lc(q) !== key).join('\n') }) }
      : { label: "Dock'ta tut", click: () => ctx.patch({ dockPins: [...pins(), exe].join('\n') }) });
  }
  if (x) { if (exe && x.pin) t.push({ label: 'Yeni pencere aç', click: () => openApp(exe) }); t.push({ label: 'Kapat', click: () => x.wins.forEach((w) => wl.close(w.hwnd)) }); }
  else t.push({ label: 'Aç', click: () => openApp(exe) });
  if (dockWin instanceof NatWin) return openDockMenu(t, key);
  Menu.buildFromTemplate(t).popup({ window: alive(dockWin) && !(dockWin instanceof NatWin) ? dockWin : undefined });
}
const DOCK_ICONS = { "Dock'tan kaldır": '\uE77A', "Dock'ta tut": '\uE718', 'Yeni pencere aç': '\uE8A7', 'Kapat': '\uE711', 'Aç': '\uE8A5' };
function openDockMenu(t, key) { // Dock sağ tık menüsü: Windows menüsü yerine yerel panel (hızlı, üst menülerle aynı görünüm)
  const k = 'dockctx' + key;
  if (nPopKey === k) { natSend('pop', 'pop:close', true); nPopKey = ''; return; }
  popActs = new Map(); let n = 0;
  const data = t.map((e) => (e.type === 'separator' ? SEP : e.enabled === false ? { hd: true, label: e.label } : act('d' + ++n, e.label, e.click, { icon: DOCK_ICONS[e.label] || '' })));
  if (Date.now() - darkAt > 5000) { readDark(); darkAt = Date.now(); }
  const c = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  nPopKey = k;
  natSend('pop', 'pop:open', { items: data.map(toNative), key: k, dark: !!darkNow, ax: Math.round(c.x), ay: Math.round(c.y - 40 * (display().scaleFactor || 1)) });
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
      refreshCcPop();
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
  if (alive(menuWin)) { if (Date.now() - darkAt > 5000) { readDark(); darkAt = Date.now(); } menuWin.webContents.send('macmenu:target', { hwnd: target ? String(target.hwnd) : '0', dark: !!darkNow }); } // uygulamanın menüleri yerel katmanda okunur, üstteki panelde açılır
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
const keepIds = new Set(); // tıklayınca paneli kapatmayan satırlar (aç/kapa düğmeleri)
const act = (id, label, fn, o = {}) => { popActs.set(id, fn); if (o.keep) keepIds.add(id); return { id, label, ...o }; };
const SEP = { sep: true };
function confirmThen(msg, btn, fn) {
  dialog.showMessageBox({ type: 'question', buttons: ['İptal', btn], defaultId: 1, cancelId: 0, message: msg, noLink: true }).then((r) => { if (r.response === 1) fn(); });
}
function appleItems() {
  const run = (exe, args) => () => { try { spawn(exe, args, { windowsHide: true, stdio: 'ignore', detached: true }).unref(); } catch {} };
  return [
    act('about', 'Bu Bilgisayar Hakkında', () => shell.openExternal('ms-settings:about'), { icon: '\uE7F4' }),
    act('sets', 'Sistem Ayarları…', () => shell.openExternal('ms-settings:'), { icon: '\uE713' }),
    SEP,
    act('start', 'Başlat Menüsü', () => wl.startMenu(), { icon: '\uE80F' }),
    act('task', 'Uygulamayı Zorla Kapat…', run('taskmgr.exe', []), { icon: '\uEA39' }),
    SEP,
    act('sleep', 'Uyku', run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']), { icon: '\uE708' }),
    act('restart', 'Yeniden Başlat…', () => confirmThen('Bilgisayar yeniden başlatılsın mı?', 'Yeniden Başlat', run('shutdown.exe', ['/r', '/t', '0'])), { icon: '\uE777' }),
    act('off', 'Kapat…', () => confirmThen('Bilgisayar kapatılsın mı?', 'Kapat', run('shutdown.exe', ['/s', '/t', '0'])), { icon: '\uE7E8' }),
    SEP,
    act('lock', 'Ekranı Kilitle', run('rundll32.exe', ['user32.dll,LockWorkStation']), { icon: '\uE72E' }),
    act('logout', 'Oturumu Kapat…', () => confirmThen('Oturum kapatılsın mı?', 'Oturumu Kapat', run('shutdown.exe', ['/l'])), { icon: '\uE77B' })
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
    ...g.wins.slice(0, 14).map((w, i) => act('w-' + i, w.title.length > 40 ? w.title.slice(0, 39) + '…' : w.title, () => goActivate(w.hwnd), { checked: String(w.hwnd) === String(t.hwnd) }))
  ];
}
let wifiCache = null;
function regWifi(d) { // ağ satırlarının eylemleri (önbellekten açılışta da gerekir)
  d.nets.forEach((n) => popActs.set(n.id, () => { if (n.current) return; if (n.known) spawn('netsh', ['wlan', 'connect', 'name=' + n.ssid], { windowsHide: true, stdio: 'ignore' }); else shell.openExternal('ms-settings:network-wifi'); }));
  popActs.set('settings', () => shell.openExternal('ms-settings:network-wifi'));
}
let wifiBusy = false;
function warmWifi(force) { if (wifiBusy || (!force && wifiCache && Date.now() - wifiCache.t < 20000)) return; wifiBusy = true; wifiData().catch(() => {}).finally(() => { wifiBusy = false; }); }
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
  const out = { current, nets: list }; regWifi(out); wifiCache = { t: Date.now(), d: out };
  return out;
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
let darkAt = 0;
const toNative = (it) => it.sep ? { sep: true } : it.media ? { media: true, label: it.label, sc: it.sc || '', value: it.value } : it.hd ? { hd: true, label: it.label } : it.slider ? { slider: true, id: it.id, icon: it.icon || '', value: it.value, ch: it.ch }
  : { id: it.id, label: it.label, icon: it.icon || '', ricon: it.ricon || '', checked: !!it.checked, dis: !!it.dis, keep: !!it.keep, img: it.img || '', rc: !!it.rc };
function ccItems() { // Denetim Merkezi: ses/parlaklık kaydırıcıları ve kısayollar
  const st = ccState(), run = (exe, args) => () => { try { spawn(exe, args, { windowsHide: true, stdio: 'ignore', detached: true }).unref(); } catch {} };
  const a = [{ slider: true, id: 'vol', icon: st.muted ? '\uE74F' : '\uE767', value: st.vol, ch: 'maccc:vol' }];
  if (st.bri != null) a.push({ slider: true, id: 'bri', icon: '\uE706', value: st.bri, ch: 'maccc:bri' });
  a.push(SEP,
    act('dark', 'Karanlık Mod', () => toggleDark(), { icon: '\uE790', checked: !!st.dark }),
    act('dnd', 'Rahatsız Etme', () => ctx.patch({ dnd: !ctx.settings().dnd }), { icon: '\uE708', checked: !!st.dnd }),
    act('mute', st.muted ? 'Sesi Aç' : 'Sesi Kapat', () => ccSend('mute'), { icon: '\uE74F' }),
    SEP,
    act('disp', 'Ekran Ayarları…', () => shell.openExternal('ms-settings:display'), { icon: '\uE7F4' }),
    act('snd', 'Ses Ayarları…', () => shell.openExternal('ms-settings:sound'), { icon: '\uE767' }),
    act('calc', 'Hesap Makinesi', run('calc.exe', []), { icon: '\uE8EF' }),
    act('clock', 'Saat', () => shell.openExternal('ms-clock:'), { icon: '\uE916' }),
    act('shot', 'Ekran Görüntüsü', () => shell.openExternal('ms-screenclip:'), { icon: '\uE722' }),
    SEP,
    act('dbset', 'Dynamic Bar Ayarları…', () => ctx.openSettings(), { icon: '\uE713' }));
  const m = ctx.media && ctx.media(); // çalan medya en altta: başlık, sanatçı ve önceki/oynat/sonraki
  if (m && !m.none && m.title) a.push(SEP, { media: true, label: m.title, sc: m.artist || '', value: /play/i.test(String(m.status || '')) ? 1 : 0 });
  return a;
}
function wifiItems(d) {
  const a = [{ hd: true, label: 'Wi‑Fi' }];
  if (!d) a.push({ id: 'load', label: 'Ağlar aranıyor…', dis: true });
  else if (!d.nets.length) a.push({ id: 'none', label: 'Ağ bulunamadı', dis: true });
  else d.nets.forEach((n) => a.push({ id: n.id, label: n.ssid, icon: '\uE701', checked: n.current, ricon: n.secured && !n.current ? '\uE72E' : '' }));
  const off = hsState === 'none';
  a.push(SEP, act('hs', hsBusy ? 'Mobil Erişim Noktası…' : off ? 'Mobil Erişim Noktası (kullanılamıyor)' : 'Mobil Erişim Noktası', () => { if (hsBusy || hsState === 'none') return; hsBusy = true; btSend('hs ' + (hsState === 'on' ? 'off' : 'on')); refreshPanes(); }, { icon: '\uE704', checked: hsState === 'on', dis: hsBusy || off, keep: true }),
    SEP, act('settings', 'Ağ Ayarları…', () => shell.openExternal('ms-settings:network-wifi'), { icon: '\uE713' }));
  return a;
}
// ---------- Bluetooth ve Mobil Erişim Noktası (scripts/bt.ps1, yalnızca paneller açılınca çalışır; boşta kapanır) ----------
let btProc = null, btState = null, btTmp = [], hsState = null, hsBusy = false, btIdleT = null; const btBusy = new Map();
function btStart() {
  if (btProc || !ctx.ps) return;
  try {
    btProc = ctx.ps('bt.ps1'); btProc.stdin.on('error', () => {});
    ctx.lines(btProc, (l) => {
      if (l.startsWith('bt|')) { const p = l.split('|'); btTmp.push({ addr: p[1], conn: p[2] === '1', cls: +p[3] || 0, name: p.slice(4).join('|') }); return; }
      if (l === 'btend') { btState = btTmp; btTmp = []; } else if (l === 'btnone') { btState = []; btTmp = []; }
      else if (l.startsWith('hs ')) { hsState = l.slice(3); hsBusy = false; }
      else if (l.startsWith('btc ')) { btBusy.clear(); [1500, 4500].forEach((t) => setTimeout(() => btSend('bt'), t)); }
      else if (l.startsWith('err ')) { ctx.log('bt.ps1', l); btBusy.clear(); hsBusy = false; }
      else return;
      refreshPanes();
    });
    btProc.on('exit', () => { btProc = null; btBusy.clear(); hsBusy = false; });
  } catch (e) { ctx.log('bt.ps1', e.message); btProc = null; }
}
function btSend(c) {
  btStart(); if (btProc && btProc.stdin.writable) { try { btProc.stdin.write(c + '\n'); } catch {} }
  clearTimeout(btIdleT); btIdleT = setTimeout(() => { try { btProc && btProc.kill(); } catch {} btProc = null; }, 150000);
}
const btGlyph = (c) => (c === 4 ? '\uE7F6' : c === 2 ? '\uE8EA' : c === 5 ? '\uE7FC' : '\uE702');
function btItems() {
  const a = [{ hd: true, label: 'Bluetooth' }];
  if (!btState) a.push({ id: 'bload', label: 'Cihazlar aranıyor…', dis: true });
  else if (!btState.length) a.push({ id: 'bnone', label: 'Eşleşmiş cihaz yok', dis: true });
  else btState.forEach((d, i) => { const busy = btBusy.has(d.addr); a.push(act('b' + i, busy ? d.name + (d.conn ? ' — ayrılıyor…' : ' — bağlanıyor…') : d.name, () => { if (btBusy.has(d.addr)) return; btBusy.set(d.addr, 1); btSend('btc ' + d.addr + ' ' + (d.conn ? 0 : 1)); refreshPanes(); }, { icon: btGlyph(d.cls), checked: d.conn, dis: busy, keep: true })); });
  a.push(SEP, act('bset', 'Bluetooth Ayarları…', () => shell.openExternal('ms-settings:bluetooth'), { icon: '\uE713' }));
  return a;
}
// ---------- Pil: güç modu ve pil tasarrufu (MacShell.exe --helper pwr, yalnızca panel açılınca çalışır) ----------
let pwrProc = null, pwrState = null, pwrBusy = false, pwrIdleT = null;
function pwrStart() {
  if (pwrProc || !ctx.ps) return;
  try {
    pwrProc = ctx.ps('pwr.ps1'); pwrProc.stdin.on('error', () => {});
    ctx.lines(pwrProc, (l) => {
      const p = l.split(' ');
      if (p[0] !== 'pwr') return;
      pwrState = { pct: +p[1], ac: p[2] === '1', secs: +p[3], mode: +p[4], saver: p[5] === '1' }; pwrBusy = false; refreshPanes();
    });
    pwrProc.on('exit', () => { pwrProc = null; pwrBusy = false; });
  } catch (e) { ctx.log('pwr', e.message); pwrProc = null; }
}
function pwrSend(c) {
  pwrStart(); if (pwrProc && pwrProc.stdin.writable) { try { pwrProc.stdin.write(c + '\n'); } catch {} }
  clearTimeout(pwrIdleT); pwrIdleT = setTimeout(() => { try { pwrProc && pwrProc.kill(); } catch {} pwrProc = null; }, 120000);
}
function batItems() {
  const s = pwrState, a = [{ hd: true, label: 'Pil' }];
  if (!s) return [...a, { id: 'pl', label: 'Okunuyor…', dis: true }];
  const left = s.secs > 0 ? Math.floor(s.secs / 3600) + ' sa ' + Math.round((s.secs % 3600) / 60) + ' dk kalan' : '';
  a.push({ id: 'pst', label: (s.pct >= 0 ? '%' + s.pct : 'Pil yok') + (s.ac ? ' · Şarjda / prizde' : ' · Pilde') + (!s.ac && left ? ' · ' + left : ''), dis: true });
  if (s.mode >= 0) {
    a.push(SEP, { hd: true, label: 'Güç modu' });
    ['En iyi güç verimliliği', 'Dengeli', 'En iyi performans'].forEach((n, i) => a.push(act('pm' + i, n, () => { if (pwrBusy) return; pwrBusy = true; pwrSend('mode ' + i); }, { checked: s.mode === i, keep: true, dis: pwrBusy })));
  }
  a.push(SEP, act('psv', s.ac ? 'Pil tasarrufu (pilde etkin olur)' : 'Pil tasarrufu', () => { if (pwrBusy) return; pwrBusy = true; pwrSend('saver ' + (s.saver ? 0 : 1)); }, { checked: s.saver, keep: true, dis: pwrBusy }),
    SEP, act('pset', 'Pil Ayarları…', () => shell.openExternal('ms-settings:batterysaver'), { icon: '\uE713' }));
  return a;
}
// ---------- Sistem tepsisi paneli (MacShell.exe --helper tray; yalnızca panel açılınca çalışır) ----------
let trProc = null, trList = null, trTmp = [], trIdleT = null;
function trStart() {
  if (trProc || !ctx.ps) return;
  try {
    trProc = ctx.ps('tray.ps1'); trProc.stdin.on('error', () => {});
    ctx.lines(trProc, (l) => {
      if (l.startsWith('tray|')) { const p = l.split('|'); trTmp.push({ exe: p[1], name: p.slice(2).join('|') }); return; }
      if (l !== 'trayend') return;
      trList = trTmp; trTmp = []; trList.forEach((t) => fetchIcon(lc(t.exe), t.exe)); refreshPanes(); setTimeout(refreshPanes, 500);
    });
    trProc.on('exit', () => { trProc = null; });
  } catch (e) { ctx.log('tray', e.message); trProc = null; }
}
function trSend(c) {
  trStart(); if (trProc && trProc.stdin.writable) { try { trProc.stdin.write(c + '\n'); } catch {} }
  clearTimeout(trIdleT); trIdleT = setTimeout(() => { try { trProc && trProc.kill(); } catch {} trProc = null; }, 90000);
}
const rcActs = new Map();
let trcProc = null, trcIdleT = null;
function trcStop() { // önce (varsa) ekran dışındaki gizli simgeler panelini kapat, sonra süreci bitir
  const p = trcProc; trcProc = null; clearTimeout(trcIdleT); if (!p) return;
  try { p.stdin.write('close' + String.fromCharCode(10)); } catch {}
  setTimeout(() => { try { p.kill(); } catch {} }, 700);
}
function trcStart() { // betik önceden başlatılır (PowerShell + UI Automation yüklemesi ~1 sn): sağ tık anında hazır bekler
  if (trcProc) return;
  try {
    trcProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ctx.unpacked(path.join(__dirname, 'scripts', 'trayclick.ps1'))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    ctx.lines(trcProc, (l) => { if (l !== 'ready') ctx.log('trayclick', l); });
    trcProc.stdin.on('error', () => {}); trcProc.on('error', () => {}); const me = trcProc; trcProc.on('exit', () => { if (trcProc === me) trcProc = null; });
  } catch (e) { ctx.log('tepsi sağ tık', e.message); trcProc = null; }
  clearTimeout(trcIdleT); trcIdleT = setTimeout(trcStop, 60000);
}
function trayContext(t) { // Windows'un gizli simgeler panelinde ilgili simgeye sağ tık: uygulamanın kendi menüsü imlecin olduğu yerde açılır
  const w = wl.list().find((x) => lc(x.exe) === lc(t.exe) && x.title);
  const names = [t.name, path.win32.basename(t.exe, '.exe'), w && w.title].filter(Boolean).join('|').replace(/\s+/g, ' ');
  trcStart(); try { trcProc.stdin.write(names + String.fromCharCode(10)); } catch {}
  clearTimeout(trcIdleT); trcIdleT = setTimeout(trcStop, 60000);
}
function trayOpen(t) { // uygulamanın penceresi varsa öne al, yoksa uygulamayı başlat (tepsi uygulamaları genelde mevcut örneği açar)
  const w = wl.list().filter((x) => lc(x.exe) === lc(t.exe) && x.title).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))[0];
  if (w) goActivate(w.hwnd); else shell.openPath(t.exe).catch(() => {});
}
function trayItems() {
  const a = [{ hd: true, label: 'Sistem tepsisi' }];
  if (!trList) return [...a, { id: 'trl', label: 'Okunuyor…', dis: true }];
  const list = trList.filter((t) => lc(t.exe) !== lc(process.execPath));
  if (!list.length) a.push({ id: 'trn', label: 'Tepsi uygulaması yok', dis: true });
  list.slice(0, 18).forEach((t, i) => { rcActs.set('t' + i, () => trayContext(t)); a.push(act('t' + i, t.name, () => trayOpen(t), { rc: true,  img: icons.get(lc(t.exe)) || '', icon: icons.get(lc(t.exe)) ? '' : '\uE71D' })); });
  a.push(SEP, act('twin', 'Windows gizli simgeler…', () => { try { natSend('menu', 'menu:tray', true); } catch {} }, { icon: '\uE713' }));
  return a;
}
function refreshPanes() {
  if (nPopKey.startsWith('bt')) natSend('pop', 'pop:update', { items: btItems().map(toNative) });
  else if (nPopKey.startsWith('bat')) natSend('pop', 'pop:update', { items: batItems().map(toNative) });
  else if (nPopKey.startsWith('tray')) natSend('pop', 'pop:update', { items: trayItems().map(toNative) });
  else if (nPopKey.startsWith('wifi')) natSend('pop', 'pop:update', { items: wifiItems(wifiCache ? wifiCache.d : null).map(toNative) });
}
let ccPopT = null;
function refreshCcPop() { if (nPopKey.startsWith('cc')) natSend('pop', 'pop:update', { items: ccItems().map(toNative) }); }
function openNativePop(kind, m) { // menüler, Wi‑Fi, Denetim Merkezi: yerel (C#) açılır panel, anında açılır
  const key = kind + (m.i ?? '') + (m.label || '');
  if (nPopKey === key) { natSend('pop', 'pop:close', true); nPopKey = ''; return; }
  if (nPopKey === '' && lastKey === key && Date.now() - popHiddenAt < 300) return; // paneli kapatan tıklama onu yeniden açmasın
  lastKey = key; popActs = new Map();
  let data;
  if (kind === 'apple') data = appleItems(); else if (kind === 'app') data = appItems(); else if (kind === 'win') data = windowItems();
  else if (kind === 'cc') { ccStart(); ccSend('get'); data = ccItems(); clearInterval(ccPopT); ccPopT = setInterval(() => { if (nPopKey.startsWith('cc')) refreshCcPop(); else clearInterval(ccPopT); }, 1500); }
  else if (kind === 'bt') { data = btItems(); btSend('bt'); }
  else if (kind === 'bat') { data = batItems(); pwrSend('get'); }
  else if (kind === 'tray') { data = trayItems(); trSend('list'); trcStart(); }
  else { // önbellekteki liste anında gösterilir, arkadan yenilenir
    btSend('hs'); if (wifiCache) regWifi(wifiCache.d);
    data = wifiItems(wifiCache ? wifiCache.d : null);
    wifiBusy = true; wifiData().then((d) => { if (nPopKey === key) natSend('pop', 'pop:update', { items: wifiItems(d).map(toNative) }); }).catch(() => {}).finally(() => { wifiBusy = false; });
  }
  if (Date.now() - darkAt > 5000) { readDark(); darkAt = Date.now(); }
  nPopKey = key; natSend('pop', 'pop:open', { items: data.map(toNative), key, dark: !!(kind === 'cc' ? ccState().dark : darkNow), x: m.x, w: m.w, right: kind === 'wifi' || kind === 'cc' || kind === 'bt' || kind === 'bat' || kind === 'tray' });
}
async function openPop(kind, m) {
  if (['apple', 'app', 'win', 'wifi', 'bt', 'bat', 'tray', 'cc'].includes(kind) && menuWin instanceof NatWin) { try { return openNativePop(kind, m); } catch (e) { ctx.log('yerel panel', e.stack || e.message); return; } }
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
  if (!wifiTimer) { wifiTimer = setInterval(() => warmWifi(true), 45000); setTimeout(() => warmWifi(true), 3000); }
  pushTheme(); pushPrefs();
  if (alive(popWin)) popWin.webContents.send('maccc:state', ccState());
}
function stop() {
  if (wifiTimer) { clearInterval(wifiTimer); wifiTimer = null; }
  try { natSend('pop', 'pop:close', true); } catch {}
  if (timer) { clearInterval(timer); timer = null; }
  if (peekT) { clearInterval(peekT); peekT = null; } manHide = false; peek = ''; hiddenFs = fsHide;
  [menuWin, dockWin, popWin].forEach((w) => { if (alive(w)) w.destroy(); }); menuWin = dockWin = popWin = null; popReady = false; pop = null;
  trcStop(); [ccProc, menusProc, btProc, pwrProc].forEach((p) => { if (p) { try { p.kill(); } catch {} } }); ccProc = menusProc = btProc = pwrProc = null; clearTimeout(btIdleT); menusReady = false;
  target = null; menuSig = '';
  menuBar.remove(); dockBar.remove();
  restoreTaskbar();
  sig = activeSig = themeSig = '';
}
function setFullscreen(v) {
  v = !!v; if (v === fsHide) return; fsHide = v; hiddenFs = fsHide || manHide;
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
  ipcMain.on('macmenu:ready', () => { themeSig = ''; pushTheme(); menuSig = ''; pushMenus(); pushPrefs(); const b = dockBackdrop(); if (b && alive(menuWin)) menuWin.webContents.send('macdock:bd', b); });
  ipcMain.on('macpop:ract', (_e, id) => { nPopKey = ''; const f = rcActs.get(id); if (f) setTimeout(() => { try { f(); } catch (e) { ctx.log('sağ tık eylemi', e.message); } }, 120); });
  ipcMain.on('macpop:nact', (_e, id) => { if (keepIds.has(id)) { const f = popActs.get(id); if (f) try { f(); } catch (e) { ctx.log('menü eylemi', e.message); } return; } nPopKey = ''; const fn = popActs.get(id); if (fn) setTimeout(() => { try { fn(); } catch (e) { ctx.log('menü eylemi', e.message); } }, 80); });
  ipcMain.on('macpop:nclosed', () => { nPopKey = ''; popHiddenAt = Date.now(); clearInterval(ccPopT); });
  ipcMain.on('maccc:media', () => setTimeout(refreshCcPop, 500));
  ipcMain.on('macdock:win', (_e, h) => { const n = Number(h); if (Number.isFinite(n)) { goActivate(n); setTimeout(poll, 150); } });
  ipcMain.on('macdock:unpin', (_e, k) => { if (typeof k === 'string') ctx.patch({ dockPins: pins().filter((q) => lc(q) !== k).join('\n') }); });
  ipcMain.on('macdock:reorder', (_e, keys) => {
    if (!Array.isArray(keys)) return;
    const pm = new Map(pins().map((p) => [lc(p), p])), np = keys.filter((k) => pm.has(k)).map((k) => pm.get(k));
    for (const [k, p] of pm) if (!keys.includes(k)) np.push(p);
    order = [...keys.filter((k) => !pm.has(k) && groups.has(k)), ...order.filter((k) => !keys.includes(k))];
    sig = ''; ctx.patch({ dockPins: np.join('\n') }); setTimeout(poll, 50);
  });
  ipcMain.on('macdock:ready', () => { pushPrefs(); sig = ''; const b = dockBackdrop(); if (b && alive(dockWin)) dockWin.webContents.send('macdock:bd', b); });
  ipcMain.on('macmenu:hover', () => { warmBackdrop(); warmWifi(); });
  ipcMain.on('macmenu:panel', () => ctx.panel());
  ipcMain.on('macmenu:open', (_e, m) => {
    if (!m || typeof m.kind !== 'string') return;
    if (m.kind === 'uia') { if (target && Number.isInteger(m.i)) menusSend('open ' + target.hwnd + ' ' + m.i); return; }
    if (['apple', 'app', 'win', 'wifi', 'bt', 'bat', 'tray', 'cc'].includes(m.kind)) openPop(m.kind, { x: +m.x || 0, w: +m.w || 0, i: m.i, label: String(m.label || '') });
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

module.exports = { init, apply, stop, setFullscreen, toggleBars, reassert, onWorkspaceSwitch, menuActive: () => enabled() && wantMenu() && !hiddenFs };
