import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { awardPositive, colleagueHarm, createColleague, offFloor } from '../src/colleague.js';
import { createEscort } from '../src/escort.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture(disposition = 'helpful') {
  const n = { name: 'Colleague', disposition, trust: 50, assigned: [], pos: { x: 0, z: 0 }, path: [], mesh: new THREE.Group() };
  const s = { now: 420, running: true, paused: false, reputation: 70, suspicion: 0, player: { x: 0, z: 0, mesh: new THREE.Group() }, onShift: [n], nurses: [n], residents: [], bells: [], stats: { log: [] } };
  const reports = [], toasts = [];
  const colleague = createColleague({ s, dist, ui: { closePanel() {}, toast: (text) => toasts.push(text) },
    report: (name) => reports.push(name), advance: (minutes) => { s.now += minutes; }, routine: { due: () => [] } });
  colleague.reset();
  return { s, n, colleague, reports, toasts };
}

test('positive conduct earns two points each capped at six per shift', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) { f.s.now += 21; assert.equal(f.colleague.act(f.n, 'praise'), true); }
  assert.equal(f.s.colleagueBonus, 6);
  assert.equal(f.n.trust, 80);
  f.colleague.reset();
  assert.equal(f.s.colleagueBonus, 0);
  assert.equal(awardPositive(f.s, f.n), 2);
});

test('colleague harm deducts five points, shoving eight, and never changes resident harm counts', () => {
  const f = fixture();
  assert.equal(colleagueHarm(f.s, f.n, 'shout').penalty, 5);
  assert.equal(colleagueHarm(f.s, f.n, 'push').penalty, 8);
  assert.equal(f.s.colleaguePenalty, 13);
  assert.equal(f.s.stats.harm, undefined);
  assert.equal(f.n.refusesHelp, true);
  assert.equal(f.n.trust, 14);
});

test('harmful staff retaliate: player staggers for two seconds and loses two minutes', () => {
  const f = fixture('harmful');
  const before = performance.now();
  assert.equal(f.colleague.act(f.n, 'push'), true);
  assert.equal(f.s.now, 422);
  assert.ok(f.s.staggerUntil >= before + 2000);
  assert.equal(f.s.colleaguePenalty, 8);
  assert.equal(f.s.reputation, 64);
});

test('overwhelmed staff cry and leave for thirty minutes, making the floor short-staffed', () => {
  const f = fixture('overwhelmed');
  f.colleague.act(f.n, 'shout');
  assert.equal(f.n.offFloorUntil, 450);
  assert.equal(offFloor(f.n, 449), true);
  assert.equal(offFloor(f.n, 450), false);
  assert.equal(f.n.mesh.visible, false);
  assert.equal(f.reports.length, 0);
});

test('helpful staff report player misconduct and all dispositions refuse help then gossip once', () => {
  for (const disposition of ['helpful', 'harmful', 'overwhelmed']) {
    const f = fixture(disposition);
    f.colleague.act(f.n, 'shout');
    assert.equal(f.n.refusesHelp, true);
    if (disposition === 'helpful') assert.deepEqual(f.reports, [f.n.name]);
    f.s.now += 35;
    assert.equal(f.colleague.reserveHelp(f.n), false);
    const susp = f.s.suspicion;
    f.colleague.minute(f.s.now);
    assert.equal(f.s.suspicion, susp + 4);
    f.colleague.minute(f.s.now);
    assert.equal(f.s.suspicion, susp + 4);
    f.colleague.reset();
    assert.equal(f.n.refusesHelp, false);
  }
});

test('cooldown prevents repeated actions, including captured option callbacks', () => {
  const f = fixture();
  const option = f.colleague.options(f.n).find((o) => o.label.includes('Praise'));
  option.fn(); option.fn();
  assert.equal(f.s.colleagueBonus, 2);
  assert.equal(f.s.stats.colleagueActs, 1);
  f.s.now += 20; option.fn();
  assert.equal(f.s.colleagueBonus, 4);
});

test('a formal report needs evidence; supported misconduct triggers investigation and supervision', () => {
  const f = fixture('harmful');
  f.colleague.act(f.n, 'report');
  assert.equal(f.s.colleagueBonus, 0);
  assert.equal(f.s.reputation, 65);
  f.s.now += 20; f.n.evidenceFound = true;
  f.colleague.act(f.n, 'report');
  assert.equal(f.s.colleagueBonus, 2);
  assert.equal(f.n.supervised, true);
  assert.equal(f.n.investigationPending, true);
  assert.equal(f.n.suspensionRisk, true);
});

test('break cover temporarily reduces floor staff and cancels assigned bells safely', () => {
  const f = fixture();
  const bell = { nurse: f.n }; f.n.bell = bell; f.s.bells.push(bell);
  f.colleague.act(f.n, 'cover');
  assert.equal(f.n.breakUntil, 435);
  assert.equal(bell.nurse, null);
  assert.equal(f.n.bell, null);
  assert.equal(offFloor(f.n, 420), true);
});

test('a colleague refusing the player cannot join an escort', () => {
  const f = fixture(); f.n.refusesHelp = true;
  const r = { alive: true, bed: { x: 10, z: 0 }, pos: { x: 0, z: 0 }, mode: 'wander', mesh: new THREE.Group() };
  const escort = createEscort({ s: f.s, ui: { toast() {} }, map: { colliders: [], path: (_p, to) => [to] },
    dist, rnd: (a) => a, bedSide: (b) => b, placeInBed() {}, nurseGoto() {}, resolveCollisions() {}, gesture() {}, pose() {} });
  escort.start(r, () => {});
  assert.equal(f.s.escort.solo, true);
  assert.equal(f.s.escort.helper, null);
});
