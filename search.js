// Spotlight arama hapı: Spotlight'ın indeksinden gelen sonuçları ada stilinde çizer (ana süreçte spotlight.js köprü kurar).
(async () => {
  const $ = (id) => document.getElementById(id);
  const pill = $('pill'), inner = $('inner'), input = $('q'), list = $('list'), footer = $('footer'), statusEl = $('status');
  const init = await dynbar.invoke('search:init');
  if (!init) return;
  const S = init.info.strings || {}, cfg = init.settings || {};

  const BG = { black: '#000000', graphite: '#17161b', midnight: '#0b1124', plum: '#1c1020', forest: '#0d1a14' };
  const root = document.documentElement.style;
  const acc = /^#[0-9a-f]{6}$/i.test(cfg.accent || '') ? cfg.accent : (PALETTE[cfg.color] || PALETTE.pink)[1];
  const dock = /^dock/.test(cfg.mode);
  const ui = Math.max(0.8, Math.min(1.3, cfg.uiScale || 1)), top = dock ? 0 : (cfg.offsetY ?? 10);
  root.setProperty('--bg', BG[cfg.bg] || BG.black); root.setProperty('--bga', cfg.bgAlpha || 100);
  root.setProperty('--acc', acc); root.setProperty('--ui', ui); root.setProperty('--top', top + 'px');
  document.body.dataset.mode = dock ? 'dock' : 'float';
  input.placeholder = S.placeholder || '';

  const X = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"';
  const SVG = {
    calc: `<svg ${X}><rect x="3" y="2" width="22" height="24" rx="5" fill="#ff9f0a"/><rect x="6.5" y="5.5" width="15" height="6" rx="1.5" fill="#222"/><g fill="#fff"><circle cx="9" cy="16" r="1.6"/><circle cx="14" cy="16" r="1.6"/><circle cx="19" cy="16" r="1.6"/><circle cx="9" cy="21" r="1.6"/><circle cx="14" cy="21" r="1.6"/><circle cx="19" cy="21" r="1.6"/></g></svg>`,
    web: `<svg ${X}><circle cx="14" cy="14" r="12" fill="#0a7aff"/><g fill="none" stroke="#fff" stroke-width="1.6"><ellipse cx="14" cy="14" rx="5" ry="12"/><path d="M2 14h24M4 8h20M4 20h20"/></g></svg>`,
    cmd: `<svg ${X}><rect x="2" y="2" width="24" height="24" rx="6" fill="#636366"/><path d="M8 10l5 4-5 4M15 19h6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    app: `<svg ${X}><rect x="2" y="2" width="24" height="24" rx="6" fill="#8e8e93"/><g fill="#fff"><rect x="7" y="7" width="6" height="6" rx="1.5"/><rect x="15" y="7" width="6" height="6" rx="1.5"/><rect x="7" y="15" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/></g></svg>`,
    folder: `<svg ${X}><path d="M2 8a3 3 0 0 1 3-3h5l3 3h10a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#5ac8fa"/></svg>`,
    file: `<svg ${X}><path d="M6 2h11l6 6v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#f2f2f7" stroke="#c7c7cc"/><path d="M17 2v6h6" fill="#d1d1d6"/></svg>`,
  };
  const fallback = (k) => 'data:image/svg+xml,' + encodeURIComponent(SVG[k] || SVG.file);

  let results = [], sel = 0, token = 0, opened = false, debounceT;
  const icons = new Map();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function fit() {
    if (!opened) return;
    const h = inner.offsetHeight;
    pill.style.height = h + 'px';
    dynbar.send('search:fit', Math.ceil((top + h) * ui) + 30);
  }

  function buildFooter() {
    footer.textContent = '';
    const f = S.footer || {};
    [['↵', f.open], ['Ctrl+↵', f.reveal], ['Alt+1-9', f.quick], ['Esc', f.close]].forEach(([k, t]) => {
      if (!t) return;
      const s = el('span'); s.append(el('kbd', null, k), document.createTextNode(t)); footer.append(s);
    });
  }

  function render() {
    const fresh = !list.firstChild && results.length > 0; // boş listeden ilk dolum: giriş animasyonu
    list.textContent = '';
    let last = null, n = 0;
    const stagger = (e) => { if (fresh) { e.classList.add('enter'); e.style.animationDelay = Math.min(n++ * 22, 220) + 'ms'; } return e; };
    results.forEach((r, i) => {
      if (r.group !== last) { list.append(stagger(el('div', 'group', r.group))); last = r.group; }
      const row = stagger(el('div', 'row' + (r.top ? ' top' : '') + (i === sel ? ' sel' : '')));
      row.dataset.i = i;
      const ic = el('img', 'ic'), ik = r.kind + '|' + r.name + '|' + (r.sub || '');
      ic.src = icons.get(ik) || fallback(r.kind); // önceden alınan ikon hemen gelir, titreme olmaz
      if (r.icon && !icons.has(ik)) dynbar.invoke('search:icon', r.id).then((u) => {
        if (!u) return;
        icons.set(ik, u); if (ic.isConnected) ic.src = u;
      });
      const text = el('div', 'text'); text.append(el('div', 'name', r.name));
      if (r.sub) text.append(el('div', 'sub', r.sub));
      row.append(ic, text, el('span', 'kind', r.kindLabel || ''), el('span', 'ret', '↵'));
      row.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
      row.onclick = () => activate(i);
      list.append(row);
    });
    footer.classList.toggle('enter', fresh);
    footer.hidden = results.length === 0;
    requestAnimationFrame(fit);
  }

  function mark() {
    list.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', +r.dataset.i === sel));
    const cur = list.querySelector('.row.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  async function doSearch() {
    const t = ++token, q = input.value;
    if (!q.trim()) { results = []; statusEl.textContent = ''; render(); return; }
    const res = await dynbar.invoke('search:query', q);
    if (t !== token || !res) return;
    results = res.results || []; sel = 0;
    statusEl.textContent = res.scanning ? (S.scanning || '') : '';
    render();
  }

  function activate(i, mode) {
    const r = results[i]; if (!r) return;
    dynbar.invoke('search:open', { id: r.id, mode });
  }

  input.addEventListener('input', () => { clearTimeout(debounceT); debounceT = setTimeout(doSearch, 50); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; doSearch(); } else dynbar.send('search:close'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { sel = (sel + 1) % results.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { sel = (sel - 1 + results.length) % results.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); activate(sel, e.ctrlKey || e.metaKey ? 'reveal' : 'open'); }
    else if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); activate(+e.key - 1); }
  });

  dynbar.on('search-show', () => {
    opened = true;
    pill.classList.add('open');
    fit();
    input.focus();
    setTimeout(() => pill.classList.add('settled'), 700);
  });
  dynbar.on('search-hide', () => { opened = false; pill.classList.add('closing'); });

  buildFooter();
  dynbar.send('search:ready');
})();
