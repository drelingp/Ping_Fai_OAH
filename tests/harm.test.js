import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHarm } from '../src/harm.js';

function fixture() {
  const r = { id: 1, name: 'Resident', alive: true, pos: { x: 0, z: 0 }, wellbeing: 100, mode: 'wander', mesh: new THREE.Group() };
  const other = { ...r, id: 2, name: 'Witness', pos: { x: 1, z: 0 }, mesh: new THREE.Group() };
  const helpful = { name: 'Helpful nurse', disposition: 'helpful', trust: 40, pos: { x: 1, z: 0 }, path: [] };
  const harmful = { ...helpful, name: 'Harmful nurse', disposition: 'harmful' };
  const s = {
    player: { x: 0, z: 0, mesh: new THREE.Group() }, residents: [r, other], onShift: [helpful, harmful],
    running: true, paused: false, now: 420, day: 1, shiftIdx: 0, bells: [], conductReports: [],
    totalHarm: 0, reputation: 70, suspicion: 0, stats: { harm: 0, harmReports: 0, incidents: 0, log: [] },
  };
  const toasts = [];
  const ui = { panelOpen: true, toast: (m) => toasts.push(m), closePanel() { this.panelOpen = false; }, dialogue() {} };
  const case1 = { count: 0, onPlayerHarm() { this.count++; } };
  const map = { roomAt: () => ({ id: 'room' }), inStation: () => true };
  const harm = createHarm({
    s, ui, map, case1,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    fmtTime: String,
    placeInBed: (res) => { res.mode = 'bed'; },
  });
  const act = (word) => harm.options(r).find((o) => o.label.includes(word)).fn();
  return { s, r, other, helpful, harmful, harm, act, toasts, ui, map, case1 };
}

