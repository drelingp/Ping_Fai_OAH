import * as THREE from 'three';

// Replaces the segmented mannequin with one continuous, smooth-shaded body skinned to the same
// skeleton. Lofted tubes follow the bind-pose bones; weights blend across each joint so elbows,
// knees, hips and neck bend without gaps or ball joints.

const BLEND = 0.07; // metres either side of a joint where neighbouring bones share weight

function lofted(chain, ref, around, out) {
  const { bonePos, boneIdx } = out;
  const ctrl = chain.map((c) => ({
    p: c.at ? bonePos(c.at).add(new THREE.Vector3(...(c.off || [0, 0, 0]))) : new THREE.Vector3(...c.p),
    rx: c.rx, rz: c.rz, bone: boneIdx(c.bone),
  }));
  const curve = new THREE.CatmullRomCurve3(ctrl.map((c) => c.p), false, 'centripetal');
  // sample positions with the control segment and parameter each belongs to
  const samples = [];
  const nSeg = ctrl.length - 1;
  for (let k = 0; k < nSeg; k++) {
    const len = ctrl[k].p.distanceTo(ctrl[k + 1].p);
    const steps = Math.max(2, Math.ceil(len / 0.028));
    for (let i = 0; i < steps || (k === nSeg - 1 && i === steps); i++) samples.push({ k, t: i / steps, len });
  }
  const base = out.pos.length / 3;
  const T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), c = new THREE.Vector3();
  const sm = (x) => x * x * (3 - 2 * x);
  const rings = [];
  for (const s of samples) {
    const u = (s.k + s.t) / nSeg;
    curve.getPoint(u, c);
    curve.getTangent(u, T);
    B.copy(ref).addScaledVector(T, -ref.dot(T)).normalize();
    N.crossVectors(T, B).normalize();
    const a = ctrl[s.k], b = ctrl[s.k + 1] || a;
    const e = sm(s.t);
    const rx = a.rx + (b.rx - a.rx) * e, rz = a.rz + (b.rz - a.rz) * e;
    // skin weights: own segment bone, blended toward neighbours near each joint
    const w = new Map();
    const add = (bone, v) => w.set(bone, (w.get(bone) || 0) + v);
    let own = 1;
    const d0 = s.t * s.len, d1 = (1 - s.t) * s.len;
    if (s.k > 0 && ctrl[s.k - 1].bone !== a.bone && d0 < BLEND) { const v = 0.5 * (1 - d0 / BLEND); add(ctrl[s.k - 1].bone, v); own -= v; }
    if (s.k + 1 < nSeg && b.bone !== a.bone && d1 < BLEND) { const v = 0.5 * (1 - d1 / BLEND); add(b.bone, v); own -= v; }
    add(a.bone, own);
    const ws = [...w.entries()].slice(0, 4);
    rings.push({ c: c.clone(), T: T.clone() });
    for (let j = 0; j < around; j++) {
      const ang = (j / around) * Math.PI * 2;
      out.pos.push(
        c.x + N.x * rx * Math.cos(ang) + B.x * rz * Math.sin(ang),
        c.y + N.y * rx * Math.cos(ang) + B.y * rz * Math.sin(ang),
        c.z + N.z * rx * Math.cos(ang) + B.z * rz * Math.sin(ang),
      );
      for (let q = 0; q < 4; q++) { out.idx4.push(ws[q]?.[0] ?? 0); out.w4.push(ws[q]?.[1] ?? 0); }
    }
  }
  const R = rings.length;
  // Quads between rings; winding chosen so faces point outward
  const flip = new THREE.Vector3().crossVectors(N, B).dot(T) < 0;
  const tri = (a, b, c2) => (flip ? out.ind.push(a, c2, b) : out.ind.push(a, b, c2));
  for (let r = 0; r < R - 1; r++) {
    for (let j = 0; j < around; j++) {
      const a = base + r * around + j, b2 = base + r * around + ((j + 1) % around);
      const c2 = a + around, d = b2 + around;
      tri(a, b2, d); tri(a, d, c2);
    }
  }
  // Rounded end caps
  const cap = (ring, dir, bone) => {
    const p = rings[ring].c.clone().addScaledVector(rings[ring].T, dir * 0.012);
    const v = out.pos.length / 3;
    out.pos.push(p.x, p.y, p.z);
    out.idx4.push(bone, 0, 0, 0); out.w4.push(1, 0, 0, 0);
    for (let j = 0; j < around; j++) {
      const a = base + ring * around + j, b2 = base + ring * around + ((j + 1) % around);
      if (dir > 0) tri(a, b2, v); else tri(b2, a, v);
    }
  };
  cap(0, -1, ctrl[0].bone);
  cap(R - 1, 1, ctrl[nSeg - 1].bone);
}

