import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOMS, DOORS, SEATS, WALL_H, WALL_T } from './data.js';
import { tileTexture, woodTexture, grassTexture, pavingTexture, wallTexture, planarUV, wallUV } from './textures.js';
import { decorate, STATION } from './decor.js';
import { translate, onLangChange, CJK_FONT } from './i18n.js';

const EPS = 1e-3;

function union(iv) {
  const s = iv.map((p) => [...p]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of s) {
    const last = out[out.length - 1];
    if (last && p[0] <= last[1] + EPS) last[1] = Math.max(last[1], p[1]);
    else out.push(p);
  }
  return out;
}
function subtract(iv, gaps) {
  let cur = iv;
  for (const [g0, g1] of gaps) {
    const next = [];
    for (const [a, b] of cur) {
      if (g1 <= a || g0 >= b) { next.push([a, b]); continue; }
      if (g0 > a) next.push([a, g0]);
      if (g1 < b) next.push([g1, b]);
    }
    cur = next;
  }
  return cur.filter(([a, b]) => b - a > 0.05);
}

const FLOOR_COLORS = {
  bedroom: 0xe2d8c2, single: 0xd9c9b6, living: 0xffffff, hall: 0xc9cfd0,
  staff: 0xbfd2c8, care: 0xd5e3e6, therapy: 0xd6d9bd, outdoor: 0xffffff,
};
const FLOOR_TEX = { living: 'wood', outdoor: 'grass', therapy: 'wood' };

