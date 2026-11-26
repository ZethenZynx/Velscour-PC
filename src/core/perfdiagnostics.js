// Optional, rolling performance diagnostics. No collection, timer reads, DOM, or entity scans while disabled.
import { G } from '../state.js';
import { developerRecordingActive, developerSessionStatus, setDeveloperEventObserver, recordDeveloperEvent, recordDeveloperMetric } from './developer-session.js';
import { vfxStats, vfxDiagnosticReport } from '../gfx/vfx.js';
import { keepCacheDiagnosticReport } from '../gfx/keepart.js';
import { audioActiveCount } from './audio.js';
import { GAME_BUILD_ID, GAME_VERSION } from '../data/build-version.js';
import { FRAME_BUDGET_MS, summarizeFrameGroups, summarizeFrameSpikes } from './performance-analysis.js';
import { shouldSampleCounts } from './perf-count-sampling.mjs';

const CAP = 27000; // 3 minutes at 150 Hz; longer on typical 60-120 Hz displays
const MAX_EXPORTED_FRAMES = 9000;
const MAX_LONG_TASKS = 128;
const PLAYER_TIMING_KEYS = ['playerUpdateWallMs', 'playerUpdateUnattributedMs', 'playerRecoveryMs', 'playerTimersGearAffixesMs', 'playerClassPassivesMs', 'playerStatusMs', 'playerResourcesBuffsMs', 'playerAutoSummonMs', 'playerCooldownsLegendaryMs', 'playerActionMovementMs', 'playerPathMs', 'playerMoveCollisionMs'];
const KEYS = ['frameMs', 'gapMs', 'updateMs', 'renderMs', 'renderSetupMs', 'floorDrawMs', 'groundDrawMs', 'renderSortMs', 'depthDrawMs', 'effectDrawMs', 'ambientTopDrawMs', 'particleDrawMs', 'topHazardDrawMs', 'topEffectDrawMs', 'lightingMs', 'screenOverlayMs', 'skyFrontMs', 'seeThroughMs', 'screenFeedbackMs', 'hudLabelsMs', 'combatTextMs', 'cinematicOverlayMs', 'automapMs', 'worldMs', 'aiMs', 'playerUpdateMs', ...PLAYER_TIMING_KEYS, 'creatureUpdateMs', 'townLifeUpdateMs', 'keepDirectorUpdateMs', 'keepCompanionUpdateMs', 'keepFolkUpdateMs', 'keepLightingUpdateMs', 'townAgentUpdateMs', 'otherNpcUpdateMs', 'doorUpdateMs', 'aiSlowestCallbackMs', 'pathMs', 'collisionMs', 'hazardMs', 'lootMs', 'vfxMs', 'uiMs', 'enemyHistoryMs', 'minimapMs', 'eventsMs', 'environmentMs', 'saveMs'];
const AI_TIMING_KEYS = ['playerUpdateMs', ...PLAYER_TIMING_KEYS, 'creatureUpdateMs', 'townLifeUpdateMs', 'keepDirectorUpdateMs', 'keepCompanionUpdateMs', 'keepFolkUpdateMs', 'keepLightingUpdateMs', 'townAgentUpdateMs', 'otherNpcUpdateMs', 'doorUpdateMs', 'aiSlowestCallbackMs'];
const COUNT_KEYS = ['creatures', 'enemies', 'inactiveEnemies', 'offscreenCreatures', 'deadCreatures', 'npcs', 'companions', 'keepFolk', 'keepDirectors', 'keepLightingUpdaters', 'townAgents', 'corpses', 'projectiles', 'hazards', 'traps', 'groundItems', 'lootLabels', 'particles', 'visibleParticles', 'effects', 'groundEffects', 'topEffects', 'decals', 'gore', 'damageText', 'audio', 'spatialCandidates', 'collisionPairs', 'pathSearches', 'renderQueue', 'renderViews', 'renderCreatures', 'renderWalls', 'renderProps', 'renderLoot'];
const CONTEXT_SAMPLE_MS = 100, INCIDENT_PRE_MS = 3000, INCIDENT_POST_MS = 2500, MAX_INCIDENTS = 24;
const INPUT_CODES = ['ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
let history = null, cursor = 0, count = 0, frameSerial = 0, prevRaf = 0, nextPaint = 0, latestCounts = null, latestCountsWorld = null;
let frameStarted = 0, rafGap = 16.667, updateMs = 0, renderMs = 0, phases = null;
let panel = null, graph = null;
let longTaskObserver = null, longTasks = [], longTaskCount = 0, externalTimings = [], externalTimingTotals = Object.create(null);
let frameTotals = null;
let incidents = [], incidentSerial = 0, sessionStartPerfMs = 0;
let accumulationAlerts = new Set();

export const performanceProfilerEnabled = developerRecordingActive;

function resetFrameTotals() {
  frameTotals = { frames: 0, sums: Object.fromEntries(KEYS.map((key) => [key, 0])), minima: Object.fromEntries(KEYS.map((key) => [key, Infinity])), maxima: Object.fromEntries(KEYS.map((key) => [key, 0])),
    overBudgetFrames: 0, over50msFrames: 0, over100msFrames: 0, significantSpikes: [], environments: Object.create(null),
    entityCountSamples: 0, entityCountsLatest: Object.create(null), entityCountsMaximum: Object.create(null), lifecycleDeltaObserved: { world: Object.create(null), vfx: Object.create(null) },
    lastLifecycleWorldId: null, lastWorldLifecycle: null, lastVfxLifecycle: null,
    heap: { samples: 0, firstBytes: null, latestBytes: null, peakBytes: null },
    diagnosticOverhead: { samples: 0, totalMs: 0, maximumMs: 0 },
    simulation: { rafSamples: 0, rafRealMs: 0, rafSimulatedMs: 0, rafDiscardedMs: 0, catchupRuns: 0, catchupUpdates: 0, catchupRealMs: 0, catchupSimulatedMs: 0, catchupDiscardedMs: 0, catchupUnprocessedMs: 0, catchupMaxWorkMs: 0 } };
}

function allocateHistory() {
  if (history) return;
  history = Object.fromEntries(KEYS.map((key) => [key, new Float32Array(CAP)]));
  history.samples = new Uint16Array(CAP);
  history.timestamps = new Float64Array(CAP);
  history.depths = new Float64Array(CAP);
  history.environments = new Array(CAP);
  history.worldIds = new Array(CAP);
  history.worldKinds = new Array(CAP);
  history.resolutionScale = new Float32Array(CAP);
  history.devicePixelRatio = new Float32Array(CAP);
  history.canvasWidth = new Uint32Array(CAP);
  history.canvasHeight = new Uint32Array(CAP);
  history.heapBytes = new Float64Array(CAP);
  history.visible = new Uint8Array(CAP);
  history.focused = new Uint8Array(CAP);
  history.playerX = new Float32Array(CAP); history.playerY = new Float32Array(CAP); history.playerZ = new Float32Array(CAP);
  history.playerMoveX = new Float32Array(CAP); history.playerMoveY = new Float32Array(CAP);
  history.playerTargetX = new Float32Array(CAP); history.playerTargetY = new Float32Array(CAP);
  history.playerFlags = new Uint16Array(CAP); history.inputFlags = new Uint32Array(CAP);
  history.mouseX = new Float32Array(CAP); history.mouseY = new Float32Array(CAP); history.mouseFlags = new Uint8Array(CAP);
  history.telemetry = new Array(CAP);
  history.slowestAILabels = new Array(CAP);
  history.counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, new Uint32Array(CAP)]));
  cursor = count = frameSerial = 0; incidents = []; incidentSerial = 0; accumulationAlerts = new Set();
  sessionStartPerfMs = developerSessionStatus().startedPerfMs || performance.now();
}

function addStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('perf-diagnostics-style')) return;
  const style = document.createElement('style');
  style.id = 'perf-diagnostics-style';
  style.textContent = `#perf-diagnostics{position:fixed;z-index:2147483000;right:10px;top:10px;width:min(340px,calc(100vw - 20px));max-height:48vh;overflow:auto;padding:10px 12px;background:rgba(13,10,15,.94);border:1px solid #9a7135;border-radius:7px;box-shadow:0 4px 22px #000b;color:#ead8ad;font:12px/1.35 system-ui,sans-serif;pointer-events:auto}#perf-diagnostics b{color:#ffdc85}#perf-diagnostics .pd-head{display:flex;justify-content:space-between;align-items:center;gap:8px}#perf-diagnostics button{color:#f2d38d;background:#2a1b11;border:1px solid #795a2c;border-radius:4px;padding:3px 7px;cursor:pointer}#perf-diagnostics .pd-stats{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:7px}#perf-diagnostics canvas{display:block;width:100%;height:48px;margin:6px 0;background:#08070a;border:1px solid #3a2c20}#perf-diagnostics .pd-small{font-size:10px;color:#c4b99f}`;
  document.head.appendChild(style);
}

function mountPanel() {
  if (typeof document === 'undefined') return;
  if (panel?.isConnected) return;
  addStyle();
  panel = document.createElement('section');
  panel.id = 'perf-diagnostics';
  panel.innerHTML = '<div class="pd-head"><b>Performance diagnostics</b></div><div data-pd-summary></div><canvas width="640" height="96" aria-label="Recent frame times"></canvas><div class="pd-stats" data-pd-stats></div><div class="pd-small" data-pd-note></div>';
  document.body.appendChild(panel);
  graph = panel.querySelector('canvas');
}

function dropPanel() {
  if (typeof document === 'undefined') { panel = graph = null; return; }
  panel?.remove(); panel = graph = null;
  document.getElementById('perf-diagnostics-style')?.remove();
}

export function setPerformanceProfilerEnabled(enabled) {
  if (enabled) {
    allocateHistory(); if (!frameTotals) resetFrameTotals();
    frameTotals.lastLifecycleWorldId = G.world?.id ?? null;
    frameTotals.lastWorldLifecycle = G.world?.lifecycle ? { ...G.world.lifecycle } : null;
    frameTotals.lastVfxLifecycle = { ...(vfxStats().lifecycle || {}) };
    mountPanel(); startLongTaskObserver();
  }
  else {
    stopLongTaskObserver();
    // Stop monitoring without discarding the report; players can still export it while disabled.
    latestCounts = null; latestCountsWorld = null;
    prevRaf = nextPaint = 0; phases = null;
    dropPanel();
  }
}

export function resetPerformanceStatistics() {
  stopLongTaskObserver();
  history = null; latestCounts = null; latestCountsWorld = null; count = cursor = frameSerial = 0; resetFrameTotals();
  longTasks = []; longTaskCount = 0; externalTimings = []; externalTimingTotals = Object.create(null);
  incidents = []; incidentSerial = 0;
  prevRaf = nextPaint = 0; phases = null;
  if (performanceProfilerEnabled()) { allocateHistory(); mountPanel(); startLongTaskObserver(); }
  return true;
}

function startLongTaskObserver() {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const task = {
          startTimeMs: Number(entry.startTime.toFixed(2)),
          durationMs: Number(entry.duration.toFixed(2)),
          name: String(entry.name || 'unknown'),
          attribution: (entry.attribution || []).slice(0, 4).map((item) => ({
            name: String(item.name || ''), containerName: String(item.containerName || ''),
            containerId: String(item.containerId || ''), containerSrc: String(item.containerSrc || ''),
          })),
        };
        longTaskCount++;
        if (longTasks.length < MAX_LONG_TASKS) longTasks.push(task);
        else {
          let shortest = 0;
          for (let i = 1; i < longTasks.length; i++) if (longTasks[i].durationMs < longTasks[shortest].durationMs) shortest = i;
          if (task.durationMs > longTasks[shortest].durationMs) longTasks[shortest] = task;
        }
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
  } catch { longTaskObserver?.disconnect(); longTaskObserver = null; }
}

function stopLongTaskObserver() {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}

export function profileStart() {
  if (!performanceProfilerEnabled()) return 0;
  return performance.now();
}

export function profileEnd(start) {
  return start ? performance.now() - start : 0;
}

export function profileRecord(key, elapsed) {
  if (!history || !phases || !Number.isFinite(elapsed)) return;
  const field = `${key}Ms`;
  if (field in phases) phases[field] += elapsed;
}

function compactFrame(at) {
  if (!history) return null;
  const playerFlags = history.playerFlags[at], inputFlags = history.inputFlags[at], mouseFlags = history.mouseFlags[at];
  const player = !!(playerFlags & 1024);
  return {
    performanceNowMs: Number(history.timestamps[at].toFixed(2)), elapsedSeconds: Number(((history.timestamps[at] - sessionStartPerfMs) / 1000).toFixed(3)),
    timestampUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + history.timestamps[at]).toISOString(),
    environment: history.environments[at] || null, worldId: history.worldIds[at] || null, depth: history.depths[at] || null,
    frameMs: Number(history.frameMs[at].toFixed(2)), gapMs: Number(history.gapMs[at].toFixed(2)), updateMs: Number(history.updateMs[at].toFixed(2)), renderMs: Number(history.renderMs[at].toFixed(2)),
    timingsMs: Object.fromEntries(['worldMs', 'aiMs', 'playerUpdateMs', ...PLAYER_TIMING_KEYS, 'pathMs', 'collisionMs', 'renderSortMs', 'depthDrawMs', 'floorDrawMs'].map((key) => [key, Number(history[key][at].toFixed(2))])),
    player: player ? { x: Number.isFinite(history.playerX[at]) ? Number(history.playerX[at].toFixed(3)) : null, y: Number.isFinite(history.playerY[at]) ? Number(history.playerY[at].toFixed(3)) : null, z: Number.isFinite(history.playerZ[at]) ? Number(history.playerZ[at].toFixed(3)) : null,
      moveVector: [Number(history.playerMoveX[at].toFixed(3)), Number(history.playerMoveY[at].toFixed(3))],
      target: playerFlags & 512 ? [Number(history.playerTargetX[at].toFixed(3)), Number(history.playerTargetY[at].toFixed(3))] : null,
      state: { moving: !!(playerFlags & 1), dead: !!(playerFlags & 2), channeling: !!(playerFlags & 4), castLocked: !!(playerFlags & 8), queuedCast: !!(playerFlags & 16), attacking: !!(playerFlags & 32), interacting: !!(playerFlags & 64), looting: !!(playerFlags & 128), rooted: !!(playerFlags & 256) } } : null,
    input: { heldKeys: INPUT_CODES.filter((_, i) => history.inputFlags[at] & (1 << i)), mouse: { x: Number(history.mouseX[at].toFixed(1)), y: Number(history.mouseY[at].toFixed(1)), left: !!(history.mouseFlags[at] & 1), right: !!(history.mouseFlags[at] & 2), leftPressed: !!(history.mouseFlags[at] & 4), rightPressed: !!(history.mouseFlags[at] & 8) } },
    counts: Object.fromEntries(['enemies', 'inactiveEnemies', 'creatures', 'npcs', 'hazards', 'traps', 'particles', 'effects', 'groundItems'].map((key) => [key, history.counts[key][at]])),
    pageVisible: history.visible[at] === 1, pageFocused: history.focused[at] === 1,
  };
}

