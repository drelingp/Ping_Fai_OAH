import * as THREE from 'three';
import { character } from './assets.js';

const geo = {
  body: new THREE.CapsuleGeometry(0.26, 0.8, 3, 8),
  head: new THREE.SphereGeometry(0.19, 10, 8),
  hair: new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  nose: new THREE.BoxGeometry(0.08, 0.06, 0.1),
  cap: new THREE.BoxGeometry(0.26, 0.07, 0.2),
  strap: new THREE.BoxGeometry(0.12, 0.06, 0.22),
  bag: new THREE.BoxGeometry(0.22, 0.3, 0.06),
};
const mats = new Map();
const mat = (c) => {
  if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return mats.get(c);
};

const SKIN = [0xe0b48f, 0xd2a07a, 0xc89470, 0xe6c3a0];

export function makePerson({ body, hair = 0x2a2420, skin = SKIN[0], cap = false }) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(geo.body, mat(body));
  b.position.y = 0.66;
  const h = new THREE.Mesh(geo.head, mat(skin));
  h.position.y = 1.36;
  const hr = new THREE.Mesh(geo.hair, mat(hair));
  hr.position.y = 1.38;
  hr.rotation.x = -0.25;
  const n = new THREE.Mesh(geo.nose, mat(skin));
  n.position.set(0, 1.34, 0.18);
  g.add(b, h, hr, n);
  if (cap) {
    const c = new THREE.Mesh(geo.cap, mat(0xffffff));
    c.position.set(0, 1.56, 0.02);
    g.add(c);
  }
  return g;
}

const SKIN_TONES = [0xd9a982, 0xc8936b, 0xe3b893, 0xb98460];

export function makeResident(r) {
  const gown = [0x9fb8c8, 0xa9c4b0, 0xc3b5cf, 0xb8c4cf][r.seed % 4];
  const hair = [0xcfcfcf, 0xb5b5b5, 0xe2e2e2, 0x8f8f8f][(r.seed >> 2) % 4];
  const skin = SKIN_TONES[(r.seed >> 4) % SKIN_TONES.length];
  const g = character('human', {
    skin, hair, top: gown, trim: 0xdde4ea, bottom: 0x8d9aa8, shoe: 0x6a5c50, hem: 0.5, sleeve: 0.36,
    bald: (r.seed >> 3) % 3 === 0 ? 1 : 0, height: 1.55 + ((r.seed >> 5) % 3) * 0.04,
  });
  return g || makePerson({ body: gown, hair, skin: SKIN[(r.seed >> 4) % SKIN.length] });
}

// Every nurse (staff, agency and the player) wears the same blue-purple scrubs, no hat.
export const SCRUB = { top: 0x5b5fb8, trim: 0x8c8fe0, bottom: 0x4a4e9e, shoe: 0xeeeeee };
const NURSE_HAIR = [0x1d1a18, 0x2b211b, 0x15120f, 0x3a2a20];

export function makeNurse(seed = 0) {
  const k = typeof seed === 'number' ? seed : 0;
  const g = character('human', {
    skin: SKIN_TONES[k % SKIN_TONES.length], hair: NURSE_HAIR[(k >> 2) % NURSE_HAIR.length], ...SCRUB, hem: 0.88, sleeve: 0.3,
    badge: 0xe8e8f4, height: 1.58 + (k % 3) * 0.02,
  });
  return g || makePerson({ body: SCRUB.top, hair: 0x1d1a18, skin: SKIN[1] });
}

export function makePlayer() {
  const g = character('human', {
    skin: SKIN_TONES[2], hair: 0x15120f, ...SCRUB, hem: 0.88, sleeve: 0.3,
    badge: 0xd6b25a, height: 1.66,
  });
  return g || makePerson({ body: SCRUB.top, hair: 0x15120f, skin: SKIN[2] });
}

