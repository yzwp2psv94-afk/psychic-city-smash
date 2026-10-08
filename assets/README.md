# Psychic City Smash — CC0 asset pack (iPhone-friendly)

All files are CC0 (see `CREDITS.md`). Machine-readable details (pivots, sizes, rects) are in `manifest.json`.
Nothing here is linked from the game code yet.

## Conventions (all vehicles)
- **Units:** meters. **Up:** +Y. **Forward:** **+Z** (front bumper at +Z). **Left:** +X, right: −X. (Same as Kenney; `Object3D.lookAt(target)` points a car at the target.)
- **Origin:** ground center (y = 0 at the bottom of the tires, x/z centered on the bounding box).
- Root node is named after the file (`sedan`, `taxi`, ...), parts are its direct children.
- **No Draco, no meshopt, no quantization** — plain Float32 POSITION/NORMAL, so vertices can be moved for dents (`geometry.attributes.position`), and only `GLTFLoader` is needed.
- Part pivots (node origins): wheels = hub center (spin around local X); doors = front edge (hinge, rotate around Y); hood = rear edge (hinge, rotate around X); bumpers = their center. Part geometry is open-backed (detaching leaves a hole in `body`), which reads fine at game distance.
- Materials (shared names): `paint` (recolor this one for traffic variety), `paint_secondary` (sports only), `window`, `trim_black`, `trim_grey`, `trim_light`, `headlight` / `taillight` (emissive), `siren_white` / `siren_blue` (police), `tire`, `rim`. The Kenney pickup uses one palette texture material `kenney_colormap` (NearestFilter).
- Quaternius cars are realistic-proportion low-poly with flat colors (no textures, ~170–195 KB each). The pickup is from Kenney and is more toy-like/stylized; it was scaled ×1.5 to fit.

## Vehicles (`models/vehicles/`)
| File | Type | Tris | Size | W×H×L (m) | Wheel r / wheelbase | Parts |
|---|---|---|---|---|---|---|
| sedan.glb | sedan (4-door) | 3230 | 195 KB | 1.93×1.25×4.5 | 0.279 / 2.6 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, door_RL, door_RR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| sedan_b.glb | hatchback / compact (4-door) | 3420 | 209 KB | 1.98×1.38×4 | 0.299 / 2.41 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, door_RL, door_RR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| taxi.glb | taxi (4-door, roof sign) | 3554 | 210 KB | 1.97×1.43×4.6 | 0.285 / 2.66 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, door_RL, door_RR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| police.glb | police sedan (lightbar: siren_white/siren_blue materials) | 3508 | 210 KB | 2×1.39×4.2 | 0.31 / 2.58 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, door_RL, door_RR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| suv.glb | SUV / crossover (4-door, roof rails) | 3602 | 216 KB | 2.18×1.58×4.35 | 0.338 / 2.65 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, door_RL, door_RR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| sports.glb | sports coupe (2-door) | 3326 | 198 KB | 1.93×1.24×4.25 | 0.278 / 2.62 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| sports_b.glb | sports coupe B (2-door) | 3408 | 202 KB | 2.03×1.3×4.25 | 0.303 / 2.71 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| pickup.glb | pickup truck (2-door, Kenney stylized) | 2090 | 90 KB | 2.25×1.95×4.42 | 0.449 / 2.43 | body, hood, bumper_front, bumper_rear, door_FL, door_FR, wheel_FL, wheel_FR, wheel_RL, wheel_RR |
| kenney_car_debris.glb | loose Kenney car debris (×1.5) | 1194 | 72 KB | – | – | debris_bumper, debris_door, debris_door_window, debris_tire, debris_plate_a, debris_plate_b, debris_plate_small_a, debris_spoiler_a, debris_drivetrain, debris_bolt, debris_nut |

All cars: separate **body, hood, bumper_front, bumper_rear, door_FL/FR (+ door_RL/RR on 4-door cars), wheel_FL/FR/RL/RR**.

