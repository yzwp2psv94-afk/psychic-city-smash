/**
 * Maniquíes de choque articulados (estilo GTA IV / crash-test), sin gore.
 * - Articulaciones visibles (esferas) en cuello, hombros, codos, caderas, rodillas
 * - TK: cuelgan y se balancean del torso
 * - Láser: corta en una articulación; la pieza cae y el muñón queda
 * Física propia; no copia código ni assets de ningún juego.
 */
import { Body } from './physics.js';
import { sfx } from './audio.js';

/** SFX de maniquí (js/sfx.js → window.SFX). Nunca lanza si falta. */
function playSfx(name, arg) {
  const S = typeof window !== 'undefined' ? window.SFX : null;
  if (S && typeof S[name] === 'function') {
    try { arg === undefined ? S[name]() : S[name](arg); } catch (_) {}
  }
}

export const RAGDOLL_CAP = { high: 10, medium: 7, low: 4 };
export const RAGDOLL_PART_CAP = { high: 64, medium: 44, low: 28 };

/**
 * Piezas + ancla relativa al padre (px). parent=null → torso.
 * joint: radio de la bola visible.
 */
const PART_DEFS = [
  // Escala dummy: 1 m = 10 px. Posición del body = pivote proximal (como el GLB).
  { id: 'torso', parent: null, w: 8, h: 6, th: 12, mass: 2.6, color: null, oz: 9.5, anchor: { x: 0, y: 0, z: 0 }, joint: 0 },
  { id: 'head', parent: 'torso', w: 5, h: 5, th: 5.5, mass: 0.7, color: '#e8c4a0', oz: 15, anchor: { x: 0, y: 0, z: 5.5 }, joint: 2.0 },
  { id: 'armLU', parent: 'torso', w: 3, h: 3, th: 5.5, mass: 0.4, color: null, oz: 14.3, anchor: { x: -2.15, y: 0, z: 4.8 }, joint: 1.8 },
  { id: 'armLL', parent: 'armLU', w: 2.8, h: 2.8, th: 6, mass: 0.35, color: null, oz: 14.3, anchor: { x: -2.85, y: 0, z: 0 }, joint: 1.5 },
  { id: 'armRU', parent: 'torso', w: 3, h: 3, th: 5.5, mass: 0.4, color: null, oz: 14.3, anchor: { x: 2.15, y: 0, z: 4.8 }, joint: 1.8 },
  { id: 'armRL', parent: 'armRU', w: 2.8, h: 2.8, th: 6, mass: 0.35, color: null, oz: 14.3, anchor: { x: 2.85, y: 0, z: 0 }, joint: 1.5 },
  { id: 'legLU', parent: 'torso', w: 3.5, h: 3.5, th: 7, mass: 0.7, color: null, oz: 9.2, anchor: { x: -1.0, y: 0, z: -0.3 }, joint: 2.0 },
  { id: 'legLL', parent: 'legLU', w: 3.2, h: 3.2, th: 7, mass: 0.55, color: null, oz: 5.1, anchor: { x: 0, y: 0, z: -4.1 }, joint: 1.6 },
  { id: 'legRU', parent: 'torso', w: 3.5, h: 3.5, th: 7, mass: 0.7, color: null, oz: 9.2, anchor: { x: 1.0, y: 0, z: -0.3 }, joint: 2.0 },
  { id: 'legRL', parent: 'legRU', w: 3.2, h: 3.2, th: 7, mass: 0.55, color: null, oz: 5.1, anchor: { x: 0, y: 0, z: -4.1 }, joint: 1.6 },
];

/** Qué hijos se sueltan al cortar cada articulación */
const SEVER_CHILDREN = {
  head: ['head'],
  armLU: ['armLU', 'armLL'],
  armLL: ['armLL'],
  armRU: ['armRU', 'armRL'],
  armRL: ['armRL'],
  legLU: ['legLU', 'legLL'],
  legLL: ['legLL'],
  legRU: ['legRU', 'legRL'],
  legRL: ['legRL'],
};

const pool = [];
function takeBody(opts) {
  const b = pool.pop() || new Body(opts);
  Object.assign(b, opts);
  b.alive = true; b.static = false; b.grabbed = false; b.frozen = false; b.lifted = false;
  b.landed = 0; b.age = 0; b.ttl = opts.ttl ?? 16;
  b.kind = 'ragdoll';
  b.data = Object.assign(b.data || {}, opts.data || {}, { ragdoll: true });
  return b;
}
export function releaseRagdollBody(b) {
  b.alive = false; b.grabbed = false;
  if (pool.length < 100) pool.push(b);
}

