// CC0 model loading (Quaternius UAL mannequin, Kenney Furniture Kit, KayKit Halloween Bits).
// Models are normalised on load: centred on x/z, resting on y = 0.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHAR_NAMES = ['human'];
const FURN_NAMES = [
  'bathroomCabinet', 'bathroomMirror', 'bathroomSink', 'bathtub', 'bedSingle', 'bench', 'bookcaseOpen', 'bookcaseClosedWide', 'books',
  'cabinetBed', 'cabinetBedDrawerTable', 'cabinetTelevision', 'cardboardBoxClosed', 'chair', 'chairCushion', 'chairDesk', 'chairRounded',
  'coatRackStanding', 'computerKeyboard', 'computerScreen', 'desk', 'deskCorner', 'kitchenCabinet', 'kitchenCabinetUpper',
  'kitchenCoffeeMachine', 'kitchenFridge', 'kitchenFridgeSmall', 'kitchenMicrowave', 'kitchenSink', 'lampRoundFloor', 'lampRoundTable',
  'lampSquareCeiling', 'lampWall', 'laptop', 'loungeChair', 'loungeChairRelax', 'loungeSofa', 'loungeSofaLong', 'pillow', 'plantSmall1',
  'plantSmall2', 'plantSmall3', 'pottedPlant', 'radio', 'rugRectangle', 'rugRounded', 'rugRound', 'shower', 'sideTable',
  'sideTableDrawers', 'table', 'tableCloth', 'tableCoffee', 'tableRound', 'televisionModern', 'televisionVintage', 'toilet', 'trashcan',
  'washer', 'washerDryerStacked',
];
const HW_NAMES = [
  'pumpkin_orange_jackolantern', 'pumpkin_orange', 'pumpkin_yellow_small', 'candle_triple', 'lantern_hanging', 'lantern_standing',
  'tree_dead_medium', 'bench',
];
const EXTRA = ['wheelchair'];

const templates = new Map(); // key -> normalised Group
const charData = new Map(); // name -> { scene, animations }

function prep(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material.isMeshBasicMaterial) {
        const b = o.material;
        o.material = new THREE.MeshStandardMaterial({ color: b.color, map: b.map, roughness: 0.8, name: b.name });
      }
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (m.map) m.map.anisotropy = 4;
        if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 1, 0.55);
        if ('metalness' in m) m.metalness = Math.min(m.metalness ?? 0, 0.2);
      }
    }
  });
}

function normalise(scene) {
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -box.min.y, -c.z);
  const g = new THREE.Group();
  g.add(scene);
  g.userData.size = box.getSize(new THREE.Vector3());
  return g;
}

// Rest-pose positions in metres (positions may be quantised by meshopt), used by the outfit shader.
function addRestAttribute(root) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      out.set([v.x, v.y, v.z], i * 3);
    }
    o.geometry.setAttribute('rest', new THREE.BufferAttribute(out, 3));
  });
}

export async function loadAssets(onProgress = () => {}) {
  const base = import.meta.env.BASE_URL + 'models/';
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const jobs = [
    ...FURN_NAMES.map((n) => ['furn:' + n, `furn/${n}.glb`]),
    ...HW_NAMES.map((n) => ['hw:' + n, `hw/${n}.gltf`]),
    ...EXTRA.map((n) => ['x:' + n, `chars/${n}.glb`]),
    ...CHAR_NAMES.map((n) => ['char:' + n, `chars/${n}.glb`]),
  ];
  let done = 0;
  await Promise.all(jobs.map(async ([key, path]) => {
    try {
      const gltf = await loader.loadAsync(base + path);
      prep(gltf.scene);
      if (key.startsWith('char:')) { addRestAttribute(gltf.scene); charData.set(key.slice(5), { scene: gltf.scene, animations: gltf.animations }); }
      else templates.set(key, normalise(gltf.scene));
    } catch (e) {
      throw new Error(`Model failed to load: ${path}`, { cause: e });
    }
    onProgress(++done / jobs.length);
  }));
}

