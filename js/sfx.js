/**
 * Psychic City Smash — SFX sintetizados (Web Audio API, sin archivos externos)
 *
 * Script clásico (IIFE, NO módulo ES). Único global: window.SFX.
 *
 * Integración:
 *   <script src="js/sfx.js"></script>            ← antes de <script type="module" src="js/game.js">
 *   En el primer toque/clic/tecla: SFX.unlock();  (también se autoengancha a touchstart/touchend/
 *   pointerdown/mousedown/keydown hasta que el AudioContext esté "running"; iOS lo exige).
 *   Desde módulos ES: window.SFX.explosion(1.5)  (o const SFX = window.SFX;)
 *
 * API (todas son no-op seguras si no hay audio o aún no se desbloqueó; nunca lanzan):
 *   unlock()                    crea/reanuda el contexto + buffer silencioso (llamar N veces es OK)
 *   isReady()                   true si el contexto está corriendo
 *   explosion(size=1)           size 0.2..3 — golpe grave + ráfaga de ruido filtrado
 *   collapse()                  derrumbe de edificio (retumbo largo + desmoronamiento)
 *   debris()                    traqueteo corto de escombros (con throttle)
 *   laserStart() / laserStop()  zumbido en loop de láser ocular (idempotente, fade in/out)
 *   throw()                     whoosh
 *   grab()                      "wub" psíquico + brillo
 *   carHit()                    impacto metálico (con throttle)
 *   fire()                      crepitar
 *   flyStart() / flyStop() / flyLoop(on) / setFlySpeed(0..1)   viento en loop al volar
 *   land()                      aterrizaje pesado
 *   uiClick()                   clic corto
 *   — Vehículos —
 *   engineStart() / engineStop() / setEngine(rpm01, load01)    motor en loop (uno: el del jugador)
 *   skid(intensity 0..1)        chirrido corto de llantas (con throttle)
 *   skidStart() / skidStop() / setSkid(0..1)                    chirrido continuo
 *   crash(severity 0..3)        choque auto-auto: golpe + metal + vidrio
 *   partFall()                  clank de defensa/puerta cayendo
 *   tireBounce()                rebote de llanta
 *   horn(dur=0.45)              claxon
 *   — Maniquíes / ragdolls (caricaturesco, sin gore) —
 *   bodyThud(force 0..1)        cuerpo hueco de plástico/madera contra el suelo
 *   limbPop()                   articulación que se suelta ("pok" + clic)
 *   laserSlice()                corte rápido de láser (chisporroteo/zap)
 *   ragdollClatter()            extremidades golpeteando (con throttle)
 *   bounce()                    golpecito hueco ligero
 *   — Volumen —
 *   setVolume(0..1), getVolume(), setMuted(bool), toggleMute(), isMuted()
 *   (persisten en localStorage, clave 'pcs.audio')
 *   — Compatibilidad con js/audio.js (`sfx.*`) para poder redirigir sin cambiar llamadas —
 *   smash, shatter, shock, crush, slam, shield, hydrant, flee, hit, ui, explode, freeze,
 *   charge, setSoundEnabled(bool)
 */
