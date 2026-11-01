// Procedural canvas textures (no downloads): vinyl tiles, wood planks, grass, painted walls.
import * as THREE from 'three';
import { translate, onLangChange, CJK_FONT } from './i18n.js';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvasTex(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = rand() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

// 4×4 vinyl tiles per texture repeat (UVs are world metres / 2 → 0.5 m tiles)
export const tileTexture = () => canvasTex(512, 512, (g, w, h) => {
  const n = 4, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 236 + Math.floor((rand() - 0.5) * 14);
    g.fillStyle = `rgb(${v},${v},${v - 3})`;
    g.fillRect(i * s, j * s, s, s);
  }
  speckle(g, w, h, 5000, 0.12);
  g.strokeStyle = 'rgba(90,85,80,0.45)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke();
  }
});

export const woodTexture = () => canvasTex(512, 512, (g, w, h) => {
  const planks = 8, ph = h / planks;
  for (let p = 0; p < planks; p++) {
    const base = [158 + rand() * 22, 116 + rand() * 18, 78 + rand() * 12];
    const off = rand() * w;
    for (const x0 of [-off, w - off]) {
      g.fillStyle = `rgb(${base.map(Math.floor).join(',')})`;
      g.fillRect(x0, p * ph, w, ph);
    }
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(70,45,25,${0.05 + rand() * 0.1})`;
      g.lineWidth = 1 + rand() * 2;
      const y = p * ph + rand() * ph;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 6, w * 0.7, y + (rand() - 0.5) * 6, w, y); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,15,0.55)';
    g.fillRect(0, p * ph, w, 2);
    g.fillRect((off + w * 0.5) % w, p * ph, 2, ph);
  }
});

export const grassTexture = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#4c6b34';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14000; i++) {
    const t = rand();
    g.strokeStyle = `rgba(${60 + t * 70},${95 + t * 70},${35 + t * 30},0.55)`;
    const x = rand() * w, y = rand() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 5); g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(110,80,40,${0.08 + rand() * 0.1})`;
    g.beginPath(); g.arc(rand() * w, rand() * h, 6 + rand() * 18, 0, Math.PI * 2); g.fill();
  }
});

export const pavingTexture = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#9a958b'; g.fillRect(0, 0, w, h);
  const s = w / 4;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 150 + rand() * 30;
    g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
  }
  speckle(g, w, h, 2500, 0.2);
});

// Vertical wall profile: v = height / WALL_H. Skirting, wainscot, handrail, painted upper wall, cap.
export const wallTexture = (wallH) => canvasTex(64, 512, (g, w, h) => {
  const y = (m) => h - (m / wallH) * h;
  g.fillStyle = '#efe8da'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#cdd8d3'; g.fillRect(0, y(0.95), w, y(0.12) - y(0.95));
  g.fillStyle = '#5d554d'; g.fillRect(0, y(0.12), w, h - y(0.12));
  g.fillStyle = '#8a6a48'; g.fillRect(0, y(0.97), w, y(0.88) - y(0.97));
  g.fillStyle = '#b08a62'; g.fillRect(0, y(0.97), w, 3);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y(0.88), w, 2);
  g.fillStyle = '#9c968b'; g.fillRect(0, 0, w, 6);
  speckle(g, w, h, 1500, 0.05);
});

// Counter / cabinet laminate
export const laminateTexture = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#dcd2c0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(150,120,90,${0.05 + rand() * 0.08})`;
    const y = rand() * h;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (rand() - 0.5) * 8); g.stroke();
  }
});

export function signTexture(text, { bg = '#23314d', fg = '#f4ead2', w = 512, h = 128 } = {}) {
  const draw = (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg;
    g.font = `bold ${Math.floor(h * 0.42)}px ${CJK_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(translate(text), w / 2, h / 2 + 2, w - 32);
  };
  const texture = canvasTex(w, h, draw, { repeat: false });
  const redraw = () => { draw(texture.image.getContext('2d')); texture.needsUpdate = true; };
  const unsubscribe = onLangChange(redraw);
  texture.addEventListener('dispose', unsubscribe);
  document.fonts?.ready.then(redraw);
  texture.userData.sourceText = text;
  return texture;
}

// World-space planar UVs (metres / size) for floors.
export function planarUV(geo, size = 2) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / size; uv[i * 2 + 1] = p.getZ(i) / size; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Wall UVs: u runs along the wall, v is height / wallH; tops map to the cap row.
export function wallUV(geo, wallH) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (ny > 0.5) { uv[i * 2] = 0; uv[i * 2 + 1] = 0.995; continue; }
    uv[i * 2] = (nx > 0.5 ? p.getZ(i) : p.getX(i)) / 2;
    uv[i * 2 + 1] = Math.min(0.985, p.getY(i) / wallH);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
