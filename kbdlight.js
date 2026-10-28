// Klavye ışığı geri bildirimi: olay olunca beyaz arka ışık kısa bir desenle yanıp söner, sonra eski parlaklığa döner.
// Şimdilik Lenovo Legion / LOQ (Legion Toolkit'in llt.exe komutu). Başka marka eklemek için PROVIDERS'a bir sağlayıcı yeterli.
const fs = require('fs'), path = require('path');
const { execFile } = require('child_process');

const FEATURE = 'white-keyboard-backlight'; // değerler: off, low, high
const LEVELS = ['off', 'low', 'high'];
// Her olay için: ayar anahtarı, parlaklık sırası, adımlar arası ek bekleme (llt çağrısı zaten ~165 ms sürer)
const PATTERNS = {
  call:    { key: 'kbdCall',    seq: ['off', 'high', 'off', 'high', 'off', 'high', 'off', 'high', 'off', 'high'], gap: 60 },
  render:  { key: 'kbdRender',  seq: ['low', 'high', 'low', 'high'], gap: 120 },
  timer:   { key: 'kbdTimer',   seq: ['off', 'high', 'off', 'high'], gap: 120 },
  battery: { key: 'kbdBattery', seq: ['off', 'low', 'off', 'low'], gap: 320 },
  notif:   { key: 'kbdNotif',   seq: ['low'], gap: 350, respectQuiet: true }
};

const legion = {
  name: 'Legion Toolkit',
  exe() {
    const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    return dirs.map((d) => path.join(d, 'LenovoLegionToolkit', 'llt.exe')).find((p) => fs.existsSync(p)) || '';
  },
  run(args) {
    const exe = this.exe();
    return new Promise((resolve) => {
      if (!exe) return resolve({ ok: false, why: 'missing' });
      execFile(exe, args, { windowsHide: true, timeout: 4000 }, (err, out, errOut) => {
        const msg = String(errOut || '') + String(out || '');
        if (!err) return resolve({ ok: true, out: String(out || '').trim() });
        resolve({ ok: false, why: /connect/i.test(msg) ? 'stopped' : /not supported|invalid feature/i.test(msg) ? 'unsupported' : 'error' });
      });
    });
  },
  get() { return this.run(['feature', 'get', FEATURE]); },
  set(v) { return this.run(['feature', 'set', FEATURE, v]); }
};
const PROVIDERS = [legion];

let ctx = { settings: () => ({}), muted: () => false };
let busy = false, failUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ayar sayfası için durum: ok | missing | stopped | unsupported | error */
async function status() {
  for (const p of PROVIDERS) { const r = await p.get(); if (r.ok) return LEVELS.includes(r.out) ? 'ok' : 'error'; if (r.why !== 'missing') return r.why; }
  return 'missing';
}

/** Olay deseni oynat. force: ayarlardaki anahtarlara bakma (deneme düğmesi). */
async function pulse(kind, force) {
  const pat = PATTERNS[kind], s = ctx.settings();
  if (!pat || busy || Date.now() < failUntil) return;
  if (!force && (!s.kbdLight || s[pat.key] === false)) return;
  if (!force && pat.respectQuiet && ctx.muted()) return;
  busy = true;
  let p = null, orig = '';
  try {
    for (const c of PROVIDERS) { const r = await c.get(); if (r.ok && LEVELS.includes(r.out)) { p = c; orig = r.out; break; } }
    if (!p) { failUntil = Date.now() + 30000; return; } // Toolkit yok/kapalı: sık sık denemeyelim
    try { for (const v of pat.seq) { await p.set(v); await sleep(pat.gap); } }
    finally { await p.set(orig); } // ne olursa olsun ışık eski haline döner
  } catch {} finally { busy = false; }
}

module.exports = { init: (c) => { ctx = { ...ctx, ...c }; }, pulse, status, kinds: Object.keys(PATTERNS) };
