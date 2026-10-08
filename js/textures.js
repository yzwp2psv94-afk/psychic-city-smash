/** Texturas procedurales (canvas) — sin descargas externas */

import * as THREE from 'three';
import { ROAD_W, SIDEWALK_W, PITCH, BLOCK } from './world.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
const rnd = (a, b) => a + Math.random() * (b - a);

function speckle(ctx, x, y, w, h, n, colors, smin = 1, smax = 2.5) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = rnd(smin, smax);
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, s, s);
  }
}

function tex(canvas, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

/** Suelo de ciudad: calles, carriles, cruces peatonales, banquetas, manzanas */
export function makeCityGround(world, margin) {
  const minX = -margin, minY = -margin;
  const spanX = world.w + margin * 2, spanY = world.h + margin * 2;
  const k = Math.min(1.25, 2600 / Math.max(spanX, spanY));
  const [c, g] = cv(Math.round(spanX * k), Math.round(spanY * k));
  g.scale(k, k);
  g.translate(-minX, -minY);

  // Base (fuera de la ciudad): tierra/pasto
  g.fillStyle = '#5d6a45';
  g.fillRect(minX, minY, spanX, spanY);
  speckle(g, minX, minY, spanX, spanY, 9000, ['#55613f', '#66734c', '#4f5a3a', '#6d6a4c'], 2, 6);

  // Rejilla extendida (incluye anillo fuera de límites)
  const roadPos = [];
  for (let i = -1; i <= world.roadPos.length; i++) roadPos.push(BLOCK + SIDEWALK_W + i * PITCH);
  const blocksX = [];
  for (let i = -1; i <= world.roadPos.length; i++) blocksX.push(i * PITCH);

  // Manzanas
  const blockType = (x, y) => {
    const b = world.blocks.find(bb => Math.abs(bb.x - x) < 1 && Math.abs(bb.y - y) < 1);
    return b ? b.type : 'outer';
  };
  for (const bx of blocksX) for (const by of blocksX) {
    const t = blockType(bx, by);
    if (t === 'park') {
      g.fillStyle = '#4c7a37'; g.fillRect(bx, by, BLOCK, BLOCK);
      speckle(g, bx, by, BLOCK, BLOCK, 900, ['#447032', '#568a3f', '#3e682e', '#5e9446'], 1.5, 4);
      g.strokeStyle = '#b9ab8e'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(bx, by + BLOCK * 0.3); g.bezierCurveTo(bx + 80, by + 60, bx + 150, by + 200, bx + BLOCK, by + BLOCK * 0.7); g.stroke();
    } else if (t === 'parking') {
      g.fillStyle = '#3c3e41'; g.fillRect(bx, by, BLOCK, BLOCK);
      speckle(g, bx, by, BLOCK, BLOCK, 1600, ['#45474b', '#333538', '#4b4c4f'], 1, 2.5);
      g.strokeStyle = '#d9d9d2'; g.lineWidth = 1.6;
      for (let r = 0; r < 2; r++) for (let cI = 0; cI <= 4; cI++) {
        const x = bx + 15 + cI * 50, y0 = by + 30 + r * 120;
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 52); g.stroke();
      }
      g.fillStyle = '#a7a39b'; g.fillRect(bx, by, BLOCK, 6); g.fillRect(bx, by + BLOCK - 6, BLOCK, 6);
    } else if (t === 'plaza') {
      g.fillStyle = '#a49e92'; g.fillRect(bx, by, BLOCK, BLOCK);
      g.strokeStyle = '#8f8a7f'; g.lineWidth = 0.8;
      for (let i = 0; i <= BLOCK; i += 12) {
        g.beginPath(); g.moveTo(bx + i, by); g.lineTo(bx + i, by + BLOCK); g.stroke();
        g.beginPath(); g.moveTo(bx, by + i); g.lineTo(bx + BLOCK, by + i); g.stroke();
      }
      g.fillStyle = '#c1b9a8';
      g.beginPath(); g.arc(bx + BLOCK / 2, by + BLOCK / 2, 60, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8a7f6d'; g.lineWidth = 3;
      for (const r of [60, 42, 24]) { g.beginPath(); g.arc(bx + BLOCK / 2, by + BLOCK / 2, r, 0, Math.PI * 2); g.stroke(); }
      speckle(g, bx, by, BLOCK, BLOCK, 700, ['#9a9488', '#aea89b'], 1, 2);
    } else {
      // concreto alrededor de edificios
      g.fillStyle = t === 'outer' ? '#7d7a74' : '#8f8b84'; g.fillRect(bx, by, BLOCK, BLOCK);
      g.strokeStyle = '#7f7b74'; g.lineWidth = 0.7;
      for (let i = 0; i <= BLOCK; i += 23) {
        g.beginPath(); g.moveTo(bx + i, by); g.lineTo(bx + i, by + BLOCK); g.stroke();
        g.beginPath(); g.moveTo(bx, by + i); g.lineTo(bx + BLOCK, by + i); g.stroke();
      }
      speckle(g, bx, by, BLOCK, BLOCK, 900, ['#86827b', '#999590', '#7a766f', '#6f6b65'], 1, 3);
      // manchas de humedad
      for (let i = 0; i < 6; i++) {
        const gr = g.createRadialGradient(bx + rnd(0, BLOCK), by + rnd(0, BLOCK), 0, bx + rnd(0, BLOCK), by + rnd(0, BLOCK), rnd(15, 40));
        gr.addColorStop(0, 'rgba(60,55,50,0.18)'); gr.addColorStop(1, 'rgba(60,55,50,0)');
        g.fillStyle = gr; g.fillRect(bx, by, BLOCK, BLOCK);
      }
    }
  }

  const fullMin = minX, fullLen = spanX;
  // Banquetas
  for (const r of roadPos) {
    for (const [x, y, w, h] of [
      [fullMin, r - SIDEWALK_W, fullLen, SIDEWALK_W], [fullMin, r + ROAD_W, fullLen, SIDEWALK_W],
      [r - SIDEWALK_W, fullMin, SIDEWALK_W, fullLen], [r + ROAD_W, fullMin, SIDEWALK_W, fullLen],
    ]) {
      g.fillStyle = '#b1aca2'; g.fillRect(x, y, w, h);
      speckle(g, x, y, w, h, Math.round(w * h / 60), ['#a29d93', '#bbb6ac', '#9a958b'], 0.8, 2);
      g.strokeStyle = '#8e897f'; g.lineWidth = 0.6;
      if (w > h) for (let i = x; i < x + w; i += 14) { g.beginPath(); g.moveTo(i, y); g.lineTo(i, y + h); g.stroke(); }
      else for (let i = y; i < y + h; i += 14) { g.beginPath(); g.moveTo(x, i); g.lineTo(x + w, i); g.stroke(); }
    }
  }

  // Asfalto
  const asphalt = (x, y, w, h) => {
    g.fillStyle = '#3a3c40'; g.fillRect(x, y, w, h);
    speckle(g, x, y, w, h, Math.round(w * h / 18), ['#323438', '#44464a', '#2c2e31', '#4b4d50'], 0.8, 2.2);
  };
  for (const r of roadPos) {
    asphalt(fullMin, r, fullLen, ROAD_W);
    asphalt(r, fullMin, ROAD_W, fullLen);
  }
  // Huellas de llanta sutiles en carriles
  g.globalAlpha = 0.18;
  g.fillStyle = '#25272a';
  for (const r of roadPos) for (const off of [0.18, 0.32, 0.68, 0.82]) {
    g.fillRect(fullMin, r + ROAD_W * off - 2.5, fullLen, 5);
    g.fillRect(r + ROAD_W * off - 2.5, fullMin, 5, fullLen);
  }
  g.globalAlpha = 1;
  // v3: parches de reparación, manchas de aceite y tapas de registro en los carriles
  for (const r of roadPos) for (let s = fullMin + 30; s < fullMin + fullLen - 30; s += 70 + Math.random() * 120) {
    const horiz = Math.random() < 0.5;
    const off = r + ROAD_W * (0.15 + Math.random() * 0.6);
    const kind = Math.random();
    const [x, y] = horiz ? [s, off] : [off, s];
    if (kind < 0.4) {
      const pw = 14 + Math.random() * 26, ph = 8 + Math.random() * 12;
      g.fillStyle = Math.random() < 0.5 ? '#2f3134' : '#45474b';
      g.globalAlpha = 0.55; g.fillRect(x, y, horiz ? pw : ph, horiz ? ph : pw);
      g.globalAlpha = 0.35; g.strokeStyle = '#1f2022'; g.lineWidth = 0.8; g.strokeRect(x, y, horiz ? pw : ph, horiz ? ph : pw);
    } else if (kind < 0.75) {
      const rr = 4 + Math.random() * 7;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(18,18,22,0.55)'); gr.addColorStop(0.6, 'rgba(30,28,34,0.3)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
      g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    } else {
      g.globalAlpha = 1; g.fillStyle = '#2a2b2d'; g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5b5d60'; g.lineWidth = 0.7; g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.stroke();
    }
  }
  g.globalAlpha = 1;
  // Bordillo
  g.fillStyle = '#d0ccc2';
  for (const r of roadPos) {
    g.fillRect(fullMin, r - 1.5, fullLen, 1.5); g.fillRect(fullMin, r + ROAD_W, fullLen, 1.5);
    g.fillRect(r - 1.5, fullMin, 1.5, fullLen); g.fillRect(r + ROAD_W, fullMin, 1.5, fullLen);
  }

  const inX = (s) => roadPos.some(r => s > r - SIDEWALK_W - 22 && s < r + ROAD_W + SIDEWALK_W + 22);
  // Líneas: doble amarilla al centro, blancas en borde
  for (const r of roadPos) {
    const mid = r + ROAD_W / 2;
    for (let s = fullMin; s < fullMin + fullLen; s += 4) {
      if (inX(s)) continue;
      g.fillStyle = '#e1b52c';
      g.fillRect(s, mid - 2.2, 4.2, 1.3); g.fillRect(s, mid + 0.9, 4.2, 1.3);
      g.fillRect(mid - 2.2, s, 1.3, 4.2); g.fillRect(mid + 0.9, s, 1.3, 4.2);
      g.fillStyle = '#d8d6cf';
      g.fillRect(s, r + 4, 4.2, 1.1); g.fillRect(s, r + ROAD_W - 5.1, 4.2, 1.1);
      g.fillRect(r + 4, s, 1.1, 4.2); g.fillRect(r + ROAD_W - 5.1, s, 1.1, 4.2);
    }
  }

  // Cruces: asfalto limpio + pasos peatonales + líneas de alto
  const zebra = (x, y, w, h, horizBars) => {
    g.fillStyle = '#e9e7df';
    if (horizBars) for (let i = 3; i < h - 2; i += 7) g.fillRect(x + 1, y + i, w - 2, 3.6);
    else for (let i = 3; i < w - 2; i += 7) g.fillRect(x + i, y + 1, 3.6, h - 2);
  };
  for (const rx of roadPos) for (const ry of roadPos) {
    asphalt(rx, ry, ROAD_W, ROAD_W);
    // rejilla de cruce (box junction) en algunas
    if (((rx + ry) / PITCH) % 2 < 1) {
      g.strokeStyle = 'rgba(230,228,220,0.85)'; g.lineWidth = 1.3;
      g.strokeRect(rx + 10, ry + 10, ROAD_W - 20, ROAD_W - 20);
      g.save(); g.beginPath(); g.rect(rx + 10, ry + 10, ROAD_W - 20, ROAD_W - 20); g.clip();
      for (let d = -ROAD_W; d < ROAD_W * 2; d += 9) {
        g.beginPath(); g.moveTo(rx + d, ry); g.lineTo(rx + d + ROAD_W, ry + ROAD_W); g.stroke();
        g.beginPath(); g.moveTo(rx + d + ROAD_W, ry); g.lineTo(rx + d, ry + ROAD_W); g.stroke();
      }
      g.restore();
    }
    const zw = 12;
    zebra(rx, ry - zw - SIDEWALK_W + SIDEWALK_W - 0, ROAD_W, zw, false);
    zebra(rx, ry + ROAD_W, ROAD_W, zw, false);
    zebra(rx - zw, ry, zw, ROAD_W, true);
    zebra(rx + ROAD_W, ry, zw, ROAD_W, true);
    g.fillStyle = '#e9e7df';
    g.fillRect(rx + ROAD_W / 2, ry - zw - 4, ROAD_W / 2, 2.2);
    g.fillRect(rx, ry + ROAD_W + zw + 2, ROAD_W / 2, 2.2);
    g.fillRect(rx - zw - 4, ry, 2.2, ROAD_W / 2);
    g.fillRect(rx + ROAD_W + zw + 2, ry + ROAD_W / 2, 2.2, ROAD_W / 2);
  }
  // Coladeras / parches
  for (let i = 0; i < 120; i++) {
    const r = roadPos[(Math.random() * roadPos.length) | 0];
    const s = fullMin + Math.random() * fullLen;
    const horiz = Math.random() > 0.5;
    const x = horiz ? s : r + rnd(8, ROAD_W - 8), y = horiz ? r + rnd(8, ROAD_W - 8) : s;
    if (Math.random() < 0.4) {
      g.fillStyle = '#2b2c2e'; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#55575a'; g.lineWidth = 0.6; g.stroke();
    } else {
      g.fillStyle = 'rgba(30,31,33,0.35)';
      g.fillRect(x, y, rnd(8, 26), rnd(5, 14));
    }
  }
  return { texture: tex(c, { aniso: 16 }), minX, minY, spanX, spanY };
}

/** Atlas de fachadas (512²): 3 estilos + techo + concreto roto + losa */
export const ATLAS = {
  facade: [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 256, 256]],
  roof: [256, 256, 128, 128],
  broken: [384, 256, 128, 128],
  slab: [256, 384, 128, 128],
  plain: [384, 384, 128, 128],
};