const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);

function bodyParts(side) {
  const m = side === 'l' ? 1 : -1;
  const X = (x) => x * m;
  const arm = [
    { at: 'upperarm_' + side, off: [X(-0.08), -0.02, 0.01], rx: 0.05, rz: 0.055, bone: 'spine_03' },
    { at: 'upperarm_' + side, off: [X(0.01), -0.01, 0.006], rx: 0.052, rz: 0.055, bone: 'upperarm_' + side },
    { at: 'upperarm_' + side, off: [X(0.13), 0, 0], rx: 0.052, rz: 0.054, bone: 'upperarm_' + side },
    { at: 'lowerarm_' + side, rx: 0.04, rz: 0.043, bone: 'lowerarm_' + side },
    { at: 'lowerarm_' + side, off: [X(0.11), 0, 0.002], rx: 0.042, rz: 0.042, bone: 'lowerarm_' + side },
    { at: 'hand_' + side, rx: 0.027, rz: 0.034, bone: 'hand_' + side },
    { at: 'hand_' + side, off: [X(0.07), -0.002, 0.004], rx: 0.022, rz: 0.047, bone: 'hand_' + side },
    { at: 'middle_01_' + side, rx: 0.017, rz: 0.044, bone: 'hand_' + side },
    { at: 'middle_01_' + side, off: [X(0.065), -0.004, 0], rx: 0.013, rz: 0.034, bone: 'hand_' + side },
    { at: 'middle_04_leaf_' + side, off: [X(-0.01), -0.006, 0], rx: 0.008, rz: 0.016, bone: 'hand_' + side },
  ];
  const leg = [
    { at: 'thigh_' + side, off: [X(-0.018), 0.03, -0.012], rx: 0.062, rz: 0.078, bone: 'thigh_' + side },
    { at: 'thigh_' + side, off: [X(-0.004), 0, 0], rx: 0.08, rz: 0.09, bone: 'thigh_' + side },
    { at: 'thigh_' + side, off: [0, -0.2, 0.004], rx: 0.07, rz: 0.074, bone: 'thigh_' + side },
    { at: 'calf_' + side, rx: 0.05, rz: 0.055, bone: 'calf_' + side },
    { at: 'calf_' + side, off: [0, -0.11, -0.012], rx: 0.054, rz: 0.06, bone: 'calf_' + side },
    { at: 'calf_' + side, off: [0, -0.32, -0.025], rx: 0.037, rz: 0.04, bone: 'calf_' + side },
    { at: 'foot_' + side, off: [0, -0.01, 0], rx: 0.035, rz: 0.04, bone: 'foot_' + side },
  ];
  const foot = [
    { at: 'foot_' + side, off: [0, -0.03, -0.055], rx: 0.034, rz: 0.03, bone: 'foot_' + side },
    { at: 'foot_' + side, off: [0, -0.035, 0.0], rx: 0.044, rz: 0.055, bone: 'foot_' + side },
    { at: 'ball_' + side, off: [0, 0.035, 0], rx: 0.048, rz: 0.034, bone: 'ball_' + side },
    { at: 'ball_leaf_' + side, off: [0, 0.025, -0.005], rx: 0.036, rz: 0.02, bone: 'ball_' + side },
  ];
  return { arm, leg, foot };
}

