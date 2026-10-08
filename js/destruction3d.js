// v4.2 — Destrucción realista: fractura en losas irregulares, varillas dobladas, coronas dentadas,
// esqueletos con pisos expuestos, paños de fachada que se desprenden, edificios que se inclinan
// y cráteres reales que deforman la calle. Todo instanciado y con topes por calidad (móvil).
import * as THREE from 'three';
import { FLOOR_H, MAX_SLABS, craterProfile } from './world.js';
import { mergeGeometries } from './carmodel.js';

const S = 0.1;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _hex = new Map();
function hexOf(css) {
  let h = _hex.get(css);
  if (h === undefined) { if (_hex.size > 400) _hex.clear(); h = _c.set(css).getHex(); _hex.set(css, h); }
  return h;
}

// ——— generador pseudoaleatorio determinista ———
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function rng(seed) { let r = seed * 9301 + 49297; return () => { r = (r * 9301 + 49297) % 233280; return r / 233280; }; }

/** Losa irregular tipo “celda de Voronoi”: polígono convexo-ish extruido, en caja unitaria (±0,5) */
export function makeSlabGeometry(seed = 1, n = 8) {
  const R = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
    // radio de un cuadrado redondeado con mordidas irregulares
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const r = 0.5 * Math.min(1.3, sq) * (0.72 + R() * 0.28);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -0.5);
  geo.rotateX(-Math.PI / 2);
  // ligera ondulación de las caras (no planas perfectas)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + Math.sin(x * 7.1 + seed) * Math.cos(z * 5.3) * 0.08);
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox, sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  geo.scale(1 / sx, 1, 1 / sz);
  const ng = ni(geo);
  ng.computeVertexNormals();
  ng.clearGroups();
  return ng;
}

/** Varillas de acero dobladas que salen de un borde de la losa (en espacio unitario) */
export function makeRebarGeometry(seed = 3, count = 4) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const z = -0.38 + (i / Math.max(1, count - 1)) * 0.76 + (R() - 0.5) * 0.06;
    const l1 = 0.18 + R() * 0.22, l2 = 0.12 + R() * 0.25;
    const bend = 0.5 + R() * 1.1;           // ángulo del doblez
    const a = new THREE.BoxGeometry(l1, 0.09, 0.022);
    a.translate(0.5 + l1 / 2 - 0.04, 0, z);
    const b = new THREE.BoxGeometry(l2, 0.09, 0.022);
    b.translate(l2 / 2, 0, 0);
    b.rotateZ(bend * (R() < 0.5 ? 1 : -1));
    b.rotateY((R() - 0.5) * 0.6);
    b.translate(0.5 + l1 - 0.06, 0, z);
    parts.push(ni(a), ni(b));
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** Fragmento afilado pequeño (vidrio/concreto) */
function makeShardGeometry(seed = 5) {
  const geo = ni(new THREE.OctahedronGeometry(0.6, 0));
  const R = rng(seed);
  const pos = geo.attributes.position;
  const off = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (!off.has(k)) off.set(k, [0.5 + R() * 0.9, 0.35 + R() * 0.5, 0.5 + R() * 0.9]);
    const [a, b, c] = off.get(k);
    pos.setXYZ(i, pos.getX(i) * a, pos.getY(i) * b, pos.getZ(i) * c);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Corona dentada (muros rotos + losa de piso expuesta que sobresale) para una celda 1×1, altura 1 */
function makeCrownGeometry(seed = 7) {
  const R = rng(seed);
  const parts = [];
  const T = 0.09;
  for (let side = 0; side < 4; side++) {
    const n = 7;
    const pts = [new THREE.Vector2(-0.5, 0)];
    for (let i = 0; i <= n; i++) {
      const u = -0.5 + i / n;
      const h = R() < 0.25 ? 0.05 + R() * 0.15 : 0.3 + R() * 0.7;
      pts.push(new THREE.Vector2(u, h));
    }
    pts.push(new THREE.Vector2(0.5, 0));
    const g = ni(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: T, bevelEnabled: false }));
    g.translate(0, 0, -0.5);          // cara exterior en z = -0.5
    g.rotateY(side * Math.PI / 2);
    parts.push(g);
  }
  // losa de piso expuesta (sobresale e irregular)
  const slab = makeSlabGeometry(seed + 11, 9);
  slab.scale(1.12, 0.07, 1.12);
  slab.translate(0, 0.02, 0);
  parts.push(slab);
  const g = mergeGeometries(parts.map(p => { p.clearGroups(); if (p.attributes.uv) p.deleteAttribute('uv'); return p; }));
  g.computeVertexNormals();
  return g;
}

