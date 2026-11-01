import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY, DEFAULT_DIFFICULTY, GAME_MINUTES_PER_SECOND, RANDOM_BELL_QUIET_MINUTES, bellChance } from '../src/data.js';

test('clock advances one game hour every 30 real seconds', () => {
  assert.equal(GAME_MINUTES_PER_SECOND * 30, 60);
});

test('difficulty sets the mean minutes between random call bells', () => {
  assert.equal(DEFAULT_DIFFICULTY, 'normal');
  assert.equal(bellChance('easy', 'AM', 1, 0), 1 / 121);
  assert.equal(bellChance('normal', 'PM', 1, 0), 1 / 61);
  assert.equal(bellChance('hard', 'AM', 1, 0), 1 / 31);
});

test('night shift stays 1.5x slower and short staffing raises the rate', () => {
  assert.equal(bellChance('hard', 'NIGHT', 1, 0), 1 / 76);
  assert.equal(bellChance('normal', 'AM', 0.5, 0), 1);
});

test('random bells respect the quiet period and include it in the configured mean', () => {
  assert.equal(RANDOM_BELL_QUIET_MINUTES, 60);
  assert.equal(bellChance('normal', 'AM', 1, 0, 59), 0);
  assert.equal(bellChance('normal', 'AM', 1, 0, 60), 1 / 61);
  assert.equal(RANDOM_BELL_QUIET_MINUTES - 1 + 1 / bellChance('normal', 'AM', 1, 0, 60), DIFFICULTY.normal.bellEvery);
});

test('difficulty caps how many random bells can be open at once', () => {
  for (const [d, { maxBells }] of Object.entries(DIFFICULTY)) {
    assert.ok(bellChance(d, 'AM', 1, maxBells - 1) > 0, `${d} below cap`);
    assert.equal(bellChance(d, 'AM', 1, maxBells), 0, `${d} at cap`);
  }
  assert.deepEqual(Object.values(DIFFICULTY).map((x) => x.maxBells), [3, 4, 6]);
});

test('unknown difficulty falls back to normal', () => {
  assert.equal(bellChance('toString', 'AM', 1, 0), 1 / 61);
  assert.equal(bellChance(undefined, 'AM', 1, 0), 1 / 61);
});

test('discrete interval distributions include the quiet floor and preserve full night means', () => {
  for (const [difficulty, config] of Object.entries(DIFFICULTY)) {
    for (const shift of ['AM', 'NIGHT']) for (const staff of [1, 0.8, 0.5]) {
      let survival = 1, mean = 0, probability = 0;
      for (let minute = 1; minute < 12000; minute++) {
        const p = bellChance(difficulty, shift, staff, 0, minute);
        const mass = survival * p;
        if (minute < 60) assert.equal(mass, 0);
        mean += minute * mass; probability += mass; survival *= 1 - p;
      }
      const expected = Math.max(60, config.bellEvery * (shift === 'NIGHT' ? 1.5 : 1) * staff);
      assert.ok(Math.abs(probability - 1) < 1e-10);
      assert.ok(Math.abs(mean - expected) < 1e-8, `${difficulty}/${shift}/${staff}: ${mean} vs ${expected}`);
    }
  }
});
