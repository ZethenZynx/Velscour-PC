// Coordinates the existing performance and audio recorders as one manual session.
import { G, developerModeEnabled } from '../state.js';
import { GAME_BUILD_ID, GAME_VERSION } from '../data/build-version.js';
import { audioDiagnosticReport, clearAudioDiagnosticRecording, recordAudioDiagnosticMarker, startAudioDiagnosticRecording, stopAudioDiagnosticRecording } from './audio.js';
import { performanceReport, resetPerformanceStatistics, setPerformanceProfilerEnabled } from './perfdiagnostics.js';
import { beginDeveloperSession, clearDeveloperSession, developerRecordingActive, developerSessionReport, developerSessionStatus, endDeveloperSession, recordDeveloperEvent } from './developer-session.js';
import { resetVfxDiagnostics } from '../gfx/vfx.js';
import { resetKeepCacheDiagnostics } from '../gfx/keepart.js';

function copy(value) {
  try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; }
}

function runtimeContext() {
  const world = G.world, character = G.char;
  return {
    game: { version: GAME_VERSION, buildId: GAME_BUILD_ID, gitCommitId: globalThis.__VELSCOUR_GIT_COMMIT__ || null },
    character: character ? { name: character.name || null, classId: character.classId || null, level: character.level ?? null } : null,
    gameplay: world ? { worldId: world.id ?? null, mode: world.kind || null, environment: world.biome?.name || world.kind || null,
      depth: world.depth ?? null, riftTier: world.rift?.tier ?? null, greed: world.greed ?? character?.greedLevel ?? null,
      heresyRank: world.heresy?.rank ?? null, worldSeconds: Number(world.time || 0) } : null,
    graphicsSettings: { resolutionScale: G.resScale || 1, devicePixelRatio: G.dpr || 1, fpsCap: G.settings?.fpsCap ?? null,
      graphicsPreset: G.settings?.graphicsPreset || 'standard', adaptivePerformance: G.settings?.adaptivePerformance === true },
    audioSettings: copy(G.settings?.audio),
  };
}

export function startUnifiedDiagnosticRecording() {
  if (!developerModeEnabled() || developerRecordingActive()) return false;
  setPerformanceProfilerEnabled(false);
  stopAudioDiagnosticRecording();
  clearAudioDiagnosticRecording();
  resetPerformanceStatistics();
  const context = runtimeContext();
  const session = beginDeveloperSession(context);
  resetVfxDiagnostics();
  resetKeepCacheDiagnostics();
  setPerformanceProfilerEnabled(true);
  if (!startAudioDiagnosticRecording({ sessionId: session.id })) {
    setPerformanceProfilerEnabled(false);
    endDeveloperSession('audio-recorder-unavailable');
    return false;
  }
  return true;
}

export function stopUnifiedDiagnosticRecording(reason = 'stopped') {
  if (!developerRecordingActive()) return false;
  stopAudioDiagnosticRecording();
  setPerformanceProfilerEnabled(false);
  endDeveloperSession(reason);
  return true;
}

export function clearUnifiedDiagnosticRecording() {
  if (developerRecordingActive()) stopUnifiedDiagnosticRecording('cleared');
  setPerformanceProfilerEnabled(false);
  stopAudioDiagnosticRecording();
  clearAudioDiagnosticRecording();
  resetPerformanceStatistics();
  clearDeveloperSession();
  return true;
}

export function addUnifiedDiagnosticMarker(marker) {
  const text = String(marker || '').trim().slice(0, 120);
  if (!text || !developerRecordingActive()) return false;
  return recordAudioDiagnosticMarker('user-marker', { marker: text });
}

export function unifiedDiagnosticStatus() { return developerSessionStatus(); }

