/**
 * Modelos 3D de autos (v4) — cuerpos redondeados "lofteados" (secciones
 * superelípticas) por tipo: sedán, hatchback, SUV, pickup, deportivo, taxi,
 * furgón y bus. Pintura metalizada con reflejos (envMap), vidrio polarizado,
 * faros / luces traseras emisivas (se encienden más al frenar), espejos,
 * patentes, llantas con rayos (instanciadas), LOD para autos lejanos.
 *
 * Deformación: cada abolladura del auto (v.dents: {lx, ly, nx, ny, depth, top},
 * en px locales) empuja los vértices cercanos al punto de impacto + arruga
 * (capó que se levanta, techo que se hunde). Sólo se deforma cerca de la
 * cámara y con presupuesto por cuadro (móvil).
 */

import * as THREE from 'three';
import { makeCrackedGlass, makeBlobShadow } from './textures.js';

const S = 0.1;
let shared = null;
const ENV = { tex: null, mats: new Set() };
let QUALITY = 'medium';
let deformBudget = 2;
const LOD_DIST = 58;       // m — más lejos: malla simple
const DEFORM_DIST = 45;    // m — más lejos: no se recalculan vértices

export function setCarQuality(q) { QUALITY = q; }
export function resetCarFrameBudget(n = 2) { deformBudget = n; }
export function carDeformBudget() { return deformBudget; }
export function useCarDeformBudget() { deformBudget--; }
export function carQuality() { return QUALITY; }
export function setCarEnvMap(tex) {
  ENV.tex = tex;
  for (const m of ENV.mats) { m.envMap = tex; m.needsUpdate = true; }
}
export function releaseEnvMat(m) { ENV.mats.delete(m); }
export function envMat(m, intensity = 1) {
  m.envMapIntensity = intensity;
  if (ENV.tex) m.envMap = ENV.tex;
  ENV.mats.add(m);
  return m;
}

function rimTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 128, 128);
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 56);
  grad.addColorStop(0, '#e9edf0'); grad.addColorStop(0.75, '#9aa2a8'); grad.addColorStop(1, '#5d6368');
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1b1d20';
  for (let i = 0; i < 5; i++) {           // huecos entre rayos
    const a = i / 5 * Math.PI * 2;
    g.beginPath(); g.moveTo(64 + Math.cos(a + 0.28) * 20, 64 + Math.sin(a + 0.28) * 20);
    g.arc(64, 64, 48, a + 0.22, a + 1.03); g.lineTo(64 + Math.cos(a + 0.98) * 20, 64 + Math.sin(a + 0.98) * 20);
    g.closePath(); g.fill();
  }
  g.fillStyle = '#c7ccd1'; g.beginPath(); g.arc(64, 64, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#555'; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.beginPath(); g.arc(64 + Math.cos(a) * 8, 64 + Math.sin(a) * 8, 1.6, 0, 7); g.fill(); }
  g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 57, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd21a'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#111'; g.font = 'bold 24px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('TAXI', 64, 17);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function getShared() {
  if (shared) return shared;
  shared = {
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 }),
    rim: envMat(new THREE.MeshStandardMaterial({ map: rimTexture(), roughness: 0.3, metalness: 0.85 }), 1.2),
    glass: envMat(new THREE.MeshStandardMaterial({ color: 0x0e1820, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.86 }), 1.1),
    glassCracked: envMat(new THREE.MeshStandardMaterial({ map: makeCrackedGlass(), roughness: 0.35, metalness: 0.4 }), 0.8),
    glassBroken: new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.95, metalness: 0 }),
    trim: envMat(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.3 }), 0.6),
    chrome: envMat(new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.18, metalness: 1 }), 1.4),
    head: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c0, emissiveIntensity: 1.2, roughness: 0.2 }),
    lightOff: new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.5 }),
    sign: new THREE.MeshStandardMaterial({ map: signTexture(), emissive: 0xffd21a, emissiveIntensity: 0.6, roughness: 0.4 }),
    blob: new THREE.MeshBasicMaterial({ map: makeBlobShadow(), transparent: true, depthWrite: false, opacity: 0.9 }),
    charred: new THREE.MeshStandardMaterial({ color: 0x221e1b, roughness: 0.97, metalness: 0.05 }),
    geoCache: new Map(),
  };
  return shared;
}

