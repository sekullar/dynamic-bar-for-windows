// "Sıvı cam" (Liquid Glass) malzemesi. Elektron şeffaf pencerede gerçek arka plan bulanıklığı yok; bu yüzden arkadaki görüntü (duvar kağıdı ya da ekran
// yakalaması) cama arka plan olarak verilir ve üç şey eklenir:
//  1) kenarlarda ışığı büküp mercek etkisi veren SVG yer değiştirme haritası (feDisplacementMap, SDF'den üretilir),
//  2) bulanıklık + doygunluk + beyaz tint,
//  3) kenar parlaması (fare yönüne dönen konik gradyan) ve fareyi izleyen yansıma.
// Kullanım: Glass.setBackdrop({url, mode:'cover'|'exact', iw, ih, sw, sh, ox, oy}); Glass.attach(el, {radius, blur, bezel, scale});
(() => {
  const M = 40; // kırılma ve bulanıklık için kenar payı (px)
  let bd = null, uid = 0;
  const items = new Set();
  let defs = null;
  const svgDefs = () => {
    if (defs) return defs;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.style.cssText = 'position:absolute;pointer-events:none';
    document.body.append(s); defs = s; return s;
  };

  // yuvarlatılmış dikdörtgenin içe doğru uzaklığına göre yer değiştirme haritası: R,G = yön * büyüklük (128 = sıfır)
  function makeMap(w, h, r, bezel) {
    const k = Math.min(2, Math.max(1, window.devicePixelRatio || 1)), W = Math.round(w * k), H = Math.round(h * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data, hx = w / 2, hy = h / 2;
    r = Math.min(r, hx, hy);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = (x + .5) / k - hx, py = (y + .5) / k - hy, qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)), dist = -(out + Math.min(Math.max(qx, qy), 0) - r);
      let R = 128, G = 128;
      if (dist >= 0 && dist < bezel) {
        const t = 1 - dist / bezel, mag = t * t * t; // kenara yaklaştıkça hızla artan kırılma
        let nx, ny;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = Math.sign(px) * qx / l; ny = Math.sign(py) * qy / l; }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
        R = 128 + nx * mag * 127; G = 128 + ny * mag * 127;
      }
      const i = (y * W + x) * 4; d[i] = R; d[i + 1] = G; d[i + 2] = 128; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c.toDataURL();
  }

  function place(it) {
    const b = it.el.getBoundingClientRect(), w = Math.max(1, Math.round(b.width)), h = Math.max(1, Math.round(b.height));
    const img = it.img;
    img.style.left = -M + 'px'; img.style.top = -M + 'px'; img.style.width = w + 2 * M + 'px'; img.style.height = h + 2 * M + 'px';
    if (bd && bd.url) {
      let bw = bd.sw, bh = bd.sh, offX = 0, offY = 0;
      if (bd.mode === 'cover') { const k = Math.max(bd.sw / bd.iw, bd.sh / bd.ih); bw = bd.iw * k; bh = bd.ih * k; offX = (bd.sw - bw) / 2; offY = (bd.sh - bh) / 2; }
      const X = (bd.ox || 0) + b.left, Y = (bd.oy || 0) + b.top;
      img.style.backgroundImage = `url("${bd.url}")`;
      img.style.backgroundSize = bw + 'px ' + bh + 'px';
      img.style.backgroundPosition = (offX - (X - M)) + 'px ' + (offY - (Y - M)) + 'px';
    } else img.style.backgroundImage = 'none';
    if (!it.map) return;
    const key = w + 'x' + h + 'r' + it.r;
    if (key === it.key) return;
    const regen = () => { // harita yalnızca boyut değişince ve değişim durulunca yeniden üretilir (dock büyütürken her karede değil)
      const bb = it.el.getBoundingClientRect(), ww = Math.max(1, Math.round(bb.width)), hh = Math.max(1, Math.round(bb.height));
      it.key = ww + 'x' + hh + 'r' + it.r;
      it.map.setAttribute('href', makeMap(ww, hh, it.r, it.bezel)); it.map.setAttribute('width', ww); it.map.setAttribute('height', hh);
    };
    clearTimeout(it.t);
    if (!it.key) regen(); else it.t = setTimeout(regen, 90);
  }

  function attach(el, o = {}) {
    if (el._glass) return el._glass;
    const r = o.radius ?? 22, blur = o.blur ?? 9, bezel = o.bezel ?? 16, scale = o.scale ?? 26, id = 'gf' + (++uid);
    el.classList.add('glass'); el.style.borderRadius = r + 'px';
    el.insertAdjacentHTML('afterbegin', '<div class="g-clip"><div class="g-img"></div></div><div class="g-tint"></div><div class="g-hi"></div><div class="g-rim"></div>');
    if (o.flat) { // hafif cam: kırılma yok, yalnızca bulanıklık (çok sayıda karo için hızlı)
      const im0 = el.querySelector('.g-img'); im0.style.filter = `blur(${blur}px) saturate(1.8) brightness(1.06)`;
      const it0 = { el, img: im0, r, bezel, key: 'flat', map: null }; items.add(it0); el._glass = it0;
      new ResizeObserver(() => place(it0)).observe(el); place(it0); return it0;
    }
    const svg = svgDefs(), ns = 'http://www.w3.org/2000/svg';
    const f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB'); f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/><feFlood flood-color="rgb(128,128,128)" result="n"/>` +
      `<feImage x="${M}" y="${M}" width="10" height="10" result="m0" preserveAspectRatio="none"/><feMerge result="map"><feMergeNode in="n"/><feMergeNode in="m0"/></feMerge>` +
      `<feDisplacementMap in="b" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
    svg.append(f);
    const img = el.querySelector('.g-img'); img.style.filter = `url(#${id}) saturate(1.9) brightness(1.06)`;
    const it = { el, img, r, bezel, key: '', map: f.querySelector('feImage'), f };
    items.add(it); el._glass = it;
    new ResizeObserver(() => place(it)).observe(el);
    // fare: kenar parlamasının açısı ve yansıma konumu
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px');
      el.style.setProperty('--ang', Math.round(Math.atan2(y - b.height / 2, x - b.width / 2) * 180 / Math.PI + 90) + 'deg');
    });
    place(it);
    return it;
  }
  const setBackdrop = (b) => { bd = b; items.forEach(place); };
  const relayout = () => items.forEach((it) => { it.key = ''; place(it); });

  // Yaylı yavaşlama (sönümlü yay) eğrisi: CSS linear() olarak. bounce 0..1
  function spring(bounce = .3, steps = 48) {
    const a = 9 - bounce * 3.2, b = 6 + bounce * 15, pts = [];
    for (let i = 0; i <= steps; i++) { const t = i / steps * 1.2; pts.push((1 - Math.exp(-a * t) * (Math.cos(b * t) + (a / b) * Math.sin(b * t))).toFixed(4)); }
    pts[pts.length - 1] = '1';
    return 'linear(' + pts.join(',') + ')';
  }

  // Panel açılışı: tetikleyen simgenin olduğu noktadan sıvı gibi büyür (ölçek + köşe yuvarlaklığı + bulanıklık)
  function morphIn(el, ox, oy, o = {}) {
    const r = o.radius ?? 22;
    el.style.transformOrigin = `${ox}px ${oy}px`;
    const a = el.animate([
      { transform: 'scale(.2, .12)', opacity: 0 },
      { transform: 'scale(1, 1)', opacity: 1 }
    ], { duration: o.duration ?? 300, easing: spring(o.bounce ?? .22), fill: 'both' });
    el.querySelectorAll('[data-stagger]').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, delay: 30 + Math.min(i, 8) * 12, easing: spring(.15), fill: 'backwards' }));
    return a;
  }
  function morphOut(el, ox, oy, o = {}) {
    const r = o.radius ?? 22;
    el.style.transformOrigin = `${ox}px ${oy}px`;
    return el.animate([
      { transform: 'scale(1,1)', opacity: 1 },
      { transform: 'scale(.3,.18)', opacity: 0 }
    ], { duration: 140, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'both' });
  }

  window.Glass = { attach, setBackdrop, relayout, spring, morphIn, morphOut };
})();
