const SUPPRESSED_REASONS = new Set([
  'duplicate-suppressed', 'repeat-suppressed', 'unknown-sound', 'unavailable', 'muted',
  'source-ended', 'area-ended', 'persistent-disabled', 'distance-culled', 'offscreen-culled',
  'environment-density', 'channel-limit', 'sample-voice-limit',
]);

export const AUDIO_DIAGNOSTIC_DETAIL_LIMIT = 5000;
export const AUDIO_DIAGNOSTIC_IMPORTANT_LIMIT = 2000;
export const AUDIO_DIAGNOSTIC_STACK_LIMIT = 128;
export const AUDIO_DIAGNOSTIC_CALLSITE_SAMPLE_INTERVAL = 32;

const importantEvent = (event) => ['error', 'warning', 'playback-error', 'source-leak', 'audio-leak',
  'combat-start', 'combat-end', 'area-enter', 'area-exit', 'recording-start', 'recording-stop'].includes(event?.type);

const requestSummary = (request) => ({ id: request.id, sound: request.sound, category: request.category,
  asset: request.asset, source: request.source, worldId: request.worldId ?? null, environment: request.environment ?? null,
  startedUtc: request.timeUtc });

/** Incremental, bounded-memory audio report accumulator. All counters cover the whole session. */
export function createAudioDiagnosticSession({ detailLimit = AUDIO_DIAGNOSTIC_DETAIL_LIMIT,
  importantLimit = AUDIO_DIAGNOSTIC_IMPORTANT_LIMIT } = {}) {
  const requestCounts = { total: 0, bySound: {}, byCategory: {}, bySource: {}, byOrigin: {}, finishedByReason: {},
    suppressed: 0, unknownSounds: 0, outsideCombatBySound: {}, originSuppressedBySound: {}, originSuppressedBySource: {} };
  const sourceCounts = { scheduled: 0, started: 0, stopped: 0 };
  const activeRequests = new Map(), pendingSources = new Map(), activeSources = new Map();
  const activeCombatPlaybacks = new Set();
  const perSound = {};
  const callsiteSamples = {};
  const latency = { requestToSchedule: makeDistribution(), requestToEstimatedPlaybackStart: makeDistribution() };
  const frameAudio = makeDistribution();
  let peakCombatSounds = 0, peakWebAudioSources = 0, originSuppressed = 0;
  let firstPerfMs = null, lastPerfMs = null, firstTimeUtc = null, lastTimeUtc = null;
  const transitions = [];
  const playbackAfterTransitions = [];
  const longestSounds = [];
  const potentiallyOrphaned = [];
  const processingSpikes = [];
  let processingSpikeCount = 0;
  let totalEvents = 0, detailDropped = 0, importantDropped = 0;
  const eventTypeCounts = {}, importantEventCounts = {};
  const events = [], importantEvents = [];
  let importantCursor = 0;

  const sourceKey = (event) => `${event.id}:${event.sourceId}`;
  const soundStats = (sound) => perSound[sound] || (perSound[sound] = { requested: 0, scheduledPlaybackRequests: 0,
    startedPlaybackRequests: 0, suppressed: 0, duplicateSuppressed: 0, finished: 0 });
  const addLatency = (name, value) => {
    if (Number.isFinite(value) && value >= 0) addDistribution(latency[name], value);
  };
  const trimSmallest = (items, limit, value) => {
    if (items.length <= limit) return;
    let smallest = 0;
    for (let i = 1; i < items.length; i++) if (value(items[i]) < value(items[smallest])) smallest = i;
    items.splice(smallest, 1);
  };
  const compactSource = (event) => ({ id: event.id, sourceId: event.sourceId, sound: event.sound,
    category: event.category, source: event.source, worldId: event.worldId ?? null,
    environment: event.environment ?? null, scheduledUtc: event.timeUtc, audioTime: event.audioTime ?? null,
    scheduledInMs: event.scheduledInMs ?? 0, expectedStopAt: event.expectedStopAt ?? null });

  function record(event) {
    if (!event || typeof event.type !== 'string') return;
    totalEvents++;
    if (Number.isFinite(event.perfMs)) {
      firstPerfMs = firstPerfMs == null ? event.perfMs : Math.min(firstPerfMs, event.perfMs);
      lastPerfMs = lastPerfMs == null ? event.perfMs : Math.max(lastPerfMs, event.perfMs);
    }
    if (event.timeUtc) {
      firstTimeUtc ||= event.timeUtc;
      lastTimeUtc = event.timeUtc;
    }
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
    // Keep exported detail records small; representative stack traces live in a separate capped table.
    const { stack, ...smallEvent } = event;
    if (events.length < detailLimit) events.push(smallEvent); else detailDropped++;
    if (importantEvent(event)) {
      importantEventCounts[event.type] = (importantEventCounts[event.type] || 0) + 1;
      if (importantEvents.length < importantLimit) importantEvents.push(smallEvent);
      else { importantEvents[importantCursor] = smallEvent; importantCursor = (importantCursor + 1) % importantLimit; importantDropped++; }
    }

    if (event.type === 'play') {
      requestCounts.total++;
      requestCounts.bySound[event.sound] = (requestCounts.bySound[event.sound] || 0) + 1;
      const category = event.category || 'uncategorized';
      requestCounts.byCategory[category] = (requestCounts.byCategory[category] || 0) + 1;
      const source = event.source || 'unattributed', origin = event.origin || source;
      requestCounts.bySource[source] = (requestCounts.bySource[source] || 0) + 1;
      requestCounts.byOrigin[origin] = (requestCounts.byOrigin[origin] || 0) + 1;
      soundStats(event.sound).requested++;
      if (event.combatAudio === true && event.inCombat !== true) requestCounts.outsideCombatBySound[event.sound] = (requestCounts.outsideCombatBySound[event.sound] || 0) + 1;
      if (event.callsiteSample && event.stackId != null) {
        const key = `${event.sound}|${category}|${event.stackId}`;
        callsiteSamples[key] = (callsiteSamples[key] || 0) + 1;
      }
      activeRequests.set(event.id, { ...requestSummary(event), category, origin, stackId: event.stackId ?? null,
        requestPerfMs: event.perfMs, combatAudio: event.combatAudio === true, inCombat: event.inCombat === true,
        scheduled: false, audioStart: null, audioEnd: null });
    } else if (event.type === 'playback-registered') {
      const request = activeRequests.get(event.id);
      if (request) request.playbackId = event.playbackId ?? event.id;
    } else if (event.type === 'stop') {
      const reason = event.reason || 'ended';
      requestCounts.finishedByReason[reason] = (requestCounts.finishedByReason[reason] || 0) + 1;
      if (SUPPRESSED_REASONS.has(reason)) requestCounts.suppressed++;
      if (reason === 'unknown-sound') requestCounts.unknownSounds++;
      const start = activeRequests.get(event.id);
      if (start) {
        const wallDurationMs = Math.max(0, Date.parse(event.timeUtc) - Date.parse(start.startedUtc));
        const hasAudioClockDuration = start.audioStart != null && start.audioEnd != null;
        const audioDurationMs = hasAudioClockDuration ? Math.max(0, (start.audioEnd - start.audioStart) * 1000) : null;
        soundStats(start.sound).finished++;
        if (SUPPRESSED_REASONS.has(reason)) soundStats(start.sound).suppressed++;
        if (reason === 'duplicate-suppressed' || reason === 'repeat-suppressed') soundStats(start.sound).duplicateSuppressed++;
        if (start.playbackId != null) activeCombatPlaybacks.delete(start.playbackId);
        const lifetime = { sound: start.sound, category: start.category, asset: start.asset, source: start.source,
          origin: start.origin, stackId: start.stackId, startedUtc: start.startedUtc, stoppedUtc: event.timeUtc,
          durationMs: hasAudioClockDuration ? audioDurationMs : wallDurationMs,
          durationBasis: hasAudioClockDuration ? 'web-audio-clock' : 'diagnostic-wall-clock-fallback',
          diagnosticLifetimeMs: wallDurationMs, reason };
        if (start.scheduled) { longestSounds.push(lifetime); trimSmallest(longestSounds, 25, (item) => item.durationMs); }
        if (wallDurationMs > 5000 && start.scheduled) { potentiallyOrphaned.push(lifetime); trimSmallest(potentiallyOrphaned, 100, (item) => item.diagnosticLifetimeMs); }
        activeRequests.delete(event.id);
      }
    } else if (event.type === 'source-scheduled') {
      sourceCounts.scheduled++;
      const source = compactSource(event), request = activeRequests.get(event.id);
      pendingSources.set(sourceKey(event), source);
      if (request) {
        request.asset = event.asset || request.asset;
        request.assetPath = event.assetPath || request.assetPath;
        if (!request.scheduled) {
          request.scheduled = true;
          soundStats(request.sound).scheduledPlaybackRequests++;
          if (request.combatAudio && request.playbackId != null) {
            activeCombatPlaybacks.add(request.playbackId);
            peakCombatSounds = Math.max(peakCombatSounds, activeCombatPlaybacks.size);
          }
          const requestToScheduleMs = Number(event.perfMs) - Number(request.requestPerfMs);
          addLatency('requestToSchedule', requestToScheduleMs);
          addLatency('requestToEstimatedPlaybackStart', requestToScheduleMs + Math.max(0, Number(event.scheduledInMs) || 0));
        }
        const audioTime = Number(event.audioTime);
        if (Number.isFinite(audioTime)) request.audioStart = request.audioStart == null ? audioTime : Math.min(request.audioStart, audioTime);
      }
      peakWebAudioSources = Math.max(peakWebAudioSources, pendingSources.size + activeSources.size);
    } else if (event.type === 'source-start') {
      sourceCounts.started++;
      const key = sourceKey(event), info = pendingSources.get(key) || compactSource(event);
      pendingSources.delete(key);
      const request = activeRequests.get(event.id);
      const audioTime = Number(event.audioTime);
      if (request && Number.isFinite(audioTime)) {
        request.audioStart = request.audioStart == null ? audioTime : Math.min(request.audioStart, audioTime);
      }
      if (request && !request.startedPlayback) {
        request.startedPlayback = true;
        soundStats(request.sound).startedPlaybackRequests++;
      }
      activeSources.set(key, { ...info, startedUtc: event.timeUtc,
        startBasis: event.startObservation || (event.inferredFromEnd ? 'inferred-from-ended-source' : 'audio-clock-estimate') });
      peakWebAudioSources = Math.max(peakWebAudioSources, pendingSources.size + activeSources.size);
    } else if (event.type === 'source-stop') {
      sourceCounts.stopped++;
      const key = sourceKey(event), start = activeSources.get(key) || pendingSources.get(key);
      if (start && !event.endedBeforeStart && start.worldId != null) {
        const startMs = Date.parse(start.scheduledUtc), endedMs = Date.parse(event.timeUtc);
        const transition = [...transitions].reverse().find((entry) => entry.worldId === start.worldId &&
          Date.parse(entry.timeUtc) >= startMs && Date.parse(entry.timeUtc) <= endedMs);
        if (transition) {
          playbackAfterTransitions.push({ sound: start.sound, category: start.category, source: start.source,
            worldId: start.worldId, transition: transition.type, transitionReason: transition.reason || null,
            transitionUtc: transition.timeUtc, endedUtc: event.timeUtc,
            durationAfterTransitionMs: Math.max(0, endedMs - Date.parse(transition.timeUtc)) });
          if (playbackAfterTransitions.length > 100) playbackAfterTransitions.shift();
        }
      }
      const request = activeRequests.get(event.id), stoppedAudioTime = Number(event.audioTime);
      if (request && Number.isFinite(stoppedAudioTime)) request.audioEnd = request.audioEnd == null ? stoppedAudioTime : Math.max(request.audioEnd, stoppedAudioTime);
      pendingSources.delete(key); activeSources.delete(key);
    } else if (event.type === 'combat-end' || event.type === 'area-exit') {
      transitions.push(event);
      if (transitions.length > 1000) transitions.shift();
    } else if (event.type === 'processing-spike') {
      processingSpikeCount++;
      processingSpikes.push({ timeUtc: event.timeUtc, durationMs: Number(event.durationMs) || 0,
        sound: event.sound || null, category: event.category || null });
      trimSmallest(processingSpikes, 100, (item) => item.durationMs);
    } else if (event.type === 'origin-suppressed') {
      originSuppressed++;
      requestCounts.originSuppressedBySound[event.sound] = (requestCounts.originSuppressedBySound[event.sound] || 0) + 1;
      const source = event.source || 'unattributed';
      requestCounts.originSuppressedBySource[source] = (requestCounts.originSuppressedBySource[source] || 0) + 1;
    }
  }

  function suppressAtOrigin(event) {
    record({ ...event, type: 'origin-suppressed' });
  }

  function recordFrameAudio(durationMs) { addDistribution(frameAudio, Math.max(0, Number(durationMs) || 0)); }

  function snapshotSources() {
    return { pending: [...pendingSources.values()].map((source) => ({ ...source })),
      active: [...activeSources.values()].map((source) => ({ ...source })) };
  }

  function recentImportantEvents() {
    if (importantEvents.length < importantLimit || importantCursor === 0) return importantEvents.slice();
    return [...importantEvents.slice(importantCursor), ...importantEvents.slice(0, importantCursor)];
  }

  function report(durationMs = null) {
    const top = (map, key) => Object.entries(map).map(([name, count]) => ({ [key]: name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 25);
    const sessionDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Math.max(0, lastPerfMs - firstPerfMs || Date.parse(lastTimeUtc) - Date.parse(firstTimeUtc) || 0);
    const seconds = sessionDurationMs / 1000;
    const requests = { requested: requestCounts.total, finished: Object.values(requestCounts.finishedByReason).reduce((a, n) => a + n, 0),
      suppressed: requestCounts.suppressed, unknownSounds: requestCounts.unknownSounds, originSuppressed,
      finishedByReason: { ...requestCounts.finishedByReason }, bySound: { ...requestCounts.bySound }, byCategory: { ...requestCounts.byCategory } };
    const rateBySound = Object.fromEntries(Object.entries(perSound).map(([sound, stats]) => [sound, {
      ...stats, requestsPerSecond: Number((stats.requested / Math.max(0.001, seconds)).toFixed(3)),
      scheduledPlaybackRequestsPerSecond: Number((stats.scheduledPlaybackRequests / Math.max(0.001, seconds)).toFixed(3)),
      actualPlaybackRatePerSecond: Number((stats.startedPlaybackRequests / Math.max(0.001, seconds)).toFixed(3)),
      duplicateSuppressionRate: Number((stats.duplicateSuppressed / Math.max(1, stats.requested)).toFixed(4)),
    }]));
    const sources = { scheduled: sourceCounts.scheduled, started: sourceCounts.started, stopped: sourceCounts.stopped,
      pendingAtReport: pendingSources.size, activeAtReport: activeSources.size };
    return { durationMs: sessionDurationMs, requests, requestRates: { totalPerSecond: Number((requestCounts.total / Math.max(0.001, seconds)).toFixed(3)),
        bySound: Object.fromEntries(Object.entries(requestCounts.bySound).map(([sound, count]) => [sound, Number((count / Math.max(0.001, seconds)).toFixed(3))])) },
      perSound: rateBySound, requestOrigins: { bySource: { ...requestCounts.bySource }, byOrigin: { ...requestCounts.byOrigin },
        outsideCombatBySound: { ...requestCounts.outsideCombatBySound }, callsiteSamples: { ...callsiteSamples },
        callsiteSamplesAreSampled: true, callsiteSamplingInterval: AUDIO_DIAGNOSTIC_CALLSITE_SAMPLE_INTERVAL },
      originSuppression: { total: originSuppressed, bySound: { ...requestCounts.originSuppressedBySound }, bySource: { ...requestCounts.originSuppressedBySource } },
      peaks: { simultaneousCombatSounds: peakCombatSounds, simultaneousWebAudioSources: peakWebAudioSources },
      requestToPlaybackLatencyMs: { requestToSchedule: distributionReport(latency.requestToSchedule),
        requestToEstimatedPlaybackStart: distributionReport(latency.requestToEstimatedPlaybackStart) },
      audioProcessingPerFrameMs: distributionReport(frameAudio),
      webAudioSources: sources, eventTypeCounts: { ...eventTypeCounts }, importantEventCounts: { ...importantEventCounts },
      mostFrequentSounds: top(requestCounts.bySound, 'sound'), mostFrequentCategories: top(requestCounts.byCategory, 'category'),
      longestSounds: [...longestSounds].sort((a, b) => b.durationMs - a.durationMs),
      potentiallyOrphaned: [...potentiallyOrphaned].sort((a, b) => b.durationMs - a.durationMs),
      playbackAfterTransitions: [...playbackAfterTransitions], stillActiveRequests: [...activeRequests.values()].map((item) => ({ ...item })),
      processingSpikes: [...processingSpikes].sort((a, b) => b.durationMs - a.durationMs), processingSpikeCount,
      activeSourcesAtReport: snapshotSources(),
      retainedEvents: events.length, importantEvents: importantEvents.length, totalEvents, detailDropped, importantDropped };
  }

  return { record, report, snapshotSources, events, suppressAtOrigin, recordFrameAudio,
    get importantEvents() { return recentImportantEvents(); }, get totalEvents() { return totalEvents; },
    get detailDropped() { return detailDropped; }, get importantDropped() { return importantDropped; },
    get detailLimit() { return detailLimit; }, get importantLimit() { return importantLimit; } };
}

const FRAME_AUDIO_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, Infinity];
function makeDistribution() { return { count: 0, sum: 0, max: 0, histogram: Array(FRAME_AUDIO_BUCKETS.length).fill(0) }; }
function addDistribution(distribution, value) {
  if (!distribution || !Number.isFinite(value)) return;
  distribution.count++; distribution.sum += value; distribution.max = Math.max(distribution.max, value);
  const index = FRAME_AUDIO_BUCKETS.findIndex((edge) => value <= edge);
  distribution.histogram[index < 0 ? FRAME_AUDIO_BUCKETS.length - 1 : index]++;
}
function distributionReport(distribution) {
  const quantile = (q) => {
    if (!distribution.count) return 0;
    const target = Math.ceil(distribution.count * q); let cumulative = 0;
    for (let i = 0; i < distribution.histogram.length; i++) {
      cumulative += distribution.histogram[i];
      if (cumulative >= target) return Number.isFinite(FRAME_AUDIO_BUCKETS[i]) ? FRAME_AUDIO_BUCKETS[i] : '>10 ms';
    }
    return distribution.max;
  };
  return { samples: distribution.count, average: Number((distribution.sum / Math.max(1, distribution.count)).toFixed(4)),
    worst: Number(distribution.max.toFixed(4)), p95BucketUpperBound: quantile(0.95), p99BucketUpperBound: quantile(0.99) };
}

/** Compatibility helper for bounded event samples and small non-browser tests. */
export function summarizeAudioDiagnosticEvents(events = []) {
  const session = createAudioDiagnosticSession({ detailLimit: Math.max(events.length, 1), importantLimit: Math.max(events.length, 1) });
  for (const event of events) session.record(event);
  return session.report();
}
