/**
 * Modelo 3D low-poly de auto (primitivas) con abolladuras por vértice,
 * piezas desprendibles y niveles de daño visual.
 */

import * as THREE from 'three';
import { makeStripeTexture, makeWheelTexture, makeCrackedGlass, makeBlobShadow } from './textures.js';

const S = 0.1;
let shared = null;

function getShared() {
  if (shared) return shared;
  const wheelTex = makeWheelTexture();
  shared = {
    wheel: new THREE.MeshStandardMaterial({ map: wheelTex, roughness: 0.85, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d2a36, roughness: 0.08, metalness: 0.6, envMapIntensity: 1 }),
    glassCracked: new THREE.MeshStandardMaterial({ map: makeCrackedGlass(), roughness: 0.4, metalness: 0.3 }),
    glassBroken: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.95, metalness: 0 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.25, metalness: 0.9 }),
    darkTrim: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.7, metalness: 0.2 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c0, emissiveIntensity: 1.4 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0.9 }),
    lightOff: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
    blob: new THREE.MeshBasicMaterial({ map: makeBlobShadow(), transparent: true, depthWrite: false, opacity: 0.9 }),
    charred: new THREE.MeshStandardMaterial({ color: 0x24201d, roughness: 0.95, metalness: 0.1 }),
  };
  return shared;
}

