import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChairs } from '../src/chair.js';
import { setLang } from '../src/i18n.js';

function fixture(resolve = () => {}) {
  const resident = {
    name: 'Resident', alive: true, chairEligible: true, wellbeing: 50,
    mobility: 'wheelchair', mode: 'bed', roomId: 'bed1',
    bed: { room: 'bed1', x: 10, z: 10, headDir: 1 },
    pos: { x: 10, z: 10 }, mesh: new THREE.Group(), seat: null,
  };
  const s = {
    residents: [resident], nurses: [], onShift: [], bells: [], player: { x: 10, z: 9, heading: 0 },
    now: 60, running: true, paused: false, ended: false, pushingChair: null,
    pushingTrolley: null, mealTray: false, escort: null,
    stats: { harm: 0, incidents: 0, log: [] },
  };
  const map = {
    colliders: [],
    roomAt: (_x, z) => z >= 48 ? { id: 'garden' } : { id: 'livA' },
    path: (_from, to) => [{ ...to }],
  };
  const toasts = [];
  const ui = { toast: (text) => toasts.push(text), closePanel() {} };
  const harm = {
    checkHealth() {},
    commit(r, action, effect, validate) {
      if (!validate()) return false;
      r.wellbeing -= action.cost;
      s.stats.harm++;
      effect();
      return true;
    },
  };
  const chairs = createChairs({
    s, scene: new THREE.Scene(), map, ui,
    dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    resolveCollisions: resolve, harm, fmtTime: () => '08:00',
  });
  return { s, resident, map, ui, chairs, toasts };
}

test('only care-plan-eligible residents can transfer to and from a chair', () => {
  const f = fixture();
  f.resident.chairEligible = false;
  assert.equal(f.chairs.transfer(f.resident), false);
  f.resident.chairEligible = true;
  assert.equal(f.chairs.transfer(f.resident), true);
  assert.equal(f.resident.mode, 'chair');
  assert.equal(f.resident.chair.pos.z, 8.45);
  assert.equal(f.map.colliders.includes(f.resident.chair.collider), true);
  assert.equal(f.chairs.returnToBed(f.resident), true);
  assert.equal(f.resident.mode, 'bed');
  assert.equal(f.map.colliders.length, 0);
  assert.equal(f.chairs.returnToBed(f.resident), false);
});

test('pushing keeps chair and resident together, parks, and rejects blocked movement', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  f.s.player.z = 9.5;
  assert.equal(f.chairs.push(f.resident), true);
  assert.equal(f.map.colliders.length, 0);
  assert.equal(f.chairs.followPlayer(), true);
  assert.deepEqual(f.resident.pos, f.resident.chair.pos);
  f.chairs.park();
  assert.equal(f.map.colliders.length, 1);
  assert.equal(f.s.pushingChair, null);

  const blocked = fixture((pos) => { pos.x += 1; });
  blocked.chairs.transfer(blocked.resident);
  blocked.s.player.z = 9.5;
  blocked.chairs.push(blocked.resident);
  const before = { ...blocked.resident.pos };
  assert.equal(blocked.chairs.followPlayer(), false);
  assert.deepEqual(blocked.resident.pos, before);
});

test('staff trips reserve a nurse, reach TV, and award only one activity reward', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  const nurse = { name: 'Nurse', pos: { x: 0, z: 0 }, mesh: new THREE.Group(), path: [], wait: 0 };
  f.s.nurses.push(nurse); f.s.onShift.push(nurse);
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
  assert.ok(nurse.chairJob);
  assert.equal(f.chairs.requestStaff(f.resident, 'garden'), false);
  assert.equal(f.resident.alive, true);
  assert.ok(f.resident.chair);
  assert.equal(f.s.ended, false);
  assert.ok(f.s.onShift.includes(nurse));

  for (let frame = 0; frame < 2000 && nurse.chairJob; frame++) f.chairs.advanceStaff(nurse, 0.05);
  assert.equal(nurse.chairJob, null);
  assert.equal(f.resident.roomId, 'livA');
  assert.ok(f.resident.chairActivity);
  f.chairs.minute(f.resident.chairActivity.due);
  assert.equal(f.resident.wellbeing, 55);
  assert.equal(f.resident.lastChairActivity, f.resident.chairActivity?.due ?? 64);
});

