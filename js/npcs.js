/** Civiles, rival psíquico, oleadas hostiles (tono arcade, sin gore) */

import { burst, dustCloud, aabbOverlap } from './physics.js';
import { Vehicle } from './vehicles.js';
import { impactDamage } from './world.js';
import { sfx } from './audio.js';

const NPC_COLORS = ['#f6e58d', '#ff7979', '#7ed6df', '#e056fd', '#dfe6e9', '#badc58', '#f0932b', '#686de0', '#ffffff', '#30336b'];

export class NPC {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.w = 8; this.h = 8;
    this.vx = 0; this.vy = 0;
    this.liftZ = 0; this.vz = 0;
    this.speed = 32 + Math.random() * 18;
    this.color = opts.color || NPC_COLORS[Math.floor(Math.random() * NPC_COLORS.length)];
    this.pants = Math.random() > 0.5 ? '#2d3436' : '#34495e';
    this.alive = true;
    this.fleeing = false;
    this.fleeTimer = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.hostile = !!opts.hostile;
    this.hp = opts.hp || (opts.hostile ? 40 : 20);
    this.maxHp = this.hp;
    this.knocked = 0;
    this.panicScore = 0;
    this.kind = 'npc';
    this.walkPhase = Math.random() * 10;
    this.facing = this.wanderAngle;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  aabb() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  alert(cx, cy, radius) {
    if (this.hostile) return;
    const d = Math.hypot(this.cx - cx, this.cy - cy);
    if (d < radius) {
      if (!this.fleeing) sfx.flee();
      this.fleeing = true;
      this.fleeTimer = 2.5 + Math.random();
      this.wanderAngle = Math.atan2(this.cy - cy, this.cx - cx);
    }
  }

  update(dt, world, player, hostilesTarget) {
    if (!this.alive) return;
    if (this.knocked > 0) {
      this.knocked -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vz -= 320 * dt;
      this.liftZ = Math.max(0, this.liftZ + this.vz * dt);
      if (this.liftZ === 0) { this.vx *= 0.85; this.vy *= 0.85; this.vz = 0; }
      world.resolveStructures(this);
      this._clamp(world);
      if (this.knocked <= 0 && this.hp <= 0) this.alive = false;
      return;
    }

    let spd = 0;
    if (this.hostile && hostilesTarget) {
      const ang = Math.atan2(hostilesTarget.y - this.cy, hostilesTarget.x - this.cx);
      this.vx = Math.cos(ang) * this.speed * 1.6;
      this.vy = Math.sin(ang) * this.speed * 1.6;
      spd = 1.6;
    } else if (this.fleeing) {
      this.fleeTimer -= dt;
      this.vx = Math.cos(this.wanderAngle) * this.speed * 2.2;
      this.vy = Math.sin(this.wanderAngle) * this.speed * 2.2;
      if (this.fleeTimer <= 0) this.fleeing = false;
      this.panicScore += dt;
      spd = 2.2;
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderAngle += (Math.random() - 0.5) * 1.5;
        this.wanderTimer = 1 + Math.random() * 2;
      }
      this.vx = Math.cos(this.wanderAngle) * this.speed * 0.6;
      this.vy = Math.sin(this.wanderAngle) * this.speed * 0.6;
      spd = 0.6;
    }
    this.walkPhase += dt * (4 + spd * 4);
    this.facing = Math.atan2(this.vy, this.vx);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const hit = world.resolveStructures(this);
    if (hit && !this.hostile) this.wanderAngle += Math.PI * (0.5 + Math.random() * 0.5);
    this._clamp(world);
  }

  _clamp(world) {
    const x0 = world.minX ?? 0, y0 = world.minY ?? 0;
    if (this.x < x0 + 8) { this.x = x0 + 8; this.wanderAngle = Math.PI - this.wanderAngle; }
    if (this.y < y0 + 8) { this.y = y0 + 8; this.wanderAngle = -this.wanderAngle; }
    if (this.x > world.w - 16) { this.x = world.w - 16; this.wanderAngle = Math.PI - this.wanderAngle; }
    if (this.y > world.h - 16) { this.y = world.h - 16; this.wanderAngle = -this.wanderAngle; }
  }

  /** Golpe por cualquier cuerpo (escombro o auto): daño = masa × velocidad */
  hitByBody(body, credit = false) {
    const spd = body.speed;
    if (spd < 35 || this.knocked > 0.2) return 0;
    const dmg = impactDamage(body.mass, spd) * 0.8;
    this.hp -= dmg;
    this.vx = body.vx * 0.6 + (Math.random() - 0.5) * 40;
    this.vy = body.vy * 0.6 + (Math.random() - 0.5) * 40;
    this.vz = 60 + Math.min(200, spd * 0.3);
    this.knocked = 0.9;
    this.fleeing = true;
    this.fleeTimer = 3;
    this.wanderAngle = Math.atan2(this.vy, this.vx);
    sfx.hit();
    if (this.hp <= 0) {
      // v6: KO → ragdoll (el juego lo convierte); sin gore
      this._wantRagdoll = { vx: this.vx, vy: this.vy, vz: this.vz, credit };
      return credit ? 15 : 0;
    }
    return credit ? 5 : 0;
  }
  hitByDebris(body) { return this.hitByBody(body, body.playerTouch > 0); }
}

