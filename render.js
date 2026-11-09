// Video render durumu: DaVinci Resolve (ve en iyi çabayla Premiere Pro, Media Encoder, CapCut) render alırken maskot montaj yapar, barda gerçek ilerleme ve kalan süre görünür.
// Okuma işini scripts/render.ps1 yapar (Resolve'un ilerleme penceresi). Süre ya da bilgisayar hızı varsayılmaz: yüzde ve kalan süre Resolve'dan gelir.
const KEY = 'render';
const GRACE = 2500; // pencere bir an bulunamazsa (UI Automation tıkanması) render bitti sayılmaz
let ctx, proc = null, stopped = false, active = false, startedAt = 0, lastPct = 0, endT = null, appName = 'DaVinci Resolve';

const pad = (n) => String(n).padStart(2, '0');
const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

function begin(pct, rem, fps, app) {
  clearTimeout(endT); endT = null;
  if (app) appName = app;
  if (!active) { active = true; startedAt = Date.now(); }
  lastPct = pct;
  // Render başında Resolve kısa süre 00:00:00 gösterir: bu gerçek bir "kalan süre" değil, yazmayız
  const left = rem && rem !== '00:00:00' ? ` · kalan ${rem}` : pct < 2 ? ' · hazırlanıyor' : '';
  ctx.send({
    title: `Render · %${pct}`, text: `${appName}${left}${fps ? ` · ${fps} fps` : ''}`, icon: '🎬',
    mood: 'render', key: KEY, progress: Math.min(1, Math.max(0, pct / 100)), ttl: 20,
  });
}

function finish() {
  endT = null;
  if (!active) return;
  active = false;
  ctx.dismiss(KEY);
  // Pencere %90'dan sonra kapandıysa render bitti; daha önce kapandıysa kullanıcı iptal etti, bildirim gösterme
  if (lastPct >= 90) {
    setTimeout(() => ctx.send({
      title: 'Render tamamlandı', text: `${appName} · ${dur(Date.now() - startedAt)}`, icon: '🎉',
      mood: 'party', key: 'render-done', ttl: 6, force: true,
    }), 350);
  }
}

function onLine(l) {
  if (ctx.settings().renderLive === false) { if (active) { active = false; ctx.dismiss(KEY); } return; }
  if (l.startsWith('R|')) {
    const [, pct, rem, fps, app] = l.split('|');
    if (isFinite(+pct)) begin(Math.round(+pct), rem, fps, app);
  } else if (l === 'N' && active && !endT) {
    endT = setTimeout(finish, GRACE);
  }
}

// render.ps1 (~90 MB) yalnızca izlenen bir montaj programı açıkken çalışır: 6 sn'de bir hafif bir süreç listesi bakışı yapılır
const WATCHED = ['resolve.exe', 'adobe premiere pro.exe', 'adobe media encoder.exe', 'capcut.exe'];
let scanT = null, absent = 0;
function anyRunning(cb) {
  require('child_process').execFile('tasklist', ['/NH', '/FO', 'CSV'], { windowsHide: true, maxBuffer: 1 << 22 }, (e, out) => {
    if (e) return cb(true); // emin olunamazsa çalışsın
    const s = String(out).toLowerCase(); cb(WATCHED.some((n) => s.includes('"' + n + '"')));
  });
}
function spawnProc() {
  if (proc) return;
  proc = ctx.ps('render.ps1');
  ctx.lines(proc, onLine);
  proc.on('exit', () => { proc = null; });
}
function scan() {
  if (stopped) return;
  anyRunning((on) => {
    if (stopped) return;
    if (on) { absent = 0; spawnProc(); }
    else if (proc && !active && ++absent >= 5) { try { proc.kill(); } catch {} proc = null; absent = 0; } // ~30 sn yok: kapat
  });
}
function start() {
  if (process.platform !== 'win32' || scanT) return;
  scan(); scanT = setInterval(scan, 6000);
}

function init(c) { ctx = c; stopped = false; start(); }
function stop() { stopped = true; clearTimeout(endT); clearInterval(scanT); scanT = null; if (proc) proc.kill(); }

module.exports = { init, stop };
