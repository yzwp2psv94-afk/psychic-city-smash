// v4.3 — Carga asíncrona de los assets CC0 (assets/): autos .glb, texturas, decals y cielo HDRI.
// Todo es opcional: si un archivo falla, el juego sigue con lo procedural.
import * as THREE from 'three';

const BASE = './assets/';
const T = BASE + 'textures/', D = T + 'destruction/';
export const CAR_FILES = ['sedan', 'sedan_b', 'taxi', 'police', 'suv', 'sports', 'sports_b', 'pickup'];
const DUMMY_KB = 68;
export const FACADES = ['facade_brick_dark', 'facade_brick_windows', 'facade_concrete_office', 'facade_glass_grid'];
// ventanas por mosaico [columnas, pisos] (medido en las texturas) — sirve para encender ventanas una por una
export const FACADE_GRID = [[6, 7], [6, 6], [6, 6], [14, 8]];
// tamaño en KB (solo para la barra de progreso)
const KB = {
  glb: { sedan: 172, sedan_b: 184, taxi: 188, police: 188, suv: 192, sports: 176, sports_b: 180, pickup: 84 },
  facade_brick_dark_albedo: 156, facade_brick_windows_albedo: 136, facade_concrete_office_albedo: 148, facade_glass_grid_albedo: 20,
  facade_brick_dark_normal: 236, facade_brick_windows_normal: 228, facade_concrete_office_normal: 244, facade_glass_grid_normal: 20,
  road_asphalt_albedo: 120, road_asphalt_cracked_albedo: 360, sidewalk_pavers_albedo: 268, concrete_albedo: 24,
  concrete_broken_albedo: 136, concrete_rebar_albedo: 88, rubble_ground_albedo: 144,
  decal_cracks_atlas: 220, decal_crater_a: 28, decal_crater_b: 24, decal_scorch: 36,
  hdr: 1620, ldr: 168,
};
// rectángulos [u, v, w, h] del atlas de grietas (v = 0 abajo)
export const CRACK_RECTS = [[0.008, 0.754, 0.988, 0.242], [0.043, 0.508, 0.953, 0.219], [0.031, 0.285, 0.918, 0.199], [0.008, 0.004, 0.973, 0.238]];

/** Resolución por calidad (memoria de GPU razonable en iPhone) */
function plan(q) {
  if (q === 'high') return { facade: 1024, facadeNormal: 1024, surf: 1024, decal: 512, cracks: 1024, sky: 'hdr', aniso: 8 };
  if (q === 'low') return { facade: 512, facadeNormal: 0, surf: 512, decal: 256, cracks: 512, sky: 'ldr', ldrW: 1024, aniso: 2 };
  return { facade: 1024, facadeNormal: 0, surf: 512, decal: 512, cracks: 512, sky: 'hdr', aniso: 4 };
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('no se pudo cargar ' + url));
    im.src = url;
  });
}

/** Dibuja la imagen en un canvas de tamaño máx. `size` (reduce en móviles) */
function toCanvas(img, size, flipY = false) {
  const w = Math.min(size || img.width, img.width), h = Math.round(w * img.height / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (flipY) { g.translate(0, h); g.scale(1, -1); }
  g.drawImage(img, 0, 0, w, h);
  return c;
}

/** Color medio (lineal) para normalizar las texturas de detalle */
function avgColor(img) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  const lin = v => Math.pow(v / Math.max(1, n) / 255, 2.2);
  return new THREE.Vector3(lin(r), lin(gg), lin(b));
}

function makeTex(src, { srgb = true, repeat = true, aniso = 4, mips = true } = {}) {
  const t = new THREE.Texture(src);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.needsUpdate = true;
  return t;
}