export function makeFacadeAtlas() {
  const [c, g] = cv(512, 512);
  const [ce, ge] = cv(512, 512);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 512);

  const glass = (x, y, w, h, lit) => {
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, '#2c3d52'); gr.addColorStop(0.45, '#4f6c88'); gr.addColorStop(0.55, '#7fa2bf'); gr.addColorStop(1, '#22313f');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(x, y + h * 0.7); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.55, y); g.lineTo(x, y + h); g.fill();
    // Máscara emisiva para TODAS las ventanas: el shader decide cuáles están encendidas (y su color)
    const eg = ge.createLinearGradient(x, y, x, y + h);
    eg.addColorStop(0, lit ? '#ffffff' : '#e8e8e8'); eg.addColorStop(1, '#9a9a9a');
    ge.fillStyle = eg; ge.fillRect(x + 3, y + 3, w - 6, h - 6);
    // marco
    g.strokeStyle = 'rgba(60,60,60,0.55)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };

  // Estilo 0: oficina de vidrio
  {
    const [x0, y0] = ATLAS.facade[0];
    g.fillStyle = '#e8e8e6'; g.fillRect(x0, y0, 256, 256);
    for (let i = 0; i < 4; i++) glass(x0 + 10 + i * 60 + (i >= 2 ? 6 : 0), y0 + 30, 50, 190, i % 2 === 0);
    g.fillStyle = '#cfcfcc'; g.fillRect(x0, y0 + 226, 256, 30);
    g.fillStyle = '#b9b9b5'; g.fillRect(x0 + 124, y0 + 30, 8, 190);
    g.fillStyle = '#9d9d99'; g.fillRect(x0, y0 + 250, 256, 6);
  }
  // Estilo 1: departamentos con ventanas y repisas
  {
    const [x0, y0] = ATLAS.facade[1];
    g.fillStyle = '#f1ece4'; g.fillRect(x0, y0, 256, 256);
    speckle(g, x0, y0, 256, 256, 1500, ['#e6e0d6', '#f7f3ec', '#ddd6cb'], 1, 3);
    for (let i = 0; i < 2; i++) {
      const wx = x0 + 34 + i * 112, wy = y0 + 58;
      g.fillStyle = '#d9d2c6'; g.fillRect(wx - 8, wy - 8, 92, 136);
      glass(wx, wy, 76, 120, true);
      // balcón con barandal
      g.fillStyle = 'rgba(70,70,75,0.85)'; g.fillRect(wx - 6, wy + 96, 88, 3);
      for (let k = 0; k < 9; k++) g.fillRect(wx - 6 + k * 11, wy + 96, 2, 24);
      g.fillStyle = '#e9e4dc'; g.fillRect(wx + 36, wy, 4, 120); g.fillRect(wx, wy + 56, 76, 4);
      g.fillStyle = '#bfb6a8'; g.fillRect(wx - 10, wy + 120, 96, 8);
    }
    g.fillStyle = '#cfc6b8'; g.fillRect(x0, y0 + 240, 256, 16);
  }
  // Estilo 2: concreto con ventanas pequeñas
  {
    const [x0, y0] = ATLAS.facade[2];
    g.fillStyle = '#d6d3cd'; g.fillRect(x0, y0, 256, 256);
    speckle(g, x0, y0, 256, 256, 2500, ['#c9c6c0', '#e0ddd8', '#bdbab4'], 1, 2.5);
    for (let i = 0; i < 4; i++) {
      const wx = x0 + 14 + i * 60 + (i >= 2 ? 4 : 0);
      glass(wx, y0 + 70, 44, 96, true);
      g.fillStyle = '#a9a6a0'; g.fillRect(wx - 4, y0 + 166, 52, 6);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(wx - 4, y0 + 172, 52, 10); // mancha de lluvia
    }
    g.fillStyle = '#b8b5af'; g.fillRect(x0, y0, 256, 14); g.fillRect(x0, y0 + 242, 256, 14);
  }
  // Techo (grava)
  {
    const [x0, y0, w, h] = ATLAS.roof;
    g.fillStyle = '#6c6a66'; g.fillRect(x0, y0, w, h);
    speckle(g, x0, y0, w, h, 2200, ['#5f5d59', '#7a7873', '#55534f', '#83807a'], 1, 2.4);
    g.strokeStyle = '#8f8c86'; g.lineWidth = 6; g.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6); // pretil
    g.fillStyle = 'rgba(30,30,30,0.35)';
    for (let i = 0; i < 3; i++) g.fillRect(x0 + rnd(20, w - 40), y0 + rnd(20, h - 40), rnd(10, 22), rnd(8, 16)); // manchas / ductos
  }
  // Concreto roto (núcleo expuesto)
  {
    const [x0, y0, w, h] = ATLAS.broken;
    g.fillStyle = '#9b968e'; g.fillRect(x0, y0, w, h);
    speckle(g, x0, y0, w, h, 1500, ['#8a857d', '#aca79f', '#76726b'], 1, 3);
    g.strokeStyle = '#4c4945'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      g.beginPath(); let x = x0 + Math.random() * w, y = y0 + Math.random() * h; g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += rnd(-22, 22); y += rnd(-22, 22); g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = '#6e6a64'; g.fillRect(x0, y0 + h - 12, w, 12);
    g.strokeStyle = '#8a4b2a'; g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x0 + 10 + i * 30, y0); g.lineTo(x0 + 14 + i * 30, y0 + h); g.stroke(); }
  }
  // Losa
  {
    const [x0, y0, w, h] = ATLAS.slab;
    g.fillStyle = '#8d8984'; g.fillRect(x0, y0, w, h);
    speckle(g, x0, y0, w, h, 900, ['#7f7b76', '#9a9690'], 1, 2.5);
  }
  {
    const [x0, y0, w, h] = ATLAS.plain;
    g.fillStyle = '#d0ccc4'; g.fillRect(x0, y0, w, h);
  }
  const map = tex(c);
  const emissive = tex(ce);
  return { map, emissive };
}

