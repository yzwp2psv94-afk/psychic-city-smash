/**
 * Mundo de la ciudad (lógica): calles, edificios por columnas de pisos,
 * props, escombros, grietas/cráteres, efectos. El render 3D lee este estado.
 * Unidades: px de mundo (1 px = 0.1 m). Altura de piso = 30 px (3 m).
 */

import {
  Body, burst, aabbOverlap, circleHitAABB, dustCloud, glassShards,
  fireBurst, sparks, smokePuff, addParticle,
} from './physics.js';
import { sfx } from './audio.js';

export const FLOOR_H = 30;
export const CELL = 26;
export const BLOCK = 230;
export const SIDEWALK_W = 14;
export const ROAD_W = 72;
export const N_ROADS = 4;           // semilla inicial (compat); el mapa streamable es infinito
export const PITCH = BLOCK + ROAD_W + SIDEWALK_W * 2; // 330
export const WORLD_SIZE = (N_ROADS + 1) * BLOCK + N_ROADS * (ROAD_W + SIDEWALK_W * 2); // 1550 (solo referencia)
/** Radio de streaming en manzanas (alrededor del jugador) */
export const STREAM_R = { high: 3, medium: 2, low: 2 };

export const MAX_DEBRIS = 380;
export const MAX_RUBBLE = 2400;
export const MAX_CRACKS = 180;
export const MAX_SLABS = 900;          // losas estáticas (pisos apilados, asfalto levantado, banqueta rota)
export const CRATER_CAP = { high: 26, medium: 16, low: 9 };

/** Perfil de cráter: cuenco (−1 en el centro) + borde levantado (+0,25) que se desvanece hasta 1,45 r */
export function craterProfile(t) {
  if (t < 1) return -1 + t * t * 1.25;
  if (t < 1.45) { const u = 1 - (t - 1) / 0.45; return 0.25 * u * u; }
  return 0;
}
const rnd = (a, b) => a + Math.random() * (b - a);

const TINTS = ['#e3d6c3', '#cdbba6', '#bcc6d0', '#d8a98e', '#b4bea9', '#e6e1d6', '#a7b0bb', '#cf9575', '#d9c7a0', '#b9a9c4'];
const TREE = '#2f6b33';
const TRUNK = '#6b4423';

