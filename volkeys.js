// Ses tuşlarını (artır, azalt, sessiz) Windows görmeden yakalar ve sesi kendisi değiştirir; böylece Windows'un kendi ses göstergesi
// açılmaz, gösterge yalnızca barda çıkar. Düşük seviyeli klavye kancası (WH_KEYBOARD_LL) kullanır.
// Güvenlik: yardımcı süreç (scripts/volctl.ps1) hazır olmadan tuşa dokunulmaz; her hatada tuş Windows'a bırakılır.
const KEYS = { 0xAE: 'down', 0xAF: 'up', 0xAD: 'mute' };
let K, hook = null, cb = null, helper = null, ready = false, api = null;

function load() {
  if (api || process.platform !== 'win32') return api;
  try {
    K = require('koffi');
    const u = K.load('user32.dll'), k = K.load('kernel32.dll');
    api = {
      KBD: K.struct('DB_KBDLL', { vk: 'uint32', scan: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' }),
      Proc: K.proto('intptr_t __stdcall DB_KbdProc(int code, uintptr_t w, void *l)'),
      set: u.func('void *__stdcall SetWindowsHookExW(int id, DB_KbdProc *fn, void *mod, uint32_t tid)'),
      unset: u.func('bool __stdcall UnhookWindowsHookEx(void *h)'),
      next: u.func('intptr_t __stdcall CallNextHookEx(void *h, int code, uintptr_t w, void *l)'),
      mod: k.func('void *__stdcall GetModuleHandleW(const char16_t *n)')
    };
  } catch { api = null; }
  return api;
}

function onKey(code, w, l) {
  try {
    if (code === 0 && ready && helper) {
      const e = K.decode(l, api.KBD), act = KEYS[e.vk];
      if (act) {
        if (w === 0x100 || w === 0x104) helper.stdin.write(act + '\n'); // tuş basılı kalınca tekrar eder: her olay bir adım
        return 1; // tuş yukarı olayları da yutulur
      }
    }
  } catch {}
  try { return api.next(hook, code, w, l); } catch { return 0; }
}

// ps: scripts/volctl.ps1'i başlatan işlev (main.js'teki ps). Kanca yalnızca yardımcı "ready" yazınca kurulur.
function start(ps) {
  if (helper || hook || !load()) return false;
  const p = ps('volctl.ps1'); helper = p; ready = false;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; if (ready || !/ready/.test(buf)) return;
    ready = true;
    try {
      cb = K.register(onKey, K.pointer(api.Proc));
      hook = api.set(13, cb, api.mod(null), 0);
      if (!hook) { K.unregister(cb); cb = null; ready = false; }
    } catch { ready = false; }
  });
  p.on('error', () => stop());
  p.on('exit', () => { if (helper === p) stop(); });
  return true;
}

function stop() {
  ready = false;
  try { if (hook) api.unset(hook); } catch {}
  try { if (cb) K.unregister(cb); } catch {}
  hook = null; cb = null;
  const p = helper; helper = null;
  try { if (p) p.kill(); } catch {}
}

module.exports = { start, stop, active: () => !!hook };
