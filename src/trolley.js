import * as THREE from 'three';
import { gesture } from './assets.js';
import { signTexture } from './textures.js';

export const TROLLEYS = {
  vitals: { label: 'TPR / BP trolley', room: 'treat', x: 29, z: 39.5, color: 0x8bb6c0 },
  med: { label: 'Medicine trolley', room: 'med', x: 15.4, z: 45.8, color: 0xa69bc3 },
};
export const MEAL_SPOT = { x: 13, z: 11.8, label: 'Meal trays — Living Area A dining tables' };

function trayMesh() {
  const g = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0xbdcbd0 }));
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0xf0e9d7 }));
  plate.position.y = 0.026;
  const food = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc3a16d }));
  food.scale.y = 0.3; food.position.y = 0.05;
  g.add(tray, plate, food);
  return g;
}

function trolleyMesh(kind) {
  const def = TROLLEYS[kind], g = new THREE.Group();
  g.name = `${kind}-trolley`;
  const metal = new THREE.MeshStandardMaterial({ color: 0xc2cbd0, roughness: 0.4, metalness: 0.4 });
  const body = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 });
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
  };
  for (const y of [0.25, 0.82]) box(0.56, 0.045, 0.44, 0, y, 0, metal);
  for (const x of [-0.24, 0.24]) {
    for (const z of [-0.17, 0.17]) {
      box(0.03, 0.64, 0.03, x, 0.48, z, metal);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 10), new THREE.MeshStandardMaterial({ color: 0x323940 }));
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.08, z); g.add(wheel);
    }
    box(0.025, 0.18, 0.025, x, 0.9, -0.2, metal);
  }
  box(0.5, 0.035, 0.035, 0, 0.99, -0.2, metal);
  if (kind === 'med') {
    box(0.47, 0.45, 0.36, 0, 0.54, 0, body);
    for (const y of [0.4, 0.55, 0.7]) box(0.12, 0.02, 0.025, 0, y, 0.19, metal);
    for (const x of [-0.15, 0.05]) box(0.13, 0.08, 0.12, x, 0.89, 0.03, body);
  } else {
    box(0.23, 0.23, 0.13, 0.09, 0.96, 0.04, body);
    box(0.16, 0.12, 0.012, 0.09, 0.98, 0.11, new THREE.MeshStandardMaterial({ color: 0x233b43, emissive: 0x162e36 }));
    box(0.15, 0.04, 0.18, -0.14, 0.87, 0, new THREE.MeshStandardMaterial({ color: 0x59677a }));
    box(0.4, 0.04, 0.3, 0, 0.3, 0, body);
  }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.12), new THREE.MeshStandardMaterial({ map: signTexture(def.label), side: THREE.DoubleSide }));
  label.position.set(0, 0.76, 0.23); g.add(label);
  return g;
}

export function createTrolleys({ s, scene, map, ui, dist, resolveCollisions }) {
  s.trolleys = Object.entries(TROLLEYS).map(([kind, def]) => {
    const mesh = trolleyMesh(kind);
    const t = { kind, label: def.label, home: { x: def.x, z: def.z }, pos: { x: def.x, z: def.z }, mesh, collider: {} };
    mesh.position.set(def.x, 0, def.z); scene.add(mesh);
    return t;
  });
  const mealSupply = trayMesh();
  mealSupply.position.set(MEAL_SPOT.x, 0.78, MEAL_SPOT.z);
  scene.add(mealSupply);
  const carriedTray = trayMesh();
  carriedTray.position.set(0, 1.0, 0.36); carriedTray.visible = false;
  s.player.mesh.add(carriedTray);

  function collider(t) {
    Object.assign(t.collider, { minX: t.pos.x - 0.28, maxX: t.pos.x + 0.28, minZ: t.pos.z - 0.23, maxZ: t.pos.z + 0.23 });
    if (!map.colliders.includes(t.collider)) map.colliders.push(t.collider);
  }
  s.trolleys.forEach(collider);
  function follow() {
    const t = s.pushingTrolley;
    if (!t) return true;
    const heading = s.player.heading || 0;
    const desired = { x: s.player.x + Math.sin(heading) * 0.78, z: s.player.z + Math.cos(heading) * 0.78 };
    const adjusted = { ...desired };
    resolveCollisions(adjusted, 0.28, map.colliders);
    if (dist(adjusted, desired) > 0.2 || dist(adjusted, s.player) < 0.5) return false;
    Object.assign(t.pos, adjusted);
    t.mesh.position.set(t.pos.x, 0, t.pos.z);
    t.mesh.rotation.y = heading;
    return true;
  }
  function park() {
    const t = s.pushingTrolley;
    if (!t) return;
    const home = dist(s.player, t.home) < 1.7;
    if (home) Object.assign(t.pos, t.home);
    t.mesh.position.set(t.pos.x, 0, t.pos.z);
    s.pushingTrolley = null; s.medicineRound = false;
    collider(t);
    ui.toast(`${t.label} ${home ? 'returned to its room' : 'parked'}.`);
  }
  function take(t) {
    if (!s.running || s.paused || s.escort || s.pushingChair || s.pushingTrolley || s.mealTray || dist(s.player, t.pos) > 1.8) return false;
    map.colliders.splice(map.colliders.indexOf(t.collider), 1);
    s.pushingTrolley = t; s.medicineRound = t.kind === 'med';
    s.player.heading = Math.atan2(t.pos.x - s.player.x, t.pos.z - s.player.z);
    follow();
    gesture(s.player.mesh, 'push', 1);
    ui.toast(`Pushing ${t.label}. Walk slowly; press E to park, or return near its home.`);
    return true;
  }
  function consumeTray() { s.mealTray = false; carriedTray.visible = false; }
  function reset() {
    s.pushingTrolley = null; s.medicineRound = false; consumeTray();
    for (const t of s.trolleys) {
      Object.assign(t.pos, t.home); t.mesh.position.set(t.pos.x, 0, t.pos.z); collider(t);
    }
  }
  function interactions() {
    const list = s.pushingTrolley ? [{
      d: 1.95, pos: s.player, kind: 'tap',
      label: `Park ${s.pushingTrolley.label}${dist(s.player, s.pushingTrolley.home) < 1.7 ? ' / return home' : ''}`,
      run: park,
    }] : s.trolleys.filter((t) => dist(s.player, t.pos) < 1.8).map((t) => ({
      d: dist(s.player, t.pos), pos: t.pos, kind: 'tap', label: `Push ${t.label}`, run: () => take(t),
    }));
    if (dist(s.player, MEAL_SPOT) < 1.7 && !s.pushingTrolley) list.push({
      d: dist(s.player, MEAL_SPOT), pos: MEAL_SPOT, kind: 'tap', label: s.mealTray ? 'Return meal tray' : 'Pick up a meal tray',
      run: () => {
        if (s.mealTray) consumeTray();
        else { s.mealTray = true; carriedTray.visible = true; gesture(s.player.mesh, 'pickup', 1.3); ui.toast('Meal tray ready for one assisted meal.'); }
      },
    });
    return list;
  }
  const nearby = (kind, r) => s.trolleys.some((t) => t.kind === kind && dist(t.pos, r.pos) < 3.4 &&
    map.roomAt(t.pos.x, t.pos.z)?.id === map.roomAt(r.pos.x, r.pos.z)?.id);
  return { take, park, follow, reset, interactions, nearby, consumeTray };
}
