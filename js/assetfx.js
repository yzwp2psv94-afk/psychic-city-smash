// v4.3 — Aplica los assets CC0 a los materiales del render (fachadas, calle, escombro, decals, cielo).
// Se usa desde Renderer3D cuando termina la carga; todo tiene respaldo procedural.
import * as THREE from 'three';
import { FACADE_GRID, CRACK_RECTS } from './assets.js';

const S = 0.1;
const FLOOR_M = 3.0;    // FLOOR_H (30 px) · S
const CELL_M = 2.6;     // CELL (26 px) · S
const f3 = v => v.toFixed(3);

// ancho / alto (m) de cada mosaico de fachada: una ventana por celda de edificio y una fila por piso
const TILE = FACADE_GRID.map(([c, r], i) => [c * (i === 3 ? CELL_M / 2 : CELL_M), r * FLOOR_M]);

/** Encadena un onBeforeCompile y cambia la clave de programa */
function chain(mat, key, fn) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); fn(sh, r); };
  mat.customProgramCacheKey = () => prevKey + '|' + key;
  mat.needsUpdate = true;
}

// ————————————————————————————— fachadas —————————————————————————————
/** Marca las caras laterales (1) en las geometrías de fachada */
export function markFacadeGeometry(geo) {
  if (geo.attributes.aFacSide) return;
  const n = geo.attributes.normal, a = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) a[i] = Math.abs(n.getY(i)) < 0.5 ? 1 : 0;
  geo.setAttribute('aFacSide', new THREE.BufferAttribute(a, 1));
}

/** Capa de fachada por instancia (una por edificio) */
export function setFacadeLayers(mesh, minCount, layerOf) {
  const geo = mesh.geometry;
  const n = Math.max(mesh.instanceMatrix.count, minCount);
  let attr = geo.attributes.aFacL;
  if (!attr || attr.count < n) { attr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); geo.setAttribute('aFacL', attr); }
  layerOf(attr.array);
  attr.needsUpdate = true;
}

