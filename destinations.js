// "Kargo" hedefleri: bırakılan dosyanın gidebileceği yerler. Her hedef {id, name, icon, type, ...} nesnesidir;
// send(hedef, dosyalar, {progress, secret}) dosyaları teslim eder ve {text, url?} döner, olmazsa hata fırlatır.
// Yeni hedef türü eklemek için TYPES içine bir fonksiyon eklemek yeter.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), https = require('https'), crypto = require('crypto');
const { shell, clipboard } = require('electron');
const { execFile } = require('child_process');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- hedef listesi ----------
let autoCache = { at: 0, list: [] };
function autoFolders() { // Drive / OneDrive / Dropbox eşitleme klasörleri; içlerinde "Dynamic Bar" alt klasörü kullanılır
  if (Date.now() - autoCache.at < 60000) return autoCache.list;
  const out = [], home = os.homedir();
  const add = (name, icon, dir) => { if (dir && isDir(dir)) out.push({ type: 'folder', name, icon, dir: path.join(dir, 'Dynamic Bar'), auto: true }); };
  // Google Drive for desktop: sanal sürücü (G:\My Drive, G:\Drive'ım) ya da kullanıcı klasörü
  let drive = ['My Drive', "Drive'ım", 'Google Drive'].map((n) => path.join(home, n)).find(isDir);
  if (!drive && process.platform === 'win32') {
    for (const l of 'GHIJKLMNOPQRSTUVWXYZ') { const c = ['My Drive', "Drive'ım"].map((n) => l + ':\\' + n).find(isDir); if (c) { drive = c; break; } }
  }
  add('Google Drive', '🔺', drive);
  add('OneDrive', '☁️', process.env.OneDriveConsumer || process.env.OneDrive);
  add('Dropbox', '💧', path.join(home, 'Dropbox'));
  autoCache = { at: Date.now(), list: out };
  return out;
}

function list(settings, secret) {
  const out = [];
  if (settings.parcelAutoFolders !== false) autoFolders().forEach((f) => out.push(f));
  String(settings.parcelFolders || '').split('\n').forEach((line) => { // her satır: Ad|klasör yolu
    const [name, dir] = line.split('|').map((x) => (x || '').trim());
    if (name && dir) out.push({ type: 'folder', name, icon: '📁', dir });
  });
  if (settings.parcelTgChat && secret('parcelTgToken')) out.push({ type: 'telegram', name: 'Telegram', icon: '✈️' });
  if (secret('parcelDiscord')) out.push({ type: 'discord', name: 'Discord', icon: '💬' });
  out.push({ type: 'whatsapp', name: 'WhatsApp', icon: '🟢' });
  const seen = new Set();
  return out.map((d) => ({ ...d, id: d.type + ':' + slug(d.name) })).filter((d) => !seen.has(d.id) && seen.add(d.id));
}

// ---------- dosya bilgisi ----------
async function sizeOf(p, budget = { n: 5000 }) {
  const st = await fsp.stat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await fsp.readdir(p)) { if (budget.n-- <= 0) break; try { total += await sizeOf(path.join(p, e), budget); } catch {} }
  return total;
}

// ---------- klasöre kopyalama (bayt bazında ilerleme) ----------
async function collect(src, dst, ops) { // [{src, dst, size}] ve oluşturulacak klasörler
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    ops.dirs.push(dst);
    for (const e of await fsp.readdir(src)) await collect(path.join(src, e), path.join(dst, e), ops);
  } else ops.files.push({ src, dst, size: st.size });
}
const uniqueName = async (dir, name) => {
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let i = 1; ; i++) {
    const cand = i === 1 ? name : `${base} (${i})${ext}`;
    try { await fsp.access(path.join(dir, cand)); } catch { return cand; }
  }
};
function copyFile(src, dst, onBytes) {
  return new Promise((resolve, reject) => {
    const r = fs.createReadStream(src), w = fs.createWriteStream(dst);
    r.on('data', (c) => onBytes(c.length));
    r.on('error', reject); w.on('error', reject); w.on('finish', resolve);
    r.pipe(w);
  });
}
async function toFolder(dest, files, { progress }) {
  await fsp.mkdir(dest.dir, { recursive: true });
  const ops = { files: [], dirs: [] };
  for (const f of files) await collect(f.path, path.join(dest.dir, await uniqueName(dest.dir, f.name)), ops);
  const total = ops.files.reduce((a, f) => a + f.size, 0) || 1;
  let done = 0;
  for (const d of ops.dirs) await fsp.mkdir(d, { recursive: true });
  for (const f of ops.files) await copyFile(f.src, f.dst, (n) => { done += n; progress(Math.min(0.99, done / total)); });
  return { text: (files.length === 1 ? files[0].name : files.length + ' dosya') + ' · ' + dest.name };
}