test('TV and garden activity rewards share an hourly cooldown', () => {
  setLang('en');
  const f = fixture();
  f.chairs.transfer(f.resident);
  f.resident.pos = { x: 13, z: 2.2 };
  f.resident.chair.pos = { ...f.resident.pos };
  f.s.player = { ...f.resident.pos };
  const action = f.chairs.activityInteraction(f.resident);
  assert.ok(action);
  action.run();
  assert.equal(f.resident.wellbeing, 55);
  assert.equal(f.chairs.activityInteraction(f.resident), null);
  f.s.now += 60;
  f.resident.pos = { x: 10, z: 60 };
  f.resident.chair.pos = { ...f.resident.pos };
  f.s.player = { ...f.resident.pos };
  assert.ok(f.chairs.activityInteraction(f.resident));
});

test('chair ownership excludes two nurses, player pushing, stale actions and remote bed transfers', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  for (let i = 0; i < 2; i++) {
    const nurse = { name: `Nurse ${i}`, pos: { x: 10, z: 9 }, mesh: new THREE.Group(), path: [] };
    f.s.nurses.push(nurse); f.s.onShift.push(nurse);
  }
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
  assert.equal(f.chairs.requestStaff(f.resident, 'garden'), false);
  assert.equal(f.chairs.push(f.resident), false);
  assert.equal(f.chairs.returnToBed(f.resident), false);
  f.s.nurses[0].refusesHelp = true;
  f.chairs.advanceStaff(f.s.nurses[0], 0.05);
  assert.equal(f.resident.chair.owner, null);
  assert.equal(f.map.colliders.includes(f.resident.chair.collider), true);
  const push = f.chairs.options(f.resident).find((option) => /push.*chair/i.test(option.label));
  assert.ok(push);
  f.s.player = { x: 40, z: 40 };
  push.fn();
  assert.equal(f.s.pushingChair, null);
  f.resident.pos = { x: 10, z: 60 };
  f.s.player = { ...f.resident.pos };
  assert.equal(f.chairs.returnToBed(f.resident), false);
  assert.deepEqual(f.resident.pos, { x: 10, z: 60 });
  f.s.paused = true;
  assert.equal(f.chairs.recover(f.resident), false);
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), false);
});

test('death and off-roster agency staff release transport ownership and collider reservations', () => {
  for (const cause of ['death', 'agency']) {
    const f = fixture();
    f.chairs.transfer(f.resident);
    const n = { name: 'Agency nurse', agency: true, pos: { x: 10, z: 9 }, mesh: new THREE.Group(), path: [] };
    f.s.nurses = [n]; f.s.onShift = [n];
    assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
    if (cause === 'death') {
      f.resident.alive = false;
      f.chairs.remove(f.resident);
      assert.equal(f.resident.chair, null);
      assert.equal(f.map.colliders.length, 0);
    } else {
      f.s.onShift = [];
      f.chairs.minute(f.s.now);
      assert.equal(f.resident.chair.owner, null);
      assert.ok(f.map.colliders.includes(f.resident.chair.collider));
    }
    assert.equal(n.chairJob, null);
  }
});

test('garden tipping uses the harm pipeline and leaves a surviving resident recoverable', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  f.resident.pos = { x: 10, z: 60 };
  f.resident.chair.pos = { ...f.resident.pos };
  f.s.player = { ...f.resident.pos, heading: 0 };
  const action = f.chairs.options(f.resident).find((option) => option.label.startsWith('Harm:'));
  assert.ok(action);
  action.fn();
  assert.equal(f.resident.wellbeing, 25);
  assert.equal(f.s.stats.harm, 1);
  assert.equal(f.s.stats.incidents, 1);
  assert.equal(f.resident.mode, 'fallen');
  assert.equal(f.chairs.recover(f.resident), true);
  assert.equal(f.resident.mode, 'chair');
  assert.equal(f.resident.wellbeing, 25);
});

