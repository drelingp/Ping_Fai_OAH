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

export function makeNurse(color) {
  const g = character('human', {
    skin: SKIN_TONES[1], hair: 0x1d1a18, top: color, trim: 0xffffff, bottom: color, shoe: 0xf2f2f2, hem: 0.88, sleeve: 0.3,
    cap: true, badge: 0x3a6fb0, height: 1.6,
  });
  return g || makePerson({ body: color, hair: 0x1d1a18, skin: SKIN[1], cap: true });
}

export function makePlayer() {
  const g = character('human', {
    skin: SKIN_TONES[2], hair: 0x15120f, top: 0x23314d, trim: 0xd6b25a, bottom: 0x1c2638, shoe: 0x111111, hem: 0.88, sleeve: 0.3,
    cap: true, badge: 0xd6b25a, height: 1.66,
  });
  return g || makePerson({ body: 0x23314d, hair: 0x15120f, skin: SKIN[2], cap: true });
}

// Visual props for the restrained resident (Case 1)
export function makeRestraintProps() {
  const g = new THREE.Group();
  const s1 = new THREE.Mesh(geo.strap, mat(0xd8cfa6));
  const s2 = s1.clone();
  s1.position.set(-0.42, 0.72, 0);
  s2.position.set(0.42, 0.72, 0);
  g.add(s1, s2);
  return g;
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