function colorFor(def, shirt, pants) {
  if (def.color) return def.color;
  if (def.id.startsWith('leg')) return pants;
  return shirt;
}

export class RagdollSystem {
  constructor() {
    this.active = [];
    this.cap = RAGDOLL_CAP.medium;
    this.partCap = RAGDOLL_PART_CAP.medium;
    this.joints = []; // {x,y,z,r,color} para el renderer
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

  /** Crea maniquí articulado. held=true → torso agarrable (TK). */
  spawnFromNpc(npc, { vx = 0, vy = 0, vz = 80, cut = false, credit = false, held = false } = {}) {
    if (!npc || !npc.alive) return held ? null : 0;
    npc.alive = false;
    this._trim();
    const shirt = npc.color || '#7ed6df';
    const pants = npc.pants || '#2d3436';
    const baseX = npc.cx, baseY = npc.cy, baseZ = npc.liftZ || 0;
    const byId = {};
    const parts = [];
    const defs = cut
      ? PART_DEFS.filter(d => d.id === 'torso' || d.id === 'head' || d.id.startsWith('leg'))
      : PART_DEFS;
    // Colocar cada body en su pivote proximal (coords mundo, como el GLB)
    const worldPos = { torso: { x: baseX, y: baseY, z: (PART_DEFS[0].oz) + baseZ } };
    for (const def of defs) {
      if (def.id === 'torso') continue;
      const parent = def.parent ? worldPos[def.parent] : worldPos.torso;
      const a = def.anchor || { x: 0, y: 0, z: 0 };
      worldPos[def.id] = {
        x: parent.x + a.x,
        y: parent.y + (a.y || 0),
        z: parent.z + a.z,
      };
    }
    for (const def of defs) {
      const col = colorFor(def, shirt, pants);
      const jx = held ? 0 : (Math.random() - 0.5) * 4;
      const jy = held ? 0 : (Math.random() - 0.5) * 4;
      const cutKick = cut ? (def.id.startsWith('leg') ? -1 : def.id === 'head' ? 1 : 0) : 0;
      const wp = worldPos[def.id] || { x: baseX, y: baseY, z: def.oz + baseZ };
      const b = takeBody({
        x: wp.x - def.w / 2 + jx,
        y: wp.y - def.h / 2 + jy,
        w: def.w, h: def.h, th: def.th,
        z: Math.max(0.5, wp.z),
        vx: held ? 0 : vx * (0.65 + Math.random() * 0.5) + jx * 2 + cutKick * (40 + Math.random() * 40),
        vy: held ? 0 : vy * (0.65 + Math.random() * 0.5) + jy * 2,
        vz: held ? 0 : vz * (0.55 + Math.random() * 0.7) + (cut && def.id === 'head' ? 55 : 0),
        mass: def.mass, color: col,
        spin: held ? 0 : (Math.random() - 0.5) * 9,
        friction: 0.88, bounce: 0.3,
        ttl: held ? Infinity : 13 + Math.random() * 6,
        playerTouch: credit ? 2 : 0,
        data: {
          ragdoll: true, part: def.id, parent: def.parent, anchor: def.anchor,
          jointR: def.joint, cut, shirt, pants, glb: true,
        },
      });
      byId[def.id] = b;
      parts.push(b);
    }
    const torso = byId.torso;
    const r = {
      parts, byId, age: 0, held: !!held, torso, shirt, pants,
      cutDone: !!cut, swing: Math.random() * 10, severed: new Set(),
    };
    if (held && torso) {
      torso.grabbed = true;
      torso.kind = 'ragdoll';
      torso._ragdoll = r;
    }
    this.active.push(r);
    this._trim();
    playSfx('ragdollClatter');
    try { sfx.hit(); } catch (_) {}
    return held ? torso : (cut ? 25 : 15);
  }

  tryGrabNpc(npcs, x, y, radius) {
    let best = null, bestD = radius;
    for (const n of npcs) {
      if (!n.alive) continue;
      const d = Math.hypot(n.cx - x, n.cy - y);
      if (d < bestD) { best = n; bestD = d; }
    }
    if (!best) return null;
    return this.spawnFromNpc(best, { held: true, credit: true, vz: 0 });
  }

  /**
   * Corte láser en articulación: suelta la rama de piezas.
   * Si apunta a un NPC vivo → lo convierte y corta a la vez.
   */
  cutAt(x, y, z, npcs, credit = false) {
    let score = 0;
    for (const n of npcs) {
      if (!n.alive) continue;
      if (Math.hypot(n.cx - x, n.cy - y) < 12 && Math.abs((n.liftZ || 0) + 12 - z) < 24) {
        const torso = this.spawnFromNpc(n, { held: false, cut: false, credit, vz: 40 });
        // spawnFromNpc returns score number when not held
        score += typeof torso === 'number' ? torso : 15;
        // cortar brazo o pierna al azar cerca del haz
        const r = this.active[this.active.length - 1];
        if (r) score += this._severJoint(r, this._pickJointNear(r, z), credit);
      }
    }
    for (const r of this.active) {
      if (r.held) continue;
      const torso = r.torso;
      if (!torso?.alive) continue;
      if (Math.hypot(torso.cx - x, torso.cy - y) > 16) continue;
      if (Math.abs(torso.liftZ - z) > 28) continue;
      const jid = this._pickJointNear(r, z);
      score += this._severJoint(r, jid, credit);
    }
    return score;
  }

  _pickJointNear(r, z) {
    // altura relativa: cabeza alta, brazos medios, piernas bajas
    const tz = r.torso?.liftZ || 14;
    const rel = z - (tz - 14);
    if (rel > 18) return 'head';
    if (rel > 8) return Math.random() > 0.5 ? 'armLU' : 'armRU';
    if (rel > 0) return Math.random() > 0.5 ? 'armLL' : 'armRL';
    return Math.random() > 0.5 ? 'legLU' : 'legRU';
  }

  _severJoint(r, jointId, credit) {
    if (!jointId || r.severed.has(jointId)) return 0;
    const ids = SEVER_CHILDREN[jointId];
    if (!ids) return 0;
    r.severed.add(jointId);
    let n = 0;
    for (const id of ids) {
      const p = r.byId[id];
      if (!p?.alive) continue;
      p.data.parent = null; // suelta del árbol
      p.data.severed = true;
      p.vx += (Math.random() - 0.5) * 80;
      p.vy += (Math.random() - 0.5) * 80;
      p.vz += 50 + Math.random() * 60;
      p.spin = (Math.random() - 0.5) * 12;
      p.ttl = Math.min(p.ttl, 10);
      if (credit) p.playerTouch = 3;
      n++;
    }
    // muñón: pop de articulación + corte láser (si aplica)
    playSfx('limbPop');
    playSfx('laserSlice');
    try { sfx.hit(); } catch (_) {}
    return credit ? 6 + n * 3 : 0;
  }

  releaseHeld(torso, { vx = 0, vy = 0, vz = 80 } = {}) {
    const r = torso?._ragdoll || this.active.find(a => a.torso === torso);
    if (!r) return;
    r.held = false;
    playSfx('ragdollClatter');
    for (const p of r.parts) {
      if (!p.alive) continue;
      p.grabbed = false;
      p.ttl = 12 + Math.random() * 5;
      p.vx += vx * (0.65 + Math.random() * 0.5) + (Math.random() - 0.5) * 35;
      p.vy += vy * (0.65 + Math.random() * 0.5) + (Math.random() - 0.5) * 35;
      p.vz += vz * (0.5 + Math.random() * 0.55);
      p.spin = (Math.random() - 0.5) * 14;
      p.tumbleRate = (Math.random() - 0.5) * 12;
      p.playerTouch = 4;
    }
  }

  update(dt, world) {
    this.joints.length = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const r = this.active[i];
      r.age += dt;
      r.swing = (r.swing || 0) + dt;
      const torso = r.torso;

      if (r.held && torso?.alive) {
        const tx = torso.cx, ty = torso.cy, tz = torso.liftZ;
        const sway = Math.sin(r.swing * 5.2) * 4;
        // resolver hijos en orden de definición (padres antes)
        for (const def of PART_DEFS) {
          const p = r.byId[def.id];
          if (!p?.alive || p === torso) continue;
          if (r.severed.has(def.id) || p.data?.severed) continue;
          const parent = def.parent ? r.byId[def.parent] : torso;
          if (!parent?.alive) continue;
          const a = def.anchor || { x: 0, y: 0, z: 0 };
          const side = a.x >= 0 ? 1 : -1;
          const wantX = parent.cx + a.x + sway * side * 0.4;
          const wantY = parent.cy + a.y;
          const wantZ = Math.max(1.5, parent.liftZ + a.z);
          const kx = (wantX - p.cx) * 22;
          const ky = (wantY - p.cy) * 22;
          const kz = (wantZ - p.liftZ) * 16 - 100;
          p.vx = p.vx * 0.8 + kx * dt;
          p.vy = p.vy * 0.8 + ky * dt;
          p.vz = p.vz * 0.76 + kz * dt;
          p.x = p.cx + p.vx * dt - p.w / 2;
          p.y = p.cy + p.vy * dt - p.h / 2;
          p.liftZ = Math.max(0, p.liftZ + p.vz * dt);
          p.angle += (p.spin || 0) * dt;
          p.tumbleX = (p.tumbleX || 0) * 0.9 + Math.sin(r.swing * 3 + a.x) * 0.25;
          p.tumbleZ = (p.tumbleZ || 0) * 0.9 + Math.cos(r.swing * 2.5) * 0.2;
        }
      } else {
        // libre: mantener hijos anclados con resortes blandos (hasta que se corten)
        for (const def of PART_DEFS) {
          const p = r.byId[def.id];
          if (!p?.alive || !def.parent) continue;
          if (r.severed.has(def.id) || p.data?.severed) continue;
          const parent = r.byId[def.parent];
          if (!parent?.alive) continue;
          const a = def.anchor || { x: 0, y: 0, z: 0 };
          const wantX = parent.cx + a.x, wantY = parent.cy + a.y, wantZ = parent.liftZ + a.z;
          p.vx += (wantX - p.cx) * 8 * dt;
          p.vy += (wantY - p.cy) * 8 * dt;
          p.vz += (wantZ - p.liftZ) * 6 * dt;
        }
      }

      // Articulaciones visibles (bolas)
      for (const def of PART_DEFS) {
        if (!def.joint) continue;
        const p = r.byId[def.id];
        if (!p?.alive) continue;
        const parent = def.parent ? r.byId[def.parent] : null;
        if (def.parent && (!parent?.alive || r.severed.has(def.id) || p.data?.severed)) {
          // muñón: bola en el padre donde se cortó
          if (parent?.alive && r.severed.has(def.id)) {
            const a = def.anchor || { x: 0, y: 0, z: 0 };
            this.joints.push({
              x: parent.cx + a.x * 0.3, y: parent.cy, z: parent.liftZ + a.z * 0.3,
              r: def.joint * 0.85, color: '#c0c0c0', stump: true,
            });
          }
          continue;
        }
        const px = parent ? parent.cx : p.cx;
        const py = parent ? parent.cy : p.cy;
        const pz = parent ? parent.liftZ : p.liftZ;
        const a = def.anchor || { x: 0, y: 0, z: 0 };
        this.joints.push({
          x: parent ? px + a.x * 0.55 : p.cx,
          y: parent ? py + a.y * 0.55 : p.cy,
          z: parent ? pz + a.z * 0.55 : p.liftZ,
          r: def.joint, color: '#d8d8d8', stump: false,
        });
      }

      let alive = 0;
      for (const p of r.parts) {
        if (!p.alive) continue;
        if (!r.held && p.ttl < Infinity) {
          p.ttl -= dt;
          if (p.ttl <= 0) { p.alive = false; releaseRagdollBody(p); continue; }
        }
        alive++;
      }
      if (!alive || (!r.held && r.age > 18)) {
        for (const p of r.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
        this.active.splice(i, 1);
      }
    }
  }

  _trim() {
    while (this.active.length > this.cap) {
      const old = this.active.shift();
      if (old.held) { this.active.unshift(old); break; }
      for (const p of old.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
    }
    while (this.countParts() > this.partCap && this.active.length) {
      const old = this.active.find(a => !a.held) || this.active[0];
      if (old.held && this.active.every(a => a.held)) break;
      const ix = this.active.indexOf(old);
      if (ix >= 0) this.active.splice(ix, 1);
      for (const p of old.parts) if (p.alive) { p.alive = false; releaseRagdollBody(p); }
    }
  }

  /** Tras stepBody: thud / bounce / clatter según impacto. */
  playLandSounds() {
    for (const r of this.active) {
      if (r.held) continue;
      let clatter = false;
      for (const p of r.parts) {
        if (!p.alive) continue;
        const imp = p.landed || 0;
        if (imp > 120) {
          playSfx('bodyThud', Math.min(1, imp / 320));
          clatter = true;
        } else if (imp > 40) {
          playSfx('bounce');
        }
        // extremidades sueltas que se rozan en el aire / suelo
        if (p.data?.severed && p.speed > 60 && Math.random() < 0.08) clatter = true;
      }
      if (clatter) playSfx('ragdollClatter');
    }
  }

  clear() {
    for (const r of this.active) for (const p of r.parts) if (p.alive) releaseRagdollBody(p);
    this.active.length = 0;
    this.joints.length = 0;
  }
}