export function patchFacadeMaterial(mat, facadeArr, normalArr) {
  const U = {
    uFacArr: { value: facadeArr }, uFacNrm: { value: normalArr || null },
    uFacOn: { value: 1 }, uFacNrmOn: { value: normalArr ? 1 : 0 },
  };
  mat.userData.facadeUniforms = U;
  const tileW = TILE.map(t => f3(t[0])), tileH = TILE.map(t => f3(t[1]));
  const grid = FACADE_GRID.map(g => `vec2(${g[0].toFixed(1)}, ${g[1].toFixed(1)})`);
  chain(mat, 'facade-tex-v1' + (normalArr ? 'n' : ''), (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFacSide;
        #ifdef USE_INSTANCING
          attribute float aFacL;
        #endif
        varying float vFacSide; varying float vFacL; varying vec2 vFacUV; varying vec3 vFacT;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vFacSide = aFacSide;
          #ifdef USE_INSTANCING
            vFacL = aFacL;
            vec3 fip = instanceMatrix[3].xyz;
            vec3 fsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          #else
            vFacL = 0.0; vec3 fip = vec3(0.0); vec3 fsc = vec3(1.0);
          #endif
          vec3 flp = fip + position * fsc;            // posición sin la inclinación (la textura no "nada")
          vec3 fn = normal;
          vFacT = vec3(fn.z, 0.0, -fn.x);             // tangente = arriba × normal (u crece a la derecha mirando la cara)
          int fl = int(vFacL + 0.5);
          float tw = fl == 0 ? ${tileW[0]} : fl == 1 ? ${tileW[1]} : fl == 2 ? ${tileW[2]} : ${tileW[3]};
          float th = fl == 0 ? ${tileH[0]} : fl == 1 ? ${tileH[1]} : fl == 2 ? ${tileH[2]} : ${tileH[3]};
          vFacUV = vec2(dot(flp.xz, vFacT.xz) / tw, flp.y / th);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray uFacArr; uniform highp sampler2DArray uFacNrm; uniform float uFacOn; uniform float uFacNrmOn;
        varying float vFacSide; varying float vFacL; varying vec2 vFacUV; varying vec3 vFacT;
        vec4 gFac = vec4(0.0); float gFacUse = 0.0;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          if (vFacSide > 0.5 && uFacOn > 0.5) {
            gFac = texture(uFacArr, vec3(vFacUV, floor(vFacL + 0.5)));
            gFacUse = 1.0;
            vec3 fcol = gFac.rgb;
            #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
              // el tinte por edificio se suaviza (la foto ya trae su color); el daño (oscurecer) se conserva
              vec3 tc = max(vColor.rgb, vec3(0.02));
              float tl = dot(tc, vec3(0.3333));
              fcol *= mix(vec3(tl), tc, 0.3) * 1.25 / tc;
            #endif
            sampledDiffuseColor = vec4(fcol, 1.0);
          }
          diffuseColor *= sampledDiffuseColor;
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gFacUse > 0.5 && uFacNrmOn > 0.5) {
          vec3 tn = texture(uFacNrm, vec3(vFacUV, floor(vFacL + 0.5))).xyz * 2.0 - 1.0;
          tn.xy *= 0.85;
          vec3 Tv = normalize((viewMatrix * vec4(vFacT, 0.0)).xyz);
          vec3 Bv = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(tn.x * Tv + tn.y * Bv + tn.z * normal);
        }`)
      .replace('#include <lights_physical_fragment>', `
        if (gFacUse > 0.5) {
          // ventanas: vidrio (más azul que rojo, no muy claro) → se encienden una por una, por piso
          vec3 c = gFac.rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float mask = smoothstep(0.0, 0.035, c.b - c.r) * (1.0 - smoothstep(0.35, 0.6, lum));
          int fl = int(vFacL + 0.5);
          vec2 g = fl == 0 ? ${grid[0]} : fl == 1 ? ${grid[1]} : fl == 2 ? ${grid[2]} : ${grid[3]};
          vec2 cell = mod(floor(vFacUV * g), 997.0);
          float hsh = fract(sin(dot(vec3(cell, float(fl) * 7.0 + 3.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          float lit = step(fl == 3 ? 0.86 : 0.68, hsh);   // muro cortina: paños grandes → menos encendidos
          vec3 tint = mix(vec3(1.0, 0.74, 0.42), vec3(0.72, 0.86, 1.0), step(0.82, fract(hsh * 13.0)));
          totalEmissiveRadiance = emissive * mask * lit * tint * (0.45 + fract(hsh * 7.0) * 0.7) * (fl == 3 ? 0.45 : 0.65);
        }
        #include <lights_physical_fragment>`);
  });
}

// ————————————————————————————— calle / banqueta —————————————————————————————
/** Detalle fotográfico sobre el suelo procedural (sin perder líneas ni cruces); cráteres con escombro */
export function patchGroundMaterial(mat, tex, avg, world) {
  const roads = world.roadPos || [];
  const RW = 72, SW = 14;   // ROAD_W / SIDEWALK_W (px)
  const U = {
    uGAsp: { value: tex.asphalt || null }, uGCrk: { value: tex.asphaltCracked || tex.asphalt || null },
    uGPav: { value: tex.sidewalk || null }, uGCon: { value: tex.concrete || null }, uGRub: { value: tex.rubble || tex.broken || null },
    uGAvgA: { value: avg.asphalt || new THREE.Vector3(0.05, 0.05, 0.05) }, uGAvgK: { value: avg.asphaltCracked || avg.asphalt || new THREE.Vector3(0.06, 0.06, 0.06) },
    uGAvgP: { value: avg.sidewalk || new THREE.Vector3(0.2, 0.18, 0.15) }, uGAvgC: { value: avg.concrete || new THREE.Vector3(0.4, 0.4, 0.4) },
    uGHas: { value: new THREE.Vector4(tex.asphalt ? 1 : 0, tex.sidewalk ? 1 : 0, tex.concrete ? 1 : 0, (tex.rubble || tex.broken) ? 1 : 0) },
  };
  const rp = roads.slice(0, 8).map(f3);
  while (rp.length < 8) rp.push('-99999.0');
  chain(mat, 'ground-tex-v1', (sh) => {
    Object.assign(sh.uniforms, U);
    const hasCr = sh.fragmentShader.includes('vCrW');
    if (!hasCr) {   // (si no hay parche de cráteres, la posición de mundo se calcula aquí)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCrW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCrW;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGAsp; uniform sampler2D uGCrk; uniform sampler2D uGPav; uniform sampler2D uGCon; uniform sampler2D uGRub;
        uniform vec3 uGAvgA; uniform vec3 uGAvgK; uniform vec3 uGAvgP; uniform vec3 uGAvgC; uniform vec4 uGHas;
        const float GRP[8] = float[8](${rp.join(', ')});
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
          float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          {
            vec2 wp = vCrW / ${f3(S)};
            float road = 0.0, side = 0.0;
            for (int i = 0; i < 8; i++) {
              float r = GRP[i];
              road = max(road, max(step(r, wp.x) * step(wp.x, r + ${f3(RW)}), step(r, wp.y) * step(wp.y, r + ${f3(RW)})));
              side = max(side, max(step(r - ${f3(SW)}, wp.x) * step(wp.x, r + ${f3(RW + SW)}), step(r - ${f3(SW)}, wp.y) * step(wp.y, r + ${f3(RW + SW)})));
            }
            side *= 1.0 - road;
            // cerca de cráteres: asfalto agrietado; adentro: escombro
            float near = 0.0, rub = 0.0;
            #ifdef PCS_CRATERS
              for (int i = 0; i < 32; i++) {
                if (i >= uCrN) break;
                vec2 d = vCrW - uCr[i].xy;
                float t = sqrt(dot(d, d) / max(1e-4, uCr[i].z));
                near = max(near, 1.0 - smoothstep(0.85, 1.7, t));
                rub = max(rub, 1.0 - smoothstep(0.5, 0.74, t));
              }
              rub *= step(0.5, vCrater);
            #endif
            float wear = smoothstep(0.6, 0.82, gNoise(vCrW * 0.09) * 0.7 + gNoise(vCrW * 0.31) * 0.3);
            vec3 det = vec3(1.0);
            if (road > 0.5 && uGHas.x > 0.5) {
              vec3 a = texture2D(uGAsp, vCrW / 3.2).rgb / max(uGAvgA, vec3(0.005));
              vec3 k = texture2D(uGCrk, vCrW / 3.6 + 0.37).rgb / max(uGAvgK, vec3(0.005));
              det = mix(a, k, max(wear * 0.85, near));
            } else if (side > 0.5 && uGHas.y > 0.5) {
              det = texture2D(uGPav, vCrW / 2.4).rgb / max(uGAvgP, vec3(0.005));
            } else if (uGHas.z > 0.5) {
              det = texture2D(uGCon, vCrW / 4.0).rgb / max(uGAvgC, vec3(0.005));
              det = mix(vec3(1.0), det, 0.6);
            }
            sampledDiffuseColor.rgb *= clamp(mix(vec3(1.0), det, 0.85), vec3(0.35), vec3(1.9));
            if (rub > 0.0 && uGHas.w > 0.5) {
              vec3 rb = texture2D(uGRub, vCrW / 2.2).rgb * 0.8;
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, rb, rub);
            }
          }
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    if (hasCr) sh.fragmentShader = '#define PCS_CRATERS\n' + sh.fragmentShader;
  });
  mat.userData.groundUniforms = U;
}

// ————————————————————————————— escombro (proyección por eje dominante) —————————————————————————————
/** Textura en espacio de mundo (sin depender de UVs): 1 lectura por fragmento */
export function patchWorldMapped(mat, tex, avg, scaleM, key, strength = 1) {
  const U = { uWMap: { value: tex }, uWStr: { value: strength }, uWAvg: { value: avg || new THREE.Vector3(0.3, 0.3, 0.3) } };
  chain(mat, 'wmap-' + key, (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWmP; varying vec3 vWmN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            mat3 wim = mat3(instanceMatrix);
            wp = instanceMatrix * wp;
            wn = wim * (wn / vec3(dot(wim[0], wim[0]), dot(wim[1], wim[1]), dot(wim[2], wim[2])));  // escala no uniforme
          #endif
          wp = modelMatrix * wp; wn = mat3(modelMatrix) * wn;
          vWmP = wp.xyz; vWmN = wn;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uWMap; uniform float uWStr; uniform vec3 uWAvg; varying vec3 vWmP; varying vec3 vWmN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 an = abs(vWmN);
          vec2 wuv = an.x > an.y && an.x > an.z ? vWmP.zy : (an.y > an.z ? vWmP.xz : vWmP.xy);
          vec3 wt = texture2D(uWMap, wuv / ${f3(scaleM)}).rgb;
          diffuseColor.rgb *= clamp(mix(vec3(1.0), wt / max(uWAvg, vec3(0.01)), uWStr), vec3(0.25), vec3(2.0));
        }`);
  });
}

// ————————————————————————————— decals —————————————————————————————
/** Grietas: el atlas trae 4 tiras; cada instancia usa una (gl_InstanceID) */
export function patchCrackDecals(mesh, atlas) {
  const mat = mesh.material;
  mat.map = atlas; mat.alphaTest = 0.02;
  const geo = new THREE.PlaneGeometry(1.3, 0.32); geo.rotateX(-Math.PI / 2);
  mesh.geometry.dispose(); mesh.geometry = geo;
  const R = CRACK_RECTS.map(r => `vec4(${r.map(f3).join(', ')})`);
  chain(mat, 'crack-atlas-v1', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #if defined( USE_MAP ) && defined( USE_INSTANCING )
        { int ci = gl_InstanceID % 4;
          vec4 rc = ci == 0 ? ${R[0]} : ci == 1 ? ${R[1]} : ci == 2 ? ${R[2]} : ${R[3]};
          vMapUv = rc.xy + uv * rc.zw; }
      #endif`);
  });
}

/** Cráter plano (sobre edificios / al terminar un derrumbe): atlas a|b, alterna por instancia */
export function patchCraterDecals(mesh, atlas2) {
  const mat = mesh.material;
  mat.map = atlas2; mat.alphaTest = 0.02;
  chain(mat, 'crater-atlas-v1', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #if defined( USE_MAP ) && defined( USE_INSTANCING )
        vMapUv = vec2((uv.x + float(gl_InstanceID % 2)) * 0.5, uv.y);
      #endif`);
  });
}