/** Columna de edificio (una celda de la planta con N pisos) */
export class Segment {
  constructor(x, y, w, h, opts = {}) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.floors = opts.floors || 4;
    this.kind = opts.kind || 'facade';
    const perFloor = this.kind === 'facade' ? 14 : 18;
    this.hp = opts.hp ?? perFloor * this.floors;
    this.maxHp = this.hp;
    this.color = opts.color || TINTS[0];
    this.buildingId = opts.buildingId ?? 0;
    this.destroyed = false;
    this.floorsAlive = this.floors;
    this.rubbleLevel = 0;
    this.cracks = 0;
    this.dirty = true;
    this.index = 0;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get height() { return this.floorsAlive * FLOOR_H; }
  aabb() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

export class Prop {
  constructor(x, y, kind, opts = {}) {
    this.x = x; this.y = y;
    this.kind = kind;
    this.w = opts.w || 20;
    this.h = opts.h || 20;
    this.hp = opts.hp ?? 25;
    this.maxHp = this.hp;
    this.destroyed = false;
    this.angle = 0;        // dirección de caída
    this.fall = 0;         // 0..1 animación de caída
    this.spraying = 0;
    this.toppled = false;
    this.scale = opts.scale || 1;
    this.rot = Math.random() * Math.PI * 2;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  aabb() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

export class World {
  constructor(w = WORLD_SIZE, h = WORLD_SIZE) {
    this.w = w;
    this.h = h;
    this.bounds = { x: 0, y: 0, w, h };
    this.chunks = new Map();       // "cx,cy" → datos de manzana
    this.streamR = STREAM_R.medium;
    this.streamVersion = 0;
    this._scx = null; this._scy = null;
    this._nextBid = 0;
    this.cutPlanes = [];
    this.generate();
  }

  setStreamRadius(q) {
    this.streamR = STREAM_R[q] || STREAM_R.medium;
  }

  /** Semilla estable por manzana (variedad sin Math.random global) */
  _chunkRand(cx, cy) {
    let s = (cx * 73856093) ^ (cy * 19349663) ^ 0x2f3a9c1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  generate() {
    this.segments = [];
    this.props = [];
    this.debris = [];
    this.particles = [];
    this.cracks = [];
    this.crackCount = 0;
    this.rubble = [];
    this.rubbleCount = 0;
    this.slabs = [];
    this.slabCount = 0;
    this.craters = [];
    this.craterSeq = 0;
    this.craterVersion = 0;
    this.craterCap = this.craterCap || CRATER_CAP.medium;
    this.peels = [];
    this.fx = [];
    this.fires = [];
    this.buildings = [];
    this.roads = [];
    this.sidewalks = [];
    this.blocks = [];
    this.intersections = [];
    this.parkingSpots = [];
    this.totalHp = 0;
    this.destroyedHp = 0;
    this.segVersion = 0;
    this.propVersion = 0;
    this.dirtySegs = [];
    this.shake = 0;
    this.haze = 0;
    this.pendingScore = 0;
    this.debrisCap = this.debrisCap || MAX_DEBRIS;
    this.fxScale = this.fxScale || 1;
    this.cutPlanes = [];
    this.chunks.clear();
    this._nextBid = 0;
    // Origen: plaza en (2,2) para un arranque familiar; el mundo se extiende al caminar/volar
    this.spawnChunk = { cx: 2, cy: 2 };
    this.spawn = { x: 2 * PITCH + BLOCK / 2, y: 2 * PITCH + BLOCK / 2 };
    this.updateStreaming(this.spawn.x, this.spawn.y, true);
  }

  /**
   * Carga/descarga manzanas alrededor del jugador. Devuelve true si cambió el conjunto
   * (el juego debe reconstruir la malla 3D).
   */
  updateStreaming(px, py, force = false) {
    const R = this.streamR;
    const pcx = Math.floor(px / PITCH), pcy = Math.floor(py / PITCH);
    if (!force && pcx === this._scx && pcy === this._scy) return false;
    this._scx = pcx; this._scy = pcy;
    const need = new Set();
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) need.add((pcx + dx) + ',' + (pcy + dy));
    // LRU: conservar manzanas descargadas un rato (destrucción cercana)
    if (!this._chunkCache) this._chunkCache = new Map();
    for (const key of [...this.chunks.keys()]) {
      if (!need.has(key)) {
        this._chunkCache.set(key, this.chunks.get(key));
        this.chunks.delete(key);
        if (this._chunkCache.size > 48) {
          const first = this._chunkCache.keys().next().value;
          this._chunkCache.delete(first);
        }
      }
    }
    for (const key of need) {
      if (this.chunks.has(key)) continue;
      if (this._chunkCache.has(key)) {
        this.chunks.set(key, this._chunkCache.get(key));
        this._chunkCache.delete(key);
      } else {
        const [cx, cy] = key.split(',').map(Number);
        this.chunks.set(key, this._makeChunk(cx, cy));
      }
    }
    this._rebuildFlat();
    this.streamVersion++;
    return true;
  }

  _makeChunk(cx, cy) {
    const rnd = this._chunkRand(cx, cy);
    const x0 = cx * PITCH, y0 = cy * PITCH;
    const sc = this.spawnChunk;
    let t;
    if (cx === sc.cx && cy === sc.cy) t = 'plaza';
    else {
      const r = rnd();
      t = r < 0.28 ? 'tower' : r < 0.55 ? 'split2' : r < 0.78 ? 'split4' : r < 0.88 ? 'parking' : r < 0.95 ? 'park' : 'split2';
      // Un estacionamiento cerca del spawn
      if (cx === sc.cx + 1 && cy === sc.cy) t = 'parking';
    }
    const buildings = [];
    const props = [];
    const parking = [];
    const m = 12;
    const pushB = (bx, by, bw, bh, floors) => {
      const bid = this._nextBid++;
      buildings.push(this._buildBuildingData(bx, by, bw, bh, bid, floors, rnd));
    };
    if (t === 'tower') {
      pushB(x0 + m, y0 + m, BLOCK - 2 * m, BLOCK - 2 * m, 6 + Math.floor(rnd() * 5));
    } else if (t === 'split2') {
      const horiz = rnd() > 0.5;
      const g = 10, half = (BLOCK - 2 * m - g) / 2;
      for (let k = 0; k < 2; k++) {
        const fl = 3 + Math.floor(rnd() * 6);
        if (horiz) pushB(x0 + m, y0 + m + k * (half + g), BLOCK - 2 * m, half, fl);
        else pushB(x0 + m + k * (half + g), y0 + m, half, BLOCK - 2 * m, fl);
      }
    } else if (t === 'split4') {
      const g = 10, half = (BLOCK - 2 * m - g) / 2;
      for (let k = 0; k < 4; k++) {
        pushB(x0 + m + (k % 2) * (half + g), y0 + m + Math.floor(k / 2) * (half + g), half, half, 2 + Math.floor(rnd() * 5));
      }
    } else if (t === 'parking') {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        if (rnd() < 0.25) continue;
        parking.push({
          x: x0 + 40 + c * 50, y: y0 + 55 + r * 120,
          angle: Math.PI / 2 + (r ? Math.PI : 0) + (rnd() - 0.5) * 0.1,
        });
      }
      props.push(new Prop(x0 + 8, y0 + 8, 'tree', { w: 18, h: 18, hp: 30 }));
      props.push(new Prop(x0 + BLOCK - 26, y0 + BLOCK - 26, 'tree', { w: 18, h: 18, hp: 30 }));
    } else if (t === 'park') {
      for (let i = 0; i < 9; i++) {
        props.push(new Prop(x0 + 20 + rnd() * (BLOCK - 60), y0 + 20 + rnd() * (BLOCK - 60), 'tree', {
          w: 20, h: 20, hp: 30, scale: 0.9 + rnd() * 0.6,
        }));
      }
    } else if (t === 'plaza') {
      for (let i = 0; i < 4; i++) {
        const cxp = x0 + (i % 2 ? BLOCK - 34 : 16);
        const cyp = y0 + (i < 2 ? 16 : BLOCK - 34);
        props.push(new Prop(cxp, cyp, 'tree', { w: 18, h: 18, hp: 30, scale: 1.2 }));
      }
      props.push(new Prop(x0 + BLOCK / 2 - 8, y0 + 20, 'lamp', { w: 6, h: 6, hp: 18 }));
      props.push(new Prop(x0 + BLOCK / 2 - 8, y0 + BLOCK - 26, 'lamp', { w: 6, h: 6, hp: 18 }));
    }
    // Faroles/hidrantes locales (bordes de manzana hacia la calle)
    props.push(new Prop(x0 + BLOCK + SIDEWALK_W - 13, y0 + BLOCK + SIDEWALK_W - 13, 'hydrant', { w: 9, h: 9, hp: 20 }));
    for (let s = 60; s < BLOCK; s += 165) {
      props.push(new Prop(x0 + s, y0 + BLOCK + SIDEWALK_W - 9, 'lamp', { w: 6, h: 6, hp: 18 }));
      props.push(new Prop(x0 + BLOCK + ROAD_W + 3, y0 + s, 'lamp', { w: 6, h: 6, hp: 18 }));
    }
    return { cx, cy, x0, y0, type: t, buildings, props, parking };
  }

  _buildBuildingData(bx, by, bw, bh, bid, floors, rnd = Math.random) {
    const tint = TINTS[Math.floor(rnd() * TINTS.length)];
    const cols = Math.max(2, Math.floor(bw / CELL));
    const rows = Math.max(2, Math.floor(bh / CELL));
    const actualW = cols * CELL, actualH = rows * CELL;
    const ox = bx + (bw - actualW) / 2, oy = by + (bh - actualH) / 2;
    const b = { id: bid, x: ox, y: oy, w: actualW, h: actualH, floors, tint, segs: [], cols, rows,
      damagedCols: 0, collapsing: null, collapsed: false };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const isEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      const seg = new Segment(ox + c * CELL, oy + r * CELL, CELL, CELL, {
        kind: isEdge ? 'facade' : 'core', color: tint, buildingId: bid, floors,
      });
      seg.col = c; seg.row = r;
      b.segs.push(seg);
    }
    return b;
  }