/** Fachada repetible para edificios de fondo */
export function makeBackdropFacade() {
  const [c, g] = cv(128, 128);
  g.fillStyle = '#cfcac2'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2; i++) {
    const gr = g.createLinearGradient(0, 20, 0, 100);
    gr.addColorStop(0, '#3a4c60'); gr.addColorStop(1, '#22303e');
    g.fillStyle = gr; g.fillRect(10 + i * 60, 22, 48, 80);
  }
  g.fillStyle = '#b1aba1'; g.fillRect(0, 112, 128, 16);
  return tex(c, { repeat: true });
}

export function makeCrackTexture() {
  const [c, g] = cv(256, 256);
  g.translate(128, 128);
  g.strokeStyle = 'rgba(15,15,15,0.9)';
  g.lineCap = 'round';
  const branch = (x, y, a, len, w, depth) => {
    if (depth <= 0 || len < 6) return;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    let cx = x, cy = y;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      a += rnd(-0.5, 0.5);
      cx += Math.cos(a) * len / steps; cy += Math.sin(a) * len / steps;
      g.lineTo(cx, cy);
    }
    g.stroke();
    branch(cx, cy, a + rnd(-0.8, 0.8), len * 0.6, w * 0.65, depth - 1);
    if (Math.random() > 0.4) branch(cx, cy, a + rnd(-1.2, 1.2), len * 0.5, w * 0.6, depth - 1);
  };
  for (let i = 0; i < 7; i++) branch(0, 0, (i / 7) * Math.PI * 2 + rnd(-0.3, 0.3), rnd(50, 110), 4, 4);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  gr.addColorStop(0, 'rgba(20,20,20,0.6)'); gr.addColorStop(1, 'rgba(20,20,20,0)');
  g.fillStyle = gr; g.fillRect(-128, -128, 256, 256);
  return tex(c);
}