/** Une geometrías (posición, normal, uv; opcional color) */
export function mergeGeometries(geoms) {
  let nV = 0, nI = 0;
  const hasColor = geoms.every(g => g.attributes.color);
  for (const g of geoms) { nV += g.attributes.position.count; nI += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  const col = hasColor ? new Float32Array(nV * 3) : null;
  const idx = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3); nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (col) col.set(g.attributes.color.array, vo * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = i + vo; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Loft: secciones [x, yb, yt, hwb, hwt] (m). Cada sección es una
 * superelipse (exponente p) cuyo ancho va de hwb (abajo) a hwt (arriba).
 */
function loft(secs, N = 16, p = 4, caps = true) {
  const pos = [], uv = [], idx = [];
  const e = 2 / p;
  const ring = (s, si) => {
    const [x, yb, yt, hwb, hwt] = s;
    const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
    for (let k = 0; k < N; k++) {
      const th = k / N * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), e);
      const ey = Math.sign(sn) * Math.pow(Math.abs(sn), e);
      const hw = hwb + (hwt - hwb) * (ey + 1) / 2;
      pos.push(x, yc + ey * hh, ex * hw);
      uv.push(si / (secs.length - 1), k / N);
    }
  };
  secs.forEach(ring);
  for (let i = 0; i < secs.length - 1; i++) {
    for (let k = 0; k < N; k++) {
      const a = i * N + k, b = i * N + (k + 1) % N, c = (i + 1) * N + k, d = (i + 1) * N + (k + 1) % N;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [si, flip] of [[0, true], [secs.length - 1, false]]) {
      const base = pos.length / 3;
      const s = secs[si];
      for (let k = 0; k < N; k++) {
        const j = (si * N + k) * 3;
        pos.push(pos[j] + (flip ? -0.001 : 0.001), pos[j + 1], pos[j + 2]); uv.push(0.5, 0.5);
      }
      pos.push(s[0] + (flip ? -0.002 : 0.002), (s[1] + s[2]) / 2, 0); uv.push(0.5, 0.5);
      const cI = base + N;
      for (let k = 0; k < N; k++) {
        const a = base + k, b = base + (k + 1) % N;
        if (flip) idx.push(cI, a, b); else idx.push(cI, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, seg = 1) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  g.translate(x, y, z);
  return g;
}

/** caja fina entre dos puntos (parantes) */
function strut(p0, p1, t, tz = t) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, len, tz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function archTrim(x, z, r, side) {
  const g = new THREE.TorusGeometry(r + 0.04, 0.05, 4, 10, Math.PI);
  g.translate(x, 0, 0);       // el toro está en el plano XY
  g.translate(0, r, z + side * 0.005);
  return g;
}

function plateTexture(text, yellow) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 40;
  const g = c.getContext('2d');
  g.fillStyle = yellow ? '#f3c623' : '#f1f3f5'; g.fillRect(0, 0, 128, 40);
  g.fillStyle = '#1d4fa8'; g.fillRect(0, 0, 128, 8);
  g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 37);
  g.fillStyle = '#151515'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 25);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ————————————————————————————————————————————————— perfiles por tipo
// alturas en metros; x en fracción del largo; ancho en fracción de W/2
const PROFILES = {
  sedan:  { hb: 0.30, rh: 0.88, ht: 0.95, fh: 0.84, xr: -0.36, xrt: -0.2, xft: 0.1, xf: 0.26, roof: 1.42, p: 4, wr: 0.34, wx: [0.31, -0.31] },
  taxi:   { hb: 0.30, rh: 0.88, ht: 0.95, fh: 0.84, xr: -0.36, xrt: -0.2, xft: 0.1, xf: 0.26, roof: 1.42, p: 4, wr: 0.34, wx: [0.31, -0.31] },
  hatch:  { hb: 0.30, rh: 0.92, ht: 0.95, fh: 0.84, xr: -0.47, xrt: -0.42, xft: 0.08, xf: 0.24, roof: 1.45, p: 4, wr: 0.32, wx: [0.32, -0.32] },
  suv:    { hb: 0.40, rh: 1.08, ht: 1.12, fh: 1.02, xr: -0.47, xrt: -0.44, xft: 0.12, xf: 0.25, roof: 1.80, p: 6, wr: 0.42, wx: [0.31, -0.31] },
  pickup: { hb: 0.40, rh: 1.02, ht: 1.05, fh: 1.0, xr: -0.1, xrt: -0.08, xft: 0.12, xf: 0.24, roof: 1.75, p: 6, wr: 0.42, wx: [0.32, -0.3], bed: true },
  sports: { hb: 0.24, rh: 0.74, ht: 0.80, fh: 0.66, xr: -0.32, xrt: -0.14, xft: 0.04, xf: 0.2, roof: 1.16, p: 3.5, wr: 0.34, wx: [0.31, -0.31] },
  van:    { hb: 0.36, rh: 1.0, ht: 1.02, fh: 0.98, xr: -0.495, xrt: -0.49, xft: 0.2, xf: 0.36, roof: 2.0, p: 7, wr: 0.38, wx: [0.33, -0.32], cargo: 0.12 },
  bus:    { hb: 0.42, rh: 1.2, ht: 1.22, fh: 1.18, xr: -0.495, xrt: -0.49, xft: 0.47, xf: 0.495, roof: 2.75, p: 10, wr: 0.5, wx: [0.33, -0.27], bus: true },
};

function lerpKeys(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1], [x1, y1] = keys[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return keys[keys.length - 1][1];
}

/** sección del cuerpo a la altura x (m) → [yb, yt, hwb, hwt] */
function makeBodyFn(P, L, W) {
  const hw = W / 2;
  const topK = [[-0.5, P.rh - 0.08], [-0.47, P.rh], [-0.36, P.ht], [P.xf, P.ht - 0.02], [0.44, P.fh + 0.02], [0.49, P.fh - 0.04], [0.5, P.fh - 0.12]];
  if (P.bus) topK.splice(0, topK.length, [-0.5, P.rh - 0.06], [-0.48, P.rh], [0.48, P.fh], [0.5, P.fh - 0.06]);
  const wK = [[-0.5, 0.84], [-0.48, 0.95], [-0.42, 1], [0.42, 1], [0.48, 0.95], [0.5, 0.84]];
  const botK = [[-0.5, P.hb + 0.1], [-0.46, P.hb + 0.02], [-0.4, P.hb], [0.4, P.hb], [0.46, P.hb + 0.03], [0.5, P.hb + 0.12]];
  return (xf) => {
    const w = lerpKeys(wK, xf) * hw;
    return [lerpKeys(botK, xf), lerpKeys(topK, xf), w, w * 0.94];
  };
}
const BODY_XS = [-0.5, -0.49, -0.47, -0.42, -0.33, -0.2, -0.05, 0.1, 0.25, 0.36, 0.44, 0.48, 0.495, 0.5];

/** punto de la superficie superelíptica en el ángulo th */
function surfPt(sec, th, p, off = 0) {
  const [yb, yt, hwb, hwt] = sec;
  const e = 2 / p, c = Math.cos(th), s = Math.sin(th);
  const ex = Math.sign(c) * Math.pow(Math.abs(c), e), ey = Math.sign(s) * Math.pow(Math.abs(s), e);
  const hw = hwb + (hwt - hwb) * (ey + 1) / 2;
  const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
  return [yc + ey * (hh + off), ex * (hw + off)];
}

/** semiancho de una sección superelíptica a la altura y */
function zAt(sec, y, p) {
  const [yb, yt, hwb, hwt] = sec;
  const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
  const ey = Math.max(-1, Math.min(1, (y - yc) / hh));
  const hw = hwb + (hwt - hwb) * (ey + 1) / 2;
  return Math.pow(Math.max(0, 1 - Math.pow(Math.abs(ey), p)), 1 / p) * hw;
}

/** parche sobre la carrocería (puertas, capó, junturas) */
function patch(fn, P, L, x0, x1, th0, th1, off, nx = 6, nt = 5) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nx; i++) {
    const xf = x0 + (x1 - x0) * i / nx;
    const sec = fn(xf);
    for (let k = 0; k <= nt; k++) {
      const th = th0 + (th1 - th0) * k / nt;
      const [y, z] = surfPt(sec, th, P.p, off);
      pos.push(xf * L, y, z); uv.push(i / nx, k / nt);
    }
  }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nt; k++) {
    const a = i * (nt + 1) + k, b = a + 1, c = a + nt + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function paintCol(g, color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** geometría por tipo (compartida por todos los autos de ese tipo y tamaño) */
function buildGeometry(type, L, W) {
  const P = PROFILES[type] || PROFILES.sedan;
  const fn = makeBodyFn(P, L, W);
  const hw = W / 2;
  const out = { paint: [], hood: [], doorL: [], doorR: [], bumper: [], trim: [], glass: [], head: [], tail: [], plate: [], sign: [] };
  // cuerpo
  out.paint.push(loft(BODY_XS.map(x => [x * L, ...fn(x)]), 18, P.p));
  const ht = P.ht;
  // cabina
  const cw = hw * (P.bus ? 0.97 : 0.86), ctw = hw * (P.bus ? 0.95 : P.p >= 6 ? 0.8 : 0.7);
  const cyb = ht - 0.16;
  const cabin = (x0, x1, xt0, xt1, roof) => [
    [x0 * L, cyb, ht + 0.02, cw * 0.98, cw * 0.9],
    [(x0 * 0.45 + xt0 * 0.55) * L, cyb, ht + (roof - ht) * 0.62, cw, (cw + ctw) / 2],
    [xt0 * L, cyb, roof, cw, ctw],
    [xt1 * L, cyb, roof, cw, ctw],
    [(x1 * 0.55 + xt1 * 0.45) * L, cyb, ht + (roof - ht) * 0.55, cw, (cw + ctw) / 2],
    [x1 * L, cyb, ht + 0.02, cw * 0.98, cw * 0.9],
  ];
  if (P.bus) {
    out.glass.push(loft([[-0.493 * L, ht - 0.1, P.roof, cw, ctw], [0.493 * L, ht - 0.1, P.roof, cw, ctw]], 16, 10));
    out.paint.push(loft([[-0.495 * L, P.roof - 0.08, P.roof + 0.22, ctw * 1.02, ctw * 0.92], [0.495 * L, P.roof - 0.08, P.roof + 0.22, ctw * 1.02, ctw * 0.92]], 16, 8));
    for (let x = -0.44; x < 0.45; x += 0.11) for (const sd of [-1, 1]) out.paint.push(box(0.1, P.roof - ht + 0.05, 0.03, x * L, (ht + P.roof) / 2, sd * (cw + 0.005)));
    out.paint.push(box(0.12, 0.08, W * 0.98, 0.494 * L, P.roof - 0.4, 0));
  } else if (P.cargo != null) {
    // furgón: caja pintada atrás + parabrisas al frente
    const c = cabin(P.xr, P.xf, P.xrt, P.xft, P.roof);
    const cut = P.cargo;
    out.paint.push(loft([[P.xr * L, cyb, P.roof, cw, ctw], [cut * L, cyb, P.roof, cw, ctw]], 16, P.p));
    out.glass.push(loft([[cut * L - 0.02, cyb, P.roof - 0.01, cw * 0.99, ctw * 0.99], c[3], c[4], c[5]], 16, P.p, true));
    out.paint.push(loft([[P.xr * L + 0.05, P.roof - 0.04, P.roof + 0.04, ctw * 1.01, ctw * 0.95], [P.xft * L, P.roof - 0.04, P.roof + 0.04, ctw * 1.01, ctw * 0.95]], 12, 8));
  } else {
    const c = cabin(P.xr, P.xf, P.xrt, P.xft, P.roof);
    out.glass.push(loft(c, 16, Math.max(6, P.p)));
    // techo pintado
    out.paint.push(loft([
      [(P.xrt - 0.01) * L, P.roof - 0.035, P.roof + 0.0, ctw * 0.96, ctw * 0.9],
      [(P.xrt + 0.02) * L, P.roof - 0.04, P.roof + 0.035, ctw * 1.03, ctw * 0.95],
      [(P.xft - 0.02) * L, P.roof - 0.04, P.roof + 0.035, ctw * 1.03, ctw * 0.95],
      [(P.xft + 0.01) * L, P.roof - 0.035, P.roof + 0.0, ctw * 0.96, ctw * 0.9],
    ], 14, 8));
    // parantes A, B, C
    const csec = [cyb, P.roof, cw, ctw], cp = Math.max(6, P.p);
    for (const sd of [-1, 1]) {
      const zl = cw * 0.97, zt = zAt(csec, P.roof - 0.05, cp) + 0.01;
      out.paint.push(strut([P.xf * L, ht, sd * zl], [P.xft * L, P.roof - 0.03, sd * zt], 0.07, 0.05));
      out.paint.push(strut([P.xr * L, ht, sd * zl], [P.xrt * L, P.roof - 0.03, sd * zt], 0.1, 0.05));
      const bx = (P.xrt * 0.45 + P.xft * 0.55) * L;
      out.paint.push(strut([bx, ht, sd * (cw + 0.005)], [bx, P.roof - 0.03, sd * (zt + 0.005)], 0.07, 0.04));
    }
  }
  // capó (parche superior) + juntura oscura/motor debajo
  const thTop0 = 0.62, thTop1 = Math.PI - 0.62;
  const hx0 = P.bus ? 0.4 : P.xf + 0.01, hx1 = 0.475;
  if (!P.bus) {
    out.hood.push(patch(fn, P, L, hx0, hx1, thTop0, thTop1, 0.018, 6, 6));
    out.trim.push(patch(fn, P, L, hx0 - 0.01, hx1 + 0.01, thTop0 - 0.08, thTop1 + 0.08, 0.006, 4, 5));
  }
  // puertas (parches laterales) + junturas
  const dx0 = P.bus ? 0.3 : P.cargo != null ? P.cargo + 0.02 : P.xr + 0.03, dx1 = P.bus ? 0.44 : P.xf - 0.02;
  const th0 = -0.55, th1 = 0.78;
  for (const [key, a0, a1] of [['doorR', th0, th1], ['doorL', Math.PI - th1, Math.PI - th0]]) {
    out[key].push(patch(fn, P, L, dx0, dx1, a0, a1, 0.016, 6, 5));
    out.trim.push(patch(fn, P, L, dx0 - 0.008, dx1 + 0.008, a0 - 0.06, a1 + 0.06, 0.007, 3, 4));
    // espejo + manija
    const sd = key === 'doorR' ? 1 : -1;
    if (!P.bus) {
      out[key].push(box(0.14, 0.1, 0.2, (P.xf - 0.03) * L, ht + 0.08, sd * (hw + 0.1)));
      out[key].push(strut([(P.xf - 0.03) * L, ht + 0.04, sd * (hw - 0.04)], [(P.xf - 0.03) * L, ht + 0.06, sd * (hw + 0.04)], 0.04));
      out[key].push(box(0.16, 0.03, 0.03, (dx0 + 0.04) * L + 0.4, ht - 0.12, sd * (hw + 0.025)));
    }
  }
  // paragolpes delantero (pieza que se cae) y trasero
  const bb = P.hb + 0.02, bt = P.hb + (P.bus ? 0.32 : 0.24);
  out.bumper.push(loft([[0.47 * L, bb, bt, hw * 0.9, hw * 0.9], [0.505 * L, bb, bt, hw * 0.96, hw * 0.96], [0.518 * L, bb + 0.02, bt - 0.02, hw * 0.84, hw * 0.84]], 12, 5));
  out.trim.push(loft([[-0.518 * L, bb + 0.02, bt - 0.02, hw * 0.84, hw * 0.84], [-0.505 * L, bb, bt, hw * 0.96, hw * 0.96], [-0.47 * L, bb, bt, hw * 0.9, hw * 0.9]], 12, 5));
  // parrilla, guardabarros
  const fy = P.fh - (P.bus ? 0.25 : 0.17);
  out.trim.push(box(0.05, 0.12, hw * 0.75, 0.497 * L, fy - 0.05, 0));
  for (const wx of P.wx) for (const sd of [-1, 1]) out.trim.push(archTrim(wx * L, sd * hw * 0.99, P.wr, sd));
  // luces
  for (const sd of [-1, 1]) {
    out.head.push(box(0.06, 0.1, hw * 0.42, 0.493 * L, fy, sd * hw * 0.62));
    out.tail.push(box(0.06, P.bus ? 0.3 : 0.11, hw * (P.bus ? 0.2 : 0.4), -0.495 * L, P.rh - (P.bus ? 0.4 : 0.17), sd * hw * 0.64));
  }
  // patentes
  const pl = new THREE.PlaneGeometry(0.5, 0.13); pl.rotateY(Math.PI / 2); pl.translate(0.522 * L, (bb + bt) / 2, 0);
  const pr = new THREE.PlaneGeometry(0.5, 0.13); pr.rotateY(-Math.PI / 2); pr.translate(-0.522 * L, (bb + bt) / 2 + 0.25, 0);
  out.plate.push(pl, pr);
  // pickup: caja de carga oscura
  if (P.bed) {
    out.trim.push(patch(fn, P, L, -0.48, P.xr - 0.015, 0.5, Math.PI - 0.5, 0.012, 5, 4));
    out.trim.push(box(0.05, 0.08, W * 0.8, -0.47 * L, P.rh + 0.02, 0));
  }
  if (type === 'taxi') {
    out.sign.push(box(0.22, 0.17, 0.62, ((P.xrt + P.xft) / 2) * L, P.roof + 0.11, 0));
  }
  const geo = {};
  for (const [k, list] of Object.entries(out)) if (list.length) geo[k] = mergeGeometries(list.map(g => g.index ? g : g));
  // LOD: un solo mesh con colores por vértice (pintura blanca → tinte por material)
  const white = new THREE.Color(1, 1, 1), dark = new THREE.Color(0.06, 0.08, 0.1);
  const lodBody = paintCol(loft([-0.5, -0.4, 0, 0.4, 0.5].map(x => [x * L, ...fn(x)]), 8, P.p), white);
  const lodCab = P.bus
    ? paintCol(loft([[-0.49 * L, ht - 0.1, P.roof, cw, ctw], [0.49 * L, ht - 0.1, P.roof, cw, ctw]], 8, 8), dark)
    : paintCol(loft([[P.xr * L, cyb, ht + 0.02, cw, cw], [P.xrt * L, cyb, P.roof, cw, ctw], [P.xft * L, cyb, P.roof, cw, ctw], [P.xf * L, cyb, ht + 0.02, cw, cw]], 8, 6), dark);
  geo.lod = mergeGeometries([lodBody, lodCab]);
  geo.P = P;
  return geo;
}

export function getTypeGeo(type, L, W) {
  const sh = getShared();
  const key = type + ':' + L.toFixed(2) + ':' + W.toFixed(2);
  let g = sh.geoCache.get(key);
  if (!g) { g = buildGeometry(type, L, W); sh.geoCache.set(key, g); }
  return g;
}

// ————————————————————————————————————————————————— ruedas instanciadas
const _m4 = new THREE.Matrix4(), _w4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler();
const _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3();

/** Todas las ruedas de todos los autos en 2 draw calls (neumático + llanta) */
export class WheelBatch {
  constructor(scene, cap = 280) {
    const sh = getShared();
    const prof = [[0.58, -0.5], [0.9, -0.5], [1, -0.34], [1, 0.34], [0.9, 0.5], [0.58, 0.5]].map(([r, y]) => new THREE.Vector2(r, y));
    const tg = new THREE.LatheGeometry(prof, 14);
    tg.rotateX(Math.PI / 2);
    const r1 = new THREE.CircleGeometry(0.68, 14); r1.translate(0, 0, 0.47);
    const r2 = new THREE.CircleGeometry(0.68, 14); r2.rotateY(Math.PI); r2.translate(0, 0, -0.47);
    const rg = mergeGeometries([r1, r2]);
    this.cap = cap;
    this.tire = new THREE.InstancedMesh(tg, sh.tire, cap);
    this.rim = new THREE.InstancedMesh(rg, sh.rim, cap);
    sh.tire.side = THREE.DoubleSide;
    for (const m of [this.tire, this.rim]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.count = 0; m.castShadow = m === this.tire;
      m.userData.ownMat = true;
      scene.add(m);
    }
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(m) {
    if (this.n >= this.cap) return;
    this.tire.setMatrixAt(this.n, m); this.rim.setMatrixAt(this.n, m); this.n++;
  }
  end() {
    this.tire.count = this.rim.count = this.n;
    this.tire.instanceMatrix.needsUpdate = this.rim.instanceMatrix.needsUpdate = true;
  }
}

const DEFORM_KEYS = ['paint', 'hood', 'doorL', 'doorR', 'bumper', 'trim', 'glass', 'head', 'tail', 'plate', 'sign'];
const WHEELS = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const PART_BITS = ['hood', 'bumper', 'doorL', 'doorR', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
let lodShared = null;

export class CarModel {
  constructor(v) {
    const sh = getShared();
    this.v = v;
    this.type = v.type || 'sedan';
    const L = v.w * S, W = v.h * S * 0.92;
    this.L = L; this.W = W;
    const geo = getTypeGeo(this.type, L, W);
    this.geo = geo; const P = this.P = geo.P;
    this.seed = Math.random() * 100;
    this.baseColor = new THREE.Color(v.color);
    const paintOpts = { color: this.baseColor.clone(), metalness: 0.55, roughness: 0.3 };
    this.paint = envMat(QUALITY === 'high'
      ? new THREE.MeshPhysicalMaterial({ ...paintOpts, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial(paintOpts), 0.85);
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0808, emissive: 0xff1a0a, emissiveIntensity: 0.6, roughness: 0.3 });
    this.plateTex = plateTexture(v.plate || 'PCS 000', this.type === 'taxi');
    this.plateMat = new THREE.MeshStandardMaterial({ map: this.plateTex, roughness: 0.5 });
    this.lodMat = new THREE.MeshStandardMaterial({ color: this.baseColor.clone(), vertexColors: true, metalness: 0.4, roughness: 0.4 });

    this.group = new THREE.Group();            // posición + guiñada + vuelcos
    this.cg = 0.7;
    this.inner = new THREE.Group(); this.inner.position.y = -this.cg;
    this.body = new THREE.Group();             // suspensión: rolido / cabeceo / rebote
    this.bodyInner = new THREE.Group(); this.bodyInner.position.y = -this.cg;
    this.body.position.y = this.cg;
    this.group.add(this.inner); this.inner.add(this.body); this.body.add(this.bodyInner);

    const mats = { paint: this.paint, hood: this.paint, doorL: this.paint, doorR: this.paint, bumper: this.paint, trim: sh.trim,
      glass: sh.glass, head: sh.head, tail: this.tailMat, plate: this.plateMat, sign: sh.sign };
    this.meshes = {};
    for (const k of DEFORM_KEYS) {
      if (!geo[k]) continue;
      const m = new THREE.Mesh(geo[k], mats[k]);
      m.castShadow = k === 'paint';
      this.bodyInner.add(m);
      this.meshes[k] = m;
    }
    this.lod = new THREE.Mesh(geo.lod, this.lodMat);
    this.lod.castShadow = true; this.lod.visible = false;
    this.bodyInner.add(this.lod);
    this.isLod = false;

    this.wheelR = P.wr; this.tw = P.bus ? 0.3 : 0.24;
    const wz = W / 2 - this.tw / 2 + 0.03;
    this.wheelPos = { wheelFL: [P.wx[0] * L, -wz], wheelFR: [P.wx[0] * L, wz], wheelRL: [P.wx[1] * L, -wz], wheelRR: [P.wx[1] * L, wz] };
    this.batch = null;

    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.15, W * 1.35), sh.blob);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.own = false;
    this._dentVersion = -1; this._tier = -1; this._glass = -1; this._attached = null; this._glow = null;
    this._t = Math.random() * 10;
  }

  addTo(scene) { scene.add(this.group); scene.add(this.blob); }

  removeFrom(scene) {
    scene.remove(this.group); scene.remove(this.blob);
    if (this.own) for (const m of Object.values(this.meshes)) m.geometry.dispose();
    this.blob.geometry.dispose();
    ENV.mats.delete(this.paint);
    this.paint.dispose(); this.tailMat.dispose(); this.plateMat.dispose(); this.plateTex.dispose(); this.lodMat.dispose();
  }

  /** copia propia de la geometría (las compartidas no se tocan) */
  _ensureOwn() {
    if (this.own) return;
    this.own = true;
    for (const [k, m] of Object.entries(this.meshes)) {
      const orig = this.geo[k].attributes.position.array;
      m.geometry = this.geo[k].clone();
      m.userData.orig = orig;
    }
  }

  _deform() {
    const v = this.v, P = this.P;
    if (!v.dents.length && v.wreckTier === 0 && !this.own) return;
    this._ensureOwn();
    const hl = this.L / 2, hw = this.W / 2;
    const tier = v.wreckTier;
    const crush = tier >= 3 ? 0.22 : tier >= 2 ? 0.08 : 0;
    const roofSpan = Math.max(0.3, P.roof - P.ht);
    const midY = P.hb + 0.35;
    const dents = v.dents.map(d => ({
      x: d.lx * S, z: d.ly * S * 0.92, nx: d.nx, nz: d.ny, depth: d.depth, top: d.top,
      R: d.top ? 0.9 + d.depth * 0.8 : 0.55 + d.depth * 0.75,
      front: Math.abs(d.nx) > 0.55,
    }));
    for (const m of Object.values(this.meshes)) {
      const pos = m.geometry.attributes.position;
      const o = m.userData.orig, arr = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const x = o[i * 3], y = o[i * 3 + 1], z = o[i * 3 + 2];
        let dx = 0, dy = 0, dz = 0;
        // ruido suave por posición (superficies superpuestas se mueven igual → sin z-fighting)
        const sd = this.seed;
        const noise = 0.5 + 0.32 * Math.sin(x * 9.1 + sd) * Math.cos(z * 8.3 + sd * 1.7)
          + 0.18 * Math.sin(x * 17.3 + y * 13.1 + z * 15.7 + sd * 2.3);
        for (const d of dents) {
          const dist = Math.hypot(x - d.x, z - d.z);
          if (dist >= d.R) continue;
          const f = 1 - dist / d.R;
          if (d.top) {
            if (y > P.ht - 0.1) {
              const k = f * f * d.depth * 0.42 * Math.min(1, (y - P.ht + 0.1) / 0.5);
              dy -= k * (0.85 + noise * 0.3);
              dz += Math.sign(z) * k * 0.12;
            }
            continue;
          }
          const fy = 1 - Math.min(0.65, Math.abs(y - midY) / 2.2);
          const A = d.depth * 0.36 * f * f * fy * (0.8 + noise * 0.4);
          dx += d.nx * A; dz += d.nz * A;
          // arruga: el capó / baúl se levanta en pliegue; los costados se hunden
          const ridge = Math.sin(f * Math.PI) * d.depth;
          const wTop = d.front ? Math.min(1, Math.max(0, (y - P.ht + 0.35) / 0.2)) : 0;
          dy += ridge * (0.14 * (0.6 + noise * 0.8) * wTop - 0.03 * (1 - wTop));
        }
        if (crush && y > P.ht) dy -= crush * Math.min(1, (y - P.ht) / roofSpan) * (0.8 + noise * 0.4);
        if (tier >= 1) {
          const j = (noise - 0.5) * 0.025 * tier;
          dx += j; dy += j * 0.5; dz -= j;
        }
        dx = Math.max(-hl * 0.32, Math.min(hl * 0.32, dx));
        dz = Math.max(-hw * 0.4, Math.min(hw * 0.4, dz));
        dy = Math.max(-(y - P.hb) * 0.7, dy);
        arr[i * 3] = x + dx; arr[i * 3 + 1] = y + dy; arr[i * 3 + 2] = z + dz;
      }
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
  }

  _setLod(on) {
    this.isLod = on;
    for (const m of Object.values(this.meshes)) m.visible = !on;
    this.lod.visible = on;
    this._attached = null;     // re-aplica piezas sueltas
  }

  update(dt, camPos) {
    const v = this.v, sh = getShared(), P = this.P;
    this._t += dt;
    // distancia a cámara → LOD + presupuesto de deformación
    let dist = 0;
    if (camPos) dist = Math.hypot(v.cx * S - camPos.x, v.cy * S - camPos.z, v.liftZ * S - camPos.y);
    v.nearCam = dist < DEFORM_DIST;
    const wantLod = this.isLod ? dist > LOD_DIST - 4 : dist > LOD_DIST + 4;
    if (wantLod !== this.isLod) this._setLod(wantLod);

    if ((v.dentVersion !== this._dentVersion || v.wreckTier !== this._tier) && !this.isLod && v.nearCam && deformBudget > 0) {
      deformBudget--;
      this._dentVersion = v.dentVersion;
      this._deform();
    }
    const tier = v.wreckTier;
    const charred = tier >= 3 && (v.isWreck || v.onFire > 0);
    if (tier !== this._tier || charred !== this._charred) {
      this._tier = tier; this._charred = charred;
      const c = this.baseColor.clone();
      if (tier === 1) c.multiplyScalar(0.92);
      if (tier === 2) c.lerp(new THREE.Color(0x5a4a3c), 0.3);
      if (tier >= 3) c.lerp(new THREE.Color(0x3a3029), 0.55);
      this.paint.color.copy(c);
      this.paint.roughness = 0.3 + tier * 0.17;
      this.paint.metalness = Math.max(0.1, 0.55 - tier * 0.12);
      if (this.paint.clearcoat !== undefined) this.paint.clearcoat = tier >= 2 ? 0.2 : 1;
      this.lodMat.color.copy(charred ? new THREE.Color(0x24201d) : c);
      for (const k of ['paint', 'hood', 'doorL', 'doorR', 'bumper']) if (this.meshes[k]) this.meshes[k].material = charred ? sh.charred : this.paint;
    }
    const gs = Math.max(v.glassState || 0, tier >= 3 ? 2 : 0);
    if (gs !== this._glass) {
      this._glass = gs;
      if (this.meshes.glass) this.meshes.glass.material = gs >= 2 ? sh.glassBroken : gs === 1 ? sh.glassCracked : sh.glass;
    }
    // piezas desprendidas
    let att = 0;      // máscara de piezas sueltas (sin crear strings por cuadro)
    for (let i = 0; i < PART_BITS.length; i++) if (v.parts[PART_BITS[i]].attached === false) att |= 1 << i;
    if (att !== this._attached && !this.isLod) {
      this._attached = att;
      for (const k of ['hood', 'bumper', 'doorL', 'doorR']) if (this.meshes[k]) this.meshes[k].visible = v.parts[k].attached !== false;
      if (this.meshes.head) this.meshes.head.visible = v.parts.bumper.attached !== false || tier < 2;
    }
    // luces: freno → traseras brillan fuerte
    const lightsOn = !v.isWreck && tier < 3;
    if (this.meshes.head) this.meshes.head.material = lightsOn ? sh.head : sh.lightOff;
    this.tailMat.emissiveIntensity = lightsOn ? (v.braking ? 2.8 : 0.55) : 0;
    // brillo psíquico
    const glow = v.frozen ? 'f' : (v.grabbed || v.lifted) ? 'g' : '';
    if (glow !== this._glow) {
      this._glow = glow;
      const e = glow === 'f' ? 0x2fd8ff : glow === 'g' ? 0x8a5cff : 0x000000;
      for (const mt of [this.paint, this.lodMat]) { mt.emissive.setHex(e); mt.emissiveIntensity = glow ? 0.45 : 0; }
    }

    // ruedas faltantes → el auto se apoya en el piso
    const miss = (k) => (v.parts[k].attached === false ? 1 : 0);
    const sagRoll = (miss('wheelFL') + miss('wheelRL') - miss('wheelFR') - miss('wheelRR')) * 0.07;
    const sagPitch = (miss('wheelFL') + miss('wheelFR') - miss('wheelRL') - miss('wheelRR')) * -0.05;
    const sagY = (miss('wheelFL') + miss('wheelFR') + miss('wheelRL') + miss('wheelRR')) * 0.06;
    const g = this.group;
    g.position.set(v.cx * S, (v.liftZ + (v.groundZ || 0)) * S + this.cg - sagY, v.cy * S);
    g.rotation.set((v.roll || 0) + sagRoll + (v.gRoll || 0), -v.angle, (v.pitch || 0) + sagPitch + (v.gPitch || 0), 'YZX');
    // suspensión blanda (rolido / cabeceo / rebote) + chapa que tiembla
    const su = v.sus;
    if (su) {
      this.body.rotation.set(su.roll, 0, su.pitch);
      this.body.position.y = this.cg + su.heave;
    }
    const wb = v.wobble || 0;
    if (wb > 0.01) {
      const s = Math.sin(this._t * 31) * wb * 0.035;
      this.body.scale.set(1 + s * 0.5, 1 - s, 1 + s);
    } else if (this.body.scale.x !== 1) this.body.scale.set(1, 1, 1);

    // ruedas → lote instanciado
    if (this.batch && dist < 140) {
      g.updateMatrixWorld(true);
      _w4.copy(this.inner.matrixWorld);
      const steer = -(v.steerAngle ?? v.steerVisual ?? 0);
      for (const k of WHEELS) {
        if (v.parts[k].attached === false) continue;
        const [wx, wz] = this.wheelPos[k];
        _e4.set(0, k[5] === 'F' ? steer : 0, -(v.wheelSpin || 0), 'YZX');
        _q4.setFromEuler(_e4);
        _p4.set(wx, this.wheelR, wz);
        _s4.set(this.wheelR, this.wheelR, this.tw);
        _m4.compose(_p4, _q4, _s4);
        this.batch.push(_m4.premultiply(_w4));
      }
    }

    this.blob.position.set(v.cx * S, 0.03 + (v.groundZ || 0) * S, v.cy * S);
    this.blob.rotation.z = -v.angle;
    const bs = Math.max(0.3, 1 - v.liftZ * S / 8);
    this.blob.scale.set(bs, bs, 1);
  }
}
