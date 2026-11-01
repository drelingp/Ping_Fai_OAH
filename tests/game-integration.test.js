import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { furnishedFloor } from './helpers/floor.js';

await furnishedFloor();
const { buildMap } = await import('../src/map.js');
const { createGame } = await import('../src/game.js');
const { localPath, clearSegment } = await import('../src/navigation.js');

function fixture() {
  const scene = new THREE.Scene(), map = buildMap(scene);
  const input = { moveX: 0, moveZ: 0, fast: false };
  const player = { x: 13, z: 4, heading: 0, mesh: new THREE.Group() };
  const panels = [], toasts = [];
  const ui = new Proxy({
    panelOpen: false,
    openPanel(html, options = {}) { this.panelOpen = true; panels.push({ html, ...options }); },
    dialogue(speaker, text, options, extra, panelOptions) {
      this.panelOpen = true; panels.push({ speaker, text, options, ...panelOptions });
    },
    closePanel() { this.panelOpen = false; },
    setResidents(count) { this.residentCount = count; },
    toast(message) { toasts.push(message); },
  }, { get: (object, key) => object[key] ?? (() => {}) });
  const game = createGame({ scene, map, ui, input, player, env: { setShift() {} } });
  const original = Math.random;
  Math.random = () => 0.9;
  try { game.start(); } finally { Math.random = original; }
  ui.closePanel();
  const s = game.state;
  s.onShift = [];
  game.case1.state.care = { released: true, bag: true, washed: true };
  const resident = s.residents.find((r) => !r.case && !r.single);
  return { game, s, ui, player, map, input, panels, toasts, resident };
}

function livingOnly(f, residents) {
  for (const r of f.s.residents) if (!residents.includes(r)) r.alive = false;
}

test('full game clock preserves normal/menu/emergency/pause and explicit game-minute costs', () => {
  const f = fixture(), start = f.s.now;
  for (let i = 0; i < 600; i++) f.game.update(0.05, 0);
  assert.ok(Math.abs(f.s.now - start - 60) < 1e-8);
  f.s.bells = [];
  f.ui.panelOpen = true;
  const menu = f.s.now;
  for (let i = 0; i < 200; i++) f.game.update(0.05, 0);
  assert.ok(Math.abs(f.s.now - menu - 5) < 1e-8);
  f.s.bells = [{ id: 99, res: f.resident, urgent: true, start: f.s.now, need: 'Help', caseBell: true }];
  const emergency = f.s.now;
  for (let i = 0; i < 200; i++) f.game.update(0.05, 0);
  assert.ok(Math.abs(f.s.now - emergency - 20) < 1e-8);
  f.s.paused = true;
  const pause = f.s.now;
  f.game.update(10, 0);
  assert.equal(f.s.now, pause);
  f.s.paused = false;
  f.game.advance(7);
  assert.equal(f.s.now, pause + 7);
});

test('a time-costing held wash cannot run on its dead target while another resident survives', () => {
  const f = fixture(), r = f.resident;
  livingOnly(f, [r, f.s.residents[0]]);
  r.wellbeing = 0.05; r.withholdUntil = 600;
  r.mode = 'bed'; r.pos = { x: r.bed.x, z: r.bed.z };
  r.hygiene.body = r.hygiene.bedding = true;
  Object.assign(f.player, { x: r.pos.x, z: r.pos.z - r.bed.headDir * 1.55 });
  f.s.now = 421; f.s.nextMinute = 422;
  f.game.update(0, 0);
  assert.match(f.game.interaction().label, /Wash & change/);
  f.input.onInteractDown();
  f.game.update(0, 0, 3);
  assert.equal(r.alive, false);
  assert.equal(r.wellbeing, 0);
  assert.equal(r.hygiene.body, true);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.s.now, 436);
  assert.equal(f.s.ended, false);
});

