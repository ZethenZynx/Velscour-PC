// Coordinates the existing performance and audio recorders as one manual session.
import { G, developerModeEnabled } from '../state.js';
import { GAME_BUILD_ID, GAME_VERSION } from '../data/build-version.js';
import { audioDiagnosticReport, clearAudioDiagnosticRecording, recordAudioDiagnosticMarker, startAudioDiagnosticRecording, stopAudioDiagnosticRecording } from './audio.js';
import { performanceReport, resetPerformanceStatistics, setPerformanceProfilerEnabled } from './perfdiagnostics.js';
import { beginDeveloperSession, clearDeveloperSession, developerRecordingActive, developerSessionReport, developerSessionStatus, endDeveloperSession, recordDeveloperEvent } from './developer-session.js';

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
      unavailableMeasurements: ['GPU frame time', 'GPU memory', 'JavaScript garbage collection events', 'browser-private memory allocations'],
      gitCommitIdAvailable: !!(session.metadata?.game?.gitCommitId || globalThis.__VELSCOUR_GIT_COMMIT__),
    },
  };
}

export function exportUnifiedDiagnosticReport() {
  const report = unifiedDiagnosticReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `velscour-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return report;
}

export function recordDeveloperDiagnosticEvent(type, details = {}, category = 'debug') {
  return recordDeveloperEvent(type, details, category);
}