### Detail pass
On top of the split parts, each Quaternius car now also has (as **children of the part they belong to**, so the part pivots above do not move and the bounding width is unchanged):
- `headlight_L` / `headlight_R`, `taillight_L` / `taillight_R` — the original light triangles pulled into their own emissive meshes and enlarged a bit where the cluster is small. Headlights and brake lights still key off the material name (`headlight`, `taillight`; police bar is `siren_white` / `siren_blue`), and they leave with whichever part they are parented to.
- `grille` — four slats plus a frame, child of `bumper_front`.
- `plate` — one on `bumper_front` and one on `bumper_rear`, with a small generated texture (fictional "PCS ####"). Material name `plate`. Adds about 1–2 cm to the length.
- `window_frame` (material `trim_chrome`) around each window, and a `hubcap` (material `rim_hub`) on every wheel, which spins with it. The `rim` material was brightened so it reads against the tire.

Side mirrors and door handles were tried and left off: anything proud of the body widens the bounding box, and the game scales the whole car from that box. The Kenney pickup only got the light split (taken from its palette colors) and both plates. Its stylized shell has no separate window or rim faces, so no grille, frames or hubcaps.
 Doors/hood/bumpers were cut from the original single body mesh by region (they are not hand-modeled panels), so cut edges are a bit jagged.

## Surface textures (`textures/`) — tileable, 1K albedo + 1K normal (OpenGL/+Y, as three.js expects) + 512 roughness
| Set | Files | Sizes |
|---|---|---|
| concrete | concrete_albedo.webp, concrete_normal.webp, concrete_rough.webp | 1024×512 23 KB / 1024×512 73 KB / 512×256 5 KB |
| destruction/concrete_broken | concrete_broken_albedo.webp, concrete_broken_normal.webp, concrete_broken_rough.webp | 1024×1024 136 KB / 1024×1024 497 KB / 512×512 12 KB |
| destruction/concrete_rebar | concrete_rebar_albedo.webp, concrete_rebar_normal.webp, concrete_rebar_rough.webp | 1024×1024 87 KB / 1024×1024 243 KB / 512×512 6 KB |
| destruction/rubble_ground | rubble_ground_albedo.webp, rubble_ground_normal.webp, rubble_ground_rough.webp | 1024×1024 144 KB / 1024×1024 293 KB / 512×512 5 KB |
| facade_brick_dark | facade_brick_dark_albedo.webp, facade_brick_dark_normal.webp, facade_brick_dark_rough.webp | 1024×1024 155 KB / 1024×1024 235 KB / 512×512 34 KB |
| facade_brick_windows | facade_brick_windows_albedo.webp, facade_brick_windows_normal.webp, facade_brick_windows_rough.webp | 1024×1024 133 KB / 1024×1024 226 KB / 512×512 33 KB |
| facade_concrete_office | facade_concrete_office_albedo.webp, facade_concrete_office_normal.webp, facade_concrete_office_rough.webp | 1024×1024 145 KB / 1024×1024 240 KB / 512×512 33 KB |
| facade_glass_grid | facade_glass_grid_albedo.webp, facade_glass_grid_normal.webp, facade_glass_grid_rough.webp | 1024×1024 19 KB / 1024×1024 17 KB / 512×512 4 KB |
| road_asphalt | road_asphalt_albedo.webp, road_asphalt_normal.webp, road_asphalt_rough.webp | 1024×1024 118 KB / 1024×1024 128 KB / 512×512 3 KB |
| road_asphalt_cracked | road_asphalt_cracked_albedo.webp, road_asphalt_cracked_normal.webp, road_asphalt_cracked_rough.webp | 1024×1024 356 KB / 1024×1024 392 KB / 512×512 54 KB |
| sidewalk_pavers | sidewalk_pavers_albedo.webp, sidewalk_pavers_normal.webp, sidewalk_pavers_rough.webp | 1024×1024 266 KB / 1024×1024 407 KB / 512×512 4 KB |

Notes: `concrete` is 1024×512 (2:1 source, tiles fine). Facades: one texture tile ≈ a 4–6 storey × ~6-window patch; repeat vertically per floor count. Suggested world sizes: asphalt/sidewalk/concrete ≈ 2–3 m per tile, rubble ≈ 2 m, facades ≈ 12–15 m per tile.

## Destruction decals (`textures/destruction/`) — RGBA WebP (alpha = decal mask)
| File | Size | Use |
|---|---|---|
| decal_cracks_atlas.webp | 1024×1024 218 KB | crack strips atlas – see rects below |
| decal_cracks_atlas_normal.webp | 512×512 30 KB | normal map for the decal above |
| decal_crater_a.webp | 512×512 26 KB | impact crater / pothole (round) |
| decal_crater_a_normal.webp | 512×512 29 KB | normal map for the decal above |
| decal_crater_b.webp | 512×512 23 KB | impact crater / pothole (round, debris inside) |
| decal_crater_b_normal.webp | 512×512 24 KB | normal map for the decal above |
| decal_scorch.webp | 512×512 36 KB | scorch / burn mark (laser, explosions) |

