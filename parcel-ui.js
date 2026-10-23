// Kargo bırakma penceresi: dosya bırakılır, hedef seçilir; götürme animasyonu ana adada oynar (parcel.js).
(async () => {
  const $ = (id) => document.getElementById(id);
  const pill = $('pill'), inner = $('inner'), zoneEl = $('zone'), pickv = $('pickv'), destsEl = $('dests');
  const init = await dynbar.invoke('parcel:init');
  if (!init) return;
  const cfg = init.settings || {};

  const BG = { black: '#000000', graphite: '#17161b', midnight: '#0b1124', plum: '#1c1020', forest: '#0d1a14' };
  const root = document.documentElement.style, dock = /^dock/.test(cfg.mode);
  const acc = /^#[0-9a-f]{6}$/i.test(cfg.accent || '') ? cfg.accent : (PALETTE[cfg.color] || PALETTE.pink)[1];
  const ui = Math.max(0.8, Math.min(1.3, cfg.uiScale || 1)), top = dock ? 0 : (cfg.offsetY ?? 10);
  root.setProperty('--bg', BG[cfg.bg] || BG.black); root.setProperty('--bga', cfg.bgAlpha || 100);
  root.setProperty('--acc', acc); root.setProperty('--ui', ui); root.setProperty('--top', top + 'px');
  document.body.dataset.mode = dock ? 'dock' : 'float';

  let opened = false, dests = [], sel = 0, picking = false, enterCount = 0;
  const FILE_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path d="M6 2h11l6 6v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#f2f2f7" stroke="#c7c7cc"/><path d="M17 2v6h6" fill="#d1d1d6"/></svg>');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sizeText = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 0 ? Math.max(1, Math.round(n / 1024)) + ' KB' : '');

  function fit() {
    if (!opened) return;
    const h = inner.offsetHeight;
    pill.style.height = h + 'px';
    dynbar.send('parcel:fit', Math.ceil((top + h) * ui) + 30);
  }

  function mark() { destsEl.querySelectorAll('.dest').forEach((d, i) => d.classList.toggle('sel', i === sel)); }
  function choose(i) {
    const d = dests[i]; if (!d || !picking) return;
    picking = false; dynbar.invoke('parcel:send', d.id);
  }

  function showPick(r) {
    dests = r.dests; sel = 0; picking = true;
    $('cname').textContent = r.files.length === 1 ? r.files[0].name : r.files.length + ' dosya';
    const total = r.files.reduce((a, f) => a + f.size, 0);
    $('cmeta').textContent = [r.files.length > 1 ? r.files.slice(0, 2).map((f) => f.name).join(', ') + (r.files.length > 2 ? '…' : '') : (r.files[0].isDir ? 'Klasör' : ''), sizeText(total)].filter(Boolean).join(' · ');
    $('cicon').src = r.icon || FILE_ICON; // işletim sistemi simgesi gelmezse yedek
    destsEl.textContent = '';
    if (!dests.length) { const n = el('div', null, 'Hedef yok. Ayarlar > Gönder bölümünden bir klasör, Telegram veya Discord ekle.'); n.id = 'none'; destsEl.append(n); }
    dests.forEach((d, i) => {
      const c = el('div', 'dest enter'); c.style.animationDelay = i * 40 + 'ms';
      c.append(el('span', 'ic', d.icon), el('span', null, d.name), el('kbd', null, String(i + 1)));
      c.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
      c.onclick = () => choose(i);
      destsEl.append(c);
    });
    mark();
    zoneEl.hidden = true; pickv.hidden = false; pill.classList.remove('hot'); pill.classList.add('pick');
    requestAnimationFrame(fit);
  }

  // ----- sürükle-bırak -----
  // Dosya gezginden gelen sürükleme bu pencereye bırakılınca tarayıcı dosyayı açmaya çalışır: her olayda iptal et
  window.addEventListener('dragenter', (e) => { e.preventDefault(); if (!picking) { enterCount++; pill.classList.add('hot'); } });
  window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); enterCount = Math.max(0, enterCount - 1); if (!enterCount) pill.classList.remove('hot'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); enterCount = 0; pill.classList.remove('hot');
    if (picking || !e.dataTransfer) return;
    const paths = [...e.dataTransfer.files].map((f) => dynbar.getPath(f)).filter(Boolean);
    if (!paths.length) { $('ztitle').textContent = 'Bu bir dosya değil'; $('zsub').textContent = 'Gezgin\'den bir dosya sürükle'; return; }
    const r = await dynbar.invoke('parcel:files', paths);
    if (r) showPick(r); else dynbar.send('parcel:close');
  });

  window.addEventListener('keydown', (e) => {
    if (!picking) { if (e.key === 'Escape') dynbar.send('parcel:close'); return; }
    if (e.key === 'Escape') { e.preventDefault(); dynbar.send('parcel:close'); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); if (dests.length) { sel = (sel + 1) % dests.length; mark(); } }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (dests.length) { sel = (sel - 1 + dests.length) % dests.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); choose(+e.key - 1); }
  });

  dynbar.on('parcel-show', () => {
    opened = true; pill.classList.add('open'); fit();
    setTimeout(() => pill.classList.add('settled'), 700);
  });
  dynbar.on('parcel-hide', () => { opened = false; picking = false; pill.classList.add('closing'); });
  dynbar.send('parcel:ready');
})();
