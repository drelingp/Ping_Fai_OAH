import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import './style.css';
import { buildMap } from './map.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { makePlayer } from './people.js';
import { createGame } from './game.js';
import { loadAssets, updateCharacters } from './assets.js';

// ---------- quality tiers ----------
// high: soft shadows, ambient occlusion, bloom, MSAA · medium: shadows + bloom · low: no post-processing.
const TIERS = ['low', 'medium', 'high'];
const coarse = matchMedia('(pointer: coarse)').matches;
const qParam = new URLSearchParams(location.search).get('q');
const savedQuality = localStorage.getItem('nw-quality');
let tier = TIERS.includes(qParam) ? qParam : TIERS.includes(savedQuality) ? savedQuality : (coarse || innerWidth < 900 ? 'medium' : 'high');
const autoQuality = !TIERS.includes(qParam);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);

// ---------- lighting (changes per shift) ----------
const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x5a4a3c, 1.2);
const sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top = 15;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
const SUN_OFFSET = new THREE.Vector3(-14, 30, 9);
const stationLight = new THREE.PointLight(0xffc887, 7, 14, 1.6);
stationLight.position.set(15.6, 2.5, 28.25);
const flickerLight = new THREE.PointLight(0xd9f0ff, 10, 14, 1.6);
flickerLight.position.set(13, 2.6, 8);
const bed4Light = new THREE.PointLight(0xb8d4ff, 6, 10, 1.6);
bed4Light.position.set(4.5, 2.6, 9);
const corrLight = new THREE.PointLight(0xffe2b8, 8, 16, 1.6);
corrLight.position.set(30, 2.6, 35);
const torch = new THREE.SpotLight(0xfff4d6, 0, 16, 0.5, 0.5, 1.2);
torch.shadow.mapSize.set(512, 512);
torch.shadow.bias = -0.002;
scene.add(hemi, sun, sun.target, stationLight, flickerLight, bed4Light, corrLight, torch, torch.target);

const SHIFT_ENV = {
  AM: { bg: 0x9aa7ad, fog: [22, 60], hemi: 1.15, sun: 2.4, sunColor: 0xfff1dc, torch: 0, exposure: 1.05, grade: [1.04, 1.0, 0.96] },
  PM: { bg: 0x5c4a40, fog: [18, 50], hemi: 0.75, sun: 1.6, sunColor: 0xffb47a, torch: 0, exposure: 1.0, grade: [1.08, 0.98, 0.9] },
  NIGHT: { bg: 0x07080c, fog: [6, 26], hemi: 0.2, sun: 0.25, sunColor: 0x8fa4ff, torch: 26, exposure: 1.1, grade: [0.9, 0.97, 1.1] },
};
let shiftId = 'AM';

