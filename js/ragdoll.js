/** Ragdolls arcade (maniquíes low-poly, sin gore). Pool + tope para móvil. */
import { Body } from './physics.js';
import { sfx } from './audio.js';

export const RAGDOLL_CAP = { high: 10, medium: 7, low: 4 };
export const RAGDOLL_PART_CAP = { high: 56, medium: 40, low: 24 };

const PARTS = [
  { id: 'torso', w: 9, h: 6, th: 12, mass: 2.2, color: null, oz: 14 },
  { id: 'head',  w: 6, h: 6, th: 6,  mass: 0.7, color: '#d9a982', oz: 24 },
  { id: 'legL',  w: 4, h: 4, th: 10, mass: 0.9, color: null, oz: 5 },
  { id: 'legR',  w: 4, h: 4, th: 10, mass: 0.9, color: null, oz: 5 },
  { id: 'armL',  w: 3, h: 3, th: 8,  mass: 0.5, color: null, oz: 16 },
  { id: 'armR',  w: 3, h: 3, th: 8,  mass: 0.5, color: null, oz: 16 },
];

/** Pool global reutilizado entre sesiones */
const pool = [];
function takeBody(opts) {
  const b = pool.pop() || new Body(opts);
  Object.assign(b, opts);
  b.alive = true; b.static = false; b.grabbed = false; b.frozen = false;
  b.landed = 0; b.age = 0; b.ttl = opts.ttl ?? 14;
  b.kind = 'ragdoll';
  b.data = Object.assign(b.data || {}, opts.data || {}, { ragdoll: true });
  return b;
}
export function releaseRagdollBody(b) {
  b.alive = false;
  if (pool.length < 80) pool.push(b);
}

export class RagdollSystem {
  constructor() {
    this.active = [];       // { parts: Body[], age }
    this.cap = RAGDOLL_CAP.medium;
    this.partCap = RAGDOLL_PART_CAP.medium;
  }
  setQuality(q) {
    this.cap = RAGDOLL_CAP[q] || RAGDOLL_CAP.medium;
    this.partCap = RAGDOLL_PART_CAP[q] || RAGDOLL_PART_CAP.medium;
  }
  get parts() {
    const out = [];
    for (const r of this.active) for (const p of r.parts) if (p.alive) out.push(p);
    return out;
  }
  countParts() {
    let n = 0;
    for (const r of this.active) for (const p of r.parts) if (p.alive) n++;
    return n;
  }

  /** Convierte un NPC en ragdoll. cut=true → dos mitades (torso+cabeza / piernas). */
  spawnFromNpc(npc, { vx = 0, vy = 0, vz = 80, cut = false, credit = false } = {}) {
    if (!npc || !npc.alive) return 0;
    npc.alive = false;
    this._trim();
    const shirt = npc.color || '#7ed6df';
    const pants = npc.pants || '#2d3436';
    const base = { x: npc.cx, y: npc.cy, playerTouch: credit ? 2 : 0 };
    const parts = [];
    const list = cut
      ? PARTS.filter(p => p.id === 'torso' || p.id === 'head' || p.id === 'legL' || p.id === 'legR')
      : PARTS;
    for (const def of list) {
      const col = def.color || (def.id.startsWith('leg') ? pants : shirt);
      const jx = (Math.random() - 0.5) * 8, jy = (Math.random() - 0.5) * 8;
      const cutKick = cut ? (def.id.startsWith('leg') ? -1 : 1) : 0;
      const b = takeBody({
        x: base.x - def.w / 2 + jx, y: base.y - def.h / 2 + jy,
        w: def.w, h: def.h, th: def.th, z: def.oz + (npc.liftZ || 0),
        vx: vx * (0.7 + Math.random() * 0.5) + jx * 4 + cutKick * (40 + Math.random() * 50),
        vy: vy * (0.7 + Math.random() * 0.5) + jy * 4,
        vz: vz * (0.6 + Math.random() * 0.7) + (cut && def.id === 'head' ? 60 : 0),
        mass: def.mass, color: col, spin: (Math.random() - 0.5) * 10,
        friction: 0.88, bounce: 0.25, ttl: 12 + Math.random() * 6,
        playerTouch: credit ? 2 : 0,
        data: { ragdoll: true, part: def.id, cut },
      });
      parts.push(b);
    }
    // Corte: chispas estilizadas (sin sangre)
    this.active.push({ parts, age: 0 });
    this._trim();
    try { sfx.hit(); } catch (_) {}
    return cut ? 25 : 15;
  }

  /** Corte láser de un ragdoll ya suelto o de un NPC vivo. */
  cutAt(x, y, z, npcs, credit = false) {
    let score = 0;
    for (const n of npcs) {
      if (!n.alive) continue;
      if (Math.hypot(n.cx - x, n.cy - y) < 12 && Math.abs((n.liftZ || 0) + 12 - z) < 22) {
        score += this.spawnFromNpc(n, { vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, vz: 100, cut: true, credit });
      }
    }
    // Partir ragdolls existentes cerca del haz
    for (const r of this.active) {
      if (r.cutDone) continue;
      const torso = r.parts.find(p => p.data?.part === 'torso' && p.alive);
      if (!torso) continue;
      if (Math.hypot(torso.cx - x, torso.cy - y) < 14 && Math.abs(torso.liftZ - z) < 20) {
        r.cutDone = true;
        for (const p of r.parts) {
          if (!p.alive) continue;
          const up = p.data?.part === 'head' || p.data?.part === 'torso' || (p.data?.part || '').startsWith('arm');
          p.vx += up ? 55 : -55;
          p.vz += 40 + Math.random() * 40;
          p.spin += (Math.random() - 0.5) * 8;
        }
        score += credit ? 8 : 0;
      }
    }
    return score;
  }

  update(dt, world) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const r = this.active[i];
      r.age += dt;
      let alive = 0;
      for (const p of r.parts) {
        if (!p.alive) continue;
        if (p.ttl < Infinity) { p.ttl -= dt; if (p.ttl <= 0) { p.alive = false; releaseRagdollBody(p); continue; } }
        alive++;
      }
      if (!alive || r.age > 18) {
        for (const p of r.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
        this.active.splice(i, 1);
      }
    }
  }

  _trim() {
    while (this.active.length > this.cap) {
      const old = this.active.shift();
      for (const p of old.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
    }
    while (this.countParts() > this.partCap && this.active.length) {
      const old = this.active.shift();
      for (const p of old.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
    }
  }

  clear() {
    for (const r of this.active) for (const p of r.parts) if (p.alive) releaseRagdollBody(p);
    this.active.length = 0;
  }
}
