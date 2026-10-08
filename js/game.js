/**
 * Psychic City Smash 3D — bucle principal
 * Lógica 2.5D (px) + render Three.js · destrucción persistente · TK con carga · autos Wreckfest-like
 */

import { World, impactDamage } from './world.js';
import { stepBody, aabbOverlap, dustCloud, sparks } from './physics.js';
import { PowersSystem, POWERS } from './powers.js';
import { spawnCivilians, spawnHostileWave, RivalPsychic } from './npcs.js';
import { spawnCityTraffic, spawnParkedCars, resolveVehicleCollisions } from './vehicles.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';
import { MobileControls, ZOOM_MIN, ZOOM_MAX } from './mobile.js';
import { Renderer3D } from './renderer3d.js';

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
  }
  get cx() { return this.x; }
  get cy() { return this.y; }

  update(dt, mx, my, world) {
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.vx = mx * this.speed;
    this.vy = my * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const box = { x: this.x - 5, y: this.y - 5, w: 10, h: 10, liftZ: 0 };
    if (world.resolveStructures(box)) { this.x = box.x + 5; this.y = box.y + 5; }
    this.x = Math.max(10, Math.min(world.w - 10, this.x));
    this.y = Math.max(10, Math.min(world.h - 10, this.y));
    if (l > 0.05) this.walkPhase += dt * 11 * Math.min(1, l);
    const aimAng = Math.atan2(this.aimY - this.y, this.aimX - this.x);
    const target = l > 0.05 && !this.casting ? Math.atan2(my, mx) : aimAng;
    let d = target - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * 12);
    this.energy = Math.min(this.maxEnergy, this.energy + 14 * dt);
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.hud2d = document.getElementById('hud2d');
    this.hudCtx = this.hud2d.getContext('2d');
    this.ui = new UI();
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
    this.currentTip = '';
    this.camYaw = 0;
    this.camDist = 36;
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

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindInput();
    this._bindButtons();
    this.mobile.init();
    this.ui.updateCharge({ charging: false, charge: 0, force: this.force });

    requestAnimationFrame(t => this._loop(t));
  }

  _webglError(err) {
    const m = document.getElementById('hintMenu');
    if (m) m.textContent = 'WebGL no disponible en este navegador: ' + (err?.message || err);
  }

  _resize() {
    const sz = this.mobile ? this.mobile.getCanvasSize() : { w: window.innerWidth, h: window.innerHeight };
    const iphone = this.mobile?.iphoneMode;
    const dpr = Math.min(window.devicePixelRatio || 1, iphone ? 2 : 1.75);
    this.r3d?.setSize(sz.w, sz.h, dpr);
    this.r3d?.setQuality(iphone ? 'low' : 'high');
    this.hud2d.width = Math.round(sz.w * dpr);
    this.hud2d.height = Math.round(sz.h * dpr);
    this.hud2d.style.width = sz.w + 'px';
    this.hud2d.style.height = sz.h + 'px';
    this.hudDpr = dpr;
    this.viewW = sz.w; this.viewH = sz.h;
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
      if (k === ' ' || k === 'escape') {
        e.preventDefault();
        if (!e.repeat) this.togglePause();
      }
      if (this.paused) return;
      if ((code === 'KeyE' || k === 'e') && !e.repeat) this.toggleEnterCar();
      if ((code === 'KeyQ' || k === 'q') && !e.repeat) this.powers.startCatch();
      if ((code === 'KeyF' || k === 'f') && !e.repeat) this._redirectStart();
      if ((code === 'KeyR' || k === 'r') && !e.repeat) this._reset();
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
      if (e.code === 'KeyF' || k === 'f') this._redirectRelease();
    });
    window.addEventListener('blur', () => { this.keys = {}; this.powers?.stopCatch(); });

    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (!this.running || this.paused) return;
      this._syncMouse(e);
      this.aimMode = 'mouse';
      if (e.button === 0) { this.mouse.down = true; this._onPowerStart(); }
      else if (e.button === 2) this.powers.startCatch();
      else if (e.button === 1) { e.preventDefault(); this.mouse.mid = true; this.mouse.lastX = e.clientX; }
    });
    window.addEventListener('mouseup', e => {
      if (!this.running) return;
      if (e.button === 0 && this.mouse.down) { this.mouse.down = false; this._onPowerRelease(); }
      else if (e.button === 2) this.powers?.stopCatch();
      else if (e.button === 1) this.mouse.mid = false;
    });
    cv.addEventListener('mousemove', e => {
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

  _bindButtons() {
    document.getElementById('btnPlay').onclick = () => { sfx.ui(); this.startSession(this.ui.mode); };
    document.getElementById('btnPause').onclick = () => this.togglePause();
    document.getElementById('btnEnd').onclick = () => this.endSession();
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
  setZoom(d) {
    if (!Number.isFinite(d)) return this.camDist;
    this.camDist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, d));
    return this.camDist;
  }

  zoomBy(delta) { return this.setZoom(this.camDist + delta); }

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
    world.onExplosion = (x, y, r, p, credit) => this._explosionHits(x, y, r, p, credit);
    this.player = new Player(world.spawn.x, world.spawn.y);
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

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.powers.stopCatch();
      this.ui.showOverlay('Pausa', 'El mundo está congelado. La destrucción persiste.', this._statsHtml(), { showResume: true });
    } else {
      this.ui.hideOverlay();
    }
  }

  endSession() {
    if (!this.running) return;
    this.paused = true;
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
    const { car, wreck } = this._findNearCar();
    if (car) {
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
      this.camYaw = 0;
      this.camDist = this.mobile?.iphoneMode ? 44 : 36;
      this.setTip('Cámara restablecida');
    }
  }

  // ——————————————————— poderes ———————————————————
  _powerCtx() {
    return {
      world: this.world, vehicles: this.vehicles, npcs: this.npcs, rival: this.rival,
      aimX: this.aim.x, aimY: this.aim.y, aimZ: this.aim.z,
      player: this.player, drivenCar: this.drivenCar,
      energy: this.player.energy, driving: !!this.drivenCar,
    };
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
  _loop(t) {
    const now = t || performance.now();
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    if (this.running && this.paused) {
      const mob = this.mobile.poll(dt);
      if (mob.pause) this.togglePause();
    } else if (this.running) {
      this.update(dt);
    }
    if (this.running) this.render(dt);
    requestAnimationFrame(tt => this._loop(tt));
  }

  _camBasis() {
    const cam = this.r3d.camera;
    const fx0 = this.r3d.camTarget.x - cam.position.x, fz0 = this.r3d.camTarget.z - cam.position.z;
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

  update(dt) {
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
      car.setDriveInput(-iy, ix, hb);
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
      player.casting = !!(this.powers.grabbed || this.powers.charging || this.powers.catching);
      player.update(dt, mx, my, world);
    }

    this._updateAim(dt, mob);

    // Poderes
    const energyRef = { value: player.energy };
    const res = this.powers.update(dt, this._powerCtx(), energyRef);
    player.energy = energyRef.value;
    if (res) {
      this._applyResult(res);
      this._alertNpcs(this.aim.x, this.aim.y, 220);
    }

    // Vehículos
    const target = this.drivenCar ? { x: this.drivenCar.cx, y: this.drivenCar.cy } : { x: player.x, y: player.y };
    const vctx = { vehicles: this.vehicles, npcs: this.npcs, player, playerDriving: !!this.drivenCar, world, target };
    for (const v of this.vehicles) {
      v.update(dt, world, world.particles, vctx);
      if (v.landed > 150 && v.playerTouch > 0) this.addShake(Math.min(8, v.landed * 0.02));
    }
    resolveVehicleCollisions(this.vehicles, world, (s) => { this.score += s; }, (sh) => this.addShake(sh), this.npcs);
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
    const tgt = this.drivenCar ? { x: this.drivenCar.cx, y: this.drivenCar.cy } : player;
    for (const n of this.npcs) n.update(dt, world, player, n.hostile ? tgt : null);
    for (const n of this.npcs) if (!n.alive) dustCloud(world.particles, n.cx, n.cy, 3, { size: 8 });
    this.npcs = this.npcs.filter(n => n.alive);

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
        ? (iphone ? 'Joystick conducir · 🛑 freno · 🚗 salir · ⟲ enderezar' : 'E salir · Shift freno de mano · R enderezar · clic medio mirar')
        : (iphone ? 'Joystick: mover · mantén presionado en el mapa: agarrar · suelta: lanzar · 2 dedos: zoom/girar'
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
    const camState = this.drivenCar
      ? { mode: 'drive', car: this.drivenCar, lookOffset: this.lookOffset, shake: this.shakeAmt, zoom: this.camDist / (this.mobile?.iphoneMode ? 44 : 36) }
      : { mode: 'foot', x: this.player.x, y: this.player.y, yaw: this.camYaw, pitch: 0.98, dist: this.camDist, shake: this.shakeAmt };
    r3d.updateCamera(camState, dt);
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
      const en = document.querySelector('.hud-energy'), gs = this.hud2d?.getBoundingClientRect?.();
      if (en && gs) { const r = en.getBoundingClientRect(); if (r.height) y = r.bottom - gs.top + 5; }
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