function random(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

test('rough handling costs wellbeing, counts harm and can cause a fall', () => {
  const f = fixture();
  random(0, () => f.act('Handle roughly'));
  assert.equal(f.r.wellbeing, 75);
  assert.equal(f.s.stats.incidents, 1);
  assert.equal(f.s.stats.harm, 1);
  assert.equal(f.case1.count, 1);
});

test('staff witnesses report, harmful staff gain trust, residents remember', () => {
  const f = fixture();
  random(0, () => f.act('Shout'));
  assert.equal(f.r.wellbeing, 94);
  assert.equal(f.other.wellbeing, 96);
  assert.equal(f.other.fearOf, 'player');
  assert.equal(f.helpful.trust, 28);
  assert.equal(f.harmful.trust, 45);
  assert.equal(f.s.reputation, 60);
  assert.equal(f.s.suspicion, 12);
  assert.equal(f.s.stats.harmReports, 1);
  assert.equal(f.s.conductReports.length, 1);
});

test('silencing a bell gives no care credit, frees the assigned nurse and retains the need', () => {
  const f = fixture();
  const bell = { res: f.r, need: 'Needs water', nurse: f.helpful };
  f.helpful.bell = bell;
  f.helpful.path = [{ x: 4, z: 4 }];
  f.s.bells.push(bell);
  f.s.waypoint = { bell };
  random(0.99, () => f.act('Silence'));
  assert.equal(f.r.wellbeing, 92);
  assert.equal(f.s.bells.length, 0);
  assert.equal(f.helpful.bell, null);
  assert.deepEqual(f.helpful.path, []);
  assert.equal(f.s.waypoint, null);
  assert.deepEqual(f.r.silencedNeed, { need: 'Needs water', due: 435 });
  assert.equal(f.s.stats.incidents, 1);
});

test('withholding costs exactly 12 wellbeing over three hours, even across a large time advance', () => {
  const f = fixture();
  random(0.99, () => f.act('Withhold'));
  f.s.now = 700;
  for (let minute = 421; minute <= 700; minute++) f.harm.minute(minute);
  assert.ok(Math.abs(f.r.wellbeing - 88) < 1e-9);
});

test('sedation is restricted to the station trolley and persists for four hours', () => {
  const f = fixture();
  f.map.inStation = () => false;
  assert.equal(f.harm.options(f.r).find((o) => o.label.includes('Over-sedate')).disabled, true);
  f.act('Over-sedate');
  assert.equal(f.s.stats.harm, 0);
  f.map.inStation = () => true;
  random(0.99, () => f.act('Over-sedate'));
  assert.equal(f.r.wellbeing, 88);
  assert.equal(f.r.mode, 'bed');
  assert.equal(f.r.sedatedUntil, 660);
  assert.equal(f.harm.options(f.r).find((o) => o.label.includes('Over-sedate')).disabled, true);
  f.s.now = 660;
  assert.equal(f.harm.options(f.r).find((o) => o.label.includes('Over-sedate')).disabled, false);
});

test('serious sedation harm remains possible', () => {
  const f = fixture();
  random(0, () => f.act('Over-sedate'));
  assert.equal(f.r.wellbeing, 53);
  assert.equal(f.s.stats.incidents, 1);
});

test('taking a medicine round allows sedation away from the station', () => {
  const f = fixture();
  f.map.inStation = () => false;
  f.s.medicineRound = true;
  random(0.99, () => f.act('Over-sedate'));
  assert.equal(f.s.stats.harm, 1);
  assert.equal(f.r.sedatedUntil, 660);
});

test('physical trolleys require actively pushing medicine, overriding legacy flags and station access', () => {
  const f = fixture();
  f.s.trolleys = [];
  f.s.medicineRound = true;
  const option = () => f.harm.options(f.r).find((o) => o.label.includes('Over-sedate'));
  assert.equal(option().disabled, true);
  f.s.pushingTrolley = { kind: 'vitals' };
  assert.equal(option().disabled, true);
  f.s.pushingTrolley = { kind: 'med' };
  assert.equal(option().disabled, false);
  random(0.99, () => option().fn());
  assert.equal(f.s.stats.harm, 1);
});

test('remote, dead and paused residents cannot be harmed', () => {
  for (const mutate of [
    (f) => { f.s.player.x = 20; },
    (f) => { f.r.alive = false; },
    (f) => { f.s.paused = true; },
  ]) {
    const f = fixture();
    const option = f.harm.options(f.r).find((o) => o.label.includes('Shout'));
    mutate(f);
    assert.equal(f.harm.options(f.r).length, 0);
    option.fn();
    assert.equal(f.s.stats.harm, 0);
    assert.equal(f.r.wellbeing, 100);
    assert.match(f.toasts.at(-1), /unavailable/);
  }
});

test('visitor reports carry into the next shift and are consumed once', () => {
  const f = fixture();
  random(0, () => f.act('Shout'));
  const rep = f.s.reputation;
  f.s.shiftIdx = 1;
  f.s.stats.harm = 0;
  f.harm.nextShift();
  assert.equal(f.s.reputation, rep - 10);
  assert.equal(f.s.conductReports.length, 0);
  f.harm.nextShift();
  assert.equal(f.s.reputation, rep - 10);
  assert.equal(f.s.stats.harm, 0);
});

test('repeated misconduct opens a persistent inquiry', () => {
  const f = fixture();
  random(0.99, () => { f.act('Shout'); f.act('Shout'); f.act('Shout'); });
  assert.equal(f.s.totalHarm, 3);
  assert.equal(f.s.conductInquiry, true);
});

test('restraint requires a hold, stops movement, drains wellbeing and can be released', async () => {
  const f = fixture();
  const events = {};
  const button = { isConnected: true, addEventListener: (name, fn) => { events[name] = fn; } };
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => button };
  try {
    f.act('Apply restraint');
    assert.equal(f.s.stats.harm, 0);
    const key = { key: ' ', repeat: false, preventDefault() {} };
    events.keydown(key);
    events.keyup(key);
    assert.equal(f.s.stats.harm, 0);
    random(0.99, () => events.keydown(key));
    await new Promise((r) => setTimeout(r, 1550));
    assert.equal(f.r.playerRestrained, true);
    assert.equal(f.r.mesh.userData.mode, 'stand');
    assert.equal(f.r.wellbeing, 85);
    for (let m = 421; m <= 480; m++) f.harm.minute(m);
    assert.ok(Math.abs(f.r.wellbeing - 83) < 1e-9);
    f.harm.options(f.r).find((o) => o.label.includes('Release')).fn();
    assert.equal(f.r.playerRestrained, false);
    assert.equal(f.s.stats.harm, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