test('simultaneous outings reserve different destination spots before either chair arrives', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  const second = {
    ...f.resident, name: 'Second resident', chair: null, pos: { x: 11.5, z: 8.45 }, mesh: new THREE.Group(),
  };
  f.s.residents.push(second);
  assert.ok(f.chairs.seat(second, second.pos));
  f.s.nurses = f.s.onShift = [0, 1].map((i) => ({
    name: `Nurse ${i}`, pos: { x: 0, z: i }, mesh: new THREE.Group(), path: [],
  }));
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
  f.s.player = { ...second.pos };
  assert.equal(f.chairs.requestStaff(second, 'tv'), true);
  const [a, b] = f.s.nurses.map((n) => n.chairJob.target);
  assert.ok(Math.abs(a.x - b.x) >= 0.96 || Math.abs(a.z - b.z) >= 0.96,
    'reserved chair footprints cannot overlap');
  f.chairs.reset();
  assert.ok(f.s.nurses.every((n) => n.chairJob === null));
});

test('destination selection avoids another occupied chair even while its collider is removed for pushing', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  const other = {
    ...f.resident, name: 'Other resident', chair: null, pos: { x: 13, z: 5.2 }, mesh: new THREE.Group(),
  };
  f.s.residents.push(other);
  f.chairs.seat(other, other.pos);
  f.s.player = { x: 13, z: 6.1 };
  assert.equal(f.chairs.push(other), true);
  assert.ok(!f.map.colliders.includes(other.chair.collider));
  // An existing transport is controlled elsewhere; destination occupancy must not rely on colliders.
  f.s.pushingChair = null;
  f.s.player = { ...f.resident.pos };
  const n = { name: 'Nurse', pos: { x: 0, z: 0 }, mesh: new THREE.Group(), path: [] };
  f.s.nurses = f.s.onShift = [n];
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
  assert.ok(Math.abs(n.chairJob.target.x - other.pos.x) >= 0.96 ||
    Math.abs(n.chairJob.target.z - other.pos.z) >= 0.96);
  f.chairs.reset();
});

test('parking refuses newly occupied space and reset clears the pushing handle even after a failed park', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  f.s.player.z = 9.5;
  assert.equal(f.chairs.push(f.resident), true);
  const point = f.resident.pos;
  f.map.colliders.push({
    minX: point.x - 0.1, maxX: point.x + 0.1, minZ: point.z - 0.1, maxZ: point.z + 0.1,
  });
  assert.equal(f.chairs.park(), false);
  assert.equal(f.s.pushingChair.resident, f.resident);
  assert.equal(f.resident.chair.owner, 'player');
  f.chairs.reset();
  assert.equal(f.s.pushingChair, null);
  assert.equal(f.resident.chair, null);
});

test('a new obstacle near destination cancels explicitly instead of stalling indefinitely', () => {
  const f = fixture();
  f.chairs.transfer(f.resident);
  const n = { name: 'Nurse', pos: { x: 0, z: 0 }, mesh: new THREE.Group(), path: [] };
  f.s.nurses = f.s.onShift = [n];
  assert.equal(f.chairs.requestStaff(f.resident, 'tv'), true);
  Object.assign(f.resident.pos, { x: 13, z: 5.7 });
  Object.assign(f.resident.chair.pos, f.resident.pos);
  f.map.colliders.push({ minX: 12.9, maxX: 13.1, minZ: 5.19, maxZ: 5.21 });
  Object.assign(n.pos, { x: 13, z: 6.42 });
  Object.assign(n.chairJob, {
    phase: 'travel', path: [{ x: 13, z: 5.2 }], lead: 0.72, trail: [{ ...f.resident.pos }],
  });
  const before = { ...f.resident.pos };
  for (let frame = 0; frame < 200 && n.chairJob; frame++) f.chairs.advanceStaff(n, 0.05);
  assert.equal(n.chairJob, null);
  assert.deepEqual(f.resident.pos, before);
  assert.equal(f.resident.chairActivity, undefined);
  assert.equal(f.resident.chair.owner, null);
  assert.match(f.toasts.at(-1), /route.*blocked.*cancelled/i);
});
