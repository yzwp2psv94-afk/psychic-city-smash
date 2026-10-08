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
export const N_ROADS = 4;
export const PITCH = BLOCK + ROAD_W + SIDEWALK_W * 2; // 330
export const WORLD_SIZE = (N_ROADS + 1) * BLOCK + N_ROADS * (ROAD_W + SIDEWALK_W * 2); // 1550

export const MAX_DEBRIS = 380;
export const MAX_RUBBLE = 2400;
export const MAX_CRACKS = 180;

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
    this.generate();
  }

  generate() {
    this.segments = [];
    this.props = [];
    this.debris = [];
    this.particles = [];
    this.cracks = [];       // ring buffer {x,y,size,angle,type}
    this.crackCount = 0;
    this.rubble = [];       // ring buffer {x,y,z,s,rx,ry,color}
    this.rubbleCount = 0;
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
    // Cine de destrucción
    this.shake = 0;          // sacudida acumulada (la consume Game)
    this.haze = 0;           // polvo en el aire tras colapsos (niebla)
    this.pendingScore = 0;   // puntos de colapsos en cascada (crédito al jugador)
    this.debrisCap = this.debrisCap || MAX_DEBRIS;
    this.fxScale = this.fxScale || 1;

    const W = this.w, H = this.h;
    const roadPos = [];
    for (let i = 0; i < N_ROADS; i++) roadPos.push(BLOCK + SIDEWALK_W + i * PITCH);
    this.roadPos = roadPos;

    for (const ry of roadPos) {
      this.roads.push({ x: 0, y: ry, w: W, h: ROAD_W, horiz: true });
      this.sidewalks.push({ x: 0, y: ry - SIDEWALK_W, w: W, h: SIDEWALK_W });
      this.sidewalks.push({ x: 0, y: ry + ROAD_W, w: W, h: SIDEWALK_W });
    }
    for (const rx of roadPos) {
      this.roads.push({ x: rx, y: 0, w: ROAD_W, h: H, horiz: false });
      this.sidewalks.push({ x: rx - SIDEWALK_W, y: 0, w: SIDEWALK_W, h: H });
      this.sidewalks.push({ x: rx + ROAD_W, y: 0, w: SIDEWALK_W, h: H });
    }
    for (const rx of roadPos) for (const ry of roadPos) {
      this.intersections.push({ x: rx, y: ry, w: ROAD_W, h: ROAD_W });
    }

    // Tipos de manzana
    const n = N_ROADS + 1;
    const center = Math.floor(n / 2);
    const types = [];
    for (let by = 0; by < n; by++) for (let bx = 0; bx < n; bx++) {
      let t;
      if (bx === center && by === center) t = 'plaza';
      else {
        const r = Math.random();
        t = r < 0.3 ? 'tower' : r < 0.6 ? 'split2' : r < 0.84 ? 'split4' : r < 0.92 ? 'parking' : 'park';
      }
      types.push({ bx, by, t });
    }
    // Garantiza al menos un estacionamiento cerca del centro (autos para lanzar)
    const near = types.find(b => b.bx === center + 1 && b.by === center);
    if (near) near.t = 'parking';

    let bid = 0;
    for (const { bx, by, t } of types) {
      const x0 = bx * PITCH, y0 = by * PITCH;
      const blk = { x: x0, y: y0, w: BLOCK, h: BLOCK, type: t };
      this.blocks.push(blk);
      const m = 12;
      if (t === 'tower') {
        this._buildBuilding(x0 + m, y0 + m, BLOCK - 2 * m, BLOCK - 2 * m, bid++, 6 + Math.floor(Math.random() * 5));
      } else if (t === 'split2') {
        const horiz = Math.random() > 0.5;
        const g = 10;
        const half = (BLOCK - 2 * m - g) / 2;
        for (let k = 0; k < 2; k++) {
          const fl = 3 + Math.floor(Math.random() * 6);
          if (horiz) this._buildBuilding(x0 + m, y0 + m + k * (half + g), BLOCK - 2 * m, half, bid++, fl);
          else this._buildBuilding(x0 + m + k * (half + g), y0 + m, half, BLOCK - 2 * m, bid++, fl);
        }
      } else if (t === 'split4') {
        const g = 10;
        const half = (BLOCK - 2 * m - g) / 2;
        for (let k = 0; k < 4; k++) {
          const fl = 2 + Math.floor(Math.random() * 5);
          this._buildBuilding(x0 + m + (k % 2) * (half + g), y0 + m + Math.floor(k / 2) * (half + g), half, half, bid++, fl);
        }
      } else if (t === 'parking') {
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
          if (Math.random() < 0.25) continue;
          this.parkingSpots.push({
            x: x0 + 40 + c * 50, y: y0 + 55 + r * 120,
            angle: Math.PI / 2 + (r ? Math.PI : 0) + (Math.random() - 0.5) * 0.1,
          });
        }
        this.props.push(new Prop(x0 + 8, y0 + 8, 'tree', { w: 18, h: 18, hp: 30 }));
        this.props.push(new Prop(x0 + BLOCK - 26, y0 + BLOCK - 26, 'tree', { w: 18, h: 18, hp: 30 }));
      } else if (t === 'park') {
        for (let i = 0; i < 9; i++) {
          const tx = x0 + 20 + Math.random() * (BLOCK - 60);
          const ty = y0 + 20 + Math.random() * (BLOCK - 60);
          this.props.push(new Prop(tx, ty, 'tree', { w: 20, h: 20, hp: 30, scale: 0.9 + Math.random() * 0.6 }));
        }
      } else if (t === 'plaza') {
        for (let i = 0; i < 4; i++) {
          const cxp = x0 + (i % 2 ? BLOCK - 34 : 16);
          const cyp = y0 + (i < 2 ? 16 : BLOCK - 34);
          this.props.push(new Prop(cxp, cyp, 'tree', { w: 18, h: 18, hp: 30, scale: 1.2 }));
        }
        this.props.push(new Prop(x0 + BLOCK / 2 - 8, y0 + 20, 'lamp', { w: 6, h: 6, hp: 18 }));
        this.props.push(new Prop(x0 + BLOCK / 2 - 8, y0 + BLOCK - 26, 'lamp', { w: 6, h: 6, hp: 18 }));
        this.spawn = { x: x0 + BLOCK / 2, y: y0 + BLOCK / 2 };
      }
    }
    if (!this.spawn) this.spawn = { x: W / 2, y: H / 2 };

    // Hidrantes en esquinas, faroles en banquetas
    for (const rx of roadPos) for (const ry of roadPos) {
      this.props.push(new Prop(rx - 13, ry - 13, 'hydrant', { w: 9, h: 9, hp: 20 }));
    }
    for (const r of roadPos) {
      for (let s = 60; s < W; s += 165) {
        if (this._inIntersectionBand(s)) continue;
        this.props.push(new Prop(s, r - 9, 'lamp', { w: 6, h: 6, hp: 18 }));
        this.props.push(new Prop(r + ROAD_W + 3, s, 'lamp', { w: 6, h: 6, hp: 18 }));
      }
    }

    this.segments.forEach((s, i) => { s.index = i; });
    this.totalHp = this.segments.reduce((s, seg) => s + seg.maxHp, 0)
      + this.props.reduce((s, p) => s + p.maxHp, 0);
  }

  _inIntersectionBand(s) {
    for (const r of this.roadPos) if (s > r - 30 && s < r + ROAD_W + 30) return true;
    return false;
  }

  _buildBuilding(bx, by, bw, bh, bid, floors) {
    const tint = TINTS[Math.floor(Math.random() * TINTS.length)];
    const cols = Math.max(2, Math.floor(bw / CELL));
    const rows = Math.max(2, Math.floor(bh / CELL));
    const actualW = cols * CELL;
    const actualH = rows * CELL;
    const ox = bx + (bw - actualW) / 2;
    const oy = by + (bh - actualH) / 2;
    const b = { id: bid, x: ox, y: oy, w: actualW, h: actualH, floors, tint, segs: [], cols, rows,
      damagedCols: 0, collapsing: null, collapsed: false };
    this.buildings.push(b);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
        const seg = new Segment(ox + c * CELL, oy + r * CELL, CELL, CELL, {
          kind: isEdge ? 'facade' : 'core', color: tint, buildingId: bid, floors,
        });
        seg.col = c; seg.row = r;
        b.segs.push(seg);
        this.segments.push(seg);
      }
    }
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
        data: { chunk: true },
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
    sfx.smash();
    // Crujido inicial: polvo que brota de la base
    for (let k = 0; k < 6; k++) {
      const s = b.segs[Math.floor(Math.random() * b.segs.length)];
      dustCloud(this.particles, s.cx, s.cy, 2, { z: 6, size: 20, speed: 60, life: 2.2 });
    }
  }

  _collapseStep(b) {
    const c = b.collapsing;
    let level = 0;
    for (const s of b.segs) if (s.floorsAlive > level) level = s.floorsAlive;
    if (level <= 0) {
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
    for (const s of b.segs) if (s.floorsAlive === level) top.push(s);
    const z = (level - 0.5) * FLOOR_H;
    for (const s of top) {
      const newHp = s.maxHp * (level - 1) / s.floors;
      const delta = Math.max(0, s.hp - newHp);
      s.hp = newHp; this.destroyedHp += delta;
      if (credit) this.pendingScore += delta;
      s.floorsAlive = level - 1;
      s.cracks = 3;
      if (s.floorsAlive <= 0) { s.destroyed = true; s.hp = 0; }
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
    fireBurst(this.particles, x, y, z + 4, Math.round(14 * power), 0.8 + power * 0.5);
    sparks(this.particles, x, y, z + 6, Math.round(18 * power), 260 * power);
    dustCloud(this.particles, x, y, Math.round(6 * power), { z: 6, size: 18 * power, color: '#4a4440', life: 2.6, rise: 30 });
    for (let i = 0; i < 6 * power; i++) smokePuff(this.particles, x, y, z + 10, { size: 12 * power, life: 2.4, color: '#2c2a28' });
    this.addFx({ type: 'flash', x, y, z: z + 12, intensity: 1.0 + power, life: 0.35, color: '#ffaa55' });
    this.addFx({ type: 'ring', x, y, r: 10, maxR: 60 + 70 * power, life: 0.45, color: '#ffb070' });
    this.addFx({ type: 'shockwave', x, y, z: z + 4, r: 6, maxR: 55 + 60 * power, life: 0.55, color: '#ffd2a0' });
    this.shake += 5 + 7 * power;
    this.haze = Math.min(1, this.haze + 0.12 * power);
    this.addRoadCrack(x, y, 0.8 + power * 0.6, 'crater');
    this.fires.push({ x, y, z: 4, life: 2 + power * 2 });
    sfx.explode?.();
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
    if (this.debris.some(d => !d.alive)) this.debris = this.debris.filter(d => d.alive);

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
