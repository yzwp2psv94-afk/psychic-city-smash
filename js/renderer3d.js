/**
 * Render 3D con Three.js: lee el estado lógico (px) y lo dibuja en metros (×0.1).
 * Cámaras: 1.ª persona, 3.ª persona cerca y lejana (a pie) y persecución / conductor (manejando).
 */

import * as THREE from 'three';
import { FLOOR_H, MAX_RUBBLE, MAX_CRACKS, MAX_DEBRIS, BLOCK, PITCH, SIDEWALK_W } from './world.js';
import {
  makeCityGround, makeFacadeAtlas, ATLAS, makeBackdropFacade, makeCrackTexture,
  makeCraterTexture, makeSoftSprite, makeGrassTile, makePuffSprite, makeBlobShadow,
} from './textures.js';
import { CarModel, WheelBatch, mergeGeometries, setCarEnvMap, setCarQuality, resetCarFrameBudget } from './carmodel.js';
import { MAX_PARTICLES } from './physics.js';
import { POWERS } from './powers.js';
import { Destruction3D, makeDustTexture } from './destruction3d.js';
import { GlbCarModel, hasCarGlb, registerCarGlb } from './glbcar.js';
import { registerDummyGlb, hasDummyGlb, DummyPool } from './glbdummy.js';
import { markFacadeGeometry, setFacadeLayers, patchFacadeMaterial, patchGroundMaterial, patchWorldMapped, patchCrackDecals, patchCraterDecals, patchSkyDome } from './assetfx.js';

const S = 0.1;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _qLean = new THREE.Quaternion();
const _axLean = new THREE.Vector3();
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();

// Resorte críticamente amortiguado (forma “SmoothDamp”): sin rebote, sin tirones, estable con dt variable
let _springV = 0;
function springScalar(cur, vel, target, omega, dt) {
  const x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (vel + omega * change) * dt;
  _springV = (vel - omega * temp) * e;
  return target + (change + temp) * e;
}
function springVec(cur, vel, target, omega, dt) {
  cur.x = springScalar(cur.x, vel.x, target.x, omega, dt); vel.x = _springV;
  cur.y = springScalar(cur.y, vel.y, target.y, omega, dt); vel.y = _springV;
  cur.z = springScalar(cur.z, vel.z, target.z, omega, dt); vel.z = _springV;
}
const _r = new THREE.Vector3();

/** Trozo irregular de concreto: icosaedro con vértices desplazados (sin grietas entre caras) */
function makeChunkGeometry(seed = 1) {
  const geo = new THREE.IcosahedronGeometry(0.62, 0);
  const pos = geo.attributes.position;
  const off = new Map();
  let r = seed * 9301 + 49297;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!off.has(key)) off.set(key, [0.75 + rnd() * 0.5, 0.75 + rnd() * 0.5, 0.75 + rnd() * 0.5]);
    const [a, b, c] = off.get(key);
    pos.setXYZ(i, pos.getX(i) * a * 1.25, pos.getY(i) * b, pos.getZ(i) * c * 1.15);
  }
  geo.computeVertexNormals();
  return geo;
}

const QUALITY = {
  high: { shadow: 2048, soft: true, particles: 1800, fxScale: 1, debrisCap: 380, decals: 180 },
  medium: { shadow: 1024, soft: false, particles: 1100, fxScale: 0.75, debrisCap: 260, decals: 120 },
  low: { shadow: 512, soft: false, particles: 650, fxScale: 0.5, debrisCap: 170, decals: 70 },
};
export { QUALITY };

function atlasUV(geo, faceRegions) {
  // BoxGeometry: grupos px,nx,py,ny,pz,nz — 4 vértices cada uno
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [x, y, w, h] = faceRegions[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, (x + u * w) / 512, 1 - (y + (1 - v) * h) / 512);
    }
  }
  uv.needsUpdate = true;
}

