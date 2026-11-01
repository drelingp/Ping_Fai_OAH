import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRoutine, scheduleFor, inWindow, eligible, missedEffect, VARIANTS } from '../src/routine.js';
import { createHarm } from '../src/harm.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const r = { id: 1, name: 'Resident', alive: true, mobility: 'bedbound', mode: 'bed', wellbeing: 100, bed: { room: 'single1', x: 0, z: 0 }, pos: { x: 0, z: 0 }, needs: [], hygiene: {}, mesh: new THREE.Group() };
  const n = { name: 'Nurse', disposition: 'harmful', assigned: ['single1'], pos: { x: 10, z: 0 }, mesh: new THREE.Group(), path: [], trust: 40 };
  const s = {
    day: 1, shiftIdx: 0, now: 420, running: true, paused: false, reputation: 70, suspicion: 0, totalHarm: 0,
    residents: [r], nurses: [n], onShift: [n], bells: [], conductReports: [], player: { x: 0, z: 0, mesh: new THREE.Group() },
    stats: { harm: 0, harmReports: 0, incidents: 0, log: [] }, mealTray: true,
  };
  const toasts = [];
  const ui = { toast: (text) => toasts.push(text), closePanel() {}, dialogue() {} };
  let nearby = true;
  const trolleys = { nearby: () => nearby, consumeTray: () => { s.mealTray = false; } };
  const harm = createHarm({ s, ui, map: { roomAt: () => ({ id: 'r' }), inStation: () => false },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), dist, fmtTime: String, case1: { onPlayerHarm() {} } });
  const routine = createRoutine({ s, ui, dist, trolleys, harm, nurseGoto: (n, p) => { n.path = [p]; }, bedSide: (b) => b });
  routine.startShift();
  return { s, r, n, ui, routine, toasts, setNearby: (value) => { nearby = value; } };
}

test('all shift schedules use one-hour windows and night crosses midnight without wrapping', () => {
  for (const [id, start, end] of [['AM', 420, 840], ['PM', 840, 1260], ['NIGHT', 1260, 1860]]) {
    const rounds = scheduleFor(id);
    assert.ok(rounds.length >= 8);
    for (const round of rounds) {
      assert.equal(round.end - round.start, 60);
      assert.ok(round.start >= start && round.end <= end);
      assert.equal(inWindow(round, round.start), true);
      assert.equal(inWindow(round, round.end), false);
    }
    assert.equal(scheduleFor(id, 2)[0].start, rounds[0].start + 1440);
  }
  assert.deepEqual(scheduleFor('NIGHT').filter((r) => r.type === 'turn').map((r) => r.start), [1320, 1440, 1560, 1680, 1800]);
  assert.deepEqual(scheduleFor('AM').filter((r) => r.type === 'meds').map((r) => r.start), [540, 780]);
});

test('turning is bed-bound only and assisted meals follow support needs', () => {
  const f = fixture();
  assert.equal(eligible(f.r, 'turn'), true);
  f.r.mobility = 'walking';
  assert.equal(eligible(f.r, 'turn'), false);
  assert.equal(eligible(f.r, 'feed'), false);
  f.r.needs = ['Full assistance with feeding'];
  assert.equal(eligible(f.r, 'feed'), true);
});

test('missed rounds lower wellbeing, soil pads, flag pressure risk and log once', () => {
  const f = fixture();
  f.s.now = 540;
  f.routine.minute(540);
  assert.equal(f.r.hygiene.body, true);
  assert.equal(f.r.hygiene.bedding, true);
  assert.equal(f.r.pressureRisk, true);
  assert.equal(f.r.wellbeing, 84);
  assert.equal(f.s.stats.routine.missed, 3);
  const count = f.r.careRecords.length;
  f.routine.minute(540);
  assert.equal(f.r.careRecords.length, count);
  assert.match(f.r.careRecords.at(-1).detail, /pressure/);
});

