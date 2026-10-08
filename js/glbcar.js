// v4.3 — Autos CC0 (.glb, Quaternius / Kenney) con piezas separadas, abolladuras en la carrocería,
// ruedas que giran y doblan, huecos tapados al perder piezas, LOD lejano compartido.
import * as THREE from 'three';
import { getShared, getTypeGeo, envMat, releaseEnvMat, carDeformBudget, useCarDeformBudget } from './carmodel.js';

const S = 0.1;
const LOD_DIST = 58, DEFORM_DIST = 45;
const PART_NODES = { hood: ['hood'], bumper: ['bumper_front'], doorL: ['door_FL', 'door_RL'], doorR: ['door_FR', 'door_RR'] };
const PART_KEYS = Object.keys(PART_NODES);
const WHEEL_NODES = { wheelFL: 'wheel_FL', wheelFR: 'wheel_FR', wheelRL: 'wheel_RL', wheelRR: 'wheel_RR' };
const WHEEL_KEYS = Object.keys(WHEEL_NODES);
const DEFORM_NODES = ['body', 'hood', 'bumper_front', 'bumper_rear', 'door_FL', 'door_FR', 'door_RL', 'door_RR'];
const PHYS_WHEEL_R = 1 / 0.28 * S;   // vehicles.js: wheelSpin += v·dt·0.28 → radio físico ≈ 0,357 m

// tipo físico → archivo(s) .glb (van / bus siguen procedurales)
export const GLB_FOR_TYPE = {
  sedan: ['sedan', 'sedan', 'sedan', 'police'],
  hatch: ['sedan_b'],
  taxi: ['taxi'],
  suv: ['suv'],
  sports: ['sports', 'sports_b'],
  pickup: ['pickup'],
};
export const GLB_CAR_FILES = ['sedan', 'sedan_b', 'taxi', 'police', 'suv', 'sports', 'sports_b', 'pickup'];

const PROTOS = new Map();   // nombre → { root, size, minY, boxes, wheelR }
let capMat = null;
const _v3 = new THREE.Vector3(), _c = new THREE.Color();
const C_DENT2 = new THREE.Color(0x5a4a3c), C_DENT3 = new THREE.Color(0x3a3029);

const meshesOf = (node) => {
  const out = [];
  if (node) node.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};

/** Registra un .glb cargado (raíz con piezas como hijos directos) */
export function registerCarGlb(name, gltfScene) {
  const root = gltfScene.getObjectByName(name) || gltfScene.children[0] || gltfScene;
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  // cajas de cada pieza (marco del modelo) para las tapas oscuras
  const boxes = {};
  for (const c of root.children) boxes[c.name] = new THREE.Box3().setFromObject(c);
  const wb = boxes.wheel_FL;
  const wheelR = wb ? (wb.max.y - wb.min.y) / 2 : 0.3;
  root.traverse(o => {
    if (!o.isMesh) return;
    let top = o; while (top.parent && top.parent !== root) top = top.parent;
    o.castShadow = top.name === 'body';
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.userData.pcsDone) continue;
      m.userData.pcsDone = true;
      if (/window/.test(m.name)) { m.transparent = true; m.opacity = 0.86; m.roughness = 0.08; m.metalness = 0.8; envMat(m, 1.1); }
      else if (/paint|rim|trim_light|trim_grey/.test(m.name)) envMat(m, 0.9);
      if (/headlight/.test(m.name)) { m.emissive = new THREE.Color(0xfff1c0); m.emissiveIntensity = 1.1; }
      if (/taillight/.test(m.name)) { m.emissive = new THREE.Color(0xff1a0a); m.emissiveIntensity = 0.5; }
      if (m.map && /kenney/.test(m.name)) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestFilter; m.map.generateMipmaps = false; m.map.needsUpdate = true; }
    }
  });
  PROTOS.set(name, { root, size, minY: box.min.y, boxes, wheelR });
}

export function hasCarGlb(type) {
  const list = GLB_FOR_TYPE[type];
  return !!(list && list.some(n => PROTOS.has(n)));
}

function pickProto(type, seed) {
  const list = (GLB_FOR_TYPE[type] || []).filter(n => PROTOS.has(n));
  if (!list.length) return null;
  const name = list[Math.floor(seed * 997) % list.length];
  return { name, ...PROTOS.get(name) };
}

