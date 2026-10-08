/**
 * Crash-test dummy .glb (assets/models/dummy.glb): piezas compartidas + pool.
 * Jerarquía plana: cada nodo pivota en su articulación proximal; el ragdoll
 * coloca cada hijo en la articulación del padre cada frame.
 * Si el GLB no carga → hasDummyGlb()=false y el renderer usa cajas.
 */
import * as THREE from 'three';

const S = 0.1; // px → m

/** física id → nombre de malla en el GLB (game −X = GLB R) */
export const PHYS_TO_GLB = {
  torso: 'torso',
  head: 'head',
  armLU: 'upperArm_R',
  armLL: 'lowerArm_R',
  armRU: 'upperArm_L',
  armRL: 'lowerArm_L',
  legLU: 'upperLeg_R',
  legLL: 'lowerLeg_R',
  legRU: 'upperLeg_L',
  legRL: 'lowerLeg_L',
};

/** articulación visible (bola) asociada a cada pieza física */
export const PHYS_TO_JOINT = {
  head: 'joint_neck',
  armLU: 'joint_shoulder_R',
  armLL: 'joint_elbow_R',
  armRU: 'joint_shoulder_L',
  armRL: 'joint_elbow_L',
  legLU: 'joint_hip_R',
  legLL: 'joint_knee_R',
  legRU: 'joint_hip_L',
  legRL: 'joint_knee_L',
};

const PART_NAMES = Object.values(PHYS_TO_GLB);
const JOINT_NAMES = [
  'joint_neck',
  'joint_shoulder_L', 'joint_shoulder_R',
  'joint_elbow_L', 'joint_elbow_R',
  'joint_wrist_L', 'joint_wrist_R',
  'joint_hip_L', 'joint_hip_R',
  'joint_knee_L', 'joint_knee_R',
  'joint_ankle_L', 'joint_ankle_R',
];

/** Prototipo: geometrías/materiales compartidos por nombre de nodo */
let PROTO = null; // { parts: Map<name, {meshes:[{geo,mat,pos,quat,scale}]}>, pivots: Map }

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();

function captureNode(node) {
  const meshes = [];
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  node.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    // geometría en espacio local del nodo (pivote = articulación)
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      // un material por submesh; si hay groups, filtrar
      let g = geo;
      if (geo.groups?.length > 1 && mats.length > 1) {
        // dejar geo completa; Mesh usa material array
      }
      meshes.push({
        geometry: geo,
        material: mat,
        multi: mats.length > 1 ? mats : null,
      });
      if (mats.length > 1) break; // una mesh con array de mats
    }
  });
  // dedupe: una entrada con material array si aplica
  if (meshes.length > 1 && meshes[0].multi) {
    return [{ geometry: meshes[0].geometry, material: meshes[0].multi }];
  }
  // varias meshes (ojos, etc.)
  const out = [];
  const seen = new Set();
  node.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (seen.has(o.geometry.uuid + o.id)) return;
    seen.add(o.geometry.uuid + o.id);
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const mat = Array.isArray(o.material) ? o.material.map(m => m) : o.material;
    out.push({ geometry: geo, material: mat });
  });
  return out;
}

/**
 * Registra el .glb cargado. Idempotente.
 * @param {THREE.Object3D} gltfScene
 */
export function registerDummyGlb(gltfScene) {
  if (!gltfScene) return false;
  try {
    const root = gltfScene.getObjectByName('dummy') || gltfScene.children[0] || gltfScene;
    root.updateMatrixWorld(true);
    const parts = new Map();
    for (const name of [...PART_NAMES, ...JOINT_NAMES]) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      const meshes = [];
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      node.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        const mat = Array.isArray(o.material) ? o.material.slice() : o.material;
        meshes.push({ geometry: geo, material: mat });
      });
      if (meshes.length) parts.set(name, meshes);
    }
    if (!parts.has('torso')) {
      console.warn('dummy.glb: falta torso');
      return false;
    }
    PROTO = { parts, root };
    return true;
  } catch (e) {
    console.warn('registerDummyGlb:', e);
    PROTO = null;
    return false;
  }
}

export function hasDummyGlb() {
  return !!PROTO;
}

function makePartGroup(name) {
  const g = new THREE.Group();
  g.name = name;
  const list = PROTO.parts.get(name);
  if (!list) { g.visible = false; return g; }
  for (const { geometry, material } of list) {
    const m = new THREE.Mesh(geometry, material); // geo + mat compartidos
    m.castShadow = true;
    m.receiveShadow = false;
    g.add(m);
  }
  return g;
}

/**
 * Una instancia visual de maniquí (piezas + bolas de articulación).
 * Geometría/materiales compartidos entre todas las instancias.
 */
