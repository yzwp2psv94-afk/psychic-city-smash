/**
 * Psychic City Smash 3D — bucle principal
 * Lógica 2.5D (px) + render Three.js · destrucción persistente · TK con carga · autos Wreckfest-like
 */

import { World, impactDamage, CRATER_CAP } from './world.js';
import { loadAssets } from './assets.js';
import { stepBody, aabbOverlap, dustCloud, sparks } from './physics.js';
import { PowersSystem, POWERS } from './powers.js';
import { spawnCivilians, spawnHostileWave, RivalPsychic } from './npcs.js';
import { spawnCityTraffic, spawnParkedCars, resolveVehicleCollisions } from './vehicles.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';

// Sonido: js/sfx.js (script clásico, window.SFX). Redirige las llamadas sfx.* existentes
// sin modificar audio.js; si SFX no cargó, quedan los bips originales.
const SFX = window.SFX || null;
if (SFX) for (const k of Object.keys(sfx)) if (typeof SFX[k] === 'function') sfx[k] = (...a) => SFX[k](...a);
import { MobileControls, ZOOM_MIN, ZOOM_MAX } from './mobile.js';
import { Renderer3D, QUALITY } from './renderer3d.js';
import { setParticleBudget, GRAVITY, addParticle } from './physics.js';
import { FLOOR_H } from './world.js';

const CAM_ORDER = ['fps', 'third', 'far'];
const CAM_PITCH = { fps: 0.08, third: 0.3, far: 0.52 };
const CAM_NAMES = { fps: 'Cámara 1.ª persona', third: 'Cámara 3.ª persona', far: 'Cámara lejana' };

// ——— paso fijo + interpolación (v4.1) ———
const FIXED_DT = 1 / 60;
const MAX_STEPS = 3;
const IP_PLAYER = ['x', 'y', 'z', 'facing'], IP_PLAYER_A = [0, 0, 0, 1];
const IP_VEH = ['x', 'y', 'liftZ', 'angle', 'roll', 'pitch'], IP_VEH_A = [0, 0, 0, 1, 1, 1];
const IP_NPC = ['x', 'y', 'liftZ', 'facing'], IP_NPC_A = [0, 0, 0, 1];
const IP_BODY = ['x', 'y', 'liftZ', 'angle'], IP_BODY_A = [0, 0, 0, 1];
const angDiff = (a, b) => { let d = a - b; if (d > Math.PI || d < -Math.PI) d = Math.atan2(Math.sin(d), Math.cos(d)); return d; };
function ipSave(o, F, id) {
  let p = o._ipP;
  if (!p) p = o._ipP = new Float64Array(6);
  for (let i = 0; i < F.length; i++) { const v = o[F[i]]; p[i] = typeof v === 'number' ? v : NaN; }
  o._ipId = id;
}
function ipApply(o, F, A, id, a) {
  o._ipOn = false;
  if (o._ipId !== id) return;          // objeto creado en este paso: sin estado previo
  const p = o._ipP;
  if (Math.abs(o[F[0]] - p[0]) > 80 || Math.abs(o[F[1]] - p[1]) > 80) return;   // teletransporte
  let r = o._ipR;
  if (!r) r = o._ipR = new Float64Array(6);
  for (let i = 0; i < F.length; i++) {
    const c = o[F[i]];
    r[i] = c;
    if (typeof c !== 'number' || p[i] !== p[i]) continue;
    o[F[i]] = A[i] ? p[i] + angDiff(c, p[i]) * a : p[i] + (c - p[i]) * a;
  }
  o._ipOn = true;
}
function ipRestore(o, F) {
  if (!o._ipOn) return;
  o._ipOn = false;
  const r = o._ipR;
  for (let i = 0; i < F.length; i++) if (typeof r[i] === 'number' && r[i] === r[i]) o[F[i]] = r[i];
}

// ——— ajustes persistentes (v4.1) ———
const SETTINGS_KEY = 'pcs.settings.v1';
function loadSettings() {
  const d = { lookSens: 1, aimAssist: true, analogPedals: true };
  try {
    const j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof j.lookSens === 'number' && j.lookSens >= 0.3 && j.lookSens <= 2.5) d.lookSens = j.lookSens;
    if (typeof j.aimAssist === 'boolean') d.aimAssist = j.aimAssist;
    if (typeof j.analogPedals === 'boolean') d.analogPedals = j.analogPedals;
  } catch (e) { /* modo privado */ }
  return d;
}
function saveSettings(st) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)); } catch (e) { /* sin almacenamiento */ } }