export class GlbCarModel {
  constructor(v) {
    const sh = getShared();
    this.v = v;
    this.type = v.type || 'sedan';
    this.seed = ((v.id || Math.random() * 1000) * 0.6180339) % 1;
    const P0 = pickProto(this.type, this.seed);
    this.protoName = P0.name;
    const L = v.w * S, W = v.h * S * 0.92;
    this.L = L; this.W = W;
    // escala: largo/ancho de la física; altura con la media (respeta las proporciones del modelo)
    const sz = P0.size;
    const kL = L / sz.z, kW = W / sz.x, kH = (kL + kW) / 2;
    this.k = [kW, kH, kL];
    this.height = sz.y * kH;
    this.baseColor = new THREE.Color(v.color);
    const police = P0.name === 'police', taxi = P0.name === 'taxi';

    this.group = new THREE.Group();
    this.cg = 0.7;
    this.inner = new THREE.Group(); this.inner.position.y = -this.cg;
    this.body = new THREE.Group();
    this.bodyInner = new THREE.Group(); this.bodyInner.position.y = -this.cg;
    this.body.position.y = this.cg;
    this.group.add(this.inner); this.inner.add(this.body); this.body.add(this.bodyInner);

    // clon (geometría compartida) girado: +Z del glb → +X del auto; izquierda (+X glb) → −Z
    const model = P0.root.clone(true);
    model.position.set(0, -P0.minY * kH, 0);
    model.rotation.set(0, Math.PI / 2, 0);
    model.scale.set(kW, kH, kL);
    this.model = model;
    this.bodyInner.add(model);
    // materiales propios: pintura (color de tránsito) y luces traseras (freno)
    this.paint = null; this.tailMat = null; this.windowMeshes = [];
    const paintCache = new Map();
    model.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map(m => {
        if (!m) return m;
        if (m.name === 'paint') {
          let pm = paintCache.get(m);
          if (!pm) {
            pm = m.clone();
            if (!police && !taxi) pm.color.copy(this.baseColor);
            envMat(pm, 0.85); paintCache.set(m, pm); this.paint = this.paint || pm;
          }
          return pm;
        }
        if (/taillight/.test(m.name)) { if (!this.tailMat) this.tailMat = m.clone(); return this.tailMat; }
        if (/window/.test(m.name)) this.windowMeshes.push(o);
        return m;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this.ownMats = [...paintCache.values()];
    if (this.paint) this.basePaint = this.paint.color.clone();
    this.nodes = {};
    for (const c of model.children) this.nodes[c.name] = c;
    // ruedas: fuera del grupo de suspensión (no se inclinan con la carrocería)
    this.wheelRoot = new THREE.Group();
    this.wheelRoot.position.copy(model.position); this.wheelRoot.rotation.copy(model.rotation); this.wheelRoot.scale.copy(model.scale);
    this.inner.add(this.wheelRoot);
    this.wheels = {};
    for (const k of WHEEL_KEYS) {
      const w = this.nodes[WHEEL_NODES[k]];
      if (!w) continue;
      this.wheelRoot.add(w);   // mismo marco local que el modelo
      w.rotation.order = 'YXZ';
      this.wheels[k] = w;
    }
    // giro visual: misma distancia recorrida que la física, con el radio real de la rueda
    this.spinK = PHYS_WHEEL_R / Math.max(0.12, P0.wheelR * kH);
    // tapas oscuras para los huecos al perder piezas (un poco hacia adentro de la carrocería)
    capMat = capMat || new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.caps = {};
    for (const k of PART_KEYS) {
      this.caps[k] = [];
      for (const n of PART_NODES[k]) {
        const bb = P0.boxes[n];
        if (!bb || !this.nodes[n]) continue;
        bb.getSize(_v3);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02, _v3.x * 0.86), Math.max(0.02, _v3.y * 0.86), Math.max(0.02, _v3.z * 0.86)), capMat);
        bb.getCenter(cap.position);
        cap.position.x *= 0.94; cap.position.z *= 0.97;
        cap.visible = false;
        model.add(cap);
        this.caps[k].push(cap);
      }
    }
    // LOD lejano: malla simple compartida del tipo físico
    const lodGeo = getTypeGeo(this.type, L, W).lod;
    this.lodMat = new THREE.MeshStandardMaterial({ color: (this.paint ? this.paint.color : this.baseColor).clone(), vertexColors: true, metalness: 0.4, roughness: 0.4 });
    this.lod = new THREE.Mesh(lodGeo, this.lodMat);
    this.lod.castShadow = true; this.lod.visible = false;
    this.bodyInner.add(this.lod);
    this.isLod = false;