/** Une geometrías indexadas (posición, normal, uv) */
export function mergeGeometries(geoms) {
  let nV = 0, nI = 0;
  for (const g of geoms) { nV += g.attributes.position.count; nI += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  const idx = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3); nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = i + vo; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function box(w, h, d, x, y, z, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

const STYLES = {
  muscle: { cabinX: -0.38, cabinL: 0.36, hoodL: 0.36, bodyH: 0.5, cabinH: 0.44 },
  sedan: { cabinX: -0.1, cabinL: 0.44, hoodL: 0.28, bodyH: 0.48, cabinH: 0.48 },
  hatch: { cabinX: -0.48, cabinL: 0.5, hoodL: 0.26, bodyH: 0.52, cabinH: 0.52 },
};

export class CarModel {
  constructor(v) {
    const sh = getShared();
    this.v = v;
    const L = v.w * S, W = v.h * S * 0.92;
    this.L = L; this.W = W;
    const st = STYLES[v.style] || STYLES.sedan;
    this.group = new THREE.Group();          // pivote en el centro de masa
    this.inner = new THREE.Group();
    this.inner.position.y = -0.7;
    this.group.add(this.inner);

    const map = v.stripes ? makeStripeTexture(v.color) : null;
    this.paint = new THREE.MeshStandardMaterial({
      color: map ? 0xffffff : new THREE.Color(v.color), map, roughness: 0.38, metalness: 0.45,
    });
    this.baseColor = new THREE.Color(map ? 0xffffff : v.color);
    this.paintTrim = new THREE.MeshStandardMaterial({ color: new THREE.Color(v.color).multiplyScalar(0.85), roughness: 0.45, metalness: 0.4 });

    const yB = 0.38 + st.bodyH / 2;           // centro de carrocería
    const topB = 0.38 + st.bodyH;
    const cabL = L * st.cabinL, cabX = L * st.cabinX * 0.5 + L * 0.02;
    const parts = {};

    // Carrocería (subdividida para deformar)
    parts.body = box(L, st.bodyH, W, 0, yB, 0, 8, 2, 4);
    // Cabina (trapecio)
    const cab = box(cabL, st.cabinH, W * 0.86, cabX, topB + st.cabinH / 2, 0, 4, 1, 3);
    const cp = cab.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      if (cp.getY(i) > topB + st.cabinH * 0.4) {
        cp.setX(i, cabX + (cp.getX(i) - cabX) * 0.72);
        cp.setZ(i, cp.getZ(i) * 0.86);
      }
    }
    parts.cabin = cab;
    parts.roof = box(cabL * 0.74, 0.06, W * 0.76, cabX, topB + st.cabinH + 0.02, 0, 3, 1, 2);
    const hoodL = L * st.hoodL;
    parts.hood = box(hoodL, 0.05, W * 0.9, L / 2 - hoodL / 2 - 0.12, topB + 0.025, 0, 4, 1, 3);
    parts.bumper = box(0.16, 0.2, W * 1.0, L / 2 + 0.04, 0.5, 0, 1, 1, 3);
    const doorL = L * 0.3;
    parts.doorL = box(doorL, st.bodyH * 0.8, 0.06, cabX + 0.05, yB + 0.02, -W / 2 - 0.03, 3, 1, 1);
    parts.doorR = box(doorL, st.bodyH * 0.8, 0.06, cabX + 0.05, yB + 0.02, W / 2 + 0.03, 3, 1, 1);
    const rear = box(0.14, 0.2, W * 1.0, -L / 2 - 0.03, 0.5, 0);

    const mk = (geo, mat, key) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.orig = Float32Array.from(geo.attributes.position.array);
      m.userData.key = key;
      this.inner.add(m);
      return m;
    };
    this.meshes = {
      body: mk(parts.body, this.paint, 'body'),
      cabin: mk(parts.cabin, sh.glass, 'cabin'),
      roof: mk(parts.roof, this.paint, 'roof'),
      hood: mk(parts.hood, this.paint, 'hood'),
      bumper: mk(parts.bumper, sh.chrome, 'bumper'),
      doorL: mk(parts.doorL, this.paintTrim, 'doorL'),
      doorR: mk(parts.doorR, this.paintTrim, 'doorR'),
      rear: mk(rear, sh.chrome, 'rear'),
    };
    this.deformables = Object.values(this.meshes);

    // Luces
    const hl = mergeGeometries([box(0.05, 0.1, 0.32, L / 2 + 0.005, yB + 0.08, -W * 0.33), box(0.05, 0.1, 0.32, L / 2 + 0.005, yB + 0.08, W * 0.33)]);
    const tl = mergeGeometries([box(0.05, 0.1, 0.36, -L / 2 - 0.005, yB + 0.1, -W * 0.33), box(0.05, 0.1, 0.36, -L / 2 - 0.005, yB + 0.1, W * 0.33)]);
    this.headlights = new THREE.Mesh(hl, sh.head);
    this.taillights = new THREE.Mesh(tl, sh.tail);
    this.inner.add(this.headlights, this.taillights);

    // Ruedas
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16, 1);
    wg.rotateX(Math.PI / 2);
    // costado (banda de rodadura) → esquina negra del atlas de la rueda
    const uv = wg.attributes.uv;
    const sideCount = (16 + 1) * 2;
    for (let i = 0; i < sideCount; i++) uv.setXY(i, 0.02, 0.02);
    this.wheels = {};
    const wx = L * 0.32, wz = W / 2 - 0.08;
    for (const [k, x, z] of [['wheelFL', wx, -wz], ['wheelFR', wx, wz], ['wheelRL', -wx, -wz], ['wheelRR', -wx, wz]]) {
      const m = new THREE.Mesh(wg, sh.wheel);
      m.position.set(x, 0.36, z);
      m.rotation.order = 'YZX';
      m.castShadow = true;
      this.inner.add(m);
      this.wheels[k] = m;
    }
    this.wheelGeo = wg;

    // Sombra de contacto
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.25, W * 1.5), sh.blob);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;

    this._dentVersion = -1;
    this._tier = -1;
    this._attached = '';
    this._glow = '';
    this.seed = Math.random() * 1000;
  }

  addTo(scene) { scene.add(this.group); scene.add(this.blob); }
  removeFrom(scene) {
    scene.remove(this.group); scene.remove(this.blob);
    for (const m of this.deformables) m.geometry.dispose();
    this.headlights.geometry.dispose(); this.taillights.geometry.dispose();
    this.blob.geometry.dispose();
    this.paint.dispose(); this.paintTrim.dispose();
  }

  _deform() {
    const v = this.v;
    const hl = this.L / 2, hw = this.W / 2;
    const tier = v.wreckTier;
    const crush = tier >= 3 ? 0.2 : tier >= 2 ? 0.08 : 0;
    for (const m of this.deformables) {
      const pos = m.geometry.attributes.position;
      const o = m.userData.orig;
      const arr = pos.array;
      for (let i = 0; i < pos.count; i++) {
        let x = o[i * 3], y = o[i * 3 + 1], z = o[i * 3 + 2];
        let dx = 0, dy = 0, dz = 0;
        for (const d of v.dents) {
          const ca = Math.cos(d.a), sa = Math.sin(d.a);
          if (d.top) {
            const cx = ca * hl * 0.35, cz = sa * hw * 0.3;
            const dist = Math.hypot(x - cx, z - cz);
            const R = 1.0 + d.depth * 1.2;
            if (dist < R && y > 0.75) {
              const f = Math.pow(1 - dist / R, 1.5) * d.depth;
              dy -= f * 0.45 * Math.min(1, (y - 0.6));
            }
            continue;
          }
          const t = Math.min(hl / Math.max(1e-3, Math.abs(ca)), hw / Math.max(1e-3, Math.abs(sa)));
          const cx = ca * t, cz = sa * t;
          const dist = Math.hypot(x - cx, z - cz);
          const R = 0.6 + d.depth * 0.9;
          if (dist < R) {
            const f = Math.pow(1 - dist / R, 2) * d.depth * 0.45;
            dx -= ca * f; dz -= sa * f; dy -= f * 0.25;
          }
        }
        if (crush && y > 0.95) dy -= crush * (y - 0.9);
        if (tier >= 1) {
          const n = Math.sin(i * 12.9898 + this.seed) * 43758.5453;
          const j = (n - Math.floor(n) - 0.5) * 0.03 * tier;
          dx += j; dy += j * 0.5; dz -= j;
        }
        // limita cuánto puede hundirse
        dx = Math.max(-hl * 0.45, Math.min(hl * 0.45, dx));
        dz = Math.max(-hw * 0.45, Math.min(hw * 0.45, dz));
        arr[i * 3] = x + dx; arr[i * 3 + 1] = y + dy; arr[i * 3 + 2] = z + dz;
      }
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
  }

  update(dt) {
    const v = this.v;
    const sh = getShared();
    if (v.dentVersion !== this._dentVersion || v.wreckTier !== this._tier) {
      this._dentVersion = v.dentVersion;
      this._deform();
    }
    const tier = v.wreckTier;
    if (tier !== this._tier) {
      this._tier = tier;
      const charred = tier >= 3 && (v.isWreck || v.onFire > 0);
      const c = this.baseColor.clone();
      if (tier === 1) c.multiplyScalar(0.9);
      if (tier === 2) c.lerp(new THREE.Color(0x5a4a3c), 0.35);
      if (tier === 3) c.lerp(new THREE.Color(0x3a3029), 0.6);
      this.paint.color.copy(c);
      this.paint.roughness = 0.38 + tier * 0.17;
      this.paint.metalness = 0.45 - tier * 0.1;
      this.paintTrim.color.copy(c).multiplyScalar(0.85);
      this.paintTrim.roughness = this.paint.roughness;
      this.meshes.cabin.material = tier >= 3 ? sh.glassBroken : tier >= 2 ? sh.glassCracked : sh.glass;
      if (charred) { this.meshes.body.material = sh.charred; this.meshes.roof.material = sh.charred; }
    }
    // piezas
    const att = Object.entries(v.parts).filter(([, p]) => p.attached === false).map(([k]) => k).join(',');
    if (att !== this._attached) {
      this._attached = att;
      for (const k of ['hood', 'bumper', 'doorL', 'doorR']) this.meshes[k].visible = v.parts[k].attached !== false;
      for (const k of Object.keys(this.wheels)) this.wheels[k].visible = v.parts[k].attached !== false;
      this.headlights.visible = v.parts.bumper.attached !== false || tier < 2;
    }
    const lightsOn = !v.isWreck && tier < 3;
    this.headlights.material = lightsOn ? sh.head : sh.lightOff;
    this.taillights.material = lightsOn ? (v.inputThrottle < -0.05 || v.inputHandbrake ? sh.tail : sh.tail) : sh.lightOff;
    sh.tail.emissiveIntensity = 0.9;

    // brillo psíquico
    const glow = v.frozen ? 'f' : (v.grabbed || v.lifted) ? 'g' : '';
    if (glow !== this._glow) {
      this._glow = glow;
      const e = glow === 'f' ? 0x2fd8ff : glow === 'g' ? 0x8a5cff : 0x000000;
      this.paint.emissive.setHex(e); this.paint.emissiveIntensity = glow ? 0.45 : 0;
      this.paintTrim.emissive.setHex(e); this.paintTrim.emissiveIntensity = glow ? 0.45 : 0;
    }

    // Ruedas: giro + dirección
    for (const [k, m] of Object.entries(this.wheels)) {
      m.rotation.z = -v.wheelSpin;
      m.rotation.y = k.startsWith('wheelF') ? -v.steerVisual : 0;
    }
    // Hundimiento por ruedas faltantes
    const miss = (k) => (v.parts[k].attached === false ? 1 : 0);
    const sagRoll = (miss('wheelFL') + miss('wheelRL') - miss('wheelFR') - miss('wheelRR')) * 0.07;
    const sagPitch = (miss('wheelFL') + miss('wheelFR') - miss('wheelRL') - miss('wheelRR')) * -0.05;
    const sagY = (miss('wheelFL') + miss('wheelFR') + miss('wheelRL') + miss('wheelRR')) * 0.07;

    const g = this.group;
    const z = v.liftZ * S;
    g.position.set(v.cx * S, z + 0.7 - sagY, v.cy * S);
    g.rotation.set(v.roll + sagRoll, -v.angle, v.pitch + sagPitch, 'YZX');
    // inclinación por aceleración / giro (suspensión)
    if (v.driven || v.aiDrive) {
      g.rotation.x += v.steerVisual * Math.min(1, v.speed / 200) * 0.06;
      g.rotation.z += -v.inputThrottle * 0.015;
    }
    this.blob.position.set(v.cx * S, 0.03, v.cy * S);
    this.blob.rotation.z = -v.angle;
    const bs = Math.max(0.3, 1 - z / 8);
    this.blob.scale.set(bs, bs, 1);
    this.blob.material.opacity = 0.9;
  }
}