  _rebuildFlat() {
    const keys = [...this.chunks.keys()].map(k => k.split(',').map(Number));
    let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
    for (const [cx, cy] of keys) {
      if (cx < minCx) minCx = cx; if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy; if (cy > maxCy) maxCy = cy;
    }
    // Carreteras que bordean las manzanas activas (índice i → carretera entre manzanas i e i+1… en la práctica en i*PITCH + offset)
    // road index i sits at BLOCK+SIDEWALK_W + i*PITCH; manzana cx ocupa [cx*PITCH, cx*PITCH+BLOCK]
    // Carretera vertical al este de manzana cx: x = cx*PITCH + BLOCK + SIDEWALK_W = roadPos index cx
    const roadPos = [];
    for (let i = minCx; i <= maxCx; i++) roadPos.push(i * PITCH + BLOCK + SIDEWALK_W);
    // También la carretera al oeste del borde izquierdo si hay manzana minCx
    // (la carretera índice minCx-1 limita el lado oeste)
    if (minCx > -999) {
      const west = (minCx - 1) * PITCH + BLOCK + SIDEWALK_W;
      if (!roadPos.includes(west)) roadPos.unshift(west);
    }
    // Unificar X e Y (misma cuadrícula)
    const rset = new Set(roadPos);
    for (let i = minCy; i <= maxCy; i++) rset.add(i * PITCH + BLOCK + SIDEWALK_W);
    rset.add((minCy - 1) * PITCH + BLOCK + SIDEWALK_W);
    this.roadPos = [...rset].sort((a, b) => a - b);

    const minX = minCx * PITCH - SIDEWALK_W - ROAD_W;
    const minY = minCy * PITCH - SIDEWALK_W - ROAD_W;
    const maxX = (maxCx + 1) * PITCH + ROAD_W + SIDEWALK_W;
    const maxY = (maxCy + 1) * PITCH + ROAD_W + SIDEWALK_W;
    this.w = maxX - minX;
    this.h = maxY - minY;
    this.originX = minX;
    this.originY = minY;
    // bounds en coords de mundo absolutas
    this.bounds = { x: minX, y: minY, w: this.w, h: this.h };
    // Compat: muchos sitios usan 0..world.w — reubicamos a coords absolutas y
    // hacemos que world.w/h sean el máximo absoluto (para clamps suaves)
    this.w = maxX;
    this.h = maxY;
    this.minX = minX; this.minY = minY;

    this.roads = [];
    this.sidewalks = [];
    this.intersections = [];
    for (const ry of this.roadPos) {
      this.roads.push({ x: minX, y: ry, w: maxX - minX, h: ROAD_W, horiz: true });
      this.sidewalks.push({ x: minX, y: ry - SIDEWALK_W, w: maxX - minX, h: SIDEWALK_W });
      this.sidewalks.push({ x: minX, y: ry + ROAD_W, w: maxX - minX, h: SIDEWALK_W });
    }
    for (const rx of this.roadPos) {
      this.roads.push({ x: rx, y: minY, w: ROAD_W, h: maxY - minY, horiz: false });
      this.sidewalks.push({ x: rx - SIDEWALK_W, y: minY, w: SIDEWALK_W, h: maxY - minY });
      this.sidewalks.push({ x: rx + ROAD_W, y: minY, w: SIDEWALK_W, h: maxY - minY });
    }
    for (const rx of this.roadPos) for (const ry of this.roadPos) {
      this.intersections.push({ x: rx, y: ry, w: ROAD_W, h: ROAD_W });
    }

    this.buildings = [];
    this.segments = [];
    this.props = [];
    this.parkingSpots = [];
    this.blocks = [];
    // Re-indexar buildingId de forma contigua para el renderer
    let idMap = new Map();
    let nid = 0;
    for (const ch of this.chunks.values()) {
      this.blocks.push({ x: ch.x0, y: ch.y0, w: BLOCK, h: BLOCK, type: ch.type });
      for (const b of ch.buildings) {
        const nb = {
          id: nid, x: b.x, y: b.y, w: b.w, h: b.h, floors: b.floors, tint: b.tint,
          segs: [], cols: b.cols, rows: b.rows,
          damagedCols: b.damagedCols || 0, collapsing: b.collapsing, collapsed: b.collapsed,
          lean: b.lean, pancakeZ: b.pancakeZ,
        };
        idMap.set(b, nid);
        for (const seg of b.segs) {
          seg.buildingId = nid;
          nb.segs.push(seg);
          this.segments.push(seg);
        }
        this.buildings.push(nb);
        nid++;
      }
      for (const pr of ch.props) this.props.push(pr);
      for (const pk of ch.parking) this.parkingSpots.push(pk);
    }
    this.segments.forEach((s, i) => { s.index = i; });
    this.totalHp = this.segments.reduce((a, seg) => a + seg.maxHp, 0)
      + this.props.reduce((a, p) => a + p.maxHp, 0);
    // Conservar destroyedHp acotado
    this.destroyedHp = Math.min(this.destroyedHp, this.totalHp);
  }

  /** ¿El punto está dentro de la ventana activa (con margen)? */
  inActiveBounds(x, y, margin = 80) {
    return x >= this.minX - margin && y >= this.minY - margin && x <= this.w + margin && y <= this.h + margin;
  }

  _inIntersectionBand(s) {

    for (const r of this.roadPos) if (s > r - 30 && s < r + ROAD_W + 30) return true;
    return false;
  }

  destructionPercent() {
    if (this.totalHp <= 0) return 0;
    return Math.min(100, Math.round((this.destroyedHp / this.totalHp) * 100));
  }

  /** Itera segmentos vivos cuyo AABB toca el rectángulo dado (prefiltro por edificio) */
  segmentsTouching(box, cb) {
    for (const b of this.buildings) {
      if (box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y) continue;
      for (const s of b.segs) {
        if (s.destroyed) continue;
        if (aabbOverlap(box, s)) { if (cb(s) === false) return; }
      }
    }
  }

