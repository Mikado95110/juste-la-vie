/* 24 éclats dans les clips, un mécanisme tactile et le cadeau de l'album. */
(() => {
  'use strict';
  const config = window.JLV_SECRET_CONFIG;
  if (!config || config.order.length !== 24 || Object.keys(config.digits).length !== 24) {
    console.warn('La configuration des 24 éclats est absente.');
    return;
  }
  const mod = n => ((n % 10) + 10) % 10;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const random = (min, max) => {
    const bytes = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes[0] = Math.floor(Math.random() * 4294967296);
    return min + (bytes[0] / 4294967296) * (max - min);
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storageKey = 'jlv-secret-wheels-v' + config.version;
  const secretSequence = config.order.map(n => Number(config.digits[n]));
  let host, values, wheelButtons = [], turns = [], wheelTimers = [], state = 'locked';
  let digitState = null, digitFrame = 0, giftChecked = false, giftAvailable = false;
  let rewardTimer = 0, energyValue = 0, lastEnergyPaint = 0, observed = false;
  let giftCheckPromise = null;
  let soundContext = null, soundMaster = null, soundNoise = null, lastTickSound = -Infinity, lastErrorSound = -Infinity, lastNavSound = -Infinity, gearKick = 0, gearKickTimer = 0;
  const wheelStats = { wheelEvents:0, wheelTurns:0, wheelSuppressed:0, dragTurns:0 };
  let missTimer = 0;

  function soundSession() {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return null;
    try {
      if (!soundContext) {
        soundContext = new AudioEngine({ latencyHint:'interactive' });
        soundMaster = soundContext.createGain(); soundMaster.gain.value = .32; soundMaster.connect(soundContext.destination);
        soundNoise = soundContext.createBuffer(1,Math.ceil(soundContext.sampleRate * .4),soundContext.sampleRate);
        const data = soundNoise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
      return soundContext;
    } catch (_) { return null; }
  }
  function metalTone(context,at,frequency,to,duration,level,type = 'sine') {
    const oscillator = context.createOscillator(), envelope = context.createGain(); oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency,at); oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,to),at + duration);
    envelope.gain.setValueAtTime(.0001,at); envelope.gain.linearRampToValueAtTime(level,at + .004); envelope.gain.exponentialRampToValueAtTime(.0001,at + duration);
    oscillator.connect(envelope); envelope.connect(soundMaster); oscillator.start(at); oscillator.stop(at + duration + .01);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
  function airSound(context,at,duration,level,frequency,to,q = .8) {
    const noise = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    noise.buffer = soundNoise; noise.loop = duration > .4; filter.type = 'bandpass'; filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency,at); filter.frequency.exponentialRampToValueAtTime(Math.max(40,to),at + duration);
    envelope.gain.setValueAtTime(.0001,at); envelope.gain.linearRampToValueAtTime(level,at + Math.min(.045,duration * .15)); envelope.gain.exponentialRampToValueAtTime(.0001,at + duration);
    noise.connect(filter); filter.connect(envelope); envelope.connect(soundMaster); noise.start(at); noise.stop(at + duration + .01);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }
  function mechanismSound(kind) {
    const context = soundSession(); if (!context) return;
    const now = context.currentTime, at = now + .005;
    if (kind === 'tick') {
      if (now - lastTickSound < .055) return; lastTickSound = now;
      airSound(context,at,.045,.08,2300,900,1.2);
      metalTone(context,at,1720,1240,.075,.055,'triangle'); metalTone(context,at + .006,255,190,.055,.08,'sine');
    } else if (kind === 'error') {
      if (now - lastErrorSound < .3) return; lastErrorSound = now;
      airSound(context,at,.2,.1,580,180,.8); metalTone(context,at,113,72,.2,.09,'triangle');
      [760,520,360].forEach((frequency,i) => metalTone(context,at + i * .022,frequency,frequency * .68,.09,.055,'triangle'));
    } else if (kind === 'unlock') {
      metalTone(context,at,82,38,.55,.16,'sine'); metalTone(context,at + .035,1440,720,.32,.055,'triangle');
      airSound(context,at + .03,1.25,.14,480,4200,.65);
    } else if (kind === 'chime') {
      [659.25,987.77,1318.5].forEach((frequency,i) => { metalTone(context,at + i * .09,frequency,frequency,.66,.065); metalTone(context,at + i * .09,frequency * 2,frequency * 2,.3,.017); });
    } else if (kind === 'reset') {
      metalTone(context,at,310,200,.16,.075,'triangle'); airSound(context,at,.07,.07,1200,500);
    } else if (kind === 'nav') {
      if (now - lastNavSound < .18) return; lastNavSound = now;
      airSound(context,at,.24,.055,800,2300,.7); metalTone(context,at + .015,470,350,.12,.032,'sine');
    }
  }
  window.JLVSound = Object.freeze({ play:mechanismSound });
  function controlIcon(kind) {
    const paths = kind === 'reset' ? '<path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/>' : kind === 'download' ? '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>' : kind === 'play' ? '<path d="M8 5v14l11-7z"/>' : '<path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="4" y="10" width="16" height="12" rx="3"/><path d="M12 14v4"/>';
    return `<svg class="lk-control-icon" aria-hidden="true" viewBox="0 0 24 24">${paths}</svg>`;
  }

  function readProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && saved.order === config.order.join(',') && Array.isArray(saved.values) && saved.values.length === 24 && saved.values.every(n => Number.isInteger(n) && n >= 0 && n <= 9)) return saved.values;
    } catch (_) { /* Stockage désactivé : le mécanisme reste utilisable. */ }
    return Array(24).fill(0);
  }
  function saveProgress() {
    if (!Array.isArray(values)) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ order:config.order.join(','), values })); } catch (_) {}
  }
  function burst(x, y, count = 16, power = 1) {
    document.dispatchEvent(new CustomEvent('jlv:burst', { detail:{ x, y, count:reducedMotion ? 0 : count, power, color:'#c6ecff' } }));
  }
  function localSparks(button, count = 6, large = false) {
    if (reducedMotion || !host || !observed) return;
    // The shared canvas keeps the same sparks without creating/removing DOM
    // nodes and shadow layers on every turn of a drum.
    const rect = button.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('jlv:burst', { detail:{
      x:rect.left + rect.width / 2, y:rect.top + rect.height / 2,
      count, power:large ? 1.15 : .48, color:'#f8d68b'
    } }));
  }
  function setActive(active) {
    if (!host) return;
    host.classList.toggle('is-active',active && !document.hidden);
  }
  function brassGear(id,cssClass,teeth = 24) {
    const points = [];
    for (let tooth = 0; tooth < teeth; tooth++) {
      [[0,42],[.15,42],[.24,48],[.62,48],[.74,42],[.99,42]].forEach(([fraction,radius]) => {
        const angle = (tooth + fraction) * Math.PI * 2 / teeth - Math.PI / 2;
        points.push(`${(50 + Math.cos(angle) * radius).toFixed(2)},${(50 + Math.sin(angle) * radius).toFixed(2)}`);
      });
    }
    const cutouts = Array.from({ length:8 },(_,i) => `<path d="M46 14Q50 11 54 14L53 25Q50 27 47 25Z" transform="rotate(${i * 45} 50 50)" fill="#18110a" stroke="#52371b" stroke-width=".8"/>`).join('');
    return `<svg aria-hidden="true" class="${cssClass}" viewBox="0 0 100 100"><defs><linearGradient id="${id}-metal" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fff1b7"/><stop offset=".15" stop-color="#b57a28"/><stop offset=".3" stop-color="#f5d788"/><stop offset=".47" stop-color="#6f451b"/><stop offset=".5" stop-color="#efd17f"/><stop offset=".71" stop-color="#af7d35"/><stop offset=".88" stop-color="#fae3a3"/><stop offset="1" stop-color="#61411d"/></linearGradient><radialGradient id="${id}-core" cx=".35" cy=".22" r=".8"><stop stop-color="#fff2bc"/><stop offset=".35" stop-color="#c89b4d"/><stop offset=".74" stop-color="#e6c36f"/><stop offset="1" stop-color="#694018"/></radialGradient></defs><path d="M${points.join('L')}Z" fill="url(#${id}-metal)" stroke="#f8e4ad" stroke-width=".75"/><circle cx="50" cy="50" r="40.5" fill="none" stroke="#69441c" stroke-width="2"/><circle cx="50" cy="50" r="38.5" fill="none" stroke="#ffecb6" stroke-opacity=".65" stroke-width=".8"/>${cutouts}<circle cx="50" cy="50" r="29" fill="#24180d" stroke="#715024" stroke-width="2"/><circle cx="50" cy="50" r="26.5" fill="url(#${id}-core)" stroke="#f6dfa0" stroke-width="1.2"/><circle cx="50" cy="50" r="24" fill="none" stroke="#77471c" stroke-width=".65"/></svg>`;
  }
  function gearSvg(inner = false) { return brassGear(inner ? 'lk-center-b' : 'lk-center-a','lk-gear' + (inner ? ' lk-gear-inner' : ''),inner ? 28 : 36); }
  function prismSvg() {
    return '<svg class="lk-prism" aria-hidden="true" viewBox="0 0 100 120"><defs><linearGradient id="lk-prism-spectrum" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b3faff"/><stop offset=".23" stop-color="#637cff"/><stop offset=".45" stop-color="#eac0fa"/><stop offset=".68" stop-color="#fff9b2"/><stop offset="1" stop-color="#48dac2"/></linearGradient></defs><path d="M50 3L83 33L78 79L50 116L22 79L17 33Z" fill="url(#lk-prism-spectrum)" stroke="#fff9d8" stroke-width="1.3"/><path class="lk-prism-facet" style="--facet-delay:-.8s" d="M50 3L50 58L17 33Z" fill="#caffff" fill-opacity=".78"/><path class="lk-prism-facet" style="--facet-delay:-2.4s" d="M50 3L83 33L50 58Z" fill="#f2e1ff" fill-opacity=".7"/><path class="lk-prism-facet" style="--facet-delay:-1.7s" d="M17 33L50 58L22 79Z" fill="#897eff" fill-opacity=".74"/><path class="lk-prism-facet" style="--facet-delay:-3.1s" d="M83 33L78 79L50 58Z" fill="#fffec5" fill-opacity=".83"/><path class="lk-prism-facet" style="--facet-delay:-.3s" d="M22 79L50 58L50 116Z" fill="#55e4e5" fill-opacity=".68"/><path class="lk-prism-facet" style="--facet-delay:-1.2s" d="M78 79L50 116L50 58Z" fill="#ffe8b0" fill-opacity=".71"/><path d="M50 3V116M17 33L78 79M83 33L22 79" fill="none" stroke="#ffffe7" stroke-opacity=".65" stroke-width=".8"/></svg>';
  }
  function sealSvg() {
    const shape = [[34,13],[66,13],[73,21],[61,32],[39,32],[27,21]];
    const pieces = Array.from({ length:4 },(_,i) => {
      const angle = i * Math.PI / 2, sine = Math.sin(angle), cosine = Math.cos(angle);
      const points = shape.map(([x,y]) => [(50 + (x-50)*cosine - (y-50)*sine).toFixed(2),(50 + (x-50)*sine + (y-50)*cosine).toFixed(2)].join(','));
      return `<g class="lk-seal-piece" style="--seal-x:${Math.round(sine*28)}px;--seal-y:${Math.round(-cosine*28)}px;--seal-twist:${i % 2 ? 18 : -18}deg;--seal-delay:${i*.05}s"><polygon points="${points.join(' ')}" fill="url(#lk-seal-metal)" stroke="#ffe9b5" stroke-width=".8"/><path d="M${points[0]}L${points[1]}" stroke="#fff7d7" stroke-width="1.5"/></g>`;
    }).join('');
    return `<svg class="lk-seal" aria-hidden="true" viewBox="0 0 100 100"><defs><linearGradient id="lk-seal-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff2bf"/><stop offset=".27" stop-color="#c29848"/><stop offset=".52" stop-color="#6e461d"/><stop offset=".72" stop-color="#f3d080"/><stop offset="1" stop-color="#fff1b6"/></linearGradient></defs><circle class="lk-seal-track" cx="50" cy="50" r="39" fill="none" stroke="#e9cb8b" stroke-width=".6" stroke-dasharray="2 4"/>${pieces}</svg>`;
  }
  function bankMarkup(start) {
    const bank = start / 6;
    return `<div class="lk-bank" style="--bank-x:${bank % 2 ? 34 : -34}px;--bank-y:${bank < 2 ? -9 : 12}px;--bank-angle:${bank % 2 ? 3 : -3}deg" role="group" aria-label="Chiffres ${start + 1} à ${start + 6}">${Array.from({ length:6 }, (_, offset) => {
      const i = start + offset, position = String(i + 1).padStart(2,'0');
      return `<div class="lk-wheel-unit" style="--cog-delay:${(-i * 1.31).toFixed(2)}s;--cog-direction:${i % 2 ? 'reverse' : 'normal'}"><span class="lk-position" aria-hidden="true">${position}</span><button type="button" class="lk-wheel" role="spinbutton" data-wheel="${i}" aria-label="Chiffre ${position}" aria-describedby="lk-instructions" aria-valuemin="0" aria-valuemax="9" aria-valuenow="${values[i]}" aria-valuetext="${values[i]}">${brassGear('lk-cog-' + i,'lk-cog-ring',24)}<span class="lk-drum-window"><span class="lk-wheel-rotor" aria-hidden="true">${Array.from({ length:10 },(_,n) => `<span class="lk-face" style="--face-angle:${n * 36}deg">${n}</span>`).join('')}</span></span></button><i class="lk-notch" aria-hidden="true"></i></div>`;
    }).join('')}</div>`;
  }
  function setStatus(text, isError = false) {
    if (!host) return;
    const status = host.querySelector('.lk-status'); status.textContent = text;
    status.classList.toggle('is-error',isError);
  }
  function renderWheel(i) {
    const wheel = wheelButtons[i];
    wheel.style.setProperty('--wheel-angle', (-turns[i] * 36) + 'deg');
    wheel.style.setProperty('--cog-angle',(turns[i] * 12) + 'deg');
    wheel.setAttribute('aria-valuenow',String(values[i])); wheel.setAttribute('aria-valuetext',String(values[i]));
  }
  function updateCounter() {
    // Le compteur annonce les rouleaux, sans dévoiler si un chiffre est juste.
    const modified = values.filter(n => n !== 0).length;
    host.querySelector('.lk-progress').textContent = state === 'open' || state === 'unlocking' ? 'MÉCANISME OUVERT' : `24 ÉCLATS · ${String(modified).padStart(2,'0')} ROULEAUX TOURNÉS`;
  }
  function turnWheel(i, step, effects = true) {
    if (state === 'unlocking' || state === 'open' || !Number.isInteger(step) || step === 0) return;
    turns[i] += step; values[i] = mod(turns[i]); renderWheel(i); saveProgress(); updateCounter();
    const button = wheelButtons[i];
    button.classList.add('is-turning'); clearTimeout(wheelTimers[i]);
    wheelTimers[i] = setTimeout(() => button.classList.remove('is-turning'),430);
    if (state === 'wrong') { state = 'locked'; host.dataset.state = state; setStatus('La combinaison garde votre progression.'); }
    if (effects) {
      mechanismSound('tick'); gearKick += step * 12; host.style.setProperty('--gear-kick',gearKick + 'deg'); host.classList.add('is-clicking');
      clearTimeout(gearKickTimer); gearKickTimer = setTimeout(() => host.classList.remove('is-clicking'),360);
      localSparks(button,8); const r = button.getBoundingClientRect(); burst(r.left + r.width / 2,r.top + r.height / 2,12,.7);
    }
  }
  function attachWheel(button, i) {
    let dragging = false, startY = 0, pointerId = null, accumulated = 0, wheelAccumulated = 0, lastWheel = -Infinity, lastWheelTurn = -Infinity, wheelGestureConsumed = false, dragFrame = 0, pendingDirection = 0;
    const flushDrag = () => {
      dragFrame = 0;
      if (pendingDirection) { const step = pendingDirection; pendingDirection = 0; accumulated = 0; wheelStats.dragTurns++; turnWheel(i,step); }
    };
    button.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (state === 'open' || state === 'unlocking' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); button.focus({ preventScroll:true }); dragging = true; startY = e.clientY; accumulated = 0; pendingDirection = 0; pointerId = e.pointerId;
      try { button.setPointerCapture(pointerId); } catch (_) {}
    });
    button.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pointerId) return;
      e.preventDefault(); e.stopPropagation(); accumulated += startY - e.clientY; startY = e.clientY;
      if (!pendingDirection && Math.abs(accumulated) >= 36) {
        pendingDirection = Math.sign(accumulated); accumulated = 0;
        if (!dragFrame) dragFrame = requestAnimationFrame(flushDrag);
      }
    });
    const release = e => {
      e.stopPropagation(); if (e.pointerId !== pointerId) return;
      if (dragFrame) cancelAnimationFrame(dragFrame); dragFrame = 0;
      if (e.type === 'pointerup') flushDrag(); else pendingDirection = 0;
      dragging = false; pointerId = null; accumulated = 0;
    };
    button.addEventListener('pointerup',release); button.addEventListener('pointercancel',release); button.addEventListener('lostpointercapture',() => { dragging = false; pointerId = null; if (dragFrame) cancelAnimationFrame(dragFrame); dragFrame = 0; pendingDirection = 0; });
    button.addEventListener('wheel',e => {
      e.preventDefault(); e.stopPropagation();
      if (state === 'open' || state === 'unlocking') return;
      wheelStats.wheelEvents++;
      const now = performance.now();
      if (now - lastWheel >= 240) { wheelAccumulated = 0; wheelGestureConsumed = false; }
      lastWheel = now;
      if (wheelGestureConsumed || now - lastWheelTurn < 320) { wheelStats.wheelSuppressed++; wheelAccumulated = 0; return; }
      // Un cran, un chiffre : aucune accumulation des mouvements trop rapides.
      wheelAccumulated += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 80 : 1);
      if (Math.abs(wheelAccumulated) >= 30) {
        const direction = Math.sign(wheelAccumulated); wheelAccumulated = 0; lastWheelTurn = now; wheelGestureConsumed = true; wheelStats.wheelTurns++; turnWheel(i,direction);
      }
    },{ passive:false });
    button.addEventListener('keydown',e => {
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { wheelButtons[clamp(i + (e.key === 'ArrowLeft' ? -1 : 1),0,23)].focus({ preventScroll:true }); return; }
      const steps = e.key === 'Home' ? -values[i] : e.key === 'End' ? 9 - values[i] : e.key === 'PageUp' ? 3 : e.key === 'PageDown' ? -3 : e.key === 'ArrowUp' ? 1 : -1;
      turnWheel(i,steps);
    });
    button.addEventListener('click',e => { e.preventDefault(); e.stopPropagation(); });
  }
  async function checkGift() {
    if (giftCheckPromise) return giftCheckPromise;
    giftCheckPromise = (async () => {
      const app = window.JLV || {}, href = app.apkUrl || 'downloads/Juste-la-vie.apk';
      giftAvailable = app.apkAvailable === true;
      if (!giftAvailable) {
        try {
          const response = await fetch(href,{ method:'HEAD', cache:'no-store' });
          const type = response.headers.get('Content-Type') || '';
          giftAvailable = response.ok && !/text\/html/i.test(type);
          if (!giftAvailable && (response.status === 405 || response.status === 501)) {
            const partial = await fetch(href,{ headers:{ Range:'bytes=0-3' },cache:'no-store' });
            const contentType = partial.headers.get('Content-Type') || '';
            giftAvailable = partial.ok && !/text\/html/i.test(contentType);
            if (partial.body) partial.body.cancel().catch(() => {});
          }
        } catch (_) { giftAvailable = false; }
      }
      giftChecked = true;
      if (host) {
        const link = host.querySelector('.lk-download'), note = host.querySelector('.lk-gift-note');
        link.href = href; link.hidden = !giftAvailable;
        note.textContent = giftAvailable ? 'Android · Album et clips hors ligne' : 'Votre cadeau sera disponible ici dès que l’APK est prêt.';
      }
      return giftAvailable;
    })();
    return giftCheckPromise;
  }
  function startReward() {
    const button = host.querySelector('.lk-reward-play');
    try {
      const result = window.JLV && window.JLV.playReward && window.JLV.playReward();
      if (result && typeof result.then === 'function') result.then(success => { button.hidden = success !== false; }).catch(() => { button.hidden = false; });
      else button.hidden = result !== false;
    } catch (_) { button.hidden = false; }
  }
  function unlock() {
    if (state === 'unlocking' || state === 'open') return;
    if (!values.every((n,i) => n === secretSequence[i])) {
      mechanismSound('error');
      if (!reducedMotion) {
        clearTimeout(missTimer); document.body.classList.remove('jlv-miss'); void document.body.offsetWidth; document.body.classList.add('jlv-miss');
        missTimer = setTimeout(() => document.body.classList.remove('jlv-miss'),460);
        document.dispatchEvent(new CustomEvent('jlv:shake',{ detail:{ power:1 } }));
      }
      state = 'wrong'; host.dataset.state = state; setStatus('Le mécanisme résiste. Vérifiez les 24 chiffres dans l’ordre des clips.',true);
      setTimeout(() => { if (state === 'wrong') host.dataset.state = 'locked'; },500);
      return;
    }
    // Reserve the panel once. Its reveal animates composite layers, not height.
    const machine = host.querySelector('.lk-machine');
    machine.style.minHeight = machine.getBoundingClientRect().height + 'px';
    state = 'unlocking'; host.dataset.state = state;
    host.dataset.seal = 'release';
    gearKick += 160; host.style.setProperty('--gear-kick',gearKick + 'deg');
    mechanismSound('unlock');
    host.querySelector('.lk-open').disabled = true; host.querySelector('.lk-reset').disabled = true;
    wheelButtons.forEach(b => { b.disabled = true; });
    setStatus('La lumière trouve son passage. Toujours plus haut.'); updateCounter(); startReward(); checkGift();
    document.dispatchEvent(new CustomEvent('jlv:reward',{ detail:{ phase:'mechanism' } }));
    const orbit = host.querySelector('.lk-orbit'), r = orbit.getBoundingClientRect();
    burst(r.left + r.width / 2,r.top + r.height / 2,100,2.4); localSparks(orbit,32,true);
    clearTimeout(rewardTimer);
    rewardTimer = setTimeout(() => {
      state = 'open'; host.dataset.state = state;
      host.dataset.seal = 'prism';
      mechanismSound('chime');
      host.querySelector('.lk-gift').hidden = false;
      host.querySelector('.lk-open').hidden = true; host.querySelector('.lk-reset').hidden = true;
      setStatus('Les 24 éclats sont réunis. Le cadeau est à vous.'); updateCounter();
      const bounds = host.getBoundingClientRect(); burst(bounds.left + bounds.width / 2,bounds.top + bounds.height * .35,145,3);
      document.dispatchEvent(new CustomEvent('jlv:reward',{ detail:{ phase:'gift' } }));
    },reducedMotion ? 100 : 1580);
  }
  function reset() {
    if (state === 'unlocking' || state === 'open') return;
    state = 'locked'; host.dataset.state = state;
    mechanismSound('reset');
    values.fill(0); turns = values.slice(); values.forEach((_,i) => renderWheel(i)); saveProgress(); updateCounter();
    setStatus('Les rouleaux reviennent à zéro. Les éclats attendent dans les clips.');
  }
  function initialise() {
    const fin = document.getElementById('fin');
    if (!fin) return;
    host = document.getElementById('lockHost');
    if (!host) { host = document.createElement('div'); host.id = 'lockHost'; fin.appendChild(host); }
    values = readProgress(); turns = values.slice();
    host.dataset.state = 'locked';
    host.dataset.seal = 'closed';
    host.innerHTML = `<p class="lk-eyebrow">Un dernier passage</p><h3 class="lk-heading">Réunir les éclats.</h3><p class="lk-lead">Un chiffre traverse chaque clip. Gardez les 24 chiffres dans l’ordre de votre voyage. Au bout, un cadeau vous attend.</p><div class="lk-machine"><i class="lk-bolt" aria-hidden="true"></i><i class="lk-bolt" aria-hidden="true"></i><i class="lk-bolt" aria-hidden="true"></i><i class="lk-bolt" aria-hidden="true"></i><div class="lk-orbit">${gearSvg()}${gearSvg(true)}<div class="lk-orbit-core"><svg class="lk-padlock" aria-hidden="true" viewBox="0 0 24 24"><path class="lk-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="4" y="10" width="16" height="12" rx="3"/><path d="M12 14v4"/></svg></div><span class="lk-progress" aria-hidden="true"></span></div><div class="lk-banks">${[0,6,12,18].map(bankMarkup).join('')}</div><p class="lk-instructions" id="lk-instructions">24 chiffres, dans l’ordre des clips.<br>Molette / glisser / clavier ↑ ↓ · Choisir : ← →.</p><div class="lk-actions"><button type="button" class="lk-open">Ouvrir le cadeau</button><button type="button" class="lk-reset">Remettre à zéro</button></div><p class="lk-status" role="status" aria-live="polite">24 chiffres. Un instant de lumière dans chaque clip.</p><div class="lk-energy-glow" aria-hidden="true"></div><div class="lk-unlock-ring" aria-hidden="true"></div><div class="lk-flare" aria-hidden="true"></div><div class="lk-ray" aria-hidden="true"></div><div class="lk-gift" hidden><h4 class="lk-gift-title">Toujours plus haut.</h4><p class="lk-gift-copy">Votre voyage continue.<br>Emportez l’album, ses images et sa lumière.</p><a class="lk-download" href="downloads/Juste-la-vie.apk" download="Juste-la-vie.apk" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span>Télécharger mon cadeau</span></a><small class="lk-gift-note">Préparation de votre cadeau…</small><button class="lk-open lk-reward-play" type="button" hidden>Relancer le son</button></div></div>`;
    [
      ['.lk-actions .lk-open','lock','Ouvrir le cadeau'],
      ['.lk-reset','reset','Remettre à zéro'],
      ['.lk-download','download','Télécharger mon cadeau Android'],
      ['.lk-reward-play','play','Relancer le son']
    ].forEach(([selector,icon,label]) => {
      const control = host.querySelector(selector); control.innerHTML = controlIcon(icon); control.setAttribute('aria-label',label);
    });
    host.querySelector('.lk-orbit').insertAdjacentHTML('beforeend',`<i class="lk-prism-halo" aria-hidden="true"></i>${sealSvg()}${prismSvg()}`);
    host.querySelector('.lk-gift').insertAdjacentHTML('afterbegin','<div class="lk-gift-emblem" aria-hidden="true"><img src="media/pochette_s.webp" alt="" loading="lazy"></div>');
    wheelButtons = Array.from(host.querySelectorAll('.lk-wheel'));
    wheelButtons.forEach((button,i) => { renderWheel(i); attachWheel(button,i); }); updateCounter();
    host.querySelector('.lk-open').addEventListener('click',unlock);
    host.querySelector('.lk-reset').addEventListener('click',reset);
    host.querySelector('.lk-reward-play').addEventListener('click',startReward);
    // Les commandes du cadenas ne déclenchent jamais le play/pause global du clip.
    ['click','dblclick','pointerdown','pointerup','keydown'].forEach(type => host.addEventListener(type,e => e.stopPropagation()));
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        observed = entries[0].isIntersecting && entries[0].intersectionRatio > 0;
        setActive(observed);
        if (observed && !giftChecked) checkGift();
      },{ root:document.getElementById('scroller'),threshold:[0,.01,.1] });
      observer.observe(host);
    } else { observed = true; setActive(true); }
    window.JLVSecret = Object.freeze({ reset, refreshGift:() => { giftCheckPromise = null; giftChecked = false; return checkGift(); }, getValues:() => values.slice() });
  }

  function hiddenDigit() {
    if (digitState && digitState.el) digitState.el.classList.remove('is-visible');
  }
  function discardDigit() {
    cancelAnimationFrame(digitFrame); digitFrame = 0;
    if (digitState) {
      digitState.el.remove();
      ['play','pause','timeupdate','seeking','ended'].forEach(type => digitState.media.removeEventListener(type,runDigit));
    }
    digitState = null;
  }
  function visibleVideoRect(video, section) {
    const v = video.getBoundingClientRect(), s = section.getBoundingClientRect();
    let left = Math.max(v.left,s.left), top = Math.max(v.top,s.top), right = Math.min(v.right,s.right), bottom = Math.min(v.bottom,s.bottom);
    if (getComputedStyle(video).objectFit === 'contain') {
      const aspect = (video.videoWidth || 1920) / (video.videoHeight || 1080), width = Math.min(v.width,v.height * aspect), height = width / aspect;
      left = Math.max(left,v.left + (v.width - width) / 2); right = Math.min(right,v.left + (v.width + width) / 2);
      top = Math.max(top,v.top + (v.height - height) / 2); bottom = Math.min(bottom,v.top + (v.height + height) / 2);
    }
    return { left, top, right, bottom, width:right-left, height:bottom-top, section:s };
  }
  function placeDigit(s) {
    const rect = visibleVideoRect(s.media,s.section);
    if (rect.width < 50 || rect.height < 70) return false;
    const obstacles = Array.from(document.querySelectorAll('#tools,#rail,#bar,#brand')).concat(Array.from(s.section.querySelectorAll('.meta,.lyr,.clip-controls'))).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const xMin = rect.left + Math.min(42,rect.width * .12), xMax = rect.right - Math.min(76,rect.width * .18);
    const yMin = rect.top + Math.min(96,rect.height * .2), yMax = rect.top + rect.height * .58;
    let chosen = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = random(xMin,Math.max(xMin,xMax)), y = random(yMin,Math.max(yMin,yMax));
      if (obstacles.every(r => x + 23 < r.left || x - 23 > r.right || y + 28 < r.top || y - 28 > r.bottom)) { chosen = { x,y }; break; }
    }
    // Aucune place lisible : attendre plutôt que masquer une commande ou le texte.
    if (!chosen) return false;
    s.el.style.left = (chosen.x - rect.section.left) + 'px'; s.el.style.top = (chosen.y - rect.section.top) + 'px';
    s.positioned = true; return true;
  }
  function activeDigitPage(s) {
    const app = window.JLV || {};
    return app.current === s.index && (app.page === undefined || app.page === s.index) && !document.hidden;
  }
  function runDigit() {
    cancelAnimationFrame(digitFrame); digitFrame = 0;
    const s = digitState;
    if (!s || s.done || !activeDigitPage(s) || s.media.paused || s.media.ended) { hiddenDigit(); return; }
    const now = s.media.currentTime || 0;
    if (!s.revealed && s.section.classList.contains('clip-on')) s.revealed = true;
    if (s.revealed && now >= s.triggerAt) {
      if (!s.positioned && !placeDigit(s)) { digitFrame = requestAnimationFrame(runDigit); return; }
      if (s.lastShownTime === null) s.lastShownTime = now;
      const delta = now - s.lastShownTime;
      if (delta > 0) s.remaining -= Math.min(delta,.15);
      s.lastShownTime = now;
      if (s.remaining <= 0) { s.done = true; hiddenDigit(); return; }
      s.el.classList.add('is-visible');
    } else { hiddenDigit(); s.lastShownTime = null; }
    digitFrame = requestAnimationFrame(runDigit);
  }
  function scheduleDigit(event) {
    discardDigit();
    const detail = event.detail || {}, app = window.JLV || {};
    const index = detail.index === undefined ? app.current : detail.index;
    const track = detail.track || (app.tracks || [])[index], section = detail.section || (app.sections || [])[index], media = detail.media || app.media;
    if (!track || !section || !media || media.tagName !== 'VIDEO' || config.digits[track.n] === undefined) return;
    const el = document.createElement('span'); el.className = 'jlv-secret-digit'; el.setAttribute('aria-hidden','true'); el.textContent = String(config.digits[track.n]); section.appendChild(el);
    const current = media.currentTime || 0, duration = Number.isFinite(media.duration) ? media.duration : track.duree || 120;
    const remaining = Math.max(1,duration-current);
    const delay = random(Math.min(4.4,remaining * .2),Math.max(.9,Math.min(17.5,remaining * .45)));
    digitState = { index, track, section, media, el, triggerAt:current + delay, revealed:section.classList.contains('clip-on'), positioned:false, remaining:.66, lastShownTime:null, done:false };
    ['play','pause','timeupdate','seeking','ended'].forEach(type => media.addEventListener(type,runDigit));
    runDigit();
  }
  document.addEventListener('jlv:track',scheduleDigit);
  document.addEventListener('jlv:reveal',event => {
    if (digitState && event.detail && event.detail.index === digitState.index) { digitState.revealed = true; runDigit(); }
  });
  document.addEventListener('jlv:page',() => { if (digitState && !activeDigitPage(digitState)) { cancelAnimationFrame(digitFrame); digitFrame = 0; hiddenDigit(); } else runDigit(); });
  document.addEventListener('visibilitychange',() => { setActive(observed); if (document.hidden) saveProgress(); if (digitState) { digitState.lastShownTime = null; runDigit(); } });
  window.addEventListener('pagehide',saveProgress);
  window.addEventListener('resize',() => { if (host && (state === 'open' || state === 'unlocking')) host.querySelector('.lk-machine').style.minHeight = ''; if (digitState && !digitState.done) { digitState.positioned = false; runDigit(); } });
  document.addEventListener('jlv:energy',event => {
    if (!host || !observed || document.hidden || !event.detail) return;
    const now = performance.now(); if (now - lastEnergyPaint < 65) return; lastEnergyPaint = now;
    const target = clamp((event.detail.bass || 0) * .85 + (event.detail.high || 0) * .2,0,1);
    energyValue += (target-energyValue) * .34;
    const glow = host.querySelector('.lk-energy-glow');
    if (glow) glow.style.opacity = (.18 + energyValue * .55).toFixed(3);
  });
  document.addEventListener('jlv:apk-ready',() => { giftCheckPromise = null; giftChecked = false; checkGift(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialise,{ once:true });
  else initialise();
})();