export function unifiedDiagnosticReport() {
  const session = developerSessionReport();
  if (session.error) return { title: 'Velscour Unified Diagnostics', error: session.error, game: runtimeContext().game };
  const performance = performanceReport(), audio = audioDiagnosticReport();
  const timeline = session.timeline || [];
  const completePerformance = performance.completeSessionStatistics || {};
  const timings = completePerformance.timingMs || {};
  const counts = completePerformance.sampledEntityCounts || null;
  const lifecycle = completePerformance.lifecycleChangeDeltasBetweenSamples || null;
  const pickTimings = (keys) => Object.fromEntries(keys.filter((key) => timings[key]).map((key) => [key, timings[key]]));
  return {
    title: 'Velscour Unified Diagnostic Report', schemaVersion: 1, generatedAt: new Date().toISOString(),
    sessionId: session.sessionId, game: session.metadata?.game || runtimeContext().game,
    gitCommitId: session.metadata?.game?.gitCommitId || globalThis.__VELSCOUR_GIT_COMMIT__ || null,
    recording: session, contextAtRecordingStart: session.metadata || null, contextAtExport: runtimeContext(),
    sections: {
      performance: { sessionId: session.sessionId, ...performance },
      audio: { sessionId: session.sessionId, ...audio },
      entitiesAndLifecycle: { sessionId: session.sessionId, sampleCount: counts?.sampleCount ?? 0, latestCounts: counts?.latest || null,
        maximumCounts: counts?.maximum || null, observedLifecycleDeltas: lifecycle, perEnvironmentFrameStats: completePerformance.environments || {} },
      rendering: { sessionId: session.sessionId, timingMs: pickTimings(['renderMs', 'renderSetupMs', 'floorDrawMs', 'groundDrawMs', 'renderSortMs', 'depthDrawMs', 'effectDrawMs', 'lightingMs', 'screenOverlayMs', 'particleDrawMs', 'topHazardDrawMs']),
        significantSessionSpikes: completePerformance.significantSpikes || [], retainedDetailedSpikes: performance.framePacing?.spikeFrames || [] },
      aiCollisionPathfinding: { sessionId: session.sessionId, timingMs: pickTimings(['aiMs', 'playerUpdateMs', 'creatureUpdateMs', 'townLifeUpdateMs', 'keepDirectorUpdateMs', 'keepCompanionUpdateMs', 'keepFolkUpdateMs', 'townAgentUpdateMs', 'otherNpcUpdateMs', 'pathMs', 'collisionMs']) },
      movementAndCollision: { sessionId: session.sessionId,
        methodMetrics: Object.fromEntries(Object.entries(session.metrics || {}).filter(([key]) => key.startsWith('movement.'))),
        recoveryEvents: timeline.filter((event) => /position-recover|collision-/i.test(event.type)),
        incidentWindows: performance.incidents || [],
        note: 'Blocked movement counts are measured only for the player and aggregated by movement method/source. Ordinary wall contacts do not create per-frame timeline events. Recovery events contain before/after positions and ability/input lock state.' },
      inputAndAction: { sessionId: session.sessionId, incidentWindows: performance.incidents || [],
        interruptions: timeline.filter((event) => /attack-interruption|input-conflict|loot-interaction/i.test(event.type)),
        note: 'Held movement keys, Shift, mouse buttons, player target, movement vector, cast/channel/attack/interact/loot state are sampled only in retained incident windows and exported frame samples.' },
      functionLevelProfiling: { sessionId: session.sessionId,
        playerUpdateSubphases: pickTimings(['playerUpdateWallMs', 'playerUpdateUnattributedMs', 'playerRecoveryMs', 'playerTimersGearAffixesMs', 'playerClassPassivesMs', 'playerStatusMs', 'playerResourcesBuffsMs', 'playerAutoSummonMs', 'playerCooldownsLegendaryMs', 'playerActionMovementMs', 'playerPathMs', 'playerMoveCollisionMs']),
        slowestCallbacksInFrames: (performance.frames || []).filter((frame) => frame.aiSlowestCallback).map((frame) => ({ elapsedSeconds: frame.elapsedSeconds, environment: frame.environment, callback: frame.aiSlowestCallback, durationMs: frame.aiSlowestCallbackMs })),
        note: 'Player update wall time and uninstrumented remainder are measured explicitly. Group timings are inclusive of their nested path, collision, and auto-summon measurements; do not sum those nested values twice. JavaScript engine garbage-collection timing is unavailable.' },
      simulationTiming: { sessionId: session.sessionId, summary: completePerformance.simulationTime || null,
        note: 'Real RAF gaps are separate from clamped game delta and hidden-tab catch-up updates.' },
      diagnosticOverhead: { sessionId: session.sessionId, performance: completePerformance.diagnosticOverhead || null,
        recorderMetrics: Object.fromEntries(Object.entries(session.metrics || {}).filter(([key]) => key.startsWith('diagnostics.'))) },
      memory: { sessionId: session.sessionId, supported: performance.memory?.supported ?? false, completeSessionSamples: performance.memory?.completeSessionSamples || null,
        latestHeapBytes: performance.memory?.latestHeapBytes ?? null, peakSampledHeapBytes: completePerformance.heap?.peakBytes ?? null },
      particlesAndHazards: { sessionId: session.sessionId, counts: counts ? { latest: counts.latest, maximum: counts.maximum } : null,
        lifecycleDeltas: lifecycle ? { vfx: lifecycle.vfx, hazards: lifecycle.world } : null },
      uiAndLoot: { sessionId: session.sessionId, timingMs: pickTimings(['uiMs', 'hudLabelsMs', 'lootMs', 'saveMs', 'eventsMs']) },
      browserLongTasks: performance.longTasks || { supported: false, entries: [] },
    },
    timeline: { sessionId: session.sessionId, events: timeline,
      markers: timeline.filter((event) => /marker/i.test(event.type)),
      errors: timeline.filter((event) => /error|exception/i.test(event.type)),
      areaTransitions: timeline.filter((event) => /area-|transition/i.test(event.type)),
      combatTransitions: timeline.filter((event) => /combat-(start|end)/i.test(event.type)) },
    completeness: {
      performance: performance.statisticsScope || null,
      audio: audio.statisticsScope || null,
      timeline: session.statisticsScope || null,
      diagnosticMetrics: 'complete-session aggregates; individual event detail may be bounded',
      unavailableMeasurements: ['GPU frame time', 'GPU memory', 'JavaScript garbage collection events', 'browser-private memory allocations'],
      gitCommitIdAvailable: !!(session.metadata?.game?.gitCommitId || globalThis.__VELSCOUR_GIT_COMMIT__),
    },
  };
}

