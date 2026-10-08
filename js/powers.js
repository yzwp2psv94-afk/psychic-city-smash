/**
 * Poderes psíquicos con carga (mantener para cargar), nivel de fuerza ajustable
 * (rueda / slider / gatillos), atrapar-congelar objetos en el aire y redirigirlos.
 */

import { burst, sparks, dustCloud, addParticle, GRAVITY, clamp } from './physics.js';
import { sfx } from './audio.js';

export const CHARGE_TIME = 1.1;      // s para carga completa
export const FORCE_MIN = 0.05;
export const FORCE_MAX = 1;

export const POWERS = [
  { id: 'tk', name: 'Telequinesis', tip: 'Mantén clic: agarra y carga · suelta: lanza hacia la mira · rueda = fuerza', cost: 0, holdCost: 7, color: '#a29bfe' },
  { id: 'shock', name: 'Onda de choque', tip: 'Mantén para cargar la onda · suelta: empuje radial en la mira', cost: 28, color: '#74b9ff' },
  { id: 'crush', name: 'Aplastar', tip: 'Mantén para cargar · suelta sobre un edificio o auto', cost: 22, color: '#e17055' },
  { id: 'slam', name: 'Levitación / Slam', tip: 'Mantén: levanta más alto · suelta: ¡slam contra el suelo!', cost: 30, color: '#fdcb6e' },
  { id: 'shield', name: 'Escudo psíquico', tip: 'Clic: escudo breve que bloquea daño', cost: 35, color: '#00b894' },
];

export class PowersSystem {
  constructor() {
    this.selected = 0;
    this.grabbed = null;
    this.charge = 0;
    this.charging = false;
    this.chargeKind = null;
    this.chargeRate = 1;
    this.force = 0.6;
    this.slamTarget = null;
    this.slamPhase = 0;   // 0 nada · 1 levantando (carga) · 2 cayendo
    this.slamTimer = 0;
    this.slamPower = 0;
    this.shieldTimer = 0;
    this.catching = false;
    this.frozen = [];
    this.lastThrowKmh = 0;
    this.hold = { x: 0, y: 0, z: 0 };
  }

  setForce(v) { this.force = clamp(v, FORCE_MIN, FORCE_MAX); return this.force; }
  addForce(d) { return this.setForce(Math.round((this.force + d) * 100) / 100); }

  /** 0..1: fuerza × carga (para onda / aplastar / slam) */
  strength() { return this.force * (0.15 + 0.85 * this.charge); }
  /** px/s: desde empujoncito (~25) hasta lanzamiento brutal (~1425) */
  throwSpeed() { return 25 + this.force * (60 + 1340 * Math.pow(this.charge, 1.3)); }

  select(i) {
    if (i >= 0 && i < POWERS.length && i !== this.selected) {
      this.releaseGrab();
      this.cancelCharge();
      this.selected = i;
    }
  }

  cancelCharge() {
    this.charging = false;
    this.charge = 0;
    this.chargeKind = null;
  }

  releaseGrab() {
    if (this.grabbed) {
      const g = this.grabbed;
      g.grabbed = false;
      g.vz = 0;
      if (g.kind === 'vehicle') g.launch(0, 0, 0, true);
      this.grabbed = null;
    }
    if (this.slamTarget) {
      this.slamTarget.lifted = false;
      this.slamTarget.grabbed = false;
      this.slamTarget = null;
      this.slamPhase = 0;
    }
    if (this.chargeKind === 'tk' || this.chargeKind === 'slam') this.cancelCharge();
  }

  effectiveCost(base, driving) { return driving ? base * 1.6 : base; }

  _origin(ctx) {
    const src = ctx.drivenCar || ctx.player;
    return { x: src.cx ?? src.x, y: src.cy ?? src.y };
  }

