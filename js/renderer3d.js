/**
 * Render 3D con Three.js: lee el estado lógico (px) y lo dibuja en metros (×0.1).
 * Cámara aérea inclinada (a pie) y cámara de persecución (manejando).
 */

import * as THREE from 'three';
import { FLOOR_H, MAX_RUBBLE, MAX_CRACKS, MAX_DEBRIS, BLOCK, PITCH, SIDEWALK_W } from './world.js';
import {
  makeCityGround, makeFacadeAtlas, ATLAS, makeBackdropFacade, makeCrackTexture,
  makeCraterTexture, makeSoftSprite, makeGrassTile,
} from './textures.js';
import { CarModel, mergeGeometries } from './carmodel.js';
import { MAX_PARTICLES } from './physics.js';
import { POWERS } from './powers.js';

const S = 0.1;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();

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

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900);
    this.camera.position.set(0, 40, 40);
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 40, 40);
    this.quality = 'high';
    this._initStatic();
    this.worldGroup = null;
    this.carModels = new Map();
    this.width = 1; this.height = 1;
  }

  setQuality(q) {
    this.quality = q;
    const size = q === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  setSize(w, h, dpr = 1) {
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
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

    // Texturas compartidas
    this.atlas = makeFacadeAtlas();
    this.sprite = makeSoftSprite();
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
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: this.sprite }, scale: { value: 600 } }]),
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
    const grass = makeGrassTile(); grass.repeat.set(120, 120);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    outer.userData.ownMat = true;
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(world.w * S / 2, -0.05, world.h * S / 2);
    g.add(outer);

    this._buildBuildings(world, g);
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
    const wg = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.wheelDebris = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 }), 120);
    this.wheelDebris.castShadow = true;
    this.wheelDebris.count = 0;
    this.wheelDebris.userData.ownMat = true;
    g.add(this.wheelDebris);

    // Escombro estático (montones)
    this.rubbleMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), MAX_RUBBLE);
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
    this._lastSegVersion = -1;
    this._propVersion = -1;
  }

  _buildBuildings(world, g) {
    const atlasMat = new THREE.MeshStandardMaterial({
      map: this.atlas.map, emissiveMap: this.atlas.emissive, emissive: 0xffc070, emissiveIntensity: 0.7,
      roughness: 0.62, metalness: 0.08,
    });
    atlasMat.userData = {};
    this.buildingMat = atlasMat;
    const geos = [];
    for (let s = 0; s < 3; s++) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const f = ATLAS.facade[s];
      atlasUV(geo, [f, f, ATLAS.roof, ATLAS.slab, f, f]);
      geos.push(geo);
    }
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
    _c.set(seg.color);
    const dmg = 1 - seg.hp / seg.maxHp;
    for (let f = 0; f < seg.floors; f++) {
      const i = seg.instStart + f;
      if (f < seg.floorsAlive) {
        _p.set(seg.cx * S, (f + 0.5) * FLOOR_H * S, seg.cy * S);
        _s.set(seg.w * S + 0.002, FLOOR_H * S, seg.h * S + 0.002);
        _m.compose(_p, _q.identity(), _s);
        mesh.setMatrixAt(i, _m);
        const top = f === seg.floorsAlive - 1;
        const shade = seg.tintVar * (1 - dmg * 0.25) * (top && dmg > 0 ? 0.82 : 1);
        mesh.setColorAt(i, _v.set(_c.r * shade, _c.g * shade, _c.b * shade));
      } else {
        mesh.setMatrixAt(i, ZERO_M);
        mesh.setColorAt(i, _v.set(0, 0, 0));
      }
    }
    void b;
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
      const m = this._propMatrix(t, t.scale);
      this.trunkMesh.setMatrixAt(i, m);
      this.folMesh.setMatrixAt(i, m);
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

    this._syncDebris(world);
    this._syncRubble(world);
    this._syncCracks(world);
    this._syncParticles(world);
    this._syncFx(world, dt);
    this._syncVehicles(game, dt);
    this._syncCharacters(game, dt);
    this._syncPowers(game, dt);
  }

  _syncDebris(world) {
    let n = 0, nw = 0;
    const dm = this.debrisMesh, wm = this.wheelDebris;
    const cap = dm.instanceMatrix.count, capW = wm.instanceMatrix.count;
    for (const d of world.debris) {
      if (!d.alive) continue;
      const isWheel = d.data.carPart && d.data.carPart.startsWith('wheel');
      _e.set(d.tumbleX, -d.angle, d.tumbleZ, 'YXZ');
      _q.setFromEuler(_e);
      if (isWheel) {
        if (nw >= capW) continue;
        _p.set(d.cx * S, (d.liftZ + d.th * 0.25) * S + 0.05, d.cy * S);
        _s.set(0.72, 0.26, 0.72);
        wm.setMatrixAt(nw++, _m.compose(_p, _q, _s));
        continue;
      }
      if (n >= cap) continue;
      _p.set(d.cx * S, (d.liftZ + d.th * 0.5) * S, d.cy * S);
      _s.set(d.w * S, d.th * S, d.h * S);
      dm.setMatrixAt(n, _m.compose(_p, _q, _s));
      _c.set(d.color);
      if (d.frozen) _c.lerp(_v.set(0.3, 0.95, 1), 0.55);
      else if (d.grabbed) _c.lerp(_v.set(0.65, 0.5, 1), 0.5);
      dm.setColorAt(n, _c);
      n++;
    }
    dm.count = n; wm.count = nw;
    dm.instanceMatrix.needsUpdate = true; wm.instanceMatrix.needsUpdate = true;
    if (dm.instanceColor) dm.instanceColor.needsUpdate = true;
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
      _c.set(r.color).multiplyScalar(0.8 + Math.random() * 0.25);
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
    let nc = 0, nr = 0;
    const total = Math.min(world.crackCount, MAX_CRACKS);
    for (let i = 0; i < total; i++) {
      const c = world.cracks[i];
      _q.setFromAxisAngle(_v.set(0, 1, 0), c.angle);
      if (c.type === 'crater') {
        const sz = 5.5 * c.size;
        _p.set(c.x * S, 0.03 + (nr % 7) * 0.002, c.y * S);
        this.craterMesh.setMatrixAt(nr++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      } else {
        const sz = 4.2 * c.size;
        _p.set(c.x * S, 0.02 + (nc % 7) * 0.002, c.y * S);
        this.crackMesh.setMatrixAt(nc++, _m.compose(_p, _q, _s.set(sz, 1, sz)));
      }
    }
    this.crackMesh.count = nc; this.craterMesh.count = nr;
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

  _syncFx(world) {
    let ri = 0, li = 0;
    for (const fx of world.fx) {
      const t = fx.life / fx.maxLife;
      if (fx.type === 'ring' && ri < this.rings.length) {
        const m = this.rings[ri++];
        m.visible = true;
        m.position.set(fx.x * S, 0.15 + ri * 0.01, fx.y * S);
        const r = fx.r * S;
        m.scale.set(r, 1, r);
        m.material.color.set(fx.color);
        m.material.opacity = Math.min(1, t * 1.6);
      } else if (fx.type === 'flash' && li < this.flashLights.length) {
        const l = this.flashLights[li++];
        l.position.set(fx.x * S, (fx.z || 10) * S, fx.y * S);
        l.color.set(fx.color);
        l.intensity = fx.intensity * 900 * t;
      }
    }
    for (; ri < this.rings.length; ri++) this.rings[ri].visible = false;
    for (; li < this.flashLights.length; li++) this.flashLights[li].intensity = 0;
  }

  _syncVehicles(game, dt) {
    const alive = new Set();
    for (const v of game.vehicles) {
      if (!v.alive) continue;
      alive.add(v);
      let cm = this.carModels.get(v);
      if (!cm) {
        cm = new CarModel(v);
        cm.addTo(this.scene);
        this.carModels.set(v, cm);
      }
      cm.update(dt);
    }
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
    this.player.group.visible = !driving;
    if (!driving) {
      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 5;
      this._poseHero(this.player, p.x, p.y, 0, p.facing ?? 0, p.walkPhase ?? 0, moving, t);
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
      _p.set(n.cx * S, n.liftZ * S + bob, n.cy * S);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.npcTorso.setMatrixAt(i, _m); this.npcHead.setMatrixAt(i, _m); this.npcLegs.setMatrixAt(i, _m);
      this.npcTorso.setColorAt(i, _c.set(n.hostile ? '#c0392b' : n.color));
      this.npcLegs.setColorAt(i, _c.set(n.hostile ? '#2a0f0f' : n.pants));
      this.npcHead.setColorAt(i, _c.set(n.hostile ? '#6b2a2a' : '#d9a982'));
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
    const src = game.drivenCar ? { x: game.drivenCar.cx, y: game.drivenCar.cy, z: 16 } : { x: game.player.x, y: game.player.y, z: 15 };
    const aim = game.aim;
    const col = POWERS[pw.selected].color;
    const t = performance.now() / 1000;

    // Mira
    const az = (aim.z || 0) * S + 0.08;
    const rs = game.drivenCar ? 1.5 : 1.15;
    this.reticle.position.set(aim.x * S, az, aim.y * S);
    this.reticle.scale.setScalar(rs * (1 + Math.sin(t * 6) * 0.04));
    this.reticle.material.color.set(pw.catching ? '#7ff3ff' : col);
    this.reticleDot.position.copy(this.reticle.position);
    this.reticle.visible = this.reticleDot.visible = game.showReticle !== false;
    const ci = Math.round(pw.charge * 32);
    this.chargeArc.geometry = this.chargeArcs[ci];
    this.chargeArc.visible = pw.charging && this.reticle.visible;
    this.chargeArc.position.copy(this.reticle.position);
    this.chargeArc.scale.setScalar(rs);
    this.chargeArc.material.color.set(pw.charge >= 1 ? '#ff6bd6' : pw.charge > 0.66 ? '#ffd166' : '#ffffff');

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
      this.beam.material.color.set(pw.charge >= 1 ? '#ff9cf0' : '#b39dff');
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
    const cam = this.camera;
    const k = 1 - Math.exp(-dt * (state.mode === 'drive' ? 6 : 7));
    let fov = 50;
    if (state.mode === 'drive' && state.car) {
      const c = state.car;
      const spd = c.speed;
      // la cámara sigue el rumbo con retraso, mezclado con la dirección de la velocidad (drift)
      let heading = c.angle;
      if (spd > 40 && c.forwardSpeed > 0) {
        const vh = Math.atan2(c.vy, c.vx);
        let d = vh - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += d * 0.35;
      }
      if (c.forwardSpeed < -20) heading += 0; // reversa: misma vista
      heading += state.lookOffset || 0;
      if (this._chaseHeading == null) this._chaseHeading = heading;
      let dh = heading - this._chaseHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this._chaseHeading += dh * (1 - Math.exp(-dt * 4.5));
      const h = this._chaseHeading;
      const zf = Math.max(0.5, Math.min(2, state.zoom || 1));
      const back = (7.2 + Math.min(2.2, spd / 160)) * zf;
      const tx = c.cx * S, tz = c.cy * S, ty = c.liftZ * S;
      const desired = _v.set(tx - Math.cos(h) * back, ty + (2.6 + Math.min(0.8, spd / 400)) * zf, tz - Math.sin(h) * back);
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 9));
      this.camTarget.lerp(_p.set(tx + Math.cos(h) * 3.5, ty + 1.0, tz + Math.sin(h) * 3.5), 1 - Math.exp(-dt * 12));
      fov = 62 + Math.min(14, spd / 25);
    } else {
      this._chaseHeading = null;
      const yaw = state.yaw || 0, pitch = state.pitch ?? 0.98, dist = state.dist ?? 36;
      const tx = state.x * S, tz = state.y * S;
      this.camTarget.lerp(_p.set(tx, 0.8, tz), k);
      const desired = _v.set(
        this.camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        this.camTarget.y + Math.sin(pitch) * dist,
        this.camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      this.camPos.lerp(desired, k);
      fov = state.fov || 50;
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
      this._updatePointScale();
    }
    cam.position.copy(this.camPos);
    if (state.shake > 0) {
      const a = state.shake * 0.025;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
    }
    cam.lookAt(this.camTarget);

    // Sombras siguen a la cámara (ajustado a texel para evitar parpadeo)
    const focus = state.mode === 'drive' ? this.camTarget : this.camTarget;
    const texel = 110 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + SUN_DIR.x * 120, SUN_DIR.y * 120, fz + SUN_DIR.z * 120);
    this.sky.position.copy(cam.position);
  }

  /** Rayo desde pantalla → punto en el mundo (px) contra suelo y columnas de edificios */
  pick(ndcX, ndcY, world) {
    const cam = this.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
    // a px: x→x, y(alto)→z, z→y
    const ox = o.x / S, oy = o.z / S, oz = o.y / S;
    const dx = d.x, dy = d.z, dz = d.y;
    let best = Infinity, hz = 0;
    if (dz < -1e-4) best = -oz / dz;
    else best = 1400 / Math.max(0.05, Math.hypot(dx, dy));
    if (world) {
      const slab = (bx, by, bw, bh, h) => {
        let tmin = 0, tmax = Infinity;
        for (const [o0, dd, lo, hi] of [[ox, dx, bx, bx + bw], [oy, dy, by, by + bh], [oz, dz, 0, h]]) {
          if (Math.abs(dd) < 1e-8) { if (o0 < lo || o0 > hi) return Infinity; continue; }
          let t1 = (lo - o0) / dd, t2 = (hi - o0) / dd;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) return Infinity;
        }
        return tmin;
      };
      for (const b of world.buildings) {
        if (slab(b.x, b.y, b.w, b.h, b.floors * FLOOR_H) >= best) continue;
        for (const s of b.segs) {
          if (s.floorsAlive <= 0) continue;
          const t = slab(s.x, s.y, s.w, s.h, s.height);
          if (t < best) { best = t; }
        }
      }
    }
    const x = ox + dx * best, y = oy + dy * best;
    hz = Math.max(0, oz + dz * best);
    return { x, y, z: hz };
  }

  worldToScreen(x, y, z) {
    _v.set(x * S, z * S, y * S).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.width, y: (-_v.y * 0.5 + 0.5) * this.height, visible: _v.z < 1 && _v.z > -1 };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