export class DummyVisual {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'dummyVisual';
    this.parts = {};
    this.joints = {};
    if (!PROTO) return;
    for (const [phys, glb] of Object.entries(PHYS_TO_GLB)) {
      const g = makePartGroup(glb);
      this.parts[phys] = g;
      this.root.add(g);
    }
    for (const jn of JOINT_NAMES) {
      const g = makePartGroup(jn);
      this.joints[jn] = g;
      this.root.add(g);
    }
    this._rag = null;
  }

  attach(scene) { scene.add(this.root); }
  detach(scene) { scene.remove(this.root); this._rag = null; this.root.visible = false; }

  /** Vincula a un ragdoll lógico y muestra. */
  bind(rag) {
    this._rag = rag;
    this.root.visible = true;
    rag._dummyVisual = this;
  }

  unbind() {
    if (this._rag) this._rag._dummyVisual = null;
    this._rag = null;
    this.root.visible = false;
  }

  /**
   * Coloca cada pieza en la articulación proximal (posición del body físico).
   * El GLB está en T-pose (brazos ±X); al colgar aplicamos droop en Z.
   */
  sync() {
    const r = this._rag;
    if (!r || !PROTO) { this.root.visible = false; return; }
    this.root.visible = true;
    for (const [phys, g] of Object.entries(this.parts)) {
      const body = r.byId[phys];
      if (!body?.alive) { g.visible = false; continue; }
      g.visible = true;
      g.position.set(body.cx * S, body.liftZ * S, body.cy * S);
      _e.set(body.tumbleX || 0, -(body.angle || 0), body.tumbleZ || 0);
      g.quaternion.setFromEuler(_e);
      // T-pose → colgar: brazos caen (rotar Z), piernas ya van en −Y del modelo
      if (!body.data?.severed) {
        if (phys === 'armLU' || phys === 'armLL') g.rotateZ(1.25);   // −X side → down
        if (phys === 'armRU' || phys === 'armRL') g.rotateZ(-1.25);
        if (phys === 'armLL') g.rotateZ(0.35);
        if (phys === 'armRL') g.rotateZ(-0.35);
      }
    }
    // Bolas de articulación
    for (const [phys, jn] of Object.entries(PHYS_TO_JOINT)) {
      const jg = this.joints[jn];
      if (!jg) continue;
      const body = r.byId[phys];
      const parentId = body?.data?.parent;
      const parent = parentId ? r.byId[parentId] : r.torso;
      if (r.severed.has(phys) && parent?.alive) {
        jg.visible = true;
        const a = body?.data?.anchor || { x: 0, y: 0, z: 0 };
        jg.position.set(
          (parent.cx + a.x * 0.35) * S,
          (parent.liftZ + a.z * 0.35) * S,
          parent.cy * S,
        );
        jg.quaternion.identity();
        continue;
      }
      if (!body?.alive) { jg.visible = false; continue; }
      jg.visible = true;
      jg.position.set(body.cx * S, body.liftZ * S, body.cy * S);
      jg.quaternion.identity();
    }
    const tip = {
      joint_wrist_R: 'armLL', joint_wrist_L: 'armRL',
      joint_ankle_R: 'legLL', joint_ankle_L: 'legRL',
    };
    for (const [jn, phys] of Object.entries(tip)) {
      const jg = this.joints[jn];
      const body = r.byId[phys];
      if (!jg) continue;
      if (!body?.alive) { jg.visible = false; continue; }
      jg.visible = !r.severed.has(phys);
      // distal: un poco más allá del pivote según orientación de la pieza
      const part = this.parts[phys];
      if (part && part.visible) {
        _p.set(0.28, phys.startsWith('leg') ? -0.35 : 0, 0);
        if (phys.includes('L') && phys.startsWith('arm')) _p.x = -0.28;
        _p.applyQuaternion(part.quaternion);
        jg.position.set(body.cx * S + _p.x, body.liftZ * S + _p.y, body.cy * S + _p.z);
      } else {
        jg.position.set(body.cx * S, body.liftZ * S, body.cy * S);
      }
      jg.quaternion.identity();
    }
  }
}

/** Pool de visuales reutilizables. */
export class DummyPool {
  constructor(scene, cap = 10) {
    this.scene = scene;
    this.free = [];
    this.used = new Set();
    this.cap = cap;
    if (PROTO) {
      for (let i = 0; i < cap; i++) {
        const v = new DummyVisual();
        v.attach(scene);
        v.root.visible = false;
        this.free.push(v);
      }
    }
  }

  acquire(rag) {
    if (!PROTO) return null;
    let v = this.free.pop();
    if (!v) {
      if (this.used.size >= this.cap) {
        // reutilizar el más viejo no held
        for (const u of this.used) {
          if (!u._rag?.held) { v = u; break; }
        }
        if (v) { v.unbind(); this.used.delete(v); }
      }
      if (!v) v = new DummyVisual();
      v.attach(this.scene);
    }
    v.bind(rag);
    this.used.add(v);
    return v;
  }

  release(v) {
    if (!v) return;
    v.unbind();
    this.used.delete(v);
    if (this.free.length < this.cap) this.free.push(v);
    else v.detach(this.scene);
  }

  /** Sincroniza con ragdolls activos; adquiere/libera según haga falta. */
  syncAll(ragdolls) {
    if (!PROTO || !ragdolls) {
      for (const v of [...this.used]) this.release(v);
      return false;
    }
    const active = new Set(ragdolls.active);
    for (const v of [...this.used]) {
      if (!v._rag || !active.has(v._rag)) this.release(v);
    }
    for (const r of ragdolls.active) {
      if (!r._dummyVisual) this.acquire(r);
      r._dummyVisual?.sync();
    }
    return true;
  }
}
