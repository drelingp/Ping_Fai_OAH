import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeathResolver, protectHealth } from '../src/health.js';

function fixture(residents) {
  const s = {
    residents, now: 480, reputation: 70, ended: false, running: true,
    stats: { deaths: 0, log: [] },
  };
  let gameOver = 0, deaths = 0;
  const resolver = createDeathResolver({
    s,
    ui: { toast() {} },
    removeResident(r) { r.alive = false; },
    onDeath() { deaths++; },
    onGameOver() { gameOver++; s.ended = true; s.running = false; },
  });
  return { s, resolver, get gameOver() { return gameOver; }, get deaths() { return deaths; } };
}

test('zero HP kills a resident once and updates death/reputation accounting', () => {
  const patient = { name: 'Patient', alive: true, wellbeing: -1 };
  const survivor = { name: 'Survivor', alive: true, wellbeing: 25 };
  const f = fixture([patient, survivor]);
  f.resolver.resolve();
  f.resolver.resolve();
  assert.equal(patient.alive, false);
  assert.equal(patient.wellbeing, 0);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.s.reputation, 58);
  assert.equal(f.deaths, 1);
  assert.equal(f.gameOver, 0);
});

test('last death immediately ends the run and cannot be processed or revived twice', () => {
  const patient = { name: 'Last patient', alive: true, wellbeing: 0 };
  const f = fixture([patient]);
  f.resolver.resolve();
  patient.wellbeing = 100;
  f.resolver.resolve();
  assert.equal(patient.alive, false);
  assert.equal(patient.wellbeing, 0);
  assert.equal(f.s.ended, true);
  assert.equal(f.s.running, false);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.gameOver, 1);
});

test('health clamps and latches zero before later effects in the same batch can heal', () => {
  const patient = protectHealth({ name: 'Patient', alive: true, wellbeing: 1 });
  patient.wellbeing = 200;
  assert.equal(patient.wellbeing, 100);
  patient.wellbeing = 1;
  patient.wellbeing -= 2;
  patient.wellbeing += 5;
  assert.equal(patient.wellbeing, 0);
  const f = fixture([patient]);
  f.resolver.resolve();
  assert.equal(patient.alive, false);
  assert.equal(f.s.stats.deaths, 1);
  assert.equal(f.gameOver, 1);
});