const S = 0.1;   // m/px (como renderer3d)
const ENTER_RADIUS = 42;      // px desde el borde del auto (≈4 m)
const FORCE_PRESETS = [0.1, 0.35, 0.6, 1];

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 10; this.h = 10;
    this.vx = 0; this.vy = 0;
    this.speed = 135;
    this.hp = 100;
    this.maxHp = 100;
    this.energy = 100;
    this.maxEnergy = 100;
    this.alive = true;
    this.aimX = x; this.aimY = y;
    this.facing = -Math.PI / 2;
    this.walkPhase = 0;
    // Altura (px) · vuelo · caída
    this.z = 0; this.vz = 0; this.groundZ = 0;
    this.flying = false; this.fallTop = 0;
    this.maxAlt = 400;
    // objetos reutilizados (sin basura por frame)
    this._box = { x: 0, y: 0, w: 10, h: 10, liftZ: 0 };
    this._fbox = { x: 0, y: 0, w: 6, h: 6 };
    this._gz = 0; this._g = 0;
    this._segCb = sg => { if (sg.height <= this._gz + 6 && sg.height > this._g) this._g = sg.height; };
  }
  get cx() { return this.x; }
  get cy() { return this.y; }

  /** Devuelve { impact, height } al aterrizar tras una caída, si no null */
  update(dt, mx, my, world, up = 0) {
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const spd = this.flying ? this.speed * 1.9 : this.speed;
    // v4.1: aceleración / frenado suaves (aproximación exponencial)
    const rate = l > 0.05 ? (this.flying ? 6 : 13) : (this.flying ? 4 : 10);
    const k = 1 - Math.exp(-dt * rate);
    this.vx += (mx * spd - this.vx) * k;
    this.vy += (my * spd - this.vy) * k;
    if (l <= 0.05 && Math.abs(this.vx) + Math.abs(this.vy) < 2) { this.vx = 0; this.vy = 0; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const box = this._box;
    box.x = this.x - 5; box.y = this.y - 5; box.liftZ = this.z;
    if (world.resolveStructures(box)) {
      const nx = box.x + 5, ny = box.y + 5;
      if (Math.abs(nx - this.x) > 0.01) this.vx *= 0.2;   // no acumular velocidad contra la pared
      if (Math.abs(ny - this.y) > 0.01) this.vy *= 0.2;
      this.x = nx; this.y = ny;
    }
    this.x = Math.max(10, Math.min(world.w - 10, this.x));
    this.y = Math.max(10, Math.min(world.h - 10, this.y));
    const sr = Math.hypot(this.vx, this.vy) / this.speed;
    if (sr > 0.04) this.walkPhase += dt * 11 * Math.min(1.3, sr);
    // Altura: suelo = techo/columna bajo los pies (+ cráter)
    const fb = this._fbox;
    fb.x = this.x - 3; fb.y = this.y - 3;
    this._gz = this.z; this._g = 0;
    world.segmentsTouching(fb, this._segCb);
    let ground = this._g;
    if (ground <= 0 && world.groundAt) ground = world.groundAt(this.x, this.y);
    this.groundZ = ground;
    let landed = null;
    if (this.flying) {
      this.vz = up * 190;
      this.z = Math.max(ground, Math.min(this.maxAlt, this.z + this.vz * dt));
      this.fallTop = this.z;
    } else if (this.z > ground + 0.5 || this.vz > 0) {
      this.vz -= GRAVITY * 1.1 * dt;
      this.z += this.vz * dt;
      this.fallTop = Math.max(this.fallTop, this.z);
      if (this.z <= ground) {
        landed = { impact: -this.vz, height: this.fallTop - ground };
        this.z = ground; this.vz = 0; this.fallTop = ground;
      }
    } else if (ground < 0 && this.z > ground) {
      // borde de cráter: bajar suave siguiendo la pendiente
      this.z = Math.max(ground, this.z - 120 * dt); this.vz = 0; this.fallTop = this.z;
    } else { this.z = ground; this.vz = 0; this.fallTop = ground; }
    const aimAng = Math.atan2(this.aimY - this.y, this.aimX - this.x);
    const moving = l > 0.05 && sr > 0.08;
    const target = moving && !this.casting ? Math.atan2(this.vy, this.vx) : aimAng;
    let d = target - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    // giro suave con velocidad angular máxima (sin chasquidos de 180°)
    let step = d * Math.min(1, dt * 11);
    const maxStep = 9 * dt;
    if (step > maxStep) step = maxStep; else if (step < -maxStep) step = -maxStep;
    this.facing += step;
    this.energy = Math.min(this.maxEnergy, this.energy + (this.flying ? 9 : 14) * dt);
    return landed;
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.hud2d = document.getElementById('hud2d');
    this.hudCtx = this.hud2d.getContext('2d');
    this.ui = new UI();
    this.settings = loadSettings();
    this.mobile = new MobileControls(this);
    this.keys = {};
    this.mouse = { sx: 0, sy: 0, inside: false, down: false, mid: false, lastX: 0 };
    this.aim = { x: 0, y: 0, z: 0 };
    this.aimMode = 'mouse';
    this.aimOffset = { r: 0, f: 140 };
    this.running = false;
    this.paused = false;
    this.shakeAmt = 0;
    this.score = 0;
    this.mode = 'sandbox';
    this.timer = 120;
    this.wave = 0;
    this.waveTimer = 0;
    this.drivenCar = null;
    this.tipTimer = 0;
    this._ipId = 0; this._alpha = 1; this._acc = 0;
    this._ipCam = new Float64Array(3); this._ipCamR = new Float64Array(3);
    this._loopCb = tt => this._loop(tt);
    this.currentTip = '';
    this.camYaw = 0;
    this.camDist = 36;
    // Cámaras: 'fps' (1.ª persona) · 'third' (3.ª persona cerca) · 'far' (persecución lejana y alta)
    this.camMode = 'far';
    this.lookPitch = CAM_PITCH.far; // + = mirar hacia abajo
    this.thirdDist = 7;        // m
    this.farDist = 16;         // m
    this.fpsFov = 70;          // grados
    this.laser = { on: false, hit: null, decalT: 0, lx: 0, ly: 0, heat: new Map() };
    this.lookOffset = 0;
    this.force = 0.6;
    this.sessionTime = 0;
    this.nearCar = null;
    this.vehicles = []; this.npcs = [];

    try {
      this.r3d = new Renderer3D(this.canvas);
    } catch (err) {
      console.error(err);
      this._webglError(err);
      return;
    }

    // Calidad: alta en escritorio, media en táctil; baja sola si los FPS caen (?q=high|medium|low la fija)
    const qp = new URLSearchParams(location.search).get('q');
    this.qualityLocked = !!QUALITY[qp];
    const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0 || !!window.matchMedia?.('(pointer: coarse)').matches;
    this.quality = QUALITY[qp] ? qp : (touch ? 'medium' : 'high');
    this._fps = { t: 0, n: 0, warm: 0 };
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindInput();
    this._bindButtons();
    this.mobile.init();
    this._loadAssets();
    this.ui.updateCharge({ charging: false, charge: 0, force: this.force });

    requestAnimationFrame(t => this._loop(t));
  }

  /** v4.3: assets CC0 en segundo plano con barra de progreso; si algo falla, queda lo procedural */
  _loadAssets() {
    const box = document.getElementById('loadBox'), fill = document.getElementById('loadFill'), txt = document.getElementById('loadText');
    const play = document.getElementById('btnPlay');
    if (new URLSearchParams(location.search).get('assets') === '0') { box?.classList.add('hidden'); return; }
    window.__pcsLoading = true;
    const playLabel = play ? play.textContent : '';
    let finished = false;
    const unlock = (msg) => {
      if (finished) return;
      finished = true;
      window.__pcsLoading = false;
      if (play) { play.disabled = false; play.classList.remove('loading'); play.textContent = playLabel; }
      if (txt && msg) txt.textContent = msg;
      if (box) setTimeout(() => box.classList.add('done'), msg ? 2600 : 400);
    };
    if (play) { play.disabled = true; play.classList.add('loading'); play.textContent = '⏳ CARGANDO…'; }
    // nunca bloquear más de 12 s: se juega con lo que haya y el resto aparece al terminar
    const timer = setTimeout(() => unlock('Cargando en segundo plano… ya puedes jugar'), 12000);
    loadAssets({
      quality: this.quality,
      onProgress: (f) => {
        const pc = Math.round(f * 100);
        if (fill) fill.style.width = pc + '%';
        if (txt && !finished) txt.textContent = `Cargando autos, texturas y cielo… ${pc} %`;
        if (play && !finished) play.textContent = `⏳ CARGANDO… ${pc} %`;
      },
    }).then(a => {
      this.assets = a;
      try { this.r3d.setAssets(a); } catch (e) { console.warn('assets:', e); a.errors.push(String(e)); }
      if (a.errors.length) console.warn('Assets con fallos (se usa respaldo procedural):', a.errors);
      clearTimeout(timer);
      unlock(a.errors.length ? `Listo · ${a.errors.length} archivo(s) no cargaron: se usan gráficos procedurales` : null);
      if (finished && txt && !a.errors.length) txt.textContent = 'Listo';
    }).catch(e => { console.warn('assets:', e); clearTimeout(timer); unlock('Sin assets: se usan gráficos procedurales'); });
  }

  _webglError(err) {
    const m = document.getElementById('hintMenu');
    if (m) m.textContent = 'WebGL no disponible en este navegador: ' + (err?.message || err);
  }

  _resize() {
    const sz = this.mobile ? this.mobile.getCanvasSize() : { w: window.innerWidth, h: window.innerHeight };
    let maxDpr = { high: 1.75, medium: 1.5, low: 1.1 }[this.quality] || 1.5;
    if (this.mobile?.isTouch) maxDpr = Math.min(maxDpr, 1.5);   // v4.1: teléfonos ≤ 1,5× (fluidez > nitidez)
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.r3d?.setSize(sz.w, sz.h, dpr);
    this._applyQuality();
    this.hud2d.width = Math.round(sz.w * dpr);
    this.hud2d.height = Math.round(sz.h * dpr);
    this.hud2d.style.width = sz.w + 'px';
    this.hud2d.style.height = sz.h + 'px';
    this.hudDpr = dpr;
    this.viewW = sz.w; this.viewH = sz.h;
  }

  _applyQuality() {
    const Q = this.r3d?.setQuality(this.quality) || QUALITY[this.quality];
    if (!Q) return;
    setParticleBudget(Q.particles);
    if (this.world) { this.world.fxScale = Q.fxScale; this.world.debrisCap = Q.debrisCap; this.world.craterCap = CRATER_CAP[this.quality] || CRATER_CAP.medium; }
    document.body.dataset.quality = this.quality;
  }

  /** Auto-detección de FPS bajos: baja la calidad un nivel (sombras, partículas, resolución) */
  _watchFps(dt) {
    if (this.qualityLocked || this.paused) return;
    const f = this._fps;
    f.warm += dt;
    if (f.warm < 2) return;           // ignora el arranque
    f.t += dt; f.n++;
    if (f.t < 2.5) return;
    const fps = f.n / f.t;
    f.t = 0; f.n = 0;
    this.fps = fps;
    if (fps < 28 && this.quality !== 'low') {
      this.quality = this.quality === 'high' ? 'medium' : 'low';
      f.warm = 0;
      this._resize();
    }
  }

  // ——————————————————— entrada ———————————————————
  _bindInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      const code = e.code;
      if (e.target?.tagName === 'INPUT' && e.target.type === 'range' && k.startsWith('arrow')) return;
      this.keys[k] = true;
      if (code) this.keys[code] = true;
      if (!this.running) return;
      if (k >= '1' && k <= '5' && !e.repeat) this.selectPower(+k - 1);
      if (k === ' ') e.preventDefault();
      if ((k === ' ' && !this.player?.flying) || k === 'escape' || k === 'p') {
        e.preventDefault();
        if (!e.repeat) this.togglePause();
      }
      if (code === 'KeyV' && !e.repeat && !this.paused) this.cycleCamera();
      if (this.paused) return;
      if ((code === 'KeyE' || k === 'e') && !e.repeat) this.toggleEnterCar();
      if ((code === 'KeyQ' || k === 'q') && !e.repeat) this.powers.startCatch();
      if ((code === 'KeyG' || k === 'g') && !e.repeat) this._redirectStart();
      if ((code === 'KeyF' || k === 'f') && !e.repeat) this.toggleFly();
      if ((code === 'KeyR' || k === 'r') && !e.repeat) this._reset();
      if ((code === 'KeyH' || k === 'h') && !e.repeat) this._hornKey = true;
      if (k === ']' || k === '+' || k === '=') this.setForce(this.force + 0.05);
      if (k === '[' || k === '-') this.setForce(this.force - 0.05);
      if (code === 'KeyZ') this.camYaw += 0.25;
      if (code === 'KeyX') this.camYaw -= 0.25;
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (e.code) this.keys[e.code] = false;
      if (e.key === 'Shift') this.keys['shift'] = false;
      if (!this.running) return;
      if (e.code === 'KeyQ' || k === 'q') this.powers?.stopCatch();
      if (e.code === 'KeyG' || k === 'g') this._redirectRelease();
    });
    window.addEventListener('blur', () => { this.keys = {}; this.powers?.stopCatch(); });

    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (!this.running || this.paused) return;
      this._syncMouse(e);
      this.aimMode = 'mouse';
      if (document.pointerLockElement !== cv && cv.requestPointerLock) {
        try { const pr = cv.requestPointerLock(); pr?.catch?.(() => {}); } catch (err) { /* sin pointer lock */ }
      }
      if (e.button === 0) { this.mouse.down = true; this._onPowerStart(); }
      else if (e.button === 2) this._mouseLaser = true;
      else if (e.button === 1) { e.preventDefault(); this.mouse.mid = true; this.mouse.lastX = e.clientX; }
    });
    window.addEventListener('mouseup', e => {
      if (!this.running) return;
      if (e.button === 0 && this.mouse.down) { this.mouse.down = false; this._onPowerRelease(); }
      else if (e.button === 2) this._mouseLaser = false;
      else if (e.button === 1) this.mouse.mid = false;
    });
    cv.addEventListener('mousemove', e => {
      if (document.pointerLockElement === cv) {
        this._mouseLook = (this._mouseLook || 0) + 1;
        this._lookAccX = (this._lookAccX || 0) + e.movementX;
        this._lookAccY = (this._lookAccY || 0) + e.movementY;
        return;
      }
      this._syncMouse(e);
      this.aimMode = 'mouse';
      if (this.mouse.mid) {
        const dx = e.clientX - this.mouse.lastX;
        this.mouse.lastX = e.clientX;
        if (this.drivenCar) this.lookOffset -= dx * 0.008; else this.camYaw -= dx * 0.008;
      }
    });
    cv.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    cv.addEventListener('wheel', e => {
      if (!this.running) return;
      e.preventDefault();
      if (e.ctrlKey || e.altKey) {
        this.zoomBy(Math.sign(e.deltaY) * 3);
      } else {
        this.setForce(this.force + (e.deltaY < 0 ? 0.05 : -0.05));
      }
    }, { passive: false });

    // Táctil (1 dedo = mouse, 2 dedos = zoom/giro): ver MobileControls._bindCanvasTouch

    const fs = document.getElementById('forceSlider');
    if (fs) {
      fs.addEventListener('input', () => this.setForce(+fs.value / 100));
      fs.addEventListener('mousedown', e => e.stopPropagation());
    }
  }

  _syncMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.sx = (e.clientX - rect.left) / rect.width;
    this.mouse.sy = (e.clientY - rect.top) / rect.height;
    this.mouse.inside = true;
  }

  /** Apuntar a un punto de pantalla (toque corto en zona de mirada) */
  aimFromScreen(clientX, clientY) {
    if (!this.running) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const p = this.r3d.pick(nx, ny, this.world);
    const a = this._anchor();
    const { fx, fy } = this._camBasis();
    const dx = p.x - a.x, dy = p.y - a.y;
    this.aimOffset.f = dx * fx + dy * fy;
    this.aimOffset.r = dx * -fy + dy * fx;
    this.aimMode = 'offset';
  }

  _bindSettings() {
    const st = this.settings;
    const sens = document.getElementById('optLookSens'), sv = document.getElementById('sensVal');
    const aa = document.getElementById('optAimAssist'), ap = document.getElementById('optAnalogPedals');
    if (sens) {
      sens.value = String(st.lookSens);
      const lab = () => { if (sv) sv.textContent = st.lookSens.toFixed(1) + '×'; };
      lab();
      sens.addEventListener('input', () => { st.lookSens = Math.max(0.3, Math.min(2.5, parseFloat(sens.value) || 1)); lab(); saveSettings(st); });
    }
    if (aa) { aa.checked = st.aimAssist; aa.addEventListener('change', () => { st.aimAssist = aa.checked; saveSettings(st); }); }
    if (ap) { ap.checked = st.analogPedals; ap.addEventListener('change', () => { st.analogPedals = ap.checked; saveSettings(st); }); }
  }

  _bindButtons() {
    this._bindSettings();
    document.getElementById('btnPlay').onclick = () => { sfx.ui(); this.startSession(this.ui.mode); };
    document.getElementById('btnPause').onclick = () => this.togglePause();
    document.getElementById('btnEnd').onclick = () => this.endSession();
    const endOv = document.getElementById('btnEndOv');
    if (endOv) endOv.onclick = () => { this.paused = false; this.endSession(); };
    // 🔊 silencio desde la pausa
    const muteOv = document.getElementById('btnMuteOv');
    const muteLabel = () => { if (muteOv) muteOv.textContent = SFX?.isMuted() ? '🔇 Sonido: no' : '🔊 Sonido: sí'; };
    this._muteLabel = muteLabel;
    if (SFX) { const opt = document.getElementById('optSound'); if (opt) opt.checked = !SFX.isMuted(); if (this.ui) this.ui.sound = !SFX.isMuted(); }
    if (muteOv) {
      if (!SFX) muteOv.style.display = 'none';
      muteLabel();
      muteOv.onclick = () => {
        const m = SFX.toggleMute();
        this.ui.sound = !m;
        const opt = document.getElementById('optSound'); if (opt) opt.checked = !m;
        muteLabel();
      };
    }
    document.getElementById('btnResume').onclick = () => { this.paused = false; this.ui.hideOverlay(); };
    document.getElementById('btnRestart').onclick = () => this.startSession(this.mode);
    document.getElementById('btnMenu').onclick = () => {
      this.running = false;
      this.paused = false;
      this.ui.showMenu();
    };
    this.ui.onSelectPower = (i) => { this.selectPower(i); sfx.ui(); };
  }

  selectPower(i) {
    if (!this.powers) return;
    this.powers.select(i);
    this._mobileFireHeld = false;
    this.mouse.down = false;
    this.ui.updateHud({ score: this.score, destroy: this.world?.destructionPercent() || 0, energy: this.player?.energy || 0, maxEnergy: 100, power: i });
  }

  setForce(v) {
    this.force = Math.max(0.05, Math.min(1, Math.round(v * 100) / 100));
    if (this.powers) this.powers.setForce(this.force);
    return this.force;
  }

  /** Zoom de cámara: distancia limitada a [ZOOM_MIN, ZOOM_MAX] */
  /** Zoom según la cámara: órbita = distancia · 3.ª persona = distancia corta · 1.ª persona = FOV */
  getZoom() { return this.camMode === 'fps' ? this.fpsFov : this.camMode === 'third' ? this.thirdDist : this.farDist; }

  setZoom(d) {
    if (!Number.isFinite(d)) return this.getZoom();
    if (this.camMode === 'fps') this.fpsFov = Math.max(35, Math.min(90, d));
    else if (this.camMode === 'third') this.thirdDist = Math.max(3, Math.min(12, d));
    else this.farDist = Math.max(8, Math.min(40, d));
    return this.getZoom();
  }

  zoomBy(delta) { return this.setZoom(this.getZoom() + delta * (this.camMode === 'third' ? 0.35 : this.camMode === 'far' ? 0.6 : 1)); }

  cycleCamera() {
    this.camMode = CAM_ORDER[(CAM_ORDER.indexOf(this.camMode) + 1) % CAM_ORDER.length];
    this.lookPitch = CAM_PITCH[this.camMode];
    this._syncCamClasses();
    this.setTip(`🎥 ${CAM_NAMES[this.camMode]}`);
    sfx.ui();
  }

  _syncCamClasses() {
    const b = document.body.classList;
    b.toggle('cam-fps', this.camMode === 'fps');
    b.toggle('cam-third', this.camMode !== 'fps');   // mira central visible
    b.toggle('cam-far', this.camMode === 'far');
  }

  toggleFly() {
    if (!this.running || this.paused || this.drivenCar) return;
    const p = this.player;
    p.flying = !p.flying;
    if (p.flying) { p.vz = 0; this.setTip('🚀 Volando · ▲/▼ altura (Espacio / C)'); if (!SFX) sfx.shock?.(); }
    else this.setTip('Aterrizando…');
    document.body.classList.toggle('flying', p.flying);
  }

  /** Aterrizaje desde altura: onda de choque proporcional a la caída */
  _landingShock(h) {
    const p = this.player;
    const pw = Math.min(1.6, (h - 25) / 180);
    if (pw <= 0) return;
    const w = this.world, r = 40 + 90 * pw;
    w.addCrater?.(p.x, p.y, 0.3 + pw * 1.6);   // v4.2: aterrizaje fuerte = cráter
    this.score += w.applyRadialDamage(p.x, p.y, r, 8 + 40 * pw, 160 + 320 * pw, true);
    for (const v of this.vehicles) {
      if (!v.alive || v === this.drivenCar) continue;
      const d = Math.hypot(v.cx - p.x, v.cy - p.y);
      if (d > r || d < 1) continue;
      const f = (1 - d / r) * 240 * pw, a = Math.atan2(v.cy - p.y, v.cx - p.x);
      v.launch(v.vx + Math.cos(a) * f, v.vy + Math.sin(a) * f, f * 0.5, true);
      this.score += v.applyDamage(20 * pw * (1 - d / r), w, p.x, p.y, true);
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.cx - p.x, n.cy - p.y);
      if (d < r && n.alive) { const a = Math.atan2(n.cy - p.y, n.cx - p.x); this.score += n.hitByBody({ speed: 160, mass: 1 + pw, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 }, true); }
    }
    w.addFx({ type: 'ring', x: p.x, y: p.y, r: 6, maxR: r, life: 0.5, color: '#b39dff' });
    w.addFx({ type: 'shockwave', x: p.x, y: p.y, z: p.z, r: 4, maxR: r * 0.8, life: 0.5, color: '#b39dff' });
    dustCloud(w.particles, p.x, p.y, Math.round(6 + 10 * pw), { z: p.z + 2, spread: r * 0.4, speed: 80 + 120 * pw, size: 16 });
    if (p.z < 2) w.addRoadCrack(p.x, p.y, 0.5 + pw * 0.8, pw > 0.7 ? 'crater' : 'crack');
    this.addShake(4 + 8 * pw);
    if (SFX) { SFX.land(); if (pw > 0.5) SFX.explosion(0.3 + pw); } else sfx.smash();
    this.setTip(`¡Aterrizaje! ${Math.round(pw * 100)}%`);
  }

  /** Láser de los ojos: daño continuo en la mira */
  _updateLaser(dt, hold) {
    const L = this.laser, p = this.player, w = this.world;
    const cost = 7 * dt;
    L.on = !!hold && p.energy > cost;
    if (!L.on) { L.hit = null; return; }
    p.energy -= cost;
    const a = this.aim;
    L.hit = { x: a.x, y: a.y, z: a.z };
    const dps = 45;
    // Edificios: corta columnas (puede romper pisos y provocar colapso)
    let hitSeg = false;
    L.segT = (L.segT || 0) + dt;
    if (L.segT >= 0.1) {
      const step = L.segT; L.segT = 0;
      w.segmentsInRadius(a.x, a.y, 11, s => {
        if (s.height >= a.z - 4) { this.score += w.damageSegment(s, dps * step, true); hitSeg = true; }
      });
    }
    // Autos: se calientan → arden → explotan
    for (const v of this.vehicles) {
      if (!v.alive || v === this.drivenCar) continue;
      if (Math.hypot(v.cx - a.x, v.cy - a.y) > Math.max(v.w, v.h) * 0.6 + 6) continue;
      const prev = L.heat.get(v) || 0, heat = prev + dt;
      L.heat.set(v, heat);
      if (Math.floor(heat / 0.35) !== Math.floor(prev / 0.35)) this.score += v.applyDamage(5, w, a.x, a.y, true);
      if (heat > 0.7) v.onFire = Math.max(v.onFire || 0, 8);
      if (heat > 2.2 && !v._laserBoom) {
        v._laserBoom = true;
        v.parts.engine.hp = 0;               // motor fundido → chatarra
        this.score += v.applyDamage(120, w, a.x, a.y, true);
        v.onFire = Math.max(v.onFire || 0, 14);
        w.explosion(v.cx, v.cy, 6, 0.9, true);
      }
    }
    for (const pr of w.props) if (!pr.destroyed && Math.hypot(pr.cx - a.x, pr.cy - a.y) < 12) this.score += w.damageProp(pr, 30 * dt, p.x, p.y);
    for (const n of this.npcs) {
      if (n.alive && Math.hypot(n.cx - a.x, n.cy - a.y) < 10 && Math.random() < dt * 3) {
        const ang = Math.atan2(n.cy - p.y, n.cx - p.x);
        this.score += n.hitByBody({ speed: 120, mass: 1, vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120 }, true);
      }
    }
    if (this.rival?.alive && Math.hypot(this.rival.cx - a.x, this.rival.cy - a.y) < 14) this.rival.takeDamage(20 * dt);
    // Chispas, humo, marcas de quemado
    sparks(w.particles, a.x, a.y, a.z + 1, hitSeg ? 3 : 2, 160, Math.random() > 0.5 ? '#ffd36b' : '#ff7a2a');
    if (Math.random() < 0.25) addParticle(w.particles, a.x, a.y, { z: a.z + 2, vx: 0, vy: 0, vz: 30, size: 6, grow: 10, life: 1.2, color: '#2a2622', type: 'smoke', alpha: 0.5 });
    L.decalT -= dt;
    if (a.z < 2 && L.decalT <= 0 && Math.hypot(a.x - L.lx, a.y - L.ly) > 5) {
      w.addRoadCrack(a.x, a.y, 0.55 + Math.random() * 0.3, 'scorch');
      L.decalT = 0.08; L.lx = a.x; L.ly = a.y;
    }
    this.addShake(1.4);
  }

  cycleForcePreset() {
    const i = FORCE_PRESETS.findIndex(p => p > this.force + 0.01);
    this.setForce(FORCE_PRESETS[i < 0 ? 0 : i]);
    this.setTip(`Fuerza ${Math.round(this.force * 100)}%`);
  }

  // ——————————————————— sesión ———————————————————
  startSession(mode) {
    this.mode = mode || 'sandbox';
    this.ui.mode = this.mode;
    this.score = 0;
    this.timer = 120;
    this.wave = 0;
    this.waveTimer = 3;
    this.paused = false;
    this.running = true;
    this.shakeAmt = 0;
    this.drivenCar = null;
    this.nearCar = null;
    this.sessionTime = 0;
    this._mobileFireHeld = false;
    this._redirectHeld = false;
    this._catchHeldBy = null;
    this.mouse.down = false;
    this.lookOffset = 0;

    const world = new World();
    this.world = world;
    this._applyQuality();
    world.onExplosion = (x, y, r, p, credit) => this._explosionHits(x, y, r, p, credit);
    this.player = new Player(world.spawn.x, world.spawn.y);
    this.player.maxAlt = 1.5 * Math.max(...world.buildings.map(b => b.floors)) * FLOOR_H;
    document.body.classList.remove('flying');
    this.laser.heat = new Map();
    this._syncCamClasses();
    this.aim = { x: world.spawn.x, y: world.spawn.y - 120, z: 0 };
    this.aimOffset = { r: 0, f: 140 };
    this.powers = new PowersSystem();
    this.powers.setForce(this.force);
    this.vehicles = [...spawnCityTraffic(world, 16), ...spawnParkedCars(world)];
    this.npcs = spawnCivilians(world, 34);
    this.rival = null;
    if (this.mode === 'duel') {
      this.rival = new RivalPsychic(world.spawn.x - 200, world.spawn.y - 200);
      world.resolveStructures(this.rival);
    }

    this.ui.showGame();
    this._resize();
    this.r3d.buildWorld(world);
    this.camDist = this.mobile?.iphoneMode ? 44 : 36;
    this.setTip(POWERS[0].tip);
    this.ui.updateHud({ score: 0, destroy: 0, energy: 100, maxEnergy: 100, tip: POWERS[0].tip, timer: this.timer, power: 0 });
  }

  setTip(t) {
    this.currentTip = t;
    this.tipTimer = 3;
    this.ui.updateHud({ score: this.score, destroy: this.world?.destructionPercent() || 0, energy: this.player?.energy || 0, maxEnergy: 100, tip: t });
  }

  /** Sonidos en loop (láser, vuelo, motor, derrape) según el estado de este frame */
  _syncLoops(dt) {
    if (!SFX) return;
    const L = this._snd || (this._snd = { laser: false, fly: false, engine: false, skid: false });
    const p = this.player, car = this.drivenCar;
    if (this.laser.on !== L.laser) { L.laser = this.laser.on; L.laser ? SFX.laserStart() : SFX.laserStop(); }
    const fly = !!p?.flying;
    if (fly !== L.fly) { L.fly = fly; fly ? SFX.flyStart() : SFX.flyStop(); }
    if (fly) SFX.setFlySpeed(Math.min(1, (Math.hypot(p.vx, p.vy) + Math.abs(p.vz) * 0.8) / 260));
    const eng = !!car && car.alive && !car.isWreck;
    if (eng !== L.engine) { L.engine = eng; eng ? SFX.engineStart() : SFX.engineStop(); }
    let skid = 0;
    if (eng) {
      // rpm con cambios simulados (5 marchas): sube, cae al pasar de marcha
      const max = car.maxSpeed || 300;
      const sp = Math.min(1, Math.abs(car.forwardSpeed) / max);
      const G = [0, 0.15, 0.33, 0.53, 0.75, 1.01];
      let gi = 0; while (gi < 4 && sp > G[gi + 1]) gi++;
      const thrA = Math.min(1, Math.abs(car.inputThrottle || 0));
      let rpm = sp < 0.03 ? 0.12 + thrA * 0.3 : 0.24 + 0.7 * (sp - G[gi]) / (G[gi + 1] - G[gi]);
      if ((car.slip || 0) > 0.4 && thrA > 0.5) rpm = Math.min(1, rpm + 0.18);
      SFX.setEngine(Math.min(1, rpm), thrA);
      skid = car.slip != null ? (car.speed > 30 ? car.slip : 0)
        : Math.min(1, Math.max(0, (Math.abs(-car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle)) - 40) / 160));
    }
    const sk = skid > 0.08;
    if (sk !== L.skid) { L.skid = sk; sk ? SFX.skidStart() : SFX.skidStop(); }
    if (sk) SFX.setSkid(skid);
  }

  _stopLoops() {
    if (!SFX) return;
    SFX.laserStop(); SFX.flyStop(); SFX.engineStop(); SFX.skidStop();
    this._snd = null;
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.paused) {
      this._stopLoops();
      this._muteLabel?.();
      this.powers.stopCatch();
      this.ui.showOverlay('Pausa', 'El mundo está congelado. La destrucción persiste.', this._statsHtml(), { showResume: true });
    } else {
      this.ui.hideOverlay();
    }
  }

  endSession() {
    if (!this.running) return;
    this.paused = true;
    this._stopLoops();
    this.ui.showOverlay('Fin de sesión', 'Nueva sesión = mapa reparado. Dentro de la sesión nada se repara solo.', this._statsHtml(), { showResume: false });
  }

  _statsHtml() {
    const d = this.world?.destructionPercent() || 0;
    let extra = '';
    if (this.mode === 'duel' && this.rival) extra = `<div>Rival: ${this.rival.alive ? Math.ceil(this.rival.hp) + ' HP' : 'Derrotado ✓'}</div>`;
    if (this.mode === 'survival') extra = `<div>Oleada: ${this.wave}</div>`;
    const wrecks = this.vehicles.filter(v => v.isWreck || v.static && v.wrecked).length;
    return `
      <div>Puntuación: <b>${Math.floor(this.score)}</b></div>
      <div>Destrucción: <b>${d}%</b></div>
      <div>Chatarra / wrecks: <b>${wrecks}</b></div>
      ${extra}
    `;
  }

  // ——————————————————— autos ———————————————————
  _carEdgeDistance(v, x, y) {
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const dx = x - v.cx, dy = y - v.cy;
    const lx = Math.abs(dx * c + dy * s) - v.w / 2;
    const ly = Math.abs(-dx * s + dy * c) - v.h / 2;
    return Math.hypot(Math.max(0, lx), Math.max(0, ly));
  }

  _findNearCar() {
    let best = null, bestD = ENTER_RADIUS;
    let wreck = null;
    for (const v of this.vehicles) {
      if (!v.alive || v.grabbed) continue;
      const d = this._carEdgeDistance(v, this.player.x, this.player.y);
      if (d > ENTER_RADIUS) continue;
      if (!v.drivable && !(v.flipped && !v.isWreck)) { if (!wreck || d < wreck.d) wreck = { v, d }; continue; }
      if (d < bestD) { best = v; bestD = d; }
    }
    return { car: best, wreck: wreck?.v || null };
  }

  toggleEnterCar() {
    if (!this.running || this.paused) return;
    if (this.drivenCar) {
      const car = this.drivenCar;
      const c = Math.cos(car.angle), s = Math.sin(car.angle);
      const spots = [
        [-s * (car.h / 2 + 12), c * (car.h / 2 + 12)], [s * (car.h / 2 + 12), -c * (car.h / 2 + 12)],
        [-c * (car.w / 2 + 12), -s * (car.w / 2 + 12)], [c * (car.w / 2 + 12), s * (car.w / 2 + 12)],
      ];
      let placed = false;
      for (const [ox, oy] of spots) {
        const box = { x: car.cx + ox - 5, y: car.cy + oy - 5, w: 10, h: 10, liftZ: 0 };
        const hit = this.world.resolveStructures({ ...box });
        if (!hit) { this.player.x = car.cx + ox; this.player.y = car.cy + oy; placed = true; break; }
      }
      if (!placed) { this.player.x = car.cx - s * 20; this.player.y = car.cy + c * 20; }
      car.driven = false;
      car.aiDrive = false;
      car.setDriveInput(0, 0, true);
      this.drivenCar = null;
      this.powers.releaseGrab();
      this.lookOffset = 0;
      this.camYaw = -car.angle - Math.PI / 2;
      this.setTip('Fuera del vehículo · poderes al máximo');
      sfx.ui();
      return;
    }
    if (this.player.z > this.player.groundZ + 12) { this.setTip('Baja a la calle para entrar a un auto'); return; }
    const { car, wreck } = this._findNearCar();
    if (car) {
      this.player.flying = false; this.player.z = 0; this.player.vz = 0; this.player.fallTop = 0;
      document.body.classList.remove('flying');
      if (car.flipped) { car.flipped = false; car.roll = 0; }
      this.drivenCar = car;
      car.driven = true;
      car.aiDrive = false;
      car.parked = false;
      car.lane = null;
      car.static = false;
      car.spawnGrace = 0;
      this.powers.releaseGrab();
      this.powers.cancelCharge();
      this.lookOffset = 0;
      this.setTip('Conduciendo · WASD · Shift freno de mano · R enderezar · E salir · poderes +60%');
      sfx.ui();
    } else if (wreck) {
      this.setTip('Ese auto está destrozado · lánzalo con TK (1)');
    } else {
      this.setTip('Acércate a un auto (≈4 m) y pulsa E');
    }
  }

  _reset() {
    if (this.drivenCar) {
      const v = this.drivenCar;
      v.flipped = false; v.roll = 0; v.pitch = 0; v.rollRate = 0; v.pitchRate = 0;
      v.vx = v.vy = 0; v.yawRate = 0; v.liftZ = Math.max(v.liftZ, 4); v.vz = 60;
      this.setTip('Auto restablecido');
    } else {
      this.lookPitch = CAM_PITCH[this.camMode]; this.thirdDist = 7; this.farDist = 16; this.fpsFov = 70;
      this.setTip('Cámara restablecida');
    }
  }

  // ——————————————————— poderes ———————————————————
  _powerCtx() {
    const c = this._pctx || (this._pctx = {});
    c.world = this.world; c.vehicles = this.vehicles; c.npcs = this.npcs; c.rival = this.rival;
    c.aimX = this.aim.x; c.aimY = this.aim.y; c.aimZ = this.aim.z;
    c.player = this.player; c.drivenCar = this.drivenCar; c.camMode = this.camMode;
    c.energy = this.player.energy; c.driving = !!this.drivenCar;
    return c;
  }

  _applyResult(res) {
    if (!res) return;
    if (res.energy) this.player.energy = Math.max(0, this.player.energy - res.energy);
    if (res.score) this.score += res.score;
    if (res.tip) this.setTip(res.tip);
    if (res.shake) this.addShake(res.shake);
  }

  _onPowerStart() {
    const res = this.powers.tryStart(this._powerCtx());
    this._applyResult(res);
    this._alertNpcs(this.aim.x, this.aim.y, 160);
  }

  _onPowerRelease() {
    const res = this.powers.onRelease(this._powerCtx());
    this._applyResult(res);
    if (res) this._alertNpcs(this.aim.x, this.aim.y, 220);
  }

  _redirectStart() {
    if (this.powers.grabbed || (this.powers.charging && this.powers.chargeKind !== 'redirect')) return;
    this._redirectHeld = true;
    this._applyResult(this.powers.startRedirect());
  }

  _redirectRelease() {
    if (!this._redirectHeld) return;
    this._redirectHeld = false;
    this._applyResult(this.powers.releaseRedirect(this._powerCtx()));
  }

  addShake(amt) {
    if (this.ui.shake) this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  _alertNpcs(x, y, r) {
    for (const n of this.npcs) n.alert(x, y, r);
  }

  _explosionHits(x, y, r, p, credit) {
    let score = 0;
    for (const v of this.vehicles) {
      if (!v.alive || v === this.drivenCar && this.powers.shieldTimer > 0) continue;
      const d = Math.hypot(v.cx - x, v.cy - y);
      if (d > r || d < 1) continue;
      const fall = 1 - d / r;
      const ang = Math.atan2(v.cy - y, v.cx - x);
      const f = fall * 260 * p;
      if (v !== this.drivenCar) v.launch(v.vx + Math.cos(ang) * f, v.vy + Math.sin(ang) * f, f * 0.5, credit);
      score += v.applyDamage(30 * p * fall, this.world, x, y, credit);
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.cx - x, n.cy - y);
      if (d < r && n.alive) {
        const ang = Math.atan2(n.cy - y, n.cx - x);
        score += n.hitByBody({ speed: 200, mass: 2 * p, vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180 }, credit);
      }
    }
    if ((this.mode === 'survival' || this.mode === 'duel') && this.powers.shieldTimer <= 0) {
      const d = Math.hypot(this.player.x - x, this.player.y - y);
      if (d < r) this.player.hp -= 18 * p * (1 - d / r);
    }
    this._alertNpcs(x, y, r * 3);
    this.addShake(4 + 6 * p);
    return credit ? score : 0;
  }

  // ——————————————————— bucle ———————————————————
  // v4.1: física a paso fijo (1/60 s) + interpolación al dibujar → movimiento fluido a cualquier fps
  _loop(t) {
    const now = t || performance.now();
    const raw = (now - (this._last || now)) / 1000;
    const dt = Math.min(0.1, Math.max(0, raw));
    this._last = now;
    if (this.running && raw < 1) this._watchFps(raw);
    if (this.running && this.paused) {
      const mob = this.mobile.poll(dt);
      if (mob.pause) this.togglePause();
      this._acc = 0; this._alpha = 1;
    } else if (this.running) {
      this._acc = (this._acc || 0) + dt;
      let n = 0;
      this._inLoop = true;
      while (this._acc >= FIXED_DT && n < MAX_STEPS) {
        this._ipSnap();
        this.update(FIXED_DT);
        this._acc -= FIXED_DT; n++;
        if (!this.running || this.paused) { this._acc = 0; break; }
      }
      this._inLoop = false;
      if (this._acc > FIXED_DT) this._acc = FIXED_DT * 0.999;   // descartar atraso (sin espiral)
      this._alpha = n > 0 || this._ipId ? this._acc / FIXED_DT : 1;
    }
    if (this.running) {
      const ip = this._alpha < 0.995 && this._ipId > 0;
      if (ip) this._ipApply(this._alpha);
      this.render(dt);
      if (ip) this._ipRestore();
    }
    requestAnimationFrame(this._loopCb);
  }

  _ipSnap() {
    const id = ++this._ipId;
    ipSave(this.player, IP_PLAYER, id);
    const v = this.vehicles; for (let i = 0; i < v.length; i++) ipSave(v[i], IP_VEH, id);
    const n = this.npcs; for (let i = 0; i < n.length; i++) ipSave(n[i], IP_NPC, id);
    if (this.rival) ipSave(this.rival, IP_NPC, id);
    const d = this.world.debris; for (let i = 0; i < d.length; i++) ipSave(d[i], IP_BODY, id);
    const c = this._ipCam; c[0] = this.camYaw; c[1] = this.lookPitch; c[2] = this.lookOffset;
  }

  _ipApply(a) {
    const id = this._ipId;
    ipApply(this.player, IP_PLAYER, IP_PLAYER_A, id, a);
    const v = this.vehicles; for (let i = 0; i < v.length; i++) ipApply(v[i], IP_VEH, IP_VEH_A, id, a);
    const n = this.npcs; for (let i = 0; i < n.length; i++) ipApply(n[i], IP_NPC, IP_NPC_A, id, a);
    if (this.rival) ipApply(this.rival, IP_NPC, IP_NPC_A, id, a);
    const d = this.world.debris; for (let i = 0; i < d.length; i++) ipApply(d[i], IP_BODY, IP_BODY_A, id, a);
    const c = this._ipCam, r = this._ipCamR;
    r[0] = this.camYaw; r[1] = this.lookPitch; r[2] = this.lookOffset;
    this.camYaw = c[0] + angDiff(this.camYaw, c[0]) * a;
    this.lookPitch = c[1] + (this.lookPitch - c[1]) * a;
    this.lookOffset = c[2] + (this.lookOffset - c[2]) * a;
  }

  _ipRestore() {
    ipRestore(this.player, IP_PLAYER);
    const v = this.vehicles; for (let i = 0; i < v.length; i++) ipRestore(v[i], IP_VEH);
    const n = this.npcs; for (let i = 0; i < n.length; i++) ipRestore(n[i], IP_NPC);
    if (this.rival) ipRestore(this.rival, IP_NPC);
    const d = this.world.debris; for (let i = 0; i < d.length; i++) ipRestore(d[i], IP_BODY);
    const r = this._ipCamR;
    this.camYaw = r[0]; this.lookPitch = r[1]; this.lookOffset = r[2];
  }

  _camBasis() {
    const cam = this.r3d.camera;
    const ct = this.r3d._outTgt || this.r3d.camTarget;
    const fx0 = ct.x - cam.position.x, fz0 = ct.z - cam.position.z;
    const l = Math.hypot(fx0, fz0) || 1;
    return { fx: fx0 / l, fy: fz0 / l };
  }

  _anchor() {
    return this.drivenCar ? { x: this.drivenCar.cx, y: this.drivenCar.cy } : { x: this.player.x, y: this.player.y };
  }

  _heightAt(x, y) {
    let h = 0;
    this.world.segmentsTouching({ x: x - 0.5, y: y - 0.5, w: 1, h: 1 }, s => { h = Math.max(h, s.height); });
    return h;
  }

  _updateAim(dt, mob) {
    {
      // Mirar: arrastre táctil, arrastre sobre ⚡, stick derecho, mouse con pointer lock, L2/R2
      const lx = (mob.lookDX || 0) + (mob.aimDragX || 0) + (this._lookAccX || 0) * 0.55 + (mob.aimStickX || 0) * 420 * dt;
      const ly = (mob.lookDY || 0) + (mob.aimDragY || 0) + (this._lookAccY || 0) * 0.55 + (mob.aimStickY || 0) * 300 * dt;
      this._lookAccX = 0; this._lookAccY = 0;
      // v4.1: sensibilidad ajustable + suavizado de la mirada (objetivo → valor real).
      // Si otro código cambia yaw/pitch/offset (entrar al auto, cambiar cámara…), el objetivo se resincroniza.
      const sens = this.settings.lookSens;
      if (this.camYaw !== this._yawSet) this._yawT = this.camYaw;
      if (this.lookPitch !== this._pitchSet) this._pitchT = this.lookPitch;
      if (this.lookOffset !== this._offSet) this._offT = this.lookOffset;
      if (this.drivenCar) this._offT += lx * 0.0055 * sens;
      else this._yawT -= lx * 0.0055 * sens;
      if (mob.rotate) { if (this.drivenCar) this._offT -= mob.rotate * 1.8 * dt; else this._yawT += mob.rotate * 1.8 * dt; }
      this._pitchT = Math.max(-1.2, Math.min(1.35, this._pitchT + ly * 0.0045 * sens));
      if (this.settings.aimAssist && this.mobile.iphoneMode && !this.drivenCar) this._aimAssist(dt, lx, ly, mob);
      const kL = 1 - Math.exp(-dt * (this.mobile.iphoneMode ? 24 : 40));
      this.camYaw += (this._yawT - this.camYaw) * kL;
      this.lookPitch += (this._pitchT - this.lookPitch) * kL;
      this.lookOffset += (this._offT - this.lookOffset) * kL;
      if (Math.abs(this._yawT - this.camYaw) < 1e-4) this.camYaw = this._yawT;
      if (Math.abs(this._pitchT - this.lookPitch) < 1e-4) this.lookPitch = this._pitchT;
      if (Math.abs(this._offT - this.lookOffset) < 1e-4) this.lookOffset = this._offT;
      this._yawSet = this.camYaw; this._pitchSet = this.lookPitch; this._offSet = this.lookOffset;
      // La mira = centro de la pantalla (rayo desde la cámara)
      const p = this.r3d.pick(0, 0, this.world, this.vehicles, this.drivenCar);
      this.aim.x = Math.max(-100, Math.min(this.world.w + 100, p.x));
      this.aim.y = Math.max(-100, Math.min(this.world.h + 100, p.y));
      this.aim.z = p.z;
      this.aimMode = 'center';
      this.player.aimX = this.aim.x; this.player.aimY = this.aim.y;
      return;
    }
    // Stick derecho / arrastre táctil → modo offset
    if (mob.aimStickX || mob.aimStickY) {
      this.aimMode = 'offset';
      this.aimOffset.r += mob.aimStickX * 320 * dt;
      this.aimOffset.f -= mob.aimStickY * 320 * dt;
    }
    // Arrastre con el dedo sobre ⚡: mueve la mira (derecha/izquierda, más lejos/cerca)
    if (mob.aimDragX || mob.aimDragY) {
      if (this.aimMode === 'mouse') {
        const a = this._anchor();
        const { fx, fy } = this._camBasis();
        const dx = this.aim.x - a.x, dy = this.aim.y - a.y;
        this.aimOffset.f = dx * fx + dy * fy;
        this.aimOffset.r = dx * -fy + dy * fx;
      }
      this.aimMode = 'offset';
      this.aimOffset.r += mob.aimDragX * 1.6;
      this.aimOffset.f = Math.max(20, this.aimOffset.f - mob.aimDragY * 1.6);
    }
    if (mob.rotate) {
      if (this.drivenCar) this.lookOffset += mob.rotate * 1.8 * dt;
      else this.camYaw += mob.rotate * 1.8 * dt;
    }
    if (mob.lookDX || mob.lookDY) {
      if (this.drivenCar) this.lookOffset += mob.lookDX * 0.008;
      else this.camYaw -= mob.lookDX * 0.008;
      this.aimOffset.f = Math.max(30, Math.min(420, this.aimOffset.f - mob.lookDY * 1.4));
      this.aimMode = 'offset';
    }
    if (this.mobile.iphoneMode && this.aimMode === 'mouse' && !this.mouse.inside) this.aimMode = 'offset';
    const od = Math.hypot(this.aimOffset.r, this.aimOffset.f);
    if (od > 450) { this.aimOffset.r *= 450 / od; this.aimOffset.f *= 450 / od; }

    if (this.aimMode === 'mouse' && this.mouse.inside) {
      const p = this.r3d.pick(this.mouse.sx * 2 - 1, -(this.mouse.sy * 2 - 1), this.world);
      this.aim.x = p.x; this.aim.y = p.y; this.aim.z = p.z;
    } else {
      const a = this._anchor();
      const { fx, fy } = this._camBasis();
      const f = this.drivenCar ? Math.max(this.aimOffset.f, 160) : this.aimOffset.f;
      this.aim.x = a.x + fx * f - fy * this.aimOffset.r;
      this.aim.y = a.y + fy * f + fx * this.aimOffset.r;
      this.aim.z = this._heightAt(this.aim.x, this.aim.y);
    }
    this.aim.x = Math.max(-100, Math.min(this.world.w + 100, this.aim.x));
    this.aim.y = Math.max(-100, Math.min(this.world.h + 100, this.aim.y));
    this.player.aimX = this.aim.x; this.player.aimY = this.aim.y;
  }

  /** v4.1: asistencia de puntería suave (solo táctil): atrae la mira hacia autos/escombros cercanos al centro */
  _aimAssist(dt, lx, ly, mob) {
    const p = this.player;
    const active = Math.abs(lx) + Math.abs(ly) > 0.3 || Math.abs(p.vx) + Math.abs(p.vy) > 20 || mob.fireHold || mob.catchHold;
    if (!active || this.camMode === 'top') return;
    const cam = this.r3d.camera.position;
    const yaw = this._yawT, pitch = this._pitchT;
    const CONE = 0.11;
    let bestA = CONE, bdy = 0, bdp = 0;
    const test = (wx, wy, wz) => {
      const vx = wx * S - cam.x, vy = wz * S - cam.y, vz = wy * S - cam.z;
      const hd = Math.hypot(vx, vz);
      if (hd < 2 || hd > 70) return;
      const ty = Math.atan2(-vx, -vz), tp = Math.atan2(-vy, hd);
      const dy = angDiff(ty, yaw), dp = tp - pitch;
      const a = Math.hypot(dy, dp);
      if (a < bestA) { bestA = a; bdy = dy; bdp = dp; }
    };
    const v = this.vehicles;
    for (let i = 0; i < v.length; i++) { const c = v[i]; if (c !== this.drivenCar && c.alive) test(c.cx, c.cy, (c.liftZ || 0) + 8); }
    const d = this.world.debris;
    for (let i = 0; i < d.length; i++) { const b = d[i]; if (b.alive !== false && (b.mass || 1) > 0.6) test(b.x + (b.w || 0) / 2, b.y + (b.h || 0) / 2, (b.liftZ || 0) + 4); }
    if (bestA >= CONE || bestA < 0.004) return;
    const w = (1 - bestA / CONE) * Math.min(1, dt * 3.2);   // ligera: nunca “engancha”
    this._yawT += bdy * w;
    this._pitchT += bdp * w * 0.6;
  }

  update(dt) {
    if (!this._inLoop) this._alpha = 1;
    const world = this.world;
    const player = this.player;
    this.sessionTime += dt;

    if (this.mode === 'timed') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.paused = true;
        this.ui.showOverlay('¡Tiempo!', 'Sesión terminada — maximizaste el caos.', this._statsHtml(), { showResume: false });
        return;
      }
    }

    if (this.mode === 'survival') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wave++;
        const wave = spawnHostileWave(world, this.wave, player);
        this.npcs.push(...wave.npcs);
        this.vehicles.push(...wave.cars);
        this.waveTimer = 18;
        this.setTip(`Oleada ${this.wave}`);
      }
      const tgt = this.drivenCar ? { x: this.drivenCar.cx, y: this.drivenCar.cy } : player;
      for (const n of this.npcs) {
        if (!n.alive || !n.hostile || n.knocked > 0) continue;
        if (Math.hypot(n.cx - tgt.x, n.cy - tgt.y) < 14 && this.powers.shieldTimer <= 0) player.hp -= 15 * dt;
      }
    }
    if ((this.mode === 'survival' || this.mode === 'duel') && player.hp <= 0) {
      this.paused = true;
      this.ui.showOverlay('Derrota', this.mode === 'duel' ? 'El rival psíquico te venció.' : 'Los hostiles te superaron.', this._statsHtml(), { showResume: false });
      return;
    }

    // Entrada móvil / gamepad
    const mob = this.mobile.poll(dt);
    const driving = !!this.drivenCar;
    if (mob.enter) this.toggleEnterCar();
    if (mob.pause) { this.togglePause(); return; }
    if (mob.reset) this._reset();
    if (mob.camCycle) this.cycleCamera();
    if (mob.flyToggle) this.toggleFly();
    this.powers.chargeRate = mob.rt > 0.05 ? 0.3 + 0.7 * Math.min(1, mob.rt) : 1;

    if ((mob.fireStart || mob.fireHold) && !this._mobileFireHeld) {
      this._mobileFireHeld = true;
      this._onPowerStart();
    }
    if (this._mobileFireHeld && !mob.fireHold && !mob.fireStart) {
      this._onPowerRelease();
      this._mobileFireHeld = false;
    }
    if (mob.restorePower != null) this._pendingRestore = mob.restorePower;
    if (this._pendingRestore != null && !this._mobileFireHeld && !this.powers.slamPhase && !this.powers.charging) {
      const rp = this._pendingRestore; this._pendingRestore = null;
      this.selectPower(rp);
    }
    // Atrapar (táctil / LT a pie) y redirigir (táctil / B a pie)
    const catchHold = mob.catchHold || (!driving && mob.gpLT > 0.4);
    if (catchHold && this._catchHeldBy !== 'pad') { this._catchHeldBy = 'pad'; this.powers.startCatch(); }
    if (!catchHold && this._catchHeldBy === 'pad') { this._catchHeldBy = null; this.powers.stopCatch(); }
    const redirectHold = mob.redirectHold || (!driving && mob.gpB);
    if (redirectHold && !this._padRedirect) { this._padRedirect = true; this._redirectStart(); }
    if (!redirectHold && this._padRedirect) { this._padRedirect = false; this._redirectRelease(); }

    const k = this.keys;
    const kx = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0);
    const ky = (k['s'] || k['arrowdown'] ? 1 : 0) - (k['w'] || k['arrowup'] ? 1 : 0);
    const ix = Math.max(-1, Math.min(1, kx + mob.moveX));
    const iy = Math.max(-1, Math.min(1, ky + mob.moveY));

    if (this.drivenCar) {
      const car = this.drivenCar;
      const hb = !!k['shift'] || mob.handbrake || mob.gpB || mob.gpLT > 0.4;
      // v4: joystick/teclas + pedales táctiles (acelerar / freno-reversa)
      const thr = Math.max(-1, Math.min(1, -iy + (mob.gas || 0) - (mob.rev || 0)));
      // v4.1: dirección táctil suavizada según la velocidad (rápida en parado, tranquila a 100+ km/h)
      let steer = ix;
      if (this.mobile.iphoneMode && Math.abs(mob.moveX) > 0.001 || this._steerS) {
        const sp = Math.min(1, (car.speed || 0) / 520);
        const rate = 14 - 8 * sp;
        const target = this.mobile.iphoneMode ? ix * (1 - 0.28 * sp) : ix;
        this._steerS = (this._steerS || 0) + (target - (this._steerS || 0)) * (1 - Math.exp(-dt * rate));
        if (Math.abs(this._steerS) < 0.002 && !target) this._steerS = 0;
        if (this.mobile.iphoneMode) steer = this._steerS;
      }
      car.setDriveInput(thr, steer, hb);
      if ((mob.horn || this._hornKey) && SFX) SFX.horn(0.45);
      this._hornKey = false;
      player.x = car.cx; player.y = car.cy;
      player.energy = Math.min(player.maxEnergy, player.energy + 8 * dt);
      if (!car.alive || car.isWreck) {
        this.setTip('¡Tu auto quedó destrozado! Sal con E');
      }
      if (Math.abs(this.lookOffset) > 0.001 && !this.mouse.mid && !mob.lookDX) this.lookOffset *= Math.pow(0.1, dt);
    } else {
      const { fx, fy } = this._camBasis();
      const mx = -fy * ix + fx * -iy;
      const my = fx * ix + fy * -iy;
      player.casting = !!(this.powers.grabbed || this.powers.charging || this.powers.catching || this.laser.on);
      const up = ((k[' '] || mob.flyUp) ? 1 : 0) - ((k['c'] || k['shift'] || mob.flyDown) ? 1 : 0);
      const landed = player.update(dt, mx, my, world, up);
      if (landed && landed.height > 25) this._landingShock(landed.height);
      if (player.flying || player.z > player.groundZ + 2) {
        // estela de energía
        if (Math.random() < 0.7) addParticle(world.particles, player.x + (Math.random() - 0.5) * 4, player.y + (Math.random() - 0.5) * 4, {
          z: player.z + 4 + Math.random() * 6, vx: -player.vx * 0.15, vy: -player.vy * 0.15, vz: -10,
          size: 3 + Math.random() * 3, life: 0.6, color: Math.random() > 0.5 ? '#b39dff' : '#74b9ff', type: 'psy',
        });
      }
    }

    this._updateAim(dt, mob);
    this._updateLaser(dt, mob.laser || this.keys['l'] || this._mouseLaser);
    if (this._lzClass !== this.laser.on) { this._lzClass = this.laser.on; document.body.classList.toggle('lasering', this.laser.on); }
    this._syncLoops(dt);

    // Poderes
    const energyRef = this._energyRef || (this._energyRef = { value: 0 });
    energyRef.value = player.energy;
    const res = this.powers.update(dt, this._powerCtx(), energyRef);
    player.energy = energyRef.value;
    if (res) {
      this._applyResult(res);
      this._alertNpcs(this.aim.x, this.aim.y, 220);
    }

    // Vehículos
    // contexto reutilizado (sin basura por frame)
    const vctx = this._vctx || (this._vctx = { vehicles: null, npcs: null, player: null, playerDriving: false, world: null, target: { x: 0, y: 0 } });
    const target = vctx.target;
    if (this.drivenCar) { target.x = this.drivenCar.cx; target.y = this.drivenCar.cy; } else { target.x = player.x; target.y = player.y; }
    vctx.vehicles = this.vehicles; vctx.npcs = this.npcs; vctx.player = player; vctx.playerDriving = !!this.drivenCar; vctx.world = world;
    for (let vi = 0; vi < this.vehicles.length; vi++) {
      const v = this.vehicles[vi];
      v.update(dt, world, world.particles, vctx);
      if (v.landed > 150 && v.playerTouch > 0) this.addShake(Math.min(8, v.landed * 0.02));
    }
    if (!this._onCollScore) { this._onCollScore = (sc) => { this.score += sc; }; this._onCollShake = (sh) => this.addShake(sh); }
    resolveVehicleCollisions(this.vehicles, world, this._onCollScore, this._onCollShake, this.npcs);
    if (this.drivenCar && this.drivenCar.speed > 160 && Math.random() < 0.1) this._alertNpcs(this.drivenCar.cx, this.drivenCar.cy, 80);

    // Autos voladores vs rival / jugador
    for (const v of this.vehicles) {
      if (!v.alive || v.grabbed || v.frozen || v.liftZ > 22 || v.speed < 60) continue;
      if (this.rival?.alive && v.playerTouch > 0 && aabbOverlap(v.aabb(), this.rival.aabb())) {
        this.rival.takeDamage(impactDamage(v.mass, v.speed) * 0.3);
        this.score += 20;
        v.vx *= 0.5; v.vy *= 0.5;
      }
      if (!this.drivenCar && v.hostileTouch > 0 && Math.hypot(v.cx - player.x, v.cy - player.y) < 24 && this.powers.shieldTimer <= 0) {
        player.hp -= impactDamage(v.mass, v.speed) * 0.15;
        v.hostileTouch = 0;
        this.addShake(8);
      }
    }

    // Escombros
    for (const d of world.debris) {
      if (!d.alive || d.grabbed || d.lifted || d.frozen) continue;
      stepBody(d, dt, world.bounds);
      const credit = d.playerTouch > 0;
      if (d.landed > 140) {
        dustCloud(world.particles, d.cx, d.cy, 2, { size: 8 + d.mass * 3, speed: 30 });
        if (d.landed > 260 && d.mass > 1.5) world.addRoadCrack(d.cx, d.cy, 0.35 + d.mass * 0.1);
      }
      if (d.speed > 40) {
        const sc = world.debrisHitsStructures(d);
        if (sc) {
          if (credit) this.score += sc;
          this._alertNpcs(d.cx, d.cy, 140);
        }
      }
      if (d.vehHitCd > 0) d.vehHitCd -= dt;
      else if (d.speed > 50 && d.liftZ < 18) {
        for (const v of this.vehicles) {
          if (!v.alive || v.grabbed || v.frozen) continue;
          if (d.data?.srcCar === v.id && d.age < 0.8) continue; // pieza recién desprendida de este auto
          if (Math.abs(d.cx - v.cx) > 34 || Math.abs(d.cy - v.cy) > 34) continue;
          if (!aabbOverlap(d.aabb(), v.aabb())) continue;
          const rvx = d.vx - v.vx, rvy = d.vy - v.vy;
          const rel = Math.hypot(rvx, rvy);
          if (rel < 50) continue;
          const dmg = impactDamage(d.mass, rel);
          const s = v.applyDamage(dmg, world, d.cx, d.cy, credit);
          if (credit) this.score += s;
          // transferencia de momento (masa × velocidad)
          const k2 = d.mass / (v.mass + d.mass);
          if (v.static && rel * d.mass > 900) v.static = false;
          v.vx += rvx * k2 * 1.2; v.vy += rvy * k2 * 1.2;
          d.vx = -d.vx * 0.25 + v.vx * 0.5; d.vy = -d.vy * 0.25 + v.vy * 0.5;
          d.vehHitCd = 0.2;
          sparks(world.particles, d.cx, d.cy, d.liftZ + 8, 5, 160);
          if (credit) this.addShake(Math.min(8, rel * d.mass * 0.004));
          break;
        }
      }
      if (d.speed > 35 && d.liftZ < 18) {
        for (const n of this.npcs) {
          if (!n.alive || Math.abs(n.cx - d.cx) > 20 || Math.abs(n.cy - d.cy) > 20) continue;
          if (aabbOverlap(d.aabb(), n.aabb())) { this.score += n.hitByBody(d, credit); break; }
        }
      }
      if (this.rival?.alive && d.speed > 40 && d.playerTouch > 0 && d.liftZ < 22 && aabbOverlap(d.aabb(), this.rival.aabb())) {
        this.rival.takeDamage(impactDamage(d.mass, d.speed) * 0.5);
        d.vx *= -0.4; d.vy *= -0.4;
        this.score += 10;
      }
      if (!this.drivenCar && d.hostileTouch > 0 && d.speed > 60 && d.liftZ < 20 &&
          Math.hypot(d.cx - player.x, d.cy - player.y) < 12 + d.w / 2 && this.powers.shieldTimer <= 0) {
        player.hp -= impactDamage(d.mass, d.speed) * 0.4;
        d.hostileTouch = 0; d.vx *= -0.3; d.vy *= -0.3;
        this.addShake(6);
      }
    }

    // Escombro vs escombro (barato, ventana limitada)
    const debris = world.debris;
    for (let i = 0; i < debris.length; i++) {
      const a = debris[i];
      if (!a.alive || a.grabbed || a.frozen) continue;
      for (let j = i + 1; j < Math.min(debris.length, i + 8); j++) {
        const b = debris[j];
        if (!b.alive || b.grabbed || b.frozen) continue;
        if (Math.abs(a.liftZ - b.liftZ) > 12) continue;
        if (aabbOverlap(a, b)) {
          const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx);
          a.vx -= Math.cos(ang) * 20; a.vy -= Math.sin(ang) * 20;
          b.vx += Math.cos(ang) * 20; b.vy += Math.sin(ang) * 20;
        }
      }
    }

    // NPCs
    const tgt = this.drivenCar ? target : player;
    const npcs = this.npcs;
    for (let ni = 0; ni < npcs.length; ni++) { const n = npcs[ni]; n.update(dt, world, player, n.hostile ? tgt : null); }
    // compactar en el sitio (sin crear un array nuevo cada frame)
    let nw = 0;
    for (let ni = 0; ni < npcs.length; ni++) {
      const n = npcs[ni];
      if (n.alive) npcs[nw++] = n;
      else dustCloud(world.particles, n.cx, n.cy, 3, { size: 8 });
    }
    npcs.length = nw;

    // Rival
    if (this.rival?.alive) {
      this.rival.update(dt, world, this.vehicles, tgt);
      if (this.rival.state === 'shock' && this.powers.shieldTimer <= 0) {
        const d = Math.hypot(this.rival.cx - player.x, this.rival.cy - player.y);
        if (d < 100) player.hp -= 20 * dt;
      }
      if (!this.rival.alive) {
        this.score += 500;
        this.setTip('¡Rival psíquico derrotado!');
        this.paused = true;
        this.ui.showOverlay('Victoria', 'Derrotaste al rival psíquico.', this._statsHtml(), { showResume: false });
      }
    }

    world.update(dt);
    if (world.shake > 0) { this.addShake(Math.min(14, world.shake)); world.shake = 0; }
    if (world.pendingScore > 0) { this.score += world.pendingScore; world.pendingScore = 0; }

    if (this.shakeAmt > 0) {
      this.shakeAmt *= Math.pow(0.9, dt * 60);
      if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    }
    if (this.tipTimer > 0) this.tipTimer -= dt;

    // Prompt de entrar
    this.nearCar = null;
    if (!this.drivenCar) {
      const { car, wreck } = this._findNearCar();
      this.nearCar = car;
      this._nearWreck = wreck;
    }

    const iphone = this.mobile?.iphoneMode;
    const pad = this.mobile?.bluetoothEnabled && this.mobile?.gamepadConnected;
    this.ui.updateHud({
      score: this.score,
      destroy: world.destructionPercent(),
      energy: player.energy,
      maxEnergy: player.maxEnergy,
      tip: this.tipTimer > 0 ? this.currentTip : (this.drivenCar
        ? (iphone ? '' : 'E salir · Shift freno de mano · R enderezar · clic medio mirar')
        : (iphone ? ''
          : POWERS[this.powers.selected].tip)),
      timer: this.mode === 'timed' ? this.timer : null,
      power: this.powers.selected,
    });
    const pw = this.powers;
    this.ui.updateCharge({
      charging: pw.charging, charge: pw.charge, force: pw.force, kind: pw.chargeKind,
      frozen: pw.frozen.length,
      kmh: pw.charging && (pw.chargeKind === 'tk' || pw.chargeKind === 'redirect') ? Math.round(pw.throwSpeed() * 0.36) : 0,
    });
    if (pw.charging && pw.charge >= 1 && !this._fullSfx) { this._fullSfx = true; sfx.charge(); }
    if (!pw.charging) this._fullSfx = false;
    document.body.classList.toggle('driving', !!this.drivenCar);
    document.body.classList.toggle('near-car', !!this.nearCar);
    this._promptLabel = this.nearCar ? (iphone ? '🚗 Entrar' : pad ? 'A · Entrar' : 'E · Entrar') : null;
    void pad;
  }

  render(dt) {
    const r3d = this.r3d;
    // estado de cámara reutilizado (sin basura por frame)
    const cs = this._camState || (this._camState = { mode: 'foot', view: 'far', car: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, yaw: 0, pitch: 0.98, lookPitch: 0, lookOffset: 0, dist: 36, tDist: 7, fpsFov: 70, shake: 0, zoom: 1 });
    const pl = this.player;
    cs.view = this.camMode; cs.lookPitch = this.lookPitch; cs.fpsFov = this.fpsFov; cs.shake = this.shakeAmt;
    if (this.drivenCar) {
      cs.mode = 'drive'; cs.car = this.drivenCar; cs.lookOffset = this.lookOffset;
      cs.zoom = this.camMode === 'third' ? 0.7 * this.thirdDist / 7 : 1.1 * this.farDist / 16;
    } else {
      cs.mode = 'foot'; cs.car = null; cs.x = pl.x; cs.y = pl.y; cs.z = pl.z; cs.vx = pl.vx; cs.vy = pl.vy;
      cs.yaw = this.camYaw; cs.dist = this.camDist; cs.tDist = this.camMode === 'far' ? this.farDist : this.thirdDist;
    }
    r3d.updateCamera(cs, dt);
    // mira suavizada (la retícula no salta entre bordes/suelo)
    const av = this.aimView || (this.aimView = { x: this.aim.x, y: this.aim.y, z: this.aim.z });
    const jump = Math.abs(this.aim.x - av.x) + Math.abs(this.aim.y - av.y) + Math.abs(this.aim.z - av.z);
    if (jump > 220 || this.aimMode !== 'center') { av.x = this.aim.x; av.y = this.aim.y; av.z = this.aim.z; }
    else { const ka = 1 - Math.exp(-dt * 22); av.x += (this.aim.x - av.x) * ka; av.y += (this.aim.y - av.y) * ka; av.z += (this.aim.z - av.z) * ka; }
    r3d.sync(this, dt);
    r3d.render();

    // Prompt "E · Entrar" anclado sobre el auto
    if (this._promptLabel && this.nearCar && !this.paused) {
      const p = r3d.worldToScreen(this.nearCar.cx, this.nearCar.cy, 26);
      if (p.visible) this.ui.showPrompt(this._promptLabel, p.x, p.y);
      else this.ui.showPrompt(null);
    } else this.ui.showPrompt(null);

    // HUD 2D (velocímetro / daño / HP)
    const ctx = this.hudCtx;
    const W = this.viewW, H = this.viewH;
    ctx.setTransform(this.hudDpr, 0, 0, this.hudDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.drivenCar) this.drivenCar.drawDamageHUD(ctx, W, H, { compact: !!this.mobile?.iphoneMode });
    if (this.mode === 'survival' || this.mode === 'duel') {
      const bw = 140;
      let y = this.mobile?.iphoneMode ? 118 : 70;
      if (!this._hpBarY || (this._hpBarT = (this._hpBarT || 0) + 1) % 60 === 0) {   // medir el layout solo de vez en cuando
        const en = document.querySelector('.hud-energy'), gs = this.hud2d?.getBoundingClientRect?.();
        this._hpBarY = y;
        if (en && gs) { const r = en.getBoundingClientRect(); if (r.height) this._hpBarY = r.bottom - gs.top + 5; }
      }
      y = this._hpBarY;
      ctx.fillStyle = '#0b1220cc'; ctx.fillRect(W / 2 - bw / 2, y, bw, 12);
      ctx.fillStyle = '#e17055'; ctx.fillRect(W / 2 - bw / 2, y, bw * Math.max(0, this.player.hp / this.player.maxHp), 12);
      ctx.strokeStyle = '#fff4'; ctx.strokeRect(W / 2 - bw / 2, y, bw, 12);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('VIDA', W / 2, y + 9.5);
      if (this.rival?.alive) {
        const p = r3d.worldToScreen(this.rival.cx, this.rival.cy, 26);
        if (p.visible) {
          ctx.fillStyle = '#0008'; ctx.fillRect(p.x - 20, p.y - 6, 40, 5);
          ctx.fillStyle = '#e84393'; ctx.fillRect(p.x - 20, p.y - 6, 40 * (this.rival.hp / this.rival.maxHp), 5);
        }
      }
    }
  }
}

const game = new Game();
window.__pcs = game;   // depuración / pruebas automatizadas
