// İnternet bağlantısı izleyicisi: bağlantı gidince maskot üzülür ve kısa bir kart çıkar, geri gelince haber verir.
// Windows'un kendi bağlantı testi adresi kullanılır (captive portal'ı da ayırt eder). Uykudan dönüşte ağın toparlanması için kısa süre beklenir.
const URL = 'http://www.msftconnecttest.com/connecttest.txt', EXPECT = 'Microsoft Connect Test';
const EVERY = 8000, NEED = 2; // 2 ardışık başarısızlık (~16 sn) = kesinti
let ctx, timer = null, fails = 0, down = false, downAt = 0, grace = 0;

const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' dk ' + (s % 60) + ' sn' : s + ' sn'; };

async function probe() {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    return r.ok && (await r.text()).trim() === EXPECT;
  } catch { return false; }
}

async function tick() {
  if (ctx.settings().netAlert === false) { fails = 0; down = false; return; }
  if (Date.now() < grace) return;
  if (await probe()) {
    fails = 0;
    if (down) {
      down = false;
      ctx.send({ title: 'İnternet geri geldi', text: 'Kesinti ' + dur(Date.now() - downAt), icon: '🌐', mood: 'happy', key: 'net', ttl: 4 });
    }
  } else if (++fails >= NEED && !down) {
    down = true; downAt = Date.now() - EVERY * NEED;
    ctx.send({ title: 'İnternet gitti', text: 'Bağlantı yok', icon: '📡', mood: 'offline', key: 'net', ttl: 5 });
  }
}

function init(c) {
  ctx = c;
  if (ctx.onResume) ctx.onResume(() => { grace = Date.now() + 15000; fails = 0; }); // uykudan dönüşte yanlış alarm olmasın
  grace = Date.now() + 20000; // uygulama açılırken ağ henüz hazır olmayabilir
  timer = setInterval(tick, EVERY);
}
function stop() { clearInterval(timer); }

module.exports = { init, stop };