export const hasModel = (key) => templates.has(key);

// Returns a clone of a static model scaled uniformly (Kenney furniture is ~0.5 scale).
export function model(key, scale = 1) {
  const t = templates.get(key);
  if (!t) return null;
  const g = t.clone(true);
  g.scale.setScalar(scale);
  g.userData.size = t.userData.size.clone().multiplyScalar(scale);
  return g;
}

// ---------- animated characters ----------
// One rigged mannequin (Quaternius UAL) dressed per role by a shader that colours
// regions of the rest pose: shoes, trousers/legs, top/gown, sleeves, skin and hair.
const CHAR_HEIGHT = 1.62;
const animated = new Set();
const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', sit: 'Sitting_Idle_Loop',
  sitTalk: 'Sitting_Talking_Loop', talk: 'Idle_Talking_Loop', interact: 'Interact', pickup: 'PickUp_Table',
  push: 'Push_Loop', punch: 'Punch_Jab', kneel: 'Fixing_Kneeling', death: 'Death01', hit: 'Hit_Chest', crouch: 'Crouch_Idle_Loop',
};
const ONCE = new Set(['interact', 'pickup', 'punch', 'death', 'hit']);
const eyeGeo = new THREE.SphereGeometry(0.014, 6, 4);
const faceGeo = mergeGeometries([
  eyeGeo.clone().translate(-0.036, 0, 0),
  eyeGeo.clone().translate(0.036, 0, 0),
  new THREE.BoxGeometry(0.035, 0.006, 0.003).translate(0, -0.035, 0.009),
]);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15100c });
const capGeo = new THREE.BoxGeometry(0.15, 0.05, 0.1);
const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
const lanyardGeo = new THREE.BoxGeometry(0.05, 0.07, 0.01);

