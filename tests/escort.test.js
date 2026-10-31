import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEscort } from '../src/escort.js';
import { createHarm } from '../src/harm.js';
import { resolveCollisions } from '../src/map.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function fixture({ nurses = 1 } = {}) {
  const bed = { id: '1-1', room: 'bed1', x: 10, z: 0, headDir: 1 };
  const r = { id: 1, name: 'Resident', alive: true, mobility: 'walking', mode: 'wander', pos: { x: 0, z: 0 }, wellbeing: 100, bed, mesh: new THREE.Group() };
  const onShift = Array.from({ length: nurses }, (_, i) => ({ name: `Nurse ${i}`, pos: { x: 3, z: 0 }, path: [], mesh: new THREE.Group(), disposition: 'helpful', trust: 40 }));
  const s = {
    running: true, paused: false, now: 420, day: 1, shiftIdx: 0, escort: null, bells: [], residents: [r], onShift, conductReports: [],
    totalHarm: 0, reputation: 70, suspicion: 0, stats: { harm: 0, harmReports: 0, incidents: 0, log: [] },
    player: { x: 0.5, z: 0, heading: 0, mesh: new THREE.Group() },
  };
  const toasts = [];
  const gestures = [];
  const ui = { panelOpen: true, toast: (m) => toasts.push(m), closePanel() { this.panelOpen = false; }, dialogue() {} };
  const map = { colliders: [], path: (_from, to) => [to], roomAt: () => ({ id: 'livA' }), inStation: () => true };
  const placed = [];
  const escort = createEscort({
    s, map, ui, dist, rnd: (a) => a,
    bedSide: (b) => ({ x: b.x, z: b.z - b.headDir * 1.6 }),
    placeInBed: (res) => { res.mode = 'bed'; placed.push(res); },
    nurseGoto: (n, to) => { n.path = [to]; },
    resolveCollisions, gesture: (m, name) => gestures.push(name), pose: (g, mode) => { g.userData.mode = mode; },
    wanderAreas: ['livA'],
  });
  return { s, r, bed, escort, toasts, gestures, placed, ui, map, nurse: onShift[0] };
}

function random(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

function run(f, seconds, step = 0.1) {
  for (let t = 0; t < seconds && f.s.escort; t += step) {
    // NPC nurses walk their path while gathering, as updateNurse does in the game
    for (const n of f.s.onShift) if (n.escort && n.path.length) { n.pos = { ...n.path[0] }; n.path = []; }
    f.escort.update(step);
  }
}

test('a free nurse joins, both walk the resident to their bed, restraint is applied once at the bedside', () => {
  const f = fixture();
  let applied = 0;
  assert.equal(f.escort.start(f.r, () => applied++), true);
  assert.equal(f.nurse.escort, true);
  assert.equal(f.s.escort.phase, 'gather');
  assert.equal(f.r.mode, 'escort');
  random(0.99, () => run(f, 30));
  assert.equal(applied, 1);
  assert.equal(f.s.escort, null);
  assert.equal(f.r.mode, 'bed');
  assert.equal(f.nurse.escort, false);
  assert.ok(dist(f.s.player, { x: 10, z: -1.6 }) < 1.2, 'player walked with the resident');
  assert.ok(f.gestures.includes('interact'));
});

test('short-staffed escorts go solo and the resident can resist, pausing the escort', () => {
  const f = fixture({ nurses: 0 });
  let applied = 0;
  f.escort.start(f.r, () => applied++);
  assert.equal(f.s.escort.solo, true);
  assert.equal(f.s.escort.phase, 'walk');
  random(0, () => f.escort.update(1.0));
  assert.equal(f.s.escort.phase, 'paused');
  assert.ok(f.gestures.includes('push'));
  assert.ok(f.gestures.includes('hit'));
  const x = f.r.pos.x;
  random(0.99, () => f.escort.update(0.5));
  assert.equal(f.r.pos.x, x, 'no movement while paused');
  random(0.99, () => run(f, 40));
  assert.equal(applied, 1);
});

test('backup can be called after a solo escort is resisted', () => {
  const f = fixture({ nurses: 0 });
  f.escort.start(f.r, () => {});
  f.s.onShift.push({ name: 'Backup', pos: { x: 5, z: 0 }, path: [], mesh: new THREE.Group() });
  random(0, () => f.escort.update(1.0));
  assert.equal(f.s.escort.helper?.name, 'Backup');
  assert.equal(f.s.onShift[0].escort, true);
});

test('abandoning or ending the shift cancels safely without applying restraint', () => {
  const f = fixture();
  let applied = 0;
  f.escort.start(f.r, () => applied++);
  f.escort.cancel();
  assert.equal(f.s.escort, null);
  assert.equal(applied, 0);
  assert.equal(f.nurse.escort, false);
  assert.equal(f.r.mode, 'wander');
  const g = fixture();
  g.escort.start(g.r, () => applied++);
  g.s.running = false;
  g.escort.update(0.1);
  assert.equal(g.s.escort, null);
  assert.equal(applied, 0);
});

test('restraint penalty is counted once at commitment; the restraint lands only at the bed', async () => {
  const f = fixture();
  const case1 = { count: 0, onPlayerHarm() { this.count++; } };
  const harm = createHarm({
    s: f.s, ui: f.ui, map: f.map, case1, escort: f.escort,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), dist, fmtTime: String, placeInBed: (res) => { res.mode = 'bed'; },
  });
  const events = {};
  const button = { isConnected: true, addEventListener: (name, fn) => { events[name] = fn; } };
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => button };
  try {
    harm.options(f.r).find((o) => o.label.includes('Apply restraint')).fn();
    random(0.99, () => events.keydown({ key: ' ', repeat: false, preventDefault() {} }));
    await new Promise((res) => setTimeout(res, 1550));
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
  assert.equal(f.s.stats.harm, 1);
  assert.equal(case1.count, 1);
  assert.equal(f.r.playerRestrained, undefined);
  assert.ok(f.s.escort);
  assert.equal(harm.options(f.r).find((o) => o.label.includes('Apply restraint')).disabled, true);
  random(0.99, () => run(f, 30));
  assert.equal(f.r.playerRestrained, true);
  assert.equal(f.s.stats.harm, 1);
});
