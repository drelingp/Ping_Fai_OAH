import * as THREE from 'three';
import './style.css';
import { buildMap } from './map.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { makePlayer } from './people.js';
import { createGame } from './game.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: (devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);

// ---------- lighting (changes per shift) ----------
const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x4a4036, 1.2);
const sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
sun.position.set(-20, 40, 10);
const stationLight = new THREE.PointLight(0xffc887, 14, 14, 1.6);
stationLight.position.set(14, 2.5, 29);
const flickerLight = new THREE.PointLight(0xd9f0ff, 10, 14, 1.6);
flickerLight.position.set(13, 2.6, 8);
const bed4Light = new THREE.PointLight(0xb8d4ff, 6, 10, 1.6);
bed4Light.position.set(4.5, 2.6, 9);
const corrLight = new THREE.PointLight(0xffe2b8, 8, 16, 1.6);
corrLight.position.set(30, 2.6, 35);
const torch = new THREE.SpotLight(0xfff4d6, 0, 16, 0.5, 0.5, 1.2);
scene.add(hemi, sun, stationLight, flickerLight, bed4Light, corrLight, torch, torch.target);

const SHIFT_ENV = {
  AM: { bg: 0x9aa7ad, fog: [22, 60], hemi: 1.25, sun: 1.1, sunColor: 0xfff1dc, torch: 0 },
  PM: { bg: 0x5c4a40, fog: [18, 50], hemi: 0.8, sun: 0.65, sunColor: 0xffb47a, torch: 0 },
  NIGHT: { bg: 0x07080c, fog: [6, 26], hemi: 0.22, sun: 0.12, sunColor: 0x8fa4ff, torch: 26 },
};
let shiftId = 'AM';
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
    document.body.dataset.shift = id;
  },
};

// ---------- world ----------
const map = buildMap(scene);
const ui = createUI();
const stick = document.getElementById('stick');
const input = createInput(canvas, stick, document.getElementById('knob'));
if (input.touch) document.body.classList.add('touch');

const player = { x: 13.2, z: 29.5, heading: Math.PI, moving: false, mesh: makePlayer() };
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

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let flickerT = 0;
function frame(now) {
  const realDt = Math.min(0.25, (now - last) / 1000);
  const dt = Math.min(0.1, realDt);
  last = now;
  input.update();
  cam.yaw += input.yawDelta;
  cam.pitch = Math.max(0.35, Math.min(1.35, cam.pitch + input.pitchDelta));
  cam.dist = Math.max(3.5, Math.min(14, cam.dist + input.zoomDelta));
  input.yawDelta = input.pitchDelta = input.zoomDelta = 0;

  game.update(dt, cam.yaw, realDt);

  // player visuals
  player.mesh.position.set(player.x, player.moving ? Math.abs(Math.sin(now / 110)) * 0.05 : 0, player.z);
  player.mesh.rotation.y = player.heading;

  // third-person camera with wall collision
  tgt.set(player.x, 1.4, player.z);
  dir.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  ray.set(tgt, dir);
  ray.far = cam.dist;
  const hit = ray.intersectObject(map.wallMesh, false)[0];
  const d = hit ? Math.max(1.2, hit.distance - 0.3) : cam.dist;
  camera.position.copy(tgt).addScaledVector(dir, d);
  camera.lookAt(tgt);

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
    beacon.material.opacity = 0.25 + 0.15 * Math.sin(now / 200);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

env.setShift('AM');
document.getElementById('start').addEventListener('click', () => {
  document.getElementById('title').classList.add('hide');
  game.start();
});
requestAnimationFrame(frame);

// Debug/test hook
window.__game = game;
