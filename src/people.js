import * as THREE from 'three';

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

export function makeResident(r) {
  const gown = [0x9fb8c8, 0xa9c4b0, 0xc3b5cf, 0xb8c4cf][r.seed % 4];
  const hair = [0xcfcfcf, 0xb5b5b5, 0xe2e2e2, 0x8f8f8f][(r.seed >> 2) % 4];
  return makePerson({ body: gown, hair, skin: SKIN[(r.seed >> 4) % SKIN.length] });
}

export function makeNurse(color) {
  return makePerson({ body: color, hair: 0x1d1a18, skin: SKIN[1], cap: true });
}

export function makePlayer() {
  return makePerson({ body: 0x23314d, hair: 0x15120f, skin: SKIN[2], cap: true });
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
