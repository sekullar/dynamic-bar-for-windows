// Ana süreç eklentileri: sistem istatistiği, pano, takvim, ses/parlaklık OSD, ekran seçimi, otomatik başlatma, WebSocket
const { clipboard, screen, app, ipcMain, shell } = require('electron');
const os = require('os'), crypto = require('crypto'), fs = require('fs'), path = require('path');
let ctx, clips = [], lastClip = '', events = [], notified = new Set(), procs = {}, seen = {}, lastCpu = os.cpus(), lastCal = null, lastWx = null, weather = null, lx = -1, ly = -1, rates = null, lastRates = null, recentList = [];
const S = () => ctx.settings();
const toWin = (ch, d) => { const w = ctx.win(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };

function sys() {
  if (!S().pageSystem) return;
  const c = os.cpus(); let idle = 0, total = 0;
  c.forEach((x, i) => { for (const k in x.times) total += x.times[k] - lastCpu[i].times[k]; idle += x.times.idle - lastCpu[i].times.idle; });
  lastCpu = c;
  toWin('sys', { cpu: total ? Math.round(100 * (1 - idle / total)) : 0, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())) });
}

function clip() { // yalnızca bellekte tutulur, diske yazılmaz
  if (!S().pageClipboard) return;
  const t = clipboard.readText();
  if (t && t !== lastClip) { lastClip = t; clips = [t, ...clips.filter((x) => x !== t)].slice(0, 8); toWin('clip', clips); }
}

const icsDate = (v) => {
  const m = v && /(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?/.exec(v); if (!m) return null;
  const n = m.slice(1, 7).map((x) => +x || 0);
  return m[7] ? new Date(Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4], n[5])) : new Date(n[0], n[1] - 1, n[2], n[3], n[4], n[5]);
};
const pick = (lines, k) => { const l = lines.find((x) => x.startsWith(k + ':') || x.startsWith(k + ';')); return l ? l.slice(l.indexOf(':') + 1).trim() : null; };

function nextStart(start, rr) { // basit RRULE: yalnızca günlük/haftalık (INTERVAL ve UNTIL ile); BYDAY listeleri yok sayılır
  if (!start || !rr) return start;
  const f = /FREQ=(\w+)/.exec(rr), step = { DAILY: 1, WEEKLY: 7 }[f && f[1]]; if (!step) return start;
  const iv = +((/INTERVAL=(\d+)/.exec(rr) || [])[1] || 1), un = /UNTIL=([0-9TZ]+)/.exec(rr), d = step * iv * 864e5, now = Date.now() - 60000;
  if (start.getTime() < now) start = new Date(start.getTime() + Math.ceil((now - start.getTime()) / d) * d);
  return un && icsDate(un[1]) && start > icsDate(un[1]) ? null : start;
}
async function loadCalendar() { // basit ICS okuyucu
  const s = S(); events = [];
  if (s.pageCalendar && /^(https?|webcal):/.test(s.icsUrl || '')) {
    try {
      const txt = (await (await fetch(s.icsUrl.replace(/^webcal:/, 'https:'))).text()).replace(/\r?\n[ \t]/g, '');
      events = txt.split('BEGIN:VEVENT').slice(1).map((b) => {
        const l = b.split(/\r?\n/), s0 = icsDate(pick(l, 'DTSTART')), e0 = icsDate(pick(l, 'DTEND')), dur = s0 && e0 && e0 > s0 ? Math.min(e0 - s0, 36e5 * 48) : 36e5;
        return { title: pick(l, 'SUMMARY') || '(başlıksız)', start: nextStart(s0, pick(l, 'RRULE')), dur };
      })
        .filter((e) => e.start && e.start.getTime() + e.dur > Date.now() - 60000).sort((a, b) => a.start - b.start).slice(0, 5)
        .map((e) => ({ title: e.title, start: e.start.getTime(), end: e.start.getTime() + e.dur }));
    } catch {}
  }
  toWin('cal', events);
}
function calTick() {
  if (!S().pageCalendar) return ctx.meeting && ctx.meeting(null);
  const now = Date.now(), cur = events.find((e) => e.start <= now && now < e.end && e.end - e.start >= 5 * 60000 && e.end - e.start < 12 * 36e5); // tüm gün etkinlikleri toplantı sayılmaz
  if (ctx.meeting) ctx.meeting(cur ? cur.title : null);
  events.forEach((e) => {
    const mins = (e.start - Date.now()) / 60000, id = e.start + e.title;
    if (mins > 0 && mins <= 5 && !notified.has(id)) { notified.add(id); ctx.send({ title: e.title, text: Math.ceil(mins) + ' dk sonra', mood: 'alert', ttl: 6 }); }
  });
}