function captureContext(trigger, details = {}, atPerfMs = performance.now()) {
  if (!history || !count) return false;
  const last = (cursor - 1 + CAP) % CAP, pre = [];
  let lastSamplePerf = Infinity;
  for (let i = count - 1; i >= 0; i--) {
    const at = (last - i + CAP) % CAP, timestamp = history.timestamps[at];
    if (atPerfMs - timestamp > INCIDENT_PRE_MS) break;
    if (timestamp > atPerfMs || lastSamplePerf - timestamp < CONTEXT_SAMPLE_MS) continue;
    pre.push(compactFrame(at)); lastSamplePerf = timestamp;
  }
  pre.reverse();
  const duplicate = incidents.find((incident) => incident.trigger === trigger && Math.abs(incident.triggerPerfMs - atPerfMs) < 1500);
  if (duplicate) return duplicate.id;
  const incident = { id: `incident-${++incidentSerial}`, trigger: String(trigger), triggerPerfMs: Number(atPerfMs.toFixed(2)),
    capturedUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + atPerfMs).toISOString(), details: details && typeof details === 'object' ? { ...details } : {},
    contextWindowMs: { before: INCIDENT_PRE_MS, after: INCIDENT_POST_MS, sampleInterval: CONTEXT_SAMPLE_MS },
    preEventSamples: pre, postEventSamples: [], state: 'capturing', _lastSamplePerfMs: atPerfMs };
  incidents.push(incident);
  if (incidents.length > MAX_INCIDENTS) incidents.splice(0, incidents.length - MAX_INCIDENTS);
  return incident.id;
}

export function capturePerformanceIncident(trigger, details = {}) {
  if (!performanceProfilerEnabled()) return false;
  return captureContext(trigger, details);
}

setDeveloperEventObserver((event) => {
  if (/error|exception|marker|transition|area-|combat-|movement-|collision-|position-invalid|position-recover|attack-interruption|simulation-spike|external-operation-spike|accumulation/i.test(event.type)) {
    captureContext(event.type, { eventId: event.id, category: event.category, details: event.details }, event.perfMs);
  }
});

/** Record RAF real-time versus simulated-time deltas and hidden-tab catch-up work. */
export function recordSimulationTiming({ source = 'raf', realElapsedMs = 0, simulatedMs = 0, discardedMs = 0, unprocessedMs = 0, updates = 0, workMs = 0 } = {}) {
  if (!performanceProfilerEnabled() || !frameTotals) return false;
  const totals = frameTotals.simulation;
  if (source === 'raf') {
    totals.rafSamples++; totals.rafRealMs += Math.max(0, realElapsedMs); totals.rafSimulatedMs += Math.max(0, simulatedMs); totals.rafDiscardedMs += Math.max(0, discardedMs);
  } else {
    totals.catchupRuns++; totals.catchupUpdates += Math.max(0, updates); totals.catchupRealMs += Math.max(0, realElapsedMs);
    totals.catchupSimulatedMs += Math.max(0, simulatedMs); totals.catchupDiscardedMs += Math.max(0, discardedMs); totals.catchupUnprocessedMs += Math.max(0, unprocessedMs);
    totals.catchupMaxWorkMs = Math.max(totals.catchupMaxWorkMs, workMs);
    if (workMs > 40 || discardedMs > 100) recordDeveloperEvent('simulation-spike', { source, realElapsedMs, simulatedMs, discardedMs, updates, workMs }, 'timing');
  }
  return true;
}

/** Capture an individual AI callback only while the profiler is active. */
export function profileRecordAIUpdate(entity, kind, elapsed) {
  if (!history || !phases || !Number.isFinite(elapsed) || elapsed <= 0) return;
  if (elapsed > phases.aiSlowestCallbackMs) {
    phases.aiSlowestCallbackMs = elapsed;
    // Avoid allocating labels for normal sub-millisecond updates.
    const name = entity?.name || entity?.classId || entity?.constructor?.name || 'unknown';
    phases.aiSlowestCallback = elapsed >= 1 ? `${kind || 'unknown'}:${name}` : '';
  }
}

/** Record synchronous work outside RAF (for example world construction during a transition). */
export function profileExternalTiming(name, startedAtMs, details = null) {
  if (!performanceProfilerEnabled() || !Number.isFinite(startedAtMs)) return;
  const durationMs = Math.max(0, performance.now() - startedAtMs), key = String(name).slice(0, 100), env = String(details?.biome || details?.environment || 'unknown').slice(0, 80);
  const total = externalTimingTotals[key] || (externalTimingTotals[key] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, byEnvironment: Object.create(null) });
  total.count++; total.totalMs += durationMs; total.minMs = Math.min(total.minMs, durationMs); total.maxMs = Math.max(total.maxMs, durationMs);
  const envTotal = total.byEnvironment[env] || (total.byEnvironment[env] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 });
  envTotal.count++; envTotal.totalMs += durationMs; envTotal.minMs = Math.min(envTotal.minMs, durationMs); envTotal.maxMs = Math.max(envTotal.maxMs, durationMs);
  externalTimings.push({ name: key, durationMs: Number(durationMs.toFixed(3)),
    timestampMs: Number(performance.now().toFixed(3)), details: details && typeof details === 'object' ? details : null });
  if (durationMs >= 50 && details?.async !== true) recordDeveloperEvent('external-operation-spike', { name: key, durationMs: Number(durationMs.toFixed(2)), details }, 'timing');
  if (externalTimings.length > 128) externalTimings.splice(0, externalTimings.length - 128);
}

export function profileBeginFrame(rafNow, simulation = {}) {
  if (!performanceProfilerEnabled()) return false;
  allocateHistory(); mountPanel();
  const now = Number(rafNow) || performance.now();
  rafGap = prevRaf ? Math.max(0, now - prevRaf) : 16.667;
  prevRaf = now;
  recordSimulationTiming({ source: 'raf', realElapsedMs: Number(simulation.rawDeltaMs) || rafGap,
    simulatedMs: Number(simulation.simulationDeltaMs) || 0, discardedMs: Number(simulation.discardedMs) || 0 });
  frameStarted = performance.now();
  updateMs = renderMs = 0;
  phases = { worldMs: 0, aiMs: 0, playerUpdateMs: 0, ...Object.fromEntries(PLAYER_TIMING_KEYS.map((key) => [key, 0])), creatureUpdateMs: 0, townLifeUpdateMs: 0, keepDirectorUpdateMs: 0, keepCompanionUpdateMs: 0, keepFolkUpdateMs: 0, keepLightingUpdateMs: 0, townAgentUpdateMs: 0, otherNpcUpdateMs: 0, doorUpdateMs: 0, aiSlowestCallbackMs: 0, aiSlowestCallback: '', pathMs: 0, collisionMs: 0, hazardMs: 0, lootMs: 0, vfxMs: 0, uiMs: 0, enemyHistoryMs: 0, minimapMs: 0, eventsMs: 0, environmentMs: 0, saveMs: 0, renderSetupMs: 0, floorDrawMs: 0, groundDrawMs: 0, renderSortMs: 0, depthDrawMs: 0, effectDrawMs: 0, ambientTopDrawMs: 0, particleDrawMs: 0, topHazardDrawMs: 0, topEffectDrawMs: 0, lightingMs: 0, screenOverlayMs: 0, skyFrontMs: 0, seeThroughMs: 0, screenFeedbackMs: 0, hudLabelsMs: 0, combatTextMs: 0, cinematicOverlayMs: 0, automapMs: 0 };
  return true;
}

export function profileSetUpdate(ms) { if (history) updateMs = ms; }
export function profileSetRender(ms) { if (history) renderMs = ms; }