test('pausing during a hold suspends both care progress and its game-minute cost', () => {
  const f = fixture(), r = f.resident;
  r.mode = 'bed'; r.pos = { x: r.bed.x, z: r.bed.z }; r.hygiene.body = true;
  Object.assign(f.player, { x: r.pos.x, z: r.pos.z - r.bed.headDir * 1.55 });
  f.game.update(0, 0); f.input.onInteractDown();
  f.game.update(0, 0, 1);
  f.s.paused = true; f.ui.panelOpen = true;
  const now = f.s.now;
  f.game.update(10, 0, 10);
  assert.equal(f.s.now, now);
  assert.equal(r.hygiene.body, true);
  f.s.paused = false; f.ui.closePanel();
  f.game.update(0, 0, 2);
  assert.equal(r.hygiene.body, false);
  assert.equal(f.s.now, now + 15);
});

test('lethal NPC false charting is resolved before simultaneous care can heal the resident', () => {
  const f = fixture(), r = f.resident, n = f.s.nurses[0];
  r.mobility = 'bedbound'; r.wellbeing = 1;
  f.s.now = 480; f.s.nextMinute = 481;
  f.game.routine.startShift();
  n.assigned = [r.bed.room]; n.pos = { x: 13.7, z: 4 }; n.disposition = 'harmful';
  f.s.onShift = [n];
  const original = Math.random;
  Math.random = () => 0;
  try { assert.equal(f.game.routine.npcNext(n), true); } finally { Math.random = original; }
  assert.equal(r.alive, false);
  assert.equal(r.wellbeing, 0);
  const breakfast = f.s.rounds.find((round) => round.type === 'feed' && round.start === 480);
  const entry = breakfast.entries.find((item) => item.r === r);
  assert.equal(f.game.routine.complete(r, breakfast, entry, 'Nurse'), false);
  f.game.advance(1);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(r.wellbeing, 0);
});

test('lethal natural losses cannot be reversed by same-minute nearby reassurance', () => {
  const f = fixture(), r = f.resident, n = f.s.nurses[0];
  r.wellbeing = 0.001; r.hygiene = {};
  n.assigned = [r.roomId]; n.disposition = 'harmful'; n.supervised = false;
  f.s.onShift = [n];
  Object.assign(f.player, r.pos);
  f.game.advance(1);
  assert.equal(r.alive, false);
  assert.equal(r.wellbeing, 0);
  assert.equal(f.s.stats.deaths, 1);
});

test('case chart/CCTV callbacks cannot replace final-death Restart or add evidence afterward', () => {
  for (const method of ['records', 'office']) {
    const f = fixture(), r = f.resident;
    livingOnly(f, [r]);
    r.wellbeing = 0.01; r.withholdUntil = 600;
    f.s.now = 421; f.s.nextMinute = 422;
    f.game.case1.state.stage = 'confronted';
    f.game.case1[method]();
    const action = f.panels.at(-1).options.find((option) => /10 min|15 min/.test(option.label));
    action.fn();
    assert.equal(f.s.ended, true);
    assert.equal(f.panels.at(-1).speaker, 'Game Over');
    assert.equal(f.panels.at(-1).terminal, true);
    assert.equal(f.panels.at(-1).options[0].label, 'Restart run');
    assert.equal(f.game.case1.state.evidence[method === 'records' ? 'records' : 'cctv'], undefined);
    assert.equal(f.s.stats.deaths, 1);
    const now = f.s.now;
    f.game.advance(1000); f.game.update(1000, 0);
    assert.equal(f.s.now, now);
  }
});

test('lethal chair harm keeps exactly-once accounting, releases the chair and leaves Restart callable', () => {
  const f = fixture(), r = f.resident;
  livingOnly(f, [r]);
  r.chairEligible = true;
  f.game.chairs.seat(r, { x: 10, z: 60 });
  Object.assign(f.player, r.pos);
  r.wellbeing = 20;
  const option = f.game.chairs.options(r).find((item) => item.cls === 'danger');
  option.fn();
  f.game.harm.checkHealth();
  assert.equal(r.alive, false);
  assert.equal(r.wellbeing, 0);
  assert.equal(r.chair, null);
  assert.equal(f.s.stats.harm, 1);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.ui.residentCount, 0);
  assert.equal(f.s.ended, true);
  const oldLocation = globalThis.location;
  let restarts = 0;
  globalThis.location = { reload: () => restarts++ };
  try { f.panels.at(-1).options[0].fn(); } finally { globalThis.location = oldLocation; }
  assert.equal(restarts, 1);
});