    this.wheelR = P0.wheelR * kH; this.tw = 0.24;
    this.batch = null;   // ruedas propias (no usa el lote instanciado)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.15, W * 1.35), sh.blob);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.own = false;
    this._dentVersion = -1; this._tier = -1; this._glass = -1; this._attached = -1; this._glow = null; this._charred = false;
    this._t = Math.random() * 10;
    this._sirenW = null;
    if (police) {
      const sm = [];
      model.traverse(o => { if (o.isMesh && /siren/.test(o.material?.name || '')) sm.push(o); });
      if (sm.length) this._sirenW = sm.map(o => { const m = o.material.clone(); m.emissive = new THREE.Color(o.material.name.includes('blue') ? 0x2050ff : 0xff2030); m.emissiveIntensity = 0; o.material = m; return m; });
    }
  }

  addTo(scene) { scene.add(this.group); scene.add(this.blob); }

  removeFrom(scene) {
    scene.remove(this.group); scene.remove(this.blob);
    if (this.own) for (const n of DEFORM_NODES) for (const m of meshesOf(this.nodes[n])) if (m.userData.ownGeo) m.geometry.dispose();
    for (const k of PART_KEYS) for (const c of this.caps[k]) c.geometry.dispose();
    this.blob.geometry.dispose();
    for (const m of this.ownMats) { releaseEnvMat(m); m.dispose(); }
    this.tailMat?.dispose(); this.lodMat.dispose();
    this._sirenW?.forEach(m => m.dispose());
  }

  _ensureOwn() {
    if (this.own) return;
    this.own = true;
    this.model.updateMatrix();
    for (const n of DEFORM_NODES) {
      for (const m of meshesOf(this.nodes[n])) {
        const orig = m.geometry.attributes.position.array;
        m.geometry = m.geometry.clone();
        m.userData.ownGeo = true;
        m.userData.orig = orig;
        // vértices de la pieza → marco del modelo (para medir abolladuras)
        const T = new THREE.Matrix4();
        const chain = [];
        for (let o = m; o && o !== this.model; o = o.parent) chain.push(o);
        for (let i = chain.length - 1; i >= 0; i--) { chain[i].updateMatrix(); T.multiply(chain[i].matrix); }
        m.userData.toModel = T;
        m.userData.fromModel = T.clone().invert();
      }
    }
  }

  /** Abolladuras sobre la carrocería real (vértices del glb), en coordenadas del modelo */
  _deform() {
    const v = this.v;
    if (!v.dents.length && v.wreckTier === 0 && !this.own) return;
    this._ensureOwn();
    const [kW, kH, kL] = this.k;
    const H = this.height / kH;            // alto del modelo (unidades glb)
    const roofY = H * 0.62;
    const tier = v.wreckTier;
    const crush = tier >= 3 ? 0.2 : tier >= 2 ? 0.07 : 0;
    // abolladuras: lx (adelante, px) → z glb; ly (derecha, px) → −x glb
    const dents = v.dents.map(d => ({
      x: -(d.ly * S * 0.92) / kW, z: (d.lx * S) / kL, nx: -d.ny, nz: d.nx, depth: d.depth, top: d.top,
      R: (d.top ? 0.9 + d.depth * 0.8 : 0.55 + d.depth * 0.75),
    }));
    const sd = this.seed * 50;
    const tmp = _v3;
    for (const n of DEFORM_NODES) {
      for (const m of meshesOf(this.nodes[n])) {
        const pos = m.geometry.attributes.position, o = m.userData.orig, arr = pos.array;
        const T = m.userData.toModel, Ti = m.userData.fromModel;
        for (let i = 0; i < pos.count; i++) {
          tmp.set(o[i * 3], o[i * 3 + 1], o[i * 3 + 2]).applyMatrix4(T);
          const x = tmp.x, y = tmp.y, z = tmp.z;
          let dx = 0, dy = 0, dz = 0;
          const noise = 0.5 + 0.32 * Math.sin(x * 9.1 + sd) * Math.cos(z * 8.3 + sd * 1.7) + 0.18 * Math.sin(x * 17.3 + y * 13.1 + z * 15.7);
          for (let j = 0; j < dents.length; j++) {
            const d = dents[j];
            const dist = Math.hypot((x - d.x) * kW, (z - d.z) * kL);
            if (dist >= d.R) continue;
            const f = 1 - dist / d.R;
            if (d.top) {
              if (y > roofY - 0.1) dy -= f * f * d.depth * 0.42 / kH * Math.min(1, (y - roofY + 0.1) / 0.4) * (0.85 + noise * 0.3);
              continue;
            }
            const fy = 1 - Math.min(0.65, Math.abs(y - H * 0.4) / 2.2);
            const A = d.depth * 0.34 * f * f * fy * (0.8 + noise * 0.4);
            dx += d.nx * A / kW; dz += d.nz * A / kL;
            dy += Math.sin(f * Math.PI) * d.depth * 0.06 * (noise - 0.3) / kH;
          }
          if (crush && y > roofY) dy -= crush / kH * Math.min(1, (y - roofY) / (H - roofY + 0.01)) * (0.8 + noise * 0.4);
          if (tier >= 1) { const jn = (noise - 0.5) * 0.02 * tier; dx += jn / kW; dy += jn * 0.5 / kH; dz -= jn / kL; }
          dy = Math.max(-y * 0.6, dy);
          tmp.set(x + dx, y + dy, z + dz).applyMatrix4(Ti);
          arr[i * 3] = tmp.x; arr[i * 3 + 1] = tmp.y; arr[i * 3 + 2] = tmp.z;
        }
        pos.needsUpdate = true;
        m.geometry.computeVertexNormals();
        m.geometry.computeBoundingSphere();
      }
    }
  }

  _setLod(on) {
    this.isLod = on;
    this.model.visible = !on;
    this.wheelRoot.visible = !on;
    this.lod.visible = on;
  }

  update(dt, camPos) {
    const v = this.v, sh = getShared();
    this._t += dt;
    let dist = 0;
    if (camPos) dist = Math.hypot(v.cx * S - camPos.x, v.cy * S - camPos.z, v.liftZ * S - camPos.y);
    v.nearCam = dist < DEFORM_DIST;
    const wantLod = this.isLod ? dist > LOD_DIST - 4 : dist > LOD_DIST + 4;
    if (wantLod !== this.isLod) this._setLod(wantLod);
    if ((v.dentVersion !== this._dentVersion || v.wreckTier !== this._tier) && !this.isLod && v.nearCam && carDeformBudget() > 0) {
      useCarDeformBudget();
      this._dentVersion = v.dentVersion;
      this._deform();
    }
    const tier = v.wreckTier;
    const charred = tier >= 3 && (v.isWreck || v.onFire > 0);
    if (tier !== this._tier || charred !== this._charred) {
      this._tier = tier; this._charred = charred;
      if (this.paint) {
        const c = _c.copy(this.basePaint);
        if (tier === 1) c.multiplyScalar(0.92);
        if (tier === 2) c.lerp(C_DENT2, 0.3);
        if (tier >= 3) c.lerp(C_DENT3, 0.55);
        if (charred) c.set(0x24201d);
        for (const m of this.ownMats) { m.color.copy(c); m.roughness = Math.min(1, 0.35 + tier * 0.17); }
        this.lodMat.color.copy(c);
      }
    }
    const gs = Math.max(v.glassState || 0, tier >= 3 ? 2 : 0);
    if (gs !== this._glass) {
      this._glass = gs;
      for (const o of this.windowMeshes) {
        if (!o.userData.origMat) o.userData.origMat = o.material;
        o.material = gs >= 2 ? sh.glassBroken : gs === 1 ? sh.glassCracked : o.userData.origMat;
      }
    }
    // piezas desprendidas → se ocultan y aparece la tapa oscura
    let att = 0;
    for (let i = 0; i < PART_KEYS.length; i++) { const p = v.parts[PART_KEYS[i]]; if (p && p.attached === false) att |= 1 << i; }
    for (let i = 0; i < WHEEL_KEYS.length; i++) { const p = v.parts[WHEEL_KEYS[i]]; if (p && p.attached === false) att |= 1 << (i + 4); }
    if (att !== this._attached) {
      this._attached = att;
      for (const k of PART_KEYS) {
        const off = !!(v.parts[k] && v.parts[k].attached === false);
        for (const n of PART_NODES[k]) if (this.nodes[n]) this.nodes[n].visible = !off;
        for (const c of this.caps[k]) c.visible = off;
      }
      for (const k of WHEEL_KEYS) if (this.wheels[k]) this.wheels[k].visible = !(v.parts[k] && v.parts[k].attached === false);
    }
    if (this.tailMat) this.tailMat.emissiveIntensity = !v.isWreck && tier < 3 ? (v.braking ? 2.6 : 0.5) : 0;
    if (this._sirenW) {
      const on = !v.isWreck && (v.driven || v.hostile);
      const ph = Math.floor(this._t * 6) % 2;
      for (let i = 0; i < this._sirenW.length; i++) this._sirenW[i].emissiveIntensity = on ? ((i + ph) % 2 ? 2.2 : 0.1) : 0;
    }
    const glow = v.frozen ? 'f' : (v.grabbed || v.lifted) ? 'g' : '';
    if (glow !== this._glow) {
      this._glow = glow;
      const e = glow === 'f' ? 0x2fd8ff : glow === 'g' ? 0x8a5cff : 0x000000;
      for (const mt of this.ownMats) { mt.emissive.setHex(e); mt.emissiveIntensity = glow ? 0.45 : 0; }
      this.lodMat.emissive.setHex(e); this.lodMat.emissiveIntensity = glow ? 0.45 : 0;
    }
    // pose (igual que el modelo procedural): ruedas faltantes → se apoya en el piso
    const P = v.parts;
    const miss = (k) => (P[k] && P[k].attached === false ? 1 : 0);
    const mFL = miss('wheelFL'), mFR = miss('wheelFR'), mRL = miss('wheelRL'), mRR = miss('wheelRR');
    const sagRoll = (mFL + mRL - mFR - mRR) * 0.07;
    const sagPitch = (mFL + mFR - mRL - mRR) * -0.05;
    const sagY = (mFL + mFR + mRL + mRR) * 0.06;
    const g = this.group;
    g.position.set(v.cx * S, (v.liftZ + (v.groundZ || 0)) * S + this.cg - sagY, v.cy * S);
    g.rotation.set((v.roll || 0) + sagRoll + (v.gRoll || 0), -v.angle, (v.pitch || 0) + sagPitch + (v.gPitch || 0), 'YZX');
    const su = v.sus;
    if (su) { this.body.rotation.set(su.roll, 0, su.pitch); this.body.position.y = this.cg + su.heave; }
    const wb = v.wobble || 0;
    if (wb > 0.01) { const s = Math.sin(this._t * 31) * wb * 0.035; this.body.scale.set(1 + s * 0.5, 1 - s, 1 + s); }
    else if (this.body.scale.x !== 1) this.body.scale.set(1, 1, 1);
    // ruedas: giran con la velocidad y las delanteras doblan
    if (!this.isLod && dist < 140) {
      const steer = -(v.steerAngle ?? v.steerVisual ?? 0);
      const spin = (v.wheelSpin || 0) * this.spinK;
      for (const k of WHEEL_KEYS) {
        const w = this.wheels[k];
        if (!w) continue;
        w.rotation.y = k[5] === 'F' ? steer : 0;
        w.rotation.x = spin;
      }
    }
    this.blob.position.set(v.cx * S, 0.03 + (v.groundZ || 0) * S, v.cy * S);
    this.blob.rotation.z = -v.angle;
    const bs = Math.max(0.3, 1 - v.liftZ * S / 8);
    this.blob.scale.set(bs, bs, 1);
  }
}
