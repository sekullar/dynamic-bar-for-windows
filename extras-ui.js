(() => {
  const $ = (s) => document.querySelector(s), api = window.barApi, island = $('#island'), mascot = $('#mascot');
  const pad = (n) => String(n).padStart(2, '0'), mmss = (s) => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  let S = {}, ev0 = [];

  // --- sistem ---
  const stat = (id, v) => { $('#s' + id).style.width = v + '%'; $('#s' + id + 'v').textContent = v + '%'; };
  dynbar.on('sys', (d) => { stat('cpu', d.cpu); stat('mem', d.mem); });
  if (navigator.getBattery) navigator.getBattery().then((b) => {
    let low = !b.charging && b.level <= .2, full = b.charging && b.level >= 1; // başlangıçta gereksiz uyarı verme
    const u = () => {
      const lv = Math.round(b.level * 100); stat('bat', lv); $('#sbatv').textContent = lv + '%' + (b.charging ? '⚡' : '');
      if (S.batteryToasts === false) return;
      if (!b.charging && lv <= 20 && !low) { low = true; api.enqueue({ title: 'Pil azaldı', text: '%' + lv + ' kaldı, şarja tak', mood: 'alert', ttl: 5 }); }
      if (b.charging || lv > 25) low = false;
      if (b.charging && lv >= 100 && !full) { full = true; api.enqueue({ title: 'Pil dolu', text: 'Şarjı çıkarabilirsin', mood: 'happy', ttl: 4 }); }
      if (!b.charging || lv < 95) full = false;
    };
    u(); ['levelchange', 'chargingchange'].forEach((ev) => b.addEventListener(ev, u));
  });

  // --- pano ---
  const drawClips = (list) => {
    const box = $('#clips'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="sub">Henüz kopyalanan bir şey yok</div>'; return; }
    list.slice(0, 3).forEach((t, i) => {
      const b = document.createElement('button'); b.textContent = t.replace(/\s+/g, ' ').slice(0, 80);
      b.onclick = () => { dynbar.send('clip:copy', i); b.textContent = 'Kopyalandı ✓'; setTimeout(() => drawClips(list), 900); };
      box.append(b);
    });
  };
  dynbar.on('clip', drawClips); dynbar.invoke('clip:get').then(drawClips);

  // --- takvim ---
  const drawCal = (ev) => {
    ev0 = ev || []; const e = ev0[0];
    $('#cal1').textContent = e ? e.title : 'Yaklaşan etkinlik yok';
    $('#cal2').textContent = e ? new Date(e.start).toLocaleString('tr-TR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: S.clock24 === false }) : (S.icsUrl ? '' : 'Ayarlardan takvim (ICS) adresi ekle');
  };
  dynbar.on('cal', drawCal); dynbar.invoke('cal:get').then(drawCal);

  // --- pomodoro (süreler ayarlardan) ---
  const dur = () => ({ focus: (S.pomoFocus || 25) * 60, brk: (S.pomoBreak || 5) * 60, long: (S.pomoLong || 15) * 60 }), NAME = { focus: 'Odak', brk: 'Mola', long: 'Uzun mola' };
  let ph = 'focus', left = 25 * 60, run = false, rounds = 0, pt, endAt = 0;
  let focusState = false; // odak turu sürerken bildirimler bekletilir (ana süreç "kaçırılanlar" listesini tutar)
  const paint = () => {
    const f = run && ph === 'focus'; if (f !== focusState) { focusState = f; api.setFocus(f); }
    $('#pt').textContent = mmss(left); $('.ptime').textContent = mmss(left);
    $('#pl').textContent = NAME[ph] + (rounds ? ' · ' + rounds + ' tur' : '') + (f && S.focusDnd !== false ? ' · bildirimler kapalı' + (S.claudeAsk !== false ? ', onaylar açık' : '') : ''); $('#pgo').textContent = run ? 'Duraklat' : 'Başlat';
    island.classList.toggle('pomo', run);
  };
  function tick() {
    left = Math.ceil((endAt - Date.now()) / 1000);
    if (left > 0) return paint();
    if (ph === 'focus') { rounds++; ph = rounds % (S.pomoRounds || 4) ? 'brk' : 'long'; } else ph = 'focus';
    left = dur()[ph]; endAt = Date.now() + left * 1000; paint();
    api.enqueue({ title: ph === 'focus' ? 'Odaklanma zamanı' : 'Mola zamanı', text: ph === 'focus' ? 'Hadi başlayalım' : 'Biraz dinlen', mood: ph === 'focus' ? 'alert' : 'happy', ttl: 5, force: true });
  }
  $('#pgo').onclick = () => { run = !run; clearInterval(pt); if (run) { endAt = Date.now() + left * 1000; pt = setInterval(tick, 1000); } paint(); };
  $('#prs').onclick = () => { run = false; clearInterval(pt); ph = 'focus'; left = dur().focus; rounds = 0; paint(); };
  paint();

  // --- kronometre ---
  let sw0 = 0, swAcc = 0, swRun = false, swT;
  const swPaint = () => {
    const ms = swAcc + (swRun ? Date.now() - sw0 : 0), s = Math.floor(ms / 1000);
    $('#swt').textContent = mmss(s) + '.' + Math.floor((ms % 1000) / 100); $('#swgo').textContent = swRun ? 'Durdur' : (swAcc ? 'Devam' : 'Başlat');
  };
  $('#swgo').onclick = () => {
    if (swRun) { swAcc += Date.now() - sw0; swRun = false; clearInterval(swT); } else { sw0 = Date.now(); swRun = true; swT = setInterval(swPaint, 100); }
    swPaint();
  };
  $('#swrs').onclick = () => { swRun = false; clearInterval(swT); swAcc = 0; swPaint(); };
  swPaint();

  // --- zamanlayıcı kısayolları (ayarlardan: "1,5,10,25") ---
  const drawTmr = () => {
    const box = $('#tmr'); box.innerHTML = '';
    String(S.timerPresets || '1,5,10,25').split(/[,\s]+/).map(Number).filter((m) => m > 0 && m <= 240).slice(0, 5).forEach((m) => {
      const b = document.createElement('button'); b.textContent = m + ' dk';
      b.onclick = () => api.enqueue({ type: 'timer', title: m + ' dk', seconds: m * 60, force: true }); box.append(b);
    });
  };

  // --- bildirim geçmişi ---
  const drawHist = () => {
    const box = $('#hist'); box.innerHTML = '';
    if (!api.hist.length) { box.innerHTML = '<div class="sub">Henüz bildirim yok</div>'; return; }
    api.hist.slice(0, 3).forEach((x) => {
      const d = document.createElement('div'), t = new Date(x.t); d.className = 'hrow'; d.innerHTML = '<em></em><span></span>';
      d.firstChild.textContent = pad(t.getHours()) + ':' + pad(t.getMinutes()); d.lastChild.textContent = (x.app ? x.app + ': ' : '') + x.title + (x.text ? ' · ' + x.text : ''); box.append(d);
    });
  };
  api.onHist = drawHist; drawHist();

  // --- hızlı ayarlar ---
  $('#qdnd').onclick = () => dynbar.setSettings({ dnd: !S.dnd });
  $('#qset').onclick = () => dynbar.send('open-settings');

  // --- maskot: karakter, aksesuar, gözler, sevilme ---
  const EARS = {
    cat: '<polygon class="ear" points="8,16 10,4 19,12"/><polygon class="ear" points="32,16 30,4 21,12"/>',
    fox: '<polygon class="ear" points="6,18 8,1 20,12"/><polygon class="ear" points="34,18 32,1 20,12"/>',
    bunny: '<ellipse class="ear" cx="13" cy="8" rx="3.6" ry="8"/><ellipse class="ear" cx="27" cy="8" rx="3.6" ry="8"/>',
    bear: '<circle class="ear" cx="9" cy="12" r="4.5"/><circle class="ear" cx="31" cy="12" r="4.5"/>',
    mouse: '<circle class="ear" cx="9" cy="11" r="6.5"/><circle class="ear" cx="31" cy="11" r="6.5"/>',
    dog: '<ellipse class="ear" cx="7" cy="19" rx="4" ry="8" transform="rotate(15 7 19)"/><ellipse class="ear" cx="33" cy="19" rx="4" ry="8" transform="rotate(-15 33 19)"/>',
    blob: ''
  };
  const ACC = {
    none: '',
    bow: '<g fill="#ff6fa5"><path d="M27 8l5-3v6zM27 8l-5-3v6z"/><circle cx="27" cy="8" r="1.7"/></g>',
    hat: '<polygon points="15,11 20,1 25,11" fill="#ffd24f"/><circle cx="20" cy="1.5" r="1.7" fill="#fff"/>',
    glasses: '<g fill="none" stroke="#2a1a24" stroke-width="1.2"><circle cx="14.5" cy="22" r="4.2"/><circle cx="25.5" cy="22" r="4.2"/><path d="M18.7 22h2.6"/></g>',
    crown: '<polygon points="13,11 14,3 17.5,7 20,2 22.5,7 26,3 27,11" fill="#ffd24f"/>',
    headphones: '<path d="M6 22Q6 7 20 7Q34 7 34 22" fill="none" stroke="#2a1a24" stroke-width="2.2"/><rect x="3.5" y="19" width="5" height="8" rx="2" fill="#2a1a24"/><rect x="31.5" y="19" width="5" height="8" rx="2" fill="#2a1a24"/>',
    star: '<polygon points="28,2 29.2,5.4 32.8,5.5 30,7.7 31,11 28,9 25,11 26,7.7 23.2,5.5 26.8,5.4" fill="#ffd24f"/>'
  };
  const applyS = (s) => {
    S = s; $('#ears').innerHTML = s.character in EARS ? EARS[s.character] : EARS.cat; $('#acc').innerHTML = ACC[s.accessory] || '';
    if (s.pagePomodoro === false && run) $('#prs').onclick();
    if (!run && ph === 'focus') { left = dur().focus; paint(); }
    if (s.eyes === false) $('#eyes').style.transform = '';
    $('#qdnd').textContent = 'Rahatsız etme: ' + (s.dnd ? 'açık' : 'kapalı');
    drawCal(ev0); drawSc(); drawWx(); drawTmr(); arm(); drawTodo(); drawCd(); drawWorld(); drawRates();
  };
  dynbar.onSettings(applyS); dynbar.getSettings().then(applyS);

  // Gözler imleci izler; arada (5-13 sn) bir göz kırpıp kısa süre imleçten başka yöne bakar
  let gaze = null, away = null;
  const look = () => {
    if (S.eyes === false || !gaze) return;
    const r = mascot.getBoundingClientRect(), c = (v) => Math.max(-1, Math.min(1, v / 160));
    const x = away ? away.x : c(gaze.x - r.left - r.width / 2) * 1.8, y = away ? away.y : c(gaze.y - r.top - r.height / 2) * 1.4;
    $('#eyes').style.transform = `translate(${x}px, ${y}px)`;
  };
  const blinkNow = () => document.querySelectorAll('#mascot .eye').forEach((e) => e.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)' }, { transform: 'scaleY(1)' }], { duration: 190 }));
  const glance = () => {
    if (S.eyes !== false && gaze) {
      blinkNow();
      setTimeout(() => { away = { x: (Math.random() < .5 ? -1 : 1) * (1.2 + Math.random() * .8), y: (Math.random() - .35) * 1.6 }; look(); }, 140);
      setTimeout(() => { away = null; look(); if (Math.random() < .5) blinkNow(); }, 140 + 700 + Math.random() * 900);
    }
    setTimeout(glance, 5000 + Math.random() * 8000);
  };
  setTimeout(glance, 6000);
  dynbar.on('cursor', ({ x, y }) => { // ana süreç imleci ekranın her yerinden takip eder
    gaze = { x, y }; look();
  });
  mascot.addEventListener('click', () => { // tıklama yine adaya ulaşır (panel açılır); maskot ayrıca kalp çıkarır
    if (S.pet === false) return;
    api.setMood('idle'); mascot.getBoundingClientRect(); api.setMood('happy');
    const h = document.createElement('span'); h.className = 'heart'; h.textContent = '♥';
    h.style.color = getComputedStyle(document.documentElement).getPropertyValue('--cheek');
    h.style.left = (mascot.getBoundingClientRect().left - island.getBoundingClientRect().left + 10) + 'px'; h.style.top = '2px';
    island.append(h); setTimeout(() => h.remove(), 1000);
    setTimeout(() => api.setMood(api.playing() ? 'music' : 'idle'), 1600);
  });

  // --- hava durumu ---
  let wx = null;
  const drawWx = () => {
    $('#wt').textContent = wx ? wx.icon + ' ' + wx.temp + '°' + wx.unit : '–';
    $('#wl').textContent = wx ? `${wx.city} · hissedilen ${wx.feels}° · rüzgar ${wx.wind} km/sa` : (S.city ? 'Yükleniyor…' : 'Ayarlardan şehir gir');
  };
  dynbar.on('weather', (w) => { wx = w; drawWx(); }); dynbar.invoke('weather:get').then((w) => { wx = w; drawWx(); });

  // --- ağ hızı ---
  const fmtB = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : Math.round(b / 1024) + ' KB/s');
  dynbar.on('net', (d) => ($('#snet').textContent = '↓ ' + fmtB(d.down) + '   ↑ ' + fmtB(d.up)));

  // --- kısayollar ---
  function drawSc() {
    const box = $('#sc'); box.innerHTML = '';
    String(S.shortcuts || '').split(/\r?\n/).map((l) => l.split('|')).filter((p) => p.length > 1 && p[0].trim() && p[1].trim()).slice(0, 4).forEach((p, i) => {
      const b = document.createElement('button'); b.textContent = p[0].trim(); b.onclick = () => dynbar.send('launch', i); box.append(b);
    });
    if (!box.children.length) box.innerHTML = '<div class="sub">Ayarlardan kısayol ekle</div>';
  }

  // --- hatırlatıcılar (su, göz molası; rahatsız etme/sessiz saatler enqueue içinde denetlenir) ---
  // --- su içme: bardak belirir, "İçtim"e basınca maskot içer, günlük sayaç ve seri tutulur ---
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const today = () => new Date().toLocaleDateString('sv'), ago = (d) => new Date(Date.now() - d * 864e5).toLocaleDateString('sv');
  const water = () => { try { const w = JSON.parse(ls.get('water') || '{}'); return w.day === today() ? w : { day: today(), n: 0, streak: w.streak || 0, last: w.last || '' }; } catch { return { day: today(), n: 0, streak: 0, last: '' }; } };
  const goal = () => +S.waterGoal || 8;
  api.waterLine = () => { if (!(+S.waterEvery > 0)) return ''; const w = water(); return ' · 💧 ' + w.n + '/' + goal(); };
  function waterAsk() {
    const w = water();
    api.enqueue({
      title: 'Su içme zamanı', text: 'Bugün ' + w.n + '/' + goal() + ' bardak', icon: '💧', mood: 'happy', ttl: 40, local: true,
      actions: [{ id: 'drink', label: 'İçtim 💧' }, { id: 'later', label: 'Sonra' }],
      onAction: (id) => {
        if (id !== 'drink') return;
        const x = water(); x.n++;
        if (x.n === goal()) { x.streak = x.last === ago(1) ? (x.streak || 0) + 1 : 1; x.last = today(); }
        ls.set('water', JSON.stringify(x));
        const done = x.n >= goal();
        api.enqueue({ title: x.n + '. bardak', text: done ? 'Hedefe ulaştın! 🎉' + (x.streak > 1 ? ' ' + x.streak + ' günlük seri 🔥' : '') : 'Aferin, ' + (goal() - x.n) + ' bardak kaldı', mood: 'drink', ttl: 4, force: true });
      }
    });
  }
  api.waterAsk = waterAsk;

  // --- maskotun günlük yaşamı: sabah esner, öğlen acıkır, gece uykulu olur ---
  const SLOT = (h) => (h >= 6 && h < 11 ? 'morning' : h >= 12 && h < 14 ? 'lunch' : h >= 23 || h < 5 ? 'night' : null);
  const LIFE = { morning: ['yawn', 'Günaydın ☀️', 'Güne hazır mısın?'], lunch: ['hungry', 'Yemek vakti 🍽️', 'Bir şeyler atıştır'], night: ['sleepy', 'Geç oldu 🌙', 'Artık yatma vakti'] };
  function life() {
    if (S.lifeMascot === false || !api.idle()) return;
    const sl = SLOT(new Date().getHours()); if (!sl) return;
    const key = 'life.' + today() + sl, [mood, title, text] = LIFE[sl];
    if (!ls.get(key)) { ls.set(key, '1'); api.enqueue({ title, text, mood, ttl: 6 }); return; } // her dilimde gün başına bir selam
    if (Math.random() < 0.35) { api.setMood(mood); setTimeout(() => api.idle() && api.setMood('idle'), 4500); }
  }
  setTimeout(life, 25000); setInterval(life, 90000);

  // --- Claude Code günlük özeti sayfası ---
  const fd = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' sa ' + (m % 60) + ' dk' : m + ' dk'; };
  const drawClaude = (s) => {
    s = s || {}; $('#cn').textContent = (s.tasks || 0) + ' görev';
    $('#cl').textContent = s.tasks ? fd(s.ms || 0) + ' çalıştı' + (s.failed ? ' · ' + s.failed + ' takıldı' : '') : 'Henüz görev yok';
  };
  dynbar.on('claude', drawClaude); dynbar.invoke('claude:get').then(drawClaude);

  let wT, eT, armed = '';
  function arm() {
    const k = (S.waterEvery || 0) + '|' + !!S.eyeBreak; if (k === armed) return; armed = k; clearInterval(wT); clearInterval(eT);
    if (+S.waterEvery > 0) wT = setInterval(waterAsk, S.waterEvery * 60000);
    if (S.eyeBreak) eT = setInterval(() => api.enqueue({ title: 'Göz molası', text: '20 saniye uzağa bak', mood: 'happy', ttl: 20 }), 20 * 60000);
  }

  // --- yapılacaklar (ekleme: dynbar todo add, API veya tray menüsü; panelde tıklayınca biter/geri açılır) ---
  function drawTodo() {
    const box = $('#todos'); box.innerHTML = ''; const t = (S.todos || []).slice(0, 3);
    if (!t.length) { box.innerHTML = '<div class="sub">Liste boş. Eklemek için: dynbar todo add "metin"</div>'; return; }
    t.forEach((x, i) => {
      const b = document.createElement('button'); b.textContent = (x.d ? '☑ ' : '☐ ') + x.t; if (x.d) b.style.opacity = 0.5;
      b.onclick = () => dynbar.send('todo', { toggle: i }); box.append(b);
    });
  }

  // --- son dosyalar (Windows) ---
  const drawRec = (list) => {
    const box = $('#recent'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="sub">Son dosya bulunamadı (yalnızca Windows)</div>'; return; }
    list.slice(0, 3).forEach((f, i) => { const b = document.createElement('button'); b.textContent = f.name; b.onclick = () => dynbar.send('recent:open', i); box.append(b); });
  };
  const loadRec = () => dynbar.invoke('recent:get').then((l) => drawRec(l || []));

  // --- geri sayım ---
  function drawCd() {
    const el = $('#cdv'); if (!el) return;
    const d = /^\d{4}-\d\d-\d\d$/.test(S.countdownDate || '') ? new Date(S.countdownDate + 'T00:00:00') : null;
    $('#cdn').textContent = S.countdownName || (d ? '' : 'Ayarlardan tarih seç');
    if (!d) { el.textContent = '–'; return; }
    const n = new Date(), days = Math.round((d - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
    el.textContent = days > 0 ? days + ' gün' : days === 0 ? 'Bugün!' : Math.abs(days) + ' gün önce';
  }

  // --- dünya saatleri ("Ad|Bölge" satırları) ---
  function drawWorld() {
    const box = $('#world'); if (!box) return; box.innerHTML = '';
    String(S.worldClocks || '').split(/\r?\n/).map((l) => l.split('|')).filter((p) => p.length > 1 && p[0].trim()).slice(0, 3).forEach((p) => {
      let t = '?'; try { t = new Date().toLocaleTimeString('tr-TR', { timeZone: p[1].trim(), hour: '2-digit', minute: '2-digit', hour12: S.clock24 === false }); } catch {}
      const d = document.createElement('div'); d.className = 'wrow'; d.innerHTML = '<span></span><b></b>'; d.firstChild.textContent = p[0].trim(); d.lastChild.textContent = t; box.append(d);
    });
    if (!box.children.length) box.innerHTML = '<div class="sub">Ayarlardan şehir ekle (Ad|Bölge)</div>';
  }

  // --- döviz ---
  let rt = null;
  function drawRates() {
    const box = $('#rates'); box.innerHTML = '';
    if (!rt) { box.innerHTML = '<div class="sub">' + (S.pageRates ? 'Yükleniyor…' : '') + '</div>'; return; }
    rt.list.forEach((x) => {
      const d = document.createElement('div'); d.className = 'wrow'; d.innerHTML = '<span></span><b></b>';
      d.firstChild.textContent = '1 ' + x.code; d.lastChild.textContent = x.value.toLocaleString('tr-TR', { maximumFractionDigits: x.value < 1 ? 4 : 2 }) + ' ' + rt.base; box.append(d);
    });
  }
  dynbar.on('rates', (r) => { rt = r; drawRates(); }); dynbar.invoke('rates:get').then((r) => { rt = r; drawRates(); });

  // sayfa açılınca veri tazele (renderer.js go() çağırır)
  api.pageHook = (id) => { if (id === 'recSec') loadRec(); else if (id === 'worldSec') drawWorld(); else if (id === 'cdSec') drawCd(); };
  setInterval(drawWorld, 10000); setInterval(drawCd, 3600000);
})();