`decal_cracks_atlas.webp` UV rects `[u, v, w, h]` (three.js UV, v=0 bottom): `[[0.008,0.754,0.988,0.242],[0.043,0.508,0.953,0.219],[0.031,0.285,0.918,0.199],[0.008,0.004,0.973,0.238]]`. Use `texture.offset.set(u, v)` + `texture.repeat.set(w, h)` on a clone, or remap plane UVs.

## Sky (`hdri/`)
- `hdri/canary_wharf_1k.hdr` — 1620 KB
- `hdri/canary_wharf_2k_ldr.jpg` — 192 KB
- `hdri/canary_wharf_2k_ldr.webp` — 166 KB

`canary_wharf_1k.hdr` (1024×512 RGBE, Poly Haven "Canary Wharf", urban daytime with skyscrapers) for `scene.environment` (+ background). The `_2k_ldr` WebP/JPG is an equirect sRGB fallback for low-end devices (cheaper than PMREM from HDR).

## three.js (r169) loading snippet
```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // no DRACOLoader needed
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const BASE = './assets/';
// --- cars
const gltfLoader = new GLTFLoader();
const gltf = await gltfLoader.loadAsync(BASE + 'models/vehicles/sedan.glb');
const car = gltf.scene.getObjectByName('sedan');           // root; children are the parts
const wheels = ['wheel_FL','wheel_FR','wheel_RL','wheel_RR'].map(n => car.getObjectByName(n));
const doorFL = car.getObjectByName('door_FL');              // pivot at hinge -> doorFL.rotation.y = 0.9
// recolor traffic: clone the 'paint' material per instance
car.traverse(o => { if (o.isMesh && o.material.name === 'paint') { o.material = o.material.clone(); o.material.color.setHSL(Math.random(), 0.5, 0.45); } });
// spin wheels: wheels.forEach(w => w.rotation.x += speed * dt / 0.28);
// detach part: scene.attach(car.getObjectByName('bumper_front'))  // keeps world transform, then simulate

// --- sky / environment
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load(BASE + 'hdri/canary_wharf_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.background = hdr;
});
// low-end fallback: const sky = new THREE.TextureLoader().load(BASE + 'hdri/canary_wharf_2k_ldr.webp');
//   sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky;

// --- tiling textures
const tl = new THREE.TextureLoader();
function pbr(name, repeat = 1) {
  const load = (suffix, srgb) => { const t = tl.load(BASE + 'textures/' + name + suffix);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
    t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return new THREE.MeshStandardMaterial({
    map: load('_albedo.webp', true),          // only albedo is sRGB
    normalMap: load('_normal.webp', false),
    roughnessMap: load('_rough.webp', false), // grayscale (three reads G channel)
  });
}
const road = pbr('road_asphalt', 20), sidewalk = pbr('sidewalk_pavers', 10), facade = pbr('facade_brick_windows', 1);
const rubble = pbr('destruction/rubble_ground', 4), chunk = pbr('destruction/concrete_rebar', 1);

// --- decals (crater/scorch): flat plane slightly above ground, or THREE DecalGeometry on meshes
const craterTex = tl.load(BASE + 'textures/destruction/decal_crater_a.webp'); craterTex.colorSpace = THREE.SRGBColorSpace;
const crater = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({
  map: craterTex, normalMap: tl.load(BASE + 'textures/destruction/decal_crater_a_normal.webp'),
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
crater.rotation.x = -Math.PI / 2; crater.position.y = 0.01;
```
WebP (incl. alpha) is supported by Safari on iOS 14+, so iOS 16+ is fine.

## Validation
- `gltf-transform validate` (Khronos validator): 0 errors, 0 warnings for all 9 GLBs.
- All GLBs loaded with three.js r169 `GLTFLoader` in headless Chromium; HDR loaded with `RGBELoader` (1024×512); every texture loaded with `TextureLoader`. See `preview.png`: each car front 3/4 then rear 3/4, after the detail pass (lights, grille, plates, mirrors).