  segmentsInRadius(cx, cy, r, cb) {
    this.segmentsTouching({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, s => {
      if (circleHitAABB(cx, cy, r, s)) return cb(s);
    });
  }

  /** Empuja un objeto AABB fuera de columnas en pie (a su altura). Devuelve el segmento golpeado. */
  resolveStructures(o) {
    let hit = null;
    const z = o.liftZ || 0;
    this.segmentsTouching(o, s => {
      if (z >= s.height) return;
      const ocx = o.x + o.w / 2, ocy = o.y + o.h / 2;
      const dx = ocx - s.cx, dy = ocy - s.cy;
      const ox = (o.w + s.w) / 2 - Math.abs(dx);
      const oy = (o.h + s.h) / 2 - Math.abs(dy);
      if (ox <= 0 || oy <= 0) return;
      if (ox < oy) { o.x += dx < 0 ? -ox : ox; hit = hit || { seg: s, nx: dx < 0 ? -1 : 1, ny: 0 }; }
      else { o.y += dy < 0 ? -oy : oy; hit = hit || { seg: s, nx: 0, ny: dy < 0 ? -1 : 1 }; }
    });
    return hit;
  }

  damageSegment(seg, dmg, credit = false) {
    if (seg.destroyed || dmg <= 0) return 0;
    const applied = Math.min(seg.hp, dmg);
    const wasWeak = seg.hp < seg.maxHp * 0.5;
    seg.hp -= applied;
    this.destroyedHp += applied;
    seg.cracks = Math.min(3, Math.floor((1 - seg.hp / seg.maxHp) * 4));
    const bld = this.buildings[seg.buildingId];
    if (bld && !wasWeak && seg.hp < seg.maxHp * 0.5) {
      bld.damagedCols++;
      // Falla estructural: demasiadas columnas debilitadas → colapso en cascada
      if (!bld.collapsing && !bld.collapsed && bld.damagedCols >= Math.max(3, Math.ceil(bld.segs.length * 0.22))) {
        this.startCollapse(bld, credit);
      }
    }
    const prev = seg.floorsAlive;
    const now = seg.hp <= 0 ? 0 : Math.ceil(seg.floors * (seg.hp / seg.maxHp));
    const topZ = Math.max(1, prev) * FLOOR_H;
    burst(this.particles, seg.cx, seg.cy, 3, seg.color, { z: topZ * 0.6 + Math.random() * topZ * 0.4 });
    if (seg.kind === 'facade' && Math.random() < 0.5) glassShards(this.particles, seg.cx, seg.cy, Math.random() * topZ, 3);
    if (now < prev) {
      seg.floorsAlive = now;
      this.shake += Math.min(4, 0.8 * (prev - now));
      // v4.2: un golpe fuerte arranca un paño de fachada que se inclina y cae a la calle
      if (seg.kind === 'facade' && prev - now >= 2 && Math.random() < 0.6) this._peelFromSeg(seg, now, prev);
      for (let k = prev - 1; k >= now; k--) this._floorCollapse(seg, k, credit);
      if (seg.kind === 'facade') sfx.shatter();
      sfx.smash();
    }
    if (seg.hp <= 0) {
      seg.destroyed = true;
      seg.floorsAlive = 0;
      dustCloud(this.particles, seg.cx, seg.cy, 8, { z: 4, spread: 18, size: 18, life: 2.4 });
    }
    seg.dirty = true;
    this.dirtySegs.push(seg);
    this.segVersion++;
    return applied;
  }

  _floorCollapse(seg, k, credit) {
    const z = (k + 0.5) * FLOOR_H;
    dustCloud(this.particles, seg.cx, seg.cy, 4, { z, spread: 14, size: 16, rise: 10 });
    if (seg.kind === 'facade') glassShards(this.particles, seg.cx, seg.cy, z, 7);
    burst(this.particles, seg.cx, seg.cy, 5, seg.color, { z });
    // Fractura irregular: trozos de concreto/ladrillo de tamaños desiguales que salen girando
    const bld = this.buildings[seg.buildingId];
    const ocx = bld ? bld.x + bld.w / 2 : seg.cx, ocy = bld ? bld.y + bld.h / 2 : seg.cy;
    let ox = seg.cx - ocx, oy = seg.cy - ocy;
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    // v4.2: fractura irregular — 1 losa grande (muro / placa de piso, a veces con varillas) + trozos irregulares
    if (Math.random() < (seg.kind === 'facade' ? 0.75 : 0.45) * Math.max(0.5, this.fxScale)) {
      const wall = seg.kind === 'facade' && Math.random() < 0.6;
      const L = seg.w * rnd(0.55, 0.95), T = rnd(1.8, 3.2), Hh = wall ? FLOOR_H * rnd(0.55, 0.9) : seg.h * rnd(0.5, 0.85);
      const out = 30 + Math.random() * 90;
      this.debris.push(new Body({
        x: seg.cx - L / 2 + ox * seg.w * 0.4, y: seg.cy - (wall ? T : Hh) / 2 + oy * seg.h * 0.4,
        w: wall ? L : L, h: wall ? T : Hh, th: wall ? Hh : T,
        z, vz: 5 + Math.random() * 40,
        vx: ox * out + (Math.random() - 0.5) * 40, vy: oy * out + (Math.random() - 0.5) * 40,
        mass: L * Hh / 120, kind: 'debris',
        color: Math.random() > 0.3 ? seg.color : '#9a958d',
        spin: (Math.random() - 0.5) * 3, friction: 0.86, bounce: 0.15,
        playerTouch: credit ? 3 : 0,
        data: { chunk: true, shape: 'slab', rebar: Math.random() < 0.65 },
      }));
    }
    const nChunks = Math.max(1, Math.round((seg.kind === 'facade' ? 3 + Math.random() * 2.5 : 1.5 + Math.random()) * this.fxScale));
    for (let i = 0; i < nChunks; i++) {
      const sz = 5 + Math.random() * Math.random() * 16;
      const out = 40 + Math.random() * 120;
      this.debris.push(new Body({
        x: seg.x + Math.random() * (seg.w - sz), y: seg.y + Math.random() * (seg.h - sz),
        w: sz * (0.7 + Math.random() * 0.6), h: sz * (0.6 + Math.random() * 0.7), th: sz * (0.35 + Math.random() * 0.6),
        z, vz: 10 + Math.random() * 70,
        vx: ox * out + (Math.random() - 0.5) * 90, vy: oy * out + (Math.random() - 0.5) * 90,
        mass: sz / 7, kind: 'debris',
        color: Math.random() > 0.35 ? seg.color : (Math.random() > 0.5 ? '#8d8a84' : '#6f6a64'),
        spin: (Math.random() - 0.5) * 8, friction: 0.9, bounce: 0.3,
        playerTouch: credit ? 3 : 0,
        data: { chunk: true, shape: Math.random() < 0.3 ? 'shard' : 'chunk' },
      }));
    }
    if (seg.kind === 'facade') sparks(this.particles, seg.cx + ox * seg.w * 0.5, seg.cy + oy * seg.h * 0.5, z, 2, 90, '#ffe2a8');
    // Montón de escombro estático en la base
    seg.rubbleLevel++;
    const pile = Math.min(28, seg.rubbleLevel * 3.2);
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * (seg.w * 0.75);
      this.addRubble(seg.cx + Math.cos(a) * r, seg.cy + Math.sin(a) * r,
        Math.max(0, pile * (1 - r / seg.w) - 2) * Math.random(),
        4 + Math.random() * 7, Math.random() > 0.5 ? seg.color : '#7c7871');
    }
    this._capDebris();
  }

  /** Inicia el colapso en cascada de un edificio completo (se hunde piso por piso) */
  startCollapse(b, credit = false) {
    if (b.collapsing || b.collapsed) return;
    b.collapsing = { t: 0.35, credit, step: 0 };
    this.shake += 6;
    // v4.2: se inclina hacia el lado más dañado, deja un esqueleto dentado y suelta paños de fachada
    let dx = 0, dy = 0, nd = 0;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    for (const sg of b.segs) if (sg.hp < sg.maxHp * 0.6) { dx += sg.cx - bcx; dy += sg.cy - bcy; nd++; }
    if (!nd || Math.hypot(dx, dy) < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); }
    const dl = Math.hypot(dx, dy) || 1;
    b.leanDX = dx / dl; b.leanDY = dy / dl;
    b.lean = 0;
    b.leanMax = Math.min(0.3, 0.05 + b.floors * 0.018 + Math.random() * 0.08);
    b.pancakeZ = 0;
    const partial = b.floors >= 3 && Math.random() < 0.85;
    for (const sg of b.segs) {
      sg.minFloors = 0;
      if (!partial || sg.destroyed) continue;
      const corner = (sg.col === 0 || sg.col === b.cols - 1) && (sg.row === 0 || sg.row === b.rows - 1);
      const edge = sg.kind === 'facade';
      // del lado opuesto a la inclinación quedan más columnas en pie
      const away = ((sg.cx - bcx) * -b.leanDX + (sg.cy - bcy) * -b.leanDY) > 0;
      const p = corner ? 0.6 : edge ? (away ? 0.32 : 0.12) : 0.06;
      if (Math.random() < p) sg.minFloors = Math.min(sg.floorsAlive, 1 + Math.floor(Math.random() * Math.max(1, b.floors * 0.5)));
    }
    const np = Math.max(1, Math.round((1 + Math.random() * 1.5) * this.fxScale));
    for (let k = 0; k < np; k++) this._peelFromBuilding(b, k === 0);
    if (window.SFX) window.SFX.collapse(); else sfx.smash();
    // Crujido inicial: polvo que brota de la base
    for (let k = 0; k < 6; k++) {
      const s = b.segs[Math.floor(Math.random() * b.segs.length)];
      dustCloud(this.particles, s.cx, s.cy, 2, { z: 6, size: 20, speed: 60, life: 2.2 });
    }
  }

