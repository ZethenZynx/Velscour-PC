import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_BUDGET_MS, summarizeFrameSpikes } from '../../src/core/performance-analysis.js';

const frame = (overrides = {}) => ({
  timestampUtc: '2026-11-24T22:00:00.000Z', elapsedSeconds: 1,
  gapMs: 8, frameMs: 3, updateMs: 1, renderMs: 2,
  pageVisible: true, pageFocused: true, depthDrawMs: 0.1,
  ...overrides,
});

test('does not report frames within the 60 Hz budget', () => {
  assert.deepEqual(summarizeFrameSpikes([frame()]), []);
});

test('distinguishes a callback gap from expensive game processing', () => {
  const [gap, work] = summarizeFrameSpikes([
    frame({ gapMs: 23, frameMs: 4, updateMs: 1, renderMs: 3 }),
    frame({ gapMs: 12, frameMs: 19, updateMs: 3, renderMs: 16, depthDrawMs: 12 }),
  ]);
  assert.equal(gap.kind, 'callback-gap');
  assert.equal(gap.workVsGap, 0.174);
  assert.equal(work.kind, 'game-processing');
  assert.deepEqual(work.expensiveSubsystems, [{ subsystem: 'depthDraw', ms: 12 }]);
});

test('uses the 60 Hz threshold and returns the largest gaps first with a bounded list', () => {
  const frames = Array.from({ length: 150 }, (_, i) => frame({ gapMs: FRAME_BUDGET_MS + i }));
  const spikes = summarizeFrameSpikes(frames);
  assert.equal(spikes.length, 100);
  assert.equal(spikes[0].gapMs, frames.at(-1).gapMs);
  assert.equal(spikes.at(-1).gapMs, frames[50].gapMs);
});
