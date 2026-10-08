/**
 * Física 2.5D: cuerpos en el plano XY (px) + altura liftZ con gravedad.
 * 1 px de mundo = 0.1 m en el render 3D.
 */

export const GRAVITY = 320;          // px/s² (arcade, ~3g para arcos ágiles)
export const MAX_PARTICLES = 1800;

export function vec(x = 0, y = 0) { return { x, y }; }
export function len(v) { return Math.hypot(v.x, v.y); }
export function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Color CSS → {r,g,b} 0..1 (cacheado) */
const _colorCache = new Map();
export function parseColor(c) {
  if (typeof c !== 'string') return { r: 0.6, g: 0.6, b: 0.6 };
  let v = _colorCache.get(c);
  if (v) return v;
  let r = 0.6, g = 0.6, b = 0.6;
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').slice(0, 3).map(ch => ch + ch).join('');
    h = h.slice(0, 6);
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
  } else if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g) || [];
    r = (+m[0] || 0) / 255; g = (+m[1] || 0) / 255; b = (+m[2] || 0) / 255;
  }
  v = { r, g, b };
  _colorCache.set(c, v);
  return v;
}

let _bodyId = 1;

export class Body {
  constructor(opts = {}) {
    this.id = _bodyId++;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.w = opts.w || 16;
    this.h = opts.h || 16;
    this.th = opts.th || Math.min(this.w, this.h) * 0.8; // grosor 3D
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.vz = opts.vz || 0;
    this.liftZ = opts.z || 0;     // altura sobre el suelo (px)
    this.mass = opts.mass || 1;
    this.friction = opts.friction ?? 0.92;
    this.bounce = opts.bounce ?? 0.35;
    this.alive = true;
    this.static = !!opts.static;
    this.kind = opts.kind || 'debris';
    this.hp = opts.hp ?? 1;
    this.maxHp = opts.maxHp ?? this.hp;
    this.color = opts.color || '#888';
    this.angle = opts.angle || 0;
    this.spin = opts.spin || 0;
    this.tumbleX = Math.random() * 6;
    this.tumbleZ = Math.random() * 6;
    this.tumbleRate = (Math.random() - 0.5) * 8;
    this.grabbed = false;
    this.lifted = false;
    this.frozen = false;
    this.frozenTimer = 0;
    this.playerTouch = opts.playerTouch || 0;   // >0: crédito al jugador
    this.hostileTouch = 0;                      // >0: lanzado por rival
    this.data = opts.data || {};
    this.damageOnHit = opts.damageOnHit || 0;
    this.ttl = opts.ttl ?? Infinity;
    this.landed = 0;
    this.age = 0;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get airborne() { return this.liftZ > 0.5; }

  aabb() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }
}