test('lethal witness distress cleans up the moved resident and their reserved nurse once', () => {
  const f = fixture(), actor = f.resident, victim = f.s.residents.find((r) => r !== actor && !r.case);
  actor.mode = 'wander'; actor.pos = { x: 13.7, z: 4 }; actor.mesh.position.set(13.7, 0, 4);
  victim.chairEligible = true;
  f.game.chairs.seat(victim, { x: 13, z: 5.2 });
  victim.wellbeing = 1;
  Object.assign(f.player, actor.pos);
  const n = f.s.nurses[0];
  n.pos = { x: 13.7, z: 6 }; n.path = []; n.bell = n.routineJob = null;
  n.disposition = 'helpful'; f.s.onShift = [n];
  assert.equal(f.game.chairs.requestStaff(victim, 'garden'), true);
  f.s.waypoint = { ref: victim, ...victim.pos };
  const original = Math.random;
  Math.random = () => 0.9;
  try { assert.equal(f.game.harm.act(actor, { id: 'shout', label: 'Shout at resident', cost: 6 }), true); }
  finally { Math.random = original; }
  assert.equal(victim.alive, false);
  assert.equal(victim.wellbeing, 0);
  assert.equal(victim.chair, null);
  assert.equal(n.chairJob, null);
  assert.equal(victim.bed.occupant, null);
  assert.equal(f.s.waypoint, null);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.s.stats.harm, 1);
});

test('moved bell waypoints and nurse care follow the live resident, never the old bed', () => {
  const f = fixture(), r = f.resident, n = f.s.nurses[0];
  r.chairEligible = true;
  f.game.chairs.seat(r, { x: 10, z: 60 });
  r.wellbeing = 50;
  const bell = { id: 100, res: r, need: 'Help', urgent: false, start: 420, nurse: n };
  f.s.bells = [bell]; f.s.onShift = [n];
  n.bell = bell; n.path = []; n.bellTimer = 0;
  n.pos = { x: r.bed.x, z: r.bed.z - r.bed.headDir * 1.6 };
  f.ui.onBannerTap(100);
  assert.equal(f.s.waypoint.ref, r);
  assert.equal(f.s.waypoint.z, 60);
  f.ui.closePanel();
  f.game.update(0.05, 0);
  assert.equal(f.s.bells.length, 1);
  assert.equal(r.wellbeing, 50);
  assert.ok(n.path.length > 0);
  n.pos = { x: r.pos.x, z: r.pos.z - 1 };
  f.game.update(6, 0);
  assert.equal(f.s.bells.length, 0);
  assert.ok(r.wellbeing >= 56);
});

test('beforeTime care still completes before paying its game-minute cost', () => {
  const f = fixture(), r = f.resident;
  r.mobility = 'bedbound'; r.mode = 'bed'; r.hygiene = {}; r.wellbeing = 1;
  r.pos = { x: r.bed.x, z: r.bed.z }; r.withholdUntil = 600;
  f.s.now = 480; f.s.nextMinute = 481;
  f.game.routine.startShift();
  const turn = f.s.rounds.find((round) => round.type === 'turn' && round.start === 480);
  const entry = turn.entries.find((item) => item.r === r);
  f.s.routineFocus = { r, roundId: turn.id };
  Object.assign(f.player, { x: r.pos.x, z: r.pos.z - r.bed.headDir * 1.55 });
  f.game.update(0, 0);
  assert.equal(f.game.interaction().beforeTime, true);
  f.input.onInteractDown(); f.game.update(0, 0, 2);
  assert.equal(entry.status, 'done');
  assert.equal(r.alive, true);
  assert.ok(r.wellbeing > 4);
  assert.equal(f.s.now, 484);
});