function readCounts(world) {
  let enemies = 0, inactiveEnemies = 0, deadCreatures = 0, projectiles = 0;
  let companions = 0, keepFolk = 0, keepDirectors = 0, keepLightingUpdaters = 0, townAgents = 0;
  for (const n of world?.npcs || []) {
    if (n.keepHero) companions++;
    if (n.keepFolk || n.keepCastellan) keepFolk++;
    if (n.keepDirector) keepDirectors++;
    if (n.keepLightingUpdater) keepLightingUpdaters++;
    if (n.townAgent) townAgents++;
  }
  for (const c of world?.creatures || []) {
    if (c.dead) { deadCreatures++; continue; }
    if (c.team === 'enemy') { enemies++; if (!c.awake) inactiveEnemies++; }
  }
  for (const h of world?.hazards || []) if (h.isProjectile || h.projectile || h.constructor?.name === 'Projectile') projectiles++;
  const vfx = vfxStats();
  return {
    creatures: world?.creatures?.length || 0,
    npcs: world?.npcs?.length || 0, companions, keepFolk, keepDirectors, keepLightingUpdaters, townAgents,
    enemies, inactiveEnemies, deadCreatures,
    offscreenCreatures: Math.max(0, enemies - (world?._perfVisibleEnemyCount || 0)),
    corpses: world?.corpses?.length || 0,
    projectiles,
    hazards: world?.hazards?.length || 0,
    traps: world?.environmentTraps?.length || 0,
    groundItems: world?._lootRegistered ?? world?.loot?.length ?? 0,
    lootLabels: G.lootBoxes?.length || 0,
    particles: vfx.particles || 0, effects: vfx.effects || 0, groundEffects: vfx.groundEffects || 0, topEffects: vfx.topEffects || 0,
    decals: vfx.decals || 0, gore: vfx.gore || 0, damageText: vfx.texts || 0,
    audio: audioActiveCount?.() || 0,
    spatialCandidates: world?._perfSpatialCandidates || 0,
    collisionPairs: world?._perfCollisionPairs || 0,
    pathSearches: world?._perfPathSearches || 0,
    renderQueue: world?._perfRenderCounts?.queue || 0,
    renderViews: world?._perfRenderCounts?.views || 0,
    renderCreatures: world?._perfRenderCounts?.creatures || 0,
    renderWalls: world?._perfRenderCounts?.walls || 0,
    renderProps: world?._perfRenderCounts?.props || 0,
    renderLoot: world?._perfRenderCounts?.loot || 0,
    visibleParticles: world?._perfVisibleParticles || 0,
    telemetry: {
      worldId: world?.id ?? null,
      worldLifecycle: world?.lifecycle ? { ...world.lifecycle } : null,
      vfxLifecycle: vfx.lifecycle || null,
      particleTypes: Object.fromEntries(Object.entries(vfx).filter(([key]) => key.startsWith('particle_'))),
      effectTypes: Object.fromEntries(Object.entries(vfx).filter(([key]) => key.startsWith('effect_'))),
    },
  };
}

