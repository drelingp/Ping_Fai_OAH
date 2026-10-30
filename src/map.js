import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOMS, DOORS, SEATS, TABLES, WALL_H, WALL_T } from './data.js';

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
  bedroom: 0xcfc4ae, single: 0xb9a99a, living: 0xb7b09f, hall: 0xa7aeb0,
  staff: 0x9fb2a8, care: 0xbfcfd2, therapy: 0xb5b8a0, outdoor: 0x34502d,
};

function makeLabel(text, size = 1) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 512, 96);
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(40,36,32,0.55)';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
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
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe2dccf });
  const wallMesh = new THREE.Mesh(mergeGeometries(wallGeoms), wallMat);
  scene.add(wallMesh);
  scene.add(new THREE.Mesh(mergeGeometries(fenceGeoms), new THREE.MeshLambertMaterial({ color: 0x4a3b2c })));

  // ---------- floors, labels, blocked cores ----------
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
    const col = FLOOR_COLORS[r.type] ?? 0xaaaaaa;
    if (!buckets.has('floor' + col)) buckets.set('floor' + col, []);
    buckets.get('floor' + col).push(g);
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
  const bedGeo = {
    frame: new THREE.BoxGeometry(1.0, 0.45, 2.05),
    mattress: new THREE.BoxGeometry(0.92, 0.14, 1.9),
    pillow: new THREE.BoxGeometry(0.7, 0.1, 0.35),
    locker: new THREE.BoxGeometry(0.45, 0.75, 0.45),
  };
  const bedMats = {
    frame: new THREE.MeshLambertMaterial({ color: 0x8c9399 }),
    mattress: new THREE.MeshLambertMaterial({ color: 0xe9e6dc }),
    pillow: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    locker: new THREE.MeshLambertMaterial({ color: 0x9a7d5c }),
  };
  const inst = {};
  for (const k of Object.keys(bedGeo)) {
    inst[k] = new THREE.InstancedMesh(bedGeo[k], bedMats[k], beds.length);
    scene.add(inst[k]);
  }
  const m4 = new THREE.Matrix4();
  beds.forEach((b, i) => {
    m4.makeTranslation(b.x, 0.3, b.z); inst.frame.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.6, b.z); inst.mattress.setMatrixAt(i, m4);
    m4.makeTranslation(b.x, 0.72, b.z + b.headDir * 0.72); inst.pillow.setMatrixAt(i, m4);
    m4.makeTranslation(b.x + 0.78, 0.375, b.z + b.headDir * 0.7); inst.locker.setMatrixAt(i, m4);
    colliders.push({ minX: b.x - 0.5, maxX: b.x + 1.02, minZ: b.z - 1.03, maxZ: b.z + 1.03 });
  });

  // ---------- seats & tables ----------
  const seats = [];
  for (const [room, list] of Object.entries(SEATS)) {
    for (const s of list) {
      seats.push({ ...s, room, occupant: null });
      const fx = Math.sin(s.f), fz = Math.cos(s.f);
      const along = Math.abs(fz) > 0.5;
      addBox(0.55, 0.45, 0.55, s.x, 0.225, s.z, room === 'garden' ? 0x6b4a2e : 0x7a5a48);
      addBox(along ? 0.55 : 0.12, 0.6, along ? 0.12 : 0.55, s.x - fx * 0.24, 0.75, s.z - fz * 0.24, room === 'garden' ? 0x6b4a2e : 0x7a5a48);
    }
  }
  for (const t of TABLES) addBox(t.w, 0.75, t.d, t.x, 0.375, t.z, 0x8b6b4a, true);

  // ---------- furniture & landmarks ----------
  // Nurse station (Living Area B)
  addBox(0.6, 1.05, 3.5, 14.9, 0.525, 28.75, 0x6d7f8a, true);
  addBox(2.0, 1.05, 0.6, 15.6, 0.525, 30.8, 0x6d7f8a, true);
  addBox(0.5, 0.35, 0.08, 15.0, 1.25, 28.2, 0x111418);
  addBox(0.5, 0.35, 0.08, 15.0, 1.25, 29.4, 0x111418);
  // TV in Living Area A
  addBox(1.6, 0.9, 0.1, 13, 1.5, 0.2, 0x0c0c10);
  addBox(1.8, 0.5, 0.45, 13, 0.25, 0.4, 0x5c4636, true);
  // Bathroom: tub, linen trolley
  addBox(1.0, 0.6, 2.0, 24.6, 0.3, 31, 0xf2f2f2, true);
  addBox(1.0, 1.0, 0.6, 19.6, 0.5, 29.6, 0x9db7c9, true);
  // Toilets
  addBox(0.5, 0.45, 0.7, 10, 0.225, 18.5, 0xf4f4f4, true);
  addBox(0.5, 0.45, 0.7, 16, 0.225, 18.5, 0xf4f4f4, true);
  addBox(0.5, 0.45, 0.7, 35, 0.225, 41.5, 0xf4f4f4, true);
  // Office desk & CCTV
  addBox(2.0, 0.75, 0.8, 40, 0.375, 41.4, 0x5a4636, true);
  addBox(0.7, 0.45, 0.08, 39.6, 1.0, 41.3, 0x0d1013);
  addBox(0.7, 0.45, 0.08, 40.4, 1.0, 41.3, 0x0d1013);
  addBox(1.2, 1.8, 0.5, 43.3, 0.9, 38.5, 0x75664f, true);
  // Treatment & medicine
  addBox(5.4, 0.9, 0.6, 29, 0.45, 42.5, 0xb8c7cc, true);
  addBox(1.0, 0.7, 2.0, 27, 0.35, 39.5, 0xdfe4e6, true);
  addBox(3.6, 1.8, 0.5, 15, 0.9, 47.6, 0xdbe2e5, true);
  // Consultation & visiting
  addBox(1.4, 0.75, 1.0, 29, 0.375, 28.5, 0x7d6450, true);
  addBox(3.0, 0.7, 0.9, 35, 0.35, 26, 0x6c5a7a, true);
  // Therapy rooms
  addBox(3.0, 0.08, 1.5, 12, 0.04, 41, 0x4f7a8a);
  addBox(0.08, 0.95, 3.0, 15.2, 0.9, 41, 0xbfbfbf);
  addBox(3.0, 0.08, 1.5, 21.5, 0.04, 59, 0x4f7a8a);
  // Garden trees
  for (const [tx, tz] of [[3, 51], [13, 53], [6, 65], [14, 66]]) {
    addBox(0.35, 1.6, 0.35, tx, 0.8, tz, 0x4b3621, true);
    const cone = new THREE.ConeGeometry(1.3, 2.4, 6);
    cone.translate(tx, 2.6, tz);
    if (!buckets.has(0x2c4a2a)) buckets.set(0x2c4a2a, []);
    buckets.get(0x2c4a2a).push(cone);
  }
  // Halloween decorations put up by staff
  const pumpkins = [[16.3, 1], [9.7, 1], [15.6, 30.8], [25.4, 47], [8, 50]];
  for (const [px, pz] of pumpkins) {
    const s = new THREE.SphereGeometry(0.22, 8, 6);
    s.scale(1, 0.8, 1);
    s.translate(px, pz === 30.8 ? 1.22 : 0.18, pz);
    if (!buckets.has(0xd8661c)) buckets.set(0xd8661c, []);
    buckets.get(0xd8661c).push(s);
  }

  for (const [key, geoms] of buckets) {
    const color = typeof key === 'string' ? Number(key.slice(5)) : key;
    const mesh = new THREE.Mesh(mergeGeometries(geoms), new THREE.MeshLambertMaterial({ color }));
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
  return { colliders, wallMesh, beds, seats, roomAt, roomById, center, path, bounds, rooms: ROOMS };
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