  _collapseStep(b) {
    const c = b.collapsing;
    let level = 0;
    for (const s of b.segs) if (s.floorsAlive > (s.minFloors || 0) && s.floorsAlive > level) level = s.floorsAlive;
    if (level <= 0) {
      for (const s of b.segs) if (s.minFloors && s.floorsAlive > 0) { s.skeleton = true; s.cracks = 3; s.dirty = true; this.dirtySegs.push(s); }
      // Final: gran nube de polvo que rueda hacia afuera + cráter de escombro
      b.collapsing = null; b.collapsed = true;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.max(b.w, b.h) * 0.6;
      const n = Math.round(14 * this.fxScale);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        dustCloud(this.particles, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 2, { z: 6, size: 30, speed: 110, life: 3.2, rise: 14, spread: 20 });
      }
      this.addFx({ type: 'ring', x: cx, y: cy, r: R * 0.5, maxR: R * 2.4, life: 0.9, color: '#d9c6a6', alpha: 0.3 });
      this.addRoadCrack(cx, cy, Math.min(2.4, 1 + b.floors * 0.12), 'crater');
      this.shake += 10;
      this.haze = Math.min(1, this.haze + 0.45);
      sfx.explode?.();
      return;
    }
    const credit = c.credit;
    const top = [];
    for (const s of b.segs) if (s.floorsAlive === level && s.floorsAlive > (s.minFloors || 0)) top.push(s);
    const z = (level - 0.5) * FLOOR_H;
    // inclinación progresiva (todo el edificio se reescribe) + losas de piso que se apilan (“pancake”)
    if (b.leanMax) {
      b.lean += (b.leanMax - b.lean) * 0.22;
      for (const s of b.segs) if (!s.destroyed && !top.includes(s)) { s.dirty = true; this.dirtySegs.push(s); }
    }
    {
      const bcx = b.x + b.w / 2 + (b.leanDX || 0) * b.w * 0.12, bcy = b.y + b.h / 2 + (b.leanDY || 0) * b.h * 0.12;
      const nPl = Math.random() < 0.5 * this.fxScale + 0.4 ? 2 : 1;
      for (let i = 0; i < nPl; i++) {
        const w = b.w * rnd(0.32, 0.62), d = b.h * rnd(0.32, 0.62);
        this.addSlab(bcx + rnd(-0.25, 0.25) * b.w, bcy + rnd(-0.25, 0.25) * b.h, b.pancakeZ || 0, w, d, rnd(2.2, 3.2),
          rnd(-0.12, 0.12), Math.random() * Math.PI, rnd(-0.12, 0.12), Math.random() > 0.4 ? '#a7a29a' : top[0]?.color || '#9a958d', 'floor');
      }
      b.pancakeZ = Math.min(b.floors * 3.6, (b.pancakeZ || 0) + 2.6);
    }
    for (const s of top) {
      const newHp = s.maxHp * (level - 1) / s.floors;
      const delta = Math.max(0, s.hp - newHp);
      s.hp = newHp; this.destroyedHp += delta;
      if (credit) this.pendingScore += delta;
      s.floorsAlive = level - 1;
      s.cracks = 3;
      if (s.floorsAlive <= 0) { s.destroyed = true; s.hp = 0; }
      else if (s.minFloors && s.floorsAlive <= s.minFloors) s.skeleton = true;
      s.rubbleLevel++;
      if (Math.random() < 0.6) this.addRubble(s.cx + (Math.random() - 0.5) * s.w, s.cy + (Math.random() - 0.5) * s.h,
        Math.min(26, s.rubbleLevel * 2.6) * Math.random(), 5 + Math.random() * 8, Math.random() > 0.5 ? s.color : '#7c7871');
      s.dirty = true; this.dirtySegs.push(s);
    }
    // Efectos pesados solo en una muestra (rendimiento)
    const heavy = Math.max(2, Math.round(5 * this.fxScale));
    for (let i = 0; i < heavy && top.length; i++) {
      const s = top[Math.floor(Math.random() * top.length)];
      this._floorCollapse(s, level - 1, credit);
    }
    // Polvo que escapa por el perímetro a la altura del piso que cae
    const per = Math.round(4 * this.fxScale);
    for (let i = 0; i < per; i++) {
      const edge = Math.floor(Math.random() * 4), t = Math.random();
      const px = edge < 2 ? b.x + t * b.w : (edge === 2 ? b.x : b.x + b.w);
      const py = edge < 2 ? (edge === 0 ? b.y : b.y + b.h) : b.y + t * b.h;
      dustCloud(this.particles, px, py, 1, { z, size: 26, speed: 70, life: 2.6, rise: 6, spread: 6 });
    }
    this.segVersion++;
    this.shake += 2.2;
    if (c.step++ % 2 === 0) sfx.smash();
    c.t = Math.max(0.09, 0.2 - c.step * 0.012); // acelera al caer
  }

  /** Losa estática (pisos apilados, asfalto levantado, banqueta rota, paneles caídos) */
  addSlab(x, y, z, w, d, t, rx, ry, rz, color, kind = 'floor') {
    const i = this.slabCount % MAX_SLABS;
    this.slabs[i] = { x, y, z, w, d, t, rx, ry, rz, color, kind };
    this.slabCount++;
  }

  /** Superficie del suelo: 'road' | 'sidewalk' | 'block' */
  surfaceAt(x, y) {
    let side = false;
    for (const r of this.roadPos) {
      if ((y >= r && y <= r + ROAD_W) || (x >= r && x <= r + ROAD_W)) return 'road';
      if ((y >= r - SIDEWALK_W && y <= r + ROAD_W + SIDEWALK_W) || (x >= r - SIDEWALK_W && x <= r + ROAD_W + SIDEWALK_W)) side = true;
    }
    return side ? 'sidewalk' : 'block';
  }

  /** Altura del suelo (px) por cráteres: negativa dentro del cuenco, positiva en el borde */
  groundAt(x, y) {
    const cs = this.craters;
    if (!cs.length) return 0;
    let h = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const dx = x - c.x, dy = y - c.y, R = c.r * 1.45;
      if (dx * dx + dy * dy >= R * R) continue;
      h += craterProfile(Math.sqrt(dx * dx + dy * dy) / c.r) * c.depth;
    }
    return h;
  }

  /**
   * v4.2: cráter real en la calle. force ≈ 0,3 (aterrizaje) … 3 (gran explosión / slam cargado).
   * Deforma el suelo (cuenco + borde), grietas radiales, asfalto levantado, banqueta rota, polvo/quemado.
   */
  addCrater(x, y, force = 1, opts = {}) {
    if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) return null;
    // no sobre un edificio en pie
    let blocked = false;
    this.segmentsTouching({ x: x - 2, y: y - 2, w: 4, h: 4 }, sg => { if (sg.height > 0) { blocked = true; return false; } });
    if (blocked) return null;
    const f = Math.max(0.15, Math.min(4, force));
    const r = Math.max(7, Math.min(46, 7 + 15 * Math.sqrt(f)));
    const depth = r * (0.22 + Math.min(0.12, f * 0.03));
    const scorch = !!opts.scorch;
    // fusiona con un cráter cercano (se hace más grande y profundo)
    let c = null;
    for (const o of this.craters) if (Math.hypot(o.x - x, o.y - y) < Math.max(o.r, r) * 0.6) { c = o; break; }
    if (c) {
      c.x += (x - c.x) * 0.25; c.y += (y - c.y) * 0.25;
      c.r = Math.min(56, Math.max(c.r, r) * 1.08);
      c.depth = Math.min(c.r * 0.38, Math.max(c.depth, depth) * 1.1);
      c.scorch = c.scorch || scorch;
      c.ver++;
    } else {
      c = { id: ++this.craterSeq, x, y, r, depth, scorch, ver: 0, surface: this.surfaceAt(x, y) };
      this.craters.push(c);
      while (this.craters.length > (this.craterCap || CRATER_CAP.medium)) this.craters.shift();
    }
    this.craterVersion++;
    // grietas radiales que salen del borde + polvo / quemadura
    const nCr = Math.max(2, Math.round((3 + f * 1.5) * this.fxScale));
    for (let i = 0; i < nCr; i++) {
      const a = (i / nCr) * Math.PI * 2 + Math.random() * 0.6;
      const d = r * rnd(1.45, 1.9);   // fuera del borde levantado (no queda enterrada ni flotando)
      this.cracks[this.crackCount % MAX_CRACKS] = { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, size: Math.min(1.6, 0.35 + r / 40), angle: -a, type: 'crack', radial: true };
      this.crackCount++;
    }
    // (sin calcomanía plana en el centro: flotaría sobre el cuenco; el hollín va en los colores del cráter)
    // losas de asfalto levantadas en el borde, inclinadas hacia afuera
    const surf = c.surface;
    const nSl = Math.max(3, Math.round((4 + r / 3.5) * this.fxScale));
    for (let i = 0; i < nSl; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = c.r * rnd(0.85, 1.25);
      const sw = surf === 'sidewalk' || (surf === 'block' && Math.random() < 0.5);
      const w = rnd(3, 4 + r * 0.22), dd = rnd(2.5, 3 + r * 0.16);
      const tilt = rnd(0.35, 1.0);
      this.addSlab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0, craterProfile(d / c.r) * c.depth) + 0.6,
        w, dd, sw ? 2.2 : 1.6,
        Math.sin(a) * tilt, -a + rnd(-0.4, 0.4), -Math.cos(a) * tilt,
        sw ? '#b9b4aa' : (Math.random() < 0.5 ? '#3d3f43' : '#4a4c50'), sw ? 'sidewalk' : 'asphalt');
    }
    // trozos que saltan + polvo
    const nCh = Math.max(1, Math.round((2 + f * 2) * this.fxScale));
    for (let i = 0; i < nCh; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 110 * Math.sqrt(f);
      const sz = 2.5 + Math.random() * 5;
      this.debris.push(new Body({
        x: x - sz / 2, y: y - sz / 2, w: sz, h: sz * rnd(0.6, 1), th: sz * rnd(0.3, 0.6), z: 1, vz: 80 + Math.random() * 120 * Math.sqrt(f),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, mass: sz / 8, kind: 'debris',
        color: surf === 'road' ? '#45474b' : '#aaa59c', spin: (Math.random() - 0.5) * 10, friction: 0.88, bounce: 0.25,
        data: { chunk: true, shape: 'shard' }, ttl: 25,
      }));
    }
    dustCloud(this.particles, x, y, Math.round(5 + f * 3), { z: 3, size: 10 + r * 0.5, speed: 40 + f * 25, life: 2, rise: 12, color: surf === 'road' ? '#8f8a84' : '#b5ab98' });
    burst(this.particles, x, y, Math.round(6 + f * 4), surf === 'road' ? '#3d3f43' : '#a8a296', { z: 2 });
    this._capDebris();
    return c;
  }

  /** Paño de fachada de un segmento dañado (anchura de una celda) */
  _peelFromSeg(seg, now, prev) {
    if (this.peels.length >= 6) return;
    const bld = this.buildings[seg.buildingId];
    if (!bld) return;
    // normal hacia afuera según el borde en que está la celda
    let nx = 0, ny = 0;
    if (seg.row === 0) ny = -1; else if (seg.row === bld.rows - 1) ny = 1;
    else if (seg.col === 0) nx = -1; else nx = 1;
    this.peels.push({
      x: seg.cx + nx * seg.w * 0.5, y: seg.cy + ny * seg.h * 0.5, nx, ny,
      width: seg.w * rnd(0.85, 1.05), height: (prev - now) * FLOOR_H, z0: now * FLOOR_H,
      ang: 0.02, av: 0.2 + Math.random() * 0.4, color: seg.color, style: bld.style || 0, buildingId: bld.id, thick: 2.2,
    });
  }

  /** Paño grande de fachada al iniciar el colapso: se despega, se inclina y cae plano */
  _peelFromBuilding(b, towardLean) {
    if (this.peels.length >= 6) return;
    let nx, ny;
    if (towardLean && (b.leanDX || b.leanDY)) {
      if (Math.abs(b.leanDX) > Math.abs(b.leanDY)) { nx = Math.sign(b.leanDX); ny = 0; } else { nx = 0; ny = Math.sign(b.leanDY); }
    } else {
      const k = Math.floor(Math.random() * 4); nx = [1, -1, 0, 0][k]; ny = [0, 0, 1, -1][k];
    }
    const sideLen = nx ? b.h : b.w;
    const width = Math.min(sideLen * 0.9, CELL * rnd(2, 4));
    const along = (Math.random() - 0.5) * (sideLen - width);
    const h = Math.max(2, Math.round(b.floors * rnd(0.45, 0.8))) * FLOOR_H;
    const z0 = Math.max(0, b.floors * FLOOR_H - h - FLOOR_H * Math.floor(Math.random() * 2));
    this.peels.push({
      x: nx ? (nx > 0 ? b.x + b.w : b.x) : b.x + b.w / 2 + along,
      y: ny ? (ny > 0 ? b.y + b.h : b.y) : b.y + b.h / 2 + along,
      nx, ny, width, height: h, z0, ang: 0.01, av: 0.12 + Math.random() * 0.2,
      color: b.tint, style: b.style || 0, buildingId: b.id, thick: 2.6, delay: Math.random() * 0.6,
    });
  }

  _updatePeels(dt) {
    const ps = this.peels;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      // gira alrededor de su base (bisagra rota): cada vez más rápido
      p.av += (0.9 + 5.5 * Math.sin(p.ang)) * dt;
      p.ang += p.av * dt;
      if (p.z0 > 0) p.z0 = Math.max(0, p.z0 - (40 + p.av * 50) * dt);   // la base también se desploma
      if (Math.random() < 0.25) dustCloud(this.particles, p.x, p.y, 1, { z: p.z0 + 4, size: 14, speed: 25, life: 1.6 });
      if (p.ang < 1.5) continue;
      // impacto: el paño se rompe en losas sobre la calle
      ps.splice(i, 1);
      const tx = -p.ny, ty = p.nx;
      const reach = p.height * 0.5 + p.z0 * 0.2;
      const n = Math.max(2, Math.round(p.width / 9));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n - 0.5;
        const L = Math.min(p.height * 0.9, 18 + Math.random() * 14);
        const cx = p.x + tx * u * p.width + p.nx * (reach + rnd(-6, 6)), cy = p.y + ty * u * p.width + p.ny * (reach + rnd(-6, 6));
        this.addSlab(cx, cy, 0.8, p.width / n * rnd(0.8, 1.05), L, p.thick, rnd(-0.08, 0.08), Math.atan2(p.nx, p.ny) + rnd(-0.25, 0.25), rnd(-0.08, 0.08), p.color, 'facade');
        if (k % 2 === 0) dustCloud(this.particles, cx, cy, 2, { z: 3, size: 22, speed: 70, life: 2.6, rise: 10 });
        if (Math.random() < 0.5) glassShards(this.particles, cx, cy, 3, 5);
      }
      const mx = p.x + p.nx * reach, my = p.y + p.ny * reach;
      for (let k = 0; k < 3; k++) {
        const u = (Math.random() - 0.5) * p.width;
        this.cracks[this.crackCount % MAX_CRACKS] = { x: mx + tx * u, y: my + ty * u, size: 0.8 + Math.random() * 0.6, angle: Math.random() * Math.PI * 2, type: 'crack' };
        this.crackCount++;
      }
      if (p.height > 60) this.addCrater(mx, my, Math.min(1.4, p.height / 120));
      this.shake += Math.min(6, p.height / 30);
      this.haze = Math.min(1, this.haze + 0.06);
      if (window.SFX?.collapse) window.SFX.collapse(); else sfx.smash();
    }
  }

  addRubble(x, y, z, s, color) {
    const i = this.rubbleCount % MAX_RUBBLE;
    this.rubble[i] = { x, y, z, s, rx: Math.random() * 6, ry: Math.random() * 6, color };
    this.rubbleCount++;
  }

  _capDebris() {
    const cap = this.debrisCap || MAX_DEBRIS;
    if (this.debris.length <= cap) return;
    // Convierte los más viejos en reposo a escombro estático decorativo
    let excess = this.debris.length - cap;
    for (const d of this.debris) {
      if (excess <= 0) break;
      if (!d.alive || d.grabbed || d.frozen || d.data.carPart) continue;
      if (d.liftZ > 0 || d.speed > 5) continue;
      d.alive = false;
      this.addRubble(d.cx, d.cy, 0, Math.max(d.w, d.h) * 0.6, d.color);
      excess--;
    }
  }

  damageProp(prop, dmg, fromX, fromY) {
    if (prop.destroyed || dmg <= 0) return 0;
    const applied = Math.min(prop.hp, dmg);
    prop.hp -= applied;
    this.destroyedHp += applied;
    burst(this.particles, prop.cx, prop.cy, 4, prop.kind === 'tree' ? TREE : prop.kind === 'lamp' ? '#555' : '#c0392b', { z: 10 });

    if (prop.hp <= 0) {
      prop.destroyed = true;
      prop.toppled = true;
      prop.angle = fromX != null
        ? Math.atan2(prop.cy - fromY, prop.cx - fromX)
        : Math.random() * Math.PI * 2;
      if (prop.kind === 'tree') {
        dustCloud(this.particles, prop.cx, prop.cy, 3, { color: '#4f7a3a', size: 10 });
      } else if (prop.kind === 'hydrant') {
        prop.spraying = 6;
        sfx.hydrant();
        this.debris.push(new Body({
          x: prop.x, y: prop.y, w: 8, h: 8, th: 10, vz: 120,
          vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100,
          mass: 1.5, kind: 'debris', color: '#c0392b', damageOnHit: 10,
        }));
      } else if (prop.kind === 'lamp') {
        sparks(this.particles, prop.cx, prop.cy, 40, 10);
      }
      sfx.smash();
      this.propVersion++;
    }
    return applied;
  }

  addRoadCrack(x, y, size = 1, type = 'crack') {
    const i = this.crackCount % MAX_CRACKS;
    this.cracks[i] = { x, y, size, angle: Math.random() * Math.PI * 2, type };
    this.crackCount++;
  }

  addFx(fx) {
    fx.maxLife = fx.life;
    this.fx.push(fx);
    if (this.fx.length > 40) this.fx.shift();
  }

  /** Explosión visual + daño radial. Devuelve daño aplicado. */
  explosion(x, y, z, power = 1, credit = false) {
    const crater = z < 25 ? this.addCrater(x, y, 0.5 + power * 0.9, { scorch: true }) : null;
    fireBurst(this.particles, x, y, z + 4, Math.round(14 * power), 0.8 + power * 0.5);
    sparks(this.particles, x, y, z + 6, Math.round(18 * power), 260 * power);
    dustCloud(this.particles, x, y, Math.round(6 * power), { z: 6, size: 18 * power, color: '#4a4440', life: 2.6, rise: 30 });
    for (let i = 0; i < 6 * power; i++) smokePuff(this.particles, x, y, z + 10, { size: 12 * power, life: 2.4, color: '#2c2a28' });
    this.addFx({ type: 'flash', x, y, z: z + 12, intensity: 1.0 + power, life: 0.35, color: '#ffaa55' });
    this.addFx({ type: 'ring', x, y, r: 10, maxR: 60 + 70 * power, life: 0.45, color: '#ffb070' });
    this.addFx({ type: 'shockwave', x, y, z: z + 4, r: 6, maxR: 55 + 60 * power, life: 0.55, color: '#ffd2a0' });
    this.shake += 5 + 7 * power;
    this.haze = Math.min(1, this.haze + 0.12 * power);
    if (!crater) this.addRoadCrack(x, y, 0.8 + power * 0.6, 'crater');
    this.fires.push({ x, y, z: 4, life: 2 + power * 2 });
    if (window.SFX) window.SFX.explosion(Math.max(0.2, Math.min(3, 0.5 + power * 0.8))); else sfx.explode?.();
    const r = 50 + 40 * power;
    let dmg = this.applyRadialDamage(x, y, r, 18 * power, 260 * power, credit);
    if (this.onExplosion) dmg += this.onExplosion(x, y, r, power, credit) || 0;
    return dmg;
  }

  applyRadialDamage(cx, cy, radius, damage, knock = 0, credit = false) {
    let score = 0;
    this.segmentsInRadius(cx, cy, radius, seg => {
      const d = Math.hypot(seg.cx - cx, seg.cy - cy);
      const falloff = Math.max(0.15, 1 - d / (radius + 1));
      score += this.damageSegment(seg, damage * falloff, credit);
    });
    for (const prop of this.props) {
      if (prop.destroyed) continue;
      if (circleHitAABB(cx, cy, radius, prop)) {
        const d = Math.hypot(prop.cx - cx, prop.cy - cy);
        score += this.damageProp(prop, damage * Math.max(0.2, 1 - d / (radius + 1)), cx, cy);
      }
    }
    if (knock > 0) {
      for (const d of this.debris) {
        if (!d.alive || d.grabbed) continue;
        const dx = d.cx - cx, dy = d.cy - cy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < radius) {
          if (d.frozen) { d.frozen = false; }
          const f = (1 - dist / radius) * knock / Math.max(0.6, d.mass);
          d.vx += (dx / dist) * f;
          d.vy += (dy / dist) * f;
          d.vz += f * 0.35;
          d.spin += (Math.random() - 0.5) * 10;
          d.tumbleRate = (Math.random() - 0.5) * 14;
          if (credit) d.playerTouch = 3;
        }
      }
    }
    if (damage > 15) this.addRoadCrack(cx, cy, Math.min(2.2, 0.5 + damage / 60));
    return score;
  }

  crushAt(cx, cy, radius, damage, credit = false) {
    let score = 0;
    let best = null;
    let bestD = Infinity;
    this.segmentsInRadius(cx, cy, radius, seg => {
      const d = Math.hypot(seg.cx - cx, seg.cy - cy);
      if (d < bestD) { best = seg; bestD = d; }
    });
    if (best) {
      const b = best;
      score += this.damageSegment(b, damage, credit);
      this.segmentsInRadius(b.cx, b.cy, 16 + radius * 0.5, seg => {
        if (seg !== b) score += this.damageSegment(seg, damage * 0.4, credit);
      });
    }
    for (const prop of this.props) {
      if (prop.destroyed) continue;
      if (Math.hypot(prop.cx - cx, prop.cy - cy) < radius) {
        score += this.damageProp(prop, damage * 0.6, cx, cy);
      }
    }
    return score;
  }

  /**
   * Cuerpo en movimiento contra estructuras: daño = masa × velocidad.
   * Si destruye la columna con energía de sobra, la atraviesa.
   */
  debrisHitsStructures(body) {
    const spd = body.speed;
    if (spd < 40) return 0;
    let score = 0;
    const credit = body.playerTouch > 0;
    const dmg = impactDamage(body.mass, spd);
    let hitSeg = null;
    this.segmentsTouching(body, s => {
      if ((body.liftZ || 0) < s.height) { hitSeg = s; return false; }
    });
    if (hitSeg) {
      const seg = hitSeg;
      const hpBefore = seg.hp;
      score += this.damageSegment(seg, dmg, credit);
      if (dmg > 60) {
        this.segmentsInRadius(seg.cx, seg.cy, 30, s => {
          if (s !== seg) score += this.damageSegment(s, dmg * 0.3, credit);
        });
      }
      sparks(this.particles, body.cx, body.cy, (body.liftZ || 0) + 6, 3, 120, '#ffcf7a');
      if (seg.destroyed && dmg > hpBefore * 1.3) {
        const keep = Math.sqrt(Math.max(0.1, 1 - hpBefore / dmg));
        body.vx *= keep; body.vy *= keep;     // atraviesa
      } else {
        // rebote: sale por la normal
        const nx = body.cx - seg.cx, ny = body.cy - seg.cy;
        if (Math.abs(nx) > Math.abs(ny)) body.vx = Math.sign(nx || 1) * Math.abs(body.vx) * 0.35;
        else body.vy = Math.sign(ny || 1) * Math.abs(body.vy) * 0.35;
        this.resolveStructures(body);
      }
      body.damageOnHit *= 0.85;
    }
    if ((body.liftZ || 0) < 40) {
      for (const prop of this.props) {
        if (prop.destroyed) continue;
        if (aabbOverlap(body, prop)) {
          score += this.damageProp(prop, dmg, body.cx - body.vx, body.cy - body.vy);
          body.vx *= 0.7; body.vy *= 0.7;
          break;
        }
      }
    }
    return score;
  }

  /** Preferencia: congelados > voladores > más cercano */
  findGrabbableNear(x, y, radius, extra = []) {
    let best = null;
    let bestScore = Infinity;
    const consider = (b) => {
      if (!b.alive || b.grabbed || b.driven) return;
      if (b.static && b.kind !== 'vehicle') return;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d > radius) return;
      let s = d;
      if (b.frozen) s -= 60;
      else if (b.liftZ > 4 || b.speed > 80) s -= 30;
      if (s < bestScore) { best = b; bestScore = s; }
    };
    for (const b of this.debris) consider(b);
    for (const b of extra) consider(b);
    return best;
  }

  update(dt) {
    // Partículas (compactación in-place)
    const ps = this.particles;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.update(dt);
      if (p.alive) ps[j++] = p;
    }
    ps.length = j;
    {
      const db = this.debris;
      let k = 0;
      for (let i = 0; i < db.length; i++) if (db[i].alive) db[k++] = db[i];
      db.length = k;
    }

    for (const prop of this.props) {
      if (prop.toppled && prop.fall < 1) prop.fall = Math.min(1, prop.fall + dt * 2.2);
      if (prop.spraying > 0) {
        prop.spraying -= dt;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 10 + Math.random() * 25;
          addParticle(ps, prop.cx, prop.cy, {
            z: 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 160 + Math.random() * 90,
            life: 1.1, size: 2.5, color: '#9fd3ff', type: 'water', gravity: 1, drag: 0.99,
          });
        }
      }
    }

    for (const f of this.fires) {
      f.life -= dt;
      if (Math.random() < 0.6) fireBurst(ps, f.x + (Math.random() - 0.5) * 8, f.y + (Math.random() - 0.5) * 8, f.z, 1, 0.5);
      if (Math.random() < 0.3) smokePuff(ps, f.x, f.y, f.z + 14, { size: 9, life: 2.2 });
    }
    if (this.fires.length) this.fires = this.fires.filter(f => f.life > 0);

    for (const b of this.buildings) {
      if (!b.collapsing) continue;
      b.collapsing.t -= dt;
      if (b.collapsing.t <= 0) this._collapseStep(b);
    }
    if (this.peels.length) this._updatePeels(dt);
    if (this.haze > 0) this.haze = Math.max(0, this.haze - dt * 0.04);

    for (const fx of this.fx) {
      fx.life -= dt;
      if (fx.type === 'ring' || fx.type === 'shockwave') fx.r += (fx.maxR - fx.r) * Math.min(1, (fx.type === 'shockwave' ? 7 : 9) * dt);
    }
    if (this.fx.length) this.fx = this.fx.filter(f => f.life > 0);
  }
}

/** Daño de impacto escalado por masa × velocidad */
export function impactDamage(mass, speed) {
  return 0.05 * mass * speed;
}