export function profileFinishFrame(world) {
  if (!history) return;
  const diagnosticsStarted = performance.now();
  const frameMs = performance.now() - frameStarted;
  const at = cursor;
  const now = performance.now();
  history.timestamps[at] = now;
  history.depths[at] = Number.isFinite(Number(world?.depth)) ? Number(world.depth) : 0;
  history.environments[at] = world?.biome?.name || world?.biome?.id || world?.kind || '';
  history.worldIds[at] = world?.id ?? null;
  history.worldKinds[at] = world?.kind || '';
  history.resolutionScale[at] = Number(G.resScale) || 1;
  history.devicePixelRatio[at] = Number(G.dpr) || 1;
  history.canvasWidth[at] = G.canvas?.width || 0;
  history.canvasHeight[at] = G.canvas?.height || 0;
  history.frameMs[at] = frameMs;
  history.gapMs[at] = rafGap;
  history.visible[at] = typeof document !== 'undefined' && document.visibilityState === 'visible' ? 1 : 0;
  history.focused[at] = typeof document !== 'undefined' && document.hasFocus?.() ? 1 : 0;
  const player = world?.player;
  let playerFlags = player ? 1024 : 0;
  if (player?.moving) playerFlags |= 1;
  if (player?.dead) playerFlags |= 2;
  if (player?.channel) playerFlags |= 4;
  if (player?.castLock > 0) playerFlags |= 8;
  if (player?.queued) playerFlags |= 16;
  if (player?.attackTarget) playerFlags |= 32;
  if (player?.interact) playerFlags |= 64;
  if (player?.lootTarget) playerFlags |= 128;
  if (player?.rooted) playerFlags |= 256;
  const target = player?.moveTarget || (player?.attackTarget ? [player.attackTarget.target?.x, player.attackTarget.target?.y] : null) || (player?.interact ? [player.interact.x, player.interact.y] : null);
  if (target && Number.isFinite(target[0]) && Number.isFinite(target[1])) playerFlags |= 512;
  history.playerX[at] = player ? Number(player.x) : NaN; history.playerY[at] = player ? Number(player.y) : NaN; history.playerZ[at] = player ? Number(player.z) : NaN;
  history.playerMoveX[at] = Number(player?.moveVec?.[0]) || 0; history.playerMoveY[at] = Number(player?.moveVec?.[1]) || 0;
  history.playerTargetX[at] = target?.[0] ?? 0; history.playerTargetY[at] = target?.[1] ?? 0;
  history.playerFlags[at] = playerFlags;
  let inputFlags = 0; for (let i = 0; i < INPUT_CODES.length; i++) if (G.input?.keys?.has(INPUT_CODES[i])) inputFlags |= 1 << i;
  history.inputFlags[at] = inputFlags;
  const mouse = G.input?.mouse || {};
  history.mouseX[at] = Number(mouse.x) || 0; history.mouseY[at] = Number(mouse.y) || 0;
  history.mouseFlags[at] = (mouse.left ? 1 : 0) | (mouse.right ? 2 : 0) | (mouse.leftPressed ? 4 : 0) | (mouse.rightPressed ? 8 : 0);
  history.updateMs[at] = updateMs;
  history.renderMs[at] = renderMs;
  history.worldMs[at] = phases.worldMs; history.aiMs[at] = phases.aiMs;
  for (const key of AI_TIMING_KEYS) history[key][at] = phases[key];
  history.slowestAILabels[at] = phases.aiSlowestCallback || '';
  history.pathMs[at] = phases.pathMs; history.collisionMs[at] = phases.collisionMs;
  history.hazardMs[at] = phases.hazardMs; history.lootMs[at] = phases.lootMs;
  history.vfxMs[at] = phases.vfxMs; history.uiMs[at] = phases.uiMs;
  history.enemyHistoryMs[at] = phases.enemyHistoryMs; history.minimapMs[at] = phases.minimapMs;
  history.eventsMs[at] = phases.eventsMs; history.environmentMs[at] = phases.environmentMs; history.saveMs[at] = phases.saveMs;
  history.renderSetupMs[at] = phases.renderSetupMs; history.floorDrawMs[at] = phases.floorDrawMs;
  history.groundDrawMs[at] = phases.groundDrawMs; history.renderSortMs[at] = phases.renderSortMs;
  history.depthDrawMs[at] = phases.depthDrawMs; history.effectDrawMs[at] = phases.effectDrawMs;
  history.ambientTopDrawMs[at] = phases.ambientTopDrawMs; history.particleDrawMs[at] = phases.particleDrawMs;
  history.topHazardDrawMs[at] = phases.topHazardDrawMs; history.topEffectDrawMs[at] = phases.topEffectDrawMs;
  history.skyFrontMs[at] = phases.skyFrontMs; history.seeThroughMs[at] = phases.seeThroughMs;
  history.screenFeedbackMs[at] = phases.screenFeedbackMs; history.hudLabelsMs[at] = phases.hudLabelsMs;
  history.combatTextMs[at] = phases.combatTextMs; history.cinematicOverlayMs[at] = phases.cinematicOverlayMs;
  history.lightingMs[at] = phases.lightingMs; history.screenOverlayMs[at] = phases.screenOverlayMs;
  history.automapMs[at] = phases.automapMs;
  if (!frameTotals) resetFrameTotals();
  frameTotals.frames++;
  for (const key of KEYS) {
    const value = key === 'frameMs' ? frameMs : key === 'gapMs' ? rafGap : key === 'updateMs' ? updateMs : key === 'renderMs' ? renderMs : phases[key] || 0;
    frameTotals.sums[key] += value;
    frameTotals.minima[key] = Math.min(frameTotals.minima[key], value);
    frameTotals.maxima[key] = Math.max(frameTotals.maxima[key], value);
  }
  if (rafGap > FRAME_BUDGET_MS) frameTotals.overBudgetFrames++;
  if (frameMs > 50) frameTotals.over50msFrames++;
  if (frameMs > 100) frameTotals.over100msFrames++;
  const environment = world?.biome?.name || world?.biome?.id || world?.kind || 'unknown';
  const env = frameTotals.environments[environment] || (frameTotals.environments[environment] = { frames: 0, totalFrameMs: 0, worstFrameMs: 0, overBudgetFrames: 0 });
  env.frames++; env.totalFrameMs += frameMs; env.worstFrameMs = Math.max(env.worstFrameMs, frameMs); if (rafGap > FRAME_BUDGET_MS) env.overBudgetFrames++;
  if (frameMs > FRAME_BUDGET_MS || rafGap > FRAME_BUDGET_MS) {
    const spike = { severityMs: Number(Math.max(frameMs, rafGap).toFixed(3)), frameMs: Number(frameMs.toFixed(3)), gapMs: Number(rafGap.toFixed(3)), performanceNowMs: Number(now.toFixed(3)),
      timestampUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + now).toISOString(), environment,
      depth: Number.isFinite(Number(world?.depth)) ? Number(world.depth) : null,
      timingsMs: Object.fromEntries(KEYS.map((key) => [key, Number((key === 'frameMs' ? frameMs : key === 'gapMs' ? rafGap : key === 'updateMs' ? updateMs : key === 'renderMs' ? renderMs : phases[key] || 0).toFixed(3))])) };
    const retained = frameTotals.significantSpikes;
    if (retained.length < 100) retained.push(spike);
    else {
      let smallest = 0;
      for (let i = 1; i < retained.length; i++) if (retained[i].frameMs < retained[smallest].frameMs) smallest = i;
      if (spike.severityMs > retained[smallest].severityMs) retained[smallest] = spike;
    }
  }
  if (shouldSampleCounts(frameSerial, latestCountsWorld, world)) {
    const previousCounts = latestCounts, previousWorldId = latestCountsWorld?.id ?? null;
    latestCounts = readCounts(world);
    latestCountsWorld = world;
    history.heapBytes[at] = performance.memory?.usedJSHeapSize || 0;
    history.telemetry[at] = JSON.stringify(latestCounts.telemetry);
    frameTotals.entityCountSamples++;
    const envCounts = env.entityCountsMaximum || (env.entityCountsMaximum = Object.create(null));
    for (const key of COUNT_KEYS) {
      const value = Number(latestCounts[key]) || 0;
      frameTotals.entityCountsLatest[key] = value;
      frameTotals.entityCountsMaximum[key] = Math.max(frameTotals.entityCountsMaximum[key] || 0, value);
      envCounts[key] = Math.max(envCounts[key] || 0, value);
    }
    const worldLifecycle = world?.lifecycle || null;
    if (worldLifecycle) {
      if (frameTotals.lastLifecycleWorldId === world.id && frameTotals.lastWorldLifecycle) {
        for (const [key, value] of Object.entries(worldLifecycle)) {
          const delta = Number(value) - Number(frameTotals.lastWorldLifecycle[key] || 0);
          if (delta > 0) frameTotals.lifecycleDeltaObserved.world[key] = (frameTotals.lifecycleDeltaObserved.world[key] || 0) + delta;
        }
      }
      frameTotals.lastLifecycleWorldId = world.id ?? null;
      frameTotals.lastWorldLifecycle = { ...worldLifecycle };
    }
    const vfxLifecycle = latestCounts.telemetry?.vfxLifecycle || null;
    if (vfxLifecycle) {
      for (const [key, value] of Object.entries(vfxLifecycle)) {
        const delta = Number(value) - Number(frameTotals.lastVfxLifecycle?.[key] || 0);
        if (delta > 0) frameTotals.lifecycleDeltaObserved.vfx[key] = (frameTotals.lifecycleDeltaObserved.vfx[key] || 0) + delta;
      }
      frameTotals.lastVfxLifecycle = { ...vfxLifecycle };
    }
    if (previousCounts && previousWorldId === (world?.id ?? null)) {
      const sudden = [];
      for (const [key, minimumRise] of [['particles', 800], ['effects', 300], ['hazards', 150], ['groundItems', 400], ['creatures', 400]]) {
        const rise = (latestCounts[key] || 0) - (previousCounts[key] || 0);
        if (rise >= minimumRise) sudden.push({ type: key, rise, before: previousCounts[key] || 0, after: latestCounts[key] || 0 });
      }
      if (sudden.length) {
        const signature = `${world?.id || 'unknown'}:${sudden.map((item) => item.type).sort().join(',')}`;
        if (!accumulationAlerts.has(signature)) {
          accumulationAlerts.add(signature); if (accumulationAlerts.size > 64) accumulationAlerts.delete(accumulationAlerts.values().next().value);
          recordDeveloperEvent('suspected-object-accumulation', { changes: sudden, sampleIntervalFrames: 15,
            counts: Object.fromEntries(['creatures', 'enemies', 'hazards', 'traps', 'groundItems', 'particles', 'effects', 'decals'].map((key) => [key, latestCounts[key] || 0])),
            lifecycle: { world: latestCounts.telemetry?.worldLifecycle || null, vfx: latestCounts.telemetry?.vfxLifecycle || null },
            note: 'Threshold-triggered observation for investigation; a high count alone does not prove a leak.' }, 'resource-lifecycle');
        }
      }
    }
    const heapBytes = history.heapBytes[at];
    if (heapBytes > 0) {
      frameTotals.heap.samples++;
      frameTotals.heap.firstBytes ??= heapBytes;
      frameTotals.heap.latestBytes = heapBytes;
      frameTotals.heap.peakBytes = Math.max(frameTotals.heap.peakBytes || 0, heapBytes);
    }
  } else { history.heapBytes[at] = history.heapBytes[(at - 1 + CAP) % CAP]; history.telemetry[at] = ''; }
  frameSerial++;
  history.samples[at] = latestCounts ? 1 : 0;
  for (const key of COUNT_KEYS) history.counts[key][at] = latestCounts?.[key] || 0;
  cursor = (cursor + 1) % CAP; count = Math.min(CAP, count + 1);
  updateIncidentWindows(now);
  if ((frameMs > 50 || rafGap > 100) && !(frameTotals._lastAutoCaptureMs && now - frameTotals._lastAutoCaptureMs < 1000)) {
    frameTotals._lastAutoCaptureMs = now;
    captureContext('automatic-frame-spike', { frameMs: Number(frameMs.toFixed(2)), rafGapMs: Number(rafGap.toFixed(2)), updateMs: Number(updateMs.toFixed(2)), renderMs: Number(renderMs.toFixed(2)), environment, depth: world?.depth ?? null }, now);
  }
  const overheadMs = Math.max(0, performance.now() - diagnosticsStarted);
  frameTotals.diagnosticOverhead.samples++; frameTotals.diagnosticOverhead.totalMs += overheadMs;
  frameTotals.diagnosticOverhead.maximumMs = Math.max(frameTotals.diagnosticOverhead.maximumMs, overheadMs);
  recordDeveloperMetric('diagnostics.frameCaptureMs', overheadMs);
  if (now >= nextPaint) {
    nextPaint = now + 1000;
    const panelStarted = performance.now(); paintPanel(frameMs);
    const panelMs = Math.max(0, performance.now() - panelStarted);
    frameTotals.diagnosticOverhead.totalMs += panelMs; frameTotals.diagnosticOverhead.maximumMs = Math.max(frameTotals.diagnosticOverhead.maximumMs, panelMs);
    recordDeveloperMetric('diagnostics.panelPaintMs', panelMs);
  }
}

