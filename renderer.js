(() => {
  const $ = (s) => document.querySelector(s);
  const island = $('#island'), mascot = $('#mascot'), content = $('#content'), title = $('#title'), text = $('#text');
  const bar = $('#bar'), fill = $('#bar b'), track = $('#track');
  let dots = [], pages = [], cur = null, cfg = {}, hist = [], focusOn = false, ac = null, lastCur = null, armed = false, leaveT = 0;
  let ambient = null, morphT, queue = [], busy = false, sleepT, timerT, nextT, closeT, hoverT, page = 0, wheelSum = 0, lastWheel = 0;
  let typing = null; // satır içi yanıt yazılıyor: {a, x}
  let playing = false, primed = false, lastKey, swipe = 160, toasts = true, locked = false, media = {}, lastD = 0, lockAt = 0;
  const setMood = (m) => { mascot.dataset.mood = m; mascot.dataset.sub = ''; };
  let miniClaude = false, lastDown = 0, subT;
  // Claude'un ne yaptığına göre maskot duruşu (hook "pose" gönderir; yoksa metinden çıkarılır)
  const poseOf = (a) => a.pose || (/yazıyor/.test(a.text || '') ? 'type' : /Komut/i.test(a.text || '') ? 'run' : /bak/i.test(a.text || '') ? 'read' : /arıyor/.test(a.text || '') ? 'search'
    : /Plan|Düşün/i.test(a.text || '') ? 'think' : /ajan/i.test(a.text || '') ? 'agent' : /Ekran/i.test(a.text || '') ? 'screen' : 'type');
  function micro() { // uzun işlerde maskot donmuş kalmasın: ara sıra kameraya bakar, bir yudum alır, gerinir
    clearTimeout(subT);
    subT = setTimeout(() => {
      if (mascot.dataset.mood === 'working' && !isOpen()) {
        const s = ['glance', 'glance', 'sip', 'stretch'][Math.floor(Math.random() * 4)]; mascot.dataset.sub = s;
        setTimeout(() => { if (mascot.dataset.sub === s) mascot.dataset.sub = ''; }, 2300);
      }
      micro();
    }, 14000 + Math.random() * 16000);
  }
  micro();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s) => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  const isOpen = () => island.classList.contains('open');
  const mins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  function isQuiet() {
    if (!cfg.quietOn) return false;
    const n = new Date(), c = n.getHours() * 60 + n.getMinutes(), a = mins(cfg.quietFrom), b = mins(cfg.quietTo);
    return a === b ? false : a < b ? c >= a && c < b : c >= a || c < b;
  }
  const BG = { black: '#000000', graphite: '#17161b', midnight: '#0b1124', plum: '#1c1020', forest: '#0d1a14' };
  const SHADOW = { none: ['none', 'none'], soft: ['0 1px 5px rgba(0,0,0,.25)', '0 3px 12px rgba(0,0,0,.3)'], normal: ['0 4px 14px rgba(0,0,0,.35)', '0 8px 24px rgba(0,0,0,.45)'] };

  function applySettings(s) {
    cfg = s; const r = document.documentElement.style;
    let body, ear, cheek;
    if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) { body = s.accent; ear = `color-mix(in srgb, ${s.accent} 90%, #000)`; cheek = `color-mix(in srgb, ${s.accent} 78%, #ff3d7f)`; }
    else { [, body, ear, cheek] = PALETTE[s.color] || PALETTE.pink; }
    r.setProperty('--body', body); r.setProperty('--ear', ear); r.setProperty('--cheek', cheek);
    r.setProperty('--bg', BG[s.bg] || BG.black); r.setProperty('--bga', s.bgAlpha || 100);
    const sh = SHADOW[s.shadow] || SHADOW.soft; r.setProperty('--sh1', sh[0]); r.setProperty('--sh2', sh[1]);
    r.setProperty('--ui', s.uiScale || 1); r.setProperty('--top', (s.offsetY ?? 10) + 'px');
    document.body.dataset.mode = /^dock/.test(s.mode) ? 'dock' : 'float'; document.body.dataset.anim = s.anim || 'spring';
    swipe = s.swipe || 160; toasts = s.mediaToasts !== false; setTimeout(syncShape, 0);
    document.querySelectorAll('[data-feat]').forEach((sec) => (sec.style.display = s[sec.dataset.feat] === false ? 'none' : '')); layout();
    document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', !s.accent && b.dataset.c === s.color));
    tick();
  }

  function collapse() {
    island.classList.remove('expanded', 'open', 'ask', 'claudework'); dynbar.raise(false); clearTimeout(sleepT);
    setMood(playing ? 'music' : 'idle');
    const sl = cfg.sleepAfter ?? 20;
    if (!playing && sl > 0) sleepT = setTimeout(() => setMood('sleep'), sl * 1000);
  }

  function addHist(x) { // bildirim geçmişi (panelde "Son bildirimler")
    hist.unshift(x); hist.sort((a, b) => b.t - a.t); hist.length = Math.min(hist.length, 20);
    if (window.barApi && window.barApi.onHist) window.barApi.onHist();
  }
  function log(a) {
    if (!a.title || a.key || a.type === 'timer' || a.mood === 'music') return;
    addHist({ title: a.title, text: a.text || '', app: a.app || '', t: Date.now() });
  }

  function ping(kind) { // küçük iki notalı bildirim sesi (ayarlardan açılır)
    if (!cfg.sound || cfg.sound === 'off') return;
    try {
      ac = ac || new AudioContext(); if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime, vol = cfg.sound === 'soft' ? 0.04 : 0.1, notes = kind === 'alert' ? [880, 660] : [660, 990];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.13;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
        o.connect(g); g.connect(ac.destination); o.start(s); o.stop(s + 0.4);
      });
    } catch {}
  }

  function paintNotif(a) { // simge, uygulama adı, ilerleme ve renk dahil bildirim içeriğini çiz
    if (a.mood === 'working') mascot.dataset.pose = poseOf(a);
    island.classList.toggle('claudework', isAmbient(a));
    title.textContent = (a.icon ? a.icon + ' ' : '') + (a.title || '');
    text.textContent = a.app ? (a.text ? a.app + ' · ' + a.text : a.app) : (a.text || '');
    bar.style.display = (a.type === 'timer' || a.progress != null) ? 'block' : 'none';
    fill.style.width = ((a.progress || 0) * 100) + '%'; fill.style.background = a.color || '';
    island.classList.toggle('parcel', !!a.parcel); island.classList.toggle('delivered', !!(a.parcel && a.parcel.done)); // kargo: paket yolda, hedef simgesi uçta
    const rd = $('#rdest'); rd.textContent = a.parcel ? a.parcel.icon || '📁' : '';
    if (a.parcel && a.parcel.done) { rd.classList.remove('pop'); void rd.offsetWidth; rd.classList.add('pop'); }
    const acts = $('#acts'); acts.innerHTML = ''; island.classList.toggle('ask', !!a.actions);
    (a.actions || []).forEach((x) => {
      const b = document.createElement('button'); b.textContent = x.label; b.dataset.a = x.id;
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (x.input && a.cbId && !a.answered) { startTyping(a, x); return; }
        if (x.keep) { if (a.cbId) dynbar.send('notif-action', { cbId: a.cbId, action: x.id }); return; } // kalıcı düğme (ör. hoparlör): bildirim açık kalır
        if (a.answered) return; a.answered = true; // çift tetiklenmeye karşı
        if (a.onAction) a.onAction(x.id); else if (a.cbId) dynbar.send('notif-action', { cbId: a.cbId, action: x.id }); else dynbar.send('ask-answer', { id: a.askId, answer: x.id }); // yerel eylem (su içme), gönderene geri çağrı ya da ana süreçteki onay
        next();
      });
      b.addEventListener('click', (e) => e.stopPropagation()); // mousedown sonrası gelen click adaya ulaşıp paneli açmasın
      acts.append(b);
    });
  }
  // Satır içi yanıt: "Yanıtla" gibi input:true düğmeye basınca adada yazı kutusu açılır (Enter gönderir, Esc iptal). Odak alınamazsa gönderene metinsiz haber verilir.
  function startTyping(a, x) {
    clearTimeout(nextT); typing = { a, x }; island.classList.add('typing'); $('#rin').value = '';
    dynbar.send('typing', true);
    setTimeout(() => { if (!typing) return; $('#rin').focus(); if (!document.hasFocus()) failTyping(); }, 450);
  }
  function endTyping() { typing = null; island.classList.remove('typing'); dynbar.send('typing', false); }
  function submitTyping() {
    if (!typing) return; const t = $('#rin').value.trim(), { a, x } = typing; endTyping(); a.answered = true;
    if (t) dynbar.send('notif-action', { cbId: a.cbId, action: x.id, text: t });
    next();
  }
  function cancelTyping() { if (!typing) return; const a = typing.a; endTyping(); a.sticky ? schedule(a) : next(); }
  function failTyping() { if (!typing) return; const { a, x } = typing; endTyping(); a.answered = true; dynbar.send('notif-action', { cbId: a.cbId, action: x.id }); next(); }
  $('#rin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyping(); } else if (e.key === 'Escape') { e.preventDefault(); cancelTyping(); } });
  $('#rsend').addEventListener('mousedown', (e) => { e.stopPropagation(); submitTyping(); });
  window.addEventListener('blur', () => { if (typing) setTimeout(() => { if (typing && !document.hasFocus()) cancelTyping(); }, 350); });
  function schedule(a) { // kalıcı (sticky) bildirimler tıklanana veya kapatılana kadar durur (en çok 5 dk)
    if (typing) return;
    clearTimeout(nextT);
    nextT = setTimeout(next, a.sticky ? 300000 : (a.ttl || 4) * 1000 * (cfg.ttlScale || 1));
  }
  // Canlı durumlar: kapanana kadar adada kalır, diğer bildirimlerin önüne geçmez, küçültülebilir. anahtar -> maskot hali
  const AMBIENT = { claude: ['working'], render: ['render'], call: ['call', 'talk'] }; // anahtar -> geçerli maskot halleri
  const isAmbient = (x) => !!x && !!AMBIENT[x.key] && AMBIENT[x.key].includes(x.mood);
  const ambientMood = (x) => (x && AMBIENT[x.key] && (AMBIENT[x.key].includes(x.mood) ? x.mood : AMBIENT[x.key][0])) || 'working';
  function push(a) {
    if (AMBIENT[a.key]) { // canlı durum (Claude, render): diğer bildirimlerin önüne geçmez, onlar bitince geri gelir
      if (isAmbient(a)) {
        ambient = a;
        if (a.key === 'call') { miniClaude = false; if (busy && (!cur || cur.key !== 'call')) { queue.unshift(a); next(); return; } } // gelen arama bekletilmez
        if (!busy) { queue.unshift(a); next(); } return;
      }
      if (ambient && ambient.key === a.key) ambient = null;
      miniClaude = false;
    }
    if (a.key) queue = queue.filter((q) => q.key !== a.key); // aynı anahtarlı bekleyen eskiyi at
    if (queue.length >= 50) queue.shift();
    if (a.priority === 'high') { // yüksek öncelik sıranın başına geçer, sayaç dışında anında gösterilir
      queue.unshift(a);
      if (!busy) next(); else if (cur && cur.type !== 'timer') next();
      return;
    }
    queue.push(a); if (!busy || isAmbient(cur)) next(); // Claude canlı durumu diğer bildirimleri bekletmez
  }

  function confetti() { // renkli kâğıt parçaları adanın üstünden dökülür
    const cols = ['#ff6fa5', '#ffd24f', '#4aa8ff', '#5ee09a', '#b48cff', '#ff9f43'];
    for (let i = 0; i < 22; i++) {
      const c = document.createElement('i'); c.className = 'confetti';
      c.style.left = (6 + Math.random() * 88) + '%'; c.style.background = cols[i % cols.length];
      c.style.setProperty('--x', (Math.random() * 50 - 25) + 'px'); c.style.setProperty('--y', (50 + Math.random() * 40) + 'px');
      c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); c.style.setProperty('--d', (1.2 + Math.random() * 0.9) + 's');
      c.style.animationDelay = (Math.random() * 0.35) + 's';
      island.append(c); setTimeout(() => c.remove(), 2600);
    }
  }
  const kbdKind = (a) => a.mood === 'call' ? 'call' : a.key === 'render-done' ? 'render' : a.mood === 'lowbat' ? 'battery'
    : !a.key && a.type !== 'timer' && !isAmbient(a) && !['music', 'claude', 'working', 'render'].includes(a.mood) ? 'notif' : '';
  function next() {
    clearTimeout(nextT); clearInterval(timerT);
    if (typing) endTyping();
    if (cur && cur.askId && !cur.answered) { cur.answered = true; dynbar.send('ask-answer', { id: cur.askId, answer: 'dismissed' }); } // yanıtlanmadan geçilen onay: terminale düşsün
    const a = queue.shift() || ambient; cur = a || null;
    if (!a) { busy = false; return collapse(); }
    const mini = miniClaude && isAmbient(a); // küçültülmüş Claude durumu: adayı açmadan hap olarak kalır
    busy = true; clearTimeout(sleepT); clearTimeout(closeT); dynbar.raise(!mini); log(a);
    const wasExpanded = island.classList.contains('expanded');
    content.classList.add('swap'); island.classList.remove('open');
    setTimeout(() => {
      paintNotif(a);
      setMood('idle'); void mascot.offsetWidth; setMood(a.mood || 'happy');
      if (a.mood === 'party') confetti();
      const kb = kbdKind(a); if (kb) dynbar.send('kbd', kb); // klavye ışığı geri bildirimi (Legion/LOQ, ayardan açılırsa)
      if (a.mood === 'claude') { clearTimeout(morphT); morphT = setTimeout(() => { if (cur === a) setMood('happy'); }, 3400); } // Claude Code maskotu bir süre kalır, sonra eski haline döner
      if (mini) { island.classList.remove('expanded', 'open', 'ask'); content.classList.remove('swap'); schedule(a); return; }
      island.classList.add('expanded'); content.classList.remove('swap');
      if (a.type !== 'timer' && (!a.key || a.askId) && a.mood !== 'music') ping(a.mood);
      a.type === 'timer' ? runTimer(a) : schedule(a);
    }, wasExpanded ? 220 : 0);
  }

  function runTimer(a) {
    const total = a.seconds || 10, end = Date.now() + total * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      text.textContent = fmt(left); fill.style.width = (100 - (left / total) * 100) + '%';
      if (left <= 0) { clearInterval(timerT); title.textContent = 'Süre doldu!'; text.textContent = a.title || ''; setMood('alert'); ping('alert'); dynbar.send('kbd', 'timer'); nextT = setTimeout(next, 3500); }
    };
    clearInterval(timerT); tick(); timerT = setInterval(tick, 250);
  }

  // Tıklama bölgesi: ana süreç imleç adanın üstündeyken pencereyi tıklanabilir yapar (yalnızca ada bölgesi)
  const SZ = { c: [112, 36], e: [400, 78], a: [400, 112], o: [420, 136] };
  let shapeT, shapeArea = 0;
  function syncShape() {
    const ui = cfg.uiScale || 1, [w, h] = SZ[isOpen() ? 'o' : island.classList.contains('ask') ? 'a' : island.classList.contains('expanded') ? 'e' : 'c'];
    const top = document.body.dataset.mode === 'dock' ? 0 : (cfg.offsetY ?? 10), W = window.innerWidth, pad = 14;
    const rect = { x: Math.max(0, Math.round((W - w * ui) / 2) - pad), y: 0, width: Math.min(W, Math.round(w * ui) + pad * 2), height: Math.round((top + h) * ui) + 16 };
    const area = rect.width * rect.height, apply = () => { shapeArea = area; dynbar.send('shape', rect); };
    clearTimeout(shapeT);
    if (area >= shapeArea) apply(); else shapeT = setTimeout(apply, 900); // küçülürken animasyon bitsin
  }
  new MutationObserver(syncShape).observe(island, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { shapeArea = 0; syncShape(); }, 5000); // güvenlik: bölge zamanla bozulursa yeniden bildir
  // Giriş / çıkış animasyonu. Yüzen: yukarıdan yay gibi iner. Yapışık: üst kenardan ayrılmaz; dar ve kısa bir çentik olarak
  // kenardan büyür (yaysız, kenara sabit), çıkarken aynı hareketle kenara geri çekilir.
  let enterAnim = null;
  const motionOk = () => cfg.anim !== 'off' && island.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDock = () => document.body.dataset.mode === 'dock';
  const NOTCH = { transform: 'translateX(-50%) scale(.5,.12)', opacity: 0, transformOrigin: '50% 0' };
  const FULL = { transform: 'translateX(-50%) scale(1,1)', opacity: 1, transformOrigin: '50% 0' };
  function enter() {
    if (enterAnim) { enterAnim.cancel(); enterAnim = null; }
    if (!motionOk()) return;
    enterAnim = isDock()
      ? island.animate([NOTCH, { ...NOTCH, opacity: 1, offset: 0.18 }, FULL], { duration: 480, easing: 'cubic-bezier(.2,.85,.25,1)' })
      : island.animate([{ transform: 'translateX(-50%) translateY(-70px) scale(.7)', opacity: 0 }, { transform: 'translateX(-50%) translateY(0) scale(1)', opacity: 1 }],
        { duration: 800, easing: getComputedStyle(document.documentElement).getPropertyValue('--spring').trim() || 'ease-out' });
  }
  function leave() { // yalnızca yapışık modda: ana süreç pencereyi bu animasyon bittikten sonra gizler
    if (!motionOk() || !isDock()) return;
    if (enterAnim) enterAnim.cancel();
    enterAnim = island.animate([FULL, NOTCH], { duration: 240, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' });
  }
  dynbar.on('entrance', enter);
  dynbar.on('exit', leave);
  dynbar.on('hush', (v) => island.classList.toggle('hush', !!v)); // Spotlight arama hapı açıkken ada çekilir
  function layout() { // açık sayfaları (ayarlardan kapatılmayanları) listele, noktaları yeniden çiz
    pages = [...document.querySelectorAll('#track section')].filter((s) => s.style.display !== 'none');
    $('.pdots').innerHTML = pages.map(() => '<i></i>').join(''); dots = [...document.querySelectorAll('.pdots i')];
    go(Math.min(page, pages.length - 1), false, true);
  }
  function go(i, snap, quietHook) { // snap: animasyonsuz yerleş; quietHook: sayfa kancasını (veri yenileme) çağırma
    page = Math.max(0, Math.min(pages.length - 1, i));
    if (snap) track.style.transition = 'none';
    track.style.transform = `translateX(${-page * 100}%)`;
    if (snap) { void track.offsetWidth; track.style.transition = ''; }
    dots.forEach((d, k) => d.classList.toggle('on', k === page));
    pages.forEach((s, k) => s.classList.toggle('active', k === page));
    const sec = pages[page];
    if (!quietHook && sec && sec.id && window.barApi && window.barApi.pageHook) window.barApi.pageHook(sec.id);
  }
  // güvenlik: panel hiçbir zaman kendiliğinden kaydırılmasın, ada boyutu bitince sayfa hizası yeniden oturtulsun
  $('#panel').addEventListener('scroll', (e) => { e.target.scrollLeft = 0; e.target.scrollTop = 0; });
  island.addEventListener('transitionend', (e) => { if (e.target === island && (e.propertyName === 'width' || e.propertyName === 'height')) go(page, true, true); });
  new ResizeObserver(() => go(page, true, true)).observe($('#panel'));

  const insideCur = () => { // imleç adanın (biraz paylı) üstünde mi?
    if (!lastCur) return false;
    const r = island.getBoundingClientRect(), m = 14;
    return lastCur.x >= r.left - m && lastCur.x <= r.right + m && lastCur.y >= r.top - m && lastCur.y <= r.bottom + m;
  };
  function openPanel() {
    clearTimeout(sleepT); dynbar.raise(true); setMood('happy'); island.classList.add('expanded', 'open');
    armed = insideCur(); // kısayolla açıldıysa ve imleç dışarıdaysa, imleç bir kez içeri girene kadar kendiliğinden kapanmaz
    go(playing && pages.includes($('#media')) ? 0 : Math.max(0, pages.indexOf($('#clockSec'))), true);
  }
  function showMini() { miniClaude = true; island.classList.remove('expanded', 'open', 'ask'); dynbar.raise(false); setMood(ambientMood(cur)); }
  function restoreFull() { miniClaude = false; if (cur) paintNotif(cur); island.classList.remove('open'); island.classList.add('expanded'); dynbar.raise(true); setMood(ambientMood(cur)); }
  function closePanel() {
    clearTimeout(closeT); clearTimeout(leaveT); leaveT = 0;
    if (!busy) return collapse();
    if (!isOpen()) return;
    island.classList.remove('open');
    // panel açılırken maskot "happy" olmuştu: meşgul görünüme dön (Claude çalışıyorsa çalışan maskot, küçültülmüşse hap)
    if (cur && isAmbient(cur) && miniClaude) showMini(); else if (cur) setMood(cur.mood || 'happy');
  }
  function activate() { // tıklama, kısayol veya üzerine gelme: bildirim varsa geç (url varsa aç), yoksa paneli aç
    if (isOpen() || typing) return;
    if (busy && !isAmbient(cur)) { if (cur && cur.url) dynbar.send('open-url', cur.url); next(); } else openPanel(); // canlı durum varken tıklayınca panel açılır
  }

  // Panelin otomatik kapanması fare olaylarına değil ana süreçten gelen imleç konumuna dayanır
  // (Win+D sonrası fare olayları kaybolsa bile panel kapanır)
  dynbar.on('cursor', ({ x, y }) => {
    lastCur = { x, y };
    if (!isOpen()) { armed = false; clearTimeout(leaveT); leaveT = 0; return; }
    if (insideCur()) { armed = true; clearTimeout(leaveT); leaveT = 0; return; }
    const cd = cfg.closeDelay ?? 3.5;
    if (armed && cd > 0 && !leaveT) leaveT = setTimeout(() => { leaveT = 0; if (isOpen()) closePanel(); }, cd * 1000);
  });

  // olaylar
  dynbar.onActivity((a) => {
    if (a.key && busy && cur && cur.key === a.key) { const prevMood = cur.mood; cur = a; if (isAmbient(a)) ambient = a; paintNotif(a); if (isAmbient(a) && a.mood !== prevMood) setMood(miniClaude ? ambientMood(a) : a.mood); if (a.parcel) setMood(a.mood || 'courier'); schedule(a); return; } // aynı anahtar: yerinde güncelle (ilerleme, ses/parlaklık göstergesi)
    push(a);
  });
  dynbar.on('missed', (list) => (list || []).forEach(addHist));
  dynbar.on('dismiss', (d) => {
    const key = d && d.key;
    if (!key || (ambient && ambient.key === key)) ambient = null;
    queue = key ? queue.filter((q) => q.key !== key) : [];
    if (busy && (!key || (cur && cur.key === key))) next();
  });
  dynbar.on('toggle', (m) => {
    if (m === 'close') return closePanel();
    if (m === 'open') { if (!isOpen()) activate(); return; }
    isOpen() ? closePanel() : activate();
  });
  dynbar.onSettings(applySettings); dynbar.getSettings().then(applySettings);
  dynbar.on('workspace-switched', () => { syncShape(); });
  island.addEventListener('mouseenter', () => {
    dynbar.setInteractive(true);
    clearTimeout(closeT);
    if (cfg.openOn === 'hover' && !busy && !isOpen()) { clearTimeout(hoverT); hoverT = setTimeout(() => { if (!busy && !isOpen()) openPanel(); }, 350); }
  });
  island.addEventListener('mousemove', () => {
    dynbar.setInteractive(true);
  });
  island.addEventListener('mouseleave', () => {
    dynbar.setInteractive(false);
    clearTimeout(hoverT);
  });
  // Hem mousedown hem click ile tıklama kaçırma ihtimalini sıfırla
  island.addEventListener('mousedown', () => dynbar.send('dom-click'), true); // yakalama aşaması: stopPropagation eden düğmeler dahil
  island.addEventListener('mousedown', (e) => {
    dynbar.setInteractive(true);
    const now = Date.now(); // küçültülmüş Claude hapına çift tıklama: tekrar genişlet
    if (e.button === 0 && miniClaude && cur && isAmbient(cur) && now - lastDown < 450) { lastDown = 0; restoreFull(); return; }
    lastDown = now;
    if (e.button === 0) activate();
  });
  island.addEventListener('click', (e) => {
    dynbar.setInteractive(true);
    if (e.button === 0) activate();
  });
  dynbar.on('synthetic-click', ({ x, y }) => { // ana süreçten gelen tıklama: gerçek fare olayı gibi o noktadaki öğeye gönder
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, view: window };
    const was = isOpen(); el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    if (isOpen() === was && !busy) el.dispatchEvent(new MouseEvent('click', o)); // mousedown paneli açtı/kapattıysa click gönderme (çift tetiklenmesin)
  });
  $('#minbtn').addEventListener('mousedown', (e) => { e.stopPropagation(); showMini(); });
  $('#close').addEventListener('mousedown', (e) => { e.stopPropagation(); closePanel(); });
  $('.pdots').addEventListener('mousedown', (e) => { e.stopPropagation(); const k = [...$('.pdots').children].indexOf(e.target); if (k >= 0) go(k); });
  // iki parmakla kaydırma (touchpad) veya fare tekerleği ile sayfa değiştir
  island.addEventListener('wheel', (e) => {
    if (!isOpen()) return; e.preventDefault();
    const now = Date.now(), gap = now - lastWheel, d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    lastWheel = now;
    if (gap > 120) { wheelSum = 0; locked = false; lastD = 0; }
    if (locked && now - lockAt > 180 && (Math.sign(d) !== Math.sign(lastD) || Math.abs(d) > Math.abs(lastD) * 1.4 + 2)) { locked = false; wheelSum = 0; }
    lastD = d;
    if (locked) return;
    wheelSum += d;
    if (Math.abs(wheelSum) > swipe) { go(page + (wheelSum > 0 ? 1 : -1)); wheelSum = 0; locked = true; lockAt = now; }
  }, { passive: false });

  const I = { play: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>', pause: '<svg viewBox="0 0 16 16"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>' };
  const mime = (b) => (b.startsWith('/9j/') ? 'jpeg' : b.startsWith('R0lGOD') ? 'gif' : b.startsWith('UklGR') ? 'webp' : 'png');
  function applyMedia(m) {
    media = m && !m.none ? m : {}; const was = playing; playing = media.status === 'Playing';
    island.classList.toggle('playing', playing);
    $('#mt').textContent = media.title || 'Çalan bir şey yok'; $('#ma').textContent = media.artist || (media.error ? '⚠ ' + String(media.error).slice(0, 70) : '');
    $('#art').style.backgroundImage = media.art ? `url(data:image/${media.artMime || mime(media.art)};base64,${media.art})` : '';
    $('#art').classList.toggle('noart', !media.art);
    $('#pp').innerHTML = playing ? I.pause : I.play;
    $('#mprog b').style.width = media.dur > 0 ? Math.min(100, (media.pos / media.dur) * 100) + '%' : '0%';
    $('#mtime').textContent = media.title ? fmt(Math.floor(media.pos || 0)) : '';
    if (playing !== was && !busy && !isOpen()) collapse();
    if (primed && media.key !== lastKey && toasts && playing && media.title && !isOpen() && !cfg.dnd && !isQuiet() && !focusOn) {
      push({ title: media.title, text: media.artist, mood: 'music', ttl: 3 });
    }
    lastKey = media.key; primed = true;
  }
  dynbar.onMedia(applyMedia); dynbar.getMedia().then(applyMedia);
  document.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => dynbar.media(b.dataset.m)));
  Object.entries(PALETTE).forEach(([k, p]) => {
    const b = document.createElement('button'); b.className = 'sw'; b.title = p[0]; b.dataset.c = k; b.style.background = p[1];
    b.addEventListener('click', () => dynbar.setSettings({ color: k, accent: '' })); $('#sws').append(b);
  });
  function tick() {
    const n = new Date(), h24 = cfg.clock24 !== false; let h = n.getHours();
    const suf = h24 ? '' : (h >= 12 ? ' PM' : ' AM'); if (!h24) h = h % 12 || 12;
    $('#clock').textContent = pad(h) + ':' + pad(n.getMinutes()) + (cfg.clockSeconds ? ':' + pad(n.getSeconds()) : '') + suf;
    $('#date').textContent = n.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) + (window.barApi && window.barApi.waterLine ? window.barApi.waterLine() : '');
  }
  tick(); setInterval(tick, 1000);
  window.barApi = {
    enqueue: (a) => { if ((cfg.dnd || isQuiet() || focusOn) && !a.force) return; push(a); },
    setMood, layout, playing: () => playing, idle: () => !busy && !isOpen() && !playing, hist, onHist: null, pageHook: null,
    setFocus: (v) => { focusOn = !!v && cfg.focusDnd !== false; dynbar.send('focus', !!v); }
  };
  layout(); collapse(); syncShape(); enter();
})();
