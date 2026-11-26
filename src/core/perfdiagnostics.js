// Optional, rolling performance diagnostics. No history, timer reads, DOM, or entity scans while disabled.
import { G } from '../state.js';
import { vfxStats } from '../gfx/vfx.js';
import { audioActiveCount } from './audio.js';
import { GAME_BUILD_ID, GAME_VERSION } from '../data/build-version.js';
import { FRAME_BUDGET_MS, summarizeFrameGroups, summarizeFrameSpikes } from './performance-analysis.js';

const CAP = 27000; // 3 minutes at 150 Hz; longer on typical 60-120 Hz displays
const HISTORY_MS = 180000;
const MAX_LONG_TASKS = 128;
const KEYS = ['frameMs', 'gapMs', 'updateMs', 'renderMs', 'renderSetupMs', 'floorDrawMs', 'groundDrawMs', 'renderSortMs', 'depthDrawMs', 'effectDrawMs', 'ambientTopDrawMs', 'particleDrawMs', 'topHazardDrawMs', 'topEffectDrawMs', 'lightingMs', 'screenOverlayMs', 'skyFrontMs', 'seeThroughMs', 'screenFeedbackMs', 'hudLabelsMs', 'combatTextMs', 'cinematicOverlayMs', 'automapMs', 'worldMs', 'aiMs', 'pathMs', 'collisionMs', 'hazardMs', 'lootMs', 'vfxMs', 'uiMs', 'enemyHistoryMs', 'minimapMs', 'eventsMs', 'environmentMs'];
const COUNT_KEYS = ['creatures', 'enemies', 'inactiveEnemies', 'offscreenCreatures', 'deadCreatures', 'corpses', 'projectiles', 'hazards', 'traps', 'groundItems', 'lootLabels', 'particles', 'visibleParticles', 'effects', 'groundEffects', 'topEffects', 'decals', 'gore', 'damageText', 'audio', 'spatialCandidates', 'collisionPairs', 'pathSearches', 'renderQueue', 'renderViews', 'renderCreatures', 'renderWalls', 'renderProps', 'renderLoot'];
let history = null, cursor = 0, count = 0, frameSerial = 0, prevRaf = 0, nextPaint = 0, latestCounts = null;
let frameStarted = 0, rafGap = 16.667, updateMs = 0, renderMs = 0, phases = null;
let panel = null, graph = null;
let longTaskObserver = null, longTasks = [];

export const performanceProfilerEnabled = () => G.settings?.performanceProfiler === true;

function allocateHistory() {
  if (history) return;
  history = Object.fromEntries(KEYS.map((key) => [key, new Float32Array(CAP)]));
  history.samples = new Uint16Array(CAP);
  history.timestamps = new Float64Array(CAP);
  history.depths = new Float64Array(CAP);
  history.environments = new Array(CAP);
  history.worldKinds = new Array(CAP);
  history.resolutionScale = new Float32Array(CAP);
  history.devicePixelRatio = new Float32Array(CAP);
  history.canvasWidth = new Uint32Array(CAP);
  history.canvasHeight = new Uint32Array(CAP);
  history.heapBytes = new Float64Array(CAP);
  history.visible = new Uint8Array(CAP);
  history.focused = new Uint8Array(CAP);
  history.telemetry = new Array(CAP);
  history.counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, new Uint32Array(CAP)]));
  cursor = count = frameSerial = 0;
}

function addStyle() {
  if (document.getElementById('perf-diagnostics-style')) return;
  const style = document.createElement('style');
  style.id = 'perf-diagnostics-style';
  style.textContent = `#perf-diagnostics{position:fixed;z-index:2147483000;right:10px;top:10px;width:min(340px,calc(100vw - 20px));max-height:48vh;overflow:auto;padding:10px 12px;background:rgba(13,10,15,.94);border:1px solid #9a7135;border-radius:7px;box-shadow:0 4px 22px #000b;color:#ead8ad;font:12px/1.35 system-ui,sans-serif;pointer-events:auto}#perf-diagnostics b{color:#ffdc85}#perf-diagnostics .pd-head{display:flex;justify-content:space-between;align-items:center;gap:8px}#perf-diagnostics button{color:#f2d38d;background:#2a1b11;border:1px solid #795a2c;border-radius:4px;padding:3px 7px;cursor:pointer}#perf-diagnostics .pd-stats{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:7px}#perf-diagnostics canvas{display:block;width:100%;height:48px;margin:6px 0;background:#08070a;border:1px solid #3a2c20}#perf-diagnostics .pd-small{font-size:10px;color:#c4b99f}`;
  document.head.appendChild(style);
}

