// Windows masaüstü bildirimlerini adaya taşır. Windows'un bildirim veritabanı (wpndatabase.db) salt okunur izlenir
// (MacShell.exe --helper notif). İsteğe bağlı: Windows'un sağ üst/alttaki bildirim balonları kapatılır; bildirimler
// Windows bildirim merkezine yine düşer, ada da bunları gösterir.
// Balonlar uygulama bazlı "bildirim başlığı göster" (ShowBanner=0) ayarıyla kapatılır: bu Windows sürümünde genel
// "NOC_GLOBAL_SETTING_TOASTS_ENABLED" değeri balonları gizlemiyor, uygulama bazlı ayar ise anında çalışıyor.
// Özgün değerler winnotif-state.json'a yazılır; uygulama kapanınca ya da çökünce ilk açılışta geri yüklenir.
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const REG_VAL = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'; // yalnızca eski sürümün bıraktığı değeri geri yüklemek için
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
const SETTINGS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
// Tüm uygulamaların ShowBanner değerini kaydet (önceki oturumdan kalan özgün değerlere dokunma) ve 0 yap
const HIDE_PS = "$k='" + SETTINGS + "'; $f=$env:WN_STATE; $st=@{}; if(Test-Path $f){ try{ $j=Get-Content $f -Raw | ConvertFrom-Json; $j.apps.PSObject.Properties | ForEach-Object { $st[$_.Name]=[int]$_.Value } }catch{} }; " +
  "Get-ChildItem $k | ForEach-Object { $v=(Get-ItemProperty $_.PSPath).ShowBanner; if(-not $st.ContainsKey($_.PSChildName)){ $st[$_.PSChildName]= if($null -eq $v){-1}else{[int]$v} }; if($v -ne 0){ Set-ItemProperty $_.PSPath ShowBanner 0 -Type DWord } }; " +
  "[IO.File]::WriteAllText($f, (@{apps=$st} | ConvertTo-Json -Compress))";
const RESTORE_PS = "$k='" + SETTINGS + "'; $f=$env:WN_STATE; if(-not (Test-Path $f)){ return }; $j=Get-Content $f -Raw | ConvertFrom-Json; " +
  "$j.apps.PSObject.Properties | ForEach-Object { $p=$k+'\\'+$_.Name; if(Test-Path -LiteralPath $p){ if([int]$_.Value -eq -1){ Remove-ItemProperty -LiteralPath $p -Name ShowBanner -ErrorAction SilentlyContinue } else { Set-ItemProperty -LiteralPath $p -Name ShowBanner -Value ([int]$_.Value) -Type DWord } } }; Remove-Item $f -Force";
const psOpts = (extra) => ({ windowsHide: true, env: Object.assign({}, globalThis['process']['env'], { WN_STATE: stateFile() }), ...extra });
const seen = new Set(); // bu oturumda ShowBanner=0 yapılmış uygulamalar (bildirimle yeni gelenler için)

function hideNative(on) {
  if (on === hidden) return; hidden = on;
  if (on) { seen.clear(); execFile('powershell.exe', [...PS, HIDE_PS], psOpts(), (e, so, se) => { if (e || se) ctx.log('winnotif balon gizleme', e ? e.message : '', String(se).slice(0, 300)); }); }
  else restoreNative();
}
function restoreNative() {
  if (!fs.existsSync(stateFile())) return;
  execFile('powershell.exe', [...PS, RESTORE_PS], psOpts(), () => {});
}
// kapanırken eşzamanlı geri yükle (süreç hemen sonlanabilir)
function restoreSync() {
  if (!fs.existsSync(stateFile())) return;
  try {
    let old = null; try { old = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch {}
    if (old && old.apps) execFileSync('powershell.exe', [...PS, RESTORE_PS], psOpts({ timeout: 8000 }));
    else { // eski sürümün biçimi: genel değer
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
  reg(['add', REG_KEY + String.fromCharCode(92) + id, '/v', 'ShowBanner', '/t', 'REG_DWORD', '/d', '0', '/f']);
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