// ————————————————————————————— cielo —————————————————————————————
/** El domo del cielo muestra el panorama arriba y se funde con la niebla en el horizonte */
export function patchSkyDome(skyMat, tex, hdr) {
  skyMat.uniforms.uPano = { value: tex };
  skyMat.uniforms.uPanoOn = { value: 1 };
  skyMat.uniforms.uPanoHdr = { value: hdr ? 1 : 0 };
  skyMat.uniforms.uPanoRot = { value: 0.0 };
  let fs = skyMat.fragmentShader;
  fs = fs.replace('uniform vec3 top;', 'uniform sampler2D uPano; uniform float uPanoOn; uniform float uPanoHdr; uniform float uPanoRot;\nuniform vec3 top;');
  fs = fs.replace('gl_FragColor = vec4(c, 1.0);', `if (uPanoOn > 0.5) {
      vec3 d = normalize(vDir);
      vec2 puv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5 + uPanoRot, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
      vec3 p = texture2D(uPano, puv).rgb;
      if (uPanoHdr > 0.5) { p *= 0.85; p = p / (1.0 + p); p = pow(p * 1.25, vec3(0.4545)); }
      else p = pow(p, vec3(0.4545));
      // el horizonte (muros y barandal de la foto) queda bajo la neblina; arriba, rascacielos y nubes
      c = mix(c, p, smoothstep(0.1, 0.32, h) * 0.95);
    }
    gl_FragColor = vec4(c, 1.0);`);
  skyMat.fragmentShader = fs;
  skyMat.needsUpdate = true;
}