function mountPanel() {
  if (panel?.isConnected) return;
  addStyle();
  panel = document.createElement('section');
  panel.id = 'perf-diagnostics';
  panel.innerHTML = '<div class="pd-head"><b>Performance diagnostics</b></div><div data-pd-summary></div><canvas width="640" height="96" aria-label="Recent frame times"></canvas><div class="pd-stats" data-pd-stats></div><div class="pd-small" data-pd-note></div>';
  document.body.appendChild(panel);
  graph = panel.querySelector('canvas');
}

function dropPanel() {
  panel?.remove(); panel = graph = null;
  document.getElementById('perf-diagnostics-style')?.remove();
}

export function setPerformanceProfilerEnabled(enabled) {
  if (enabled) { allocateHistory(); mountPanel(); startLongTaskObserver(); }
  else {
    stopLongTaskObserver();
    history = null; latestCounts = null; count = cursor = frameSerial = 0;
    longTasks = [];
    prevRaf = nextPaint = 0; phases = null;
    dropPanel();
  }
}

export function resetPerformanceStatistics() {
  if (!performanceProfilerEnabled()) return false;
  stopLongTaskObserver();
  history = null; latestCounts = null; count = cursor = frameSerial = 0;
  longTasks = [];
  prevRaf = nextPaint = 0; phases = null;
  allocateHistory(); mountPanel();
  startLongTaskObserver();
  return true;
}

function startLongTaskObserver() {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          startTimeMs: Number(entry.startTime.toFixed(2)),
          durationMs: Number(entry.duration.toFixed(2)),
          name: String(entry.name || 'unknown'),
          attribution: (entry.attribution || []).slice(0, 4).map((item) => ({
            name: String(item.name || ''), containerName: String(item.containerName || ''),
            containerId: String(item.containerId || ''), containerSrc: String(item.containerSrc || ''),
          })),
        });
        if (longTasks.length > MAX_LONG_TASKS) longTasks.splice(0, longTasks.length - MAX_LONG_TASKS);
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

export function profileBeginFrame(rafNow) {
  if (!performanceProfilerEnabled()) return false;
  allocateHistory(); mountPanel();
  const now = Number(rafNow) || performance.now();
  rafGap = prevRaf ? Math.max(0, now - prevRaf) : 16.667;
  prevRaf = now;
  frameStarted = performance.now();
  updateMs = renderMs = 0;
  phases = { worldMs: 0, aiMs: 0, pathMs: 0, collisionMs: 0, hazardMs: 0, lootMs: 0, vfxMs: 0, uiMs: 0, enemyHistoryMs: 0, minimapMs: 0, eventsMs: 0, environmentMs: 0, renderSetupMs: 0, floorDrawMs: 0, groundDrawMs: 0, renderSortMs: 0, depthDrawMs: 0, effectDrawMs: 0, ambientTopDrawMs: 0, particleDrawMs: 0, topHazardDrawMs: 0, topEffectDrawMs: 0, lightingMs: 0, screenOverlayMs: 0, skyFrontMs: 0, seeThroughMs: 0, screenFeedbackMs: 0, hudLabelsMs: 0, combatTextMs: 0, cinematicOverlayMs: 0, automapMs: 0 };
  return true;
}

export function profileSetUpdate(ms) { if (history) updateMs = ms; }
export function profileSetRender(ms) { if (history) renderMs = ms; }

