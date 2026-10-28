// Mikrofon / kamera kullanım uyarısı: bir uygulama mikrofonu ya da kamerayı kullanmaya başlayınca adada kısa bir kart çıkar,
// maskot yalnızca o kart boyunca mikrofon / kamera / ikisi birden tutar. Okuma işini scripts/privacy.ps1 yapar (kayıt defteri, ses/görüntü alınmaz).
const KEY = 'privacy';
const NOISE = new Set(['rundll32', 'svchost', 'audiodg', 'searchhost', 'searchapp', 'cortana', 'speechruntime', 'shellexperiencehost', 'windows.immersivecontrolpanel', 'systemsettings']);
const SEED_MS = 2500; // uygulama açılırken zaten süren kullanımlar için uyarı verilmez
let ctx, proc = null, stopped = false, startedAt = 0, cur = { mic: new Set(), cam: new Set() }, fresh = { mic: new Set(), cam: new Set() }, batchT = null;

// "5319275A.WhatsAppDesktop" -> "WhatsApp Desktop", "chrome" -> "Chrome"
function pretty(n) {
  const last = String(n).split('.').pop() || n;
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}
const ok = (n) => n && !NOISE.has(String(n).toLowerCase().split('.').pop());

function show() {
  batchT = null;
  const mic = [...fresh.mic], cam = [...fresh.cam]; fresh = { mic: new Set(), cam: new Set() };
  if (!mic.length && !cam.length) return;
  const apps = [...new Set([...mic, ...cam])].map(pretty).slice(0, 3).join(', ');
  const both = mic.length && cam.length;
  ctx.send({
    title: both ? 'Mikrofon ve kamera açık' : mic.length ? 'Mikrofon kullanılıyor' : 'Kamera kullanılıyor',
    text: apps, icon: both ? '🎥' : mic.length ? '🎙️' : '📷',
    mood: both ? 'miccam' : mic.length ? 'mic' : 'cam', key: KEY, ttl: 4,
  });
}

function onLine(l) {
  const [t, m = '', c = ''] = l.split('|');
  const next = { mic: new Set(t === 'P' ? m.split(';').filter(ok) : []), cam: new Set(t === 'P' ? c.split(';').filter(ok) : []) };
  if (Date.now() - startedAt > SEED_MS && ctx.settings().privacyAlert !== false) {
    let any = false;
    for (const k of ['mic', 'cam']) for (const a of next[k]) if (!cur[k].has(a)) { fresh[k].add(a); any = true; }
    if (any && !batchT) batchT = setTimeout(show, 1200); // mikrofon ve kamera birlikte başlarsa tek kart
  }
  cur = next;
}

function start() {
  if (process.platform !== 'win32' || proc) return;
  startedAt = Date.now();
  proc = ctx.ps('privacy.ps1');
  ctx.lines(proc, onLine);
  proc.on('exit', () => { proc = null; if (!stopped) setTimeout(start, 5000); });
}
function init(c) { ctx = c; stopped = false; start(); }
function stop() { stopped = true; clearTimeout(batchT); if (proc) proc.kill(); }

module.exports = { init, stop, pretty };