/** Varillas verticales que asoman de columnas rotas (celda 1×1, altura 1) */
function makeCrownRebar(seed = 9) {
  const R = rng(seed);
  const parts = [];
  for (const [cx, cz] of [[-0.43, -0.43], [0.43, -0.43], [-0.43, 0.43], [0.43, 0.43]]) {
    for (let k = 0; k < 3; k++) {
      const h = 0.4 + R() * 0.7;
      const b = new THREE.BoxGeometry(0.018, h, 0.018);
      b.translate(0, h / 2, 0);
      b.rotateX((R() - 0.5) * 0.9); b.rotateZ((R() - 0.5) * 0.9);
      b.translate(cx + (R() - 0.5) * 0.06, 0.3, cz + (R() - 0.5) * 0.06);
      parts.push(ni(b));
    }
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** Esqueleto de un piso: 4 columnas + losa irregular + vigas en dos lados (celda 1×1×1) */
function makeSkeletonGeometry(seed = 13) {
  const parts = [];
  for (const [cx, cz] of [[-0.43, -0.43], [0.43, -0.43], [-0.43, 0.43], [0.43, 0.43]]) {
    const c = new THREE.BoxGeometry(0.13, 1, 0.13); c.translate(cx, 0.5, cz); parts.push(ni(c));
  }
  const slab = makeSlabGeometry(seed, 10); slab.scale(1.06, 0.08, 1.06); slab.translate(0, 0.04, 0); parts.push(slab);
  const b1 = new THREE.BoxGeometry(1, 0.1, 0.12); b1.translate(0, 0.95, -0.44); parts.push(ni(b1));
  const b2 = new THREE.BoxGeometry(0.12, 0.1, 1); b2.translate(0.44, 0.95, 0); parts.push(ni(b2));
  const g = mergeGeometries(parts.map(p => { p.clearGroups(); if (p.attributes.uv) p.deleteAttribute('uv'); return p; }));
  g.computeVertexNormals();
  return g;
}

/** Textura de grietas radiales + hollín/polvo para el interior del cráter (canvas, se genera una vez) */
function makeCraterOverlay() {
  const N = 256;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const R = rng(17);
  const cx = N / 2;
  // centro oscuro (tierra / hollín) que se desvanece
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, N * 0.36);
  grd.addColorStop(0, 'rgba(30,26,22,0.75)'); grd.addColorStop(0.55, 'rgba(45,40,34,0.45)'); grd.addColorStop(1, 'rgba(60,54,46,0)');
  g.fillStyle = grd; g.fillRect(0, 0, N, N);
  // grietas radiales ramificadas
  g.strokeStyle = 'rgba(12,10,8,0.85)'; g.lineCap = 'round';
  const crack = (x, y, a, len, w, depth) => {
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    let px = x, py = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      a += (R() - 0.5) * 0.7;
      px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
      g.lineTo(px, py);
      if (depth > 0 && R() < 0.3) { g.stroke(); crack(px, py, a + (R() - 0.5) * 1.6, len * 0.45, w * 0.6, depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(px, py); }
    }
    g.stroke();
  };
  for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2 + R() * 0.4; crack(cx + Math.cos(a) * N * 0.12, cx + Math.sin(a) * N * 0.12, a, N * (0.22 + R() * 0.18), 2.4, 2); }
  // grava
  for (let i = 0; i < 500; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * N * 0.34;
    g.fillStyle = R() < 0.5 ? 'rgba(20,18,16,0.6)' : 'rgba(150,140,125,0.45)';
    g.fillRect(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 1 + R() * 2.5, 1 + R() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Mancha de polvo (decal plano, claro) */
export function makeDustTexture() {
  const N = 128;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const R = rng(23);
  for (let i = 0; i < 26; i++) {
    const x = N / 2 + (R() - 0.5) * N * 0.5, y = N / 2 + (R() - 0.5) * N * 0.5, r = N * (0.12 + R() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(190,178,156,0.22)'); grd.addColorStop(1, 'rgba(190,178,156,0)');
    g.fillStyle = grd; g.fillRect(0, 0, N, N);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CRATER_SEG = { high: [9, 32], medium: [8, 26], low: [6, 20] };
const SKEL_CAP = 1600;
const PEEL_CAP = 260;

export class Destruction3D {
  /**
   * @param {object} o { group, world, groundMesh, groundSpan:{minX,minY,spanX,spanY}, buildingMat, facadeGeos, quality }
   */
  constructor(o) {
    this.group = o.group;
    this.world = o.world;
    this.quality = o.quality || 'medium';
    this.span = o.groundSpan;
    const g = this.group;

    // ——— materiales (pueden recibir texturas CC0 más tarde: setTextures) ———
    this.concreteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.02, flatShading: true });
    this.rebarMat = new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 0.7, metalness: 0.55 });
    this.crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02, flatShading: true });
    this.skelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.03, flatShading: true });
    for (const m of [this.concreteMat, this.rebarMat, this.crownMat, this.skelMat]) m.userData = { own: true };

    const inst = (geo, mat, cap, { dyn = false, shadow = true } = {}) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      if (dyn) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.userData.ownMat = false;
      g.add(m);
      return m;
    };
    const cap = (this.world.debrisCap || 380) + 120;
    // escombro dinámico
    this.slabGeo = makeSlabGeometry(4, 8);
    this.rebarGeo = makeRebarGeometry(3, 4);
    this.slabDyn = inst(this.slabGeo, this.concreteMat, cap, { dyn: true });
    this.rebarDyn = inst(this.rebarGeo, this.rebarMat, cap, { dyn: true, shadow: false });
    this.shardDyn = inst(makeShardGeometry(5), this.concreteMat, cap, { dyn: true });
    // losas estáticas (pisos apilados / asfalto / banqueta / paneles caídos)
    this.slabStatic = inst(makeSlabGeometry(9, 9), this.concreteMat, MAX_SLABS);
    this.rebarStatic = inst(makeRebarGeometry(8, 3), this.rebarMat, MAX_SLABS, { shadow: false });
    this.slabStatic.count = 0; this.rebarStatic.count = 0;
    this._slabSeen = 0;
    // coronas dentadas + varillas sobre columnas rotas, y esqueletos
    const nSeg = Math.max(1, this.world.segments.length);
    this.crownMesh = inst(makeCrownGeometry(7), this.crownMat, nSeg);
    this.crownRebar = inst(makeCrownRebar(9), this.rebarMat, nSeg, { shadow: false });
    this.crownMesh.count = nSeg; this.crownRebar.count = nSeg;
    for (let i = 0; i < nSeg; i++) { this.crownMesh.setMatrixAt(i, ZERO_M); this.crownRebar.setMatrixAt(i, ZERO_M); this.crownMesh.setColorAt(i, _c.set(0xffffff)); }
    this.skelMesh = inst(makeSkeletonGeometry(13), this.skelMat, SKEL_CAP);
    this.skelMesh.count = 0; this._skelNext = 0;
    // paños de fachada que caen (mismo material/atlas que los edificios → ventanas incluidas)
    this.peelMesh = inst(o.facadeGeos?.[0] || new THREE.BoxGeometry(1, 1, 1), o.buildingMat || this.concreteMat, PEEL_CAP, { dyn: true });
    this.peelMesh.setColorAt(0, _c.set(0xffffff));

    // ——— cráteres ———
    this.groundMesh = o.groundMesh;
    this.groundMat = o.groundMesh?.material;
    this.craterOverlayTex = makeCraterOverlay();
    this.craterOverlayTex.channel = 1;
    this.overlayMat = new THREE.MeshStandardMaterial({
      map: this.craterOverlayTex, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.craterMeshes = new Map();   // id → { mesh, overlay, ver }
    this._craterVersion = -1;
    this._crUniform = { value: [] };
    this._crCount = { value: 0 };
    for (let i = 0; i < 32; i++) this._crUniform.value.push(new THREE.Vector4(0, 0, -1, 0));
    if (this.groundMat) this._patchGround(this.groundMat);
    if (o.outerMesh) this.patchHoles(o.outerMesh.material);   // el pasto de afuera (y=-0,05) también se recorta
  }

  /** Recorta el suelo plano donde hay cráteres (las mallas deformadas ocupan ese hueco) */
  _patchGround(mat) {
    const U = this._crUniform, N = this._crCount;
    const prev = mat.onBeforeCompile;
    mat.vertexColors = true;
    const pg = this.groundMesh.geometry;
    if (!pg.attributes.color) {
      const n = pg.attributes.position.count;
      pg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      pg.setAttribute('aCrater', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    }
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      sh.uniforms.uCr = U; sh.uniforms.uCrN = N;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCrater; varying float vCrater; varying vec2 vCrW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrater = aCrater; vCrW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uCr[32]; uniform int uCrN; varying float vCrater; varying vec2 vCrW;')
        .replace('void main() {', `void main() {
          if (vCrater < 0.5) {
            for (int i = 0; i < 32; i++) {
              if (i >= uCrN) break;
              vec2 d = vCrW - uCr[i].xy;
              if (dot(d, d) < uCr[i].z) discard;
            }
          }`);
    };
    mat.customProgramCacheKey = () => 'ground-craters-v1';
    mat.needsUpdate = true;
  }

  /** Recorta cualquier plano (sin malla de cráter propia) donde hay cráteres */
  patchHoles(mat) {
    const U = this._crUniform, N = this._crCount;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      sh.uniforms.uCr = U; sh.uniforms.uCrN = N;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCrW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uCr[32]; uniform int uCrN; varying vec2 vCrW;')
        .replace('void main() {', `void main() {
          for (int i = 0; i < 32; i++) {
            if (i >= uCrN) break;
            vec2 d = vCrW - uCr[i].xy;
            if (dot(d, d) < uCr[i].z) discard;
          }`);
    };
    mat.customProgramCacheKey = () => 'holes-craters-v1';
    mat.needsUpdate = true;
  }

  setQuality(q) { this.quality = q; }

  /** v4.3: decal CC0 de cráter (atlas a|b) sobre el cuenco; cada cráter usa una mitad */
  setCraterDecal(tex) {
    if (!tex) return;
    tex.channel = 1;
    this.overlayMat.map = tex; this.overlayMat.alphaTest = 0.02; this.overlayMat.needsUpdate = true;
    this._decalAtlas = true;
    this._craterVersion = -1;   // reconstruye las mallas con las UV nuevas
  }

  /** Texturas CC0 opcionales (se aplican cuando terminan de cargar) */
  setTextures({ concrete, rebar, crownMap } = {}) {
    if (concrete) { Object.assign(this.concreteMat, concrete); this.concreteMat.flatShading = true; this.concreteMat.needsUpdate = true; }
    if (crownMap) { Object.assign(this.crownMat, crownMap); this.crownMat.needsUpdate = true; Object.assign(this.skelMat, crownMap); this.skelMat.needsUpdate = true; }
    if (rebar) { Object.assign(this.rebarMat, rebar); this.rebarMat.needsUpdate = true; }
  }

  // ——————————————— edificios ———————————————
  /** Llamado desde Renderer3D._writeSegment: corona dentada / esqueleto con la misma inclinación */
  writeSegExtras(seg, b, color, leanQ, tanL) {
    const i = seg.index;
    const broken = seg.floorsAlive > 0 && seg.floorsAlive < seg.floors;
    if (broken) {
      const zTop = seg.floorsAlive * FLOOR_H;
      const hh = FLOOR_H * 0.55;
      const zc = zTop;   // base de la corona sobre el último piso vivo
      let px = seg.cx, py = seg.cy;
      if (tanL) { px += b.leanDX * (zc + hh * 0.5) * tanL; py += b.leanDY * (zc + hh * 0.5) * tanL; }
      _q.setFromAxisAngle(_ax.set(0, 1, 0), ((seg.index * 7) % 4) * Math.PI / 2);
      if (leanQ) _q.premultiply(leanQ);
      _p.set(px * S, zc * S, py * S);
      _s.set(seg.w * S, hh * S, seg.h * S);
      _m.compose(_p, _q, _s);
      this.crownMesh.setMatrixAt(i, _m);
      this.crownRebar.setMatrixAt(i, _m);
      const k = 0.78;
      this.crownMesh.setColorAt(i, _c.setRGB(color.r * k, color.g * k, color.b * k));
    } else {
      this.crownMesh.setMatrixAt(i, ZERO_M);
      this.crownRebar.setMatrixAt(i, ZERO_M);
    }
    this._crownDirty = true;
  }

  /** ¿Puede dibujarse como esqueleto? (reserva espacio en el pool la primera vez) */
  skelSlot(seg) {
    if (seg.skelStart != null) return true;
    if (this._skelNext + seg.floors > SKEL_CAP) return false;
    seg.skelStart = this._skelNext;
    this._skelNext += seg.floors;
    this.skelMesh.count = this._skelNext;
    for (let f = 0; f < seg.floors; f++) this.skelMesh.setMatrixAt(seg.skelStart + f, ZERO_M);
    return true;
  }

  setSkelFloor(seg, f, matrix, color, alive) {
    const i = seg.skelStart + f;
    if (!alive) { this.skelMesh.setMatrixAt(i, ZERO_M); this._skelDirty = true; return; }
    this.skelMesh.setMatrixAt(i, matrix);
    const k = 0.7;
    this.skelMesh.setColorAt(i, _c.setRGB(0.55 + color.r * 0.25 * k, 0.55 + color.g * 0.25 * k, 0.55 + color.b * 0.25 * k));
    this._skelDirty = true;
  }

  flushBuildings() {
    if (this._crownDirty) {
      this._crownDirty = false;
      this.crownMesh.instanceMatrix.needsUpdate = true; this.crownRebar.instanceMatrix.needsUpdate = true;
      if (this.crownMesh.instanceColor) this.crownMesh.instanceColor.needsUpdate = true;
    }
    if (this._skelDirty) {
      this._skelDirty = false;
      this.skelMesh.instanceMatrix.needsUpdate = true;
      if (this.skelMesh.instanceColor) this.skelMesh.instanceColor.needsUpdate = true;
    }
  }

  // ——————————————— escombro dinámico ———————————————
  beginDebris() { this._nS = 0; this._nR = 0; this._nH = 0; }

  /** Devuelve true si este cuerpo lo dibuja este módulo */
  pushDebris(d, q, yOff, col) {
    const shape = d.data.shape;
    if (shape === 'slab') {
      const i = this._nS++;
      if (i >= this.slabDyn.instanceMatrix.count) return true;
      _p.set(d.cx * S, (d.liftZ + d.th * 0.5) * S + yOff, d.cy * S);
      _s.set(d.w * S, d.th * S, d.h * S);
      _m.compose(_p, q, _s);
      this.slabDyn.setMatrixAt(i, _m);
      this.slabDyn.setColorAt(i, col);
      if (d.data.rebar) this.rebarDyn.setMatrixAt(this._nR++, _m);
      return true;
    }
    if (shape === 'shard') {
      const i = this._nH++;
      if (i >= this.shardDyn.instanceMatrix.count) return true;
      _p.set(d.cx * S, (d.liftZ + d.th * 0.4) * S + yOff, d.cy * S);
      _s.set(d.w * S, d.th * S, d.h * S);
      _m.compose(_p, q, _s);
      this.shardDyn.setMatrixAt(i, _m);
      this.shardDyn.setColorAt(i, col);
      return true;
    }
    return false;
  }

  endDebris() {
    const a = this.slabDyn, r = this.rebarDyn, h = this.shardDyn;
    a.count = Math.min(this._nS, a.instanceMatrix.count); r.count = this._nR; h.count = Math.min(this._nH, h.instanceMatrix.count);
    a.instanceMatrix.needsUpdate = true; r.instanceMatrix.needsUpdate = true; h.instanceMatrix.needsUpdate = true;
    if (a.instanceColor) a.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
  }

  // ——————————————— losas estáticas ———————————————
  syncSlabs() {
    const w = this.world;
    if (w.slabCount === this._slabSeen) return;
    const start = Math.max(this._slabSeen, w.slabCount - MAX_SLABS);
    for (let k = start; k < w.slabCount; k++) {
      const i = k % MAX_SLABS;
      const sl = w.slabs[i];
      _e.set(sl.rx, sl.ry, sl.rz, 'YXZ');
      _q.setFromEuler(_e);
      const gz = sl.kind === 'asphalt' || sl.kind === 'sidewalk' ? 0 : this.world.groundAt(sl.x, sl.y);
      _p.set(sl.x * S, (sl.z + sl.t * 0.5) * S + Math.max(-0.4, gz * S), sl.y * S);
      _s.set(sl.w * S, sl.t * S, sl.d * S);
      _m.compose(_p, _q, _s);
      this.slabStatic.setMatrixAt(i, _m);
      _c.setHex(hexOf(sl.color)).multiplyScalar(0.82 + ((k * 37) % 20) / 100);
      this.slabStatic.setColorAt(i, _c);
      this.rebarStatic.setMatrixAt(i, sl.kind === 'floor' || sl.kind === 'facade' ? _m : ZERO_M);
    }
    this._slabSeen = w.slabCount;
    const n = Math.min(w.slabCount, MAX_SLABS);
    this.slabStatic.count = n; this.rebarStatic.count = n;
    this.slabStatic.instanceMatrix.needsUpdate = true; this.rebarStatic.instanceMatrix.needsUpdate = true;
    if (this.slabStatic.instanceColor) this.slabStatic.instanceColor.needsUpdate = true;
  }

  // ——————————————— paños de fachada ———————————————
  syncPeels() {
    const ps = this.world.peels;
    let n = 0;
    const pm = this.peelMesh;
    for (const p of ps) {
      const cells = Math.max(1, Math.round(p.width / 26));
      const floors = Math.max(1, Math.round(p.height / FLOOR_H));
      const cw = p.width / cells;
      // eje de giro = tangente del muro; el panel se inclina hacia la normal exterior
      _ax.set(p.ny, 0, -p.nx).normalize();
      _q.setFromAxisAngle(_ax, p.ang);
      _q2.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(p.nx, p.ny));
      _q2.premultiply(_q);
      const tx = -p.ny, ty = p.nx;
      _c.setHex(hexOf(p.color)).multiplyScalar(0.92);
      for (let f = 0; f < floors; f++) for (let k = 0; k < cells; k++) {
        if (n >= PEEL_CAP) break;
        const u = (k + 0.5) * cw - p.width / 2;
        const v = (f + 0.5) * FLOOR_H;
        // punto local (u a lo largo, v arriba, -thick/2 hacia adentro) → girar alrededor de la bisagra
        _v.set(tx * u - p.nx * p.thick * 0.5, v, ty * u - p.ny * p.thick * 0.5).applyQuaternion(_q);
        _p.set((p.x + _v.x) * S, (p.z0 + _v.y) * S, (p.y + _v.z) * S);
        _s.set(cw * S, FLOOR_H * S, p.thick * S);
        _m.compose(_p, _q2, _s);
        pm.setMatrixAt(n, _m);
        pm.setColorAt(n, _c);
        n++;
      }
    }
    if (n || pm.count) {
      pm.count = n;
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }
  }

  // ——————————————— cráteres ———————————————
  syncCraters() {
    const w = this.world;
    if (w.craterVersion === this._craterVersion) return;
    this._craterVersion = w.craterVersion;
    const live = new Set();
    const U = this._crUniform.value;
    let n = 0;
    for (const c of w.craters) {
      live.add(c.id);
      const R = c.r * 1.45;
      if (n < 32) U[n++].set(c.x * S, c.y * S, (R * S * 0.97) ** 2, 0);
    }
    this._crCount.value = n;
    for (const [id, e] of this.craterMeshes) {
      if (!live.has(id)) {
        this.group.remove(e.mesh); this.group.remove(e.overlay);
        e.mesh.geometry.dispose();
        this.craterMeshes.delete(id);
      }
    }
    // reconstruye todas (las alturas se suman donde se solapan): solo ocurre al crear un cráter
    for (const c of w.craters) {
      let e = this.craterMeshes.get(c.id);
      const geo = this._craterGeometry(c);
      if (!e) {
        const mesh = new THREE.Mesh(geo, this.groundMat);
        mesh.receiveShadow = true; mesh.castShadow = true; mesh.frustumCulled = true;
        const overlay = new THREE.Mesh(geo, this.overlayMat);
        overlay.receiveShadow = true; overlay.renderOrder = 2;
        this.group.add(mesh); this.group.add(overlay);
        e = { mesh, overlay };
        this.craterMeshes.set(c.id, e);
      } else {
        e.mesh.geometry.dispose();
        e.mesh.geometry = geo; e.overlay.geometry = geo;
      }
    }
  }

  _craterGeometry(c) {
    const [rings, segs] = CRATER_SEG[this.quality] || CRATER_SEG.medium;
    const w = this.world, sp = this.span;
    const R = c.r * 1.45;
    const nV = 1 + rings * segs;
    const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), uv1 = new Float32Array(nV * 2), col = new Float32Array(nV * 3), cr = new Float32Array(nV).fill(1);
    const idx = [];
    const R2 = rng(c.id * 13 + 7);
    const put = (i, x, y, t) => {
      const h = w.groundAt(x, y);
      pos[i * 3] = x * S; pos[i * 3 + 1] = h * S; pos[i * 3 + 2] = y * S;
      uv[i * 2] = (x - sp.minX) / sp.spanX; uv[i * 2 + 1] = 1 - (y - sp.minY) / sp.spanY;
      // uv local del cráter para la textura de grietas (cubre ~1,3 r)
      if (this._decalAtlas) {   // foto: la mancha ocupa ~70 % de la imagen → cubre el cuenco (~0,9 r)
        const lu = Math.min(0.998, Math.max(0.002, 0.5 + (x - c.x) / (c.r * 2.3))), lv = Math.min(0.998, Math.max(0.002, 0.5 - (y - c.y) / (c.r * 2.3)));
        uv1[i * 2] = (lu + (c.id % 2)) * 0.5; uv1[i * 2 + 1] = lv;
      } else { uv1[i * 2] = 0.5 + (x - c.x) / (c.r * 2.6); uv1[i * 2 + 1] = 0.5 - (y - c.y) / (c.r * 2.6); }
      // color: interior más oscuro (oclusión/tierra), borde con polvo claro, hollín si fue explosión
      let k = 1;
      if (t < 1) k = 0.48 + 0.52 * t * t;
      else if (t < 1.3) k = 1.08;
      if (c.scorch) k *= t < 1.15 ? 0.55 + 0.35 * Math.min(1, t) : 1;
      const dust = t > 0.85 && t < 1.35 ? 0.06 : 0;
      col[i * 3] = Math.min(1.2, k + dust); col[i * 3 + 1] = Math.min(1.2, k + dust * 0.9); col[i * 3 + 2] = Math.min(1.2, k + dust * 0.7);
    };
    put(0, c.x, c.y, 0);
    for (let r = 1; r <= rings; r++) {
      const t = (r / rings) ** 0.85 * 1.45;     // anillos más densos cerca del centro
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const jitter = r < rings ? 1 + (R2() - 0.5) * 0.12 : 1;   // borde irregular (excepto el último anillo)
        const rr = t * c.r * jitter;
        put(1 + (r - 1) * segs + s, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, t * jitter);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
        const c2 = a + segs, d = b + segs;
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aCrater', new THREE.BufferAttribute(cr, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Altura visual del suelo (m) para objetos apoyados */
  groundY(x, y) { return this.world.craters.length ? this.world.groundAt(x, y) * S : 0; }

  sync() {
    this.syncCraters();
    this.syncSlabs();
    this.syncPeels();
    this.flushBuildings();
  }
}