function readCounts(world) {
  let enemies = 0, inactiveEnemies = 0, deadCreatures = 0, projectiles = 0;
  for (const c of world?.creatures || []) {
    if (c.dead) { deadCreatures++; continue; }
    if (c.team === 'enemy') { enemies++; if (!c.awake) inactiveEnemies++; }
  }
  for (const h of world?.hazards || []) if (h.isProjectile || h.projectile || h.constructor?.name === 'Projectile') projectiles++;
  const vfx = vfxStats();
  return {
    creatures: world?.creatures?.length || 0,
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
  const frameMs = performance.now() - frameStarted;
  const at = cursor;
  const now = performance.now();
  history.timestamps[at] = now;
  history.depths[at] = Number.isFinite(Number(world?.depth)) ? Number(world.depth) : 0;
  history.environments[at] = world?.biome?.name || world?.biome?.id || world?.kind || '';
  history.worldKinds[at] = world?.kind || '';
  history.resolutionScale[at] = Number(G.resScale) || 1;
  history.devicePixelRatio[at] = Number(G.dpr) || 1;
  history.canvasWidth[at] = G.canvas?.width || 0;
  history.canvasHeight[at] = G.canvas?.height || 0;
  history.frameMs[at] = frameMs;
  history.gapMs[at] = rafGap;
  history.visible[at] = typeof document !== 'undefined' && document.visibilityState === 'visible' ? 1 : 0;
  history.focused[at] = typeof document !== 'undefined' && document.hasFocus?.() ? 1 : 0;
  history.updateMs[at] = updateMs;
  history.renderMs[at] = renderMs;
  history.worldMs[at] = phases.worldMs; history.aiMs[at] = phases.aiMs;
  history.pathMs[at] = phases.pathMs; history.collisionMs[at] = phases.collisionMs;
  history.hazardMs[at] = phases.hazardMs; history.lootMs[at] = phases.lootMs;
  history.vfxMs[at] = phases.vfxMs; history.uiMs[at] = phases.uiMs;
  history.enemyHistoryMs[at] = phases.enemyHistoryMs; history.minimapMs[at] = phases.minimapMs;
  history.eventsMs[at] = phases.eventsMs; history.environmentMs[at] = phases.environmentMs;
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
  if ((frameSerial++ % 15) === 0) {
    latestCounts = readCounts(world);
    history.heapBytes[at] = performance.memory?.usedJSHeapSize || 0;
    history.telemetry[at] = JSON.stringify(latestCounts.telemetry);
  } else { history.heapBytes[at] = history.heapBytes[(at - 1 + CAP) % CAP]; history.telemetry[at] = ''; }
  history.samples[at] = latestCounts ? 1 : 0;
  for (const key of COUNT_KEYS) history.counts[key][at] = latestCounts?.[key] || 0;
  cursor = (cursor + 1) % CAP; count = Math.min(CAP, count + 1);
  while (count > 1) {
    const oldest = (cursor - count + CAP) % CAP;
    if (now - history.timestamps[oldest] <= HISTORY_MS) break;
    count--;
  }
  if (now >= nextPaint) { nextPaint = now + 1000; paintPanel(frameMs); }
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
    ['AI', phases?.aiMs], ['Pathfinding', phases?.pathMs], ['Collision', phases?.collisionMs],
    ['Hazards', phases?.hazardMs], ['Loot', phases?.lootMs], ['VFX', phases?.vfxMs], ['HUD', phases?.uiMs],
    ['Enemy history (HUD subphase)', phases?.enemyHistoryMs], ['Minimap (HUD subphase)', phases?.minimapMs],
    ['Events / world scripts', phases?.eventsMs], ['Environment', phases?.environmentMs],
    ['Render setup / floor tiles', phases?.renderSetupMs], ['Floor chunk draw', phases?.floorDrawMs],
    ['Ground decals / effects', phases?.groundDrawMs], ['Render queue + sorting', phases?.renderSortMs],
    ['Depth-sorted actors / terrain', phases?.depthDrawMs], ['Particles / effects', phases?.effectDrawMs],
    ['Lighting', phases?.lightingMs], ['Screen overlays / labels', phases?.screenOverlayMs], ['TAB map', phases?.automapMs],
  ];
  const frameStats = stat(times);
  const statsEl = panel.querySelector('[data-pd-stats]');
  statsEl.innerHTML = `<span>Frame p50 / p95 / p99 / max</span><span>${show(frameStats.p50)} / ${show(frameStats.p95)} / ${show(frameStats.p99)} / ${show(frameStats.worst)} ms</span><span>Update / render</span><span>${show(updateMs)} / ${show(renderMs)} ms</span>` + items.map(([name, value]) => `<span>${name}</span><span>${show(value)} ms</span>`).join('') + COUNT_KEYS.map((key) => `<span>${key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)}</span><span>${latestCounts?.[key] || 0}</span>`).join('');
  const mem = performance.memory?.usedJSHeapSize;
  panel.querySelector('[data-pd-note]').textContent = `Rolling up to 180 s · ${mem ? `JS heap ${(mem / 1048576).toFixed(1)} MiB` : 'JS heap unavailable in this runtime'} · Entity counts refresh every 15 frames.`;
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
  if (!history || !count) return { error: 'Profiler is disabled or no frames have been collected.' };
  const first = (cursor - count + CAP) % CAP, frames = [];
  let peakHeapBytes = 0;
  for (let i = 0; i < count; i++) {
    const at = (first + i) % CAP, row = {};
    for (const key of KEYS) row[key] = Number(history[key][at].toFixed(3));
    row.depth = history.depths[at] || 0;
    row.environment = history.environments[at] || '';
    row.worldKind = history.worldKinds[at] || '';
    row.resolutionScale = history.resolutionScale[at] || 1;
    row.devicePixelRatio = history.devicePixelRatio[at] || 1;
    row.canvasWidth = history.canvasWidth[at];
    row.canvasHeight = history.canvasHeight[at];
    row.elapsedSeconds = Number(((history.timestamps[at] - history.timestamps[first]) / 1000).toFixed(3));
    row.timestampUtc = new Date((performance.timeOrigin || Date.now() - performance.now()) + history.timestamps[at]).toISOString();
    row.pageVisible = history.visible[at] === 1;
    row.pageFocused = history.focused[at] === 1;
    row.heapBytes = history.heapBytes[at]; peakHeapBytes = Math.max(peakHeapBytes, row.heapBytes);
    if (history.samples[at]) {
      for (const key of COUNT_KEYS) row[key] = history.counts[key][at];
      try { row.telemetry = JSON.parse(history.telemetry[at] || 'null'); } catch { row.telemetry = null; }
    }
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
    title: 'Velscour Performance Diagnostics', generatedAt: new Date().toISOString(), durationSeconds: count > 1 ? Number(((history.timestamps[cursor - 1 < 0 ? CAP - 1 : cursor - 1] - history.timestamps[first]) / 1000).toFixed(3)) : 0,
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
      longProcessingFrames: { over50ms: frameTimes.filter((value) => value > 50).length, over100ms: frameTimes.filter((value) => value > 100).length },
      spikeThresholdMs: Number(FRAME_BUDGET_MS.toFixed(2)), spikeFrames,
    },
    longTasks: {
      supported: typeof PerformanceObserver !== 'undefined' && !!PerformanceObserver.supportedEntryTypes?.includes('longtask'),
      observedCount: longTasks.length,
      entries: longTasks.map((task) => ({ ...task, timestampUtc: new Date((performance.timeOrigin || Date.now() - performance.now()) + task.startTimeMs).toISOString() })),
    },
    pageState: { visibility: typeof document !== 'undefined' ? document.visibilityState : null, focused: typeof document !== 'undefined' ? document.hasFocus?.() ?? null : null },
    lifecycle: { latest: lastSample?.telemetry || null, ratesPerSecondBetweenLastSamples: objectRatesPerSecond },
    memory: {
      supported: !!performance.memory, latestHeapBytes: performance.memory?.usedJSHeapSize || 0, peakSampledHeapBytes: peakHeapBytes,
      firstSampledHeapBytes: firstHeap, growthBytes: firstHeap && peakHeapBytes ? peakHeapBytes - firstHeap : null,
    },
    availability: { jsHeap: !!performance.memory, gcEvents: false, gpuFrameTime: false, listenerCounts: false, timerCounts: false, offscreenCachesBytes: false },
    frames,
    note: 'History is bounded to 180 seconds, retains at most 100 worst 60 Hz-budget frame/gap samples, and stores object lifecycle/type breakdowns every 15 frames. Long-task observation is active only while the profiler is enabled and retains at most 128 entries. This measures main-thread processing and animation-frame cadence, not true display presentation. Browser/GPU frame time, GPU memory, GC events, timer/listener totals, and audio hardware latency are unavailable here and are not fabricated. A missing runtime field means that runtime does not expose it.',
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
