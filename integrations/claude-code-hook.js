#!/usr/bin/env node
// Claude Code hook'u: olayları Dynamic Bar'a iletir. Kurulum için API.md içindeki "Claude Code" bölümüne bak.
//   UserPromptSubmit, PreToolUse  -> canlı durum (maskot laptop açıp kod yazar)
//   Stop                          -> "Claude Code bitirdi" + 10 kelimelik özet (hata varsa "takıldı" ve üzgün maskot)
//   Notification                  -> "Claude seni bekliyor"
//   PermissionRequest             -> barda Onayla / Reddet; yanıt gelmezse terminaldeki soru geçerli kalır
// Hook asla Claude Code'u engellemez: bar kapalıysa veya hata olursa sessizce 0 ile çıkar.
const fs = require('fs'), { spawn } = require('child_process');
if (process.env.DYNBAR_CHILD) process.exit(0); // kendi başlattığımız "claude -p" özet çağrısında tekrar tetiklenme
const BASE = process.env.DYNBAR_URL || 'http://127.0.0.1:47800', TOKEN = process.env.DYNBAR_TOKEN || '';
const HEAD = { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) };
let raw = '';
const hard = setTimeout(() => process.exit(0), 70000); // güvenlik: asla takılma
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => main().catch(() => {}).finally(() => { clearTimeout(hard); process.exit(0); }));

const req = async (method, route, body, ms) => {
  const r = await fetch(BASE + route, { method, headers: HEAD, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms || 1500) });
  return r.ok ? r.text() : null;
};
const post = (route, body, ms) => req('POST', route, body, ms).catch(() => null);

// Araç adını kısa Türkçe duruma çevirir
function label(tool, input) {
  input = input || {};
  const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const t = String(tool || '');
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return ['Kod yazıyor', base(input.file_path || input.notebook_path)];
  if (t === 'Bash' || t === 'PowerShell') return ['Komut çalıştırıyor', String(input.command || '').trim().split(/\s+/).slice(0, 3).join(' ')];
  if (/^(Read|Glob|Grep|LS)$/.test(t)) return ['Dosyalara bakıyor', base(input.file_path || input.path) || String(input.pattern || '')];
  if (/^(WebSearch|WebFetch)$/.test(t)) return ['İnternette arıyor', String(input.query || input.url || '').slice(0, 40)];
  if (/^(Agent|Task)$/.test(t)) return ['Yardımcı ajan çalıştırıyor', String(input.description || '').slice(0, 40)];
  if (t === 'TodoWrite') return ['Plan yapıyor', ''];
  if (/computer|browser|chrome/i.test(t)) return ['Ekranı kontrol ediyor', ''];
  if (t.startsWith('mcp__')) return ['Araç kullanıyor', t.split('__').slice(1).join(' · ').slice(0, 40)];
  return ['Çalışıyor', t];
}

// "Claude yanıtı" metninden en çok 10 kelimelik özet (yedek yöntem)
function firstWords(t) {
  const clean = String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|~]/g, '').replace(/^\s*[-\d.)]+\s+/gm, '').replace(/https?:\/\/\S+/g, '');
  const sent = clean.split(/(?<=[.!?:])\s+|\n+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 3)[0] || clean.trim();
  const w = sent.replace(/[.!?:]+$/, '').split(/\s+/).filter(Boolean);
  return w.length ? w.slice(0, 10).join(' ') + (w.length > 10 ? '…' : '') : '';
}

// transcript dosyasının sonundan son asistan metni ve son turda hata olup olmadığı
function readTail(file) {
  const out = { text: '', error: false };
  try {
    const st = fs.statSync(file), n = Math.min(st.size, 400000), buf = Buffer.alloc(n), fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, n, st.size - n); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const ln of lines) {
      let j; try { j = JSON.parse(ln); } catch { continue; }
      const c = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      if (j.type === 'assistant' && !out.text) { const t = c.filter((x) => x.type === 'text').map((x) => x.text).join('\n'); if (t.trim()) out.text = t; }
      if (j.type === 'user' && c.some((x) => x.type === 'tool_result' && x.is_error)) { out.error = true; }
      if (j.type === 'user' && typeof j.message.content === 'string') break; // son kullanıcı istemine ulaştık: tur başı
      if (j.type === 'user' && c.some((x) => x.type === 'text')) break;
    }
  } catch {}
  return out;
}