export async function resolveDeployedGitCommitId({ fetchImpl = globalThis.fetch, pageUrl = globalThis.location?.href } = {}) {
  if (globalThis.__VELSCOUR_GIT_COMMIT__) return String(globalThis.__VELSCOUR_GIT_COMMIT__);
  if (typeof fetchImpl !== 'function' || !pageUrl) return null;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 2500) : null;
  const options = { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, ...(controller ? { signal: controller.signal } : {}) };
  try {
    const buildUrl = new URL('src/data/build-version.js', pageUrl);
    buildUrl.searchParams.set('diagnostic-build', GAME_BUILD_ID);
    const buildResponse = await fetchImpl(buildUrl.href, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
    if (!buildResponse.ok) return null;
    const liveBuild = await buildResponse.text();
    if (!liveBuild.includes(`GAME_BUILD_ID = '${GAME_BUILD_ID}'`)) return null;
    const deploymentsResponse = await fetchImpl('https://api.github.com/repos/ZethenZynx/Velscour-PC/deployments?environment=github-pages&per_page=1', options);
    if (!deploymentsResponse.ok) return null;
    const deployments = await deploymentsResponse.json();
    const deployment = Array.isArray(deployments) ? deployments[0] : null;
    if (!deployment?.sha || !deployment.statuses_url) return null;
    const statusResponse = await fetchImpl(deployment.statuses_url, options);
    if (!statusResponse.ok) return null;
    const statuses = await statusResponse.json();
    return Array.isArray(statuses) && statuses[0]?.state === 'success' ? String(deployment.sha) : null;
  } catch { return null; }
  finally { if (timeout) clearTimeout(timeout); }
}

function compactEvents(events, limit = 320) {
  const pattern = /error|exception|marker|transition|area-|combat-|guardian|movement-|collision-|position-invalid|position-recover|attack-interruption|input-conflict|loot-interaction|simulation-spike|external-operation-spike|accumulation|cache-|lifecycle-|resource-/i;
  return (events || []).filter((event) => pattern.test(event.type || '') || event.category === 'error')
    .sort((a, b) => (Number(b.details?.severityMs) || 0) - (Number(a.details?.severityMs) || 0) || (a.perfMs || 0) - (b.perfMs || 0))
    .slice(0, limit).sort((a, b) => (a.perfMs || 0) - (b.perfMs || 0)).map(compactEvent);
}

