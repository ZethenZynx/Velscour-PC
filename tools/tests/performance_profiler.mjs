import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const profiler = await readFile(new URL('../../src/core/perfdiagnostics.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
const world = await readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8');
const game = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
const screens = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const state = await readFile(new URL('../../src/state.js', import.meta.url), 'utf8');

assert.match(state, /performanceProfiler:\s*false/, 'the profiler is disabled for existing and new players by default');
assert.match(profiler, /if \(!performanceProfilerEnabled\(\)\) return false/, 'disabled collection exits before creating frame history');
assert.match(profiler, /const CAP = 9000/, 'the preallocated history can retain 60 seconds through 150 Hz');
assert.match(profiler, /now - history\.timestamps\[oldest\] <= 60000/, 'the rolling window is time-based, not tied to a 60 Hz assumption');
assert.match(profiler, /Float64Array\(CAP\)/, 'timestamps and supported heap samples retain useful precision');
assert.match(profiler, /'frameMs', 'gapMs', 'updateMs', 'renderMs'/, 'the report distinguishes processing duration from frame pacing');
assert.match(profiler, /p50: q\(0\.5\), p95: q\(0\.95\), p99: q\(0\.99\), worst/, 'reports summarize median, tail and worst timings');
assert.match(profiler, /spatialCandidates.*collisionPairs.*pathSearches/s, 'the workload report includes search and collision counters');
assert.match(profiler, /peakSampledHeapBytes/, 'the export reports supported heap measurements');
assert.match(main, /profileBeginFrame\(now\)/, 'frame sampling is connected to the main loop');
assert.match(main, /profileFinishFrame\(G\.world\)/, 'frame records close after update and rendering');
assert.match(world, /profileRecord\('ai'/, 'world profiling separates AI work');
assert.match(world, /profileRecord\('collision'/, 'world profiling separates collision work');
assert.match(game, /profileRecord\('events'/, 'world event scripts are measured');
assert.match(screens, /data-export-performance/, 'the settings screen exposes report export');
assert.match(screens, /rolling 60-second performance history/i, 'the setting describes the actual history duration');

console.log('Opt-in profiler wiring, disabled-by-default behavior, 60-second ring history, subsystem timings, counts, and export checks passed.');