function osd(l) { // "vol 45 0" | "bri 60": ilk değer gösterilmez, sonraki değişiklikler gösterilir
  const [k, a, b] = l.split(' '), v = +a, m = b === '1', sig = v + '|' + m;
  if (!(k in seen)) { seen[k] = sig; return; }
  if (seen[k] === sig) return; seen[k] = sig;
  if (k === 'vol') ctx.send({ key: 'osd-vol', title: m ? 'Ses kapalı' : 'Ses', text: m ? '' : v + '%', progress: m ? 0 : v / 100, ttl: 1.6, mood: 'happy' });
  else if (k === 'bri') ctx.send({ key: 'osd-bri', title: 'Parlaklık', text: v + '%', progress: v / 100, ttl: 1.6, mood: 'happy' });
}

function place() {
  const w = ctx.win(); if (!w || w.isDestroyed()) return;
  const d = screen.getAllDisplays()[S().display] || screen.getPrimaryDisplay(), b = w.getBounds();
  w.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - b.width) / 2), y: d.bounds.y, width: b.width, height: b.height });
}

function apply() {
  const s = S();
  if (!s.pageClipboard) clips = [];
  try { app.setLoginItemSettings(app.isPackaged ? { openAtLogin: !!s.autostart } : { openAtLogin: !!s.autostart, path: process.execPath, args: [app.getAppPath()] }); } catch {}
  place();
  const win32 = process.platform === 'win32';
  if (!s.osd) seen = {};
  sync('vol', 'volume.ps1', s.osd && win32, osd);
  sync('net', 'net.ps1', s.pageSystem && win32, (l) => { const [, d, u] = l.split(' '); toWin('net', { down: +d, up: +u }); });
  const key = s.pageCalendar + '|' + s.icsUrl;
  if (key !== lastCal) { lastCal = key; loadCalendar(); }
  const wk = s.pageWeather + '|' + s.city + '|' + s.tempUnit; if (wk !== lastWx) { lastWx = wk; loadWeather(); }
  const rk = s.pageRates + '|' + s.rates + '|' + s.rateBase; if (rk !== lastRates) { lastRates = rk; loadRates(); }
}

// Minimal WebSocket sunucusu (ws://127.0.0.1:47800): her metin mesajı bir JSON bildirimidir
function attachWs(server) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!ctx || !S().api || !key || req.headers.origin || !ctx.allowReq(req)) return socket.destroy(); // web siteleri bağlanamasın; anahtar ve Host denetimi
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, masked = buf[1] & 128; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) return socket.destroy();
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4;
        const p = Buffer.from(buf.slice(off, off + len)); if (mask) for (let i = 0; i < len; i++) p[i] ^= mask[i % 4];
        buf = buf.slice(off + len);
        if (op === 8) return socket.end();
        if (op === 9) socket.write(Buffer.from([0x8a, 0])); // ping -> pong
        if (op === 1) { try { ctx.ws(JSON.parse(p.toString())); } catch {} }
      }
    });
    socket.on('error', () => {});
  });
}