const TORSO = [
  { at: 'pelvis', off: [0, -0.075, -0.004], rx: 0.075, rz: 0.07, bone: 'pelvis' },
  { at: 'pelvis', off: [0, -0.035, -0.002], rx: 0.152, rz: 0.11, bone: 'pelvis' },
  { at: 'pelvis', off: [0, 0.065, 0.01], rx: 0.148, rz: 0.102, bone: 'pelvis' },
  { at: 'spine_01', off: [0, 0.01, 0.006], rx: 0.142, rz: 0.098, bone: 'spine_01' },
  { at: 'spine_02', off: [0, 0, 0.004], rx: 0.152, rz: 0.106, bone: 'spine_02' },
  { at: 'spine_03', off: [0, -0.05, 0.01], rx: 0.166, rz: 0.112, bone: 'spine_03' },
  { at: 'spine_03', off: [0, 0.06, 0.0], rx: 0.172, rz: 0.1, bone: 'spine_03' },
  { at: 'spine_03', off: [0, 0.115, -0.008], rx: 0.15, rz: 0.08, bone: 'spine_03' },
  { at: 'spine_03', off: [0, 0.16, -0.01], rx: 0.085, rz: 0.065, bone: 'spine_03' },
  { at: 'neck_01', off: [0, 0.0, 0.0], rx: 0.054, rz: 0.056, bone: 'neck_01' },
  { at: 'neck_01', off: [0, 0.055, 0.004], rx: 0.052, rz: 0.055, bone: 'neck_01' },
  { at: 'Head', off: [0, 0.02, 0.012], rx: 0.066, rz: 0.08, bone: 'Head' },
  { at: 'Head', off: [0, 0.075, 0.016], rx: 0.084, rz: 0.098, bone: 'Head' },
  { at: 'Head', off: [0, 0.135, 0.008], rx: 0.094, rz: 0.104, bone: 'Head' },
  { at: 'Head', off: [0, 0.185, 0.0], rx: 0.093, rz: 0.1, bone: 'Head' },
  { at: 'Head', off: [0, 0.228, -0.004], rx: 0.076, rz: 0.084, bone: 'Head' },
  { at: 'Head', off: [0, 0.255, -0.006], rx: 0.04, rz: 0.046, bone: 'Head' },
];

export function smoothBody(scene) {
  const segs = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) segs.push(o); });
  if (!segs.length) return;
  const src = segs[0];
  const sk = src.skeleton;
  const names = sk.bones.map((b) => b.name);
  const inv = new THREE.Matrix4();
  const out = {
    pos: [], idx4: [], w4: [], ind: [],
    boneIdx: (n) => { const i = names.indexOf(n); if (i < 0) throw new Error('bone ' + n); return i; },
    bonePos: (n) => new THREE.Vector3().setFromMatrixPosition(inv.copy(sk.boneInverses[out.boneIdx(n)]).invert()),
  };
  lofted(TORSO, Z, 18, out);
  for (const side of ['l', 'r']) {
    const p = bodyParts(side);
    lofted(p.arm, Z, 12, out);
    lofted(p.leg, Z, 14, out);
    lofted(p.foot, Y, 12, out);
  }
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(out.pos);
  // bind space -> mesh local
  const toLocal = src.bindMatrixInverse;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { v.fromArray(pos, i).applyMatrix4(toLocal); v.toArray(pos, i); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.idx4, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.w4, 4));
  geo.setIndex(out.ind);
  geo.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geo, src.material);
  mesh.name = 'Body';
  mesh.position.copy(src.position); mesh.quaternion.copy(src.quaternion); mesh.scale.copy(src.scale);
  mesh.castShadow = true; mesh.receiveShadow = true;
  src.parent.add(mesh);
  mesh.bind(sk, src.bindMatrix);
  for (const s of segs) s.parent.remove(s);
}