export class RivalPsychic {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 12; this.h = 12;
    this.vx = 0; this.vy = 0;
    this.liftZ = 0;
    this.hp = 150;
    this.maxHp = 150;
    this.energy = 100;
    this.maxEnergy = 100;
    this.alive = true;
    this.state = 'hunt';
    this.stateTimer = 0;
    this.grabbed = null;
    this.color = '#e84393';
    this.kind = 'rival';
    this.speed = 95;
    this.scoreDealt = 0;
    this.walkPhase = 0;
    this.facing = 0;
    this.shockFlash = 0;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  aabb() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  update(dt, world, vehicles, player) {
    if (!this.alive) return;
    this.energy = Math.min(this.maxEnergy, this.energy + 12 * dt);
    this.stateTimer -= dt;
    if (this.shockFlash > 0) this.shockFlash -= dt;
    const toPlayer = Math.hypot(player.x - this.cx, player.y - this.cy);

    if (this.stateTimer <= 0) {
      if (this.hp < 40) this.state = 'flee';
      else if (toPlayer < 150 && this.energy > 30) this.state = Math.random() > 0.5 ? 'shock' : 'hunt';
      else this.state = Math.random() > 0.35 ? 'grab' : 'hunt';
      this.stateTimer = 1.2 + Math.random() * 1.5;
    }

    if (this.grabbed && (!this.grabbed.alive || this.grabbed.grabbed !== 'rival')) this.grabbed = null;

    if (this.state === 'flee') {
      const ang = Math.atan2(this.cy - player.y, this.cx - player.x);
      this.vx = Math.cos(ang) * this.speed;
      this.vy = Math.sin(ang) * this.speed;
    } else if (this.state === 'hunt') {
      const ang = Math.atan2(player.y - this.cy, player.x - this.cx);
      const want = toPlayer > 110 ? 0.85 : -0.3;
      this.vx = Math.cos(ang) * this.speed * want;
      this.vy = Math.sin(ang) * this.speed * want;
    } else if (this.state === 'grab') {
      if (!this.grabbed) {
        const t = world.findGrabbableNear(this.cx, this.cy, 140, vehicles.filter(v => v.alive && !v.driven && !v.grabbed));
        if (t && this.energy > 15) {
          this.grabbed = t;
          t.grabbed = 'rival';
          t.frozen = false;
          this.energy -= 15;
          sfx.grab();
        }
      } else {
        const ang = Math.atan2(player.y - this.cy, player.x - this.cx);
        const g = this.grabbed;
        const tx = this.cx + Math.cos(ang) * 34, ty = this.cy + Math.sin(ang) * 34;
        g.x += (tx - g.w / 2 - g.x) * Math.min(1, 8 * dt);
        g.y += (ty - g.h / 2 - g.y) * Math.min(1, 8 * dt);
        g.liftZ += (32 - g.liftZ) * Math.min(1, 6 * dt);
        g.vx = 0; g.vy = 0; g.vz = 0;
        if (this.stateTimer < 0.3 && this.energy > 10) {
          g.grabbed = false;
          const s = 360;
          const t = toPlayer / s;
          g.vx = Math.cos(ang) * s;
          g.vy = Math.sin(ang) * s;
          g.vz = Math.max(-40, Math.min(200, (0.5 * 320 * t * t - g.liftZ) / Math.max(0.1, t)));
          if (g.kind === 'vehicle') g.launch(g.vx, g.vy, g.vz, false);
          g.hostileTouch = 3;
          g.playerTouch = 0;
          this.energy -= 10;
          sfx.throw();
          this.grabbed = null;
          this.state = 'hunt';
        }
      }
      this.vx *= 0.9; this.vy *= 0.9;
    } else if (this.state === 'shock') {
      if (this.energy > 25) {
        this.energy -= 25;
        const sc = world.applyRadialDamage(this.cx, this.cy, 100, 28, 280, false);
        this.scoreDealt += sc;
        for (const v of vehicles) {
          const d = Math.hypot(v.cx - this.cx, v.cy - this.cy);
          if (d < 100) v.applyDamage(20, world, this.cx, this.cy, false);
        }
        world.addFx({ type: 'ring', x: this.cx, y: this.cy, r: 8, maxR: 100, life: 0.4, color: '#e84393' });
        burst(world.particles, this.cx, this.cy, 14, '#e84393', { type: 'psy' });
        this.shockFlash = 0.3;
        sfx.shock();
        this.state = 'hunt';
        this.stateTimer = 1.5;
      }
    }

    this.walkPhase += dt * Math.hypot(this.vx, this.vy) * 0.08;
    if (Math.hypot(this.vx, this.vy) > 5) this.facing = Math.atan2(this.vy, this.vx);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    world.resolveStructures(this);
    this.x = Math.max(10, Math.min(world.w - 30, this.x));
    this.y = Math.max(10, Math.min(world.h - 30, this.y));
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false; this.hp = 0;
      if (this.grabbed) { this.grabbed.grabbed = false; this.grabbed = null; }
    }
  }
}