export function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circleHitAABB(cx, cy, r, box) {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w));
  const ny = Math.max(box.y, Math.min(cy, box.y + box.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

/** Integra un cuerpo libre (no agarrado/congelado). */
export function stepBody(b, dt, worldBounds) {
  b.age += dt;
  if (b.playerTouch > 0) b.playerTouch -= dt;
  if (b.hostileTouch > 0) b.hostileTouch -= dt;
  if (b.static || b.grabbed || b.frozen) return;
  if (b.lifted) {
    b.vx *= 0.9; b.vy *= 0.9;
    return;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.angle += b.spin * dt;

  // Vertical
  b.landed = 0;
  if (b.liftZ > 0 || b.vz > 0) {
    b.vz -= GRAVITY * dt;
    b.liftZ += b.vz * dt;
    b.tumbleX += b.tumbleRate * dt;
    b.tumbleZ += b.tumbleRate * 0.7 * dt;
    if (b.liftZ <= 0) {
      const impact = -b.vz;
      b.liftZ = 0;
      b.landed = impact;
      b.vz = impact > 80 ? impact * b.bounce * 0.45 : 0;
      if (b.vz === 0) {
        // asentar: caer plano
        b.tumbleX = Math.round(b.tumbleX / (Math.PI / 2)) * (Math.PI / 2);
        b.tumbleZ = Math.round(b.tumbleZ / (Math.PI / 2)) * (Math.PI / 2);
      }
      b.vx *= 0.8; b.vy *= 0.8;
    }
    // poco arrastre en el aire
    b.vx *= Math.pow(0.997, dt * 60);
    b.vy *= Math.pow(0.997, dt * 60);
  } else {
    b.vx *= Math.pow(b.friction, dt * 60);
    b.vy *= Math.pow(b.friction, dt * 60);
  }
  b.spin *= Math.pow(0.95, dt * 60);

  if (worldBounds) {
    if (b.x < worldBounds.x) { b.x = worldBounds.x; b.vx = Math.abs(b.vx) * b.bounce; }
    if (b.y < worldBounds.y) { b.y = worldBounds.y; b.vy = Math.abs(b.vy) * b.bounce; }
    if (b.x + b.w > worldBounds.x + worldBounds.w) {
      b.x = worldBounds.x + worldBounds.w - b.w;
      b.vx = -Math.abs(b.vx) * b.bounce;
    }
    if (b.y + b.h > worldBounds.y + worldBounds.h) {
      b.y = worldBounds.y + worldBounds.h - b.h;
      b.vy = -Math.abs(b.vy) * b.bounce;
    }
  }

  if (b.liftZ <= 0 && b.speed < 2) { b.vx *= 0.8; b.vy *= 0.8; }
  b.ttl -= dt;
  if (b.ttl <= 0) b.alive = false;
}

export function resolveBodies(a, b) {
  if (!aabbOverlap(a, b)) return false;
  const dx = a.cx - b.cx, dy = a.cy - b.cy;
  const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
  const overlapY = (a.h + b.h) / 2 - Math.abs(dy);
  if (overlapX < overlapY) {
    const s = dx < 0 ? -1 : 1;
    const push = overlapX / 2;
    if (!a.static && !a.grabbed) a.x += s * push;
    if (!b.static && !b.grabbed) b.x -= s * push;
    const rv = a.vx - b.vx;
    if (!a.static) a.vx -= rv * 0.4;
    if (!b.static) b.vx += rv * 0.4;
  } else {
    const s = dy < 0 ? -1 : 1;
    const push = overlapY / 2;
    if (!a.static && !a.grabbed) a.y += s * push;
    if (!b.static && !b.grabbed) b.y -= s * push;
    const rv = a.vy - b.vy;
    if (!a.static) a.vy -= rv * 0.4;
    if (!b.static) b.vy += rv * 0.4;
  }
  return true;
}

/**
 * Partícula 3D (px). type: chip | dust | smoke | fire | spark | glass | water | psy
 * Los tipos fire/spark/psy se dibujan con mezcla aditiva.
 */
export class Particle {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.z = opts.z ?? 4;
    this.vx = opts.vx ?? (Math.random() - 0.5) * 80;
    this.vy = opts.vy ?? (Math.random() - 0.5) * 80;
    this.vz = opts.vz ?? 20 + Math.random() * 60;
    this.life = opts.life ?? 0.5 + Math.random() * 0.5;
    this.maxLife = this.life;
    this.size = opts.size ?? 2 + Math.random() * 4;   // px de mundo
    this.grow = opts.grow ?? 0;                        // px/s
    this.color = opts.color || '#c4a882';
    this.type = opts.type || 'chip';
    this.gravity = opts.gravity ?? (this.type === 'chip' || this.type === 'glass' || this.type === 'spark' || this.type === 'water' ? 1 : 0);
    this.drag = opts.drag ?? 0.96;
    this.alpha = opts.alpha ?? 1;
    this.alive = true;
    const c = parseColor(this.color);
    this.r = c.r; this.g = c.g; this.b = c.b;
  }
  get additive() { return this.type === 'fire' || this.type === 'spark' || this.type === 'psy'; }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    const d = Math.pow(this.drag, dt * 60);
    this.vx *= d; this.vy *= d;
    if (this.gravity) this.vz -= GRAVITY * this.gravity * dt;
    else this.vz *= d;
    if (this.z < 0) {
      this.z = 0;
      if (this.gravity) { this.vz = -this.vz * 0.3; this.vx *= 0.6; this.vy *= 0.6; }
    }
    this.size += this.grow * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
}

/** Presupuesto dinámico de partículas (calidad / FPS). Nunca supera MAX_PARTICLES. */
let PARTICLE_BUDGET = MAX_PARTICLES;
export function setParticleBudget(n) { PARTICLE_BUDGET = Math.max(200, Math.min(MAX_PARTICLES, n | 0)); }
export function particleBudget() { return PARTICLE_BUDGET; }

function canAdd(particles, n = 1) {
  return particles.length + n <= PARTICLE_BUDGET;
}

export function addParticle(particles, x, y, opts) {
  if (!canAdd(particles)) return null;
  const p = new Particle(x, y, opts);
  particles.push(p);
  return p;
}

/** Esquirlas pequeñas (compatibilidad con la API previa) */
export function burst(particles, x, y, n, color, opts = {}) {
  const z = opts.z ?? 6;
  const spd = opts.speed ?? 160;
  for (let i = 0; i < n; i++) {
    if (!canAdd(particles)) return;
    particles.push(new Particle(x, y, {
      z: z + Math.random() * (opts.zSpread ?? 6),
      color: color || (Math.random() > 0.5 ? '#c4a882' : '#8b7355'),
      vx: (Math.random() - 0.5) * spd,
      vy: (Math.random() - 0.5) * spd,
      vz: 30 + Math.random() * (opts.up ?? 110),
      size: 1.5 + Math.random() * 3.5,
      type: opts.type || 'chip',
      life: 0.6 + Math.random() * 0.7,
    }));
  }
}

export function dustCloud(particles, x, y, n = 8, opts = {}) {
  const z = opts.z ?? 4;
  const spread = opts.spread ?? 20;
  for (let i = 0; i < n; i++) {
    if (!canAdd(particles)) return;
    const a = Math.random() * Math.PI * 2;
    const s = (opts.speed ?? 40) * (0.3 + Math.random());
    particles.push(new Particle(
      x + Math.cos(a) * Math.random() * spread,
      y + Math.sin(a) * Math.random() * spread, {
        z: z + Math.random() * (opts.zSpread ?? 8),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        vz: 6 + Math.random() * (opts.rise ?? 18),
        size: (opts.size ?? 14) * (0.6 + Math.random() * 0.8),
        grow: opts.grow ?? 18,
        life: (opts.life ?? 1.8) * (0.6 + Math.random() * 0.6),
        color: opts.color || (Math.random() > 0.5 ? '#9c9187' : '#b3a898'),
        type: 'dust', drag: 0.95, alpha: opts.alpha ?? 0.55,
      }));
  }
}

export function smokePuff(particles, x, y, z, opts = {}) {
  return addParticle(particles, x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, {
    z, vx: (Math.random() - 0.5) * 12 + (opts.wind ?? 6), vy: (Math.random() - 0.5) * 12,
    vz: 20 + Math.random() * 25, size: opts.size ?? 7, grow: opts.grow ?? 14,
    life: opts.life ?? 1.6, color: opts.color || '#3a3a3a', type: 'smoke', drag: 0.97,
    alpha: opts.alpha ?? 0.6,
  });
}

export function fireBurst(particles, x, y, z, n = 10, scale = 1) {
  for (let i = 0; i < n; i++) {
    if (!canAdd(particles)) return;
    const a = Math.random() * Math.PI * 2;
    const s = (30 + Math.random() * 120) * scale;
    particles.push(new Particle(x, y, {
      z: z + Math.random() * 6,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 30 + Math.random() * 90 * scale,
      size: (8 + Math.random() * 10) * scale, grow: 10 * scale,
      life: 0.35 + Math.random() * 0.45,
      color: Math.random() > 0.4 ? '#ff8a2a' : '#ffd36b', type: 'fire', drag: 0.9,
    }));
  }
}

export function sparks(particles, x, y, z, n = 10, speed = 220, color = '#ffd36b') {
  for (let i = 0; i < n; i++) {
    if (!canAdd(particles)) return;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random());
    particles.push(new Particle(x, y, {
      z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40 + Math.random() * 140,
      size: 1.2 + Math.random() * 1.6, life: 0.3 + Math.random() * 0.4,
      color, type: 'spark', drag: 0.97,
    }));
  }
}

export function glassShards(particles, x, y, z, n = 8) {
  for (let i = 0; i < n; i++) {
    if (!canAdd(particles)) return;
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 120;
    particles.push(new Particle(x, y, {
      z: z + Math.random() * 10,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: Math.random() * 80,
      size: 1.2 + Math.random() * 2, life: 0.9 + Math.random() * 0.6,
      color: Math.random() > 0.5 ? '#bfe6ff' : '#e8f7ff', type: 'glass',
    }));
  }
}