// Colores CSS → hex con caché (evita parsear strings cada cuadro)
const _colCache = new Map();
function colHex(css) {
  let h = _colCache.get(css);
  if (h === undefined) { if (_colCache.size > 600) _colCache.clear(); h = new THREE.Color(css).getHex(); _colCache.set(css, h); }
  return h;
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900);
    this.camera.position.set(0, 40, 40);
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 40, 40);
    // estado de resortes / transición de cámara (v4.1)
    this._cpV = new THREE.Vector3(); this._ctV = new THREE.Vector3();
    this._ft = new THREE.Vector3(); this._ftV = new THREE.Vector3(); this._fDist = 7;
    this._eyeY = 0; this._eyeV = 0;
    this._tr = 1; this._trFrom = new THREE.Vector3(); this._trFromT = new THREE.Vector3();
    this._outPos = new THREE.Vector3(0, 40, 40); this._outTgt = new THREE.Vector3();
    this.quality = 'high';
    this.scene.add(this.camera);  // las manos psíquicas (1.ª persona) cuelgan de la cámara
    this.composer = null; this.bloomOn = false;
    this._initStatic();
    this.worldGroup = null;
    this.carModels = new Map();
    this.wheelBatch = new WheelBatch(this.scene);
    this.width = 1; this.height = 1;
    this._loadCarEnv();
  }

  /** reflejos para pintura / vidrio / llantas (RoomEnvironment → PMREM, una vez) */
  async _loadCarEnv() {
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      const rt = pm.fromScene(env, 0.04);
      setCarEnvMap(rt.texture);
      env.traverse(o => { o.geometry?.dispose(); });
      pm.dispose();
    } catch (e) { /* sin reflejos */ }
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    this.quality = q;
    setCarQuality(q);
    this.destr?.setQuality(q);
    const Q = QUALITY[q];
    const size = Q.shadow;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type) {
      this.renderer.shadowMap.type = type;
      this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    }
    // Bloom barato solo en calidad alta (escritorio); apagado en media/baja
    if (q === 'high') this.setBloom(true).catch(() => { this.bloomOn = false; });
    else this.bloomOn = false;
    return Q;
  }

  async setBloom(on) {
    if (!on) { this.bloomOn = false; return; }
    if (!this.composer) {
      if (this._bloomLoading) return this._bloomLoading;
      this._bloomLoading = (async () => {
        const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
          import('three/addons/postprocessing/EffectComposer.js'),
          import('three/addons/postprocessing/RenderPass.js'),
          import('three/addons/postprocessing/UnrealBloomPass.js'),
          import('three/addons/postprocessing/OutputPass.js'),
        ]);
        const c = new EffectComposer(this.renderer);
        c.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.42, 0.55, 0.88);
        c.addPass(this.bloomPass);
        c.addPass(new OutputPass());
        this.composer = c;
        this._sizeComposer();
      })();
      await this._bloomLoading;
    }
    this.bloomOn = this.quality === 'high';
  }

  _sizeComposer() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  setSize(w, h, dpr = 1) {
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this._sizeComposer();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._updatePointScale();
  }

  _updatePointScale() {
    const h = this.height * this.renderer.getPixelRatio();
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    if (this.pMatNormal) { this.pMatNormal.uniforms.scale.value = s; this.pMatAdd.uniforms.scale.value = s; }
  }

  // ——————————————————— escena estática (cielo, luces, materiales) ———————————————————
  _initStatic() {
    const scene = this.scene;
    const fogColor = new THREE.Color(0xd8c3a6);
    scene.fog = new THREE.Fog(fogColor, 110, 340);
    this.fogBase = fogColor.clone();
    this.fogDust = new THREE.Color(0xb59f82);
    scene.background = fogColor;

    // Cielo con degradado + sol
    const skyGeo = new THREE.SphereGeometry(800, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x4f7fc4) }, mid: { value: new THREE.Color(0xa9bfd8) },
        horizon: { value: new THREE.Color(0xf0c591) }, sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += vec3(1.0,0.82,0.55) * pow(s, 64.0) * 1.2 + vec3(1.0,0.7,0.4) * pow(s, 6.0) * 0.25;
          // nubes altas baratas (2 octavas de ruido de valor)
          vec2 uv = vDir.xz / max(0.12, vDir.y) * 0.9;
          vec2 i0 = floor(uv), f0 = fract(uv); f0 = f0*f0*(3.0-2.0*f0);
          float a0 = fract(sin(dot(i0, vec2(127.1,311.7)))*43758.5), b0 = fract(sin(dot(i0+vec2(1,0), vec2(127.1,311.7)))*43758.5);
          float c0 = fract(sin(dot(i0+vec2(0,1), vec2(127.1,311.7)))*43758.5), d0 = fract(sin(dot(i0+vec2(1,1), vec2(127.1,311.7)))*43758.5);
          float n = mix(mix(a0,b0,f0.x), mix(c0,d0,f0.x), f0.y);
          vec2 uv2 = uv*2.7; vec2 i1 = floor(uv2), f1 = fract(uv2); f1 = f1*f1*(3.0-2.0*f1);
          float a1 = fract(sin(dot(i1, vec2(127.1,311.7)))*43758.5), b1 = fract(sin(dot(i1+vec2(1,0), vec2(127.1,311.7)))*43758.5);
          float c1 = fract(sin(dot(i1+vec2(0,1), vec2(127.1,311.7)))*43758.5), d1 = fract(sin(dot(i1+vec2(1,1), vec2(127.1,311.7)))*43758.5);
          n = n*0.65 + mix(mix(a1,b1,f1.x), mix(c1,d1,f1.x), f1.y)*0.35;
          float cl = smoothstep(0.55, 0.85, n) * smoothstep(0.02, 0.25, h) * 0.55;
          c = mix(c, vec3(1.0,0.93,0.86) + vec3(0.2,0.1,0.0)*pow(s,4.0), cl);
          if (h < 0.0) c = mix(horizon, vec3(0.55,0.5,0.45), smoothstep(0.0, -0.2, h));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x7d6a55, 1.1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdcb4, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0x9db7ff, 0.35);
    fill.position.set(40, 30, 60);
    scene.add(fill);

    // Luces dinámicas (cantidad fija → sin recompilar shaders)
    this.flashLights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 40, 2);
      scene.add(l);
      this.flashLights.push(l);
    }
    this.psyLight = new THREE.PointLight(0x9a7bff, 0, 18, 2);
    scene.add(this.psyLight);
    // Domos de onda expansiva (explosiones)
    this.shockSpheres = [];
    const shGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 7;
      scene.add(m);
      this.shockSpheres.push(m);
    }

    // Texturas compartidas
    this.atlas = makeFacadeAtlas();
    this.sprite = makeSoftSprite();
    this.puff = makePuffSprite();
    this.crackTex = makeCrackTexture();
    this.craterTex = makeCraterTexture();

    // Partículas (2 capas)
    const mkPoints = (additive) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(MAX_PARTICLES * 3);
      const col = new Float32Array(MAX_PARTICLES * 4);
      const size = new Float32Array(MAX_PARTICLES);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, scale: { value: 600 } }]),
        vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float scale; varying vec4 vColor;
          #include <fog_pars_vertex>
          void main(){ vColor = pcolor; vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = clamp(psize * scale / -mvPosition.z, 1.0, 512.0); gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `uniform sampler2D map; varying vec4 vColor;
          #include <fog_pars_fragment>
          void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
            if (gl_FragColor.a < 0.01) discard;
            #include <fog_fragment>
          }`,
        transparent: true, depthWrite: false, fog: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      mat.uniforms.map.value = additive ? this.sprite : this.puff; // humo/polvo con textura de nube
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = additive ? 6 : 5;
      scene.add(pts);
      return pts;
    };
    this.pNormal = mkPoints(false);
    this.pAdd = mkPoints(true);
    this.pMatNormal = this.pNormal.material;
    this.pMatAdd = this.pAdd.material;

    // Anillos FX
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x74b9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 7;
      scene.add(m);
      this.rings.push(m);
    }

    // Mira + arco de carga
    const retGeo = new THREE.RingGeometry(0.75, 0.95, 40); retGeo.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(retGeo, new THREE.MeshBasicMaterial({ color: 0xa29bfe, transparent: true, opacity: 0.9, depthTest: false }));
    this.reticle.renderOrder = 20;
    scene.add(this.reticle);
    const dotGeo = new THREE.CircleGeometry(0.16, 16); dotGeo.rotateX(-Math.PI / 2);
    this.reticleDot = new THREE.Mesh(dotGeo, this.reticle.material);
    this.reticleDot.renderOrder = 20;
    scene.add(this.reticleDot);
    this.chargeArcs = [];
    for (let i = 0; i <= 32; i++) {
      const g = new THREE.RingGeometry(1.05, 1.4, 48, 1, Math.PI / 2, Math.max(0.001, (i / 32) * Math.PI * 2));
      g.rotateX(-Math.PI / 2);
      this.chargeArcs.push(g);
    }
    this.chargeArc = new THREE.Mesh(this.chargeArcs[0], new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
    this.chargeArc.renderOrder = 21;
    scene.add(this.chargeArc);
    this.previewRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x74b9ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.previewRing.renderOrder = 7;
    scene.add(this.previewRing);

    // Campo de captura
    const discGeo = new THREE.CircleGeometry(1, 48); discGeo.rotateX(-Math.PI / 2);
    const catchMat = new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    this.catchDiscs = [new THREE.Mesh(discGeo, catchMat), new THREE.Mesh(discGeo, catchMat)];
    this.catchRings = [new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })), null];
    this.catchRings[1] = new THREE.Mesh(ringGeo, this.catchRings[0].material);
    for (const m of [...this.catchDiscs, ...this.catchRings]) { m.visible = false; m.renderOrder = 8; scene.add(m); }

    // Haz psíquico
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0); beamGeo.rotateX(Math.PI / 2);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xb39dff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beamOuter = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x7b5cff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.visible = this.beamOuter.visible = false;
    scene.add(this.beam, this.beamOuter);

    // Láser de los ojos: núcleo + halo + aura (grosor/brillo según Fuerza)
    this.lasers = [];
    for (let i = 0; i < 2; i++) {
      const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff4a12, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const aura = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.visible = glow.visible = aura.visible = false;
      core.renderOrder = glow.renderOrder = aura.renderOrder = 9;
      scene.add(core, glow, aura);
      this.lasers.push({ core, glow, aura });
    }
    this.laserHit = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sprite, color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.laserHit.visible = false; this.laserHit.renderOrder = 10;
    scene.add(this.laserHit);

    // Manos psíquicas (1.ª persona)
    const handMat = new THREE.MeshBasicMaterial({ color: 0xb39dff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.hands = [new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), handMat), new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), handMat)];
    this.hands[0].position.set(-0.15, -0.115, -0.36); this.hands[1].position.set(0.15, -0.115, -0.36);
    this.handGlow = this.hands.map(h => { const g2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sprite, color: 0x9a7bff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); g2.scale.setScalar(0.07); h.add(g2); return g2; });
    for (const h of this.hands) { h.visible = false; h.renderOrder = 30; this.camera.add(h); }

    // Sombra de contacto del jugador (clave para medir la altura al volar)
    this.playerBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: makeBlobShadow(), transparent: true, depthWrite: false, opacity: 0.75 }));
    this.playerBlob.rotation.x = -Math.PI / 2; this.playerBlob.renderOrder = 1;
    scene.add(this.playerBlob);

    // Escudo
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0x00e0a8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.shield.visible = false;
    scene.add(this.shield);

    // Personajes
    this.player = this._makeHero(0x6c5ce7, 0x2b2350);
    this.rival = this._makeHero(0xe84393, 0x4a1530);
    scene.add(this.player.group, this.rival.group);
    this.rival.group.visible = false;
  }

  _makeHero(glow, suit) {
    const group = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.55, metalness: 0.2 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.7 });
    const glowMat = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.2 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 10), suitMat);
    torso.position.y = 1.15; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin);
    head.position.y = 1.78; head.castShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 16), glowMat);
    band.position.y = 1.86; band.rotation.x = Math.PI / 2;
    const legGeo = new THREE.BoxGeometry(0.17, 0.75, 0.2); legGeo.translate(0, -0.375, 0);
    const legL = new THREE.Mesh(legGeo, suitMat); legL.position.set(0, 0.8, -0.13); legL.castShadow = true;
    const legR = new THREE.Mesh(legGeo, suitMat); legR.position.set(0, 0.8, 0.13); legR.castShadow = true;
    const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.13); armGeo.translate(0, -0.3, 0);
    const armL = new THREE.Mesh(armGeo, suitMat); armL.position.set(0, 1.48, -0.36);
    const armR = new THREE.Mesh(armGeo, suitMat); armR.position.set(0, 1.48, 0.36);
    const handGeo = new THREE.SphereGeometry(0.09, 8, 6);
    const handL = new THREE.Mesh(handGeo, glowMat); handL.position.y = -0.62; armL.add(handL);
    const handR = new THREE.Mesh(handGeo, glowMat); handR.position.y = -0.62; armR.add(handR);
    const auraGeo = new THREE.TorusGeometry(0.75, 0.035, 6, 40); auraGeo.rotateX(Math.PI / 2);
    const aura = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.position.y = 0.06;
    group.add(torso, head, band, legL, legR, armL, armR, aura);
    return { group, legL, legR, armL, armR, aura, glowMat };
  }

  // ——————————————————— mundo por sesión ———————————————————
  buildWorld(world) {
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.worldGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.userData.ownMat) o.material.dispose();
      });
      if (this.groundTex) this.groundTex.dispose();
    }
    for (const [, cm] of this.carModels) cm.removeFrom(this.scene);
    this.carModels.clear();
    this.scorchMesh = null; this.patchMesh = null;

    const g = new THREE.Group();
    this.worldGroup = g;
    this.world = world;
    this.scene.add(g);

    // Suelo
    const margin = 260;
    const ground = makeCityGround(world, margin);
    this.groundTex = ground.texture;
    const gm = new THREE.Mesh(
      new THREE.PlaneGeometry(ground.spanX * S, ground.spanY * S),
      new THREE.MeshStandardMaterial({ map: ground.texture, roughness: 0.93, metalness: 0 }),
    );
    gm.userData.ownMat = true;
    gm.rotation.x = -Math.PI / 2;
    gm.position.set((ground.minX + ground.spanX / 2) * S, 0, (ground.minY + ground.spanY / 2) * S);
    gm.receiveShadow = true;
    g.add(gm);
    this.groundMesh = gm;
    this.groundSpan = { minX: ground.minX, minY: ground.minY, spanX: ground.spanX, spanY: ground.spanY };
    const grass = makeGrassTile(); grass.repeat.set(120, 120);
    // v4.2: pasto exterior como marco alrededor del suelo de la ciudad (sin solaparse: los cráteres no quedan tapados
    // y no hay sobre-dibujado)
    const ocx = ((world.minX ?? 0) + world.w) * S / 2, ocy = ((world.minY ?? 0) + world.h) * S / 2, OH = 1200;
    const gx0 = ground.minX * S - ocx, gx1 = (ground.minX + ground.spanX) * S - ocx;
    const gy0 = ground.minY * S - ocy, gy1 = (ground.minY + ground.spanY) * S - ocy;
    const frame = new THREE.Shape([new THREE.Vector2(-OH, -OH), new THREE.Vector2(OH, -OH), new THREE.Vector2(OH, OH), new THREE.Vector2(-OH, OH)]);
    // (y de la forma = −z del mundo tras girar el plano)
    frame.holes.push(new THREE.Path([new THREE.Vector2(gx0, -gy1), new THREE.Vector2(gx0, -gy0), new THREE.Vector2(gx1, -gy0), new THREE.Vector2(gx1, -gy1)]));
    const og = new THREE.ShapeGeometry(frame);
    { const p = og.attributes.position, uv = og.attributes.uv;   // UV como el plano original (1600 m)
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + OH) / (2 * OH), (p.getY(i) + OH) / (2 * OH)); }
    const outer = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    outer.userData.ownMat = true;
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(ocx, -0.05, ocy);
    g.add(outer);

    this._buildBuildings(world, g);
    // v4.2: fractura realista, coronas dentadas, esqueletos, fachadas que caen y cráteres
    this.destr = new Destruction3D({
      group: g, world, groundMesh: gm, groundSpan: this.groundSpan,
      buildingMat: this.buildingMat, facadeGeos: this._facadeGeos, quality: this.quality,
    });
    this._buildBackdrop(world, g, margin);
    this._buildProps(world, g);

    // Escombros dinámicos
    const debMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    debMat.userData = {};
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debMat, MAX_DEBRIS + 120);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.castShadow = true; this.debrisMesh.receiveShadow = true;
    this.debrisMesh.count = 0;
    this.debrisMesh.userData.ownMat = true;
    g.add(this.debrisMesh);
    // v6: planos de corte del láser (emisivos) + piezas de ragdoll
    const cutMat = new THREE.MeshStandardMaterial({
      color: 0xffc070, emissive: 0xff8028, emissiveIntensity: 3.0,
      transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide,
    });
    this.cutMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), cutMat, 28);
    this.cutMesh.count = 0; this.cutMesh.frustumCulled = false; this.cutMesh.renderOrder = 5;
    this.cutMesh.userData.ownMat = true; g.add(this.cutMesh);
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffcc66, emissive: 0xff7a20, emissiveIntensity: 3.6,
      transparent: true, opacity: 0.98, depthWrite: false, side: THREE.DoubleSide, roughness: 0.25, metalness: 0.15,
    });
    this.cutFaceMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), faceMat, 48);
    this.cutFaceMesh.count = 0; this.cutFaceMesh.frustumCulled = false; this.cutFaceMesh.renderOrder = 6;
    this.cutFaceMesh.userData.ownMat = true; g.add(this.cutFaceMesh);
    const ragMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    this.ragdollMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ragMat, 64);
    this.ragdollMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ragdollMesh.castShadow = true; this.ragdollMesh.count = 0; this.ragdollMesh.frustumCulled = false;
    this.ragdollMesh.userData.ownMat = true;
    this.ragdollMesh.setColorAt(0, new THREE.Color(0x888888)); // crea instanceColor
    g.add(this.ragdollMesh);
    // Articulaciones visibles (bolas de maniquí de choque)
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0xd0d0d0, emissive: 0x333333, emissiveIntensity: 0.15,
      roughness: 0.35, metalness: 0.55,
    });
    this.jointMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), jointMat, 80);
    this.jointMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.jointMesh.castShadow = true; this.jointMesh.count = 0; this.jointMesh.frustumCulled = false;
    this.jointMesh.userData.ownMat = true;
    this.jointMesh.setColorAt(0, new THREE.Color(0xd0d0d0));
    g.add(this.jointMesh);
    const chunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02, flatShading: true });
    this.chunkMesh = new THREE.InstancedMesh(makeChunkGeometry(3), chunkMat, MAX_DEBRIS + 120);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.castShadow = true; this.chunkMesh.receiveShadow = true;
    this.chunkMesh.count = 0; this.chunkMesh.frustumCulled = false;
    this.chunkMesh.userData.ownMat = true;
    g.add(this.chunkMesh);
    const wg = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.wheelDebris = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 }), 120);
    this.wheelDebris.castShadow = true;
    this.wheelDebris.count = 0;
    this.wheelDebris.userData.ownMat = true;
    g.add(this.wheelDebris);

    // Escombro estático (montones)
    this.rubbleMesh = new THREE.InstancedMesh(makeChunkGeometry(7), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), MAX_RUBBLE);
    this.rubbleMesh.castShadow = true; this.rubbleMesh.receiveShadow = true;
    this.rubbleMesh.count = 0;
    this.rubbleMesh.userData.ownMat = true;
    this.rubbleMesh.frustumCulled = false;
    g.add(this.rubbleMesh);
    this._rubbleSeen = 0;

    // Grietas y cráteres
    const decal = (map) => {
      const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
        map, transparent: true, depthWrite: false, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }), MAX_CRACKS);
      m.count = 0; m.receiveShadow = true; m.renderOrder = 2; m.frustumCulled = false;
      m.userData.ownMat = true;
      g.add(m);
      return m;
    };
    this.crackMesh = decal(this.crackTex);
    this.craterMesh = decal(this.craterTex);
    this.dustTex = this.dustTex || makeDustTexture();
    this.dustMesh = decal(this.dustTex);
    this._crackSeen = -1;

    // NPCs instanciados
    const npcCap = 220;
    const torsoGeo = new THREE.CapsuleGeometry(0.2, 0.42, 3, 8); torsoGeo.translate(0, 1.1, 0);
    const headGeo = new THREE.SphereGeometry(0.16, 10, 8); headGeo.translate(0, 1.62, 0);
    const legsGeo = new THREE.BoxGeometry(0.22, 0.78, 0.3); legsGeo.translate(0, 0.39, 0);
    const npcMat = () => new THREE.MeshStandardMaterial({ roughness: 0.75 });
    this.npcTorso = new THREE.InstancedMesh(torsoGeo, npcMat(), npcCap);
    this.npcHead = new THREE.InstancedMesh(headGeo, npcMat(), npcCap);
    this.npcLegs = new THREE.InstancedMesh(legsGeo, npcMat(), npcCap);
    for (const m of [this.npcTorso, this.npcHead, this.npcLegs]) {
      m.castShadow = true; m.count = 0; m.frustumCulled = false; m.userData.ownMat = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.add(m);
    }
    if (this.assets) { try { this._applyWorldAssets(world); } catch (e) { console.warn('assets (mundo):', e); } }
    this._lastSegVersion = -1;
    this._propVersion = -1;
    // Precompila shaders (onda expansiva, trozos, anillos) para evitar tirones en la 1.ª explosión
    this._fixInstancedDepth();
    const tmp = [...this.shockSpheres, ...this.rings];
    tmp.forEach(m => { m.visible = true; });
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* opcional */ }
    tmp.forEach(m => { m.visible = false; });
  }

  /** v4.3: assets CC0 cargados (autos, texturas, cielo). Se aplican ahora y en cada mundo nuevo. */
  setAssets(a) {
    if (!a) return;
    this.assets = a;
    // autos .glb → los modelos actuales se recrean con la versión .glb
    let cars = 0;
    for (const [name, scene] of Object.entries(a.cars || {})) { try { registerCarGlb(name, scene); cars++; } catch (e) { console.warn('glb', name, e); } }
    if (cars) { for (const [, cm] of this.carModels) cm.removeFrom(this.scene); this.carModels.clear(); }
    // maniquí .glb
    if (a.dummy) {
      try {
        if (registerDummyGlb(a.dummy)) {
          this.dummyPool = new DummyPool(this.scene, 12);
        }
      } catch (e) { console.warn('dummy glb:', e); }
    }
    // cielo + reflejos
    if (a.sky?.tex) {
      try {
        patchSkyDome(this.sky.material, a.sky.tex, a.sky.hdr);
        this.skyTex = a.sky.tex;
        if (a.sky.hdr || this.quality !== 'low') {
          const pm = new THREE.PMREMGenerator(this.renderer);
          const env = pm.fromEquirectangular(a.sky.tex);
          pm.dispose();
          this.scene.environment = env.texture;
          this.scene.environmentIntensity = 0.26;
          this.hemi.intensity = 0.85;
          setCarEnvMap(env.texture);
          this.envTex = env.texture;
        }
      } catch (e) { console.warn('cielo:', e); }
    }
    if (this.world) { try { this._applyWorldAssets(this.world); } catch (e) { console.warn('assets (mundo):', e); } }
  }

  _applyWorldAssets(world) {
    const a = this.assets, tex = a.tex || {}, avg = a.avg || {};
    if (world._assetsApplied === this.buildingMat) return;
    world._assetsApplied = this.buildingMat;
    // fachadas fotográficas (textura array, una capa por edificio) con ventanas que se encienden
    if (tex.facade && this._facadeGeos) {
      for (const b of world.buildings) {
        const r = Math.random();
        b.facL = b.floors >= 9 ? (r < 0.45 ? 3 : r < 0.85 ? 2 : 1) : b.floors <= 4 ? (r < 0.3 ? 0 : r < 0.9 ? 1 : 2) : (r < 0.25 ? 0 : r < 0.55 ? 1 : r < 0.85 ? 2 : 3);
      }
      for (let i = 0; i < this._facadeGeos.length; i++) {
        markFacadeGeometry(this._facadeGeos[i]);
        setFacadeLayers(this.bMeshes[i], 300, arr => {
          for (const seg of world.segments) {
            if (seg.meshIndex !== i) continue;
            const L = world.buildings[seg.buildingId]?.facL || 0;
            for (let f = 0; f < seg.floors; f++) arr[seg.instStart + f] = L;
          }
        });
      }
      patchFacadeMaterial(this.buildingMat, tex.facade, tex.facadeNormal || null);
    }
    // calle / banqueta / concreto + cráteres con escombro
    if ((tex.asphalt || tex.sidewalk || tex.concrete) && this.groundMesh) patchGroundMaterial(this.groundMesh.material, tex, avg, world);
    // escombro y estructura rota
    if (tex.broken) {
      patchWorldMapped(this.chunkMesh.material, tex.broken, avg.broken, 1.4, 'chunk');
      if (this.destr) patchWorldMapped(this.destr.concreteMat, tex.broken, avg.broken, 2.2, 'slab');
    }
    if (tex.rubble || tex.broken) patchWorldMapped(this.rubbleMesh.material, tex.rubble || tex.broken, avg.rubble || avg.broken, 1.8, 'rubble');
    if (this.destr) {
      if (tex.rebar) patchWorldMapped(this.destr.crownMat, tex.rebar, avg.rebar, 3.0, 'crown', 0.8);
      if (tex.concrete) patchWorldMapped(this.destr.skelMat, tex.concrete, avg.concrete, 3.0, 'skel', 0.7);
      if (tex.craterDecal) this.destr.setCraterDecal(tex.craterDecal);
    }
    // decals
    if (tex.cracks && !this.patchMesh) {   // marcas de asfalto roto (atlas CC0); las grietas radiales siguen siendo líneas
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
        color: 0x707070, transparent: true, depthWrite: false, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }), MAX_CRACKS);
      patchCrackDecals(m, tex.cracks);
      m.count = 0; m.receiveShadow = true; m.renderOrder = 2; m.frustumCulled = false; m.userData.ownMat = true;
      this.worldGroup.add(m);
      this.patchMesh = m;
    }
    if (tex.craterDecal) patchCraterDecals(this.craterMesh, tex.craterDecal);
    if (tex.scorch && !this.scorchMesh) {
      const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
        map: tex.scorch, transparent: true, depthWrite: false, roughness: 1, alphaTest: 0.02,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }), MAX_CRACKS);
      m.count = 0; m.receiveShadow = true; m.renderOrder = 2; m.frustumCulled = false; m.userData.ownMat = true;
      this.worldGroup.add(m);
      this.scorchMesh = m;
    }
    this._crackSeen = -1;
  }

  _buildBuildings(world, g) {
    const atlasMat = new THREE.MeshStandardMaterial({
      map: this.atlas.map, emissiveMap: this.atlas.emissive, emissive: 0xffc070, emissiveIntensity: 0.7,
      roughness: 0.62, metalness: 0.08,
    });
    atlasMat.userData = {};
    atlasMat.emissiveIntensity = 1.0;
    // Ventanas encendidas al azar (por piso, cara y mitad de fachada) con tonos cálidos/fríos
    atlasMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWinCell; varying vec3 vWinLocal; varying vec3 vWinN; varying float vWinY;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vWinCell = instanceMatrix[3].xyz;
            vWinY = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
          #else
            vWinCell = vec3(0.0);
            vWinY = (modelMatrix * vec4(position, 1.0)).y;
          #endif
          vWinLocal = position; vWinN = normal;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWinCell; varying vec3 vWinLocal; varying vec3 vWinN; varying float vWinY;')
        .replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
            bool zFace = abs(vWinN.z) > 0.5;
            float hx = zFace ? vWinLocal.x : vWinLocal.z;
            float fid = zFace ? (vWinN.z > 0.0 ? 0.0 : 1.0) : (vWinN.x > 0.0 ? 2.0 : 3.0);
            float half_ = step(0.0, hx);
            float flr = floor(vWinY / ${(FLOOR_H * S).toFixed(3)} + 0.001);
            vec3 cq = mod(floor(vWinCell * 4.0 + 0.5), 97.0);
            float hsh = fract(sin(dot(vec3(cq.x * 3.1 + fid * 17.0 + half_ * 5.3, flr * 7.7 + cq.y, cq.z * 1.9), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            float lit = step(0.56, hsh);
            vec3 tint = mix(vec3(1.0, 0.74, 0.42), vec3(0.72, 0.86, 1.0), step(0.82, fract(hsh * 13.0)));
            totalEmissiveRadiance *= emissiveColor.rgb * lit * tint * (0.55 + fract(hsh * 7.0) * 0.9);
          #endif`);
    };
    this.buildingMat = atlasMat;
    const geos = [];
    for (let s = 0; s < 3; s++) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const f = ATLAS.facade[s];
      atlasUV(geo, [f, f, ATLAS.roof, ATLAS.slab, f, f]);
      geos.push(geo);
    }
    this._facadeGeos = geos;
    const coreGeo = new THREE.BoxGeometry(1, 1, 1);
    atlasUV(coreGeo, [ATLAS.broken, ATLAS.broken, ATLAS.roof, ATLAS.slab, ATLAS.broken, ATLAS.broken]);

    // estilo por edificio
    for (const b of world.buildings) b.style = Math.floor(Math.random() * 3);
    const counts = [0, 0, 0, 0];
    for (const seg of world.segments) {
      const b = world.buildings[seg.buildingId];
      const mi = seg.kind === 'core' ? 3 : b.style;
      seg.meshIndex = mi;
      seg.instStart = counts[mi];
      counts[mi] += seg.floors;
    }
    this.bMeshes = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.InstancedMesh(i === 3 ? coreGeo : geos[i], atlasMat, Math.max(1, counts[i]));
      m.count = counts[i];
      m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      g.add(m);
      this.bMeshes.push(m);
    }
    atlasMat.userData.shared = true;
    for (const seg of world.segments) {
      seg.tintVar = 0.88 + Math.random() * 0.14;
      this._writeSegment(seg);
    }
    for (const m of this.bMeshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // Objetos de azotea (AC, tanques)
    const roofItems = [];
    for (const b of world.buildings) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const seg = b.segs[Math.floor(Math.random() * b.segs.length)];
        roofItems.push({ seg, kind: Math.random() > 0.35 ? 'ac' : 'tank', ox: (Math.random() - 0.5) * 8, oy: (Math.random() - 0.5) * 8, rot: Math.random() * Math.PI });
      }
    }
    this.roofItems = roofItems;
    const acGeo = new THREE.BoxGeometry(1.3, 0.9, 1.0); acGeo.translate(0, 0.45, 0);
    const tankGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.6, 12); tankGeo.translate(0, 0.8, 0);
    this.acMesh = new THREE.InstancedMesh(acGeo, new THREE.MeshStandardMaterial({ color: 0xbfc3c6, roughness: 0.5, metalness: 0.5 }), Math.max(1, roofItems.length));
    this.tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: 0x8b8f8a, roughness: 0.6, metalness: 0.3 }), Math.max(1, roofItems.length));
    for (const m of [this.acMesh, this.tankMesh]) { m.castShadow = true; m.userData.ownMat = true; m.frustumCulled = false; g.add(m); }
    this._writeRoofItems();
  }

  _writeSegment(seg) {
    const mesh = this.bMeshes[seg.meshIndex];
    const b = this.world.buildings[seg.buildingId];
    _c.setHex(colHex(seg.color));
    const dmg = 1 - seg.hp / seg.maxHp;
    // v4.2: el edificio que colapsa se inclina (cizalla) hacia su lado dañado
    const lean = b && b.lean ? b.lean : 0;
    let leanQ = null, tanL = 0;
    if (lean) { leanQ = _qLean.setFromAxisAngle(_axLean.set(b.leanDY, 0, -b.leanDX), lean); tanL = Math.tan(lean); }
    const destr = this.destr;
    const skel = !!(seg.skeleton && destr && destr.skelSlot(seg));
    for (let f = 0; f < seg.floors; f++) {
      const i = seg.instStart + f;
      if (f < seg.floorsAlive) {
        const zc = (f + 0.5) * FLOOR_H;
        _p.set((seg.cx + (lean ? b.leanDX * zc * tanL : 0)) * S, zc * S, (seg.cy + (lean ? b.leanDY * zc * tanL : 0)) * S);
        _s.set(seg.w * S + 0.002, FLOOR_H * S, seg.h * S + 0.002);
        _m.compose(_p, leanQ || _q.identity(), _s);
        if (skel) {
          mesh.setMatrixAt(i, ZERO_M);
          mesh.setColorAt(i, _v.set(0, 0, 0));
          _p.y = f * FLOOR_H * S;   // el esqueleto se arma desde la base del piso
          _m.compose(_p, leanQ || _q.identity(), _s);
          destr.setSkelFloor(seg, f, _m, _c, true);
          continue;
        }
        mesh.setMatrixAt(i, _m);
        const top = f === seg.floorsAlive - 1;
        const shade = seg.tintVar * (1 - dmg * 0.42) * (top && dmg > 0 ? 0.7 : 1);
        mesh.setColorAt(i, _v.set(_c.r * shade, _c.g * shade, _c.b * shade));
      } else {
        mesh.setMatrixAt(i, ZERO_M);
        mesh.setColorAt(i, _v.set(0, 0, 0));
        if (skel) destr.setSkelFloor(seg, f, null, _c, false);
      }
    }
    if (destr) destr.writeSegExtras(seg, b, _c, leanQ, tanL);
  }

  _writeRoofItems() {
    let ia = 0, it = 0;
    for (const r of this.roofItems) {
      const seg = r.seg;
      const intact = seg.floorsAlive === seg.floors;
      _p.set((seg.cx + r.ox) * S, seg.floors * FLOOR_H * S, (seg.cy + r.oy) * S);
      _q.setFromAxisAngle(_v.set(0, 1, 0), r.rot);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      if (r.kind === 'ac') this.acMesh.setMatrixAt(ia++, intact ? _m : ZERO_M);
      else this.tankMesh.setMatrixAt(it++, intact ? _m : ZERO_M);
    }
    this.acMesh.count = ia; this.tankMesh.count = it;
    this.acMesh.instanceMatrix.needsUpdate = true; this.tankMesh.instanceMatrix.needsUpdate = true;
  }

  _buildBackdrop(world, g, margin) {
    // Edificios de fondo (no destructibles) en el anillo fuera de los límites
    const geos = [];
    const n = world.roadPos.length;
    for (let bx = -2; bx <= n + 1; bx++) for (let by = -2; by <= n + 1; by++) {
      if (bx >= 0 && bx <= n && by >= 0 && by <= n) continue;
      const x0 = bx * PITCH, y0 = by * PITCH;
      const parts = Math.random() > 0.5 ? 2 : 1;
      for (let k = 0; k < parts; k++) {
        const w = parts === 2 ? BLOCK / 2 - 12 : BLOCK - 30;
        const x = x0 + 15 + k * (BLOCK / 2), y = y0 + 15;
        const hgt = (4 + Math.random() * 12) * FLOOR_H;
        const d = BLOCK - 30;
        const geo = new THREE.BoxGeometry(w * S, hgt * S, d * S);
        const uv = geo.attributes.uv;
        const faces = [[d, hgt], [d, hgt], [0, 0], [0, 0], [w, hgt], [w, hgt]];
        for (let f = 0; f < 6; f++) for (let kk = 0; kk < 4; kk++) {
          const i = f * 4 + kk;
          const [fw, fh] = faces[f];
          if (!fw) { uv.setXY(i, 0.02, 0.02); continue; }
          uv.setXY(i, uv.getX(i) * fw / 26, uv.getY(i) * fh / FLOOR_H);
        }
        geo.translate((x + w / 2) * S, hgt * S / 2, (y + d / 2) * S);
        geos.push(geo);
      }
    }
    const merged = mergeGeometries(geos);
    geos.forEach(x => x.dispose());
    const tex = makeBackdropFacade();
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ map: tex, color: 0xd9d2c8, roughness: 0.7 }));
    mesh.userData.ownMat = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    void margin; void SIDEWALK_W;
  }

  _buildProps(world, g) {
    const trees = world.props.filter(p => p.kind === 'tree');
    const lamps = world.props.filter(p => p.kind === 'lamp');
    const hyds = world.props.filter(p => p.kind === 'hydrant');
    this.treeProps = trees; this.lampProps = lamps; this.hydProps = hyds;
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 2.4, 7); trunkGeo.translate(0, 1.2, 0);
    const fol1 = new THREE.IcosahedronGeometry(1.4, 1); fol1.translate(0, 3.0, 0);
    const fol2 = new THREE.IcosahedronGeometry(1.0, 1); fol2.translate(0.5, 3.9, 0.2);
    const folGeo = mergeGeometries([fol1, fol2]);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, flatShading: true });
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5c3d22, roughness: 0.9 }), Math.max(1, trees.length));
    this.folMesh = new THREE.InstancedMesh(folGeo, foliageMat, Math.max(1, trees.length));
    trees.forEach((t, i) => {
      _c.setHSL(0.27 + Math.random() * 0.06, 0.45 + Math.random() * 0.15, 0.25 + Math.random() * 0.1);
      this.folMesh.setColorAt(i, _c);
    });
    const poleGeo = mergeGeometries([
      (() => { const x = new THREE.CylinderGeometry(0.06, 0.09, 4.6, 6); x.translate(0, 2.3, 0); return x; })(),
      (() => { const x = new THREE.BoxGeometry(1.1, 0.06, 0.06); x.translate(0.5, 4.55, 0); return x; })(),
    ]);
    const headGeo = new THREE.BoxGeometry(0.5, 0.14, 0.26); headGeo.translate(1.0, 4.48, 0);
    this.poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.5, metalness: 0.6 }), Math.max(1, lamps.length));
    this.lampHead = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd58a, emissiveIntensity: 1.3 }), Math.max(1, lamps.length));
    const hydGeo = mergeGeometries([
      (() => { const x = new THREE.CylinderGeometry(0.14, 0.17, 0.7, 10); x.translate(0, 0.35, 0); return x; })(),
      (() => { const x = new THREE.SphereGeometry(0.15, 10, 6); x.translate(0, 0.72, 0); return x; })(),
      (() => { const x = new THREE.BoxGeometry(0.46, 0.1, 0.1); x.translate(0, 0.45, 0); return x; })(),
    ]);
    this.hydMesh = new THREE.InstancedMesh(hydGeo, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.2 }), Math.max(1, hyds.length));
    for (const m of [this.trunkMesh, this.folMesh, this.poleMesh, this.lampHead, this.hydMesh]) {
      m.castShadow = true; m.receiveShadow = true; m.userData.ownMat = true; m.frustumCulled = false;
      g.add(m);
    }
    // orientación de faroles hacia la calle
    for (const l of lamps) {
      let best = 0, bd = Infinity;
      for (const r of world.roads) {
        const cx = r.horiz ? l.cx : r.x + r.w / 2, cy = r.horiz ? r.y + r.h / 2 : l.cy;
        const d = Math.hypot(cx - l.cx, cy - l.cy);
        if (d < bd) { bd = d; best = Math.atan2(cy - l.cy, cx - l.cx); }
      }
      l.rot = best;
    }
    this._writeProps();
  }

  _propMatrix(p, scale = 1, yawOverride) {
    const yaw = yawOverride ?? p.rot;
    _q.setFromAxisAngle(_v.set(0, 1, 0), -yaw);
    if (p.toppled) {
      const d = p.angle;
      const tq = new THREE.Quaternion().setFromAxisAngle(_v.set(Math.sin(d), 0, -Math.cos(d)), p.fall * Math.PI / 2 * 0.96);
      _q.premultiply(tq);
    }
    _p.set(p.cx * S, 0, p.cy * S);
    return _m.compose(_p, _q, _s.set(scale, scale, scale));
  }

  _writeProps() {
    this.treeProps.forEach((t, i) => {
      if (t.cut) {
        // Tocón: tronco corto, sin copa
        const sc = t.scale || 1;
        _p.set(t.cx * S, 0, t.cy * S);
        _q.identity();
        this.trunkMesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(sc, sc * ((t.cutZ || 10) / 22), sc)));
        this.folMesh.setMatrixAt(i, ZERO_M);
      } else {
        const m = this._propMatrix(t, t.scale);
        this.trunkMesh.setMatrixAt(i, m);
        this.folMesh.setMatrixAt(i, t.destroyed ? ZERO_M : m);
      }
    });
    this.lampProps.forEach((l, i) => {
      const m = this._propMatrix(l, 1);
      this.poleMesh.setMatrixAt(i, m);
      this.lampHead.setMatrixAt(i, l.destroyed ? ZERO_M : m);
    });
    this.hydProps.forEach((h, i) => {
      if (h.destroyed) { _p.set(h.cx * S, 0, h.cy * S); this.hydMesh.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.set(1, 0.25, 1))); }
      else this.hydMesh.setMatrixAt(i, this._propMatrix(h, 1, 0));
    });
    for (const m of [this.trunkMesh, this.folMesh, this.poleMesh, this.lampHead, this.hydMesh]) m.instanceMatrix.needsUpdate = true;
  }

  // ——————————————————— sincronización por frame ———————————————————
  sync(game, dt) {
    const world = game.world;
    if (!world || world !== this.world) return;
    if (((this._depthFixT = (this._depthFixT || 0) + 1) & 127) === 1) this._fixInstancedDepth();

    // Edificios dañados
    if (world.dirtySegs.length) {
      const touched = new Set();
      for (const seg of world.dirtySegs) {
        if (!seg.dirty) continue;
        seg.dirty = false;
        this._writeSegment(seg);
        touched.add(seg.meshIndex);
      }
      world.dirtySegs.length = 0;
      for (const i of touched) {
        this.bMeshes[i].instanceMatrix.needsUpdate = true;
        if (this.bMeshes[i].instanceColor) this.bMeshes[i].instanceColor.needsUpdate = true;
      }
      this._writeRoofItems();
    }

    // Props (animación de caída)
    if (world.props.some(p => p.toppled && p.fall < 1) || world.propVersion !== this._propVersion) {
      this._propVersion = world.propVersion;
      this._writeProps();
    }

    this._syncDebris(world, game);
    this._syncCutPlanes(world);
    this._syncRagdolls(game);
    this._syncRubble(world);
    this._syncCracks(world);
    this.destr?.sync();
    this._syncParticles(world);
    this._syncFx(world, dt, game);
    this._syncVehicles(game, dt);
    this._syncCharacters(game, dt);
    this._syncPowers(game, dt);
  }

  _syncDebris(world, game) {
    let n = 0, nw = 0, nc = 0;
    const dm = this.debrisMesh, wm = this.wheelDebris, cm = this.chunkMesh;
    const cap = dm.instanceMatrix.count, capW = wm.instanceMatrix.count, capC = cm.instanceMatrix.count;
    const destr = this.destr;
    const craters = world.craters && world.craters.length > 0;
    if (destr) destr.beginDebris();
    for (const d of world.debris) {
      if (!d.alive) continue;
      const isWheel = d.data.carPart && d.data.carPart.startsWith('wheel');
      _e.set(d.tumbleX, -d.angle, d.tumbleZ, 'YXZ');
      _q.setFromEuler(_e);
      if (destr && d.data.shape && d.data.shape !== 'chunk') {
        _c.setHex(colHex(d.color));
        if (d.frozen) _c.lerp(_v.set(0.3, 0.95, 1), 0.55);
        else if (d.grabbed) _c.lerp(_v.set(0.65, 0.5, 1), 0.5);
        if (destr.pushDebris(d, _q, craters && d.liftZ < 2 ? Math.max(-1.6, world.groundAt(d.cx, d.cy) * S) : 0, _c)) continue;
      }
      const yOff = craters && d.liftZ < 2 ? Math.max(-1.6, world.groundAt(d.cx, d.cy) * S) : 0;
      if (isWheel) {
        if (nw >= capW) continue;
        _p.set(d.cx * S, (d.liftZ + d.th * 0.25) * S + 0.05 + yOff, d.cy * S);
        _s.set(0.72, 0.26, 0.72);
        wm.setMatrixAt(nw++, _m.compose(_p, _q, _s));
        continue;
      }
      if (d.data.chunk) {
        if (nc >= capC) continue;
        _p.set(d.cx * S, (d.liftZ + d.th * 0.45) * S + yOff, d.cy * S);
        _s.set(d.w * S, d.th * S, d.h * S);
        cm.setMatrixAt(nc, _m.compose(_p, _q, _s));
        _c.setHex(colHex(d.color));
        if (d.frozen) _c.lerp(_v.set(0.3, 0.95, 1), 0.55);
        else if (d.grabbed) _c.lerp(_v.set(0.65, 0.5, 1), 0.5);
        cm.setColorAt(nc, _c);
        nc++;
        continue;
      }
      if (n >= cap) continue;
      _p.set(d.cx * S, (d.liftZ + d.th * 0.5) * S + yOff, d.cy * S);
      _s.set(d.w * S, d.th * S, d.h * S);
      dm.setMatrixAt(n, _m.compose(_p, _q, _s));
      _c.setHex(colHex(d.color));
      if (d.frozen) _c.lerp(_v.set(0.3, 0.95, 1), 0.55);
      else if (d.grabbed) _c.lerp(_v.set(0.65, 0.5, 1), 0.5);
      dm.setColorAt(n, _c);
      n++;
    }
    if (destr) destr.endDebris();
    dm.count = n; wm.count = nw; cm.count = nc;
    dm.instanceMatrix.needsUpdate = true; wm.instanceMatrix.needsUpdate = true; cm.instanceMatrix.needsUpdate = true;
    if (dm.instanceColor) dm.instanceColor.needsUpdate = true;
    if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  }


  _syncCutPlanes(world) {
    const mesh = this.cutMesh;
    if (mesh) {
      const list = world.cutPlanes || [];
      let n = 0;
      for (const c of list) {
        if (n >= mesh.instanceMatrix.count) break;
        const fade = Math.max(0.15, c.life / (c.maxLife || 1));
        _p.set(c.x * S, c.z * S, c.y * S);
        if (c.nx || c.ny) {
          const ang = Math.atan2(c.nx || 0, c.ny || 1);
          _q.setFromAxisAngle(_v.set(0, 1, 0), ang);
          _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), Math.PI / 2));
        } else {
          _q.identity();
        }
        // Grosor visible (~20–40 cm) para que la rebanada se lea en móvil
        _m.compose(_p, _q, _s.set((c.w || 16) * S, 0.18 + 0.22 * fade, Math.max(0.45, (c.h || 4) * S)));
        mesh.setMatrixAt(n++, _m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.material) {
        mesh.material.opacity = 0.7 + 0.3 * Math.sin(performance.now() * 0.02);
        mesh.material.emissiveIntensity = 3.2;
      }
    }
    // Caras de corte (planos emisivos horizontales = “rebanada” visible)
    const fm = this.cutFaceMesh;
    if (fm) {
      const faces = world.cutFaces || [];
      let n = 0;
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.012);
      for (const c of faces) {
        if (n >= fm.instanceMatrix.count) break;
        const fade = Math.max(0.2, c.life / (c.maxLife || 1));
        _p.set(c.x * S, c.z * S + 0.02, c.y * S);
        _q.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2);
        _m.compose(_p, _q, _s.set((c.w || 16) * S * 0.1 * 10 / 10, (c.d || 16) * S, 1));
        // PlaneGeometry is XY; after rotateX(-90) it lies on XZ. scale x=width, y=depth in local before rot → after rot y becomes world depth... 
        // Box-free: scale X and Y of plane (Y becomes -Z after rot). Use: scale(w, d, 1) then rotateX.
        _m.compose(_p, _q, _s.set((c.w || 20) * S, (c.d || 20) * S, 1));
        fm.setMatrixAt(n++, _m);
      }
      // Tocones: segmentos con _cutFaceZ (cara superior del corte)
      if (this.world?.segments) {
        for (const seg of this.world.segments) {
          if (!seg._cutFaceZ || (seg._cutFaceT || 0) <= 0 || n >= fm.instanceMatrix.count) continue;
          _p.set(seg.cx * S, seg._cutFaceZ * S + 0.04, seg.cy * S);
          _q.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2);
          _m.compose(_p, _q, _s.set(seg.w * S * 1.05, seg.h * S * 1.05, 1));
          fm.setMatrixAt(n++, _m);
        }
      }
      // también caras en losas con cutGlow
      if (this.world?.debris) {
        for (const d of this.world.debris) {
          if (!d.alive || !d.data?.cutGlow || n >= fm.instanceMatrix.count) continue;
          _p.set(d.cx * S, (d.liftZ + d.th * 0.5) * S + 0.03, d.cy * S);
          _q.setFromEuler(new THREE.Euler(d.tumbleX || 0, -d.angle, d.tumbleZ || 0));
          _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2));
          _m.compose(_p, _q, _s.set(d.w * S * 0.95, d.h * S * 0.95, 1));
          fm.setMatrixAt(n++, _m);
        }
      }
      fm.count = n;
      fm.instanceMatrix.needsUpdate = true;
      if (fm.material) {
        fm.material.emissiveIntensity = 3.4 * pulse;
        fm.material.opacity = 0.75 + 0.25 * pulse;
      }
    }
  }

  _syncRagdolls(game) {
    // Preferir dummy.glb (pool con geo compartida); si no hay, cajas + bolas
    if (this.dummyPool && hasDummyGlb() && game.ragdolls) {
      const ok = this.dummyPool.syncAll(game.ragdolls);
      if (ok) {
        if (this.ragdollMesh) this.ragdollMesh.count = 0;
        if (this.jointMesh) this.jointMesh.count = 0;
        return;
      }
    }
    const mesh = this.ragdollMesh;
    const jm = this.jointMesh;
    if (!mesh || !game.ragdolls) {
      if (mesh) mesh.count = 0;
      if (jm) jm.count = 0;
      return;
    }
    let n = 0;
    for (const d of game.ragdolls.parts) {
      if (!d.alive || n >= mesh.instanceMatrix.count) continue;
      const gz = (this.world?.craters?.length && d.liftZ < 4) ? this.world.groundAt(d.cx, d.cy) * S : 0;
      _p.set(d.cx * S, d.liftZ * S + d.th * S * 0.5 + gz, d.cy * S);
      _q.setFromEuler(new THREE.Euler(d.tumbleX || 0, -d.angle, d.tumbleZ || 0));
      _m.compose(_p, _q, _s.set(d.w * S, d.th * S, d.h * S));
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt?.(n, _c.setHex(colHex(d.color || '#888')));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    if (jm) {
      let jn = 0;
      const joints = game.ragdolls.joints || [];
      for (const j of joints) {
        if (jn >= jm.instanceMatrix.count) break;
        _p.set(j.x * S, j.z * S, j.y * S);
        _q.identity();
        const r = Math.max(0.12, (j.r || 2) * S);
        _m.compose(_p, _q, _s.set(r, r, r));
        jm.setMatrixAt(jn, _m);
        jm.setColorAt?.(jn, _c.setHex(colHex(j.color || '#d0d0d0')));
        jn++;
      }
      jm.count = jn;
      jm.instanceMatrix.needsUpdate = true;
      if (jm.instanceColor) jm.instanceColor.needsUpdate = true;
    }
  }

  _syncRubble(world) {
    if (world.rubbleCount === this._rubbleSeen) return;
    const rm = this.rubbleMesh;
    const start = Math.max(this._rubbleSeen, world.rubbleCount - MAX_RUBBLE);
    for (let k = start; k < world.rubbleCount; k++) {
      const i = k % MAX_RUBBLE;
      const r = world.rubble[i];
      _e.set(r.rx, r.ry, 0);
      _q.setFromEuler(_e);
      _p.set(r.x * S, (r.z + r.s * 0.25) * S, r.y * S);
      _s.set(r.s * S, r.s * S * 0.7, r.s * S * 1.1);
      rm.setMatrixAt(i, _m.compose(_p, _q, _s));
      _c.setHex(colHex(r.color)).multiplyScalar(0.8 + Math.random() * 0.25);
      rm.setColorAt(i, _c);
    }
    this._rubbleSeen = world.rubbleCount;
    rm.count = Math.min(world.rubbleCount, MAX_RUBBLE);
    rm.instanceMatrix.needsUpdate = true;
    if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
  }

  _syncCracks(world) {
    if (world.crackCount === this._crackSeen) return;
    this._crackSeen = world.crackCount;
    let nc = 0, nr = 0, nd = 0, ns = 0, np = 0;
    const scorchM = this.scorchMesh, patchM = this.patchMesh;
    const total = Math.min(world.crackCount, MAX_CRACKS);
    const capD = (QUALITY[this.quality] || QUALITY.medium).decals || MAX_CRACKS;
    const first = Math.max(0, world.crackCount - Math.min(total, capD));   // solo las más recientes según la calidad
    for (let k = first; k < world.crackCount; k++) {
      const c = world.cracks[k % MAX_CRACKS];
      if (!c) continue;
      _q.setFromAxisAngle(_v.set(0, 1, 0), c.angle);
      if (c.type === 'dust') {
        const sz = 6.5 * c.size;
        _p.set(c.x * S, 0.025 + (nd % 5) * 0.002, c.y * S);
        this.dustMesh.setMatrixAt(nd++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
        continue;
      }
      if (c.type === 'scorch' && scorchM) {
        const sz = 2.4 * c.size;
        _p.set(c.x * S, 0.028 + (ns % 7) * 0.002, c.y * S);
        scorchM.setMatrixAt(ns++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      } else if (c.type === 'crater' || c.type === 'scorch') {
        const sz = (c.type === 'scorch' ? 2.2 : 5.5) * c.size;
        _p.set(c.x * S, 0.03 + (nr % 7) * 0.002, c.y * S);
        this.craterMesh.setMatrixAt(nr++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      } else if (patchM && !c.radial) {
        const sz = 3.6 * c.size;
        _p.set(c.x * S, 0.022 + (np % 7) * 0.002, c.y * S);
        patchM.setMatrixAt(np++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      } else {
        const sz = 4.2 * c.size;
        _p.set(c.x * S, 0.02 + (nc % 7) * 0.002, c.y * S);
        this.crackMesh.setMatrixAt(nc++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      }
    }
    this.crackMesh.count = nc; this.craterMesh.count = nr; this.dustMesh.count = nd;
    if (scorchM) { scorchM.count = ns; scorchM.instanceMatrix.needsUpdate = true; }
    if (patchM) { patchM.count = np; patchM.instanceMatrix.needsUpdate = true; }
    this.dustMesh.instanceMatrix.needsUpdate = true;
    this.crackMesh.instanceMatrix.needsUpdate = true; this.craterMesh.instanceMatrix.needsUpdate = true;
  }

  _syncParticles(world) {
    const nGeo = this.pNormal.geometry, aGeo = this.pAdd.geometry;
    const np = nGeo.attributes.position.array, nc = nGeo.attributes.pcolor.array, ns = nGeo.attributes.psize.array;
    const ap = aGeo.attributes.position.array, ac = aGeo.attributes.pcolor.array, as = aGeo.attributes.psize.array;
    let n = 0, a = 0;
    for (const p of world.particles) {
      const t = p.life / p.maxLife;
      let alpha = p.alpha, r = p.r, g = p.g, b = p.b;
      if (p.type === 'dust' || p.type === 'smoke') alpha *= Math.min(1, (1 - t) * 5) * t;
      else if (p.type === 'fire') {
        alpha = t; r = 1; g = 0.35 + 0.55 * t; b = 0.08 + 0.3 * t * t;
      } else if (p.type === 'spark' || p.type === 'psy') alpha = Math.min(1, t * 1.5);
      else alpha = Math.min(1, t * 2);
      const size = p.size * S * 2;
      if (p.additive) {
        if (a >= MAX_PARTICLES) continue;
        ap[a * 3] = p.x * S; ap[a * 3 + 1] = p.z * S; ap[a * 3 + 2] = p.y * S;
        ac[a * 4] = r; ac[a * 4 + 1] = g; ac[a * 4 + 2] = b; ac[a * 4 + 3] = alpha;
        as[a] = size; a++;
      } else {
        if (n >= MAX_PARTICLES) continue;
        np[n * 3] = p.x * S; np[n * 3 + 1] = p.z * S; np[n * 3 + 2] = p.y * S;
        nc[n * 4] = r; nc[n * 4 + 1] = g; nc[n * 4 + 2] = b; nc[n * 4 + 3] = alpha;
        ns[n] = size; n++;
      }
    }
    for (const [geo, cnt] of [[nGeo, n], [aGeo, a]]) {
      geo.setDrawRange(0, cnt);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.pcolor.needsUpdate = true;
      geo.attributes.psize.needsUpdate = true;
    }
  }

  _syncFx(world, dt, game) {
    let ri = 0, li = 0, si = 0;
    for (const fx of world.fx) {
      const t = fx.life / fx.maxLife;
      if (fx.type === 'ring' && ri < this.rings.length) {
        const m = this.rings[ri++];
        m.visible = true;
        m.position.set(fx.x * S, 0.15 + ri * 0.01, fx.y * S);
        const r = fx.r * S;
        m.scale.set(r, 1, r);
        m.material.color.set(fx.color);
        m.material.opacity = Math.min(1, t * 1.6) * (fx.alpha ?? 1);
      } else if (fx.type === 'shockwave' && si < this.shockSpheres.length) {
        const m = this.shockSpheres[si++];
        m.visible = true;
        const r = fx.r * S;
        m.position.set(fx.x * S, 0, fx.y * S);
        m.scale.set(r, r * 0.55, r);
        m.material.color.set(fx.color);
        m.material.opacity = 0.55 * t * t;
      } else if (fx.type === 'flash' && li < this.flashLights.length) {
        const l = this.flashLights[li++];
        l.position.set(fx.x * S, (fx.z || 10) * S, fx.y * S);
        l.color.set(fx.color);
        l.intensity = fx.intensity * 900 * t;
      }
    }
    for (; si < this.shockSpheres.length; si++) this.shockSpheres[si].visible = false;
    // Incendios: las 2 fuentes más cercanas a la cámara iluminan la escena
    const tgt = this.camTarget, fires = [];
    for (const f of world.fires) fires.push({ x: f.x, y: f.y, z: f.z + 10 });
    if (game) for (const v of game.vehicles) if (v.alive && v.onFire > 0) fires.push({ x: v.cx, y: v.cy, z: (v.liftZ || 0) + 14 });
    fires.sort((a, b) => Math.hypot(a.x * S - tgt.x, a.y * S - tgt.z) - Math.hypot(b.x * S - tgt.x, b.y * S - tgt.z));
    // Reutiliza las luces de destello libres para los incendios (sin luces extra → shaders baratos)
    const tt = performance.now() / 1000;
    let fk = 0;
    for (; li < this.flashLights.length && fk < fires.length; li++, fk++) {
      const l = this.flashLights[li], f = fires[fk];
      l.position.set(f.x * S, f.z * S, f.y * S);
      l.color.set(0xff7a2a);
      l.intensity = 90 + 50 * Math.sin(tt * 17 + fk * 3) + 30 * Math.sin(tt * 31 + fk);
    }
    for (; li < this.flashLights.length; li++) this.flashLights[li].intensity = 0;
    // Polvo en el aire tras colapsos: niebla más densa y terrosa
    const hz = world.haze || 0;
    const fog = this.scene.fog;
    fog.color.copy(this.fogBase).lerp(this.fogDust, Math.min(1, hz * 1.2));
    fog.near = 110 - 70 * hz; fog.far = 340 - 170 * hz;
    this.scene.background = fog.color;
    for (; ri < this.rings.length; ri++) this.rings[ri].visible = false;
  }

  _syncVehicles(game, dt) {
    const alive = new Set();
    resetCarFrameBudget(this.quality === 'low' ? 1 : 2);
    this.wheelBatch.begin();
    for (const v of game.vehicles) {
      if (!v.alive) continue;
      alive.add(v);
      let cm = this.carModels.get(v);
      if (!cm) {
        cm = null;
        if (hasCarGlb(v.type)) { try { cm = new GlbCarModel(v); } catch (e) { console.warn('glb car', e); cm = null; } }
        if (!cm) cm = new CarModel(v);
        cm.addTo(this.scene);
        this.carModels.set(v, cm);
      }
      cm.batch = this.wheelBatch;
      cm.update(dt, this.camera.position);
    }
    this.wheelBatch.end();
    for (const [v, cm] of this.carModels) {
      if (!alive.has(v)) { cm.removeFrom(this.scene); this.carModels.delete(v); }
    }
  }

  _poseHero(h, x, y, z, facing, phase, moving, t) {
    h.group.position.set(x * S, z * S, y * S);
    h.group.rotation.y = -facing;
    const sw = moving ? Math.sin(phase) * 0.6 : 0;
    h.legL.rotation.z = sw; h.legR.rotation.z = -sw;
    h.armL.rotation.z = -sw * 0.6; h.armR.rotation.z = sw * 0.6;
    h.aura.rotation.y = t * 1.5;
    h.aura.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
  }

  _syncCharacters(game, dt) {
    const t = performance.now() / 1000;
    const p = game.player;
    const driving = !!game.drivenCar;
    const fps = game.camMode === 'fps';
    this.player.group.visible = !driving && !fps;
    for (const h of this.hands) h.visible = fps && !driving;
    if (fps && !driving) {
      const ch = game.powers.charging ? game.powers.charge : 0;
      const lz = game.laser?.on;
      this.hands.forEach((h, i) => {
        h.position.y = -0.115 + Math.sin(t * 2.2 + i) * 0.004 + (game.powers.grabbed ? 0.02 : 0);
        h.material.color.setHex(lz ? 0xff8a4a : ch >= 1 ? 0xff9cf0 : 0xb39dff);
        this.handGlow[i].scale.setScalar(0.045 + ch * 0.05 + (game.powers.grabbed ? 0.03 : 0) + (lz ? 0.03 : 0));
      });
    }
    // Sombra de contacto
    const gz = p.groundZ || 0, alt = Math.max(0, (p.z || 0) - gz);
    this.playerBlob.visible = !driving;
    this.playerBlob.position.set(p.x * S, gz * S + 0.04, p.y * S);
    this.playerBlob.scale.setScalar(Math.max(0.45, 1.1 - alt * S / 25));
    this.playerBlob.material.opacity = Math.max(0.15, 0.75 - alt * S / 40);
    if (!driving) {
      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 5;
      this._poseHero(this.player, p.x, p.y, p.z || 0, p.facing ?? 0, p.walkPhase ?? 0, moving && !p.flying, t);
      if (p.flying) {
        this.player.legL.rotation.z = 0.25; this.player.legR.rotation.z = 0.2;
        this.player.aura.scale.setScalar(1.35 + Math.sin(t * 6) * 0.1);
      }
      const casting = game.powers.grabbed || game.powers.charging || game.powers.catching;
      if (casting) { this.player.armR.rotation.z = -1.3; this.player.armL.rotation.z = game.powers.catching ? -1.3 : this.player.armL.rotation.z; }
      this.player.glowMat.emissiveIntensity = 2 + (game.powers.charging ? game.powers.charge * 4 : 0);
    }
    const r = game.rival;
    this.rival.group.visible = !!(r && r.alive);
    if (r && r.alive) {
      this._poseHero(this.rival, r.cx, r.cy, 0, r.facing, r.walkPhase, Math.hypot(r.vx, r.vy) > 5, t);
      this.rival.glowMat.emissiveIntensity = 2 + (r.shockFlash > 0 ? 6 : 0);
    }

    // NPCs
    let i = 0;
    const cap = this.npcTorso.instanceMatrix.count;
    for (const n of game.npcs) {
      if (!n.alive || i >= cap) continue;
      const bob = Math.abs(Math.sin(n.walkPhase)) * 0.06;
      _q.setFromAxisAngle(_v.set(0, 1, 0), -n.facing);
      if (n.knocked > 0) {
        const tq = new THREE.Quaternion().setFromAxisAngle(_v.set(Math.sin(n.facing), 0, -Math.cos(n.facing)), Math.min(1.4, (0.9 - n.knocked) * 4));
        _q.premultiply(tq);
      }
      _p.set(n.cx * S, n.liftZ * S + bob + (game.world.craters.length && n.liftZ < 2 ? game.world.groundAt(n.cx, n.cy) * S : 0), n.cy * S);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.npcTorso.setMatrixAt(i, _m); this.npcHead.setMatrixAt(i, _m); this.npcLegs.setMatrixAt(i, _m);
      this.npcTorso.setColorAt(i, _c.setHex(colHex(n.hostile ? '#c0392b' : n.color)));
      this.npcLegs.setColorAt(i, _c.setHex(colHex(n.hostile ? '#2a0f0f' : n.pants)));
      this.npcHead.setColorAt(i, _c.setHex(colHex(n.hostile ? '#6b2a2a' : '#d9a982')));
      i++;
    }
    for (const m of [this.npcTorso, this.npcHead, this.npcLegs]) {
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _syncPowers(game, dt) {
    const pw = game.powers;
    const src = this._src || (this._src = { x: 0, y: 0, z: 0 });
    if (game.drivenCar) { src.x = game.drivenCar.cx; src.y = game.drivenCar.cy; src.z = 16; }
    else { src.x = game.player.x; src.y = game.player.y; src.z = 15 + (game.player.z || 0); }
    const aim = game.aimView || game.aim;   // v4.1: mira suavizada
    const col = POWERS[pw.selected].color;
    const t = performance.now() / 1000;

    // Mira
    const az = (aim.z || 0) * S + 0.08;
    const rs = game.drivenCar ? 1.5 : 1.15;
    this.reticle.position.set(aim.x * S, az, aim.y * S);
    this.reticle.scale.setScalar(rs * (1 + Math.sin(t * 6) * 0.04));
    const rc = pw.catching ? '#7ff3ff' : col;
    if (rc !== this._retCol) { this._retCol = rc; this.reticle.material.color.set(rc); }
    this.reticleDot.position.copy(this.reticle.position);
    this.reticle.visible = this.reticleDot.visible = game.showReticle !== false && (game.camMode !== 'fps' || pw.charging);
    const ci = Math.round(pw.charge * 32);
    this.chargeArc.geometry = this.chargeArcs[ci];
    this.chargeArc.visible = pw.charging && this.reticle.visible;
    this.chargeArc.position.copy(this.reticle.position);
    this.chargeArc.scale.setScalar(rs);
    const cc = pw.charge >= 1 ? '#ff6bd6' : pw.charge > 0.66 ? '#ffd166' : '#ffffff';
    if (cc !== this._arcCol) { this._arcCol = cc; this.chargeArc.material.color.set(cc); }

    // Vista previa de radio
    if (pw.charging && (pw.chargeKind === 'shock' || pw.chargeKind === 'crush')) {
      const s = pw.strength();
      const r = pw.chargeKind === 'shock' ? 45 + 185 * Math.sqrt(s) : 30 + 45 * s;
      this.previewRing.visible = true;
      this.previewRing.position.set(aim.x * S, 0.12, aim.y * S);
      this.previewRing.scale.set(r * S, 1, r * S);
      this.previewRing.material.color.set(col);
      this.previewRing.material.opacity = 0.35 + Math.sin(t * 10) * 0.1;
    } else this.previewRing.visible = false;

    // Haz TK
    const held = pw.grabbed || pw.slamTarget;
    if (held && held.alive) {
      const a = _p.set(src.x * S, src.z * S, src.y * S);
      const b = _v.set(held.cx * S, ((held.liftZ || 0) + (held.th || 10) * 0.5) * S, held.cy * S);
      const len = a.distanceTo(b);
      for (const [m, rad] of [[this.beam, 0.05 + pw.charge * 0.06], [this.beamOuter, 0.18 + pw.charge * 0.2]]) {
        m.visible = true;
        m.position.copy(a);
        m.lookAt(b);
        m.scale.set(rad, rad, len);
      }
      this.beam.material.color.setHex(pw.charge >= 1 ? 0xff9cf0 : 0xb39dff);
      this.psyLight.position.copy(b);
      this.psyLight.intensity = 60 + pw.charge * 160;
    } else {
      this.beam.visible = this.beamOuter.visible = false;
      this.psyLight.intensity = 0;
    }

    // Campo de captura
    const showCatch = pw.catching;
    const zones = [[aim.x, aim.y, 90], [src.x, src.y, 75]];
    for (let k = 0; k < 2; k++) {
      const [x, y, r] = zones[k];
      const pulse = 1 + Math.sin(t * 8 + k) * 0.03;
      this.catchDiscs[k].visible = this.catchRings[k].visible = showCatch;
      this.catchDiscs[k].position.set(x * S, 0.1 + k * 0.01, y * S);
      this.catchDiscs[k].scale.set(r * S, 1, r * S);
      this.catchRings[k].position.set(x * S, 0.14, y * S);
      this.catchRings[k].scale.set(r * S * pulse, 1, r * S * pulse);
    }

    // Láser de los ojos
    const L = game.laser;
    if (L && L.on && L.hit) {
      const hit = _b.set(L.hit.x * S, L.hit.z * S, L.hit.y * S);
      let base, right;
      if (game.camMode === 'fps') {
        base = _t.copy(this.camera.position);
        this.camera.getWorldDirection(_d);
        right = _r.set(-_d.z, 0, _d.x).normalize();
        base.y -= 0.1; base.addScaledVector(_d, 0.45);
      } else if (game.drivenCar) {
        const c = game.drivenCar; base = _t.set(c.cx * S, (c.liftZ || 0) * S + 1.45, c.cy * S);
        right = _r.set(-Math.sin(c.angle), 0, Math.cos(c.angle));
      } else {
        const f = game.player.facing ?? 0;
        base = _t.set(game.player.x * S + Math.cos(f) * 0.17, (game.player.z || 0) * S + 1.8, game.player.y * S + Math.sin(f) * 0.17);
        right = _r.set(-Math.sin(f), 0, Math.cos(f));
      }
      const prof = L.power || { thick: 1, f: 0.6 };
      const fl = 0.85 + Math.random() * 0.35;
      const thick = (prof.thick || 1) * fl;
      this.lasers.forEach((ls, i) => {
        const a = _p.copy(base).addScaledVector(right, (i ? 1 : -1) * (game.camMode === 'fps' ? 0.12 : 0.08));
        const len = a.distanceTo(hit);
        const th = game.camMode === 'fps' ? 0.4 : 1;
        const pairs = [
          [ls.core, 0.028 * thick * th],
          [ls.glow, 0.09 * thick * th],
          [ls.aura, 0.2 * thick * th],
        ];
        for (const [m, rad] of pairs) {
          m.visible = true; m.position.copy(a); m.lookAt(hit); m.scale.set(rad, rad, len);
        }
      });
      this.laserHit.visible = true;
      this.laserHit.position.copy(hit);
      const hd = hit.distanceTo(this.camera.position);
      this.laserHit.scale.setScalar(Math.min(2.8, (0.35 + hd * 0.06) * thick) * (0.85 + Math.random() * 0.35));
      this.psyLight.color.set(0xff5a1a);
      this.psyLight.position.copy(hit).y += 0.4;
      this.psyLight.intensity = Math.min(1.4, 0.3 + hd * 0.07) * (50 + thick * 55 + Math.random() * 40);
    } else {
      for (const ls of this.lasers) ls.core.visible = ls.glow.visible = ls.aura.visible = false;
      this.laserHit.visible = false;
      if (!(pw.grabbed || pw.slamTarget)) this.psyLight.intensity = 0;
      this.psyLight.color.set(0x9a7bff);
    }

    // Escudo
    this.shield.visible = pw.shieldTimer > 0;
    if (this.shield.visible) {
      this.shield.position.set(src.x * S, 1.0, src.y * S);
      this.shield.scale.setScalar((game.drivenCar ? 2.0 : 1) * (1 + Math.sin(t * 9) * 0.03));
      this.shield.material.opacity = 0.15 + Math.min(1, pw.shieldTimer) * 0.15;
    }
  }

  // ——————————————————— cámara ———————————————————
  /**
   * state: { mode:'foot'|'drive', x, y, yaw, pitch, dist, car, shake, lookOffset }
   */
  updateCamera(state, dt) {
    // v4.1: resortes críticamente amortiguados en todos los modos + mezcla suave al cambiar de vista / entrar o salir del auto
    const cam = this.camera;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    let fov = 50;
    const view = state.view || 'top';
    const drive = state.mode === 'drive' && !!state.car;
    const key = (drive ? 10 : 0) + (view === 'fps' ? 1 : view === 'third' ? 2 : view === 'far' ? 3 : 4);
    const first = this._camKey === undefined;
    const changed = !first && this._camKey !== key;
    if (changed) { this._trFrom.copy(this._outPos); this._trFromT.copy(this._outTgt); this._tr = 0; }
    const reset = first || changed;
    this._camKey = key;
    let snap = false;
    if (drive && view === 'fps') {
      // Vista del conductor (pose ya interpolada → sin tirones)
      const c = state.car;
      const h = c.angle + (state.lookOffset || 0), pt = state.lookPitch || 0;
      const eye = _t.set((c.cx + Math.cos(c.angle) * 3) * S, (c.liftZ || 0) * S + 1.3, (c.cy + Math.sin(c.angle) * 3) * S);
      this.camPos.copy(eye);
      this.camTarget.set(eye.x + Math.cos(h) * Math.cos(pt) * 10, eye.y - Math.sin(pt) * 10, eye.z + Math.sin(h) * Math.cos(pt) * 10);
      fov = state.fpsFov || 70; snap = true;
      this._chaseHeading = null;
    } else if (!drive && view === 'fps') {
      const yaw = state.yaw || 0, pt = state.lookPitch || 0;
      const dir = _d.set(-Math.sin(yaw) * Math.cos(pt), -Math.sin(pt), -Math.cos(yaw) * Math.cos(pt));
      // altura de ojos con resorte: subir bordillos/techos no da saltos
      const ey = (state.z || 0) * S + 1.68;
      if (reset || Math.abs(ey - this._eyeY) > 6) { this._eyeY = ey; this._eyeV = 0; }
      else { const r = springScalar(this._eyeY, this._eyeV, ey, 16, dt); this._eyeY = r; this._eyeV = _springV; }
      const eye = _t.set(state.x * S, this._eyeY, state.y * S);
      this.camPos.copy(eye);
      this.camTarget.copy(eye).addScaledVector(dir, 10);
      fov = state.fpsFov || 70; snap = true;
      this._chaseHeading = null;
    } else if (!drive && (view === 'third' || view === 'far')) {
      const far = view === 'far';
      const yaw = state.yaw || 0, pt = state.lookPitch || 0;
      const dir = _d.set(-Math.sin(yaw) * Math.cos(pt), -Math.sin(pt), -Math.cos(yaw) * Math.cos(pt));
      // por encima del hombro + ligera anticipación hacia donde caminas
      const sh = far ? 0.5 : 1.0;
      let lx = (state.vx || 0) * S * 0.22, lz = (state.vy || 0) * S * 0.22;
      const ll = Math.hypot(lx, lz), lmax = far ? 1.8 : 1.2;
      if (ll > lmax) { lx *= lmax / ll; lz *= lmax / ll; }
      const want = _t.set(state.x * S + Math.cos(yaw) * sh + lx, (state.z || 0) * S + (far ? 1.4 : 1.8), state.y * S - Math.sin(yaw) * sh + lz);
      if (reset || this._ft.distanceToSquared(want) > 400) { this._ft.copy(want); this._ftV.set(0, 0, 0); }
      else springVec(this._ft, this._ftV, want, 13, dt);
      const tgt = this._ft;
      const dist = state.tDist || 7;
      // Evita atravesar edificios: acerca al instante, se aleja con suavidad
      const rc = this.raycastPx(tgt.x / S, tgt.z / S, tgt.y / S, -dir.x, -dir.z, -dir.y, this.world, { maxT: dist / S + 4 });
      let allowed = dist;
      if (rc.hit && rc.hit !== 'ground' && rc.t * S < dist + 0.3) allowed = Math.max(0.9, rc.t * S - 0.4);
      if (reset || allowed < this._fDist) this._fDist = allowed;
      else this._fDist += (allowed - this._fDist) * (1 - Math.exp(-dt * 4));
      this.camPos.copy(tgt).addScaledVector(dir, -this._fDist);
      this.camPos.y = Math.max(this.camPos.y, 0.35);
      this.camTarget.copy(tgt);
      fov = far ? 58 : 62;
      this._chaseHeading = null;
    } else if (drive) {
      const c = state.car;
      const spd = c.speed;
      // la cámara sigue el rumbo con retraso, mezclado con la dirección de la velocidad (drift)
      let heading = c.angle;
      if (spd > 40 && c.forwardSpeed > 0) {
        const vh = Math.atan2(c.vy, c.vx);
        let d = vh - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += d * 0.35;
      }
      heading += state.lookOffset || 0;
      if (this._chaseHeading == null || reset) this._chaseHeading = heading;
      let dh = heading - this._chaseHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this._chaseHeading += dh * (1 - Math.exp(-dt * 4.5));
      const h = this._chaseHeading;
      const zf = Math.max(0.5, Math.min(2, state.zoom || 1));
      const back = (7.2 + Math.min(2.2, spd / 160)) * zf;
      const tx = c.cx * S, tz = c.cy * S, ty = c.liftZ * S;
      const desired = _v.set(tx - Math.cos(h) * back, ty + (2.6 + Math.min(0.8, spd / 400)) * zf, tz - Math.sin(h) * back);
      const ahead = 3.5 + Math.min(3, spd / 150);
      const want = _p.set(tx + Math.cos(h) * ahead, ty + 1.0, tz + Math.sin(h) * ahead);
      if (reset || this.camPos.distanceToSquared(desired) > 1600) {
        this.camPos.copy(desired); this._cpV.set(0, 0, 0);
        this.camTarget.copy(want); this._ctV.set(0, 0, 0);
      } else {
        springVec(this.camPos, this._cpV, desired, 7.5, dt);
        springVec(this.camTarget, this._ctV, want, 12, dt);
      }
      // anti-atravesar edificios: acorta la cámara si un edificio queda entre el auto y ella
      {
        const ddx = this.camPos.x - tx, ddy = this.camPos.y - (ty + 1.2), ddz = this.camPos.z - tz, dl = Math.hypot(ddx, ddy, ddz) || 1;
        const rc = this.raycastPx(tx / S, tz / S, (ty + 1.2) / S, ddx / dl, ddz / dl, ddy / dl, this.world, { maxT: dl / S + 3 });
        if (rc.hit && rc.hit !== 'ground' && rc.t * S < dl) {
          const k2 = Math.max(0.15, (rc.t * S - 0.4) / dl);
          this.camPos.set(tx + ddx * k2, ty + 1.2 + ddy * k2, tz + ddz * k2);
          this._cpV.multiplyScalar(0.3);
        }
      }
      fov = 62 + Math.min(14, spd / 25);
    } else {
      this._chaseHeading = null;
      const yaw = state.yaw || 0, pitch = state.pitch ?? 0.98, dist = state.dist ?? 36;
      const want = _p.set(state.x * S, 0.8 + (state.z || 0) * S, state.y * S);
      if (reset) { this.camTarget.copy(want); this._ctV.set(0, 0, 0); } else springVec(this.camTarget, this._ctV, want, 7, dt);
      const desired = _v.set(
        this.camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        this.camTarget.y + Math.sin(pitch) * dist,
        this.camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      if (reset) { this.camPos.copy(desired); this._cpV.set(0, 0, 0); } else springVec(this.camPos, this._cpV, desired, 9, dt);
      fov = state.fov || 50;
    }
    // Mezcla de transición (≈0,45 s, suavizada)
    if (this._tr < 1) {
      this._tr = Math.min(1, this._tr + dt / 0.45);
      const k = this._tr * this._tr * (3 - 2 * this._tr);
      this._outPos.lerpVectors(this._trFrom, this.camPos, k);
      this._outTgt.lerpVectors(this._trFromT, this.camTarget, k);
    } else {
      this._outPos.copy(this.camPos);
      this._outTgt.copy(this.camTarget);
    }
    const near = view === 'fps' ? 0.06 : 0.2;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * (snap ? 10 : 4));
      cam.updateProjectionMatrix();
      this._updatePointScale();
    }
    cam.position.copy(this._outPos);
    if (state.shake > 0) {
      const a = state.shake * (snap ? 0.012 : 0.025);
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
    }
    cam.lookAt(this._outTgt);

    // Sombras siguen a la cámara (ajustado a texel para evitar parpadeo)
    const focus = state.mode === 'drive' ? this.camTarget : this.camTarget;
    const texel = 110 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + SUN_DIR.x * 120, SUN_DIR.y * 120, fz + SUN_DIR.z * 120);
    this.sky.position.copy(cam.position);
  }

  /**
   * Rayo en px (x, y = planta, z = altura) contra suelo, columnas de edificios y (opcional) autos.
   * d debe estar normalizado. Devuelve la distancia t (px) o Infinity.
   */
  raycastPx(ox, oy, oz, dx, dy, dz, world, { vehicles = null, skip = null, maxT = Infinity } = {}) {
    let best = maxT, hit = null;
    if (dz < -1e-4) { const t = -oz / dz; if (t < best) { best = t; hit = 'ground'; } }
    // intersección rayo-caja por "slabs" sin arreglos temporales (sin basura en el bucle)
    const slab = (bx, by, bw, bh, z0, z1) => {
      let tmin = 0, tmax = Infinity, t1, t2, tt;
      if (Math.abs(dx) < 1e-8) { if (ox < bx || ox > bx + bw) return Infinity; }
      else { t1 = (bx - ox) / dx; t2 = (bx + bw - ox) / dx; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
      if (Math.abs(dy) < 1e-8) { if (oy < by || oy > by + bh) return Infinity; }
      else { t1 = (by - oy) / dy; t2 = (by + bh - oy) / dy; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
      if (Math.abs(dz) < 1e-8) { if (oz < z0 || oz > z1) return Infinity; }
      else { t1 = (z0 - oz) / dz; t2 = (z1 - oz) / dz; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
      return tmin;
    };
    if (world) {
      for (const b of world.buildings) {
        if (slab(b.x, b.y, b.w, b.h, 0, b.floors * FLOOR_H) >= best) continue;
        for (const s of b.segs) {
          if (s.floorsAlive <= 0) continue;
          const t = slab(s.x, s.y, s.w, s.h, 0, s.height);
          if (t < best) { best = t; hit = s; }
        }
      }
    }
    if (vehicles) {
      for (const v of vehicles) {
        if (!v.alive || v === skip) continue;
        const r = Math.max(v.w, v.h) * 0.5;
        const t = slab(v.cx - r, v.cy - r, 2 * r, 2 * r, v.liftZ || 0, (v.liftZ || 0) + 14);
        if (t < best) { best = t; hit = v; }
      }
    }
    return { t: best, hit };
  }

  /** Rayo desde pantalla → punto en el mundo (px) contra suelo, edificios y autos */
  pick(ndcX, ndcY, world, vehicles = null, skip = null) {
    const cam = this.camera;
    const o = cam.position;
    const d = _r.set(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
    const ox = o.x / S, oy = o.z / S, oz = o.y / S;
    const dx = d.x, dy = d.z, dz = d.y;
    let { t: best, hit } = this.raycastPx(ox, oy, oz, dx, dy, dz, world, { vehicles, skip });
    if (!Number.isFinite(best)) best = 1400 / Math.max(0.05, Math.hypot(dx, dy));
    const x = ox + dx * best, y = oy + dy * best;
    const hz = Math.max(0, oz + dz * best);
    return { x, y, z: hz, hit };
  }

  worldToScreen(x, y, z) {
    _v.set(x * S, z * S, y * S).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.width, y: (-_v.y * 0.5 + 0.5) * this.height, visible: _v.z < 1 && _v.z > -1 };
  }

  /**
   * Sombras: un material de profundidad propio para las mallas instanciadas. Si comparten
   * el de three con mallas normales, el programa se re-evalúa en cada cambio (basura por cuadro).
   */
  _fixInstancedDepth() {
    const D = this._instDepth || (this._instDepth = [0, 1, 2, 3].map(() => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })));
    this.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.castShadow) return;
      // variantes por color de instancia y cara doble (cada combinación = su propio programa estable)
      const k = (o.instanceColor ? 1 : 0) + (o.material?.side === THREE.DoubleSide ? 2 : 0);
      if (o.customDepthMaterial !== D[k]) { D[k].side = k & 2 ? THREE.DoubleSide : THREE.FrontSide; o.customDepthMaterial = D[k]; }
    });
  }

  render() {
    if (this.bloomOn && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