function findSidewalkSpot(world) {
  for (let t = 0; t < 20; t++) {
    const sw = world.sidewalks[Math.floor(Math.random() * world.sidewalks.length)];
    const x = sw.x + Math.random() * Math.max(10, sw.w - 10);
    const y = sw.y + Math.random() * Math.max(2, sw.h - 8);
    const x0 = world.minX ?? 0, y0 = world.minY ?? 0;
    if (x > x0 + 10 && y > y0 + 10 && x < world.w - 20 && y < world.h - 20) return { x, y };
  }
  return { x: world.spawn.x + 40, y: world.spawn.y };
}

export function spawnCivilians(world, n = 30) {
  const x0 = world.minX ?? 0, y0 = world.minY ?? 0;
  const list = [];
  for (let i = 0; i < n; i++) {
    const { x, y } = findSidewalkSpot(world);
    list.push(new NPC(x, y));
  }
  // algunos en la plaza
  for (let i = 0; i < 6; i++) {
    list.push(new NPC(world.spawn.x + (Math.random() - 0.5) * 160, world.spawn.y + (Math.random() - 0.5) * 160));
  }
  return list;
}

export function spawnHostileWave(world, wave, player) {
  const list = [];
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const dist = 280 + Math.random() * 80;
    const x = Math.max(20, Math.min(world.w - 20, player.x + Math.cos(ang) * dist));
    const y = Math.max(20, Math.min(world.h - 20, player.y + Math.sin(ang) * dist));
    const n = new NPC(x, y, { hostile: true, hp: 30 + wave * 8 });
    world.resolveStructures(n);
    list.push(n);
  }
  const cars = [];
  for (let i = 0; i < Math.min(2 + Math.floor(wave / 2), 4); i++) {
    const ang = Math.random() * Math.PI * 2;
    const x = Math.max(40, Math.min(world.w - 40, player.x + Math.cos(ang) * 320));
    const y = Math.max(40, Math.min(world.h - 40, player.y + Math.sin(ang) * 320));
    const v = new Vehicle(x, y, { angle: ang + Math.PI, aiDrive: true, hostile: true, color: '#8b1a1a', stripes: true, style: 'muscle' });
    cars.push(v);
  }
  return { npcs: list, cars };
}

export { dustCloud, aabbOverlap };