  /** Inicio (clic / botón / gatillo). ctx: { world, vehicles, npcs, aimX, aimY, aimZ, player, drivenCar, energy, driving } */
  tryStart(ctx) {
    const { world, vehicles, aimX: mx, aimY: my, energy, driving } = ctx;
    const power = POWERS[this.selected];
    const cost = this.effectiveCost(power.cost, driving);

    if (power.id === 'tk') {
      const cands = vehicles.filter(v => v.alive && v !== ctx.drivenCar && !v.driven);
      const target = world.findGrabbableNear(mx, my, driving ? 80 : 100, cands);
      if (target) {
        this._grab(target);
        this.charging = true; this.charge = 0; this.chargeKind = 'tk';
        sfx.grab();
        return { energy: 2, tip: target.kind === 'vehicle' ? 'Auto agarrado · mantén para cargar · suelta para lanzar' : 'Agarrado · mantén para cargar · suelta para lanzar' };
      }
      return { energy: 0, tip: 'Nada que agarrar cerca · apunta a escombros, piezas o autos' };
    }

    if (power.id === 'shield') {
      if (energy < cost) return { energy: 0, tip: 'Sin energía psíquica' };
      this.shieldTimer = driving ? 1.8 : 2.8;
      sfx.shield();
      return { energy: cost, tip: 'Escudo activo' };
    }

    if (energy < cost * 0.35) return { energy: 0, tip: 'Sin energía psíquica' };

    if (power.id === 'slam') {
      const cands = vehicles.filter(v => v.alive && !v.driven && v !== ctx.drivenCar);
      const target = world.findGrabbableNear(mx, my, 100, cands);
      if (!target) return { energy: 0, tip: 'Sin objetivo para slam' };
      this.slamTarget = target;
      target.lifted = true;
      target.grabbed = true;
      target.frozen = false;
      this._unlistFrozen(target);
      if (target.kind === 'vehicle') { target.aiDrive = false; target.static = false; target.parked = false; }
      target.playerTouch = 6;
      this.slamPhase = 1;
      this.slamTimer = 3;
      this.charging = true; this.charge = 0; this.chargeKind = 'slam';
      sfx.grab();
      return { energy: cost * 0.4, tip: 'Levitando… mantén para subir más · suelta: ¡SLAM!' };
    }

    // shock / crush: cargar
    this.charging = true; this.charge = 0; this.chargeKind = power.id;
    return { energy: 0, tip: power.id === 'shock' ? 'Cargando onda…' : 'Cargando aplastamiento…' };
  }

  _grab(target) {
    this.grabbed = target;
    target.grabbed = true;
    if (target.frozen) { target.frozen = false; this._unlistFrozen(target); }
    target.vx = 0; target.vy = 0; target.vz = 0;
    target.playerTouch = 6;
    if (target.kind === 'vehicle') {
      target.static = false;
      target.aiDrive = false;
      target.driven = false;
      target.parked = false;
    }
  }

  _unlistFrozen(b) {
    const i = this.frozen.indexOf(b);
    if (i >= 0) this.frozen.splice(i, 1);
  }

  /** Lanza un cuerpo hacia (tx,ty,tz) con rapidez dada (arco balístico) */
  _launchToward(b, tx, ty, tz, speed, fallbackAng) {
    let dx = tx - b.cx, dy = ty - b.cy;
    let d = Math.hypot(dx, dy);
    if (d < 20) { dx = Math.cos(fallbackAng); dy = Math.sin(fallbackAng); d = 1; }
    const nx = dx / d, ny = dy / d;
    const dist = Math.max(20, Math.hypot(tx - b.cx, ty - b.cy));
    const t = dist / speed;
    let vz = (tz - (b.liftZ || 0) + 0.5 * GRAVITY * t * t) / Math.max(0.05, t);
    vz = clamp(vz, -300, 420);
    const vx = nx * speed, vy = ny * speed;
    if (b.kind === 'vehicle') {
      b.launch(vx, vy, vz, true);
    } else {
      b.vx = vx; b.vy = vy; b.vz = vz;
      b.spin = (Math.random() - 0.5) * 12;
      b.tumbleRate = (Math.random() - 0.5) * Math.min(18, speed / 40);
      b.playerTouch = 6;
      b.hostileTouch = 0;
    }
    if (b.liftZ <= 0) b.liftZ = 1;
  }

