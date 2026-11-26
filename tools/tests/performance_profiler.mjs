import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeFrameGroups, summarizeFrameSpikes } from '../../src/core/performance-analysis.js';

const profiler = await readFile(new URL('../../src/core/perfdiagnostics.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
const world = await readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8');
const game = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
const render = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
const screens = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const state = await readFile(new URL('../../src/state.js', import.meta.url), 'utf8');
const resolution = await readFile(new URL('../../src/core/render-resolution.mjs', import.meta.url), 'utf8');
const buildVersion = await readFile(new URL('../../src/data/build-version.js', import.meta.url), 'utf8');
const keepfolk = await readFile(new URL('../../src/game/keepfolk.js', import.meta.url), 'utf8');
const performanceAnalysis = await readFile(new URL('../../src/core/performance-analysis.js', import.meta.url), 'utf8');

assert.match(state, /developerMode:\s*false/, 'Developer Mode is disabled for existing and new players by default');
assert.match(profiler, /if \(!performanceProfilerEnabled\(\)\) return false/, 'disabled collection exits before creating frame history');
assert.match(profiler, /const CAP = 27000/, 'the bounded history can retain three minutes through 150 Hz');
assert.match(profiler, /completeSessionStatistics/, 'streaming statistics cover the complete manual recording');
assert.match(profiler, /detailedFramesTruncated/, 'bounded frame detail reports truncation explicitly');
assert.match(profiler, /Float64Array\(CAP\)/, 'timestamps and supported heap samples retain useful precision');
assert.match(profiler, /'frameMs', 'gapMs', 'updateMs', 'renderMs'/, 'the report distinguishes processing duration from frame pacing');
assert.match(profiler, /p50: q\(0\.5\), p95: q\(0\.95\), p99: q\(0\.99\), worst/, 'reports summarize median, tail and worst timings');
assert.match(profiler, /spatialCandidates.*collisionPairs.*pathSearches/s, 'the workload report includes search and collision counters');
assert.match(profiler, /peakRetainedFrameSampleHeapBytes/, 'the export reports the peak heap from bounded session samples with its sampling scope explicit');
assert.match(profiler, /renderSetupMs.*floorDrawMs.*groundDrawMs.*renderSortMs.*depthDrawMs.*effectDrawMs.*lightingMs.*screenOverlayMs/s, 'the export separates major rendering stages');
assert.match(profiler, /Array\.from\(\{ length: 16 \}.*depthDrawKind\$\{kind\}Ms/, 'the profiler has bounded per-kind draw timing buckets');
assert.match(render, /depthDrawSamples[it.f].*performance.now()/s, 'per-kind depth draw timing samples are recording-only and amortized');
assert.match(profiler, /history\.renderSetupMs\[at\]\s*=\s*phases\.renderSetupMs[\s\S]*history\.automapMs\[at\]\s*=\s*phases\.automapMs/, 'each render-stage timing is copied into the exported rolling history');
assert.match(profiler, /particleDrawMs.*topHazardDrawMs.*topEffectDrawMs/s, 'the top effects stage is split into ambient, particle, hazard, and effect timings');
assert.match(profiler, /skyFrontMs.*seeThroughMs.*screenFeedbackMs.*hudLabelsMs.*combatTextMs.*cinematicOverlayMs/s, 'large screen-space rendering stages are separated for spike diagnosis');
assert.match(profiler, /visibleParticles:\s*world\?\._perfVisibleParticles/, 'visible particle workload is counted separately from retained particles');
assert.match(profiler, /resolutionScale.*devicePixelRatio.*canvasWidth.*canvasHeight/s, 'per-frame reports capture backing-store resolution');
assert.match(profiler, /frameSummariesByEnvironmentAndResolution:\s*summarizeFrameGroups\(frames\)/, 'exported diagnostics separate statistics by environment and render scale');
assert.match(buildVersion, /GAME_BUILD_ID = 'fork-main-dynamic-potion-labels-2026-11-26'/, 'reports identify this deployed source build instead of using generic development');
assert.match(game, /profileExternalTiming\('breach\.entryTotal'/, 'Eternal Breach reports full asynchronous entry time');
for (const stage of ['requiredArtLoad', 'buildAndSpawn', 'creatureArtLoad', 'levelArtWarm', 'previousArtRelease']) {
  assert.match(game, new RegExp(`profileExternalTiming\\('breach\\.${stage}'`), `Eternal Breach reports ${stage}`);
}
assert.match(profiler, /completeFrameTimeDistributions.*p50.*p90.*p95.*p99.*p99_9/s, 'complete-session frame distributions remain available after detailed frame samples wrap');
assert.match(main, /renderResolutionScale\(G\.settings\)/, 'backing-store resolution follows the selected graphics preset');
assert.doesNotMatch(main, /adaptRes|ar\.upAt/, 'performance variation no longer silently changes render resolution');
assert.match(resolution, /graphicsPreset === 'extreme' \? 0\.7 : 1/, 'standard rendering retains native resolution and only the explicit preset reduces backing-store scale');
assert.match(profiler, /renderQueue.*renderViews.*renderCreatures.*renderWalls.*renderProps.*renderLoot/s, 'per-frame counts include visible rendering work');
assert.match(main, /profileBeginFrame\(now,/, 'frame sampling records RAF and simulation timing in the main loop');
assert.match(main, /profileFinishFrame\(G\.world\)/, 'frame records close after update and rendering');
assert.match(main, /observeAdaptivePerformance\(raw, G\.settings/, 'adaptive cosmetic quality is driven by sustained frame pacing');
assert.match(main, /applyPerformanceQuality\(\)/, 'quality changes trim active particle workload immediately');
assert.match(world, /profileRecord\('ai'/, 'world profiling separates AI work');
assert.match(world, /profileRecord\('playerUpdate'/, 'player work is timed separately within the AI phase');
assert.match(world, /profileRecordAIUpdate\(/, 'the slowest individual AI callback is captured');
assert.match(world, /inactiveEnemiesSkipped.*deadCreaturesSkipped/s, 'recordings distinguish inactive and dead creature skips from updated creatures');
assert.match(world, /creatureCallbacksMs.*creatureUpdateOverhead/s, 'the creature update pass exposes callback time versus loop/filter overhead');
assert.match(profiler, /keepDirectorUpdateMs.*keepCompanionUpdateMs.*keepFolkUpdateMs.*townAgentUpdateMs/s, 'reports separate Keep directors, companions, townsfolk, and town agents');
assert.match(profiler, /externalTimings/, 'transition work outside animation frames is exported separately');
assert.match(game, /profileExternalTiming\('keep\.build'/, 'Keep build work is timed outside the animation frame');
assert.match(game, /profileExternalTiming\('keep\.entryTotal'/, 'total Keep entry work is timed across async boundaries');
assert.doesNotMatch(keepfolk.slice(keepfolk.indexOf('function director'), keepfolk.indexOf('function director') + 900), /keepSpots\(w\.layout\)/, 'the Keep companion director reuses precomputed walk spots');
assert.match(performanceAnalysis, /percentOver60HzBudget/, 'environment summaries include frame-budget failure rates');
const sampleFrames = [
  { worldKind: 'town', environment: "Tessariel's Keep", frameMs: 4, gapMs: 8, updateMs: 1, renderMs: 3, aiSlowestCallback: '' },
  { worldKind: 'town', environment: "Tessariel's Keep", frameMs: 22, gapMs: 25, updateMs: 18, renderMs: 4, aiSlowestCallback: 'keepCompanion:Paladin' },
];
const [sampleGroup] = summarizeFrameGroups(sampleFrames);
assert.equal(sampleGroup.percentOver60HzBudget, 50, 'town frame-budget failure percentage is calculated per environment');
const [sampleSpike] = summarizeFrameSpikes(sampleFrames);
assert.equal(sampleSpike.aiSlowestCallback, 'keepCompanion:Paladin', 'frame spike summaries retain the slow AI callback label');
assert.match(world, /profileRecord\('collision'/, 'world profiling separates collision work');
assert.match(game, /profileRecord\('events'/, 'world event scripts are measured');
assert.match(render, /markRenderPhase\('renderSort'\)/, 'the renderer reports draw-list construction and sorting time');
assert.match(render, /markRenderPhase\('depthDraw'\)/, 'the renderer reports depth-sorted drawing separately');
assert.match(render, /world\.creaturesInBounds\(/, 'world rendering and minimap actor markers use spatial culling');
assert.match(render, /drawParticles\(ctx, vr, profiling\)/, 'visible particle counting only runs during profiling');
assert.match(render, /profileRecord\('effectDraw', performance\.now\(\) - effectDrawStarted\)/, 'the aggregate effect time includes its split sub-stages');
assert.match(render, /profileRecord\('screenOverlay', performance\.now\(\) - screenOverlayStarted\)/, 'the aggregate screen-space time includes its split sub-stages');
assert.match(screens, /data-unified-record-export/, 'the settings screen exposes the unified report export');
assert.match(screens, /value="extreme">Extreme Performance/, 'the standard graphics settings expose the emergency preset');
assert.match(screens, /data-adaptive-performance/, 'adaptive cosmetic performance is optional and user controlled');
assert.match(profiler, /retainedFrameLimit: CAP/, 'the profiler bounds detailed frame history');
assert.doesNotMatch(render, /const corners = \[\[vr\.x0/, 'isometric viewport bounds no longer build per-frame corner arrays');
assert.doesNotMatch(render, /v\.at = at|standKey\(\.\.\.v\.at\)/, 'wall cutaway records no longer allocate a coordinate pair per actor');

console.log('Profiler, emergency quality preset, adaptive controls, and allocation-free viewport setup checks passed.');