/** 4 imágenes → textura array (una capa por fachada), con mipmaps y repetición */
function makeArray(imgs, size, srgb, aniso) {
  const N = size, L = imgs.length;
  const data = new Uint8Array(N * N * 4 * L);
  for (let i = 0; i < L; i++) {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    g.translate(0, N); g.scale(1, -1);          // v = 0 abajo (las texturas 3D no aceptan flipY)
    g.drawImage(imgs[i], 0, 0, N, N);
    data.set(g.getImageData(0, 0, N, N).data, i * N * N * 4);
  }
  const t = new THREE.DataArrayTexture(data, N, N, L);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * Carga todo en paralelo. onProgress(0..1, etiqueta). Nunca lanza: los fallos quedan en `errors`.
 * @returns {Promise<{cars:Object, tex:Object, sky:Object|null, errors:string[]}>}
 */
export async function loadAssets({ quality = 'medium', onProgress = () => {} } = {}) {
  const P = plan(quality);
  const out = { quality, cars: {}, dummy: null, tex: {}, avg: {}, sky: null, errors: [] };
  const jobs = [];
  const job = (w, label, fn) => jobs.push({ w, label, fn });

  // —— autos ——
  let gltfLoader = null;
  const getGltf = async () => {
    if (!gltfLoader) { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); gltfLoader = new GLTFLoader(); }
    return gltfLoader;
  };
  for (const n of CAR_FILES) job(KB.glb[n], n + '.glb', async () => {
    const L = await getGltf();
    const g = await L.loadAsync(BASE + 'models/vehicles/' + n + '.glb');
    out.cars[n] = g.scene;
  });
  // —— maniquí de choque ——
  job(DUMMY_KB, 'dummy.glb', async () => {
    const L = await getGltf();
    const g = await L.loadAsync(BASE + 'models/dummy.glb');
    out.dummy = g.scene;
  });

  // —— fachadas (textura array) ——
  job(FACADES.reduce((s, f) => s + KB[f + '_albedo'], 0), 'fachadas', async () => {
    const imgs = await Promise.all(FACADES.map(f => loadImage(T + f + '_albedo.webp')));
    out.tex.facade = makeArray(imgs, P.facade, true, P.aniso);
  });
  if (P.facadeNormal) job(FACADES.reduce((s, f) => s + KB[f + '_normal'], 0), 'relieve de fachadas', async () => {
    const imgs = await Promise.all(FACADES.map(f => loadImage(T + f + '_normal.webp')));
    out.tex.facadeNormal = makeArray(imgs, P.facadeNormal, false, P.aniso);
  });

  // —— superficies (calle, banqueta, concreto) y destrucción ——
  const surf = [
    ['asphalt', T + 'road_asphalt_albedo.webp', KB.road_asphalt_albedo],
    ['asphaltCracked', T + 'road_asphalt_cracked_albedo.webp', KB.road_asphalt_cracked_albedo],
    ['sidewalk', T + 'sidewalk_pavers_albedo.webp', KB.sidewalk_pavers_albedo],
    ['concrete', T + 'concrete_albedo.webp', KB.concrete_albedo],
    ['broken', D + 'concrete_broken_albedo.webp', KB.concrete_broken_albedo],
    ['rebar', D + 'concrete_rebar_albedo.webp', KB.concrete_rebar_albedo],
    ['rubble', D + 'rubble_ground_albedo.webp', KB.rubble_ground_albedo],
  ];
  for (const [key, url, w] of surf) job(w, key, async () => {
    const im = await loadImage(url);
    out.tex[key] = makeTex(toCanvas(im, P.surf), { aniso: P.aniso });
    out.avg[key] = avgColor(im);
  });

  // —— decals ——
  job(KB.decal_cracks_atlas, 'grietas', async () => {
    const im = await loadImage(D + 'decal_cracks_atlas.webp');
    out.tex.cracks = makeTex(toCanvas(im, P.cracks), { repeat: false, aniso: P.aniso });
  });
  job(KB.decal_crater_a + KB.decal_crater_b, 'cráteres', async () => {
    const [a, b] = await Promise.all([loadImage(D + 'decal_crater_a.webp'), loadImage(D + 'decal_crater_b.webp')]);
    // atlas 2×1 (a | b): cada cráter elige una mitad
    const N = P.decal, c = document.createElement('canvas'); c.width = N * 2; c.height = N;
    const g = c.getContext('2d'); g.drawImage(a, 0, 0, N, N); g.drawImage(b, N, 0, N, N);
    out.tex.craterDecal = makeTex(c, { repeat: false, aniso: P.aniso });
  });
  job(KB.decal_scorch, 'hollín', async () => {
    const im = await loadImage(D + 'decal_scorch.webp');
    out.tex.scorch = makeTex(toCanvas(im, P.decal), { repeat: false, aniso: P.aniso });
  });

  // —— cielo ——
  const ldr = async () => {
    const im = await loadImage(BASE + 'hdri/canary_wharf_2k_ldr.webp').catch(() => loadImage(BASE + 'hdri/canary_wharf_2k_ldr.jpg'));
    const tex = makeTex(toCanvas(im, P.ldrW || 2048), { repeat: false, aniso: 1, mips: false });
    tex.wrapS = THREE.RepeatWrapping;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    out.sky = { tex, hdr: false };
  };
  if (P.sky === 'hdr') {
    job(KB.hdr, 'cielo HDRI', async () => {
      try {
        const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
        const tex = await new RGBELoader().loadAsync(BASE + 'hdri/canary_wharf_1k.hdr');
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.wrapS = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        out.sky = { tex, hdr: true };
      } catch (e) {
        out.errors.push('HDRI: ' + (e?.message || e) + ' → respaldo LDR');
        await ldr();
      }
    });
  } else job(KB.ldr, 'cielo', ldr);

  const total = jobs.reduce((s, j) => s + j.w, 0);
  let done = 0;
  onProgress(0, '');
  await Promise.all(jobs.map(async j => {
    try { await j.fn(); } catch (e) { out.errors.push(j.label + ': ' + (e?.message || e)); }
    done += j.w;
    onProgress(done / total, j.label);
  }));
  return out;
}