export function makeCraterTexture() {
  const [c, g] = cv(256, 256);
  g.translate(128, 128);
  const gr = g.createRadialGradient(0, 0, 4, 0, 0, 124);
  gr.addColorStop(0, 'rgba(12,10,9,0.95)');
  gr.addColorStop(0.35, 'rgba(28,24,21,0.9)');
  gr.addColorStop(0.6, 'rgba(45,40,36,0.6)');
  gr.addColorStop(1, 'rgba(40,36,32,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 124, 0, Math.PI * 2); g.fill();
  // borde de asfalto levantado
  g.strokeStyle = 'rgba(80,76,70,0.8)'; g.lineWidth = 6;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
    const r = 58 + rnd(-8, 8);
    a === 0 ? g.moveTo(Math.cos(a) * r, Math.sin(a) * r) : g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.stroke();
  g.strokeStyle = 'rgba(10,10,10,0.85)'; g.lineWidth = 2.5;
  for (let i = 0; i < 12; i++) {
    let a = (i / 12) * Math.PI * 2, x = Math.cos(a) * 50, y = Math.sin(a) * 50;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { a += rnd(-0.4, 0.4); x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
    g.stroke();
  }
  speckle(g, -60, -60, 120, 120, 260, ['rgba(90,85,78,0.9)', 'rgba(50,46,42,0.9)'], 2, 5);
  return tex(c);
}

export function makeSoftSprite() {
  const [c, g] = cv(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false });
}

/** Sprite de humo/polvo con textura de nube (bordes suaves y ruido) */
export function makePuffSprite() {
  const [c, g] = cv(128, 128);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 30;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rad = rnd(18, 34);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  // recorte circular suave para que no se vean bordes cuadrados
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(64, 64, 20, 64, 64, 63);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false });
}