function makeLabel(text, size = 1) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  const redraw = () => {
    g.clearRect(0, 0, 512, 96);
    g.font = `bold 54px ${CJK_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(40,36,32,0.55)';
    g.fillText(translate(text), 256, 50, 500);
    tex.needsUpdate = true;
  };
  redraw();
  const unsubscribe = onLangChange(redraw);
  tex.addEventListener('dispose', unsubscribe);
  document.fonts?.ready.then(redraw);
  tex.userData.sourceText = text;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2 * size, 0.8 * size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function buildMap(scene) {
  const colliders = [];
  const buckets = new Map(); // color -> geometries
  const addBox = (w, h, d, x, y, z, color, collide = false) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    if (!buckets.has(color)) buckets.set(color, []);
    buckets.get(color).push(g);
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  };

  // ---------- walls ----------
  const lines = { walls: { x: new Map(), z: new Map() }, fence: { x: new Map(), z: new Map() } };
  const addEdge = (set, axis, at, a, b) => {
    const k = at.toFixed(2);
    if (!set[axis].has(k)) set[axis].set(k, { at, iv: [] });
    set[axis].get(k).iv.push([Math.min(a, b), Math.max(a, b)]);
  };
  for (const r of ROOMS) {
    const set = r.type === 'outdoor' ? lines.fence : lines.walls;
    addEdge(set, 'z', r.z, r.x, r.x + r.w);
    addEdge(set, 'z', r.z + r.d, r.x, r.x + r.w);
    addEdge(set, 'x', r.x, r.z, r.z + r.d);
    addEdge(set, 'x', r.x + r.w, r.z, r.z + r.d);
  }
  const gapsFor = (axis, at) => DOORS.filter((d) => d.a === axis && Math.abs(d.at - at) < EPS).map((d) => [d.c - d.w / 2, d.c + d.w / 2]);

  const wallGeoms = [];
  const fenceGeoms = [];
  const emit = (axis, at, a, b, h, list) => {
    const len = b - a + WALL_T;
    const mid = (a + b) / 2;
    const g = axis === 'z' ? new THREE.BoxGeometry(len, h, WALL_T) : new THREE.BoxGeometry(WALL_T, h, len);
    if (axis === 'z') g.translate(mid, h / 2, at); else g.translate(at, h / 2, mid);
    list.push(g);
    if (axis === 'z') colliders.push({ minX: a - WALL_T / 2, maxX: b + WALL_T / 2, minZ: at - WALL_T / 2, maxZ: at + WALL_T / 2 });
    else colliders.push({ minX: at - WALL_T / 2, maxX: at + WALL_T / 2, minZ: a - WALL_T / 2, maxZ: b + WALL_T / 2 });
  };
  for (const axis of ['x', 'z']) {
    for (const { at, iv } of lines.walls[axis].values()) {
      const segs = subtract(union(iv), gapsFor(axis, at));
      for (const [a, b] of segs) emit(axis, at, a, b, WALL_H, wallGeoms);
    }
    for (const [k, { at, iv }] of lines.fence[axis]) {
      const wallIv = lines.walls[axis].get(k)?.iv ?? [];
      const segs = subtract(subtract(union(iv), union(wallIv)), gapsFor(axis, at));
      for (const [a, b] of segs) emit(axis, at, a, b, 1.1, fenceGeoms);
    }
  }
  const wallGeo = mergeGeometries(wallGeoms);
  wallUV(wallGeo, WALL_H);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(WALL_H), roughness: 0.85 });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  scene.add(wallMesh);
  const fence = new THREE.Mesh(mergeGeometries(fenceGeoms), new THREE.MeshStandardMaterial({ color: 0x5a4532, roughness: 0.9 }));
  fence.castShadow = fence.receiveShadow = true;
  scene.add(fence);

  // door frames (wood posts + lintel); kept out of wallMesh so the camera doesn't snap under lintels
  const frameGeoms = [];
  for (const d of DOORS) {
    const inWall = [...lines.walls[d.a].values()].some((l) => Math.abs(l.at - d.at) < EPS);
    if (!inWall || d.w > 2.1) continue;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(d.a === 'x' ? WALL_T + 0.06 : 0.08, 2.15, d.a === 'x' ? 0.08 : WALL_T + 0.06);
      const c = d.c + side * (d.w / 2 + 0.04);
      if (d.a === 'x') g.translate(d.at, 1.075, c); else g.translate(c, 1.075, d.at);
      frameGeoms.push(g);
    }
    const l = new THREE.BoxGeometry(d.a === 'x' ? WALL_T + 0.06 : d.w + 0.16, WALL_H - 2.15, d.a === 'x' ? d.w + 0.16 : WALL_T + 0.06);
    if (d.a === 'x') l.translate(d.at, (WALL_H + 2.15) / 2, d.c); else l.translate(d.c, (WALL_H + 2.15) / 2, d.at);
    frameGeoms.push(l);
  }
  const frames = new THREE.Mesh(mergeGeometries(frameGeoms), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6 }));
  frames.castShadow = frames.receiveShadow = true;
  scene.add(frames);

  // ---------- floors, labels, blocked cores ----------
  const floorBuckets = new Map();
  for (const r of ROOMS) {
    if (r.type === 'blocked') {
      addBox(r.w - 0.2, WALL_H, r.d - 0.2, r.x + r.w / 2, WALL_H / 2, r.z + r.d / 2, 0x2b2a30, true);
      const l = makeLabel(r.name, 0.9);
      l.position.set(r.x + r.w / 2, WALL_H + 0.02, r.z + r.d / 2);
      l.material.color = new THREE.Color(3, 3, 3);
      scene.add(l);
      continue;
    }
    const g = new THREE.PlaneGeometry(r.w, r.d);
    g.rotateX(-Math.PI / 2);
    g.translate(r.x + r.w / 2, 0, r.z + r.d / 2);
    const key = `floor|${FLOOR_TEX[r.type] ?? 'tile'}|${FLOOR_COLORS[r.type] ?? 0xcccccc}`;
    if (!floorBuckets.has(key)) floorBuckets.set(key, []);
    floorBuckets.get(key).push(g);
    if (r.name) {
      const l = makeLabel(r.name, r.w < 5 ? 0.6 : 1);
      l.position.set(r.x + r.w / 2, 0.02, r.z + r.d / 2);
      scene.add(l);
    }
  }

  // ---------- beds ----------
  const beds = [];
  for (const r of ROOMS) {
    if (r.type !== 'bedroom' && r.type !== 'single') continue;
    const prefix = r.type === 'single' ? 'S' + r.id.slice(-1) : r.id.slice(-1);
    const rows = r.type === 'single' ? [{ n: r.beds, north: true }] : [{ n: r.beds / 2, north: true }, { n: r.beds / 2, north: false }];
    let num = 1;
    for (const row of rows) {
      const spacing = (r.w - 2) / row.n;
      for (let i = 0; i < row.n; i++) {
        const x = r.x + 1 + spacing * (i + 0.5);
        const z = row.north ? r.z + 1.15 : r.z + r.d - 1.15;
        beds.push({ id: `${prefix}-${num++}`, room: r.id, x, z, headDir: row.north ? -1 : 1, occupant: null });
      }
    }
  }
  // Hospital beds (instanced): base, mattress, folded blanket, pillow, head/foot boards, side rails
  const N = beds.length;
  const parts = {
    under: [new THREE.BoxGeometry(0.8, 0.28, 1.7), new THREE.MeshStandardMaterial({ color: 0x3d444b, roughness: 0.6, metalness: 0.3 }), N],
    base: [new THREE.BoxGeometry(0.98, 0.1, 2.02), new THREE.MeshStandardMaterial({ color: 0x9aa5ae, roughness: 0.45, metalness: 0.4 }), N],
    mattress: [new THREE.BoxGeometry(0.9, 0.16, 1.94), new THREE.MeshStandardMaterial({ color: 0xf1f2ee, roughness: 0.9 }), N],
    blanket: [new THREE.BoxGeometry(0.94, 0.06, 0.62), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), N],
    pillow: [new THREE.BoxGeometry(0.62, 0.11, 0.36), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), N],
    head: [new THREE.BoxGeometry(1.0, 0.72, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8cbb2, roughness: 0.55 }), N],
    foot: [new THREE.BoxGeometry(1.0, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8cbb2, roughness: 0.55 }), N],
    rail: [new THREE.BoxGeometry(0.04, 0.16, 0.95), new THREE.MeshStandardMaterial({ color: 0xc5ccd2, roughness: 0.3, metalness: 0.6 }), N * 2],
  };
  const inst = {};
  for (const [k, [geo, m, count]] of Object.entries(parts)) {
    inst[k] = new THREE.InstancedMesh(geo, m, count);
    inst[k].castShadow = inst[k].receiveShadow = true;
    scene.add(inst[k]);
  }
  const m4 = new THREE.Matrix4();
  const BLANKETS = [0x8fb0c9, 0xb9a6c9, 0x9cc0a6, 0xd9b38c, 0xc98f8f].map((c) => new THREE.Color(c));
  beds.forEach((b, i) => {
    const h = b.headDir;
    m4.makeTranslation(b.x, 0.2, b.z); inst.under.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.42, b.z); inst.base.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.55, b.z); inst.mattress.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.66, b.z - h * 0.6); inst.blanket.setMatrixAt(i, m4);
    inst.blanket.setColorAt(i, BLANKETS[i % BLANKETS.length]);
    m4.makeTranslation(b.x, 0.69, b.z + h * 0.74); inst.pillow.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.7, b.z + h * 1.0); inst.head.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.58, b.z - h * 1.0); inst.foot.setMatrixAt(i, m4);
    m4.makeTranslation(b.x - 0.47, 0.72, b.z + h * 0.35); inst.rail.setMatrixAt(i * 2, m4);
    m4.makeTranslation(b.x + 0.47, 0.72, b.z + h * 0.35); inst.rail.setMatrixAt(i * 2 + 1, m4);
    colliders.push({ minX: b.x - 0.5, maxX: b.x + 1.02, minZ: b.z - 1.03, maxZ: b.z + 1.03 });
  });

  // ---------- seats ----------
  const seats = [];
  for (const [room, list] of Object.entries(SEATS)) for (const st of list) seats.push({ ...st, room, occupant: null });

  // ---------- furniture & landmarks ----------
  // CCTV monitors on the Ward Manager's desk
  addBox(0.7, 0.45, 0.06, 39.6, 1.0, 41.25, 0x0d1013);
  addBox(0.7, 0.45, 0.06, 40.4, 1.0, 41.25, 0x0d1013);
  // Linen trolley (Bathroom)
  addBox(1.0, 0.08, 0.6, 19.6, 0.95, 29.6, 0x8aa6ba);
  addBox(0.96, 0.85, 0.56, 19.6, 0.5, 29.6, 0xd9e3ea, true);
  addBox(0.9, 0.12, 0.5, 19.6, 0.65, 29.6, 0xf6f6f2);
  // Treatment & medicine
  addBox(5.4, 0.9, 0.6, 29, 0.45, 42.5, 0xb8c7cc, true);
  addBox(5.5, 0.04, 0.66, 29, 0.92, 42.5, 0xe8e8e2);
  addBox(1.0, 0.6, 2.0, 27, 0.3, 39.5, 0x7d8a92, true);
  addBox(0.9, 0.12, 1.9, 27, 0.66, 39.5, 0x9fc3cf);
  addBox(3.6, 1.8, 0.5, 15, 0.9, 47.6, 0xdbe2e5, true);
  addBox(3.62, 0.06, 0.06, 15, 0.9, 47.33, 0x9aa3a8);
  // Therapy rooms: mats, parallel bars
  addBox(3.0, 0.06, 1.5, 12, 0.03, 41, 0x3f7f96);
  addBox(0.06, 0.06, 3.0, 15.0, 0.95, 41, 0xc0c6cc);
  addBox(0.06, 0.06, 3.0, 15.6, 0.95, 41, 0xc0c6cc);
  for (const pz of [39.6, 42.4]) for (const px of [15.0, 15.6]) addBox(0.05, 0.95, 0.05, px, 0.475, pz, 0x8f969c);
  addBox(3.0, 0.06, 1.5, 21.5, 0.03, 59, 0x3f7f96);
  // Garden: paths and trees
  const pave = pavingTexture();
  for (const [x0, x1, z0, z1] of [[3.6, 17, 50.2, 51.8], [7.2, 8.8, 51.8, 65.5], [2.5, 14.5, 62.4, 64.0]]) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
    planarUV(g, 1.6);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: pave, roughness: 0.95 }));
    m.receiveShadow = true;
    scene.add(m);
  }
  const leafGeoms = [];
  for (const [tx, tz] of [[3, 53], [13, 53], [5, 66], [14, 66]]) {
    addBox(0.3, 1.8, 0.3, tx, 0.9, tz, 0x4b3621, true);
    for (const [ox, oy, oz, r] of [[0, 2.4, 0, 1.1], [0.6, 2.0, 0.3, 0.8], [-0.5, 2.1, -0.3, 0.85], [0.1, 3.0, -0.1, 0.75]]) {
      const ico = new THREE.IcosahedronGeometry(r, 1);
      ico.translate(tx + ox, oy, tz + oz);
      leafGeoms.push(ico);
    }
  }
  const leaves = new THREE.Mesh(mergeGeometries(leafGeoms), new THREE.MeshStandardMaterial({ color: 0x3d5f30, roughness: 0.9, flatShading: true }));
  leaves.castShadow = leaves.receiveShadow = true;
  scene.add(leaves);

  const decor = decorate(scene, { colliders, beds, seats });

  for (const [color, geoms] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const texCache = {};
  const texFor = (t) => (texCache[t] ??= t === 'wood' ? woodTexture() : t === 'grass' ? grassTexture() : tileTexture());
  for (const [key, geoms] of floorBuckets) {
    const [, tex, color] = key.split('|');
    const g = mergeGeometries(geoms);
    planarUV(g, tex === 'grass' ? 4 : tex === 'wood' ? 3 : 2);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texFor(tex), color: Number(color), roughness: tex === 'grass' ? 1 : tex === 'wood' ? 0.55 : 0.4 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- navigation ----------
  const walkable = ROOMS.filter((r) => r.type !== 'blocked');
  const roomById = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
  const roomAt = (x, z) => walkable.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) ?? null;
  const center = (r) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });

  const links = new Map(walkable.map((r) => [r.id, []]));
  for (const d of DOORS) {
    const touching = walkable.filter((r) => {
      if (d.a === 'x') return (Math.abs(r.x - d.at) < EPS || Math.abs(r.x + r.w - d.at) < EPS) && d.c > r.z && d.c < r.z + r.d;
      return (Math.abs(r.z - d.at) < EPS || Math.abs(r.z + r.d - d.at) < EPS) && d.c > r.x && d.c < r.x + r.w;
    });
    if (touching.length !== 2) continue;
    const [r1, r2] = touching;
    const p = d.a === 'x' ? { x: d.at, z: d.c } : { x: d.c, z: d.at };
    const side = (r) => {
      const c = center(r);
      return d.a === 'x' ? { x: d.at + Math.sign(c.x - d.at) * 0.7, z: d.c } : { x: d.c, z: d.at + Math.sign(c.z - d.at) * 0.7 };
    };
    links.get(r1.id).push({ to: r2.id, from: side(r1), mid: p, into: side(r2) });
    links.get(r2.id).push({ to: r1.id, from: side(r2), mid: p, into: side(r1) });
  }

  function path(from, to) {
    const a = roomAt(from.x, from.z), b = roomAt(to.x, to.z);
    if (!a || !b) return [to];
    if (a.id === b.id) return [to];
    const prev = new Map([[a.id, null]]);
    const q = [a.id];
    while (q.length) {
      const id = q.shift();
      if (id === b.id) break;
      for (const l of links.get(id)) if (!prev.has(l.to)) { prev.set(l.to, { id, l }); q.push(l.to); }
    }
    if (!prev.has(b.id)) return [to];
    const hops = [];
    for (let id = b.id; prev.get(id); id = prev.get(id).id) hops.unshift(prev.get(id).l);
    const pts = [];
    let cur = a;
    for (const h of hops) {
      if (cur.type !== 'hall' || cur.id === 'corr') pts.push(center(cur));
      pts.push(h.from, h.into);
      cur = roomById[h.to];
    }
    pts.push(to);
    return pts;
  }

  const bounds = { minX: -1, maxX: 45, minZ: -1, maxZ: 69 };
  const inStation = (p) => p.x > STATION.inside.minX && p.x < STATION.inside.maxX && p.z > STATION.inside.minZ && p.z < STATION.inside.maxZ;
  const noWander = [STATION.outer];
  return { colliders, wallMesh, beds, seats, roomAt, roomById, center, path, bounds, rooms: ROOMS, station: STATION, inStation, noWander, decor };
}

export function resolveCollisions(pos, radius, colliders) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (pos.x < c.minX - radius || pos.x > c.maxX + radius || pos.z < c.minZ - radius || pos.z > c.maxZ + radius) continue;
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        const pen = [pos.x - c.minX + radius, c.maxX - pos.x + radius, pos.z - c.minZ + radius, c.maxZ - pos.z + radius];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) pos.x -= pen[0]; else if (i === 1) pos.x += pen[1]; else if (i === 2) pos.z -= pen[2]; else pos.z += pen[3];
      }
    }
  }
}