test('care requires nearby trolley or meal tray; completion is idempotent', () => {
  const f = fixture();
  f.s.now = 540;
  const { round, entry } = f.routine.due(f.r)[0];
  f.setNearby(false);
  assert.equal(f.routine.complete(f.r, round, entry), false);
  assert.equal(f.routine.options(f.r).find((o) => o.cls === 'danger').disabled, true);
  f.setNearby(true);
  assert.equal(f.routine.complete(f.r, round, entry), true);
  assert.equal(f.routine.complete(f.r, round, entry), false);
  assert.equal(f.s.stats.routine.done, 1);
  assert.equal(f.r.careRecords.length, 1);
  f.s.now = 720; f.s.mealTray = false;
  const meal = f.routine.due(f.r).find((x) => x.round.type === 'feed');
  assert.equal(f.routine.complete(f.r, meal.round, meal.entry), false);
  f.s.mealTray = true;
  assert.equal(f.routine.complete(f.r, meal.round, meal.entry), true);
  assert.equal(f.s.mealTray, false);
});

test('each harmful routine variant counts exactly one harm and costs eight score points', () => {
  for (const [type, variants] of Object.entries(VARIANTS)) for (const variant of variants) {
    const f = fixture();
    const round = f.s.rounds.find((r) => r.type === type);
    const entry = round.entries[0];
    f.s.now = round.start;
    f.s.onShift = [];
    assert.equal(f.routine.harmful(f.r, round, entry, variant), true);
    assert.equal(f.routine.harmful(f.r, round, entry, variant), false);
    assert.equal(f.s.stats.harm, 1);
    assert.equal(f.s.stats.harm * 8, 8);
    assert.equal(f.s.totalHarm, 1);
    assert.equal(f.r.wellbeing, 100 - variant.cost);
    assert.equal(f.r.careRecords.length, 1);
    f.routine.minute(round.end);
    assert.equal(f.s.stats.harm, 1);
    if (variant.id === 'wetPad') assert.equal(f.r.hygiene.body, true);
    if (type === 'turn') assert.equal(f.r.pressureRisk, true);
    if (variant.id === 'wrong') assert.ok(f.r.medicationConcernUntil > f.s.now);
  }
});

test('harmful care reuses witness reporting and rejects stale, remote or unavailable actions', () => {
  const f = fixture();
  f.s.now = 540;
  const { round, entry } = f.routine.due(f.r)[0], variant = VARIANTS.meds[0];
  f.n.disposition = 'helpful'; f.n.pos.x = 1;
  const random = Math.random;
  Math.random = () => 0;
  try { assert.equal(f.routine.harmful(f.r, round, entry, variant), true); } finally { Math.random = random; }
  assert.equal(f.s.stats.harmReports, 1);
  const g = fixture(); g.s.now = 540; g.s.player.x = 20;
  const job = g.routine.due(g.r)[0];
  assert.equal(g.routine.harmful(g.r, job.round, job.entry, variant), false);
  assert.equal(g.s.stats.harm, 0);
});

test('NPC false charting is visible in records and counts separately from player harm', () => {
  const f = fixture(); f.s.now = 450;
  const random = Math.random; Math.random = () => 0;
  try { assert.equal(f.routine.npcNext(f.n), true); } finally { Math.random = random; }
  assert.equal(f.s.stats.routine.falseCharted, 1);
  assert.equal(f.s.stats.harm, 0);
  assert.equal(f.r.hygiene.body, true);
  assert.match(f.r.careRecords[0].detail, /not seen at bedside/);
  f.routine.notes(f.r);
  assert.equal(f.n.evidenceFound, true);
});

test('NPC bedside rounds respect room allocation and release jobs after care', () => {
  const f = fixture(); f.s.now = 450; f.n.disposition = 'helpful';
  f.n.assigned = ['bed1'];
  assert.equal(f.routine.npcNext(f.n), false);
  f.n.assigned = ['single1'];
  assert.equal(f.routine.npcNext(f.n), true);
  f.n.pos = { x: 0, z: 0 }; f.n.path = [];
  f.routine.npcUpdate(f.n, 2);
  assert.equal(f.s.stats.routine.npcDone, 1);
  assert.equal(f.n.routineJob, null);
});

test('round announcements happen once and waypoints choose the next allocated resident', () => {
  const f = fixture(); f.s.now = 450;
  f.routine.minute(450); f.routine.minute(451);
  assert.equal(f.toasts.length, 1);
  f.routine.waypoint(f.s.rounds[0].id);
  assert.equal(f.s.waypoint.ref, f.r);
  assert.equal(f.routine.rows()[0].total, 1);
  f.routine.complete(f.r, f.s.rounds[0], f.s.rounds[0].entries[0]);
  assert.equal(f.s.waypoint, null);
});