// ---------- post-processing ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVignette: { value: 0.32 }, uSat: { value: 1.12 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uVignette, uSat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 col = mix(vec3(l), c.rgb, uSat) * uTint;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d) * 1.35);
      gl_FragColor = vec4(col, c.a);
    }`,
};
let composer = null, gtao = null, bloom = null, grade = null;
function buildPipeline() {
  const dpr = devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1));
  const shadows = tier !== 'low';
  sun.castShadow = shadows;
  torch.castShadow = tier === 'high';
  const size = tier === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  composer?.passes.forEach((pass) => pass.dispose?.());
  composer?.dispose();
  composer = gtao = bloom = null;
  if (tier === 'low') return;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier === 'high' ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (tier === 'high') {
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.5, distanceFallOff: 0.6, thickness: 1, scale: 1 });
    gtao.blendIntensity = 0.75;
    composer.addPass(gtao);
  }
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  applyGrade();
  resize();
}
function applyGrade() {
  if (!grade) return;
  const e = SHIFT_ENV[shiftId];
  grade.uniforms.uTint.value.set(...e.grade);
  grade.uniforms.uVignette.value = shiftId === 'NIGHT' ? 0.55 : 0.32;
  if (bloom) bloom.strength = shiftId === 'NIGHT' ? 0.55 : 0.3;
}

const env = {
  setShift(id) {
    shiftId = id;
    const e = SHIFT_ENV[id];
    scene.background = new THREE.Color(e.bg);
    scene.fog = new THREE.Fog(e.bg, e.fog[0], e.fog[1]);
    hemi.intensity = e.hemi;
    sun.intensity = e.sun;
    sun.color.setHex(e.sunColor);
    torch.intensity = e.torch;
    renderer.toneMappingExposure = e.exposure;
    applyGrade();
    document.body.dataset.shift = id;
  },
};

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom?.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }
}
addEventListener('resize', resize);

// ---------- loading ----------
const startBtn = document.getElementById('start');
const startLabel = startBtn.textContent;
startBtn.disabled = true;
startBtn.textContent = 'Loading ward… 0%';
try {
  await loadAssets((p) => { startBtn.textContent = `Loading ward… ${Math.round(p * 100)}%`; });
} catch (error) {
  console.error('Unable to load ward assets', error);
  startBtn.disabled = false;
  startBtn.textContent = 'Ward assets failed to load — tap to retry';
  startBtn.addEventListener('click', () => location.reload());
  throw error;
}

// ---------- world ----------
const map = buildMap(scene);
const ui = createUI();
const stick = document.getElementById('stick');
const input = createInput(canvas, stick, document.getElementById('knob'));
if (input.touch) document.body.classList.add('touch');

const player = { x: 15.9, z: 28.25, heading: -Math.PI / 2, moving: false, mesh: makePlayer() };
scene.add(player.mesh);

const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.22, 7, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd75a, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }),
);
beacon.renderOrder = 999;
scene.add(beacon);

const game = createGame({ scene, map, ui, input, player, env });

// ---------- camera ----------
const cam = { yaw: 0, pitch: 0.85, dist: 7.5 };
const ray = new THREE.Raycaster();
const tgt = new THREE.Vector3(), dir = new THREE.Vector3();

buildPipeline();
resize();

// Step down a quality tier if the frame rate stays low.
const perf = { t: 0, frames: 0, grace: 4 };
function watchPerf(realDt) {
  if (!autoQuality || tier === 'low') return;
  perf.t += realDt; perf.frames++;
  if (perf.t < 3) return;
  const fps = perf.frames / perf.t;
  perf.t = 0; perf.frames = 0;
  if (perf.grace > 0) { perf.grace--; return; }
  if (fps < 28) {
    tier = TIERS[TIERS.indexOf(tier) - 1];
    localStorage.setItem('nw-quality', tier);
    buildPipeline();
    perf.grace = 2;
  }
}

let last = performance.now();
let flickerT = 0;
function frame(now) {
  const wallDt = Math.max(0, (now - last) / 1000);
  const realDt = Math.min(1, wallDt);
  const dt = Math.min(0.1, wallDt);
  last = now;
  input.update();
  cam.yaw += input.yawDelta;
  cam.pitch = Math.max(0.35, Math.min(1.35, cam.pitch + input.pitchDelta));
  cam.dist = Math.max(3.5, Math.min(14, cam.dist + input.zoomDelta));
  input.yawDelta = input.pitchDelta = input.zoomDelta = 0;

  game.update(dt, cam.yaw, realDt);

  // player visuals
  player.mesh.position.set(player.x, 0, player.z);
  player.mesh.rotation.y = player.heading;
  updateCharacters(dt);

  // third-person camera with wall collision
  tgt.set(player.x, 1.4, player.z);
  dir.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  ray.set(tgt, dir);
  ray.far = cam.dist;
  const hit = ray.intersectObject(map.wallMesh, false)[0];
  const d = hit ? Math.max(1.2, hit.distance - 0.3) : cam.dist;
  camera.position.copy(tgt).addScaledVector(dir, d);
  camera.lookAt(tgt);

  // shadow-casting sun follows the player so the shadow map stays sharp nearby
  sun.position.set(player.x + SUN_OFFSET.x, SUN_OFFSET.y, player.z + SUN_OFFSET.z);
  sun.target.position.set(player.x, 0, player.z);

  // night torch follows the player's facing
  torch.position.set(player.x, 1.5, player.z);
  torch.target.position.set(player.x + Math.sin(player.heading) * 4, 0.3, player.z + Math.cos(player.heading) * 4);

  // failing fluorescent tube in Living Area A
  flickerT -= dt;
  if (flickerT <= 0) {
    flickerLight.intensity = Math.random() < 0.25 ? 1 : shiftId === 'NIGHT' ? 6 : 10;
    flickerT = Math.random() * (flickerLight.intensity < 2 ? 0.12 : 1.8);
  }

  const wp = game.state.waypoint;
  beacon.visible = !!wp;
  if (wp) {
    beacon.position.set(wp.x, 3.5, wp.z);
    beacon.material.opacity = 0.32;
  }

  renderer.info.reset();
  if (composer) composer.render(realDt);
  else renderer.render(scene, camera);
  watchPerf(wallDt);
  requestAnimationFrame(frame);
}

env.setShift('AM');
startBtn.disabled = false;
startBtn.textContent = startLabel;
startBtn.addEventListener('click', () => {
  document.getElementById('title').classList.add('hide');
  game.start();
});
requestAnimationFrame(frame);

// Debug/test hook
window.__game = game;
window.__gfx = { get tier() { return tier; }, renderer, scene, camera, map, input };