function compactValue(value, depth = 0) {
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}… [string shortened in compact export; use Full Report for complete text]` : value;
  if (depth >= 4 && value && typeof value === 'object') return { nestedObjectOmitted: true, keys: Object.keys(value).slice(0, 40) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, compactValue(item, depth + 1)]));
}

function compactEvent(event) {
  return { id: event.id, sessionId: event.sessionId, type: event.type, category: event.category,
    timeUtc: event.timeUtc, perfMs: event.perfMs, elapsedMs: event.elapsedMs, worldId: event.worldId,
    worldKind: event.worldKind, environment: event.environment, depth: event.depth, inCombat: event.inCombat,
    details: compactValue(event.details) };
}

function compactVfxLifecycle(vfx) {
  if (!vfx || typeof vfx !== 'object') return vfx;
  const compactGroup = (group) => {
    if (!group || typeof group !== 'object') return group;
    const entries = Object.entries(group).sort((a, b) => ((b[1]?.activeNow || 0) * 1000 + (b[1]?.created || 0)) - ((a[1]?.activeNow || 0) * 1000 + (a[1]?.created || 0)));
    const selected = entries.slice(0, 48), omitted = entries.slice(48);
    const compactRows = Object.fromEntries(selected.map(([type, row]) => [type, { ...row,
      sourceSamples: Object.fromEntries(Object.entries(row.sourceSamples || {}).slice(0, 8)) }]));
    if (omitted.length) compactRows['other (compact summary)'] = omitted.reduce((sum, [, row]) => {
      for (const key of ['created', 'removed', 'activeFromSession', 'activeNow', 'expired', 'replaced', 'qualityChanged', 'qualityRejected', 'cleared', 'duplicateReference', 'lifetimeMsTotal', 'lifetimeSamples']) sum[key] = (sum[key] || 0) + (Number(row?.[key]) || 0);
      return sum;
    }, { summarizedTypeCount: omitted.length, sourceSamples: {} });
    return compactRows;
  };
  const compactSources = (sources) => {
    const rows = Object.entries(sources || {}).sort((a, b) => (b[1]?.removed || 0) - (a[1]?.removed || 0));
    const chosen = rows.slice(0, 32), omitted = rows.slice(32);
    const out = Object.fromEntries(chosen);
    if (omitted.length) out['other (compact summary)'] = { removed: omitted.reduce((n, [, row]) => n + (Number(row?.removed) || 0), 0), summarizedSourceCount: omitted.length,
      lifetimeMsTotal: omitted.reduce((n, [, row]) => n + (Number(row?.lifetimeMsTotal) || 0), 0) };
    return out;
  };
  return { ...vfx, particles: compactGroup(vfx.particles), effects: compactGroup(vfx.effects),
    particleSourceLifetimes: compactSources(vfx.particleSourceLifetimes), effectSourceLifetimes: compactSources(vfx.effectSourceLifetimes) };
}

function compactIncident(incident, stride = 5) {
  const sample = (rows) => (rows || []).filter((_, index) => index % stride === 0 || index === rows.length - 1).map((row) => compactValue(row));
  return { id: incident.id, trigger: incident.trigger, triggerPerfMs: incident.triggerPerfMs, capturedUtc: incident.capturedUtc,
    details: compactValue(incident.details), contextWindowMs: incident.contextWindowMs, state: incident.state,
    preEventSamples: sample(incident.preEventSamples), postEventSamples: sample(incident.postEventSamples) };
}

function compactReport(full) {
  if (!full?.sessionId) return full;
  const perf = full.sections?.performance || {}, audio = full.sections?.audio || {},
    summary = audio.summary || {}, incidents = perf.incidents || [], frames = perf.framePacing?.spikeFrames || [];
  const compactTimelineEvents = compactEvents(full.timeline?.events);
  const measured = {
    title: 'Velscour Compact Unified Diagnostic Report', schemaVersion: full.schemaVersion, generatedAt: full.generatedAt,
    sessionId: full.sessionId, game: full.game, gitCommitId: full.gitCommitId,
    recording: { sessionId: full.recording.sessionId, active: full.recording.active, startedUtc: full.recording.startedUtc,
      stoppedUtc: full.recording.stoppedUtc, durationMs: full.recording.durationMs, stopReason: full.recording.stopReason,
      metadata: full.recording.metadata, statisticsScope: full.recording.statisticsScope,
      eventCounts: full.recording.eventCounts, metrics: full.recording.metrics },
    contextAtRecordingStart: full.contextAtRecordingStart, contextAtExport: full.contextAtExport,
    performance: { statisticsScope: perf.statisticsScope, completeSessionStatistics: perf.completeSessionStatistics,
      build: perf.build, graphicsSettings: perf.graphicsSettings, gameplayContext: perf.gameplayContext,
      framePacing: { ...perf.framePacing, spikeFrames: frames.slice().sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0)).slice(0, 40) },
      longTasks: { supported: perf.longTasks?.supported, observedCount: perf.longTasks?.observedCount,
        entries: (perf.longTasks?.entries || []).slice(0, 20) }, externalTimingSummary: perf.externalTimingSummary, externalTimings: perf.externalTimings,
      memory: perf.memory, lifecycle: { ...perf.lifecycle, visualEffectSources: compactVfxLifecycle(perf.lifecycle?.visualEffectSources) }, incidents: incidents.slice(0, 24).map((incident) => compactIncident(incident)),
      incidentCaptureScope: perf.incidentCaptureScope },
    audio: { statisticsScope: audio.statisticsScope, startedUtc: audio.startedUtc, stoppedUtc: audio.stoppedUtc,
      durationMs: audio.durationMs, audioSettings: audio.audioSettings, activeInstancesByCategory: audio.activeInstancesByCategory,
      peakInstancesByCategory: audio.peakInstancesByCategory, metrics: audio.metrics,
      summary: { mostFrequentSounds: summary.mostFrequentSounds, mostFrequentCategories: summary.mostFrequentCategories,
        requestRates: summary.requestRates, perSoundAudio: Object.fromEntries(Object.entries(summary.perSoundAudio || {}).slice(0, 80)),
        requestOrigins: Object.fromEntries(Object.entries(summary.requestOrigins || {}).slice(0, 80)),
        originSuppression: Object.fromEntries(Object.entries(summary.originSuppression || {}).slice(0, 80)),
        peakSimultaneousCombatSounds: summary.peakSimultaneousCombatSounds,
        peakSimultaneousWebAudioSources: summary.peakSimultaneousWebAudioSources,
        requestToPlaybackLatencyMs: summary.requestToPlaybackLatencyMs, audioProcessingPerFrameMs: summary.audioProcessingPerFrameMs,
        longestSounds: summary.longestSounds, potentiallyOrphaned: summary.potentiallyOrphaned,
        stillActiveWhenRecordingStopped: summary.stillActiveWhenRecordingStopped,
        pendingSourcesWhenRecordingStopped: summary.pendingSourcesWhenRecordingStopped,
        activeSourcesWhenRecordingStopped: summary.activeSourcesWhenRecordingStopped,
        audioProcessingSpikes: summary.audioProcessingSpikes, audioProcessingSpikeCount: summary.audioProcessingSpikeCount,
        totalRequests: summary.totalRequests, lifecycle: summary.lifecycle ? { totalEvents: summary.lifecycle.totalEvents,
          requests: summary.lifecycle.requests, statisticsScope: summary.lifecycle.statisticsScope } : null },
      importantEvents: (audio.importantEvents || []).filter((event) => /error|unknown|playback|transition|combat|orphan|cancel|source/i.test(`${event.type} ${event.event}`)).slice(0, 100).map((event) => compactValue(event)) },
    functionTimings: full.sections?.functionLevelProfiling, entitiesAndLifecycle: full.sections?.entitiesAndLifecycle,
    rendering: full.sections?.rendering, movementAndCollision: full.sections?.movementAndCollision,
    inputAndAction: full.sections?.inputAndAction, particlesAndHazards: full.sections?.particlesAndHazards,
    simulationTiming: full.sections?.simulationTiming, diagnosticOverhead: full.sections?.diagnosticOverhead,
    memory: full.sections?.memory, uiAndLoot: full.sections?.uiAndLoot, browserLongTasks: full.sections?.browserLongTasks,
    timeline: { sessionId: full.sessionId, events: compactTimelineEvents,
      markers: (full.timeline?.markers || []).slice(-100).map(compactEvent), errors: (full.timeline?.errors || []).slice(-100).map(compactEvent),
      areaTransitions: (full.timeline?.areaTransitions || []).slice(-100).map(compactEvent), combatTransitions: (full.timeline?.combatTransitions || []).slice(-100).map(compactEvent) },
    completeness: full.completeness,
    compacting: { targetBytes: 1_000_000, ordinaryFrameSamplesExcluded: true, incidentContextSamplingMs: 500,
      prioritization: 'complete aggregates and categorized counts are retained; detailed context favors errors, transitions, movement failures, resource accumulation, and severe spikes' },
  };
  const bytes = () => new TextEncoder().encode(JSON.stringify(measured)).length;
  // Shrink only contextual detail if a rare error-heavy session exceeds the share target; never drop aggregates.
  if (bytes() > 950_000) measured.timeline.events = compactEvents(full.timeline?.events, 120);
  if (bytes() > 950_000) measured.audio.importantEvents = measured.audio.importantEvents.slice(0, 30);
  if (bytes() > 950_000) measured.performance.incidents = incidents.slice(0, 12).map((incident) => compactIncident(incident, 10));
  if (bytes() > 950_000) measured.performance.framePacing.spikeFrames = measured.performance.framePacing.spikeFrames.slice(0, 12);
  if (bytes() > 950_000) {
    measured.timeline.events = compactEvents(full.timeline?.events, 80);
    measured.timeline.markers = (full.timeline?.markers || []).slice(-30);
    measured.timeline.errors = (full.timeline?.errors || []).slice(-30);
    measured.timeline.areaTransitions = (full.timeline?.areaTransitions || []).slice(-30);
    measured.timeline.combatTransitions = (full.timeline?.combatTransitions || []).slice(-30);
    measured.performance.incidents = incidents.slice(0, 6).map((incident) => ({ ...compactIncident(incident, 100), preEventSamples: [], postEventSamples: [] }));
  }
  measured.compacting.actualBytes = bytes();
  measured.compacting.withinTarget = measured.compacting.actualBytes < 1_000_000;
  return measured;
}

export function compactUnifiedDiagnosticReport() { return compactReport(unifiedDiagnosticReport()); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createCompressedDiagnosticZip(jsonText, fileName = 'velscour-diagnostics.json') {
  if (typeof CompressionStream === 'undefined') throw new Error('ZIP compression is unavailable in this runtime. Export Compact or Full JSON instead.');
  const input = new TextEncoder().encode(jsonText);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const name = new TextEncoder().encode(fileName), crc = crc32(input), dosTime = 0, dosDate = ((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate();
  const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
  lv.setUint32(14, crc, true); lv.setUint32(18, compressed.length, true); lv.setUint32(22, input.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
  const central = new Uint8Array(46 + name.length); const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
  cv.setUint32(16, crc, true); cv.setUint32(20, compressed.length, true); cv.setUint32(24, input.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, 0, true); central.set(name, 46);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, central.length, true); ev.setUint32(16, local.length + compressed.length, true);
  return new Blob([local, compressed, central, end], { type: 'application/zip' });
}

export async function exportUnifiedDiagnosticReport({ format = 'compact' } = {}) {
  const full = unifiedDiagnosticReport();
  const report = format === 'compact' ? compactReport(full) : full;
  if (report.sessionId && !report.gitCommitId) {
    const commitId = await resolveDeployedGitCommitId();
    if (commitId) {
      report.gitCommitId = commitId;
      report.game.gitCommitId = commitId;
      if (report.sections?.performance?.build) report.sections.performance.build.gitCommitId = commitId;
      if (report.contextAtRecordingStart?.game) report.contextAtRecordingStart.game.gitCommitId = commitId;
      if (report.recording.metadata?.game) report.recording.metadata.game.gitCommitId = commitId;
      if (report.contextAtExport?.game) report.contextAtExport.game.gitCommitId = commitId;
      report.completeness.gitCommitIdAvailable = true;
    }
  }
  const jsonText = JSON.stringify(report, null, format === 'compact' ? 0 : 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const isZip = format === 'compressed';
  const blob = isZip ? await createCompressedDiagnosticZip(JSON.stringify(full, null, 2), `velscour-diagnostics-${stamp}.json`)
    : new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `velscour-diagnostics-${stamp}${isZip ? '.zip' : `-${format}.json`}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return report;
}

export function recordDeveloperDiagnosticEvent(type, details = {}, category = 'debug') {
  return recordDeveloperEvent(type, details, category);
}