test('the player cannot own a chair and restraint escort at once, in either direction', () => {
  const f = fixture(), r = f.resident;
  r.chairEligible = true;
  f.game.chairs.seat(r, { x: 13, z: 7.4 });
  Object.assign(f.player, { x: 13, z: 6.52 });
  assert.equal(f.game.chairs.push(r), true);
  const other = f.s.residents.find((item) => item !== r && item.mobility === 'walking');
  assert.equal(f.game.escort.start(other), false);
  assert.equal(f.s.escort, undefined);
  f.game.chairs.park();
  other.mode = 'wander';
  assert.equal(f.game.escort.start(other), true);
  assert.equal(f.game.chairs.push(r), false);
  f.game.escort.cancel('silent');
  assert.equal(f.game.chairs.push(r), true);
});

test('real input pushes a chair down the furnished lounge without clipping and parks safely', () => {
  const f = fixture(), r = f.resident;
  r.chairEligible = true;
  f.game.chairs.seat(r, { x: 13, z: 7.4 });
  Object.assign(f.player, { x: 13, z: 6.52 });
  assert.equal(f.game.chairs.push(r), true);
  f.input.moveZ = 1;
  for (let frame = 0; frame < 140; frame++) {
    const before = { ...r.pos };
    f.game.update(0.05, 0);
    assert.ok(clearSegment(before, r.pos, 0.48, [...f.map.colliders, ...f.map.chairParkingObstacles]));
  }
  assert.ok(r.pos.z > 13, `chair stopped at ${r.pos.z}`);
  f.input.moveZ = 0;
  f.game.chairs.park();
  assert.equal(f.s.pushingChair, null);
  assert.ok(f.map.colliders.includes(r.chair.collider));
});

test('a representative allocated turning round remains completable with real walking and holds at the faster clock', () => {
  const f = fixture();
  f.s.onShift = f.s.nurses.filter((n) => n.shift === 'AM');
  for (const n of f.s.onShift) n.wait = Infinity;
  f.s.now = 480; f.s.nextMinute = 481;
  f.game.routine.startShift();
  for (const round of f.s.rounds) if (round.start < 480) {
    for (const entry of round.entries) entry.status = 'done';
  }
  for (const r of f.s.residents) r.hygiene = {};
  const round = f.s.rounds.find((item) => item.type === 'turn' && item.start === 480);
  const entries = round.entries.filter((entry) => entry.r.single);
  assert.equal(entries.length, 2);
  const first = entries[0].r.bed;
  Object.assign(f.player, { x: first.x, z: first.z - first.headDir * 1.6 });
  const original = Math.random;
  Math.random = () => 0.99;
  try {
    for (const entry of entries) {
      const r = entry.r, bedside = { x: r.bed.x, z: r.bed.z - r.bed.headDir * 1.6 };
      const path = localPath(f.map, f.player, bedside, 0.3);
      assert.ok(path);
      for (const point of path) {
        let steps = 0;
        while (Math.hypot(f.player.x - point.x, f.player.z - point.z) > 0.08 && steps++ < 1000) {
          const dx = point.x - f.player.x, dz = point.z - f.player.z, d = Math.hypot(dx, dz);
          const speed = Math.min(1, d / (2.6 * 0.05));
          f.input.moveX = dx / d * speed; f.input.moveZ = dz / d * speed;
          f.game.update(0.05, 0);
        }
        assert.ok(steps < 1000, 'walking route blocked');
      }
      f.input.moveX = f.input.moveZ = 0;
      f.s.routineFocus = { r, roundId: round.id };
      f.game.update(0, 0);
      assert.match(f.game.interaction().label, /Turning/);
      f.input.onInteractDown();
      for (let frame = 0; frame < 37; frame++) f.game.update(0.05, 0);
      assert.equal(entry.status, 'done');
    }
    assert.ok(f.s.now < round.end, `round finished at ${f.s.now}, deadline ${round.end}`);
    assert.equal(f.s.stats.routine.done, 2);
  } finally { Math.random = original; }
});