function outfitMaterial(base, o) {
  const m = base.clone();
  m.color.set(0xffffff);
  m.map = null;
  m.roughness = 0.75;
  m.metalness = 0;
  const u = {
    uSkin: { value: new THREE.Color(o.skin) }, uHair: { value: new THREE.Color(o.hair) },
    uTop: { value: new THREE.Color(o.top) }, uBottom: { value: new THREE.Color(o.bottom) },
    uShoe: { value: new THREE.Color(o.shoe) }, uTrim: { value: new THREE.Color(o.trim ?? o.top) },
    uHem: { value: o.hem ?? 0.9 }, uSleeve: { value: o.sleeve ?? 0.33 }, uBald: { value: o.bald ?? 0 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec3 rest;\nvarying vec3 vRest;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = rest;');
    sh.fragmentShader = `varying vec3 vRest;
uniform vec3 uSkin, uHair, uTop, uBottom, uShoe, uTrim; uniform float uHem, uSleeve, uBald;
vec3 outfit(vec3 p) {
  float ax = abs(p.x);
  if (p.y < 0.11) return uShoe;
  if (ax > 0.17 && p.y > 1.3) return ax < uSleeve ? uTop : (ax < uSleeve + 0.025 ? uTrim : uSkin);
  if (p.y > 1.49 && ax < 0.115) {
    bool hair = uBald > 0.5 ? (p.y > 1.6 && p.y < 1.7 && p.z < -0.04) : (p.y > 1.735 || (p.y > 1.6 && p.z < -0.035));
    return hair ? uHair : uSkin;
  }
  if (p.y > 1.43 && p.z > 0.02 && ax < 0.07) return uSkin;
  if (p.y > uHem) return (p.y < uHem + 0.03) ? uTrim : uTop;
  return uBottom;
}
` + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= outfit(vRest);');
  };
  m.customProgramCacheKey = () => 'outfit';
  return m;
}

export function character(name, outfit) {
  const src = charData.get(name);
  if (!src) return null;
  const inner = cloneSkinned(src.scene);
  const mats = new Map();
  let head = null;
  inner.traverse((o) => {
    if (o.isBone && o.name === 'Head') head = o;
    if (o.isMesh) {
      if (!mats.has(o.material)) mats.set(o.material, outfitMaterial(o.material, outfit));
      o.material = mats.get(o.material);
      // A conservative metre-space sphere covers every pose of the quantised rig.
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.4);
      o.frustumCulled = true;
    }
  });
  inner.updateMatrixWorld(true);
  if (head) {
    const face = new THREE.Mesh(faceGeo, eyeMat);
    face.position.set(0, 1.645, 0.093);
    head.attach(face);
    if (outfit.cap) {
      const c = new THREE.Mesh(capGeo, capMat);
      c.position.set(0, 1.79, 0.01);
      c.castShadow = true;
      head.attach(c);
    }
  }
  if (outfit.badge) {
    const spine = inner.getObjectByName('spine_03');
    const b = new THREE.Mesh(lanyardGeo, new THREE.MeshStandardMaterial({ color: outfit.badge }));
    b.position.set(0.08, 1.33, 0.12);
    spine?.attach(b);
  }
  const s = (outfit.height ?? CHAR_HEIGHT) / 1.83;
  inner.scale.setScalar(s);
  const g = new THREE.Group();
  g.add(inner);
  const mixer = new THREE.AnimationMixer(inner);
  const byName = Object.fromEntries(src.animations.map((c) => [c.name, c]));
  const actions = {};
  for (const [k, clip] of Object.entries(CLIPS)) {
    if (!byName[clip]) continue;
    const a = mixer.clipAction(byName[clip]);
    if (ONCE.has(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[k] = a;
  }
  const anim = {
    mixer, actions, current: null, currentName: '', inner,
    play(want, fade = 0.25) {
      const a = actions[want] || actions.idle;
      if (!a || this.current === a) return;
      a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
      if (this.current) this.current.fadeOut(fade);
      this.current = a;
      this.currentName = want;
    },
  };
  g.userData.anim = anim;
  g.userData.lastPos = new THREE.Vector3(Infinity, 0, 0);
  anim.play('idle', 0);
  mixer.update(Math.random() * 3);
  animated.add(g);
  return g;
}

// One-shot gesture (e.g. 'interact', 'punch'), then return to the automatic choice.
export function gesture(g, name, seconds = 1.6) {
  if (!g?.userData.anim) return;
  g.userData.forceAnim = name;
  g.userData.forceUntil = performance.now() + seconds * 1000;
}

// Choose an animation from the character's pose and movement, then advance its mixer.
export function updateCharacters(dt) {
  const now = performance.now();
  for (const g of animated) {
    if (!g.parent) { animated.delete(g); continue; }
    if (!g.visible) { g.userData.lastPos.set(Infinity, 0, 0); continue; }
    const a = g.userData.anim;
    const p = g.position, lp = g.userData.lastPos;
    const speed = Number.isFinite(lp.x) && dt > 0 ? Math.hypot(p.x - lp.x, p.z - lp.z) / dt : 0;
    lp.copy(p);
    if (g.userData.forceUntil && now > g.userData.forceUntil) g.userData.forceAnim = g.userData.forceUntil = null;
    const mode = g.userData.mode || 'stand';
    let want;
    if (mode === 'bed') want = 'idle';
    else if (g.userData.forceAnim) want = g.userData.forceAnim;
    else if (mode === 'seat') want = 'sit';
    else if (speed > 3.6) want = 'sprint';
    else if (speed > 1.9) want = 'run';
    else if (speed > 0.15) want = 'walk';
    else want = g.userData.idleAnim || 'idle';
    a.play(want);
    if (a.current) {
      let ts = 1;
      if (want === 'walk') ts = Math.min(1.5, Math.max(0.45, speed / 1.25));
      else if (want === 'run') ts = Math.min(1.4, Math.max(0.8, speed / 2.8));
      else if (mode === 'bed') ts = 0.25;
      a.current.timeScale = ts;
    }
    a.mixer.update(dt);
  }
}