function sync(name, file, want, handler) { // arka plan PowerShell süreçlerini ayara göre başlat/durdur
  if (want && !procs[name]) { const p = ctx.ps(file); procs[name] = p; ctx.lines(p, handler); p.on('exit', () => { if (procs[name] === p) procs[name] = null; }); }
  else if (!want && procs[name]) { const p = procs[name]; procs[name] = null; p.kill(); }
}
const wxIcon = (c) => (c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : c <= 86 ? '❄️' : '⛈️');
async function loadWeather() { // Open-Meteo: anahtar gerektirmez
  const s = S(); weather = null;
  if (s.pageWeather && s.city) {
    try {
      const g = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=tr&name=' + encodeURIComponent(s.city))).json();
      const p = g.results && g.results[0];
      if (p) {
        const w = (await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto&temperature_unit=${s.tempUnit === 'f' ? 'fahrenheit' : 'celsius'}`)).json()).current;
        weather = { unit: s.tempUnit === 'f' ? 'F' : 'C', city: p.name, temp: Math.round(w.temperature_2m), feels: Math.round(w.apparent_temperature), wind: Math.round(w.wind_speed_10m), icon: wxIcon(w.weather_code) };
      }
    } catch {}
  }
  toWin('weather', weather);
}
async function loadRates() { // open.er-api.com: anahtarsız; 1 birim yabancı para = kaç rateBase
  const s = S(); rates = null;
  if (s.pageRates) {
    try {
      const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) })).json();
      const r = j.rates, base = String(s.rateBase || 'TRY').toUpperCase();
      if (r && r[base]) {
        const list = String(s.rates || '').split(/[,\s]+/).map((c) => c.toUpperCase()).filter((c) => r[c] && c !== base).slice(0, 3).map((c) => ({ code: c, value: r[base] / r[c] }));
        rates = { base, at: Date.now(), list };
      }
    } catch {}
  }
  toWin('rates', rates);
}
function recent() { // Windows "Son kullanılanlar" klasöründen son dosya ve klasörler (yalnızca ad okunur)
  if (process.platform !== 'win32' || !process.env.APPDATA) return [];
  try {
    const dir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Recent'), out = [], seenT = new Set();
    const files = fs.readdirSync(dir).filter((f) => /\.lnk$/i.test(f)).map((f) => { const p = path.join(dir, f); return { p, m: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.m - a.m);
    for (const f of files) {
      try { const t = shell.readShortcutLink(f.p).target; if (t && !seenT.has(t) && fs.existsSync(t)) { seenT.add(t); out.push({ name: path.basename(t), target: t }); } } catch {}
      if (out.length >= 4) break;
    }
    return out;
  } catch { return []; }
}
function cursor() { // imleç konumu: gözler için ve panelin otomatik kapanması için (her zaman gönderilir)
  const w = ctx.win(); if (!w || w.isDestroyed() || !w.isVisible()) return;
  const p = screen.getCursorScreenPoint(), b = w.getBounds(), x = p.x - b.x, y = p.y - b.y;
  if (x !== lx || y !== ly) { lx = x; ly = y; w.webContents.send('cursor', { x, y }); }
}
const shortcuts = () => String(S().shortcuts || '').split(/\r?\n/).map((l) => l.split('|')).filter((p) => p.length > 1 && p[0].trim() && p[1].trim()).map((p) => ({ name: p[0].trim(), target: p.slice(1).join('|').trim() })).slice(0, 4);

function init(c) {
  ctx = c;
  ipcMain.handle('clip:get', () => clips);
  ipcMain.handle('cal:get', () => events);
  ipcMain.handle('displays', () => screen.getAllDisplays().map((d, i) => [i, 'Ekran ' + (i + 1) + ' (' + d.bounds.width + '×' + d.bounds.height + ')']));
  ipcMain.on('clip:copy', (_e, i) => { if (clips[i]) { lastClip = clips[i]; clipboard.writeText(clips[i]); } });
  ipcMain.handle('weather:get', () => weather);
  ipcMain.handle('rates:get', () => rates);
  ipcMain.handle('recent:get', () => (recentList = recent()));
  ipcMain.on('recent:open', (_e, i) => { const r = recentList[i]; if (r) shell.openPath(r.target); });
  ipcMain.on('launch', (_e, i) => { const l = shortcuts()[i]; if (l) (/^https?:\/\//.test(l.target) ? shell.openExternal(l.target) : shell.openPath(l.target)); });
  setInterval(cursor, 90); setInterval(loadWeather, 900000); setInterval(loadRates, 900000);
  setInterval(sys, 2000); setInterval(clip, 1000); setInterval(calTick, 30000); setInterval(loadCalendar, 600000);
  apply();
}
module.exports = { init, apply, place, attachWs, stop: () => Object.values(procs).forEach((p) => p && p.kill()), _setCtx: (c) => (ctx = c) };
