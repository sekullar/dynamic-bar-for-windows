// Windows masaüstü bildirimlerini adaya taşır. Windows'un bildirim veritabanı (wpndatabase.db) salt okunur izlenir
// (MacShell.exe --helper notif). İsteğe bağlı: Windows'un sağ üst/alttaki bildirim balonları kapatılır; bildirimler
// Windows bildirim merkezine yine düşer, ada da bunları gösterir.
// Balonlar uygulama bazlı "bildirim başlığı göster" (ShowBanner=0) ayarıyla kapatılır: bu Windows sürümünde genel
// "NOC_GLOBAL_SETTING_TOASTS_ENABLED" değeri balonları gizlemiyor, uygulama bazlı ayar ise anında çalışıyor.
// Özgün değerler winnotif-state.json'a yazılır; uygulama kapanınca ya da çökünce ilk açılışta geri yüklenir.
// Not: Açılışta ana iş parçacığını bloke etmemek için PowerShell kullanılmaz (bir PowerShell çağrısı ~1.5 sn sürer);
// yalnızca asenkron reg.exe çağrıları yapılır ve ilk iş açılıştan START_DELAY ms sonra başlar.
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const REG_PREFIX = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\'; // reg query çıktısındaki alt anahtar öneki
const REG_VAL = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'; // yalnızca eski sürümün bıraktığı değeri geri yüklemek için
const START_DELAY = 6000; // açılış yükü (pencereler, yardımcı süreçler) otursun, sonra başla
let ctx, proc = null, stopped = false, hidden = false, restartT = null, ready = false, startT = null;

const stateFile = () => path.join(ctx.userData(), 'winnotif-state.json');
const reg = (args, cb) => execFile('reg', args, { windowsHide: true }, cb || (() => {}));
const regP = (args) => new Promise((res) => execFile('reg', args, { windowsHide: true, maxBuffer: 1 << 22, encoding: 'utf8' }, (e, out) => res(e ? null : String(out))));
const sub = (name) => REG_KEY + String.fromCharCode(92) + name;

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
  hideApp(m.pid);
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
const readState = () => { try { const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
const seen = new Set(); // bu oturumda ShowBanner=0 yapılmış uygulamalar (bildirimle yeni gelenler için)

// Uygulama anahtarlarını listele (reg query çıktısı: her alt anahtar tam yolla bir satır)
async function listApps() {
  const out = await regP(['query', REG_KEY]); if (!out) return [];
  const names = [];
  for (const line of out.split(/\r?\n/)) { const t = line.trim(); if (t.toLowerCase().startsWith(REG_PREFIX.toLowerCase())) names.push(t.slice(REG_PREFIX.length)); }
  return names;
}
async function getBanner(name) { // ShowBanner değeri; yoksa -1
  const out = await regP(['query', sub(name), '/v', 'ShowBanner']);
  const m = out && /ShowBanner\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
  return m ? parseInt(m[1], 16) : -1;
}
// En çok 6 işi aynı anda yürüt
async function pool(items, fn, n = 6) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
// Tüm uygulamaların ShowBanner değerini kaydet (önceki oturumdan kalan özgün değerlere dokunma) ve 0 yap
async function hideAll() {
  const st = (readState() || {}).apps || {}, names = await listApps();
  await pool(names, async (name) => {
    const v = await getBanner(name);
    if (!(name in st)) st[name] = v;
    if (v !== 0) await regP(['add', sub(name), '/v', 'ShowBanner', '/t', 'REG_DWORD', '/d', '0', '/f']);
    seen.add(name);
  });
  try { fs.writeFileSync(stateFile(), JSON.stringify({ apps: st })); } catch (e) { ctx.log('winnotif durum yazılamadı', e.message); }
}
const restoreArgs = (name, v) => (v === -1 ? ['delete', sub(name), '/v', 'ShowBanner', '/f'] : ['add', sub(name), '/v', 'ShowBanner', '/t', 'REG_DWORD', '/d', String(v | 0), '/f']);
async function restoreAll() {
  const st = readState(); if (!st || !st.apps) return;
  await pool(Object.keys(st.apps), (name) => regP(restoreArgs(name, +st.apps[name])));
  try { fs.unlinkSync(stateFile()); } catch {}
}

function hideNative(on) {
  if (on === hidden) return; hidden = on;
  if (on) { seen.clear(); hideAll().catch((e) => ctx.log('winnotif balon gizleme', e.message)); }
  else restoreNative();
}
function restoreNative(cb) {
  if (!fs.existsSync(stateFile())) return cb && cb();
  restoreAll().catch(() => {}).then(() => cb && cb());
}
// kapanırken eşzamanlı geri yükle (süreç hemen sonlanabilir); reg.exe çağrıları kısa sürer
function restoreSync() {
  if (!fs.existsSync(stateFile())) return;
  try {
    const old = readState();
    if (old && old.apps) {
      for (const name of Object.keys(old.apps)) { try { execFileSync('reg', restoreArgs(name, +old.apps[name]), { windowsHide: true, timeout: 3000, stdio: 'ignore' }); } catch {} }
      fs.unlinkSync(stateFile());
    } else { // eski sürümün biçimi: genel değer
      const orig = old && old.orig;
      if (orig == null) execFileSync('reg', ['delete', REG_KEY, '/v', REG_VAL, '/f'], { windowsHide: true, timeout: 3000 });
      else if (orig !== 0) execFileSync('reg', ['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_DWORD', '/d', String(orig), '/f'], { windowsHide: true, timeout: 3000 });
      fs.unlinkSync(stateFile());
    }
  } catch {}
}
// kayıt defterinde henüz olmayan (ilk kez bildirim gönderen) uygulamanın balonunu da kapat; geri yüklemede anahtar yoksa dokunulmaz
function hideApp(id) {
  if (!hidden || !id || seen.has(id) || id.includes(String.fromCharCode(92))) return; seen.add(id);
  try { // özgün değer "yoktu" (-1) olarak kaydedilir ki kapatınca geri alınabilsin
    let st = { apps: {} }; try { st = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch {}
    st.apps = st.apps || {}; if (!(id in st.apps)) { st.apps[id] = -1; fs.writeFileSync(stateFile(), JSON.stringify(st)); }
  } catch {}
  reg(['add', sub(id), '/v', 'ShowBanner', '/t', 'REG_DWORD', '/d', '0', '/f']);
}

function apply() {
  if (!ctx || !ready || process.platform !== 'win32') return; // açılış gecikmesi bitene kadar bekle
  const s = ctx.settings();
  if (s.winNotif) startProc(); else stopProc();
  hideNative(!!(s.winNotif && s.winNotifHide));
}
function init(c) {
  ctx = c; stopped = false; ready = false;
  if (process.platform !== 'win32') return;
  // önceki oturum geri yüklemeden kapandıysa (çökme) önce düzelt; hepsi açılış yükünden sonra, ana iş parçacığını bloke etmeden
  startT = setTimeout(() => restoreNative(() => { if (stopped) return; ready = true; apply(); }), START_DELAY);
}
function stop() { stopped = true; clearTimeout(startT); stopProc(); if (hidden) { hidden = false; restoreSync(); } }

module.exports = { init, apply, stop, pretty };