function updateIncidentWindows(now) {
  for (const incident of incidents) {
    if (incident.state !== 'capturing') continue;
    if (now - incident.triggerPerfMs > INCIDENT_POST_MS) { incident.state = 'complete'; continue; }
    if (now - incident._lastSamplePerfMs < CONTEXT_SAMPLE_MS) continue;
    const at = (cursor - 1 + CAP) % CAP;
    if (history.timestamps[at] > incident.triggerPerfMs && history.timestamps[at] !== incident._lastSamplePerfMs) {
      incident.postEventSamples.push(compactFrame(at)); incident._lastSamplePerfMs = history.timestamps[at];
    }
  }
}

function ordered(key) {
  if (!history || !count) return [];
  const vals = new Float32Array(count);
  const first = (cursor - count + CAP) % CAP;
  for (let i = 0; i < count; i++) vals[i] = history[key][(first + i) % CAP];
  vals.sort();
  return vals;
}

function stat(values) {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, worst: 0 };
  const q = (p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: values.at(-1) };
}

function paintPanel(lastFrameMs) {
  if (!panel?.isConnected || !count) return;
  const gaps = ordered('gapMs'), times = ordered('frameMs');
  const meanGap = gaps.reduce((sum, n) => sum + n, 0) / gaps.length;
  const currentFps = rafGap > 0 ? 1000 / rafGap : 0, averageFps = meanGap > 0 ? 1000 / meanGap : 0;
  const lowFps = gaps.length ? 1000 / gaps[Math.min(gaps.length - 1, Math.floor((gaps.length - 1) * 0.99))] : 0;
  const show = (n) => Number(n || 0).toFixed(2);
  panel.querySelector('[data-pd-summary]').textContent = `FPS ${currentFps.toFixed(0)} current · ${averageFps.toFixed(0)} average · ${lowFps.toFixed(0)} 1% low · ${show(lastFrameMs)} ms processing`;
  const items = [
    ['AI', phases?.aiMs], ['Player update', phases?.playerUpdateMs], ['Creature updates', phases?.creatureUpdateMs],
    ['Keep companion director', phases?.keepDirectorUpdateMs], ['Keep companions', phases?.keepCompanionUpdateMs],
    ['Keep townsfolk', phases?.keepFolkUpdateMs], ['Keep lighting updater', phases?.keepLightingUpdateMs],
    ['Town agents', phases?.townAgentUpdateMs], ['Other NPCs', phases?.otherNpcUpdateMs],
    ['Town life director', phases?.townLifeUpdateMs], ['Doors', phases?.doorUpdateMs], ['Slowest AI callback', phases?.aiSlowestCallbackMs],
    ['Pathfinding', phases?.pathMs], ['Collision', phases?.collisionMs],
    ['Hazards', phases?.hazardMs], ['Loot', phases?.lootMs], ['VFX', phases?.vfxMs], ['HUD', phases?.uiMs],
    ['Enemy history (HUD subphase)', phases?.enemyHistoryMs], ['Minimap (HUD subphase)', phases?.minimapMs],
    ['Events / world scripts', phases?.eventsMs], ['Environment', phases?.environmentMs], ['Saves', phases?.saveMs],
    ['Render setup / floor tiles', phases?.renderSetupMs], ['Floor chunk draw', phases?.floorDrawMs],
    ['Ground decals / effects', phases?.groundDrawMs], ['Render queue + sorting', phases?.renderSortMs],
    ['Depth-sorted actors / terrain', phases?.depthDrawMs], ['Particles / effects', phases?.effectDrawMs],
    ['Lighting', phases?.lightingMs], ['Screen overlays / labels', phases?.screenOverlayMs], ['TAB map', phases?.automapMs],
  ];
  const frameStats = stat(times);
  const statsEl = panel.querySelector('[data-pd-stats]');
  statsEl.innerHTML = `<span>Frame p50 / p95 / p99 / max</span><span>${show(frameStats.p50)} / ${show(frameStats.p95)} / ${show(frameStats.p99)} / ${show(frameStats.worst)} ms</span><span>Update / render</span><span>${show(updateMs)} / ${show(renderMs)} ms</span>` + items.map(([name, value]) => `<span>${name}</span><span>${show(value)} ms</span>`).join('') + COUNT_KEYS.map((key) => `<span>${key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)}</span><span>${latestCounts?.[key] || 0}</span>`).join('');
  const mem = performance.memory?.usedJSHeapSize;
  const slowLabel = phases?.aiSlowestCallback ? ` · Slowest AI callback: ${phases.aiSlowestCallback}` : '';
  panel.querySelector('[data-pd-note]').textContent = `Rolling up to 180 s · ${mem ? `JS heap ${(mem / 1048576).toFixed(1)} MiB` : 'JS heap unavailable in this runtime'} · Entity counts refresh every 15 frames${slowLabel}.`;
  paintGraph();
}