  /** Soltar (fin de mantener) */
  onRelease(ctx) {
    const power = POWERS[this.selected];
    const { world, vehicles, aimX: mx, aimY: my } = ctx;
    const o = this._origin(ctx);
    const fallback = Math.atan2(my - o.y, mx - o.x);

    if (power.id === 'tk' && this.grabbed) {
      const g = this.grabbed;
      g.grabbed = false;
      const speed = this.throwSpeed();
      this._launchToward(g, mx, my, ctx.aimZ || 0, speed, fallback);
      const kmh = Math.round(speed * 0.36);
      this.lastThrowKmh = kmh;
      const cost = 3 + 16 * this.force * this.charge * (g.kind === 'vehicle' ? 1.4 : 1);
      sparks(world.particles, g.cx, g.cy, g.liftZ + 6, 6, 120, '#b9a8ff');
      sfx.throw();
      this.grabbed = null;
      const shake = Math.min(9, speed * 0.006);
      this.cancelCharge();
      return { energy: cost, tip: speed < 120 ? `Empujoncito · ${kmh} km/h` : `¡Lanzado! ${kmh} km/h`, shake };
    }

    if (power.id === 'shock' && this.chargeKind === 'shock') {
      let s = this.strength();
      const maxCost = this.effectiveCost(8 + 40 * s, ctx.driving);
      if (ctx.energy < maxCost) s *= Math.max(0.1, ctx.energy / maxCost);
      const cost = this.effectiveCost(8 + 40 * s, ctx.driving);
      const radius = 45 + 185 * Math.sqrt(s);
      const dmg = 5 + 115 * s;
      const knock = 80 + 1500 * s;
      let score = world.applyRadialDamage(mx, my, radius, dmg, knock, true);
      for (const v of vehicles) {
        if (!v.alive || v === ctx.drivenCar || v.grabbed) continue;
        const d = Math.hypot(v.cx - mx, v.cy - my);
        if (d >= radius) continue;
        const fall = 1 - d / radius;
        score += v.applyDamage(dmg * 0.8 * fall, world, mx, my, true);
        const ang = Math.atan2(v.cy - my, v.cx - mx);
        const f = fall * knock * 2.2 / v.mass;
        if (v.frozen) { v.frozen = false; this._unlistFrozen(v); }
        v.launch(v.vx + Math.cos(ang) * f, v.vy + Math.sin(ang) * f, s > 0.35 ? f * 0.45 : 0, true);
      }
      for (const n of ctx.npcs || []) {
        const d = Math.hypot(n.cx - mx, n.cy - my);
        if (d < radius && n.alive) {
          const ang = Math.atan2(n.cy - my, n.cx - mx);
          const f = (1 - d / radius) * knock * 0.4;
          score += n.hitByBody({ speed: f, mass: 1 + s * 2, vx: Math.cos(ang) * f, vy: Math.sin(ang) * f }, true);
        }
      }
      if (ctx.rival?.alive && Math.hypot(ctx.rival.cx - mx, ctx.rival.cy - my) < radius) {
        ctx.rival.takeDamage(10 + 40 * s);
        score += 10;
      }
      world.addFx({ type: 'ring', x: mx, y: my, r: 8, maxR: radius, life: 0.45, color: '#74b9ff' });
      world.addFx({ type: 'flash', x: mx, y: my, z: 14, intensity: 0.6 + s * 1.6, life: 0.25, color: '#8fc7ff' });
      burst(world.particles, mx, my, Math.round(10 + 24 * s), '#9ccfff', { type: 'psy', speed: 200 + 300 * s });
      dustCloud(world.particles, mx, my, Math.round(4 + 8 * s), { spread: radius * 0.6, speed: 60 + 120 * s });
      sfx.shock();
      this.cancelCharge();
      return { energy: cost, score, tip: `¡Onda de choque! ${Math.round(s * 100)}%`, shake: 3 + 10 * s };
    }

    if (power.id === 'crush' && this.chargeKind === 'crush') {
      let s = this.strength();
      const maxCost = this.effectiveCost(8 + 34 * s, ctx.driving);
      if (ctx.energy < maxCost) s *= Math.max(0.1, ctx.energy / maxCost);
      const cost = this.effectiveCost(8 + 34 * s, ctx.driving);
      const radius = 30 + 45 * s;
      const dmg = 12 + 230 * s;
      let score = world.crushAt(mx, my, radius, dmg, true);
      for (const v of vehicles) {
        if (!v.alive || v === ctx.drivenCar) continue;
        if (Math.hypot(v.cx - mx, v.cy - my) < radius + 10) {
          score += v.applyImpact(80 + 260 * s, world, v.angle, { credit: true, top: true, push: false, force: true });
          score += v.applyImpact(40 + 200 * s, world, v.angle + Math.PI / 2, { credit: true, top: true, push: false, force: true });
        }
      }
      world.addFx({ type: 'ring', x: mx, y: my, r: radius, maxR: 6, life: 0.35, color: '#ff8c69' });
      // v4.2: aplastar con carga fuerte hunde la calle (cráter); si no, grieta
      if (!(s > 0.3 && world.addCrater?.(mx, my, 0.3 + s * 1.7))) world.addRoadCrack(mx, my, 0.6 + s);
      burst(world.particles, mx, my, Math.round(8 + 16 * s), '#e17055', { z: 20 });
      sfx.crush();
      this.cancelCharge();
      return { energy: cost, score, tip: `Aplastamiento psíquico ${Math.round(s * 100)}%`, shake: 3 + 8 * s };
    }

    if (power.id === 'slam' && this.slamPhase === 1) {
      this.slamPower = this.strength();
      this.slamPhase = 2;
      this.cancelCharge();
      if (this.slamTarget) this.slamTarget.vz = -500 - 500 * this.slamPower;
      return { tip: '¡SLAM!' };
    }

    this.cancelCharge();
    return null;
  }

