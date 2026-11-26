import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_BUDGET_MS, summarizeFrameGroups, summarizeFrameSpikes } from '../../src/core/performance-analysis.js';

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

test('groups report summaries by world, environment, and actual render scale', () => {
  const groups = summarizeFrameGroups([
    frame({ worldKind: 'dungeon', environment: 'Plague Sewers', resolutionScale: 0.75, frameMs: 10, gapMs: 17, updateMs: 3, renderMs: 7 }),
    frame({ worldKind: 'dungeon', environment: 'Plague Sewers', resolutionScale: 0.75, frameMs: 20, gapMs: 25, updateMs: 4, renderMs: 16 }),
    frame({ worldKind: 'town', environment: 'Tessariel’s Keep', resolutionScale: 1, frameMs: 8, gapMs: 12, updateMs: 2, renderMs: 6 }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    worldKind: 'dungeon', environment: 'Plague Sewers', resolutionScale: 0.75, frameCount: 2,
    frameMs: { median: 10, p95: 10, p99: 10, worst: 20 },
    gapMs: { median: 17, p95: 17, p99: 17, worst: 25 },
    updateMs: { median: 3, p95: 3, p99: 3, worst: 4 },
    renderMs: { median: 7, p95: 7, p99: 7, worst: 16 },
  });
  assert.equal(groups[1].resolutionScale, 1);
  assert.equal(groups[1].environment, 'Tessariel’s Keep');
});