export function makeBlobShadow() {
  const [c, g] = cv(128, 64);
  const gr = g.createRadialGradient(64, 32, 4, 64, 32, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, 0.5); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.restore();
  g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
  return tex(c, { srgb: false });
}

const _stripeCache = new Map();
export function makeStripeTexture(color) {
  if (_stripeCache.has(color)) return _stripeCache.get(color);
  const [c, g] = cv(128, 128);
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f4f1ea';
  // franjas transversales (como el auto de referencia)
  for (let i = 0; i < 6; i++) g.fillRect(8 + i * 21, 0, 9, 128);
  const t = tex(c);
  _stripeCache.set(color, t);
  return t;
}

export function makeWheelTexture() {
  const [c, g] = cv(128, 128);
  g.fillStyle = '#111'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9ea3a8'; g.beginPath(); g.arc(64, 64, 36, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5c6166';
  for (let i = 0; i < 5; i++) {
    g.save(); g.translate(64, 64); g.rotate(i * Math.PI * 2 / 5);
    g.fillRect(-5, 8, 10, 24); g.restore();
  }
  g.fillStyle = '#c9cdd1'; g.beginPath(); g.arc(64, 64, 9, 0, Math.PI * 2); g.fill();
  return tex(c);
}

export function makeCrackedGlass() {
  const [c, g] = cv(128, 128);
  g.fillStyle = '#26323d'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(220,235,245,0.75)'; g.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const ox = rnd(20, 108), oy = rnd(20, 108);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(a) * 70, oy + Math.sin(a) * 70); g.stroke();
    }
    for (const r of [10, 22]) { g.beginPath(); g.arc(ox, oy, r, 0, Math.PI * 2); g.stroke(); }
  }
  return tex(c);
}

export function makeGrassTile() {
  const [c, g] = cv(128, 128);
  g.fillStyle = '#5a6943'; g.fillRect(0, 0, 128, 128);
  speckle(g, 0, 0, 128, 128, 900, ['#52603c', '#65744b', '#4b5836', '#6f6c4d'], 1, 3);
  return tex(c, { repeat: true });
}
