// Room furnishing, Halloween props and the walk-in nurse station.
// Everything static is merged per material afterwards (see batch()) to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { model } from './assets.js';
import { ROOMS, DOORS, SEATS, TABLES } from './data.js';
import { laminateTexture, signTexture } from './textures.js';

const PI = Math.PI;

// Nurse station (Living Area B): U-shaped counter open to the west, walk-in gap in the front counter.
export const STATION = {
  inside: { minX: 14.4, maxX: 16.9, minZ: 26.6, maxZ: 29.6 },
  outer: { minX: 13.9, maxX: 16.9, minZ: 26.1, maxZ: 30.1 },
  entryOut: { x: 13.3, z: 28.25 },
  entryIn: { x: 14.95, z: 28.25 },
  records: { x: 15.4, z: 28.25 },
  spots: [{ x: 15.0, z: 27.45 }, { x: 15.7, z: 29.05 }, { x: 15.1, z: 28.95 }],
};

export function decorate(scene, { colliders, beds, seats, chairParkingObstacles = [] }) {
  const items = [];
  const matCache = new Map();
  const std = (color, opts = {}) => {
    const k = color + JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
    return matCache.get(k);
  };
  const collide = (x, z, w, d, pad = 0) => colliders.push({ minX: x - w / 2 - pad, maxX: x + w / 2 + pad, minZ: z - d / 2 - pad, maxZ: z + d / 2 + pad });

  // size: uniform scale, or [w, h, d] target size in metres before rotation
  function place(key, x, z, f = 0, size = 2, { y = 0, solid = false, pad = 0 } = {}) {
    const g = model(key, 1);
    if (!g) return null;
    const sz = g.userData.size;
    if (Array.isArray(size)) g.scale.set(size[0] / sz.x, size[1] / sz.y, size[2] / sz.z);
    else g.scale.setScalar(size);
    g.position.set(x, y, z);
    g.rotation.y = f;
    items.push(g);
    // Chair-only clearance metadata; keep existing foot-traffic collisions unchanged.
    if (y === 0 && /^(?:furn:(?:chair|loungeChair)|hw:bench)/.test(key)) {
      const bounds = new THREE.Box3().setFromObject(g);
      g.userData.footprint = { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z };
      chairParkingObstacles.push(g.userData.footprint);
    }
    if (solid) {
      const w = sz.x * g.scale.x, d = sz.z * g.scale.z;
      const swap = Math.abs(Math.sin(f)) > 0.5;
      collide(x, z, swap ? d : w, swap ? w : d, pad);
    }
    return g;
  }
  function box(w, h, d, x, y, z, mat, solid = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    items.push(m);
    if (solid) collide(x, z, w, d);
    return m;
  }
  function sign(text, x, y, z, f = 0, w = 1.0, h = 0.3) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.8, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.y = f;
    scene.add(m);
  }
  const doorOf = (r) => DOORS.find((d) => d.a === 'x' && (Math.abs(d.at - r.x) < 1e-3 || Math.abs(d.at - r.x - r.w) < 1e-3) && d.c > r.z && d.c < r.z + r.d);

  // ---------- bedside lockers, wall lamps, bedroom extras ----------
  for (const b of beds) {
    place('furn:cabinetBedDrawerTable', b.x + 0.78, b.z + b.headDir * 0.7, b.headDir === -1 ? 0 : PI, [0.46, 0.72, 0.42]);
    place('furn:lampWall', b.x, b.z + b.headDir * 1.06, b.headDir === -1 ? 0 : PI, [0.32, 0.14, 0.2], { y: 1.45 });
    box(0.035, 0.035, 2.25, b.x + 0.72, 2.55, b.z, std(0xaeb7bb, { metalness: 0.5, roughness: 0.4 }));
    box(1.45, 0.035, 0.035, b.x, 2.55, b.z - b.headDir * 1.1, std(0xaeb7bb, { metalness: 0.5, roughness: 0.4 }));
  }
  const windowMat = std(0x96bfd3, { emissive: 0x53798e, emissiveIntensity: 0.25, roughness: 0.2 });
  const fixture = std(0xeef3f0, { emissive: 0xcbe0ef, emissiveIntensity: 1.3 });
  for (const r of ROOMS) {
    if (r.type === 'blocked' || r.type === 'outdoor') continue;
    const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    box(0.95, 0.055, 0.45, cx, 2.72, cz, fixture);
    if (r.d > 8) box(0.95, 0.055, 0.45, cx, 2.72, cz + r.d * 0.28, fixture);
    if (r.x === 0) {
      box(0.04, 0.85, 2.3, 0.12, 1.9, cz, windowMat);
      box(0.06, 0.9, 0.04, 0.15, 1.9, cz, std(0xffffff));
      box(0.06, 0.04, 2.35, 0.15, 1.47, cz, std(0xffffff));
    }
    if (r.type === 'bedroom') {
      const door = doorOf(r);
      const east = Math.abs(door.at - (r.x + r.w)) < 1e-3;
      sign(r.name, east ? r.x + r.w - 0.12 : r.x + 0.12, 2.12, door.c - 1.35, east ? -PI / 2 : PI / 2, 0.9, 0.22);
      box(0.035, 1.9, 0.035, cx, 0.95, cz + 1.1, std(0xbfc8cc, { metalness: 0.5 }));
      box(0.38, 0.035, 0.035, cx, 1.88, cz + 1.1, std(0xbfc8cc, { metalness: 0.5 }));
    }
  }
  for (const r of ROOMS) {
    if (r.type !== 'bedroom' && r.type !== 'single') continue;
    const door = doorOf(r);
    const east = door && Math.abs(door.at - (r.x + r.w)) < 1e-3;
    const farX = east ? r.x + 0.5 : r.x + r.w - 0.5;
    if (r.type === 'bedroom') {
      place('furn:pottedPlant', farX, r.z + r.d / 2 - 0.9, 0, 1.5, { solid: true });
      place('furn:trashcan', east ? r.x + r.w - 0.35 : r.x + 0.35, door.c - 1.4, east ? -PI / 2 : PI / 2, [0.35, 0.6, 0.35]);
      if (['bed2', 'bed5', 'bed6'].includes(r.id)) place('x:wheelchair', farX + (east ? 0.35 : -0.35), r.z + r.d / 2 + 0.6, east ? PI / 2 : -PI / 2, [0.62, 0.92, 0.85], { solid: true });
    } else {
      const z2 = r.z + r.d;
      place('furn:loungeChairRelax', r.x + 1.1, z2 - 0.85, PI / 2 + 0.3, [0.75, 0.95, 1.0], { solid: true });
      place('furn:sideTable', r.x + 3.0, z2 - 0.35, PI, [0.8, 0.6, 0.36], { solid: true });
      place('furn:radio', r.x + 2.8, z2 - 0.35, PI, [0.32, 0.22, 0.1], { y: 0.6 });
      place('furn:plantSmall2', r.x + 3.3, z2 - 0.35, 0, 2, { y: 0.6 });
      place('furn:bookcaseOpen', r.x + 5.0, z2 - 0.3, PI, [0.8, 1.5, 0.38], { solid: true });
      place('furn:books', r.x + 5.0, z2 - 0.3, PI, 1.6, { y: 0.78 });
      place('furn:pottedPlant', r.x + r.w - 0.5, z2 - 0.5, 0, 1.3, { solid: true });
    }
  }

  // ---------- seats & tables ----------
  for (const s of seats) {
    let furniture;
    if (s.room === 'garden') furniture = place('hw:bench', s.x - Math.sin(s.f) * 0.1, s.z - Math.cos(s.f) * 0.1, s.f, [1.3, 0.48, 0.55]);
    else if (s.room === 'livA') furniture = place('furn:loungeChair', s.x - Math.sin(s.f) * 0.12, s.z - Math.cos(s.f) * 0.12, s.f, [0.72, 0.7, 0.66]);
    else furniture = place('furn:chairCushion', s.x - Math.sin(s.f) * 0.08, s.z - Math.cos(s.f) * 0.08, s.f, [0.5, 0.95, 0.5]);
    if (furniture) {
      s.footprint = furniture.userData.footprint;
    }
  }
  for (const t of TABLES) {
    place('furn:table', t.x, t.z, PI / 2, [t.d, 0.75, t.w]);
    collide(t.x, t.z, t.w, t.d);
    place('furn:rugRounded', t.x + 0.2, t.z, PI / 2, [3.0, 0.02, 2.6], { y: 0.003 });
  }

  // ---------- Living Area A: TV lounge + dining ----------
  place('furn:cabinetTelevision', 13, 0.35, 0, [1.8, 0.5, 0.45], { solid: true });
  place('furn:rugRectangle', 13, 4.8, 0, [5.2, 0.02, 3.0], { y: 0.003 });
  place('furn:tableCoffee', 13, 2.3, 0, [1.2, 0.4, 0.6], { solid: true });
  place('furn:bookcaseOpen', 9.32, 2.5, PI / 2, [0.9, 1.7, 0.4], { solid: true });
  place('furn:bookcaseOpen', 16.68, 2.5, -PI / 2, [0.9, 1.7, 0.4], { solid: true });
  place('furn:pottedPlant', 9.5, 6.8, 0, 1.6, { solid: true });
  place('furn:pottedPlant', 16.5, 6.8, 0, 1.6, { solid: true });
  place('furn:lampRoundFloor', 16.5, 5.4, 0, 1.9);
  for (const tx of [11, 15]) {
    const tz = 10.6;
    place('furn:tableRound', tx, tz, 0, [1.1, 0.75, 1.1], { solid: true });
    place('furn:chair', tx - 0.8, tz, PI / 2, [0.45, 0.95, 0.45]);
    place('furn:chair', tx + 0.8, tz, -PI / 2, [0.45, 0.95, 0.45]);
    place('furn:chair', tx, tz - 0.8, 0, [0.45, 0.95, 0.45]);
    place('furn:chair', tx, tz + 0.8, PI, [0.45, 0.95, 0.45]);
  }

  // ---------- Living Area B (+ nurse station) ----------
  place('furn:bookcaseOpen', 9.32, 28.3, PI / 2, [0.9, 1.7, 0.4], { solid: true });
  place('furn:pottedPlant', 16.5, 20.6, 0, 1.6, { solid: true });
  place('x:wheelchair', 9.8, 20.8, PI / 2, [0.62, 0.92, 0.85], { solid: true });
  place('furn:sideTableDrawers', 12.5, 36.75, PI, [1.0, 0.7, 0.4], { solid: true });
  place('furn:televisionVintage', 12.5, 36.75, PI, [0.6, 0.42, 0.4], { y: 0.7 });
  place('furn:lampRoundFloor', 9.5, 36.5, 0, 1.9);

  const counterMat = std(0x5f7482, { roughness: 0.6 });
  const lam = laminateTexture();
  const topMat = new THREE.MeshStandardMaterial({ map: lam, roughness: 0.45 });
  const st = STATION;
  const counter = (x0, x1, z0, z1) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, 0.98, d, cx, 0.49, cz, counterMat, true);
    box(w + 0.06, 0.05, d + 0.06, cx, 1.005, cz, topMat);
  };
  counter(13.9, 14.4, 26.1, 27.6);
  counter(13.9, 14.4, 28.9, 30.1);
  counter(14.4, 16.9, 26.1, 26.6);
  counter(14.4, 16.9, 29.6, 30.1);
  // raised transaction ledge on the outer face of the front counter
  box(0.22, 0.05, 1.2, 13.86, 1.18, 27.0, topMat);
  box(0.22, 0.05, 1.2, 13.86, 1.18, 29.5, topMat);
  box(0.06, 0.18, 1.2, 13.96, 1.08, 27.0, counterMat);
  box(0.06, 0.18, 1.2, 13.96, 1.08, 29.5, counterMat);
  place('furn:computerScreen', 15.2, 26.32, 0, [0.55, 0.42, 0.15], { y: 1.03 });
  place('furn:computerKeyboard', 15.2, 26.5, 0, [0.42, 0.04, 0.16], { y: 1.03 });
  place('furn:computerScreen', 16.1, 29.82, PI, [0.55, 0.42, 0.15], { y: 1.03 });
  place('furn:computerKeyboard', 16.1, 29.64, PI, [0.42, 0.04, 0.16], { y: 1.03 });
  place('furn:laptop', 14.15, 29.5, -PI / 2, [0.36, 0.22, 0.32], { y: 1.03 });
  place('furn:books', 15.9, 26.3, 0, 1.4, { y: 1.03 });
  place('furn:books', 14.15, 27.1, PI / 2, 1.4, { y: 1.03 });
  place('furn:kitchenCoffeeMachine', 16.6, 26.3, 0, [0.28, 0.3, 0.32], { y: 1.03 });
  place('furn:chairDesk', 15.0, 27.35, PI, [0.55, 1.0, 0.52]);
  place('furn:chairDesk', 15.9, 29.15, 0, [0.55, 1.0, 0.52]);
  place('furn:bookcaseClosedWide', 16.66, 28.25, -PI / 2, [1.5, 1.45, 0.42], { solid: true });
  place('hw:pumpkin_orange_jackolantern', 14.15, 26.35, 0.6, 0.18, { y: 1.03 });
  place('hw:candle_triple', 14.15, 29.95, 0, 0.35, { y: 1.03 });
  // hanging sign over the entrance
  const stationSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), new THREE.MeshStandardMaterial({ map: signTexture('NURSE STATION'), side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.25 }));
  stationSign.material.emissiveMap = stationSign.material.map;
  stationSign.position.set(13.85, 2.3, 28.25);
  stationSign.rotation.y = -PI / 2;
  scene.add(stationSign);
  // Phone and file trays (the movable medicine trolley is in the Medicine Room).
  box(0.2, 0.04, 0.14, 15.4, 1.05, 29.85, std(0x22272c));
  box(0.22, 0.05, 0.05, 15.4, 1.1, 29.85, std(0x161a1e));
  box(0.3, 0.04, 0.23, 14.15, 1.05, 29.15, std(0x778ba0));
  box(0.26, 0.02, 0.19, 14.15, 1.08, 29.15, std(0xf0eee7));
  sign('ROOM ALLOCATION', 16.42, 2.15, 28.25, -PI / 2, 1.25, 0.35);
  place('furn:lampRoundTable', 16.65, 29.8, PI, [0.2, 0.45, 0.24], { y: 1.03 });

  // ---------- Living Area C ----------
  place('furn:cabinetTelevision', 24.3, 55.72, PI, [1.6, 0.5, 0.45], { solid: true });
  place('furn:televisionModern', 24.3, 55.75, PI, [1.3, 0.8, 0.12], { y: 0.5 });
  place('furn:bookcaseOpen', 18.6, 55.7, PI, [0.9, 1.7, 0.4], { solid: true });
  place('furn:pottedPlant', 25.5, 47.2, 0, 1.6, { solid: true });
  place('furn:pottedPlant', 17.5, 47.2, 0, 1.6, { solid: true });
  place('furn:lampRoundFloor', 25.5, 51.5, 0, 1.9);

  // ---------- garden ----------
  place('hw:tree_dead_medium', 11, 59, 0.4, 0.8);
  collide(11, 59, 0.4, 0.4);
  place('hw:lantern_standing', 16.2, 49.3, 0, 0.6);
  place('hw:lantern_standing', 5.3, 56.3, 0, 0.6);
  place('hw:pumpkin_orange', 4.6, 55.3, 0.3, 0.35);
  place('hw:pumpkin_yellow_small', 3.2, 55.4, 1.1, 0.4);
  place('hw:pumpkin_orange_jackolantern', 8, 50, 0, 0.32);

  // ---------- bathroom & toilets ----------
  place('furn:bathtub', 24.6, 31, PI / 2, [2.0, 0.6, 0.95]);
  collide(24.6, 31, 1.0, 2.0);
  place('furn:bathroomSink', 21.5, 29.35, 0, [0.6, 0.95, 0.5], { solid: true });
  place('furn:bathroomMirror', 21.5, 29.14, 0, [0.55, 0.7, 0.08], { y: 1.15 });
  place('furn:bathroomCabinet', 23.2, 29.15, 0, [0.5, 0.75, 0.25], { y: 1.2 });
  place('furn:washer', 17.55, 32.5, PI / 2, [0.7, 0.85, 0.7], { solid: true });
  place('furn:chair', 23.5, 31.6, PI / 2, [0.45, 0.9, 0.45]);
  place('furn:shower', 25.2, 29.8, -PI / 2, [0.8, 1.9, 0.8], { solid: true });
  box(0.06, 0.05, 1.3, 25.8, 1.0, 31, std(0xbcc6ce, { metalness: 0.5 }));
  box(0.06, 1.65, 0.06, 22.8, 0.825, 32.3, std(0xbcc6ce, { metalness: 0.5 }));
  box(0.9, 0.06, 0.06, 23.2, 1.6, 32.3, std(0xbcc6ce, { metalness: 0.5 }));
  for (const [x, z, f] of [[9.5, 18.5, PI / 2], [16.5, 18.5, -PI / 2], [35, 42.55, PI]]) {
    place('furn:toilet', x, z, f, [0.5, 0.78, 0.7]);
    collide(x, z, Math.abs(Math.sin(f)) > 0.5 ? 0.7 : 0.5, Math.abs(Math.sin(f)) > 0.5 ? 0.5 : 0.7);
  }
  place('furn:bathroomSink', 10.9, 17.3, 0, [0.5, 0.9, 0.42], { solid: true });
  place('furn:bathroomSink', 15.1, 17.3, 0, [0.5, 0.9, 0.42], { solid: true });
  place('furn:bathroomSink', 32.35, 39.5, PI / 2, [0.5, 0.9, 0.42], { solid: true });

  // ---------- staff rooms ----------
  place('furn:desk', 40, 41.4, PI, [2.0, 0.76, 0.8]);
  collide(40, 41.4, 2.0, 0.8);
  place('furn:chairDesk', 40, 42.35, PI, [0.6, 1.05, 0.55]);
  place('furn:bookcaseClosedWide', 43.68, 39.3, -PI / 2, [1.4, 1.8, 0.45], { solid: true });
  place('furn:pottedPlant', 36.5, 42.4, 0, 1.6, { solid: true });
  place('furn:coatRackStanding', 36.5, 37.7, 0, 1.9);
  place('furn:lampRoundFloor', 43.5, 42.5, 0, 1.9);
  place('furn:sideTableDrawers', 31.5, 40, -PI / 2, [0.8, 0.9, 0.45], { solid: true });
  place('furn:trashcan', 31.6, 37.6, 0, [0.35, 0.6, 0.35]);
  place('furn:bathroomSink', 31.6, 41.2, -PI / 2, [0.5, 0.9, 0.42], { solid: true });
  box(0.18, 0.22, 0.18, 30.7, 1.05, 42.4, std(0xdfb333));
  place('furn:kitchenFridgeSmall', 13.35, 45.0, PI / 2, [0.7, 1.1, 0.55], { solid: true });
  place('furn:table', 29, 28.5, 0, [1.4, 0.75, 1.0]);
  collide(29, 28.5, 1.4, 1.0);
  place('furn:chairCushion', 28.0, 28.5, PI / 2, [0.48, 0.95, 0.48]);
  place('furn:chairCushion', 30.0, 28.5, -PI / 2, [0.48, 0.95, 0.48]);
  place('furn:bookcaseClosedWide', 29, 25.3, 0, [1.6, 1.5, 0.42], { solid: true });
  place('furn:pottedPlant', 31.5, 32.4, 0, 1.5, { solid: true });
  place('furn:pottedPlant', 26.5, 25.5, 0, 1.5, { solid: true });
  place('furn:loungeSofa', 35, 25.6, 0, [2.6, 0.85, 0.85], { solid: true });
  place('furn:tableCoffee', 35, 27.4, 0, [1.1, 0.4, 0.6], { solid: true });
  place('furn:loungeChair', 37.2, 27.6, -PI / 2, [0.8, 0.8, 0.75], { solid: true });
  place('furn:loungeChair', 32.8, 27.6, PI / 2, [0.8, 0.8, 0.75], { solid: true });
  place('furn:rugRound', 35, 27.4, 0, [2.6, 0.02, 2.6], { y: 0.003 });
  place('furn:pottedPlant', 37.5, 32.5, 0, 1.5, { solid: true });
  place('furn:lampRoundFloor', 32.5, 25.5, 0, 1.9);

  // ---------- therapy rooms & corridors ----------
  place('furn:bookcaseOpen', 9.32, 39.5, PI / 2, [0.9, 1.7, 0.4], { solid: true });
  place('furn:cardboardBoxClosed', 9.6, 43.4, 0.3, 1.4);
  place('furn:pottedPlant', 16.5, 43.4, 0, 1.5, { solid: true });
  place('furn:tableRound', 24, 60.2, 0, [1.1, 0.75, 1.1], { solid: true });
  place('furn:chair', 23.2, 60.2, PI / 2, [0.45, 0.95, 0.45]);
  place('furn:chair', 24.8, 60.2, -PI / 2, [0.45, 0.95, 0.45]);
  box(0.12, 0.9, 0.12, 18.8, 0.45, 58.2, std(0x738993));
  box(0.7, 0.055, 0.055, 18.8, 0.9, 58.2, std(0x33434a));
  box(0.4, 0.08, 0.3, 18.8, 0.72, 58.8, std(0x33434a));
  box(0.45, 0.4, 0.7, 18.8, 0.2, 58.5, std(0xa7b5bc), true);
  place('furn:bookcaseOpen', 18.0, 61.7, PI, [0.9, 1.7, 0.4], { solid: true });
  place('furn:pottedPlant', 25.5, 56.6, 0, 1.5, { solid: true });
  place('furn:bench', 38.5, 33.35, 0, [1.4, 0.5, 0.45], { solid: true });
  place('furn:pottedPlant', 43.5, 33.5, 0, 1.6, { solid: true });
  place('furn:pottedPlant', 43.5, 36.5, 0, 1.6, { solid: true });
  place('furn:trashcan', 26.4, 33.35, 0, [0.35, 0.6, 0.35]);
  place('furn:bench', 25.7, 41.5, -PI / 2, [1.4, 0.5, 0.45], { solid: true });
  place('furn:pottedPlant', 25.5, 45.4, 0, 1.5, { solid: true });
  box(0.18, 0.5, 0.18, 26.2, 0.8, 34.2, std(0xc23a32));
  sign('EXIT →', 17.12, 2.25, 35, PI / 2, 0.9, 0.22);
  sign('VISITING HOURS', 37.85, 1.8, 30.5, -PI / 2, 1.0, 0.6);
  sign('WARD NOTICEBOARD', 43.85, 1.9, 40.6, -PI / 2, 1.6, 0.8);
  sign('OCTOBER 31', 9.12, 1.8, 22.1, PI / 2, 0.6, 0.7);

  // ---------- Halloween decorations put up by staff ----------
  place('hw:pumpkin_orange_jackolantern', 15.2, 0.5, -0.3, 0.3);
  place('hw:pumpkin_orange_jackolantern', 10.8, 0.5, 0.3, 0.3);
  place('hw:pumpkin_yellow_small', 11.4, 0.45, 0, 0.35);
  place('hw:pumpkin_orange_jackolantern', 25.4, 47, -0.8, 0.3);
  place('hw:pumpkin_orange', 22.6, 36.6, 0, 0.3);
  place('hw:lantern_standing', 43.4, 34.9, 0, 0.5);
  scene.add(bunting([[9.3, 0.15], [16.7, 0.15]], 2.35));
  scene.add(bunting([[9.15, 20.3], [9.15, 36.7]], 2.35));
  scene.add(bunting([[17.3, 55.85], [25.7, 55.85]], 2.35));
  scene.add(bunting([[26.2, 33.15], [37.8, 33.15]], 2.35));

  // fixtures with their own (emissive) material — not batched
  const tv = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x23384a, emissiveIntensity: 0.9, roughness: 0.2 }));
  tv.position.set(13, 1.5, 0.15);
  scene.add(tv);

  return batch(scene, items);
}

