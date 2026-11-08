/* No audio analyser is needed: the album carries 20 Hz bass/high envelopes. */
(() => {
  'use strict';
  const api = window.JLV;
  const canvas = document.getElementById('fx');
  if (!api || !canvas || window.JLVFX) return;
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const tracks = api.tracks || [];
  const sections = api.sections || [];
  const fin = document.getElementById('fin');
  const intro = document.getElementById('intro');
  const fill = document.getElementById('fill');
  const timeLeft = document.getElementById('tl');
  const timeRight = document.getElementById('tr');
  const envelopes = new WeakMap();
  const videoContexts = new WeakMap();
  let width = 1, height = 1, dpr = 1, wide = false;
  let reduced = motionQuery.matches, quality = 1;
  let particles = [], groups = [], shards = [], rings = [], glowSprites = [], trailGlowSprites = [], edgeGlowSprites = [];
  let clockImpactTimer = 0;
  let clockCursor = null, clockRaf = 0, clockTimer = 0, clockVisible = false;
  let mouseX = -100, mouseY = -100, lastTrailX = -100, lastTrailY = -100, trailSlot = 0, liveTrail = 0;
  let trailColors = ['rgb(201,168,255)', 'rgb(127,212,255)', 'rgb(238,246,255)'];
  const cursorTrail = Array.from({ length: 1440 }, () => ({ alive: false }));
  const finePointerQuery = matchMedia("(any-pointer: fine) and (any-hover: hover)");
  let bass = 0, high = 0, previousBass = 0, kick = 0;
  let colors = ['rgb(201,168,255)', 'rgb(127,212,255)', 'rgb(238,246,255)'];
  let paletteTarget = colors.slice(), paletteFrom = [], paletteTo = [], paletteStart = 0, paletteBlend = 1, paletteKey = '';
  let oldGlowSprites = [], oldEdgeGlowSprites = [];
  const paletteTextures = new Map();
  let activeIndex = -1, activeSection = null, activeMedia = null;
  let page = Number.isFinite(api.page) ? api.page : -1;
  let frameId = 0, lastFrame = 0, lastEnergy = 0, lastBackdrop = 0;
  let lastKick = 0, qualityStart = 0, costSum = 0, costCount = 0;
  let finaleReward = false, lastProgressSecond = -1;
  let disposed = false;
  const scroller = document.getElementById("scroller");
  let scrollPosition = scroller ? scroller.scrollTop : 0, scrollStamp = 0, scrollTarget = 0, scrollFlow = 0, scrollDirection = 1;
  let flowWritten = -1, scrollMoving = false, lastSettle = 0, entrySection = null, entryDeadline = 0, flowRibbon = null;
  let slideOverlay = null, slideTimer = 0, slideSection = null, slideSerial = 0, slideAnimations = [];
  let dustTravel = 0, dustTravelTarget = 0, viewX = 0, viewY = 0, viewTargetX = 0, viewTargetY = 0;
  const TAU = Math.PI * 2;
  const wideGlowSpots = [[.005,.05],[.995,.95],[.005,.95],[.995,.05]], narrowGlowSpots = [[.03,.85],[.97,.13]];
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const format = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };
  function rgb(hex) {
    const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex || '');
    if (!valid) return 'rgb(215,226,255)';
    const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
    const n = parseInt(h, 16);
    return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')';
  }
  function setPalette(track, reward) {
    if (reward && !track) track = tracks.find(item => item.n === 6);
    const palette = (track && track.pal || ['#c9a8ff', '#7fd4ff']).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    const vivid = hex => {
      const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return (Math.max(r, g, b) - Math.min(r, g, b)) * Math.max(r, g, b) / 255;
    };
    palette.sort((a, b) => vivid(b) - vivid(a));
    const next = [rgb(palette[0] || '#c9a8ff'), rgb(palette[1] || '#7fd4ff')];
    const bright = channels(next[1]).map(value => Math.round(value * .23 + 255 * .77));
    next.push('rgb(' + bright.join(',') + ')');
    const key = next.join('|');
    if (key === paletteKey) return;
    const old = textureSet(colors, false);
    oldGlowSprites = old.glow; oldEdgeGlowSprites = old.edge;
    paletteKey = key; paletteFrom = colors.map(channels); paletteTo = next.map(channels);
    paletteTarget = next; paletteStart = performance.now(); paletteBlend = reduced ? 1 : 0;
    rebuildGlowSprites(next);
    next.forEach((color, i) => document.documentElement.style.setProperty('--jlv-cursor-' + ['a','b','light'][i], color));
    document.dispatchEvent(new CustomEvent('jlv:palette', { detail:{ colors:next.slice(), track:track && track.n } }));
    updatePalette(paletteStart);
  }
  function channels(color) { return (color.match(/\d+/g) || [201,168,255]).slice(0,3).map(Number); }
  function updatePalette(time) {
    if (!paletteTo.length) return;
    const phase = reduced ? 1 : clamp((time - paletteStart) / 620, 0, 1);
    paletteBlend = phase * phase * (3 - 2 * phase);
    colors = paletteTo.map((target,i) => 'rgb(' + target.map((value,j) => Math.round(paletteFrom[i][j] + (value - paletteFrom[i][j]) * paletteBlend)).join(',') + ')');
    trailColors = colors;
    if (clockCursor) colors.forEach((color,i) => clockCursor.style.setProperty('--jlv-cursor-' + ['a','b','light'][i],color));
    if (phase === 1) { paletteTo = []; oldGlowSprites = []; oldEdgeGlowSprites = []; }
  }
  function decode(value) {
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value)) return Uint8Array.from(value);
    try { return Uint8Array.from(atob(value || ''), c => c.charCodeAt(0)); }
    catch (_) { return new Uint8Array(0); }
  }
  function envelope(track) {
    if (!track) return null;
    let data = envelopes.get(track);
    if (!data) { data = { b: decode(track.B || track.envB), h: decode(track.Hh || track.envH) }; envelopes.set(track, data); }
    return data;
  }
  function addRift(section) {
    if (!section || section.querySelector('.jlv-rift')) return;
    const rift = document.createElement('div');
    rift.className = 'jlv-rift'; rift.setAttribute('aria-hidden', 'true');
    section.appendChild(rift);
  }
  sections.forEach(addRift);
  if (fin && !fin.querySelector('.jlv-reward-halo')) {
    const halo = document.createElement('div'); halo.className = 'jlv-reward-halo'; halo.setAttribute('aria-hidden', 'true'); fin.appendChild(halo);
  }
  if (intro) requestAnimationFrame(() => intro.classList.add('jlv-ready'));

  function makeGlowSprite(color) {
    const sprite = document.createElement('canvas'); sprite.width = 64; sprite.height = 64;
    const painter = sprite.getContext('2d');
    if (!painter) return null;
    const aura = painter.createRadialGradient(32, 32, 0, 32, 32, 31);
    aura.addColorStop(0, 'rgba(255,255,255,1)');
    aura.addColorStop(.075, color); aura.addColorStop(.19, color);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    painter.globalAlpha = .7; painter.fillStyle = aura; painter.fillRect(0, 0, 64, 64);
    painter.globalAlpha = .75; painter.strokeStyle = color; painter.lineWidth = .8;
    painter.beginPath(); painter.moveTo(32, 14); painter.lineTo(32, 50);
    painter.moveTo(19, 32); painter.lineTo(45, 32); painter.stroke();
    painter.globalAlpha = 1; painter.fillStyle = '#fff'; painter.beginPath(); painter.arc(32, 32, 1.4, 0, TAU); painter.fill();
    return sprite;
  }
  function textureSet(palette, cached = true) {
    const key = palette.join('|');
    if (cached && paletteTextures.has(key)) return paletteTextures.get(key);
    const texture = { glow:palette.map(makeGlowSprite), edge:palette.slice(0,2).map(color => {
      const sprite = document.createElement("canvas"); sprite.width = 128; sprite.height = 128; const painter = sprite.getContext("2d");
      if (!painter) return null; const aura = painter.createRadialGradient(64,64,0,64,64,64);
      aura.addColorStop(0,color); aura.addColorStop(1,"rgba(0,0,0,0)"); painter.fillStyle = aura; painter.fillRect(0,0,128,128); return sprite;
    }) };
    if (cached) { if (paletteTextures.size >= 32) paletteTextures.delete(paletteTextures.keys().next().value); paletteTextures.set(key,texture); }
    return texture;
  }
  function rebuildGlowSprites(palette = colors) {
    // Textures are made only when the song changes, never during a frame.
    const texture = textureSet(palette);
    glowSprites = texture.glow; edgeGlowSprites = texture.edge; trailGlowSprites = texture.glow;
  }
  function paintSprite(current, previous, tint, x, y, w, h) {
    const alpha = ctx.globalAlpha, old = previous[tint], next = current[tint];
    if (old && paletteBlend < 1) { ctx.globalAlpha = alpha * (1 - paletteBlend); ctx.drawImage(old,x,y,w,h); }
    if (next) { ctx.globalAlpha = alpha * (old ? paletteBlend : 1); ctx.drawImage(next,x,y,w,h); }
    ctx.globalAlpha = alpha;
  }
  function makeParticle(edge) {
    const quadrant = Math.floor(Math.random() * 4), sizeChoice = Math.random(), layer = Math.floor(Math.random() * 3);
    const kind = sizeChoice >= .97 ? 2 : sizeChoice >= .85 ? 1 : 0;
    return {
      edge, side: quadrant % 2, top: quadrant < 2,
      x: Math.random(), y: edge ? (quadrant < 2 ? Math.pow(Math.random(), 1.5) * .36 : 1 - Math.pow(Math.random(), 1.5) * .36) : Math.random(),
      layer, z: .1 + layer * .3 + Math.random() * .16, speed: .18 + Math.random() * .75,
      kind, radius: kind === 2 ? 5 + Math.random() * 4 : kind === 1 ? 1 + Math.random() * .5 : .3 + Math.random() * .7,
      phase: Math.random() * TAU, group: Math.floor(Math.random() * 6) + (edge ? 6 : 0)
    };
  }
  function rebuildParticles() {
    wide = width / height > 1.94;
    const mobile = width < 720;
    // A dense field inside the clip is balanced by an even richer corner field.
    const coreCount = Math.round((wide ? Math.min(3200, 2500 + (width / height - 3440 / 1440) * 250) : mobile ? 640 : 2000) * quality * (reduced ? .4 : 1));
    const edgeCount = Math.round((wide ? Math.min(4600, 3500 + (width / height - 3440 / 1440) * 400) : mobile ? 220 : 760) * quality * (reduced ? .4 : 1));
    particles = Array.from({ length: coreCount + edgeCount }, (_, i) => makeParticle(i >= coreCount));
    groups = Array.from({ length: 12 }, () => []);
    for (const p of particles) groups[p.group].push(p);
  }
  function resize() {
    clearSlide();
    width = Math.max(1, innerWidth); height = Math.max(1, innerHeight);
    scrollPosition = scroller ? scroller.scrollTop : 0;
    dustTravel = 0; dustTravelTarget = 0;
    // Keep a 4K desktop's FX buffer bounded; CSS geometry itself stays resolution independent.
    const pixelBudget = width < 720 ? 3700000 : 7600000;
    dpr = Math.min(devicePixelRatio || 1, width < 720 ? 1.6 : 1.85, Math.sqrt(pixelBudget / (width * height))) * Math.sqrt(quality);
    dpr = Math.max(.7, dpr);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildParticles();
    lastBackdrop = 0;
  }
  rebuildGlowSprites();
  resize();

  function emitEnergy(time) {
    const medium = api.media || activeMedia;
    const index = Number.isFinite(api.current) ? api.current : activeIndex;
    const track = tracks[index];
    const data = envelope(track);
    const mediaTime = medium ? Number(medium.currentTime) || 0 : 0;
    let low = 0, top = 0;
    if (data && medium && !medium.paused && !medium.ended) {
      const sample = Math.floor(mediaTime * 20);
      low = data.b[clamp(sample, 0, data.b.length - 1)] / 255 || 0;
      top = data.h[clamp(sample, 0, data.h.length - 1)] / 255 || 0;
    }
    previousBass = bass;
    bass += (low - bass) * .56;
    high += (top - high) * .32;
    kick = Math.max(0, bass - previousBass);
    if (!reduced && bass > .51 && kick > .07 && time - lastKick > 430 && medium && !medium.paused) {
      lastKick = time;
      // Short, restrained light impacts leave the clip readable.
      const edgeX = Math.random() > .5 ? .08 : .92;
      if (wide) burst(edgeX * width, (Math.random() > .5 ? .88 : .12) * height, .18 + kick * .6, 9);
    }
    if (activeSection && time - lastEnergy >= 62) {
      activeSection.style.setProperty('--jlv-bass', bass.toFixed(3));
      activeSection.style.setProperty('--jlv-high', high.toFixed(3));
    }
    const detail = { bass, high, time: mediaTime, index };
    document.dispatchEvent(new CustomEvent('jlv:energy', { detail }));
    lastEnergy = time;
    if (medium && track && page >= 0 && page < tracks.length) {
      const duration = Number(medium.duration) || Number(track.duree) || 1;
      if (fill) fill.style.width = (clamp(mediaTime / duration, 0, 1) * 100).toFixed(3) + '%';
      const whole = Math.floor(mediaTime);
      if (whole !== lastProgressSecond) {
        lastProgressSecond = whole;
        if (timeLeft) timeLeft.textContent = format(mediaTime);
        if (timeRight) timeRight.textContent = '-' + format(duration - mediaTime);
      }
    }
  }
  function backdrop(time) {
    if (time - lastBackdrop < 84) return;
    const index = Number.isFinite(api.current) ? api.current : activeIndex;
    const section = sections[index] || activeSection;
    if (!section || !section.classList.contains('clip-on') || page < 0 || page >= tracks.length) return;
    const video = section.querySelector('video.vid');
    const target = section.querySelector('canvas.vidbg');
    if (!video || !target || video.readyState < 2 || (video.paused && target.dataset.fxDrawn === '1')) return;
    let context = videoContexts.get(target);
    if (!context) {
      target.width = 160; target.height = 90;
      context = target.getContext('2d', { alpha: false, desynchronized: true });
      if (!context) return;
      videoContexts.set(target, context);
    }
    lastBackdrop = time;
    try { context.drawImage(video, 0, 0, target.width, target.height); target.dataset.fxDrawn = '1'; }
    catch (_) { /* Media not yet drawable; the still-image backdrop remains. */ }
  }
  function burst(x, y, power, count) {
    if (reduced) return;
    power = clamp(Number(power) || .65, .08, 2.4);
    x = Number.isFinite(Number(x)) ? Number(x) : width * .5;
    y = Number.isFinite(Number(y)) ? Number(y) : height * .65;
    const requestedCount = Number(count);
    const total = Number.isFinite(requestedCount) ? clamp(Math.round(requestedCount), 0, 150) : Math.min(150, Math.round(35 + power * 48));
    for (let i = 0; i < total; i++) {
      const angle = Math.random() * TAU;
      const speed = (36 + Math.random() * 190) * power;
      shards.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - power * 20,
        life: .38 + Math.random() * .75, age: 0, size: .4 + Math.random() * 1.2, color: i % 3, highlight: i % 4 === 0 });
    }
    if (power >= .45) rings.push({ x, y, life: .85, age: 0, power });
    if (shards.length > 520) shards.splice(0, shards.length - 520);
    if (rings.length > 8) rings.shift();
  }
  function drawDust(time, dt) {
    const seconds = time / 1000;
    const margin = wide ? Math.max(10, (width - height * 16 / 9) / 2) : width * .15;
    const speedBoost = reduced ? 0 : 1 + bass * 1.65 + high * .25;
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 9);
    dustTravel += (dustTravelTarget - dustTravel) * ease;
    viewX += ((reduced ? 0 : viewTargetX) - viewX) * ease;
    viewY += ((reduced ? 0 : viewTargetY) - viewY) * ease;
    for (const p of particles) {
      if (!reduced) {
        p.y -= dt * (.006 + p.speed * .02) * speedBoost * (.55 + p.z * .7);
        if (p.edge && p.top && p.y < -.02) p.y = .36;
        else if (p.edge && !p.top && p.y < .64) p.y = 1.02;
        else if (!p.edge && p.y < -.02) { p.y = 1.02; p.x = Math.random(); }
      }
      const drift = reduced ? 0 : Math.sin(seconds * .35 + p.phase) * (2 + p.z * 5);
      const depth = .14 + p.z * .76;
      p.dx = (p.edge ? (p.side ? width - Math.pow(p.x, 1.25) * margin : Math.pow(p.x, 1.25) * margin) : wide ? margin + p.x * (width - 2 * margin) : p.x * width) + drift + viewX * depth;
      if (wide && p.edge) p.dx = p.side ? Math.max(width - margin + p.radius * 1.3, p.dx) : Math.min(margin - p.radius * 1.3, p.dx);
      const pad = p.kind === 2 ? 16 : 5;
      const bandStart = p.edge ? (p.top ? -pad : height * .62) : -pad;
      const bandEnd = p.edge ? (p.top ? height * .38 : height + pad) : height + pad;
      const span = bandEnd - bandStart;
      const projectedY = p.y * height - dustTravel * depth + viewY * depth;
      p.dy = ((projectedY - bandStart) % span + span) % span + bandStart;
    }
    for (let bin = 0; bin < 12; bin++) {
      ctx.beginPath();
      for (const p of groups[bin]) {
        const size = p.radius * (1 + bass * .12);
        if (p.kind === 0) ctx.rect(p.dx, p.dy, size, size);
        else if (p.kind === 1) { ctx.moveTo(p.dx + size, p.dy); ctx.arc(p.dx, p.dy, size, 0, TAU); }
      }
      ctx.fillStyle = colors[bin % 3];
      ctx.globalAlpha = ((bin % 6 < 3 ? .3 : .54) * (bin >= 6 ? 1.22 : .85)) * (.79 + high * .54 + bass * .12);
      ctx.fill();
    }
    // Cached highlights add larger points throughout the scene without per-point blur.
    for (let bin = 0; bin < 12; bin++) {
      const sprite = glowSprites[bin % 3];
      if (!sprite) continue;
      for (const p of groups[bin]) {
        if (p.kind !== 2) continue;
        const shimmer = reduced ? .75 : .58 + Math.sin(seconds * (.7 + p.z * .6) + p.phase) * .2;
        const radius = p.radius * (1 + bass * .2);
        ctx.globalAlpha = clamp(shimmer + high * .24 + bass * .13, .3, .95) * (p.edge ? 1 : .72);
        paintSprite(glowSprites,oldGlowSprites,bin % 3,p.dx - radius,p.dy - radius,radius * 2,radius * 2);
      }
    }
    if (!reduced) {
      ctx.strokeStyle = colors[1]; ctx.lineWidth = .5; ctx.globalAlpha = .19 + high * .22;
      ctx.beginPath();
      for (let i = 0; i < particles.length; i += 37) {
        const p = particles[i], length = 2 + bass * 5 + p.z * 2 + scrollFlow * (7 + p.z * 15);
        ctx.moveTo(p.dx, p.dy); ctx.lineTo(p.dx + Math.sin(p.phase) * .5, p.dy + length * (scrollFlow > .06 ? scrollDirection : 1));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawGlow(time) {
    if (reduced) return;
    const intensity = .012 + bass * .027 + high * .005;
    // Edge luminance is deliberately low; video contrast remains intact.
    const spots = wide ? wideGlowSpots : narrowGlowSpots;
    const radius = Math.min(width * .22, height * .47);
    for (let i = 0; i < spots.length; i++) {
      const x = width * spots[i][0], y = height * spots[i][1];
      const sprite = edgeGlowSprites[i % 2]; if (!sprite) continue;
      ctx.globalAlpha = intensity * (finaleReward ? 1.6 : 1);
      paintSprite(edgeGlowSprites,oldEdgeGlowSprites,i % 2,x - radius,y - radius,radius * 2,radius * 2);
    }
    ctx.globalAlpha = 1;
  }
  function drawBursts(dt) {
    ctx.lineCap = 'round';
    for (let i = shards.length - 1; i >= 0; i--) {
      const p = shards[i]; p.age += dt;
      if (p.age > p.life) { shards.splice(i, 1); continue; }
      const oldX = p.x, oldY = p.y;
      p.vx *= Math.exp(-dt * 1.65); p.vy *= Math.exp(-dt * 1.3);
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 8;
      ctx.globalAlpha = Math.pow(1 - p.age / p.life, 1.65) * .7;
      ctx.strokeStyle = colors[p.color]; ctx.lineWidth = p.size;
      ctx.beginPath(); ctx.moveTo(oldX, oldY); ctx.lineTo(p.x, p.y); ctx.stroke();
      if (p.highlight && glowSprites[p.color]) {
        const radius = 5 + p.size * 4;
        paintSprite(glowSprites,oldGlowSprites,p.color,p.x - radius,p.y - radius,radius * 2,radius * 2);
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i]; ring.age += dt;
      if (ring.age > ring.life) { rings.splice(i, 1); continue; }
      const phase = ring.age / ring.life;
      const size = (28 + (1 - Math.pow(1 - phase, 3)) * 240) * ring.power;
      ctx.globalAlpha = Math.pow(1 - phase, 2) * .28;
      ctx.strokeStyle = colors[1]; ctx.lineWidth = .75;
      ctx.beginPath(); ctx.ellipse(ring.x, ring.y, size, size * .38, -.22, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function updateClockHands() {
    if (!clockCursor || !clockVisible || reduced) return;
    const date = new Date(), seconds = date.getSeconds() + date.getMilliseconds() / 1000;
    clockCursor.style.setProperty('--jlv-clock-hour', ((date.getHours() % 12) * 30 + date.getMinutes() * .5).toFixed(2) + 'deg');
    clockCursor.style.setProperty('--jlv-clock-minute', (date.getMinutes() * 6 + seconds * .1).toFixed(2) + 'deg');
    clockCursor.style.setProperty('--jlv-clock-second', (seconds * 6).toFixed(2) + 'deg');
  }
  function hideClock() {
    clockVisible = false;
    if (clockCursor) clockCursor.classList.remove('is-visible');
    document.body.classList.remove('jlv-clock-ready');
  }
  function onViewMove(event) {
    if (reduced || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Pointer and touch motion provide depth without asking for sensor access.
    viewTargetX = clamp(.5 - event.clientX / width, -.5, .5) * Math.min(64, width * .055);
    viewTargetY = clamp(.5 - event.clientY / height, -.5, .5) * Math.min(42, height * .05);
  }
  function resetView(event) {
    if (!event || event.type === 'pointerleave' || event.type === 'blur' || event.pointerType === 'touch') {
      viewTargetX = 0; viewTargetY = 0;
    }
  }
  function onClockMove(event) {
    if (!clockCursor || reduced || !finePointerQuery.matches || event.pointerType === 'touch') { hideClock(); return; }
    const x = event.clientX, y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!clockVisible) { lastTrailX = x; lastTrailY = y; }
    const dx = x - lastTrailX, dy = y - lastTrailY, distance = Math.hypot(dx, dy);
    if (distance > .8) {
      const count = Math.min(26, 6 + Math.ceil(distance / 3));
        const sideX = -dy / distance, sideY = dx / distance;
        const trailWidth = Math.min(68, 42 + distance * .18);
      const hovered = Boolean(event.target && event.target.closest && event.target.closest('button,a,input,select,textarea,[role="button"],#lockHost'));
      for (let i = 0; i < count; i++) {
        const position = (i + 1) / count;
        const spark = cursorTrail[trailSlot]; trailSlot = (trailSlot + 1) % cursorTrail.length;
        if (!spark.alive) liveTrail++;
        spark.alive = true; spark.age = 0; spark.life = .65 + Math.random() * .5;
          const spread = (Math.random() - .5) * (i % 3 === 0 ? 8 : trailWidth);
          spark.x = lastTrailX + dx * position + sideX * spread;
          spark.y = lastTrailY + dy * position + sideY * spread;
          spark.vx = clamp(-dx * .13, -22, 22) + sideX * spread * .55 + (Math.random() - .5) * 12;
          spark.vy = clamp(-dy * .13, -22, 22) + sideY * spread * .55 + (Math.random() - .5) * 12 - 3;
        spark.size = .75 + Math.random() * 1.8;
        spark.tint = hovered ? (i % 5 === 0 ? 2 : 0) : i % 3;
        spark.glow = i % 4 === 0;
          spark.glowSize = 8 + Math.random() * 8;
      }
    }
    mouseX = x; mouseY = y; lastTrailX = x; lastTrailY = y; clockVisible = true;
    if (distance > 1.5) { clockCursor.classList.add('is-impact'); clockCursor.style.setProperty('--lens-size',Math.min(88,44+distance*.35)+'px');clearTimeout(clockImpactTimer);clockImpactTimer=setTimeout(()=>clockCursor&&clockCursor.classList.remove('is-impact'),180); }
    document.body.classList.add('jlv-clock-ready'); clockCursor.classList.add('is-visible');
    const interactive = Boolean(event.target && event.target.closest && event.target.closest('button,a,input,select,textarea,[role="button"],#lockHost'));
    clockCursor.classList.toggle('is-hover', interactive);
    if (!clockRaf) clockRaf = requestAnimationFrame(() => {
      clockRaf = 0;
      clockCursor.style.transform = 'translate3d(' + mouseX.toFixed(2) + 'px,' + mouseY.toFixed(2) + 'px,0)';
      updateClockHands();
    });
  }
  function onClockDown(event) { if (event.pointerType === 'touch') { hideClock();return; } if(clockCursor&&!reduced){clockCursor.classList.add('is-impact');clearTimeout(clockImpactTimer);clockImpactTimer=setTimeout(()=>clockCursor.classList.remove('is-impact'),260);document.dispatchEvent(new CustomEvent('jlv:burst',{detail:{x:event.clientX,y:event.clientY,count:36,power:.45}}));} }
  function initClock() {
    if (!finePointerQuery.matches || reduced || clockCursor) return;
    clockCursor = document.createElement('div'); clockCursor.className = 'jlv-clock-cursor';
    clockCursor.setAttribute('aria-hidden', 'true');
      clockCursor.innerHTML = '<div class="jlv-clock-lens"></div><div class="jlv-clock-aura"></div><div class="jlv-clock-dial"><i class="jlv-clock-hour"></i><i class="jlv-clock-minute"></i><i class="jlv-clock-second"></i><i class="jlv-clock-pivot"></i></div>';
    document.body.appendChild(clockCursor);
    document.addEventListener('pointermove', onClockMove, { passive: true });
    document.addEventListener('pointerdown', onClockDown, { passive: true });
    document.addEventListener('pointerleave', hideClock);
    addEventListener('blur', hideClock);
    clockTimer = setInterval(updateClockHands, 100);
  }
  function drawCursorTrail(dt) {
    if (reduced || !liveTrail) return;
    const dampingX = Math.exp(-dt * .55), dampingY = Math.exp(-dt * .3);
    for (const spark of cursorTrail) {
      if (!spark.alive) continue;
      spark.age += dt;
      if (spark.age >= spark.life) { spark.alive = false; liveTrail--; continue; }
      spark.x += spark.vx * dt; spark.y += spark.vy * dt;
      spark.vx *= dampingX; spark.vy *= dampingY;
      spark.fade = Math.pow(1 - spark.age / spark.life, .68);
      spark.bucket = Math.min(4, Math.floor(spark.fade * 5)) + spark.tint * 5;
    }
    // Fifteen fills handle the full 1,440-slot trail, including its slow fade.
    for (let bucket = 0; bucket < 15; bucket++) {
      ctx.beginPath();
      for (const spark of cursorTrail) {
        if (!spark.alive) continue;
        if (spark.bucket !== bucket) continue;
        const size = spark.size * (.65 + spark.fade * .35);
        ctx.rect(spark.x, spark.y, size, size);
      }
      ctx.fillStyle = trailColors[Math.floor(bucket / 5)];
      ctx.globalAlpha = .12 + (bucket % 5) * .2;
      ctx.fill();
    }
    for (const spark of cursorTrail) {
      if (!spark.alive || !spark.glow) continue;
      const sprite = trailGlowSprites[spark.tint];
      if (!sprite) continue;
      const faded = Math.pow(1 - spark.age / spark.life, .85);
      const radius = spark.glowSize * (.65 + faded * .35);
      ctx.globalAlpha = faded * .77;
      paintSprite(trailGlowSprites,oldGlowSprites,spark.tint,spark.x - radius,spark.y - radius,radius * 2,radius * 2);
    }
    ctx.globalAlpha = 1;
  }
  function onScrollFlow() {
    if (!scroller || reduced) return;
    const now = performance.now(), next = scroller.scrollTop, delta = next - scrollPosition;
    if (Math.abs(delta) > .2) {
      scrollDirection = delta > 0 ? 1 : -1;
      scrollTarget = clamp(Math.abs(delta) / Math.max(16, now - scrollStamp) / 2.5, 0, 1);
      // Long menu jumps travel one scene visually; a manual scroll keeps its exact distance.
      dustTravelTarget += clamp(delta, -height, height);
      scrollMoving = true;
    }
    scrollPosition = next; scrollStamp = now;
  }
  function drawScrollFlow(time, dt) {
    if (entrySection && time >= entryDeadline) { entrySection.classList.remove('jlv-arriving'); entrySection = null; }
    if (reduced) return;
    if (time - scrollStamp > 65) scrollTarget *= Math.exp(-dt * 9);
    scrollFlow += (scrollTarget - scrollFlow) * Math.min(1, dt * 12);
    if (scrollFlow < .004) scrollFlow = 0;
    const value = Math.round(scrollFlow * 1000) / 1000;
    if (value !== flowWritten) {
      flowWritten = value;
      document.documentElement.style.setProperty('--jlv-scroll-flow', String(value));
      document.documentElement.style.setProperty('--jlv-scroll-direction', String(scrollDirection));
    }
    if (!scrollFlow && scrollMoving) {
      scrollMoving = false;
      if (time - lastSettle > 650 && page >= 0 && page < tracks.length) {
        lastSettle = time;
        const frameWidth = Math.min(width, height * 16 / 9);
        burst(width * .5 - frameWidth * .44, height * .5, .28, 20);
        burst(width * .5 + frameWidth * .44, height * .5, .28, 20);
      }
    }
    if (scrollFlow < .025) return;
    ctx.strokeStyle = colors[1]; ctx.globalAlpha = scrollFlow * .21; ctx.lineWidth = .65;
    ctx.beginPath();
    for (let i = 0; i < 32; i++) {
      const x = ((i * .6180339) % 1) * width;
      const phase = ((time * .00045 * scrollDirection + i * .314159) % 1 + 1) % 1;
      const y = (1 - phase) * height, length = 14 + scrollFlow * height * .16;
      ctx.moveTo(x, y); ctx.lineTo(x, y + length * scrollDirection);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  function clearSlide() {
    slideSerial++;
    clearTimeout(slideTimer);
    for (const animation of slideAnimations) animation.cancel();
    slideAnimations = [];
    if (slideSection) slideSection.classList.remove('jlv-page-enter');
    slideSection = null;
    if (slideOverlay) slideOverlay.remove();
    slideOverlay = null;
  }
  function slideSurface(index, outgoing) {
    const panel = document.createElement('div'); panel.className = 'jlv-slide-panel ' + (outgoing ? 'jlv-slide-out' : 'jlv-slide-in');
    const section = index < 0 ? intro : index >= tracks.length ? fin : sections[index];
    const video = outgoing && section && section.querySelector('video');
    let surface = null;
    if (video && section.classList.contains('clip-on') && video.readyState >= 2) {
      try {
        surface = document.createElement('canvas');
        surface.width = Math.min(1920, video.videoWidth || 1920);
        surface.height = Math.round(surface.width * (video.videoHeight || 1080) / (video.videoWidth || 1920));
        surface.getContext('2d').drawImage(video, 0, 0, surface.width, surface.height);
        surface.style.objectFit = getComputedStyle(video).objectFit;
      } catch (_) { surface = null; }
    }
    if (!surface) {
      surface = document.createElement('img'); surface.alt = '';
      const image = section && section.querySelector(index >= tracks.length ? '.album-end' : index < 0 ? '#cover img' : '.bg');
      surface.src = image && (image.currentSrc || image.src) || (index < 0 ? 'media/album-swirl.webp' : 'media/album-full.png');
    }
    surface.className = 'jlv-slide-image'; panel.appendChild(surface);
    return panel;
  }
  function onNavigate(event) {
    const detail = event.detail || {}; clearSlide();
    if (reduced || !Number.isFinite(detail.from) || !Number.isFinite(detail.to) || detail.from === detail.to) return;
    setPalette(detail.to < 0 ? null : tracks[detail.to] || tracks[api.current],false);
    const serial = slideSerial, direction = Number(detail.direction) < 0 ? -1 : 1;
    slideOverlay = document.createElement('div'); slideOverlay.className = 'jlv-slide'; slideOverlay.setAttribute('aria-hidden', 'true');
    slideOverlay.dataset.direction = String(direction);
    if (Number.isFinite(detail.id)) slideOverlay.dataset.navigation = String(detail.id);
    slideOverlay.style.setProperty('--slide-direction', String(direction));
    slideOverlay.append(slideSurface(detail.from, true));
    document.body.appendChild(slideOverlay);
    slideSection = detail.to < 0 ? intro : detail.to >= tracks.length ? fin : sections[detail.to];
    if (slideSection) {
      slideSection.classList.add('jlv-page-enter');
      // Animate the real destination, never a frozen poster over a playing clip.
      // Its section stays untransformed, so CSS snap geometry cannot shift.
      for (const child of slideSection.children) {
        if (typeof child.animate !== 'function') continue;
        const animation = child.animate([
          { translate: '0 ' + direction * 100 + 'vh' },
          { translate: '0 0' }
        ], { duration: 740, easing: 'cubic-bezier(.23,.82,.22,1)', fill: 'both' });
        slideAnimations.push(animation);
      }
    }
    const finish = () => { if (serial === slideSerial) clearSlide(); };
    if (slideAnimations.length) Promise.all(slideAnimations.map(animation => animation.finished)).then(finish, () => {});
    slideTimer = setTimeout(finish, 800);
  }
  function initNavigationFlow() {
    flowRibbon = document.createElement('div'); flowRibbon.className = 'jlv-flow-ribbon'; flowRibbon.setAttribute('aria-hidden', 'true'); document.body.appendChild(flowRibbon);
    if (scroller) scroller.addEventListener('scroll', onScrollFlow, { passive: true });
    if (scroller) { scroller.addEventListener('wheel',clearSlide,{passive:true}); scroller.addEventListener('touchmove',clearSlide,{passive:true}); }
    document.addEventListener('pointermove', onViewMove, { passive: true });
    document.addEventListener('pointerdown', onViewMove, { passive: true });
    document.addEventListener('pointerup', resetView, { passive: true });
    document.addEventListener('pointercancel', resetView, { passive: true });
    document.addEventListener('pointerleave', resetView);
    addEventListener('blur', resetView);
  }
  function frame(time) {
    if (disposed || document.hidden) { frameId = 0; return; }
    if (reduced && lastFrame && time - lastFrame < 64) { frameId = requestAnimationFrame(frame); return; }
    const begin = performance.now();
    const elapsed = Math.min(.05, lastFrame ? (time - lastFrame) / 1000 : .0167);
    lastFrame = time;
    updatePalette(time);
    if (time - lastEnergy >= 64) emitEnergy(time);
    backdrop(time);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(time); drawScrollFlow(time, elapsed); drawDust(time, elapsed); drawBursts(elapsed); drawCursorTrail(elapsed);
    ctx.globalCompositeOperation = 'source-over';
    const cost = performance.now() - begin;
    if (!qualityStart) qualityStart = time;
    costSum += cost; costCount++;
    if (time - qualityStart > 3500 && costCount > 45) {
      const average = costSum / costCount;
      if (average > 7 && quality > .62) { quality = Math.max(.62, quality - .18); resize(); }
      qualityStart = time; costSum = 0; costCount = 0;
    }
    frameId = requestAnimationFrame(frame);
  }
  function onTrack(event) {
    const detail = event.detail || {};
    activeIndex = Number.isFinite(detail.index) ? detail.index : Number(api.current);
    activeSection = detail.section || sections[activeIndex] || null;
    activeMedia = detail.media || api.media || null;
    finaleReward = false;
    setPalette(detail.track || tracks[activeIndex], false);
    bass = 0; high = 0; lastProgressSecond = -1;
    lastBackdrop = 0;
    addRift(activeSection);
    if (!reduced && page >= 0 && page < tracks.length) burst(width * .5, height * .5, .42, 42);
    if (activeSection) {
      const target = activeSection.querySelector('.vidbg');
      if (target) delete target.dataset.fxDrawn;
    }
  }
  function onReveal(event) {
    const detail = event.detail || {};
    if (detail.section) activeSection = detail.section;
    if (reduced) return;
    // Two offset impulses echo the expanding optical ring.
    burst(width * .5, height * .5, .72, 68);
  }
  function onBurst(event) {
    const detail = event.detail || {};
    let x = Number(detail.x), y = Number(detail.y);
    if (Number.isFinite(x) && x >= 0 && x <= 1) x *= width;
    if (Number.isFinite(y) && y >= 0 && y <= 1) y *= height;
    burst(x, y, detail.power, detail.count);
  }
  function onPage(event) {
    const detail = event.detail || {}, next = Number(detail.page), previous = page;
    if (Number.isFinite(next)) page = next;
    const destination = page < 0 ? intro : page >= tracks.length ? fin : sections[page];
    if (slideSection && slideSection !== destination) clearSlide();
    setPalette(page < 0 ? null : tracks[page] || tracks[api.current],false);
    if (fin) fin.classList.toggle('jlv-finale', page === tracks.length);
    if (page === -1) { activeSection = null; setPalette(null, false); }
    if (entrySection) entrySection.classList.remove('jlv-arriving');
    entrySection = page >= 0 && page < tracks.length ? sections[page] : null;
    if (!reduced && entrySection) {
      const direction = Number(detail.direction) || Math.sign(page - previous) || 1;
      entrySection.style.setProperty('--jlv-entry-direction', String(direction));
      entrySection.classList.add('jlv-arriving'); entryDeadline = performance.now() + 1100;
      scrollDirection = direction; scrollTarget = detail.selection ? .62 : .42; scrollStamp = performance.now(); scrollMoving = true;
      burst(width * .5, height * .5, .7, 58);
      if (detail.selection || previous >= 0) try { if (window.JLVSound && window.JLVSound.play) window.JLVSound.play('nav'); } catch (_) {}
    }
  }
  function onReward(event) {
    if (!event.detail || event.detail.phase !== 'unlock') return;
    finaleReward = true; setPalette(null, true);
    if (fin) fin.classList.add('jlv-reward');
    burst(width * .5, height * .66, 1.55, 130);
    burst(width * .21, height * .76, .9, 72);
    burst(width * .79, height * .76, .9, 72);
  }
  function visibility() {
    if (document.hidden) { clearSlide(); resetView(); cancelAnimationFrame(frameId); frameId = 0; lastFrame = 0; }
    else if (!frameId && !disposed) frameId = requestAnimationFrame(frame);
  }
  function motion(event) { reduced = event.matches; shards = []; rings = []; clearSlide(); if (reduced) { hideClock(); resetView(); } else if (!clockCursor) initClock(); rebuildParticles(); }
  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('jlv:track', onTrack);
  document.addEventListener('jlv:reveal', onReveal);
  document.addEventListener('jlv:burst', onBurst);
  document.addEventListener('jlv:page', onPage);
  document.addEventListener('jlv:navigate', onNavigate);
  document.addEventListener('jlv:navigation-cancel', clearSlide);
  document.addEventListener('jlv:reward', onReward);
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', motion);
  const hooks = {
    burst,
    get stats() { return { particles: particles.length, trailParticles: liveTrail, trailCapacity: cursorTrail.length, burstParticles: shards.length, burstRings: rings.length, centerParticles: groups.slice(0,6).reduce((n,g)=>n+g.length,0), cornerParticles: groups.slice(6).reduce((n,g)=>n+g.length,0), palette:colors.slice(), paletteTarget:paletteTarget.slice(), paletteBlend:Number(paletteBlend.toFixed(3)), cachedPalettes:paletteTextures.size, parallaxLayers: 3, scrollDirection, scrollTravel: Number(dustTravel.toFixed(2)), viewX: Number(viewX.toFixed(2)), viewY: Number(viewY.toFixed(2)), navigationAnimating: !!slideOverlay, dpr: Number(dpr.toFixed(2)), quality, backdropFps: 12, reducedMotion: reduced }; },
    dispose() {
      disposed = true; clearSlide(); cancelAnimationFrame(frameId); cancelAnimationFrame(clockRaf); clearInterval(clockTimer); hideClock(); if (flowRibbon) flowRibbon.remove(); if (scroller) { scroller.removeEventListener("scroll", onScrollFlow); scroller.removeEventListener('wheel',clearSlide); scroller.removeEventListener('touchmove',clearSlide); } if (clockCursor) clockCursor.remove(); ctx.clearRect(0, 0, width, height);
      document.removeEventListener("pointermove", onClockMove); document.removeEventListener("pointerdown", onClockDown);
      document.removeEventListener('pointermove', onViewMove); document.removeEventListener('pointerdown', onViewMove);
      document.removeEventListener('pointerup', resetView); document.removeEventListener('pointercancel', resetView); document.removeEventListener('pointerleave', resetView); removeEventListener('blur', resetView);
      document.removeEventListener("pointerleave", hideClock); removeEventListener("blur", hideClock);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('jlv:track', onTrack); document.removeEventListener('jlv:reveal', onReveal);
      document.removeEventListener('jlv:burst', onBurst); document.removeEventListener('jlv:page', onPage); document.removeEventListener('jlv:navigate', onNavigate); document.removeEventListener('jlv:navigation-cancel', clearSlide);
      document.removeEventListener('jlv:reward', onReward);
      if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', motion);
    }
  };
  initClock(); initNavigationFlow();
  window.JLVFX = hooks;
  try { api.effects = hooks; } catch (_) {}
  if (Number(api.current) >= 0) onTrack({ detail: { index: Number(api.current), media: api.media } });
  if (fin && page === tracks.length) fin.classList.add('jlv-finale');
  frameId = requestAnimationFrame(frame);
})();
