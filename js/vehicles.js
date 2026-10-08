/**
 * Vehículos estilo Wreckfest: daño multi-parte + abolladuras (dents) +
 * manejo arcade-sim + IA de tráfico por carriles (sin choques ambientales).
 */

import { Body, burst, sparks, smokePuff, fireBurst, dustCloud, aabbOverlap, GRAVITY } from './physics.js';
import { ROAD_W } from './world.js';
import { sfx } from './audio.js';

const CAR_COLORS = ['#c0392b', '#2e6fb7', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#ecf0f1', '#34495e', '#f1c40f', '#7f8c8d', '#d35400'];
const PART_KEYS_DETACH = ['hood', 'bumper', 'doorL', 'doorR', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

let _vid = 1;

export class Vehicle {
  constructor(x, y, opts = {}) {
    this.id = _vid++;
    this.w = opts.w || 44;
    this.h = opts.h || 22;
    this.th = 14;
    // x,y = esquina sup-izq del rectángulo sin rotar (cx,cy = centro)
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.angle = opts.angle || 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.liftZ = 0;
    this.yawRate = 0;
    this.color = opts.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    this.stripes = opts.stripes ?? Math.random() < 0.3;
    this.style = opts.style || (Math.random() < 0.5 ? 'muscle' : Math.random() < 0.5 ? 'sedan' : 'hatch');
    this.alive = true;
    this.static = false;
    this.grabbed = false;
    this.lifted = false;
    this.frozen = false;
    this.frozenTimer = 0;
    this.kind = 'vehicle';
    this.mass = opts.mass || 10;
    this.bounce = 0.35;
    this.damageOnHit = 28;
    this.spin = 0;
    this.driven = false;
    this.aiDrive = opts.aiDrive || false;
    this.hostile = !!opts.hostile;
    this.parked = !!opts.parked;
    this.lane = opts.lane || null;
    this.playerTouch = 0;
    this.hostileTouch = 0;
    this.spawnGrace = 1.5;
    this.stopTimer = 0;
    this.ignoreObstacles = 0;
    this.roll = 0; this.pitch = 0; this.rollRate = 0; this.pitchRate = 0;
    this.flipped = false;
    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.onFire = 0;
    this.dents = [];
    this.dentVersion = 0;
    this.lastImpact = 0;
    this.wrecked = false;

    this.inputThrottle = 0;
    this.inputSteer = 0;
    this.inputHandbrake = false;

    this.parts = {
      body: { hp: 100, max: 100 },
      hood: { hp: 40, max: 40, attached: true },
      bumper: { hp: 35, max: 35, attached: true },
      doorL: { hp: 30, max: 30, attached: true },
      doorR: { hp: 30, max: 30, attached: true },
      wheelFL: { hp: 25, max: 25, attached: true },
      wheelFR: { hp: 25, max: 25, attached: true },
      wheelRL: { hp: 25, max: 25, attached: true },
      wheelRR: { hp: 25, max: 25, attached: true },
      engine: { hp: 60, max: 60 },
    };

    this.smokeTimer = 0;
    this.sparkTimer = 0;
    this.detachedOnce = new Set();
    this.driftFactor = 0;
    this.data = {};
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  set cx(v) { this.x = v - this.w / 2; }
  set cy(v) { this.y = v - this.h / 2; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get forwardSpeed() {
    return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
  }
  get totalHp() {
    return Object.values(this.parts).reduce((s, p) => s + Math.max(0, p.hp), 0);
  }
  get maxTotalHp() {
    return Object.values(this.parts).reduce((s, p) => s + p.max, 0);
  }
  get damageRatio() { return 1 - this.totalHp / this.maxTotalHp; }
  get wreckTier() {
    const r = this.damageRatio;
    if (r < 0.2) return 0;
    if (r < 0.45) return 1;
    if (r < 0.75) return 2;
    return 3;
  }
  get isWreck() {
    return this.parts.engine.hp <= 0 || this.totalHp < this.maxTotalHp * 0.12;
  }
  get drivable() {
    return this.alive && !this.isWreck && !this.static && !this.flipped && !this.grabbed && !this.frozen && this.liftZ < 2;
  }
  /** AABB del auto rotado */
  aabb() {
    const c = Math.abs(Math.cos(this.angle)), s = Math.abs(Math.sin(this.angle));
    const w = c * this.w + s * this.h, h = s * this.w + c * this.h;
    return { x: this.cx - w / 2, y: this.cy - h / 2, w, h };
  }
  /** Dos círculos (frente / atrás) para colisión auto-auto */
  circles() {
    const r = this.h / 2, off = this.w / 2 - r;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [
      { x: this.cx + c * off, y: this.cy + s * off, r },
      { x: this.cx - c * off, y: this.cy - s * off, r },
      { x: this.cx, y: this.cy, r },
    ];
  }

  get grip() {
    const wheels = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
    const ok = wheels.filter(k => this.parts[k].attached && this.parts[k].hp > 5).length;
    let g = 0.25 + 0.75 * (ok / 4);
    g *= 1 - this.damageRatio * 0.25;
    if (this.inputHandbrake) g *= 0.35;
    return Math.max(0.12, g);
  }
  get maxSpeed() {
    const base = this.driven ? 340 : this.hostile ? 190 : 95;
    const eng = Math.max(0.15, this.parts.engine.hp / this.parts.engine.max);
    return base * eng * (0.5 + 0.5 * this.grip);
  }
  get accel() {
    const eng = Math.max(0.2, this.parts.engine.hp / this.parts.engine.max);
    return (this.driven ? 230 : this.hostile ? 160 : 90) * eng;
  }
  get brakeForce() { return this.driven ? 520 : 300; }
  get turnAuthority() {
    return (this.driven ? 2.7 : 2.0) * this.grip * (1 - this.damageRatio * 0.35);
  }

  setDriveInput(throttle, steer, handbrake = false) {
    this.inputThrottle = Math.max(-1, Math.min(1, throttle));
    this.inputSteer = Math.max(-1, Math.min(1, steer));
    this.inputHandbrake = !!handbrake;
  }

  /** Física arcade-sim: aceleración/freno/reversa, agarre lateral, freno de mano. */
  integrateDriving(dt) {
    if (this.isWreck || this.grabbed || this.lifted || this.frozen) {
      this.vx *= Math.pow(0.92, dt * 60);
      this.vy *= Math.pow(0.92, dt * 60);
      return;
    }
    const cs = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    let fwd = this.vx * cs + this.vy * sn;
    const lat = -this.vx * sn + this.vy * cs;
    const thr = this.inputThrottle;
    const max = this.maxSpeed;

    if (thr > 0.05) {
      if (fwd < -10) fwd += this.brakeForce * thr * dt;
      else {
        const k = Math.max(0, 1 - Math.pow(Math.max(0, fwd) / max, 2));
        fwd += this.accel * thr * k * dt;
      }
    } else if (thr < -0.05) {
      if (fwd > 10) fwd -= this.brakeForce * (-thr) * dt;
      else if (fwd > -max * 0.35) fwd += this.accel * 0.6 * thr * dt;
    } else {
      fwd *= Math.pow(this.inputHandbrake ? 0.97 : 0.988, dt * 60);
    }
    if (this.inputHandbrake) fwd *= Math.pow(0.985, dt * 60);

    const spd = Math.max(Math.abs(fwd), this.speed);
    const speedNorm = Math.min(1, spd / Math.max(60, max));
    if (spd > 6 || this.inputHandbrake) {
      const turnScale = Math.min(1, spd / 60) * (1 - 0.45 * speedNorm);
      this.angle += this.inputSteer * this.turnAuthority * turnScale * dt * (fwd >= 0 ? 1 : -1);
    }
    if (this.inputHandbrake && spd > 40) {
      this.yawRate += this.inputSteer * 3.5 * dt;
      this.driftFactor = Math.min(1, this.driftFactor + dt * 3);
    } else {
      this.driftFactor = Math.max(0, this.driftFactor - dt * 2);
      this.yawRate *= Math.pow(0.88, dt * 60);
    }
    this.angle += this.yawRate * dt;

    const grip = this.grip * (1 - this.driftFactor * 0.5);
    const latDamp = Math.pow(1 - grip * 0.85, dt * 60);
    const newLat = lat * latDamp;
    const ncs = Math.cos(this.angle);
    const nsn = Math.sin(this.angle);
    this.vx = ncs * fwd - nsn * newLat;
    this.vy = nsn * fwd + ncs * newLat;
    const lim = max * 1.15;
    if (this.speed > lim && this.liftZ <= 0) {
      const s = lim / this.speed;
      this.vx *= s; this.vy *= s;
    }
  }

  /**
   * Impacto. towardAngle = dirección (mundo) desde el centro del auto hacia el punto de impacto.
   * Devuelve daño aplicado (puntuable si hay crédito).
   */
  applyImpact(relSpeed, world, towardAngle = 0, opts = {}) {
    if (this.spawnGrace > 0 && !opts.force) return 0;
    const intensity = Math.min(1.6, relSpeed / 200);
    if (intensity < 0.06) return 0;
    const credit = !!opts.credit;
    if (credit) this.playerTouch = Math.max(this.playerTouch, 2);

    const baseDmg = 6 + intensity * 60;
    let scored = 0;
    const la = angleDiff(towardAngle, this.angle);
    const frontHeavy = Math.abs(Math.cos(la)) > 0.55;
    const isFront = Math.cos(la) > 0;
    const sideKey = Math.sin(la) > 0 ? 'doorR' : 'doorL';
    const targets = opts.top
      ? [['body', 1.4], ['engine', 0.5], ['hood', 0.8]]
      : frontHeavy
        ? (isFront
          ? [['bumper', 1.5], ['hood', 1.25], ['engine', 0.75], ['body', 0.85]]
          : [['body', 1.2], ['bumper', 0.9], ['engine', 0.3]])
        : [['body', 1.25], [sideKey, 1.6], ['bumper', 0.35]];
    if (intensity > 0.35) {
      const wk = frontHeavy
        ? (isFront ? (Math.sin(la) > 0 ? 'wheelFR' : 'wheelFL') : (Math.sin(la) > 0 ? 'wheelRR' : 'wheelRL'))
        : (Math.random() > 0.5 ? (Math.sin(la) > 0 ? 'wheelFR' : 'wheelFL') : (Math.sin(la) > 0 ? 'wheelRR' : 'wheelRL'));
      targets.push([wk, 1.0]);
    }

    for (const [key, mult] of targets) {
      const part = this.parts[key];
      if (!part || part.hp <= 0) continue;
      const dmg = baseDmg * mult * (0.55 + Math.random() * 0.55);
      const applied = Math.min(part.hp, dmg);
      part.hp -= applied;
      scored += applied;
      if (part.attached && part.hp <= 0 && PART_KEYS_DETACH.includes(key)) {
        this._detachPart(key, world, relSpeed, credit);
      }
    }

    // Abolladura visible
    this.dents.push({ a: la, depth: Math.min(1, intensity * 0.9), top: !!opts.top });
    if (this.dents.length > 14) {
      const d0 = this.dents.shift();
      this.dents[0].depth = Math.min(1, this.dents[0].depth + d0.depth * 0.5);
    }
    this.dentVersion++;

    // Empuje alejándose del impacto (el impulso por masas lo resuelve la colisión)
    if (opts.push !== false) {
      const impulse = (relSpeed * intensity * 0.6) / this.mass;
      this.vx -= Math.cos(towardAngle) * impulse * 6;
      this.vy -= Math.sin(towardAngle) * impulse * 6;
    }
    this.yawRate += (Math.random() - 0.5) * intensity * 5;
    if (this.aiDrive && intensity > 0.12) { this.aiDrive = false; this.inputThrottle = 0; }
    this.lastImpact = 0.3;

    if (intensity > 0.25) {
      this.sparkTimer = 0.25 + intensity * 0.45;
      sparks(world.particles,
        this.cx + Math.cos(towardAngle) * this.w * 0.4,
        this.cy + Math.sin(towardAngle) * this.h * 0.6,
        this.liftZ + 8, 6 + Math.floor(intensity * 14), 200);
      sfx.hit();
    }
    if (this.parts.engine.hp < this.parts.engine.max * 0.55) {
      this.smokeTimer = Math.max(this.smokeTimer, 2.5);
    }
    if (this.isWreck && !this.wrecked) {
      this.wrecked = true;
      this._becomeWreck(world, credit, intensity);
      scored += 25;
    }
    return scored;
  }

  applyDamage(amount, world, fromX, fromY, credit = false) {
    const toward = Math.atan2((fromY ?? this.cy) - this.cy, (fromX ?? this.cx) - this.cx);
    return this.applyImpact(Math.min(320, 40 + amount * 3.2), world, toward, { credit });
  }

  _detachPart(key, world, relSpeed, credit) {
    if (this.detachedOnce.has(key)) return;
    this.detachedOnce.add(key);
    const part = this.parts[key];
    part.attached = false;
    part.hp = 0;

    let pw = 14, ph = 10, th = 3, color = this.color, mass = 2.2;
    if (key === 'hood') { pw = 15; ph = 19; th = 2; }
    else if (key === 'bumper') { pw = 5; ph = 21; th = 4; color = '#9aa3a8'; }
    else if (key.startsWith('door')) { pw = 13; ph = 3; th = 9; }
    else if (key.startsWith('wheel')) { pw = 7; ph = 7; th = 7; color = '#1a1a1a'; mass = 1.2; }

    const side = key.endsWith('L') ? -1 : key.endsWith('R') ? 1 : 0;
    const ang = this.angle + side * Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const spit = 70 + relSpeed * 0.35;
    world.debris.push(new Body({
      x: this.cx - pw / 2, y: this.cy - ph / 2,
      w: pw, h: ph, th, z: this.liftZ + 8, vz: 60 + Math.random() * 90,
      angle: this.angle,
      vx: Math.cos(ang) * spit + this.vx * 0.4,
      vy: Math.sin(ang) * spit + this.vy * 0.4,
      mass, kind: 'debris', color,
      damageOnHit: key.startsWith('wheel') ? 15 : 20,
      spin: (Math.random() - 0.5) * 14,
      friction: 0.93,
      data: { carPart: key, stripes: this.stripes, srcCar: this.id },
      playerTouch: credit ? 3 : 0,
    }));
    burst(world.particles, this.cx, this.cy, 6, color, { z: this.liftZ + 8 });
    sfx.smash();
  }

  _becomeWreck(world, credit, intensity = 0.5) {
    this.static = this.liftZ <= 0;
    this.driven = false;
    this.aiDrive = false;
    this.inputThrottle = 0;
    this.smokeTimer = 8;
    for (const key of ['hood', 'bumper', 'doorL', 'doorR']) {
      if (this.parts[key].attached && Math.random() < 0.6) this._detachPart(key, world, 90, credit);
    }
    dustCloud(world.particles, this.cx, this.cy, 5, { color: '#555', size: 14 });
    sfx.smash();
    world.addRoadCrack(this.cx, this.cy, 0.7);
    if (Math.random() < 0.35 + intensity * 0.3) {
      this.onFire = 6 + Math.random() * 6;
      world.explosion(this.cx, this.cy, 6, 0.7, credit);
    }
  }

  /** Lanzado por TK: arco + volteretas */
  launch(vx, vy, vz, credit = true) {
    this.static = false;
    this.aiDrive = false;
    this.parked = false;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.rollRate = (Math.random() - 0.5) * Math.min(10, Math.hypot(vx, vy) / 60);
    this.pitchRate = (Math.random() - 0.5) * Math.min(6, Math.hypot(vx, vy) / 100);
    this.yawRate = (Math.random() - 0.5) * 6;
    if (credit) this.playerTouch = 6;
  }

  /**
   * Avanza el auto. ctx = { vehicles, npcs, player, world, target }
   */
  update(dt, world, particles, ctx = {}) {
    if (!this.alive) return;
    if (this.spawnGrace > 0) this.spawnGrace -= dt;
    if (this.playerTouch > 0) this.playerTouch -= dt;
    if (this.ghost > 0) this.ghost -= dt;
    if (this.hostileTouch > 0) this.hostileTouch -= dt;
    if (this.lastImpact > 0) this.lastImpact -= dt;
    this.landed = 0;

    if (this.grabbed || this.lifted || this.frozen) {
      this._fx(dt, particles);
      return;
    }

    const onGround = this.liftZ <= 0 && this.vz <= 0;
    if (onGround && this.driven && !this.static && !this.flipped) {
      this.integrateDriving(dt);
    } else if (onGround && this.aiDrive && !this.static && !this.isWreck) {
      this._aiStep(dt, ctx, world);
      this.integrateDriving(dt);
    } else if (!this.static || !onGround) {
      // Momentum libre (tras TK / impacto / vuelo)
      if (!onGround) {
        this.vz -= GRAVITY * dt;
        this.liftZ += this.vz * dt;
        this.roll += this.rollRate * dt;
        this.pitch += this.pitchRate * dt;
        this.angle += this.yawRate * dt;
        if (this.liftZ <= 0) this._land(world);
      } else {
        this.angle += this.yawRate * dt;
        this.vx *= Math.pow(0.975, dt * 60);
        this.vy *= Math.pow(0.975, dt * 60);
        this.yawRate *= Math.pow(0.94, dt * 60);
        const cs = Math.cos(this.angle), sn = Math.sin(this.angle);
        const fwd = this.vx * cs + this.vy * sn;
        const lat = -this.vx * sn + this.vy * cs;
        const lat2 = lat * Math.pow(this.flipped ? 0.9 : 0.93, dt * 60);
        const fwd2 = fwd * Math.pow(this.flipped ? 0.94 : 0.995, dt * 60);
        this.vx = cs * fwd2 - sn * lat2;
        this.vy = sn * fwd2 + cs * lat2;
        if (this.isWreck && this.speed < 4 && !this.static) this.static = true;
      }
    } else {
      // chatarra deslizando
      this.vx *= Math.pow(0.9, dt * 60);
      this.vy *= Math.pow(0.9, dt * 60);
      this.angle += this.yawRate * dt;
      this.yawRate *= Math.pow(0.92, dt * 60);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.wheelSpin += this.forwardSpeed * dt * 0.28;
    this.steerVisual += (this.inputSteer * 0.5 - this.steerVisual) * Math.min(1, dt * 10);

    const b = world.bounds;
    if (this.aiDrive && this.lane) {
      this._wrap(world, ctx.vehicles || []);
    } else {
      if (this.cx < b.x + 10) { this.cx = b.x + 10; this.vx = Math.abs(this.vx) * this.bounce; }
      if (this.cy < b.y + 10) { this.cy = b.y + 10; this.vy = Math.abs(this.vy) * this.bounce; }
      if (this.cx > b.w - 10) { this.cx = b.w - 10; this.vx = -Math.abs(this.vx) * this.bounce; }
      if (this.cy > b.h - 10) { this.cy = b.h - 10; this.vy = -Math.abs(this.vy) * this.bounce; }
    }
    this._fx(dt, particles);
  }

  _land(world) {
    const impact = -this.vz;
    this.liftZ = 0;
    this.landed = impact;
    // ¿Cae de cabeza?
    const r = ((this.roll % TAU) + TAU) % TAU;
    const upside = r > Math.PI / 2 && r < Math.PI * 1.5;
    if (impact > 90) {
      this.vz = impact * 0.25;
      this.rollRate *= 0.5; this.pitchRate *= 0.5;
      this.applyImpact(impact * 0.9, world, this.angle + Math.PI / 2, { credit: this.playerTouch > 0, top: upside, push: false, force: true });
      dustCloud(world.particles, this.cx, this.cy, 6, { size: 16, speed: 60 });
      if (impact > 200) world.addRoadCrack(this.cx, this.cy, 0.9);
    } else {
      this.vz = 0;
      this.flipped = upside;
      this.roll = upside ? Math.PI : 0;
      this.pitch = 0;
      this.rollRate = 0; this.pitchRate = 0;
      if (this.flipped) { this.smokeTimer = Math.max(this.smokeTimer, 3); }
    }
    this.vx *= 0.75; this.vy *= 0.75;
  }

  _fx(dt, particles) {
    if (this.smokeTimer > 0 || this.parts.engine.hp < this.parts.engine.max * 0.5) {
      this.smokeTimer -= dt;
      if (Math.random() < (0.15 + this.damageRatio * 0.4) * dt * 60 * 0.5) {
        const fx = this.cx + Math.cos(this.angle) * 15, fy = this.cy + Math.sin(this.angle) * 15;
        smokePuff(particles, fx, fy, this.liftZ + 12, {
          size: 5 + this.damageRatio * 6, color: this.wreckTier >= 2 ? '#222' : '#777', life: 1.4,
        });
      }
    }
    if (this.onFire > 0) {
      this.onFire -= dt;
      if (Math.random() < 0.7) fireBurst(particles, this.cx + Math.cos(this.angle) * 12, this.cy + Math.sin(this.angle) * 12, this.liftZ + 12, 1, 0.45);
      if (Math.random() < 0.25) smokePuff(particles, this.cx, this.cy, this.liftZ + 18, { size: 9, color: '#1d1d1d', life: 2.2 });
    }
    if (this.sparkTimer > 0) {
      this.sparkTimer -= dt;
      if (Math.random() < 0.5) sparks(particles, this.cx, this.cy, this.liftZ + 3, 1, 120);
    }
  }

  // ——— IA de tráfico ———
  _aiStep(dt, ctx, world) {
    if (this.hostile && ctx.target) {
      const t = ctx.target;
      const desired = Math.atan2(t.y - this.cy, t.x - this.cx);
      const err = angleDiff(desired, this.angle);
      this.setDriveInput(Math.abs(err) > 2.2 ? -0.6 : 1, Math.max(-1, Math.min(1, err * 2.5)), false);
      return;
    }
    if (!this.lane) { this.setDriveInput(0, 0, false); return; }
    const L = this.lane;
    const h0 = L.horiz ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const rx = -Math.sin(h0), ry = Math.cos(h0);
    const px = L.horiz ? this.cx : L.coord, py = L.horiz ? L.coord : this.cy;
    const offset = (this.cx - px) * rx + (this.cy - py) * ry;
    const desired = h0 - Math.max(-0.45, Math.min(0.45, offset * 0.04));
    const steer = Math.max(-1, Math.min(1, angleDiff(desired, this.angle) * 2.8));

    // Obstáculos al frente (sin choques ambientales)
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const look = 60 + Math.max(0, this.forwardSpeed) * 0.7;
    let block = false;
    if (this.ignoreObstacles > 0) this.ignoreObstacles -= dt;
    else {
      for (const o of ctx.vehicles || []) {
        if (o === this || !o.alive || o.liftZ > 20) continue;
        const dx = o.cx - this.cx, dy = o.cy - this.cy;
        const f = dx * fx + dy * fy;
        if (f <= 0 || f > look) continue;
        const l = Math.abs(-dx * fy + dy * fx);
        if (l > 24) continue;
        const parallel = Math.cos(o.angle - this.angle);
        if (parallel > 0.6 || !o.aiDrive || o.id < this.id || Math.abs(parallel) < 0.5 && f < 40) { block = true; break; }
      }
      if (!block) {
        const peds = [...(ctx.npcs || [])];
        if (ctx.player && !ctx.playerDriving) peds.push({ cx: ctx.player.x, cy: ctx.player.y });
        for (const n of peds) {
          const dx = n.cx - this.cx, dy = n.cy - this.cy;
          const f = dx * fx + dy * fy;
          if (f <= 0 || f > 50) continue;
          if (Math.abs(-dx * fy + dy * fx) < 16) { block = true; break; }
        }
      }
    }
    // Reserva de intersección: solo un auto cruza a la vez (evita choques en cruces)
    if (!block && world.intersections) {
      const res = world._ixRes || (world._ixRes = new Map());
      const ahead = this.w * 0.5 + 22 + Math.max(0, this.forwardSpeed) * 0.12;
      const ax = this.cx + fx * ahead, ay = this.cy + fy * ahead;
      const inside = (r, x, y) => x > r.x - 4 && x < r.x + r.w + 4 && y > r.y - 4 && y < r.y + r.h + 4;
      let ixHere = -1, ixAhead = -1;
      for (let i = 0; i < world.intersections.length; i++) {
        const r = world.intersections[i];
        if (inside(r, this.cx, this.cy)) ixHere = i;
        if (inside(r, ax, ay)) ixAhead = i;
      }
      if (this.resv != null && this.resv !== ixHere && this.resv !== ixAhead) {
        if (res.get(this.resv) === this) res.delete(this.resv);
        this.resv = null;
      }
      const want = ixHere >= 0 ? ixHere : ixAhead;
      if (want >= 0) {
        const holder = res.get(want);
        const holderValid = holder && holder !== this && holder.alive && holder.aiDrive && holder.resv === want;
        if (!holderValid) { res.set(want, this); this.resv = want; }
        else if (ixHere < 0) block = true; // espera antes de entrar
      }
    }
    if (block) {
      this.stopTimer += dt;
      // Atasco largo: pasa "fantasma" a través del tráfico ambiental (nunca choca sin el jugador)
      if (this.stopTimer > 5) { this.ignoreObstacles = 2; this.ghost = 2; this.stopTimer = 0; }
      this.setDriveInput(this.forwardSpeed > 8 ? -1 : 0, steer, false);
    } else {
      this.stopTimer = Math.max(0, this.stopTimer - dt);
      this.setDriveInput(this.forwardSpeed < this.maxSpeed ? 0.8 : 0, steer, false);
    }
  }

  _wrap(world, vehicles) {
    const W = world.w, H = world.h, m = 30;
    let nx = null, ny = null;
    if (this.cx > W + m) nx = -m + 5;
    else if (this.cx < -m) nx = W + m - 5;
    if (this.cy > H + m) ny = -m + 5;
    else if (this.cy < -m) ny = H + m - 5;
    if (nx == null && ny == null) return;
    const tx = nx ?? this.cx, ty = ny ?? this.cy;
    for (const o of vehicles) {
      if (o !== this && Math.hypot(o.cx - tx, o.cy - ty) < 70) { this.vx *= 0.5; this.vy *= 0.5; return; }
    }
    this.cx = tx; this.cy = ty;
  }

  /** HUD estilo Wreckfest (lienzo 2D superpuesto) */
  drawDamageHUD(ctx, W, H, opts = {}) {
    if (!this.driven) return;
    const compact = !!opts.compact;
    const pct = (p) => Math.max(0, p.hp / p.max);
    const col = (v, attached = true) => !attached ? 'rgba(255,255,255,0.08)'
      : v > 0.6 ? '#2ecc71' : v > 0.3 ? '#f1c40f' : v > 0 ? '#e74c3c' : '#5a1a1a';

    // —— Silueta de daño (izquierda)
    const sx = compact ? 14 : 22;
    const sy = compact ? H * 0.36 : H - 190;
    ctx.save();
    ctx.translate(sx + 34, sy + 60);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(8,12,20,0.55)';
    ctx.beginPath(); ctx.roundRect(-38, -66, 76, 140, 12); ctx.fill();
    const P = this.parts;
    // ruedas
    const wheel = (k, x, y) => { ctx.fillStyle = col(pct(P[k]), P[k].attached); ctx.fillRect(x, y, 8, 18); };
    wheel('wheelFL', -26, -44); wheel('wheelFR', 18, -44);
    wheel('wheelRL', -26, 22); wheel('wheelRR', 18, 22);
    // carrocería
    ctx.fillStyle = col(pct(P.body));
    ctx.beginPath(); ctx.roundRect(-17, -38, 34, 82, 8); ctx.fill();
    ctx.fillStyle = col(pct(P.hood), P.hood.attached);
    ctx.fillRect(-15, -36, 30, 20);
    ctx.fillStyle = col(pct(P.bumper), P.bumper.attached);
    ctx.fillRect(-17, -46, 34, 6);
    ctx.fillStyle = col(pct(P.doorL), P.doorL.attached);
    ctx.fillRect(-21, -10, 4, 26);
    ctx.fillStyle = col(pct(P.doorR), P.doorR.attached);
    ctx.fillRect(17, -10, 4, 26);
    ctx.fillStyle = 'rgba(10,20,35,0.85)';
    ctx.fillRect(-12, -12, 24, 28);
    // motor
    ctx.fillStyle = col(pct(P.engine));
    ctx.beginPath(); ctx.arc(0, -26, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tiers = ['LIMPIO', 'ABOLLADO', 'APLASTADO', 'CHATARRA'];
    ctx.fillText(tiers[this.wreckTier], 0, 66);
    // barra de salud total
    ctx.fillStyle = '#ffffff22'; ctx.fillRect(-30, 52, 60, 4);
    const hp = 1 - this.damageRatio;
    ctx.fillStyle = col(hp); ctx.fillRect(-30, 52, 60 * hp, 4);
    ctx.restore();

    // —— Velocímetro (derecha)
    const kmh = Math.round(this.speed * 0.36);
    const R = compact ? 46 : 62;
    const gx = compact ? W - R - 18 : W - R - 34;
    const gy = compact ? H * 0.42 : H - R - 46;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = 'rgba(8,12,20,0.5)';
    ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, Math.PI * 2); ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffffcc';
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + (a1 - a0) * 0.8); ctx.stroke();
    ctx.strokeStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(0, 0, R, a0 + (a1 - a0) * 0.8, a1); ctx.stroke();
    // marcas
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${compact ? 8 : 10}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (a1 - a0) * (i / 8);
      ctx.fillText(String(i), Math.cos(a) * (R - 13), Math.sin(a) * (R - 13));
    }
    // RPM simulado por marcha
    const gearMax = [0, 45, 80, 115, 150, 999];
    let gear = 1;
    while (gear < 5 && kmh > gearMax[gear]) gear++;
    const lo = gearMax[gear - 1], hi = gear === 5 ? 200 : gearMax[gear];
    const rpm = this.inputThrottle < -0.05 && this.forwardSpeed < 0 ? 0.3
      : Math.min(1, 0.12 + 0.85 * ((kmh - lo) / Math.max(1, hi - lo)));
    const na = a0 + (a1 - a0) * rpm;
    ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(na) * (R - 4), Math.sin(na) * (R - 4)); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${compact ? 22 : 30}px system-ui, sans-serif`;
    ctx.fillText(this.forwardSpeed < -5 ? 'R' : kmh < 2 ? 'N' : String(gear), -R * 0.22, R * 0.12);
    ctx.font = `800 ${compact ? 12 : 15}px system-ui, sans-serif`;
    ctx.fillText(String(kmh), R * 0.34, -R * 0.02);
    ctx.font = `600 ${compact ? 7 : 9}px system-ui, sans-serif`;
    ctx.fillText('KM/H', R * 0.34, R * 0.22);
    ctx.restore();
  }
}

/** Tráfico por carriles, sin solapes y lejos del jugador */
export function spawnCityTraffic(world, count = 14) {
  const cars = [];
  const avoid = world.spawn;
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const road = world.roads[Math.floor(Math.random() * world.roads.length)];
      const dir = Math.random() > 0.5 ? 1 : -1;
      let x, y, coord, angle;
      if (road.horiz) {
        coord = road.y + (dir > 0 ? ROAD_W * 0.73 : ROAD_W * 0.27);
        x = 40 + Math.random() * (world.w - 80); y = coord;
        angle = dir > 0 ? 0 : Math.PI;
      } else {
        coord = road.x + (dir > 0 ? ROAD_W * 0.27 : ROAD_W * 0.73);
        y = 40 + Math.random() * (world.h - 80); x = coord;
        angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      // lejos de cruces, de otros autos y del jugador
      const inX = world.intersections.some(r => x > r.x - 40 && x < r.x + r.w + 40 && y > r.y - 40 && y < r.y + r.h + 40);
      if (inX) continue;
      if (cars.some(c => Math.hypot(c.cx - x, c.cy - y) < 110)) continue;
      if (avoid && Math.hypot(avoid.x - x, avoid.y - y) < 140) continue;
      cars.push(new Vehicle(x, y, {
        angle, aiDrive: true, lane: { horiz: road.horiz, coord, dir },
      }));
      break;
    }
  }
  return cars;
}

export function spawnParkedCars(world) {
  return world.parkingSpots.map(s => {
    const v = new Vehicle(s.x, s.y, { angle: s.angle, parked: true });
    return v;
  });
}

/**
 * Colisiones auto-auto (círculos con impulso por masa), autos vs estructuras,
 * props y NPCs. El crédito (puntuación) solo cuenta si el jugador causó el choque.
 */
export function resolveVehicleCollisions(vehicles, world, onScore, onShake, npcs = []) {
  let score = 0;
  const credited = (v) => v.driven || v.playerTouch > 0;

  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    if (!a.alive || a.grabbed || a.frozen) continue;
    const ca = a.circles();
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      if (!b.alive || b.grabbed || b.frozen) continue;
      if (Math.abs(a.liftZ - b.liftZ) > 14) continue;
      if (Math.abs(a.cx - b.cx) > 50 || Math.abs(a.cy - b.cy) > 50) continue;
      const credPair = credited(a) || credited(b);
      if (!credPair && (a.ghost > 0 || b.ghost > 0)) continue;
      const cb = b.circles();
      let best = null;
      for (const p of ca) for (const q of cb) {
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        const pen = p.r + q.r - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), ny: dy / (d || 1), px: (p.x + q.x) / 2, py: (p.y + q.y) / 2 };
      }
      if (!best) continue;
      const ma = a.static ? a.mass * 3 : a.mass, mb = b.static ? b.mass * 3 : b.mass;
      const ia = 1 / ma, ib = 1 / mb;
      // separación
      const sep = best.pen + 0.3;
      a.x -= best.nx * sep * ia / (ia + ib); a.y -= best.ny * sep * ia / (ia + ib);
      b.x += best.nx * sep * ib / (ia + ib); b.y += best.ny * sep * ib / (ia + ib);
      // impulso
      const closing = (a.vx - b.vx) * best.nx + (a.vy - b.vy) * best.ny;
      if (closing > 0) {
        const jImp = (1.3 * closing) / (ia + ib);
        if (a.static && closing > 60) a.static = false;
        if (b.static && closing > 60) b.static = false;
        a.vx -= best.nx * jImp * ia; a.vy -= best.ny * jImp * ia;
        b.vx += best.nx * jImp * ib; b.vy += best.ny * jImp * ib;
      }
      // Tráfico ambiental (IA/estacionados sin intervención del jugador): solo se separan, sin daño
      const ambient = !credPair && (a.aiDrive || a.parked) && (b.aiDrive || b.parked) && !a.hostile && !b.hostile;
      if (closing > 30 && !ambient) {
        const credit = credPair;
        const angAB = Math.atan2(best.ny, best.nx);
        // daño escalado por masa del otro × velocidad de cierre
        const sa = a.applyImpact(closing * Math.sqrt(mb / 10), world, angAB, { credit, push: false });
        const sb = b.applyImpact(closing * Math.sqrt(ma / 10), world, angAB + Math.PI, { credit, push: false });
        if (credit) score += sa + sb;
        if (closing > 80 && onShake && credit) onShake(Math.min(12, closing * 0.05));
        if (closing > 60) sparks(world.particles, best.px, best.py, (a.liftZ + b.liftZ) / 2 + 6, 8, 220);
      }
    }
  }

  for (const v of vehicles) {
    if (!v.alive || v.grabbed || v.frozen) continue;
    const spd = v.speed;
    const credit = credited(v);
    // Estructuras: siempre empuja fuera; daño si va rápido
    const box = v.aabb();
    const bx0 = box.x, by0 = box.y;
    const tmp = { x: box.x + 3, y: box.y + 3, w: box.w - 6, h: box.h - 6, liftZ: v.liftZ };
    const hit = world.resolveStructures(tmp);
    if (hit) {
      v.x += tmp.x - (bx0 + 3); v.y += tmp.y - (by0 + 3);
      if (spd > 28) {
        const seg = hit.seg;
        const ang = Math.atan2(-hit.ny, -hit.nx);
        const hpBefore = seg.hp;
        const dmgSeg = 0.05 * v.mass * spd;
        const s1 = v.applyImpact(spd, world, ang, { credit, push: false });
        const s2 = world.damageSegment(seg, dmgSeg, credit);
        if (dmgSeg > 50) world.segmentsInRadius(seg.cx, seg.cy, 28, s => { if (s !== seg) world.damageSegment(s, dmgSeg * 0.3, credit); });
        if (credit) score += s1 + s2;
        if (seg.destroyed && dmgSeg > hpBefore * 1.3) {
          const keep = Math.sqrt(Math.max(0.1, 1 - hpBefore / dmgSeg));
          v.vx *= keep; v.vy *= keep;
        } else {
          if (hit.nx) v.vx = hit.nx * Math.abs(v.vx) * 0.35;
          if (hit.ny) v.vy = hit.ny * Math.abs(v.vy) * 0.35;
          v.yawRate += (Math.random() - 0.5) * 3;
        }
        if (spd > 70 && onShake && credit) onShake(Math.min(10, spd * 0.05));
      } else {
        if (hit.nx) v.vx = hit.nx * Math.abs(v.vx) * 0.2;
        if (hit.ny) v.vy = hit.ny * Math.abs(v.vy) * 0.2;
      }
    }
    if (v.liftZ < 30) {
      for (const prop of world.props) {
        if (prop.destroyed) continue;
        if (!aabbOverlap(box, prop)) continue;
        if (spd < 25) {
          // empuja suave
          const dx = v.cx - prop.cx, dy = v.cy - prop.cy, d = Math.hypot(dx, dy) || 1;
          v.vx += dx / d * 20; v.vy += dy / d * 20;
          continue;
        }
        const ang = Math.atan2(prop.cy - v.cy, prop.cx - v.cx);
        const s1 = v.applyImpact(spd * 0.5, world, ang, { credit, push: false });
        const s2 = world.damageProp(prop, 10 + spd * 0.12, v.cx, v.cy);
        if (credit) score += s1 + s2;
        v.vx *= 0.75; v.vy *= 0.75;
        break;
      }
    }
    // Atropellos arcade (sin gore): NPC sale volando
    if (spd > 45 && v.liftZ < 20 && !(v.aiDrive && !credit && !v.hostile)) {
      for (const n of npcs) {
        if (!n.alive) continue;
        if (Math.abs(n.cx - v.cx) > 30 || Math.abs(n.cy - v.cy) > 30) continue;
        if (!aabbOverlap(box, n.aabb())) continue;
        const s = n.hitByBody(v, credit);
        if (credit) score += s;
      }
    }
  }

  if (score && onScore) onScore(score);
  return score;
}