// ---------- multipart yükleme (Telegram, Discord) ----------
function upload(urlStr, fields, fileField, file, onBytes) {
  return new Promise((resolve, reject) => {
    const boundary = '----dynbar' + crypto.randomBytes(8).toString('hex'), nl = '\r\n';
    const safe = file.name.replace(/["\r\n]/g, '_');
    const head = Buffer.from(Object.entries(fields).map(([k, v]) => `--${boundary}${nl}Content-Disposition: form-data; name="${k}"${nl}${nl}${v}${nl}`).join('')
      + `--${boundary}${nl}Content-Disposition: form-data; name="${fileField}"; filename="${safe}"${nl}Content-Type: application/octet-stream${nl}${nl}`);
    const tail = Buffer.from(`${nl}--${boundary}--${nl}`);
    const req = https.request(urlStr, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': head.length + file.size + tail.length } }, (res) => {
      let body = ''; res.on('data', (c) => { if (body.length < 65536) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(head);
    const rs = fs.createReadStream(file.path);
    rs.on('data', (c) => onBytes(c.length));
    rs.on('error', (e) => { req.destroy(); reject(e); });
    rs.on('end', () => req.end(tail));
    rs.pipe(req, { end: false });
  });
}
function plainFiles(files) {
  const dirs = files.filter((f) => f.isDir);
  if (dirs.length) throw new Error('Klasör gönderilemez, önce sıkıştır (zip)');
  return files;
}
async function eachUpload(files, limit, limitName, progress, one) {
  plainFiles(files);
  const big = files.find((f) => f.size > limit);
  if (big) throw new Error(`${limitName} sınırı ${Math.round(limit / 1048576)} MB aşıldı: ${big.name}`);
  const total = files.reduce((a, f) => a + f.size, 0) || 1; let done = 0;
  for (const f of files) await one(f, (n) => { done += n; progress(Math.min(0.99, done / total)); });
}

async function toTelegram(dest, files, { progress, secret, settings }) {
  const token = secret('parcelTgToken'), chat = String(settings.parcelTgChat || '').trim();
  if (!token || !chat) throw new Error('Telegram bot anahtarı veya sohbet kimliği yok');
  await eachUpload(files, 50 * 1048576, 'Telegram', progress, async (f, onBytes) => {
    const r = await upload(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendDocument`, { chat_id: chat }, 'document', f, onBytes);
    let j = {}; try { j = JSON.parse(r.body); } catch {}
    if (!j.ok) throw new Error('Telegram: ' + (j.description || 'HTTP ' + r.status));
  });
  return { text: (files.length === 1 ? files[0].name : files.length + ' dosya') + ' · Telegram' };
}

async function toDiscord(dest, files, { progress, secret }) {
  const hook = secret('parcelDiscord');
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(hook)) throw new Error('Discord webhook adresi geçersiz');
  await eachUpload(files, 25 * 1048576, 'Discord', progress, async (f, onBytes) => {
    const r = await upload(hook, {}, 'file', f, onBytes);
    if (r.status >= 300) throw new Error('Discord: HTTP ' + r.status);
  });
  return { text: (files.length === 1 ? files[0].name : files.length + ' dosya') + ' · Discord' };
}

// WhatsApp'ın masaüstünden dosya göndermek için resmî yolu yok: dosyayı panoya koyar, sohbeti açar; sen Ctrl+V yaparsın.
function setClipboardFiles(paths) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath ($env:PARCEL_FILES -split "\\|")'],
      { windowsHide: true, timeout: 15000, env: { ...process.env, PARCEL_FILES: paths.join('|') } }, (err) => (err ? reject(err) : resolve()));
  });
}
async function toWhatsApp(dest, files, { progress, settings }) {
  progress(0.3);
  await setClipboardFiles(files.map((f) => f.path));
  progress(0.7);
  const phone = String(settings.parcelWaPhone || '').replace(/\D/g, '');
  try { await shell.openExternal(phone ? `whatsapp://send?phone=${phone}` : 'whatsapp://'); }
  catch { await shell.openExternal(phone ? `https://wa.me/${phone}` : 'https://web.whatsapp.com/'); }
  return { text: 'Dosya panoda: sohbete gelince Ctrl+V', ttl: 9 };
}

const TYPES = { folder: toFolder, telegram: toTelegram, discord: toDiscord, whatsapp: toWhatsApp };

async function send(dest, files, ctx) {
  const fn = TYPES[dest.type];
  if (!fn) throw new Error('Bilinmeyen hedef: ' + dest.type);
  return fn(dest, files, ctx);
}

module.exports = { list, send, sizeOf, _upload: upload, _autoFolders: autoFolders };