  // ——— Atrapar / congelar ———
  startCatch() { this.catching = true; }
  stopCatch() { this.catching = false; }

  _freeze(b) {
    if (b.frozen || b.grabbed) return false;
    b.frozen = true;
    b.frozenTimer = 5;
    b.vx = 0; b.vy = 0; b.vz = 0;
    if (b.liftZ < 8) b.liftZ = 8;
    b.hostileTouch = 0;
    if (b.kind === 'vehicle') { b.aiDrive = false; b.parked = false; b.static = false; b.rollRate *= 0.1; b.pitchRate *= 0.1; }
    b.playerTouch = 6;
    this.frozen.push(b);
    return true;
  }

  /** Iniciar carga de redirección (si hay congelados) */
  startRedirect() {
    if (!this.frozen.length) return { tip: 'Nada congelado · usa Atrapar (Q / clic der.) primero' };
    this.charging = true; this.charge = 0; this.chargeKind = 'redirect';
    return { tip: `Redirigir ${this.frozen.length} objeto(s) · suelta para lanzar` };
  }

  releaseRedirect(ctx) {
    if (this.chargeKind !== 'redirect') return null;
    const n = this.frozen.length;
    const speed = this.throwSpeed();
    const o = this._origin(ctx);
    for (const b of this.frozen) {
      b.frozen = false;
      if (!b.alive) continue;
      this._launchToward(b, ctx.aimX, ctx.aimY, ctx.aimZ || 0, speed, Math.atan2(ctx.aimY - o.y, ctx.aimX - o.x));
      addParticle(ctx.world.particles, b.cx, b.cy, { z: b.liftZ + 6, type: 'psy', color: '#7ff3ff', size: 6, life: 0.4, vz: 0 });
    }
    this.frozen = [];
    this.cancelCharge();
    sfx.throw();
    return { energy: 4 + n * 3 * this.force, tip: `¡Redirigidos ${n}! ${Math.round(speed * 0.36)} km/h`, shake: Math.min(10, 2 + n) };
  }

