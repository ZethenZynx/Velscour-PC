import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSampleCounts } from '../../src/core/perf-count-sampling.mjs';

test('keeps periodic entity sampling between world transitions', () => {
  const world = {};
  assert.equal(shouldSampleCounts(0, null, world), true);
  assert.equal(shouldSampleCounts(1, world, world), false);
  assert.equal(shouldSampleCounts(14, world, world), false);
  assert.equal(shouldSampleCounts(15, world, world), true);
});

test('forces an entity resample on the first frame in a different world', () => {
  const dungeon = { id: 1 }, town = { id: 2 };
  assert.equal(shouldSampleCounts(7, dungeon, town), true);
  assert.equal(shouldSampleCounts(8, town, town), false);
});