// Triangle-flag bunting with a sagging string between wall points.
function bunting(pts, y) {
  const [a, b] = pts;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / 0.32);
  const pos = [], col = [];
  const colors = [new THREE.Color(0xe0701e), new THREE.Color(0x1c1a1f), new THREE.Color(0x7d4fa0)];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 0.8) / n, tm = (t0 + t1) / 2;
    const sag = (t) => -0.25 * Math.sin(Math.PI * t);
    const P = (t, dy) => [a[0] + (b[0] - a[0]) * t, y + sag(t) + dy, a[1] + (b[1] - a[1]) * t];
    pos.push(...P(t0, 0), ...P(t1, 0), ...P(tm, -0.22));
    const c = colors[i % 3];
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }));
  m.castShadow = true;
  return m;
}

// Merge static meshes by material and 12 m cell so off-screen furniture can be culled.
function toFloat(geo) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = geo.attributes[name];
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (geo.index) out.setIndex(Array.from(geo.index.array));
  else out.setIndex([...Array(geo.attributes.position.count).keys()]);
  return out;
}
function batch(scene, items) {
  const root = new THREE.Group();
  items.forEach((i) => root.add(i));
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const p = o.getWorldPosition(new THREE.Vector3());
    const key = `${Math.floor(p.x / 12)},${Math.floor(p.z / 12)}|${m.type}|${m.color?.getHexString()}|${m.map?.uuid ?? ''}|${m.roughness}|${m.metalness}|${m.vertexColors}|${m.transparent}`;
    if (!groups.has(key)) groups.set(key, { mat: m, geos: [] });
    const g = toFloat(o.geometry);
    g.applyMatrix4(o.matrixWorld);
    groups.get(key).geos.push(g);
  });
  let meshes = 0;
  for (const { mat, geos } of groups.values()) {
    const names = ['position', 'normal', 'uv', 'color'].filter((n) => geos.every((g) => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const merged = mergeGeometries(geos);
    if (!merged) throw new Error('Unable to batch room furniture geometries.');
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    meshes++;
  }
  return { meshes };
}