// Haiku ile gerçek özet (en çok ~6 sn). Başarısızsa '' döner.
function aiSummary(text) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const fin = (v) => { if (!done) { done = true; try { p.kill(); } catch {} resolve(v); } };
    let p;
    try {
      p = spawn('claude', ['-p', '--model', 'haiku', '--no-session-persistence', '--max-turns', '1',
        'Aşağıdaki yapay zekâ asistanı yanıtının ne yaptığını en çok 10 kelimeyle, aynı dilde, nokta koymadan özetle. Yalnızca özeti yaz.'],
      { shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, DYNBAR_CHILD: '1' } });
    } catch { return resolve(''); }
    p.on('error', () => fin(''));
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { const w = out.trim().replace(/^["'“”]+|["'“”.]+$/g, '').split(/\s+/).filter(Boolean); fin(w.length && w.length <= 14 ? w.slice(0, 10).join(' ') : ''); });
    setTimeout(() => fin(''), 6500);
    try { p.stdin.end(String(text).slice(0, 3000)); } catch {}
  });
}

async function main() {
  let h = {}; try { h = JSON.parse(raw); } catch {}
  const ev = h.hook_event_name || process.argv[2];
  const proj = String(h.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'proje';
  let cfg = { live: true, ask: true, ai: true };
  try { const s = JSON.parse(await req('GET', '/status', null, 700)); if (s && s.claude) cfg = s.claude; } catch { return; } // bar çalışmıyor: hiçbir şey yapma

  if (ev === 'UserPromptSubmit' || ev === 'PreToolUse') {
    if (!cfg.live) return;
    const [what, detail] = ev === 'PreToolUse' ? label(h.tool_name, h.tool_input) : ['Düşünüyor', ''];
    await post('/notify', { key: 'claude', title: 'Claude Code çalışıyor', text: detail ? what + ' · ' + detail : what, icon: '💻', mood: 'working', sticky: true, app: proj, stat: 'work' });
  } else if (ev === 'Notification') {
    if (h.notification_type === 'permission_prompt' && cfg.ask) return; // bardaki Onayla/Reddet zaten gösteriyor
    await post('/notify', { title: 'Claude seni bekliyor', text: String(h.message || 'Onay gerekiyor').slice(0, 120), icon: '🔔', mood: 'alert', ttl: 8, priority: 'high', app: 'Claude Code' });
  } else if (ev === 'Stop') {
    const tail = h.transcript_path ? readTail(h.transcript_path) : { text: '', error: false };
    const text = h.last_assistant_message || tail.text;
    const failed = tail.error && /hata|başarısız|olmadı|yapamad|failed|error|could not|couldn't|unable|cannot|can't/i.test(text);
    let sum = '';
    if (cfg.ai && text) sum = await aiSummary(text);
    if (!sum) sum = firstWords(text);
    await post('/dismiss', { key: 'claude' });
    await post('/notify', failed
      ? { title: 'Claude Code takıldı', text: sum || proj, icon: '⚠️', mood: 'sad', ttl: 8, priority: 'high', app: proj, stat: 'failed' }
      : { title: 'Claude Code bitirdi', text: sum || proj, icon: '✅', mood: 'claude', ttl: 6, app: proj, stat: 'done' });
  } else if (ev === 'PermissionRequest') {
    if (!cfg.ask) return;
    const [what, detail] = label(h.tool_name, h.tool_input);
    const r = await post('/ask', { title: 'Claude izin istiyor', text: detail ? what + ': ' + detail : what, timeout: 60 }, 65000);
    let answer = ''; try { answer = JSON.parse(r).answer; } catch {}
    if (answer === 'allow') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
    else if (answer === 'deny') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Kullanıcı Dynamic Bar üzerinden reddetti.' } } }));
    // diğer durumlarda sessiz çık: normal izin akışı (terminal) sürer
  }
}
