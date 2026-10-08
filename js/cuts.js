/**
 * Cortes del láser ocular: planos brillantes + tallado progresivo
 * (edificios, árboles, autos, NPCs). Estilo arcade, sin gore.
 * La Fuerza del jugador escala grosor, velocidad de corte, alcance y escombro.
 */
import { Body } from './physics.js';
import { FLOOR_H } from './world.js';
import { dustCloud, sparks, glassShards, burst, addParticle } from './physics.js';
import { sfx } from './audio.js';

function playSfx(name, arg) {
  const S = typeof window !== 'undefined' ? window.SFX : null;
  if (S && typeof S[name] === 'function') {
    try { arg === undefined ? S[name]() : S[name](arg); } catch (_) {}
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

/** Perfil del láser según Fuerza (0.05–1). Baja = chamusca; alta = corta en dos. */
export function laserProfile(force = 0.6) {
  const f = Math.max(0.05, Math.min(1, force));
  return {
    f,
    /** radio del núcleo / halo (relativo) */
    thick: 0.55 + f * 1.8,
    /** multiplicador de acumulación de corte */
    cutSpeed: 0.35 + f * 2.4,
    /** alcance máx. de la mira bajo láser (px) */
    range: 90 + f * 220,
    /** cuánto escombro suelta al tallar */
    debris: 0.3 + f * 1.4,
    /** dps base a estructuras */
    dps: 12 + f * 55,
    /** coste de energía / s */
    cost: 4.5 + f * 6,
    /** umbral de calor para partir (más bajo = corta antes) */
    sliceBuild: 1.15 - f * 0.75,   // ~1.1 low → 0.4 high
    sliceTree: 1.0 - f * 0.65,
    sliceCar: 1.35 - f * 0.85,
    sliceNpc: 0.85 - f * 0.55,
    /** solo chamusca / muesca si f < 0.28 */
    canSlice: f >= 0.28,
    /** profundidad de trinchera en suelo */
    trench: 0.15 + f * 1.1,
  };
}

/** Plano de corte visible (el renderer lo dibuja como losa emisiva). */
export function addCutPlane(world, { x, y, z, nx = 0, ny = 0, w = 20, h = 4, life = 0.9, color = '#ff9a4a' }) {
  if (!world.cutPlanes) world.cutPlanes = [];
  world.cutPlanes.push({ x, y, z, nx, ny, w, h, life, maxLife: life, color });
  if (world.cutPlanes.length > 28) world.cutPlanes.shift();
}

/** Cara de corte persistente (arriba del tocón / en la pieza que cae): brilla unos segundos. */
export function addCutFace(world, { x, y, z, w = 20, d = 20, life = 4.5, color = '#ffb060' }) {
  if (!world.cutFaces) world.cutFaces = [];
  world.cutFaces.push({ x, y, z, w, d, life, maxLife: life, color });
  if (world.cutFaces.length > 40) world.cutFaces.shift();
}

export function updateCutPlanes(world, dt) {
  if (world.cutPlanes) {
    for (let i = world.cutPlanes.length - 1; i >= 0; i--) {
      world.cutPlanes[i].life -= dt;
      if (world.cutPlanes[i].life <= 0) world.cutPlanes.splice(i, 1);
    }
  }
  if (world.cutFaces) {
    for (let i = world.cutFaces.length - 1; i >= 0; i--) {
      world.cutFaces[i].life -= dt;
      if (world.cutFaces[i].life <= 0) world.cutFaces.splice(i, 1);
    }
  }
  // Brillo del tocón en segmentos cortados
  if (world.segments) {
    for (const s of world.segments) {
      if (s._cutFaceT > 0) {
        s._cutFaceT -= dt;
        if (s._cutFaceT <= 0) { s._cutFaceT = 0; s._cutFaceZ = null; }
      }
    }
  }
}

export function tickCutCool(world, dt) {
  for (const s of world.segments) if (s._cutCool > 0) s._cutCool -= dt;
}

/** Chispas + hollín continuo en el punto de impacto (sensación de “masticar”). */
export function laserImpactFx(world, x, y, z, prof, hitHard) {
  const n = Math.round((hitHard ? 3 : 1) + prof.thick);
  sparks(world.particles, x, y, z + 1, n, 120 + prof.f * 140, Math.random() > 0.5 ? '#fff1c4' : '#ff7a2a');
  if (Math.random() < 0.35 + prof.f * 0.4) {
    addParticle(world.particles, x, y, {
      z: z + 2, vx: rnd(-20, 20), vy: rnd(-20, 20), vz: 20 + prof.f * 40,
      size: 4 + prof.thick * 3, grow: 8, life: 0.9, color: '#2a2622', type: 'smoke', alpha: 0.45,
    });
  }
}

/**
 * Tallado progresivo de un segmento: profundiza una “muesca” a la altura del haz.
 * Al superar el umbral (y si canSlice) → corte limpio que deja caer la parte de arriba.
 */
export function carveBuilding(world, seg, cutZ, dt, prof, credit = false) {
  if (!seg || seg.destroyed || seg.floorsAlive <= 0) return 0;
  if (seg.height < cutZ - 8) return 0;
  const floor = Math.max(0, Math.min(seg.floorsAlive - 1, Math.floor(cutZ / FLOOR_H)));
  if (!seg._carve) seg._carve = {};
  const key = floor;
  const prev = seg._carve[key] || 0;
  const add = dt * prof.cutSpeed * (0.7 + (seg.kind === 'facade' ? 0.4 : 0));
  const depth = prev + add;
  seg._carve[key] = depth;

  // Daño continuo + micro-escombro mientras tallas
  let score = world.damageSegment(seg, prof.dps * dt * 0.55, credit);
  if (Math.random() < 0.5 * prof.debris * dt * 8) {
    const sz = 3 + Math.random() * 6 * prof.debris;
    world.debris.push(new Body({
      x: seg.cx - sz / 2 + rnd(-4, 4), y: seg.cy - sz / 2 + rnd(-4, 4),
      w: sz, h: sz, th: sz * 0.6, z: cutZ + rnd(-2, 4),
      vz: 20 + Math.random() * 50, vx: rnd(-60, 60), vy: rnd(-60, 60),
      mass: sz / 10, kind: 'debris', color: seg.color,
      spin: rnd(-5, 5), playerTouch: credit ? 1 : 0,
      data: { chunk: true, shape: 'shard', cut: true },
    }));
    world._capDebris?.();
  }
  // Plano de corte que crece con la profundidad
  if (Math.random() < dt * 4) {
    addCutPlane(world, {
      x: seg.cx, y: seg.cy, z: floor * FLOOR_H + 1,
      w: Math.max(seg.w, seg.h) * (0.5 + Math.min(1, depth) * 0.7),
      h: 2 + Math.min(6, depth * 4),
      life: 0.25 + Math.min(0.6, depth * 0.3),
      color: depth > prof.sliceBuild * 0.7 ? '#ffe0a0' : '#ff8040',
    });
  }

  if (prof.canSlice && depth >= prof.sliceBuild && !(seg._cutCool > 0)) {
    score += cutBuildingSegment(world, seg, cutZ, credit, prof);
    seg._carve[key] = 0;
  }
  return score;
}

/**
 * Corta un segmento a la altura del haz: la parte de arriba cae como losas.
 */
export function cutBuildingSegment(world, seg, cutZ, credit = false, prof = null) {
  if (!seg || seg.destroyed || seg.floorsAlive <= 0) return 0;
  const floors = seg.floorsAlive;
  const cutFloor = Math.max(0, Math.min(floors - 1, Math.floor(cutZ / FLOOR_H)));
  if (cutFloor >= floors) return 0;
  if (seg._cutAt != null && Math.abs(seg._cutAt - cutFloor) < 1 && (seg._cutCool || 0) > 0) return 0;
  seg._cutAt = cutFloor;
  seg._cutCool = 0.4;
  const topN = floors - cutFloor;
  const zPlane = cutFloor * FLOOR_H;
  const debMul = prof ? prof.debris : 1;
  addCutPlane(world, {
    x: seg.cx, y: seg.cy, z: zPlane + 1,
    w: Math.max(seg.w, seg.h) * 1.2, h: 3.5 + debMul,
    life: 2.2, color: '#ffe0a0',
  });
  // Cara brillante del tocón (mitad inferior) + la pieza que cae
  addCutFace(world, { x: seg.cx, y: seg.cy, z: zPlane + 0.8, w: seg.w * 1.15, d: seg.h * 1.15, life: 7.5, color: '#ffe080' });
  addCutFace(world, { x: seg.cx, y: seg.cy, z: zPlane + 1.6, w: seg.w * 0.95, d: seg.h * 0.95, life: 4.5, color: '#ff9040' });
  seg._cutFaceZ = zPlane;
  seg._cutFaceT = 8.5;
  seg.dirty = true;
  sparks(world.particles, seg.cx, seg.cy, zPlane + 2, 8 + Math.round(debMul * 4), 180, '#ffe2a8');
  glassShards(world.particles, seg.cx, seg.cy, zPlane + 4, 6);
  burst(world.particles, seg.cx, seg.cy, 5, '#ff9a4a', { z: zPlane + 2 });

  const bld = world.buildings[seg.buildingId];
  const ox = bld ? Math.sign(seg.cx - (bld.x + bld.w / 2)) || rnd(-0.5, 0.5) : rnd(-0.5, 0.5);
  const oy = bld ? Math.sign(seg.cy - (bld.y + bld.h / 2)) || rnd(-0.5, 0.5) : rnd(-0.5, 0.5);
  const nSlabs = Math.min(4, 1 + Math.floor(topN / 2 * debMul));
  for (let i = 0; i < nSlabs; i++) {
    const fh = Math.min(FLOOR_H * Math.min(2.2, topN - i), FLOOR_H * 1.8);
    const L = seg.w * rnd(0.7, 1.0), T = rnd(2.5, 4.5);
    world.debris.push(new Body({
      x: seg.cx - L / 2, y: seg.cy - T / 2, w: L, h: T, th: fh,
      z: zPlane + FLOOR_H * (0.5 + i) + fh * 0.3,
      vz: 8 + Math.random() * 30, vx: ox * (25 + Math.random() * 50), vy: oy * (25 + Math.random() * 50),
      mass: L * fh / 90, kind: 'debris', color: seg.color,
      spin: rnd(-2.5, 2.5), friction: 0.86, bounce: 0.12,
      playerTouch: credit ? 3 : 0,
      data: { chunk: true, shape: 'slab', rebar: true, cut: true, cutGlow: true },
    }));
  }
  const nChunk = Math.max(2, Math.round((2 + topN * 1.2) * debMul * (world.fxScale || 1)));
  for (let i = 0; i < nChunk; i++) {
    const sz = 5 + Math.random() * 14;
    world.debris.push(new Body({
      x: seg.x + Math.random() * (seg.w - sz), y: seg.y + Math.random() * (seg.h - sz),
      w: sz, h: sz * rnd(0.6, 1.1), th: sz * rnd(0.4, 0.9),
      z: zPlane + rnd(2, FLOOR_H * topN),
      vz: 15 + Math.random() * 60, vx: ox * 60 + rnd(-40, 40), vy: oy * 60 + rnd(-40, 40),
      mass: sz / 7, kind: 'debris', color: Math.random() > 0.4 ? seg.color : '#8d8a84',
      spin: rnd(-6, 6), playerTouch: credit ? 2 : 0,
      data: { chunk: true, shape: 'chunk', cut: true },
    }));
  }
  const hpPer = seg.maxHp / Math.max(1, seg.floors);
  const removed = topN;
  const dmg = Math.min(seg.hp, hpPer * removed * 0.95);
  seg.hp -= dmg;
  world.destroyedHp += dmg;
  seg.floorsAlive = cutFloor;
  if (seg.floorsAlive <= 0) { seg.destroyed = true; seg.floorsAlive = 0; }
  seg.dirty = true;
  world.dirtySegs.push(seg);
  world.segVersion++;
  world.shake = (world.shake || 0) + Math.min(3.5, 0.6 * removed);
  world._capDebris?.();
  playSfx('laserSlice');
  try { sfx.smash(); sfx.shatter(); } catch (_) {}
  return Math.round(dmg) + removed * 4;
}

/** Tronco partido: tocón + copa que cae. */
export function cutTree(world, prop, credit = false, prof = null) {
  if (!prop || prop.destroyed || prop.kind !== 'tree' || prop.cut) return 0;
  prop.cut = true;
  prop.cutZ = 10 + Math.random() * 6;
  prop.destroyed = true;
  prop.toppled = true;
  prop.fall = 1;
  prop.angle = Math.random() * Math.PI * 2;
  world.destroyedHp += prop.hp;
  prop.hp = 0;
  addCutPlane(world, { x: prop.cx, y: prop.cy, z: prop.cutZ, w: 14, h: 2.5, life: 0.85, color: '#ffb060' });
  addCutFace(world, { x: prop.cx, y: prop.cy, z: prop.cutZ, w: 12 * (prop.scale || 1), d: 12 * (prop.scale || 1), life: 6.5, color: '#ffe080' });
  const sc = prop.scale || 1;
  world.debris.push(new Body({
    x: prop.cx - 10 * sc, y: prop.cy - 10 * sc, w: 20 * sc, h: 20 * sc, th: 16 * sc,
    z: 22 * sc, vz: 20 + Math.random() * 40, vx: rnd(-50, 50), vy: rnd(-50, 50),
    mass: 3 * sc, kind: 'debris', color: '#2f6b33', spin: rnd(-3, 3),
    friction: 0.9, bounce: 0.2, playerTouch: credit ? 2 : 0,
    data: { chunk: true, shape: 'foliage', cut: true, treeCrown: true },
  }));
  world.debris.push(new Body({
    x: prop.cx - 3, y: prop.cy - 3, w: 6, h: 6, th: 12,
    z: prop.cutZ + 4, vz: 30, vx: rnd(-30, 30), vy: rnd(-30, 30),
    mass: 1.4, kind: 'debris', color: '#6b4423', spin: rnd(-4, 4),
    playerTouch: credit ? 1 : 0, data: { chunk: true, shape: 'chunk', cut: true },
  }));
  dustCloud(world.particles, prop.cx, prop.cy, 4, { color: '#4f7a3a', size: 10, z: prop.cutZ });
  sparks(world.particles, prop.cx, prop.cy, prop.cutZ, 5, 120, '#ffe2a8');
  world.propVersion++;
  world._capDebris?.();
  playSfx('laserSlice');
  try { sfx.smash(); } catch (_) {}
  return 20;
}

/** Auto seccionado: mitades del chasis + piezas sueltas. */
export function cutVehicle(v, world, credit = false, prof = null) {
  if (!v || !v.alive || v._laserCut) return 0;
  v._laserCut = true;
  const ang = v.angle || 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  addCutPlane(world, {
    x: v.cx, y: v.cy, z: 8 + (v.liftZ || 0),
    nx: -sa, ny: ca, w: Math.max(v.w, v.h) * 0.9, h: 10,
    life: 1.0, color: '#ff8040',
  });
  for (const side of [-1, 1]) {
    const ox = -sa * side * (v.w * 0.22), oy = ca * side * (v.h * 0.22);
    world.debris.push(new Body({
      x: v.cx + ox - v.w * 0.28, y: v.cy + oy - v.h * 0.28,
      w: v.w * 0.55, h: v.h * 0.55, th: 10,
      z: 6 + (v.liftZ || 0), vz: 40 + Math.random() * 50,
      vx: ox * 3 + rnd(-40, 40), vy: oy * 3 + rnd(-40, 40),
      mass: (v.mass || 10) * 0.35, kind: 'debris', color: v.color || '#555',
      spin: side * (2 + Math.random() * 3), friction: 0.9, bounce: 0.2,
      playerTouch: credit ? 3 : 0,
      data: { chunk: true, shape: 'slab', cut: true, carHalf: true, cutGlow: true },
      damageOnHit: 18,
    }));
  }
  for (const key of Object.keys(v.parts || {})) {
    if (v.parts[key].attached) {
      try { v._detachPart?.(key, world, 100, credit); } catch (_) {}
    }
  }
  v.parts.engine.hp = 0;
  const sc = v.applyDamage?.(180, world, v.cx, v.cy, credit) || 80;
  v.onFire = Math.max(v.onFire || 0, 6);
  sparks(world.particles, v.cx, v.cy, 10, 12, 200, '#ffd36b');
  burst(world.particles, v.cx, v.cy, 6, '#ff7a2a', { z: 8 });
  world._capDebris?.();
  playSfx('laserSlice');
  try { sfx.carHit?.() || sfx.smash(); } catch (_) { try { sfx.smash(); } catch (_) {} }
  return typeof sc === 'number' ? sc + 40 : 120;
}

/**
 * Trinchera / hollín que se profundiza al barrer el suelo.
 * Clave espacial en celdas de 20 px; depth crece con el tiempo de haz.
 */
export function carveTrench(world, x, y, dt, prof) {
  if (!world._trench) world._trench = new Map();
  const gx = Math.round(x / 20) * 20, gy = Math.round(y / 20) * 20;
  const k = gx + ',' + gy;
  const prev = world._trench.get(k) || 0;
  const depth = Math.min(3.5, prev + dt * prof.cutSpeed * prof.trench);
  world._trench.set(k, depth);
  if (world._trench.size > 120) {
    const first = world._trench.keys().next().value;
    world._trench.delete(first);
  }
  // Decal que crece
  if (depth - prev > 0.08 || Math.random() < dt * 3) {
    world.addRoadCrack(x + rnd(-3, 3), y + rnd(-3, 3), 0.4 + depth * 0.55, 'scorch');
  }
  // A fuerza alta y profundidad, cuenco de cráter pequeño
  if (prof.canSlice && depth > 1.6 && Math.random() < dt * 1.2) {
    world.addCrater?.(x, y, 0.35 + depth * 0.25, { scorch: true });
    world._trench.set(k, 0.4); // reinicia un poco para no spamear
  }
  return depth;
}