// Bed props stay in world space; cuffs track the rig without moving its bones.
export function makeRestraintProps(bed, person) {
  const g = new THREE.Group();
  g.name = 'bed-restraints';
  if (!bed) return g;
  g.position.set(bed.x, 0, bed.z);
  const padded = new THREE.MeshStandardMaterial({ color: 0xe0d4af, roughness: 0.95 });
  const webbing = new THREE.MeshStandardMaterial({ color: 0xb9a478, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5ccd2, roughness: 0.35, metalness: 0.55 });
  const marks = new THREE.MeshStandardMaterial({ color: 0xd59683, roughness: 1 });
  const box = (w, h, d, x, y, z, material, name) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    for (const y of [0.87, 1.12]) box(0.045, 0.045, 1.72, side * 0.5, y, 0, metal, 'raised-rail');
    for (const z of [-0.78, -0.26, 0.26, 0.78]) box(0.035, 0.28, 0.035, side * 0.5, 0.99, z, metal, 'rail-upright');
  }
  box(1.0, 0.045, 0.17, 0, 0.89, -bed.headDir * 0.4, webbing, 'waist-belt');
  box(0.1, 0.055, 0.2, 0.25, 0.92, -bed.headDir * 0.4, metal, 'belt-buckle');
  const cuffs = [];
  for (const [limb, z, width] of [['hand', -0.1, 0.31], ['foot', -0.68, 0.14]]) {
    for (const [side, suffix] of [[-1, 'l'], [1, 'r']]) {
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.025, 6, 12), padded);
      cuff.name = `${limb === 'hand' ? 'wrist' : 'ankle'}-cuff`;
      g.add(cuff);
      const mark = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 5, 12), marks);
      mark.name = 'pressure-mark';
      g.add(mark);
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), webbing);
      strap.name = 'frame-tie';
      g.add(strap);
      cuffs.push({
        cuff, mark, strap, bone: person?.userData.anim?.inner.getObjectByName(`${limb}_${suffix}`),
        fallback: new THREE.Vector3(side * width, 0.82, bed.headDir * z),
        anchor: new THREE.Vector3(side * 0.49, 0.48, bed.headDir * z), side,
      });
    }
  }
  g.userData.cuffs = cuffs;
  g.userData.markMaterial = marks;
  g.userData.railsRaised = true;
  g.addEventListener('removed', () => {
    g.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    for (const material of [padded, webbing, metal, marks]) material.dispose();
    g.userData.railsRaised = false;
  });
  updateRestraintProps(g, 0);
  return g;
}

const restraintPoint = new THREE.Vector3();
const restraintDelta = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const MARK_LIGHT = new THREE.Color(0xd59683), MARK_DARK = new THREE.Color(0x9e3838);
export function updateRestraintProps(g, minutes) {
  if (!g?.userData.cuffs) return;
  g.userData.markMaterial.color.copy(MARK_LIGHT).lerp(MARK_DARK, Math.min(1, Math.max(0, minutes) / 180));
  g.updateMatrixWorld(true);
  for (const { cuff, mark, strap, bone, fallback, anchor, side } of g.userData.cuffs) {
    if (bone) {
      bone.updateWorldMatrix(true, false);
      g.worldToLocal(bone.getWorldPosition(restraintPoint));
    } else restraintPoint.copy(fallback);
    // The blanket hides low-hanging limbs in the idle clip; keep cuffs on its surface.
    restraintPoint.y = Math.max(0.77, restraintPoint.y);
    anchor.x = Math.sign(restraintPoint.x || side) * 0.49;
    cuff.position.copy(restraintPoint);
    mark.position.copy(restraintPoint);
    mark.position.z += side * 0.065;
    restraintDelta.subVectors(anchor, restraintPoint);
    strap.position.copy(restraintPoint).add(anchor).multiplyScalar(0.5);
    strap.scale.y = restraintDelta.length();
    strap.quaternion.setFromUnitVectors(UP, restraintDelta.normalize());
  }
}
export function makeUrineBag() {
  const m = new THREE.Mesh(geo.bag, mat(0xc9a63a));
  return m;
}

export function pose(group, mode, opts = {}) {
  group.rotation.order = 'YXZ';
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  group.userData.mode = mode;
  if (group.userData.anim) {
    if (mode === 'bed') {
      // Lying face-up on the mattress, head on the pillow at the wall end
      group.rotation.set(-Math.PI / 2, opts.headDir === -1 ? 0 : Math.PI, 0);
      group.position.set(opts.x, 0.74, opts.z - opts.headDir * 0.82);
    } else if (mode === 'seat') {
      group.rotation.y = opts.f;
      group.position.set(opts.x + Math.sin(opts.f) * 0.08, 0, opts.z + Math.cos(opts.f) * 0.08);
    } else group.position.y = 0;
    return;
  }
  if (mode === 'bed') {
    // Lying face-up, head toward the bed's wall end
    group.rotation.set(-Math.PI / 2, opts.headDir === -1 ? 0 : Math.PI, 0);
    group.position.set(opts.x, 0.84, opts.z - opts.headDir * 0.65);
  } else if (mode === 'seat') {
    group.rotation.y = opts.f;
    group.scale.set(1, 0.78, 1);
    group.position.set(opts.x, 0.15, opts.z);
  } else {
    group.position.y = 0;
  }
}