  /** Por frame. ctx igual que tryStart. Devuelve resultado (slam) o null. */
  update(dt, ctx, energyRef) {
    const { world, vehicles } = ctx;
    let result = null;
    const o = this._origin(ctx);

    if (this.charging) {
      this.charge = Math.min(1, this.charge + (dt / CHARGE_TIME) * this.chargeRate);
      if (this.chargeKind !== 'tk' && this.charge < 1) energyRef.value = Math.max(0, energyRef.value - 4 * dt);
    }

    // TK: el objeto flota en el punto de agarre entre tú y la mira
    if (this.grabbed && POWERS[this.selected].id === 'tk') {
      const g = this.grabbed;
      const heavy = g.kind === 'vehicle' ? 1.6 : 1;
      const drain = POWERS[0].holdCost * heavy * dt;
      if (!g.alive || energyRef.value < drain) {
        this.releaseGrab();
      } else {
        energyRef.value -= drain;
        const dx = ctx.aimX - o.x, dy = ctx.aimY - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const size = Math.max(g.w, g.h);
        const hd = Math.min(d, 34 + size * 0.8);
        const tx = o.x + dx / d * hd, ty = o.y + dy / d * hd;
        const base = ctx.drivenCar ? 40 : (ctx.camMode === 'fps' ? 9 : 22) + (ctx.player?.z || 0);
        const tz = base + (g.th || 10) * 0.5 + this.charge * 14 + Math.sin(performance.now() * 0.004) * 2;
        this.hold.x = tx; this.hold.y = ty; this.hold.z = tz;
        const k = Math.min(1, 9 * dt / heavy);
        g.x += (tx - g.w / 2 - g.x) * k;
        g.y += (ty - g.h / 2 - g.y) * k;
        g.liftZ += (tz - g.liftZ) * k;
        g.vx = 0; g.vy = 0; g.vz = 0;
        if (g.kind === 'vehicle') {
          g.angle += (Math.atan2(dy, dx) - g.angle) * 0;
          g.roll *= 0.95; g.pitch *= 0.95;
        } else {
          g.tumbleX += dt * 0.8; g.angle += dt * 0.6;
        }
        if (Math.random() < 0.35 + this.charge * 0.5) {
          addParticle(world.particles, g.cx + (Math.random() - 0.5) * g.w, g.cy + (Math.random() - 0.5) * g.h, {
            z: g.liftZ + Math.random() * 10, vx: 0, vy: 0, vz: 10 + this.charge * 30,
            size: 3 + this.charge * 3, life: 0.5, color: this.charge >= 1 ? '#ff9cf0' : '#b9a8ff', type: 'psy',
          });
        }
      }
    }

    // Slam
    if (this.slamPhase === 1 && this.slamTarget) {
      const t = this.slamTarget;
      this.slamTimer -= dt;
      const tz = 30 + this.charge * 110;
      t.liftZ += (tz - t.liftZ) * Math.min(1, 4 * dt);
      t.x += (ctx.aimX - t.w / 2 - t.x) * Math.min(1, 4 * dt);
      t.y += (ctx.aimY - t.h / 2 - t.y) * Math.min(1, 4 * dt);
      t.vx = 0; t.vy = 0;
      if (t.kind === 'vehicle') { t.roll += dt * 0.6; }
      if (this.slamTimer <= 0) {
        this.slamPower = this.strength();
        this.slamPhase = 2;
        this.cancelCharge();
        t.vz = -700;
      }
    } else if (this.slamPhase === 2 && this.slamTarget) {
      const t = this.slamTarget;
      t.vz = Math.min(t.vz, -400) - 1600 * dt;
      t.liftZ = Math.max(0, t.liftZ + t.vz * dt);
      if (t.liftZ <= 0) {
        const s = this.slamPower;
        const impactV = -t.vz;
        t.liftZ = 0; t.vz = 0;
        t.lifted = false; t.grabbed = false;
        t.vx = (Math.random() - 0.5) * 40;
        t.vy = (Math.random() - 0.5) * 40;
        if (t.kind === 'vehicle') { t.roll = 0; t.pitch = 0; t.rollRate = 0; t.pitchRate = 0; }
        const radius = 50 + 70 * s;
        let score = world.applyRadialDamage(t.cx, t.cy, radius, 15 + 75 * s, 200 + 500 * s, true);
        for (const v of vehicles) {
          if (v !== t && v.alive && v !== ctx.drivenCar && Math.hypot(v.cx - t.cx, v.cy - t.cy) < radius + 10) {
            score += v.applyDamage(20 + 60 * s, world, t.cx, t.cy, true);
          }
        }
        for (const n of ctx.npcs || []) {
          const d = Math.hypot(n.cx - t.cx, n.cy - t.cy);
          if (d < radius && n.alive) {
            const ang = Math.atan2(n.cy - t.cy, n.cx - t.cx);
            score += n.hitByBody({ speed: 200 * (1 - d / radius) + 40, mass: 2, vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150 }, true);
          }
        }
        if (t.applyImpact) score += t.applyImpact(120 + 240 * s, world, t.angle, { credit: true, top: true, push: false, force: true });
        world.addFx({ type: 'ring', x: t.cx, y: t.cy, r: 10, maxR: radius * 1.2, life: 0.45, color: '#fdcb6e' });
        world.addFx({ type: 'flash', x: t.cx, y: t.cy, z: 10, intensity: 0.5 + s, life: 0.2, color: '#ffe0a0' });
        // v4.2: cráter real (deforma la calle); si cae sobre un edificio, la marca plana de siempre
        if (!world.addCrater?.(t.cx, t.cy, 0.6 + s * 2.2)) world.addRoadCrack(t.cx, t.cy, 0.9 + s * 1.2, 'crater');
        dustCloud(world.particles, t.cx, t.cy, Math.round(6 + 10 * s), { size: 18, speed: 70 + 100 * s, spread: 20 });
        sparks(world.particles, t.cx, t.cy, 4, Math.round(8 + 12 * s), 260);
        sfx.slam();
        this.slamTarget = null;
        this.slamPhase = 0;
        result = { score, shake: 6 + 12 * s, tip: `¡SLAM! ${Math.round(s * 100)}% · ${Math.round(impactV * 0.36)} km/h` };
      }
    }

    // Campo de captura
    if (this.catching) {
      const drain = 9 * dt;
      if (energyRef.value < drain) { this.catching = false; }
      else {
        energyRef.value -= drain;
        const zones = [{ x: ctx.aimX, y: ctx.aimY, r: 90 }, { x: o.x, y: o.y, r: 75 }];
        const test = (b) => {
          if (!b.alive || b.grabbed || b.frozen || b === ctx.drivenCar || b.driven) return;
          const moving = b.speed > 55 || Math.abs(b.vz || 0) > 60 || (b.liftZ || 0) > 6;
          if (!moving) return;
          for (const z of zones) {
            if (Math.hypot(b.cx - z.x, b.cy - z.y) < z.r) {
              if (this._freeze(b)) {
                energyRef.value = Math.max(0, energyRef.value - 3);
                sparks(world.particles, b.cx, b.cy, b.liftZ + 4, 4, 90, '#8ff7ff');
                sfx.freeze?.();
              }
              return;
            }
          }
        };
        for (const d of world.debris) test(d);
        for (const v of vehicles) test(v);
      }
    }

    // Congelados flotan y luego caen
    if (this.frozen.length) {
      const now = performance.now() * 0.003;
      for (const b of this.frozen) {
        b.frozenTimer -= dt;
        b.vx = 0; b.vy = 0; b.vz = 0;
        b.liftZ += Math.sin(now + b.id) * 0.05;
        if (b.frozenTimer <= 0 || !b.alive) b.frozen = false;
      }
      this.frozen = this.frozen.filter(b => b.frozen && b.alive);
    }

    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    return result;
  }
}