(function () {
  'use strict';
  var W = window;
  var AC = W.AudioContext || W.webkitAudioContext;
  var STORE = 'pcs.audio';
  var MAX_VOICES = 16;

  var ctx = null, master = null, comp = null;
  var volume = 0.8, muted = false;
  var bufWhite = null, bufBrown = null, bufPink = null, bufSilent = null;
  var voices = [];
  var lastT = {};
  var loops = { laser: null, fly: null, engine: null, skid: null };
  var flySpeed = 0.3, engRpm = 0, engLoad = 0, skidAmt = 0.6;
  var hiddenSuspended = false;
  var listenersOn = false;

  function noop() {}
  function clamp(v, a, b) { v = +v; if (v !== v) v = a; return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function nowMs() { return (W.performance && performance.now) ? performance.now() : Date.now(); }
  function safe(fn) {
    return function () { try { return fn.apply(null, arguments); } catch (e) { return undefined; } };
  }

  // ---------- Preferencias ----------
  try {
    var saved = JSON.parse(W.localStorage.getItem(STORE) || 'null');
    if (saved) {
      if (typeof saved.volume === 'number') volume = clamp(saved.volume, 0, 1);
      if (typeof saved.muted === 'boolean') muted = saved.muted;
    }
  } catch (e) { /* sin localStorage */ }
  function savePrefs() {
    try { W.localStorage.setItem(STORE, JSON.stringify({ volume: volume, muted: muted })); } catch (e) {}
  }
  function applyMaster(fast) {
    if (!master) return;
    var t = ctx.currentTime, target = muted ? 0 : volume * volume; // curva perceptual
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(target, t, fast ? 0.01 : 0.05);
  }

  // ---------- Contexto ----------
  function makeNoise(kind, secs) {
    var len = Math.floor(ctx.sampleRate * secs);
    var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), i, w, last = 0;
    var b0 = 0, b1 = 0, b2 = 0;
    for (i = 0; i < len; i++) {
      w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else d[i] = w;
    }
    return b;
  }
  function ensureCtx() {
    if (ctx) return true;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    comp = ctx.createDynamicsCompressor();
    try {
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.25;
    } catch (e) {}
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume * volume;
    master.connect(comp); comp.connect(ctx.destination);
    bufWhite = makeNoise('white', 2);
    bufBrown = makeNoise('brown', 2);
    bufPink = makeNoise('pink', 2);
    bufSilent = ctx.createBuffer(1, 1, 22050);
    return true;
  }
  function ready() { return !!ctx && ctx.state === 'running'; }
  function canPlay() { return ready() && !muted && volume > 0; }

  function unlock() {
    if (!ensureCtx()) return false;
    try {
      var s = ctx.createBufferSource();
      s.buffer = bufSilent; s.connect(ctx.destination);
      s.onended = function () { try { s.disconnect(); } catch (e) {} };
      s.start(0);
    } catch (e) {}
    if (ctx.state !== 'running' && ctx.resume) {
      try { var p = ctx.resume(); if (p && p.then) p.then(onRunning, noop); } catch (e) {}
    }
    onRunning();
    return ready();
  }
  function onRunning() { if (ready()) detachUnlock(); }
  function gestureUnlock() { try { unlock(); } catch (e) {} }
  var EVTS = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'];
  function attachUnlock() {
    if (listenersOn || !AC) return;
    listenersOn = true;
    for (var i = 0; i < EVTS.length; i++) {
      try { W.addEventListener(EVTS[i], gestureUnlock, { capture: true, passive: true }); } catch (e) {}
    }
  }
  function detachUnlock() {
    if (!listenersOn) return;
    listenersOn = false;
    for (var i = 0; i < EVTS.length; i++) {
      try { W.removeEventListener(EVTS[i], gestureUnlock, { capture: true }); } catch (e) {}
    }
  }

  try {
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      try {
        if (document.hidden) {
          if (ctx.state === 'running') { hiddenSuspended = true; ctx.suspend(); }
        } else if (hiddenSuspended) {
          hiddenSuspended = false;
          var p = ctx.resume(); if (p && p.catch) p.catch(noop);
        }
      } catch (e) {}
    });
  } catch (e) {}

  // ---------- Voces (one-shots) ----------
  function throttle(key, ms) {
    var t = nowMs();
    if (lastT[key] && t - lastT[key] < ms) return false;
    lastT[key] = t; return true;
  }
  function freeVoice(v) {
    if (v.done) return;
    v.done = true;
    for (var i = 0; i < v.nodes.length; i++) { try { v.nodes[i].disconnect(); } catch (e) {} }
    v.nodes.length = 0; v.srcs.length = 0;
    var k = voices.indexOf(v); if (k >= 0) voices.splice(k, 1);
  }
  function killVoice(v) {
    var t = ctx.currentTime;
    try {
      v.bus.gain.cancelScheduledValues(t);
      v.bus.gain.setValueAtTime(v.bus.gain.value, t);
      v.bus.gain.linearRampToValueAtTime(0, t + 0.02);
    } catch (e) {}
    for (var i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(t + 0.03); } catch (e) {} }
    var k = voices.indexOf(v); if (k >= 0) voices.splice(k, 1);
    setTimeout(function () { freeVoice(v); }, 80);
  }
  function prune() {
    var t = ctx.currentTime;
    for (var i = voices.length - 1; i >= 0; i--) if (voices[i].end < t - 0.5) freeVoice(voices[i]);
  }
  function voice(level) {
    if (!canPlay()) return null;
    prune();
    while (voices.length >= MAX_VOICES) killVoice(voices[0]);
    var v = { t: ctx.currentTime + 0.005, end: ctx.currentTime, bus: ctx.createGain(), nodes: [], srcs: [], done: false };
    v.bus.gain.value = level == null ? 1 : level;
    v.bus.connect(master); v.nodes.push(v.bus);
    voices.push(v);
    return v;
  }
  function run(v, src, t0, t1, offset) {
    v.srcs.push(src); v.nodes.push(src);
    src.onended = function () {
      var k = v.srcs.indexOf(src); if (k >= 0) v.srcs.splice(k, 1);
      if (!v.srcs.length) freeVoice(v);
    };
    if (offset != null) src.start(t0, offset); else src.start(t0);
    src.stop(t1);
    if (t1 > v.end) v.end = t1;
  }
  // Nodos encadenados hacia `dest`
  function G(v, dest, val) { var g = ctx.createGain(); g.gain.value = val == null ? 0 : val; g.connect(dest || v.bus); v.nodes.push(g); return g; }
  function F(v, dest, type, f, q) {
    var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q;
    b.connect(dest || v.bus); v.nodes.push(b); return b;
  }
  function env(g, t, a, peak, d, hold) {
    var p = g.gain; peak = Math.max(peak, 0.0002); hold = hold || 0;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    return t + a + hold + d;
  }
  function O(v, dest, type, f0, f1, t0, dur) {
    var o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    o.connect(dest); run(v, o, t0, t0 + dur + 0.02); return o;
  }
  function N(v, dest, buf, t0, dur, rate) {
    var s = ctx.createBufferSource(); s.buffer = buf || bufWhite; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.connect(dest); run(v, s, t0, t0 + dur + 0.02, Math.random() * 1.5); return s;
  }
  // Tono con envolvente (atajo)
  function tone(v, type, f0, f1, t, a, peak, d, dest) {
    var g = G(v, dest); env(g, t, a, peak, d); O(v, g, type, f0, f1, t, a + d); return g;
  }
  // Ráfaga de ruido filtrado con envolvente (atajo)
  function burst(v, buf, ftype, f0, f1, q, t, a, peak, d, dest) {
    var g = G(v, dest); env(g, t, a, peak, d);
    var f = F(v, g, ftype, f0, q);
    if (f1 && f1 !== f0) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + a + d); }
    N(v, f, buf, t, a + d); return g;
  }
  function metal(v, t, base, peak, decay, dest) {
    var ratios = [1, 1.59, 2.37, 3.11, 4.23];
    for (var i = 0; i < ratios.length; i++) {
      tone(v, i % 2 ? 'square' : 'sine', base * ratios[i] * rnd(0.97, 1.03), 0, t, 0.002,
        peak / (i + 1.5), decay * (1 - i * 0.12), dest);
    }
  }
  function glass(v, t, amt) {
    var n = Math.round(4 + amt * 6), i, tt;
    burst(v, bufWhite, 'highpass', 3500, 0, 0.7, t, 0.002, 0.35 * amt, 0.12);
    for (i = 0; i < n; i++) {
      tt = t + rnd(0.01, 0.25 + amt * 0.15);
      tone(v, 'sine', rnd(2500, 6500), 0, tt, 0.001, rnd(0.03, 0.08) * amt, rnd(0.04, 0.12));
      if (i % 2) burst(v, bufWhite, 'bandpass', rnd(4000, 8000), 0, 6, tt, 0.001, 0.12 * amt, 0.03);
    }
  }

  // ---------- One-shots ----------
  function explosion(size) {
    if (!canPlay() || !throttle('exp', 40)) return;
    var s = clamp(size == null ? 1 : size, 0.2, 3), v = voice(1); if (!v) return;
    var t = v.t, dur = 0.5 + 0.8 * s, lvl = Math.min(1, 0.45 + 0.25 * s);
    tone(v, 'sine', 120 / (0.7 + 0.3 * s), 28, t, 0.005, 0.9 * lvl, dur * 0.8);
    burst(v, bufBrown, 'lowpass', 2600 / (0.6 + 0.4 * s), 120, 0.7, t, 0.008, 0.9 * lvl, dur);
    burst(v, bufWhite, 'highpass', 1200, 400, 0.5, t, 0.002, 0.25 * lvl, 0.08 + 0.05 * s);
    if (s > 1.4) burst(v, bufBrown, 'lowpass', 300, 60, 1, t + 0.15, 0.2, 0.5 * lvl, dur * 0.9);
  }
  function collapse() {
    if (!canPlay() || !throttle('col', 250)) return;
    var v = voice(1); if (!v) return;
    var t = v.t, i;
    burst(v, bufBrown, 'lowpass', 500, 90, 0.8, t, 0.25, 0.85, 2.4, null);
    tone(v, 'sine', 55, 32, t, 0.15, 0.4, 2.2);
    for (i = 0; i < 9; i++) {
      burst(v, i % 3 ? bufPink : bufWhite, 'bandpass', rnd(400, 2200), 0, rnd(2, 6),
        t + rnd(0.05, 2.0), 0.003, rnd(0.12, 0.3), rnd(0.05, 0.18));
    }
  }
  function debris() {
    if (!canPlay() || !throttle('deb', 60)) return;
    var v = voice(0.8); if (!v) return;
    var n = 3 + (Math.random() * 3 | 0), i;
    for (i = 0; i < n; i++) {
      burst(v, bufWhite, 'bandpass', rnd(900, 3500), 0, rnd(3, 9), v.t + i * rnd(0.03, 0.07),
        0.001, rnd(0.15, 0.35), rnd(0.03, 0.08));
    }
  }
  function whoosh() {
    if (!canPlay() || !throttle('thr', 50)) return;
    var v = voice(0.9); if (!v) return;
    var g = G(v); g.gain.setValueAtTime(0.0001, v.t);
    g.gain.exponentialRampToValueAtTime(0.5, v.t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, v.t + 0.38);
    var f = F(v, g, 'bandpass', 300, 1.6);
    f.frequency.setValueAtTime(300, v.t);
    f.frequency.exponentialRampToValueAtTime(2200, v.t + 0.14);
    f.frequency.exponentialRampToValueAtTime(450, v.t + 0.38);
    N(v, f, bufWhite, v.t, 0.4);
  }
  function grab() {
    if (!canPlay() || !throttle('grab', 60)) return;
    var v = voice(0.7); if (!v) return;
    var t = v.t, g = G(v), o, lfo, lg;
    env(g, t, 0.02, 0.45, 0.35);
    o = O(v, g, 'sine', 190, 85, t, 0.37);
    lfo = ctx.createOscillator(); lfo.frequency.value = 14;
    lg = G(v, o.frequency, 25); lfo.connect(lg); run(v, lfo, t, t + 0.4);
    tone(v, 'triangle', 880, 1400, t + 0.02, 0.03, 0.07, 0.3);
    tone(v, 'sine', 1320, 2100, t + 0.05, 0.03, 0.04, 0.25);
  }
  function carHit() {
    if (!canPlay() || !throttle('car', 70)) return;
    var v = voice(0.8); if (!v) return;
    metal(v, v.t, rnd(240, 340), 0.4, 0.35);
    burst(v, bufWhite, 'bandpass', 2500, 0, 1.5, v.t, 0.001, 0.35, 0.07);
    tone(v, 'sine', 110, 50, v.t, 0.003, 0.5, 0.15);
  }
  function fire() {
    if (!canPlay() || !throttle('fire', 80)) return;
    var v = voice(0.7); if (!v) return;
    var t = v.t, i;
    burst(v, bufBrown, 'lowpass', 900, 300, 0.7, t, 0.05, 0.35, 0.45);
    for (i = 0; i < 10; i++) {
      burst(v, bufWhite, 'highpass', rnd(1500, 5000), 0, 0.7, t + rnd(0, 0.5),
        0.001, rnd(0.08, 0.25), rnd(0.008, 0.025));
    }
  }
  function land() {
    if (!canPlay() || !throttle('land', 120)) return;
    var v = voice(1); if (!v) return;
    tone(v, 'sine', 95, 32, v.t, 0.004, 0.9, 0.42);
    burst(v, bufBrown, 'lowpass', 400, 90, 0.7, v.t, 0.005, 0.7, 0.32);
    burst(v, bufWhite, 'bandpass', 1500, 0, 2, v.t + 0.01, 0.002, 0.12, 0.1);
  }
  function uiClick() {
    if (!canPlay() || !throttle('ui', 30)) return;
    var v = voice(0.5); if (!v) return;
    tone(v, 'square', 1800, 1200, v.t, 0.001, 0.12, 0.03);
    tone(v, 'sine', 600, 0, v.t, 0.001, 0.15, 0.05);
  }

  // ---------- Vehículos (one-shots) ----------
  function skid(intensity) {
    if (loops.skid && !loops.skid.stopping) { setSkid(intensity == null ? skidAmt : intensity); return; }
    if (!canPlay() || !throttle('skid', 150)) return;
    var k = clamp(intensity == null ? 0.6 : intensity, 0, 1); if (k <= 0) return;
    var v = voice(0.8); if (!v) return;
    var t = v.t, d = 0.2 + 0.3 * k, g = G(v);
    env(g, t, 0.03, 0.6 * k, d, d * 0.3);
    var f1 = F(v, g, 'bandpass', 2100 + rnd(-200, 200), 9);
    var f2 = F(v, g, 'bandpass', 3300 + rnd(-200, 200), 10);
    var src = N(v, f1, bufWhite, t, d * 1.4); src.connect(f2);
  }
  function crash(severity) {
    if (!canPlay() || !throttle('crash', 90)) return;
    var s = clamp(severity == null ? 1 : severity, 0, 3), v = voice(1); if (!v) return;
    var t = v.t, k = 0.35 + s * 0.22, i;
    tone(v, 'sine', 90, 30, t, 0.003, Math.min(1, 0.5 + 0.2 * s), 0.25 + 0.15 * s);
    burst(v, bufBrown, 'lowpass', 1800, 150, 0.7, t, 0.004, k, 0.3 + 0.2 * s);
    metal(v, t, rnd(160, 260), 0.3 + 0.1 * s, 0.4 + 0.25 * s);
    for (i = 0; i < 1 + Math.round(s); i++) metal(v, t + rnd(0.04, 0.2 + 0.1 * s), rnd(300, 600), 0.15, 0.2);
    burst(v, bufWhite, 'bandpass', 1800, 700, 1.2, t, 0.002, 0.3 * k, 0.25 + 0.1 * s);
    if (s >= 0.8) glass(v, t + 0.02, Math.min(1, s / 2.2));
  }
  function partFall() {
    if (!canPlay() || !throttle('part', 80)) return;
    var v = voice(0.7); if (!v) return;
    var base = rnd(350, 600), hits = [0, 0.14, 0.24, 0.3], amp = 0.32, i;
    for (i = 0; i < hits.length; i++, amp *= 0.5) {
      metal(v, v.t + hits[i] * rnd(0.9, 1.1), base * rnd(0.95, 1.05), amp, 0.18);
      burst(v, bufWhite, 'bandpass', 3000, 0, 2, v.t + hits[i], 0.001, amp * 0.6, 0.025);
    }
  }
  function tireBounce() {
    if (!canPlay() || !throttle('tire', 60)) return;
    var v = voice(0.8); if (!v) return;
    tone(v, 'sine', 130, 55, v.t, 0.003, 0.6, 0.18);
    tone(v, 'triangle', 220, 120, v.t, 0.002, 0.12, 0.08);
    burst(v, bufBrown, 'lowpass', 500, 120, 0.7, v.t, 0.003, 0.35, 0.12);
  }
  function horn(dur) {
    if (!canPlay() || !throttle('horn', 300)) return;
    var d = clamp(dur == null ? 0.45 : dur, 0.08, 3), v = voice(0.6); if (!v) return;
    var t = v.t, g = G(v), f = F(v, g, 'lowpass', 1800, 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.setValueAtTime(0.22, t + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.06);
    O(v, f, 'sawtooth', 410, 0, t, d + 0.08);
    O(v, f, 'square', 515, 0, t, d + 0.08);
  }

  // ---------- Maniquíes / ragdolls ----------
  // Golpe hueco: tono con pitch-drop rápido + resonancia de caja (bandpass) + ruido corto
  function knock(v, t, f, amp, d) {
    tone(v, 'triangle', f * 1.6, f, t, 0.001, amp, d);
    tone(v, 'sine', f * 2.7, f * 2.3, t, 0.001, amp * 0.35, d * 0.6);
    burst(v, bufWhite, 'bandpass', f * rnd(4, 6), 0, 4, t, 0.001, amp * 0.5, 0.02);
  }
  function bodyThud(force) {
    if (!canPlay() || !throttle('thud', 70)) return;
    var k = clamp(force == null ? 0.6 : force, 0, 1), v = voice(0.9); if (!v) return;
    var t = v.t, f = rnd(150, 230) * (1.15 - 0.35 * k), amp = 0.25 + 0.45 * k;
    knock(v, t, f, amp, 0.12 + 0.12 * k);
    tone(v, 'sine', 110 - 30 * k, 45, t, 0.003, amp * 0.8, 0.15 + 0.1 * k);
    burst(v, bufBrown, 'lowpass', 700, 150, 0.7, t, 0.003, amp * 0.5, 0.12);
    if (k > 0.35) knock(v, t + rnd(0.05, 0.11), f * rnd(1.2, 1.6), amp * 0.4, 0.08); // rebote de extremidad
  }
  function limbPop() {
    if (!canPlay() || !throttle('pop', 60)) return;
    var v = voice(0.8); if (!v) return;
    var t = v.t, f = rnd(500, 750);
    tone(v, 'sine', f * 1.8, f * 0.7, t, 0.001, 0.4, 0.07);           // "pok"
    tone(v, 'square', rnd(2200, 3200), 0, t, 0.0005, 0.08, 0.012);    // clic
    burst(v, bufWhite, 'highpass', 3000, 0, 0.7, t, 0.0005, 0.2, 0.015);
    knock(v, t + rnd(0.12, 0.2), rnd(260, 380), 0.12, 0.06);          // la pieza cae
  }
  function laserSlice() {
    if (!canPlay() || !throttle('slice', 70)) return;
    var v = voice(0.7); if (!v) return;
    var t = v.t, f = rnd(1400, 2000);
    tone(v, 'sawtooth', f, f * 2.2, t, 0.002, 0.12, 0.09);            // zap
    tone(v, 'square', f * 0.5, f * 0.25, t, 0.002, 0.05, 0.08);
    burst(v, bufWhite, 'highpass', 2500, 6000, 0.8, t, 0.003, 0.25, 0.18); // sizzle
    for (var i = 0; i < 4; i++) {
      burst(v, bufWhite, 'bandpass', rnd(3000, 7000), 0, 3, t + rnd(0.02, 0.2), 0.001, 0.1, 0.015);
    }
  }
  function ragdollClatter() {
    if (!canPlay() || !throttle('clat', 110)) return;
    var v = voice(0.7); if (!v) return;
    var n = 3 + (Math.random() * 3 | 0), tt = v.t, amp = 0.22;
    for (var i = 0; i < n; i++, amp *= 0.8) {
      knock(v, tt, rnd(280, 650), amp, rnd(0.03, 0.06));
      tt += rnd(0.03, 0.09);
    }
  }
  function bounce() {
    if (!canPlay() || !throttle('bnc', 50)) return;
    var v = voice(0.6); if (!v) return;
    knock(v, v.t, rnd(320, 520), 0.2, 0.06);
  }

  // ---------- Loops ----------
  function newLoop(level) {
    var l = { nodes: [], srcs: [], out: ctx.createGain(), stopping: false, p: {} };
    l.out.gain.value = 0.0001; l.out.connect(master); l.nodes.push(l.out);
    l.out.gain.setTargetAtTime(level, ctx.currentTime, 0.04);
    return l;
  }
  function LN(l, node) { l.nodes.push(node); return node; }
  function LS(l, src) { l.nodes.push(src); l.srcs.push(src); src.start(ctx.currentTime); return src; }
  function LO(l, dest, type, f) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); return LS(l, o); }
  function LNoise(l, dest, buf) {
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(dest);
    l.nodes.push(s); l.srcs.push(s); s.start(ctx.currentTime, Math.random() * 1.5); return s;
  }
  function LG(l, dest, val) { var g = LN(l, ctx.createGain()); g.gain.value = val; g.connect(dest); return g; }
  function LF(l, dest, type, f, q) {
    var b = LN(l, ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q;
    b.connect(dest); return b;
  }
  function stopLoop(name, fade) {
    var l = loops[name]; if (!l) return;
    loops[name] = null; l.stopping = true;
    if (!ctx) return;
    var t = ctx.currentTime; fade = fade || 0.12;
    try {
      l.out.gain.cancelScheduledValues(t);
      l.out.gain.setValueAtTime(l.out.gain.value, t);
      l.out.gain.setTargetAtTime(0, t, fade / 3);
    } catch (e) {}
    for (var i = 0; i < l.srcs.length; i++) { try { l.srcs[i].stop(t + fade + 0.05); } catch (e) {} }
    setTimeout(function () {
      for (var j = 0; j < l.nodes.length; j++) { try { l.nodes[j].disconnect(); } catch (e) {} }
      l.nodes.length = 0; l.srcs.length = 0;
    }, (fade + 0.2) * 1000);
  }

  function laserStart() {
    if (loops.laser || !ready()) return;
    var l = newLoop(0.22), t = ctx.currentTime;
    var bp = LF(l, l.out, 'bandpass', 1300, 2.5);
    var trem = LG(l, bp, 0.8);
    LO(l, trem, 'sawtooth', 220);
    LO(l, trem, 'sawtooth', 223.5);
    LO(l, LG(l, trem, 0.5), 'square', 110);
    LNoise(l, LG(l, LF(l, l.out, 'highpass', 4000, 0.7), 0.12), bufWhite); // chisporroteo
    var lfo = LO(l, LG(l, bp.frequency, 450), 'sine', 6.5);
    var lfo2 = LO(l, LG(l, trem.gain, 0.2), 'sine', 23);
    l.p.lfo = lfo; l.p.lfo2 = lfo2;
    loops.laser = l;
    // ataque brillante
    var v = voice(0.6); if (v) tone(v, 'sawtooth', 900, 2400, t, 0.01, 0.12, 0.12);
  }
  function laserStop() { stopLoop('laser', 0.15); }

  function flyGain() { return 0.1 + 0.32 * flySpeed; }
  function flyStart() {
    if (loops.fly || !ready()) return;
    var l = newLoop(flyGain());
    var lp = LF(l, l.out, 'lowpass', 900 + 2200 * flySpeed, 0.5);
    var bp = LF(l, lp, 'bandpass', 400 + 1400 * flySpeed, 0.9);
    var gust = LG(l, bp, 0.8);
    LNoise(l, gust, bufPink);
    LNoise(l, LG(l, l.out, 0.25), bufBrown);
    LO(l, LG(l, gust.gain, 0.25), 'sine', 0.35);
    LO(l, LG(l, bp.frequency, 180), 'sine', 0.21);
    l.p.lp = lp; l.p.bp = bp;
    loops.fly = l;
  }
  function flyStop() { stopLoop('fly', 0.4); }
  function setFlySpeed(x) {
    flySpeed = clamp(x, 0, 1);
    var l = loops.fly; if (!l || !ctx) return;
    var t = ctx.currentTime;
    l.out.gain.setTargetAtTime(flyGain(), t, 0.15);
    l.p.lp.frequency.setTargetAtTime(900 + 2200 * flySpeed, t, 0.15);
    l.p.bp.frequency.setTargetAtTime(400 + 1400 * flySpeed, t, 0.15);
  }

  function engFreq() { return 38 + 150 * engRpm; }
  function engineStart() {
    if (loops.engine || !ready()) return;
    var l = newLoop(0.2), f = engFreq();
    var lp = LF(l, l.out, 'lowpass', 400 + 2400 * engLoad, 1.2);
    var pulse = LG(l, lp, 0.7);
    var o1 = LO(l, pulse, 'sawtooth', f);
    var o2 = LO(l, LG(l, pulse, 0.6), 'square', f * 0.5);
    var am = LO(l, LG(l, pulse.gain, 0.3), 'sine', f * 0.5);      // pulsos de combustión
    var gritG = LG(l, l.out, 0.03 + 0.15 * engLoad);
    var gritF = LF(l, gritG, 'bandpass', f * 4, 3);
    LNoise(l, gritF, bufWhite);
    l.p = { lp: lp, o1: o1, o2: o2, am: am, gritG: gritG, gritF: gritF };
    loops.engine = l;
  }
  function engineStop() { stopLoop('engine', 0.3); }
  function setEngine(rpm01, load01) {
    engRpm = clamp(rpm01, 0, 1);
    if (load01 != null) engLoad = clamp(load01, 0, 1);
    var l = loops.engine; if (!l || !ctx) return;
    var t = ctx.currentTime, f = engFreq(), p = l.p, tc = 0.06;
    p.o1.frequency.setTargetAtTime(f, t, tc);
    p.o2.frequency.setTargetAtTime(f * 0.5, t, tc);
    p.am.frequency.setTargetAtTime(f * 0.5, t, tc);
    p.gritF.frequency.setTargetAtTime(f * 4, t, tc);
    p.lp.frequency.setTargetAtTime(400 + 2400 * engLoad + 600 * engRpm, t, tc);
    p.gritG.gain.setTargetAtTime(0.03 + 0.15 * engLoad, t, tc);
    l.out.gain.setTargetAtTime(0.14 + 0.1 * engRpm + 0.06 * engLoad, t, tc);
  }

  function skidStart() {
    if (loops.skid || !ready()) return;
    var l = newLoop(0.5 * skidAmt);
    var f1 = LF(l, l.out, 'bandpass', 2200, 9), f2 = LF(l, l.out, 'bandpass', 3400, 10);
    var n = LNoise(l, f1, bufWhite); n.connect(f2);
    LO(l, LG(l, f1.frequency, 120), 'sine', 7);
    loops.skid = l;
  }
  function skidStop() { stopLoop('skid', 0.12); }
  function setSkid(x) {
    skidAmt = clamp(x, 0, 1);
    var l = loops.skid; if (!l || !ctx) return;
    l.out.gain.setTargetAtTime(Math.max(0.0001, 0.5 * skidAmt), ctx.currentTime, 0.04);
  }

  // ---------- Volumen ----------
  function setVolume(x) { volume = clamp(x, 0, 1); savePrefs(); applyMaster(); }
  function getVolume() { return volume; }
  function setMuted(m) { muted = !!m; savePrefs(); applyMaster(true); }
  function toggleMute() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  // ---------- Compatibilidad con js/audio.js ----------
  function shatter() {
    if (!canPlay() || !throttle('shat', 50)) return;
    var v = voice(0.7); if (v) glass(v, v.t, 0.7);
  }
  function smash() { debris(); if (throttle('smashT', 90)) explosion(0.25); }
  function shock() {
    if (!canPlay() || !throttle('shock', 60)) return;
    var v = voice(0.6); if (!v) return;
    tone(v, 'sawtooth', 180, 900, v.t, 0.005, 0.18, 0.2);
    burst(v, bufWhite, 'highpass', 3000, 0, 0.7, v.t, 0.002, 0.12, 0.15);
  }
  function chime(f, d, a) {
    if (!canPlay() || !throttle('chime' + f, 40)) return;
    var v = voice(0.5); if (!v) return;
    tone(v, 'sine', f, f * 1.01, v.t, 0.005, a, d);
    tone(v, 'triangle', f * 2, 0, v.t, 0.005, a * 0.3, d * 0.7);
  }
  function hydrant() {
    if (!canPlay() || !throttle('hyd', 300)) return;
    var v = voice(0.5); if (v) burst(v, bufWhite, 'highpass', 2500, 1800, 0.5, v.t, 0.05, 0.2, 0.6);
  }
  function charge(x) {
    if (!canPlay() || !throttle('chg', 60)) return;
    var k = clamp(x == null ? 1 : x, 0, 1), v = voice(0.4); if (!v) return;
    tone(v, 'triangle', 500 + 300 * k, 800 + 500 * k, v.t, 0.003, 0.08, 0.06);
  }

  var api = {
    unlock: unlock,
    isReady: ready,
    explosion: explosion, collapse: collapse, debris: debris,
    laserStart: laserStart, laserStop: laserStop,
    throw: whoosh, grab: grab, carHit: carHit, fire: fire,
    flyStart: flyStart, flyStop: flyStop,
    flyLoop: function (on) { if (on) flyStart(); else flyStop(); },
    setFlySpeed: setFlySpeed,
    land: land, uiClick: uiClick,
    engineStart: engineStart, engineStop: engineStop, setEngine: setEngine,
    skid: skid, skidStart: skidStart, skidStop: skidStop, setSkid: setSkid,
    crash: crash, partFall: partFall, tireBounce: tireBounce, horn: horn,
    bodyThud: bodyThud, limbPop: limbPop, laserSlice: laserSlice,
    ragdollClatter: ragdollClatter, bounce: bounce,
    setVolume: setVolume, getVolume: getVolume,
    setMuted: setMuted, toggleMute: toggleMute, isMuted: isMuted,
    // compat (js/audio.js → sfx.*)
    smash: smash, shatter: shatter, shock: shock,
    crush: land, slam: function () { land(); explosion(0.6); },
    shield: function () { chime(440, 0.25, 0.12); },
    hydrant: hydrant,
    flee: function () { chime(700, 0.06, 0.04); },
    hit: carHit, ui: uiClick,
    explode: function () { explosion(1.2); },
    freeze: function () { chime(1500, 0.18, 0.08); },
    charge: charge,
    setSoundEnabled: function (on) { setMuted(!on); }
  };
  // Envolver todo para que nunca lance excepciones
  var SFX = {};
  for (var key in api) if (Object.prototype.hasOwnProperty.call(api, key)) SFX[key] = safe(api[key]);
  W.SFX = SFX;

  attachUnlock();
})();