function paintGraph() {
  const c = graph, ctx = c?.getContext('2d');
  if (!ctx || !history || !count) return;
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#533f2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H - 16.667 * H / 50); ctx.lineTo(W, H - 16.667 * H / 50); ctx.stroke();
  const n = Math.min(count, W), first = (cursor - n + CAP) % CAP;
  ctx.strokeStyle = '#f3bd5d'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = history.gapMs[(first + i) % CAP], x = i * (W - 1) / Math.max(1, n - 1), y = H - Math.min(H, v * H / 50);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function performanceReport() {
  if (!history || !count) return { error: 'No performance data has been collected yet.' };
  const sessionStatus = developerSessionStatus();
  const first = (cursor - count + CAP) % CAP, frames = [];
  let peakHeapBytes = 0;
  const exportStride = Math.max(1, Math.ceil(count / MAX_EXPORTED_FRAMES));
  const keepIndices = new Set();
  for (let i = 0; i < count; i += exportStride) keepIndices.add(i);
  keepIndices.add(count - 1);
  for (const spike of frameTotals?.significantSpikes || []) {
    let nearest = -1, nearestDelta = Infinity;
    for (let i = 0; i < count; i++) {
      const at = (first + i) % CAP, delta = Math.abs(history.timestamps[at] - spike.performanceNowMs);
      if (delta < nearestDelta) { nearestDelta = delta; nearest = i; }
    }
    if (nearest >= 0 && nearestDelta < 60) keepIndices.add(nearest);
  }
  const exportedIndices = [...keepIndices].sort((a, b) => a - b);
  for (const i of exportedIndices) {
    const at = (first + i) % CAP, row = {};
    for (const key of KEYS) row[key] = Number(history[key][at].toFixed(3));
    row.depth = history.depths[at] || 0;
    row.environment = history.environments[at] || '';
    row.worldKind = history.worldKinds[at] || '';
    row.resolutionScale = history.resolutionScale[at] || 1;
    row.devicePixelRatio = history.devicePixelRatio[at] || 1;
    row.canvasWidth = history.canvasWidth[at];
    row.canvasHeight = history.canvasHeight[at];
    row.elapsedSeconds = Number(((history.timestamps[at] - sessionStartPerfMs) / 1000).toFixed(3));
    row.performanceNowMs = Number(history.timestamps[at].toFixed(3));
    row.timestampUtc = new Date((performance.timeOrigin || Date.now() - performance.now()) + history.timestamps[at]).toISOString();
    row.pageVisible = history.visible[at] === 1;
    row.pageFocused = history.focused[at] === 1;
    row.heapBytes = history.heapBytes[at]; peakHeapBytes = Math.max(peakHeapBytes, row.heapBytes);
    if (history.samples[at]) {
      for (const key of COUNT_KEYS) row[key] = history.counts[key][at];
      try { row.telemetry = JSON.parse(history.telemetry[at] || 'null'); } catch { row.telemetry = null; }
    }
    row.aiSlowestCallback = history.slowestAILabels[at] || '';
    const context = compactFrame(at);
    row.player = context?.player || null;
    row.input = context?.input || null;
    frames.push(row);
  }
  const summaries = Object.fromEntries(KEYS.map((key) => [key, stat(ordered(key))]));
  const frameTimes = ordered('frameMs'), intervals = ordered('gapMs');
  const spikeFrames = summarizeFrameSpikes(frames);
  const quantile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : 0;
  const meanInterval = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const pacing = Object.fromEntries([[60, 1000 / 60], [30, 1000 / 30], [24, 1000 / 24]].map(([fps, threshold]) => {
    let framesBelow = 0, intervalTimeAboveBudgetMs = 0, excessMsAboveBudget = 0;
    for (const gap of intervals) if (gap > threshold) {
      framesBelow++;
      intervalTimeAboveBudgetMs += gap;
      excessMsAboveBudget += gap - threshold;
    }
    return [fps, {
      framesBelow,
      percentOfFrames: intervals.length ? Number((framesBelow * 100 / intervals.length).toFixed(2)) : 0,
      intervalTimeAboveBudgetMs: Number(intervalTimeAboveBudgetMs.toFixed(1)),
      excessMsAboveBudget: Number(excessMsAboveBudget.toFixed(1)),
    }];
  }));
  const samples = frames.filter((frame) => frame.telemetry);
  const lastSample = samples.at(-1), priorSample = samples.length > 1 ? samples.at(-2) : null;
  const sampleSeconds = priorSample && lastSample ? lastSample.elapsedSeconds - priorSample.elapsedSeconds : 0;
  const sameWorld = priorSample?.telemetry?.worldId != null && priorSample.telemetry.worldId === lastSample?.telemetry?.worldId;
  const rate = (a, b, key) => Number.isFinite(a?.[key]) && Number.isFinite(b?.[key]) && sampleSeconds > 0 && b[key] >= a[key] ? Number(((b[key] - a[key]) / sampleSeconds).toFixed(2)) : null;
  const objectRatesPerSecond = priorSample && lastSample ? {
    world: sameWorld ? Object.fromEntries(Object.keys(lastSample.telemetry.worldLifecycle || {}).map((key) => [key, rate(priorSample.telemetry.worldLifecycle, lastSample.telemetry.worldLifecycle, key)])) : null,
    vfx: Object.fromEntries(Object.keys(lastSample.telemetry.vfxLifecycle || {}).map((key) => [key, rate(priorSample.telemetry.vfxLifecycle, lastSample.telemetry.vfxLifecycle, key)])),
    intervalSeconds: Number(sampleSeconds.toFixed(3)),
  } : null;
  const nav = globalThis.navigator;
  const firstHeap = frames.find((frame) => frame.heapBytes > 0)?.heapBytes || null;
  return {
    title: 'Velscour Performance Diagnostics', sessionId: sessionStatus.sessionId, generatedAt: new Date().toISOString(), durationSeconds: Number((sessionStatus.elapsedMs / 1000).toFixed(3)),
    statisticsScope: { sessionStatistics: 'complete-recording', detailedFrames: 'bounded, downsampled retained ring plus all retained significant spike frames', totalFramesObserved: frameTotals?.frames || count, retainedFrames: count, retainedFrameLimit: CAP,
      exportedFrames: frames.length, exportedFrameLimit: MAX_EXPORTED_FRAMES + 100, exportedFrameStride: exportStride,
      detailedFramesTruncated: (frameTotals?.frames || count) > count || frames.length < count, elapsedSecondsReference: 'unified recording start; does not restart when the ring buffer wraps' },
    completeSessionStatistics: frameTotals ? {
      framesObserved: frameTotals.frames,
      sampledEntityCounts: { sampleCount: frameTotals.entityCountSamples, latest: { ...frameTotals.entityCountsLatest }, maximum: { ...frameTotals.entityCountsMaximum } },
      lifecycleChangeDeltasBetweenSamples: { world: { ...frameTotals.lifecycleDeltaObserved.world }, vfx: { ...frameTotals.lifecycleDeltaObserved.vfx }, note: 'Deltas begin at the recording baseline and are accumulated at supported entity-count sample points.' },
      timingMs: Object.fromEntries(KEYS.map((key) => [key, { mean: frameTotals.frames ? Number((frameTotals.sums[key] / frameTotals.frames).toFixed(3)) : 0, minimum: Number((frameTotals.minima[key] === Infinity ? 0 : frameTotals.minima[key]).toFixed(3)), maximum: Number(frameTotals.maxima[key].toFixed(3)) }])),
      framesOver16Point67msBudget: frameTotals.overBudgetFrames, framesOver50ms: frameTotals.over50msFrames, framesOver100ms: frameTotals.over100msFrames,
      simulationTime: { ...frameTotals.simulation, rafRealMs: Number(frameTotals.simulation.rafRealMs.toFixed(2)), rafSimulatedMs: Number(frameTotals.simulation.rafSimulatedMs.toFixed(2)),
        rafDiscardedMs: Number(frameTotals.simulation.rafDiscardedMs.toFixed(2)), catchupRealMs: Number(frameTotals.simulation.catchupRealMs.toFixed(2)),
        catchupSimulatedMs: Number(frameTotals.simulation.catchupSimulatedMs.toFixed(2)), catchupDiscardedMs: Number(frameTotals.simulation.catchupDiscardedMs.toFixed(2)), catchupUnprocessedMs: Number(frameTotals.simulation.catchupUnprocessedMs.toFixed(2)), catchupMaxWorkMs: Number(frameTotals.simulation.catchupMaxWorkMs.toFixed(2)),
        note: 'RAF real time, clamped simulation time, discarded time, and catch-up time left unprocessed because the game was paused or no world was active are measured separately.' },
      diagnosticOverhead: { ...frameTotals.diagnosticOverhead, meanMs: frameTotals.diagnosticOverhead.samples ? Number((frameTotals.diagnosticOverhead.totalMs / frameTotals.diagnosticOverhead.samples).toFixed(4)) : 0,
        percentOfRecordedProcessing: frameTotals.sums.frameMs ? Number((frameTotals.diagnosticOverhead.totalMs * 100 / frameTotals.sums.frameMs).toFixed(3)) : 0 },
      significantSpikes: frameTotals.significantSpikes.slice().sort((a, b) => b.severityMs - a.severityMs),
      environments: Object.fromEntries(Object.entries(frameTotals.environments).map(([name, value]) => [name, { ...value, averageFrameMs: value.frames ? Number((value.totalFrameMs / value.frames).toFixed(3)) : 0 }]))
    } : null,
    build: { version: GAME_VERSION, id: GAME_BUILD_ID },
    character: G.char?.name || null, depth: G.world?.depth ?? null, environment: G.world?.biome?.name || G.world?.kind || null,
    gameplayContext: {
      worldId: G.world?.id ?? null, worldSeconds: Number((G.world?.time || 0).toFixed(2)), worldKind: G.world?.kind || null,
      riftTier: G.world?.rift?.tier ?? null, characterClass: G.char?.classId || null, characterLevel: G.char?.level ?? null,
      greedLevel: G.world?.greed ?? G.char?.greedLevel ?? G.char?.greed ?? 0, heresyRank: G.world?.heresy?.rank ?? null,
      enemies: lastSample?.enemies ?? null, inactiveEnemies: lastSample?.inactiveEnemies ?? null, kills: G.world?.kills ?? null,
    },
    runtime: {
      userAgent: nav?.userAgent || null, platform: nav?.platform || null,
      hardwareConcurrency: Number.isFinite(nav?.hardwareConcurrency) ? nav.hardwareConcurrency : null,
      deviceMemoryGiB: Number.isFinite(nav?.deviceMemory) ? nav.deviceMemory : null,
      renderer: 'Canvas 2D', contextAttributes: G.ctx?.getContextAttributes?.() || null,
    },
    graphicsSettings: {
      resolutionScale: G.resScale || 1, devicePixelRatio: G.dpr || 1, fpsCap: G.settings?.fpsCap ?? null,
      graphicsPreset: G.settings?.graphicsPreset || 'standard', adaptivePerformance: G.settings?.adaptivePerformance === true,
      cosmeticQualityTier: G.performanceQualityTier || 0,
      gore: G.settings?.gore ?? null, heldEffects: G.settings?.heldFx ?? null, outlines: G.settings?.outlines ?? null,
      particleQuality: G.settings?.particleQuality ?? null,
    },
    renderResolution: { scale: G.resScale || 1, devicePixelRatio: G.dpr || 1, canvasWidth: G.canvas?.width || 0, canvasHeight: G.canvas?.height || 0 },
    summaryMs: summaries,
    frameSummariesByEnvironmentAndResolution: summarizeFrameGroups(frames),
    framePacing: {
      currentFps: rafGap > 0 ? Number((1000 / rafGap).toFixed(2)) : 0,
      averageFps: meanInterval > 0 ? Number((1000 / meanInterval).toFixed(2)) : 0,
      medianFps: quantile(intervals, 0.5) > 0 ? Number((1000 / quantile(intervals, 0.5)).toFixed(2)) : 0,
      low1PercentFps: quantile(intervals, 0.99) > 0 ? Number((1000 / quantile(intervals, 0.99)).toFixed(2)) : 0,
      lowPoint1PercentFps: quantile(intervals, 0.999) > 0 ? Number((1000 / quantile(intervals, 0.999)).toFixed(2)) : 0,
      frameTimeMs: { median: quantile(frameTimes, 0.5), p95: quantile(frameTimes, 0.95), p99: quantile(frameTimes, 0.99), worst: frameTimes.at(-1) || 0 },
      intervalCountsAbove60FpsBudget: pacing[60], intervalCountsAbove30FpsBudget: pacing[30], intervalCountsAbove24FpsBudget: pacing[24],
      longProcessingFrames: { over50ms: frameTotals?.over50msFrames ?? frameTimes.filter((value) => value > 50).length, over100ms: frameTotals?.over100msFrames ?? frameTimes.filter((value) => value > 100).length, scope: 'complete session' },
      spikeThresholdMs: Number(FRAME_BUDGET_MS.toFixed(2)), spikeFrames,
    },
    longTasks: {
      supported: typeof PerformanceObserver !== 'undefined' && !!PerformanceObserver.supportedEntryTypes?.includes('longtask'),
      observedCount: longTaskCount, retainedEntryCount: longTasks.length, retainedEntryLimit: MAX_LONG_TASKS, importantEntriesTruncated: longTaskCount > longTasks.length,
      entries: longTasks.slice().sort((a, b) => b.durationMs - a.durationMs).map((task) => ({ ...task, timestampUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + task.startTimeMs).toISOString() })),
    },
    externalTimingSummary: Object.fromEntries(Object.entries(externalTimingTotals).map(([name, value]) => [name, {
      count: value.count, meanMs: Number((value.totalMs / value.count).toFixed(3)), minMs: Number((value.minMs === Infinity ? 0 : value.minMs).toFixed(3)), maxMs: Number(value.maxMs.toFixed(3)),
      byEnvironment: Object.fromEntries(Object.entries(value.byEnvironment).map(([environment, row]) => [environment, { count: row.count, meanMs: Number((row.totalMs / row.count).toFixed(3)), minMs: Number((row.minMs === Infinity ? 0 : row.minMs).toFixed(3)), maxMs: Number(row.maxMs.toFixed(3)) }]))
    }])),
    externalTimings: externalTimings.map((timing) => ({ ...timing,
      timestampUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + timing.timestampMs).toISOString() })),
    pageState: { visibility: typeof document !== 'undefined' ? document.visibilityState : null, focused: typeof document !== 'undefined' ? document.hasFocus?.() ?? null : null },
    lifecycle: { latest: lastSample?.telemetry || null, ratesPerSecondBetweenLastSamples: objectRatesPerSecond,
      visualEffectSources: vfxDiagnosticReport(), tessarielsKeepArtCache: keepCacheDiagnosticReport() },
    memory: {
      supported: !!performance.memory, latestHeapBytes: performance.memory?.usedJSHeapSize || 0, peakSampledHeapBytes: peakHeapBytes,
      firstSampledHeapBytes: firstHeap, growthBytes: firstHeap && peakHeapBytes ? peakHeapBytes - firstHeap : null,
      completeSessionSamples: frameTotals?.heap || null,
    },
    availability: { jsHeap: !!performance.memory, gcEvents: false, gpuFrameTime: false, listenerCounts: false, timerCounts: false, offscreenCachesBytes: false },
    incidentCaptureScope: { triggersObserved: incidentSerial, capturesStored: incidents.length, captureLimit: MAX_INCIDENTS,
      capturesTruncated: incidentSerial > incidents.length, preWindowMs: INCIDENT_PRE_MS, postWindowMs: INCIDENT_POST_MS, sampleIntervalMs: CONTEXT_SAMPLE_MS,
      note: 'Frame spike totals and important event counts continue for the full recording; detailed incident windows are bounded to the most recent 24 captures.' },
    incidents: incidents.map(({ _lastSamplePerfMs, ...incident }) => ({ ...incident, state: incident.state === 'capturing' ? 'incomplete-at-export' : incident.state })),
    frames,
    note: 'Detailed frame samples use a bounded ring and are downsampled on export to reduce report size; all significant spike frames are retained, and complete-session timing aggregates remain exact. Marker, error, collision-recovery, and severe-spike incident snapshots retain a sampled 3-second lead-in and 2.5-second follow-up with player position, movement/ability state, key/mouse state, environment, entity counts, and subsystem timings. Player update now reports total wall time, the uninstrumented remainder, and explicit timers for recovery, timers/gear/affixes, passives, status, resources/buffs, cooldowns/legendary work, action/movement, pathfinding, and collision. Nested timings are marked so they are not double-counted. Simulation real time, clamped game time, catch-up timing, and measured diagnostic overhead are reported separately. Object lifecycle/type breakdowns are sampled every 15 frames and at world changes. Long-task observation is recording-only and retains at most 128 entries. Browser/GPU frame time, GPU memory, GC events, timer/listener totals, and audio hardware latency are unavailable here and are not fabricated.',
  };
}

export function exportPerformanceReport() {
  const report = performanceReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `velscour-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return report;
}
