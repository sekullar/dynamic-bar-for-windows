#!/usr/bin/env node
// Dynamic Bar komut satırı aracı. Ortam: DYNBAR_URL (varsayılan http://127.0.0.1:47800), DYNBAR_TOKEN (ayarlarda anahtar tanımlıysa)
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
// Ortam değişkeni yoksa Dynamic Bar'ın bağlantı dosyasından (~/.dynbar-ecosystem/dynamic-bar.json) port ve anahtar okunur
const LINK = (() => { try { const l = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.dynbar-ecosystem', 'dynamic-bar.json'), 'utf8')); return l && l.app === 'dynamic-bar' ? l : {}; } catch { return {}; } })();
const BASE = process.env.DYNBAR_URL || (LINK.port ? 'http://127.0.0.1:' + LINK.port : 'http://127.0.0.1:47800'), TOKEN = process.env.DYNBAR_TOKEN || LINK.token || '';
const BOOL = new Set(['force', 'sticky', 'high', 'remove', 'list']);
const argv = process.argv.slice(2), cmd = argv.shift(), pos = [], fl = {};
for (let i = 0; i < argv.length; i++) {
  const x = argv[i];
  if (x.startsWith('--')) { const k = x.slice(2); if (BOOL.has(k)) fl[k] = true; else fl[k] = argv[++i]; } else pos.push(x);
}

const USAGE = `kullanım:
  dynbar notify "metin" ["başlık"] [--mood happy|alert] [--ttl 4] [--icon 🔥] [--color #ff8800] [--url https://...] [--app ad] [--sticky] [--high] [--force]
  dynbar progress <anahtar> <0-1 veya yüzde> ["metin"] ["başlık"]
  dynbar run <komut ...>              komutu çalıştırır, bitince bildirir (başarılı/hata, süre)
  dynbar remind <10s|5m|1h> "metin" ["başlık"]
  dynbar dnd on|off|toggle
  dynbar panel open|close|toggle
  dynbar send <dosya|klasör ...> --to <hedef>   dosyaları kargoyla gönderir (API anahtarı gerekir)
  <komut> | dynbar send - --to <hedef> [--name log.txt]   standart girdiyi dosya olarak gönderir
  dynbar send --list                  hedefleri listeler
  dynbar search [open|close|toggle]   Spotlight aramasını adadan açar (Spotlight çalışıyor olmalı)
  dynbar dismiss [anahtar]
  dynbar todo add "metin" | done <sıra> | clear
  dynbar status
  dynbar setup-claude [--remove]      Claude Code hook'larını ~/.claude/settings.json dosyasına ekler (veya kaldırır)
  dynbar water                        su içme hatırlatıcısını hemen göster`;

async function call(method, route, body, timeout = 3000) {
  try {
    const r = await fetch(BASE + route, {
      method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout)
    });
    const t = await r.text();
    if (!r.ok) { console.error('hata ' + r.status + ': ' + t); return false; }
    return t;
  } catch { console.error('Dynamic Bar çalışmıyor'); return false; }
}
const post = (route, body) => call('POST', route, body || {});
const done = (r) => { if (r !== false) console.log(r); process.exit(r === false ? 1 : 0); };
const dur = (s) => { const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(s || ''); return m ? +m[1] * ({ s: 1, m: 60, h: 3600 }[m[2] || 'm']) : 0; };

(async () => {
  switch (cmd) {
    case 'notify': {
      if (!pos.length) { console.log(USAGE); process.exit(1); }
      const o = { text: pos[0], title: pos[1] || 'Bildirim' };
      for (const k of ['mood', 'icon', 'color', 'url', 'app', 'key']) if (fl[k]) o[k] = fl[k];
      if (fl.ttl) o.ttl = +fl.ttl; if (fl.progress) o.progress = +fl.progress;
      if (fl.sticky) o.sticky = true; if (fl.force) o.force = true; if (fl.high) o.priority = 'high';
      return done(await post('/notify', o));
    }
    case 'progress': {
      let v = +pos[1]; if (!pos[0] || !isFinite(v)) { console.log(USAGE); process.exit(1); } if (v > 1) v /= 100; v = Math.max(0, Math.min(1, v));
      return done(await post('/notify', { key: pos[0], progress: v, title: pos[3] || 'İlerleme', text: pos[2] || Math.round(v * 100) + '%', ttl: v >= 1 ? 2 : 4, mood: v >= 1 ? 'happy' : undefined, icon: v >= 1 ? '✅' : '⏳' }));
    }
    case 'run': {
      const args = process.argv.slice(3); if (!args.length) { console.log(USAGE); process.exit(1); }
      const t0 = Date.now(), name = args.join(' ').slice(0, 50);
      const child = spawn(args.join(' '), { shell: true, stdio: 'inherit' });
      child.on('exit', async (code) => {
        const s = Math.round((Date.now() - t0) / 1000), ok = code === 0, time = s >= 60 ? Math.floor(s / 60) + ' dk ' + (s % 60) + ' sn' : s + ' sn';
        await post('/notify', { title: ok ? 'Tamamlandı' : 'Hata (kod ' + code + ')', text: name + ' · ' + time, icon: ok ? '✅' : '❌', mood: ok ? (s >= 30 ? 'party' : 'happy') : 'sad', ttl: ok ? 5 : 8, app: 'dynbar run' });
        process.exit(code == null ? 1 : code);
      });
      return;
    }
    case 'remind': {
      const s = dur(pos[0]); if (!(s > 0) || !pos[1]) { console.log(USAGE); process.exit(1); }
      return done(await post('/remind', { seconds: s, text: pos[1], title: pos[2] || 'Hatırlatıcı' }));
    }
    case 'send': {
      if (fl.list) { const r = await call('GET', '/destinations'); if (r === false) process.exit(1); JSON.parse(r).forEach((d) => console.log(d.id + '	' + d.name)); process.exit(0); }
      if (!pos.length || !fl.to) { console.log(USAGE); process.exit(1); }
      let paths = pos.filter((p) => p !== '-').map((p) => path.resolve(p)), tmp = null;
      if (pos.includes('-')) { // standart girdi: geçici dosyaya yazılır, teslimattan sonra silinir
        const chunks = []; for await (const c of process.stdin) chunks.push(c);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynbar-')); tmp = dir;
        const name = path.basename(fl.name || 'cikti-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt');
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks)); paths.push(path.join(dir, name));
      }
      const r = await call('POST', '/send', { paths, to: fl.to, wait: true }, 600000);
      if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (r === false) process.exit(1);
      try { const j = JSON.parse(r); if (j.ok === false) { console.error('hata: ' + j.error); process.exit(1); } console.log(j.dest + ': ' + j.files + ' dosya teslim edildi' + (j.text ? ' (' + j.text + ')' : '')); } catch { console.log(r); }
      process.exit(0);
    }
    case 'dnd': return done(await post('/dnd', pos[0] === 'on' ? { on: true } : pos[0] === 'off' ? { on: false } : {}));
    case 'panel': return done(await post('/panel', { mode: pos[0] || 'toggle' }));
    case 'search': return done(await post('/search', { mode: pos[0] || 'toggle' }));
    case 'dismiss': return done(await post('/dismiss', pos[0] ? { key: pos[0] } : {}));
    case 'todo': {
      if (pos[0] === 'add' && pos[1]) return done(await post('/todo', { add: pos.slice(1).join(' ') }));
      if (pos[0] === 'done' && +pos[1] > 0) return done(await post('/todo', { toggle: +pos[1] - 1 }));
      if (pos[0] === 'clear') return done(await post('/todo', { clear: true }));
      console.log(USAGE); process.exit(1);
    }
    case 'water': return done(await post('/water'));
    case 'setup-claude': { // hook'ları mevcut ayarları bozmadan ekler/kaldırır, önce yedek alır
      const file = path.join(os.homedir(), '.claude', 'settings.json');
      const hook = path.join(__dirname, 'integrations', 'claude-code-hook.js').replace(/app.asar(?!.unpacked)/, 'app.asar.unpacked').split(path.sep).join('/');
      const command = 'node "' + hook + '"';
      let j = {};
      try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (fs.existsSync(file)) { console.error('settings.json okunamadı (geçersiz JSON?): ' + e.message); process.exit(1); } }
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.dynbar-yedek');
      j.hooks = j.hooks || {};
      const events = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop'];
      for (const ev of events) {
        const arr = (j.hooks[ev] = Array.isArray(j.hooks[ev]) ? j.hooks[ev] : []);
        const mine = (g) => JSON.stringify(g).includes('claude-code-hook.js');
        const rest = arr.filter((g) => !mine(g));
        j.hooks[ev] = fl.remove ? rest : [...rest, { hooks: [{ type: 'command', command }] }];
        if (!j.hooks[ev].length) delete j.hooks[ev];
      }
      if (!Object.keys(j.hooks).length) delete j.hooks;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(j, null, 2));
      console.log((fl.remove ? "Hook'lar kaldırıldı: " : "Hook'lar eklendi: ") + file + '\nYedek: ' + file + '.dynbar-yedek\nClaude Code oturumunu yeniden başlat.');
      process.exit(0);
    }
    case 'status': return done(await call('GET', '/status'));
    default: console.log(USAGE); process.exit(1);
  }
})();
