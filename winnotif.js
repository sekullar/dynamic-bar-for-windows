// Windows masaüstü bildirimlerini adaya taşır. Windows'un bildirim veritabanı (wpndatabase.db) salt okunur izlenir
// (MacShell.exe --helper notif). İsteğe bağlı: Windows'un sağ alttaki bildirim balonları kapatılır ("Rahatsız etme"
// düğmesiyle aynı kayıt defteri değeri); bildirimler Windows bildirim merkezine yine düşer, ada de bunları gösterir.
// Uygulama kapanınca ya da çökünce ilk açılışta özgün değer geri yüklenir.
const { spawn, execFile } = require('child_process');
const fs = require('fs'), path = require('path');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const REG_VAL = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED';
let ctx, proc = null, stopped = false, hidden = false, restartT = null;

const stateFile = () => path.join(ctx.userData(), 'winnotif-state.json');
const reg = (args, cb) => execFile('reg', args, { windowsHide: true }, cb || (() => {}));

// Görünen ad yoksa kimlikten türetilir: "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" -> "WhatsApp Desktop", "{GUID}\...\powershell.exe" -> "Powershell"
function pretty(pid, name) {
  if (name && name !== pid && !/[{}\!]/.test(name)) return name;
  let n = String(pid || name || 'Windows').split('!')[0].split(String.fromCharCode(92)).pop().replace(/\.exe$/i, '').split('_')[0];
  n = n.split('.').pop() || n;
  return n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function onLine(l) {
  if (!l || l[0] !== '{') return;
  let m; try { m = JSON.parse(l); } catch { return; }
  if (!m.title && !m.text) return;
  const app = pretty(m.pid, m.app);
  ctx.send({ title: (m.title || app).slice(0, 80), text: (m.text || '').slice(0, 200), icon: '🔔', app, ttl: 6 });
}

function startProc() {
  if (proc || stopped) return;
  const exe = ctx.helperPath && ctx.helperPath();
  if (!exe) { ctx.log('winnotif', 'MacShell.exe bulunamadı'); return; }
  proc = spawn(exe, ['--helper', 'notif'], { windowsHide: true });
  ctx.lines(proc, onLine);
  const me = proc;
  proc.on('exit', () => { if (proc === me) proc = null; if (!stopped && ctx.settings().winNotif) { clearTimeout(restartT); restartT = setTimeout(startProc, 5000); } });
}
function stopProc() { clearTimeout(restartT); if (proc) { const p = proc; proc = null; try { p.kill(); } catch {} } }

// ---- Windows balonlarını kapat / geri aç ----
function hideNative(on) {
  if (on === hidden) return; hidden = on;
  if (on) {
    reg(['query', REG_KEY, '/v', REG_VAL], (e, out) => {
      if (!hidden) return; // bu arada kapatıldı
      const m = !e && /REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(out));
      const orig = m ? parseInt(m[1], 16) : null; // null: değer yoktu (varsayılan: açık)
      if (!fs.existsSync(stateFile())) { try { fs.writeFileSync(stateFile(), JSON.stringify({ orig })); } catch {} }
      reg(['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_DWORD', '/d', '0', '/f']);
    });
  } else restoreNative();
}
function restoreNative() {
  let orig;
  try { orig = JSON.parse(fs.readFileSync(stateFile(), 'utf8')).orig; } catch { return; }
  if (orig === 0) { try { fs.unlinkSync(stateFile()); } catch {} return; } // kullanıcı zaten kapatmıştı: dokunma
  reg(orig == null ? ['delete', REG_KEY, '/v', REG_VAL, '/f'] : ['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_DWORD', '/d', String(orig), '/f']);
  try { fs.unlinkSync(stateFile()); } catch {}
}
// kapanırken eşzamanlı geri yükle (süreç hemen sonlanabilir)
function restoreSync() {
  let orig;
  try { orig = JSON.parse(fs.readFileSync(stateFile(), 'utf8')).orig; } catch { return; }
  try {
    if (orig === 0) { /* dokunma */ }
    else if (orig == null) require('child_process').execFileSync('reg', ['delete', REG_KEY, '/v', REG_VAL, '/f'], { windowsHide: true, timeout: 3000 });
    else require('child_process').execFileSync('reg', ['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_DWORD', '/d', String(orig), '/f'], { windowsHide: true, timeout: 3000 });
    fs.unlinkSync(stateFile());
  } catch {}
}

function apply() {
  if (!ctx || process.platform !== 'win32') return;
  const s = ctx.settings();
  if (s.winNotif) startProc(); else stopProc();
  hideNative(!!(s.winNotif && s.winNotifHide));
}
function init(c) {
  ctx = c; stopped = false;
  if (process.platform !== 'win32') return;
  restoreSync(); // önceki oturum geri yüklemeden kapandıysa (çökme) önce düzelt
  apply();
}
function stop() { stopped = true; stopProc(); if (hidden) { hidden = false; restoreSync(); } }

module.exports = { init, apply, stop, pretty };
