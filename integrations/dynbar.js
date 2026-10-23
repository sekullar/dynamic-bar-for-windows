// Küçük Node istemcisi (Node 18+). Kullanım:
//   const dynbar = require('./dynbar');
//   dynbar.notify({ title: 'Deploy', text: 'Bitti', icon: '🚀', mood: 'happy' });
//   dynbar.progress('indirme', 0.4, { title: 'İndiriliyor', text: '%40' });
// Ortam değişkeni yoksa Dynamic Bar'ın bağlantı dosyasından (~/.dynbar-ecosystem/dynamic-bar.json) port ve anahtar okunur
const LINK = (() => { try { const l = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.dynbar-ecosystem', 'dynamic-bar.json'), 'utf8')); return l && l.app === 'dynamic-bar' ? l : {}; } catch { return {}; } })();
const BASE = process.env.DYNBAR_URL || (LINK.port ? 'http://127.0.0.1:' + LINK.port : 'http://127.0.0.1:47800'), TOKEN = process.env.DYNBAR_TOKEN || LINK.token || '';
const call = (route, body, method = 'POST') => fetch(BASE + route, {
  method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
  body: method === 'POST' ? JSON.stringify(body || {}) : undefined, signal: AbortSignal.timeout(2000)
}).then((r) => r.text()).catch(() => null);
module.exports = {
  notify: (o) => call('/notify', o),
  progress: (key, value, o = {}) => call('/notify', { key, progress: value, ...o }),
  dismiss: (key) => call('/dismiss', { key }),
  dnd: (on) => call('/dnd', typeof on === 'boolean' ? { on } : {}),
  remind: (o) => call('/remind', o),
  todo: (o) => call('/todo', o),
  status: () => call('/status', null, 'GET')
};
