import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY, DEFAULT_DIFFICULTY, bellChance } from '../src/data.js';

test('difficulty sets the mean minutes between random call bells', () => {
  assert.equal(DEFAULT_DIFFICULTY, 'normal');
  assert.equal(bellChance('easy', 'AM', 1, 0), 1 / 60);
  assert.equal(bellChance('normal', 'PM', 1, 0), 1 / 35);
  assert.equal(bellChance('hard', 'AM', 1, 0), 1 / 20);
});

test('night shift stays 1.5x slower and short staffing raises the rate', () => {
  assert.equal(bellChance('hard', 'NIGHT', 1, 0), 1 / 30);
  assert.equal(bellChance('normal', 'AM', 0.5, 0), 1 / 17.5);
});

test('difficulty caps how many random bells can be open at once', () => {
  for (const [d, { maxBells }] of Object.entries(DIFFICULTY)) {
    assert.ok(bellChance(d, 'AM', 1, maxBells - 1) > 0, `${d} below cap`);
    assert.equal(bellChance(d, 'AM', 1, maxBells), 0, `${d} at cap`);
  }
  assert.deepEqual(Object.values(DIFFICULTY).map((x) => x.maxBells), [3, 4, 6]);
});

test('unknown difficulty falls back to normal', () => {
  assert.equal(bellChance('toString', 'AM', 1, 0), 1 / 35);
  assert.equal(bellChance(undefined, 'AM', 1, 0), 1 / 35);
});
