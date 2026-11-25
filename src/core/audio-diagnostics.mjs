const SUPPRESSED_REASONS = new Set([
  'duplicate-suppressed', 'repeat-suppressed', 'unknown-sound', 'unavailable', 'muted',
  'source-ended', 'area-ended', 'persistent-disabled', 'distance-culled', 'offscreen-culled',
  'environment-density', 'channel-limit', 'sample-voice-limit',
]);

export const AUDIO_DIAGNOSTIC_DETAIL_LIMIT = 5000;
export const AUDIO_DIAGNOSTIC_IMPORTANT_LIMIT = 2000;
export const AUDIO_DIAGNOSTIC_STACK_LIMIT = 128;

const importantEvent = (event) => ['error', 'warning', 'playback-error', 'source-leak', 'audio-leak',
  'combat-start', 'combat-end', 'area-enter', 'area-exit', 'recording-start', 'recording-stop'].includes(event?.type);

const requestSummary = (request) => ({ id: request.id, sound: request.sound, category: request.category,
  asset: request.asset, source: request.source, worldId: request.worldId ?? null, environment: request.environment ?? null,
  startedUtc: request.timeUtc });

/** Incremental, bounded-memory audio report accumulator. All counters cover the whole session. */
export function createAudioDiagnosticSession({ detailLimit = AUDIO_DIAGNOSTIC_DETAIL_LIMIT,
  importantLimit = AUDIO_DIAGNOSTIC_IMPORTANT_LIMIT } = {}) {
  const requestCounts = { total: 0, bySound: {}, byCategory: {}, finishedByReason: {}, suppressed: 0, unknownSounds: 0 };
  const sourceCounts = { scheduled: 0, started: 0, stopped: 0 };
  const activeRequests = new Map(), pendingSources = new Map(), activeSources = new Map();
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
      activeRequests.set(event.id, requestSummary(event));
    } else if (event.type === 'stop') {
      const reason = event.reason || 'ended';
      requestCounts.finishedByReason[reason] = (requestCounts.finishedByReason[reason] || 0) + 1;
      if (SUPPRESSED_REASONS.has(reason)) requestCounts.suppressed++;
      if (reason === 'unknown-sound') requestCounts.unknownSounds++;
      const start = activeRequests.get(event.id);
      if (start) {
        const durationMs = Math.max(0, Date.parse(event.timeUtc) - Date.parse(start.startedUtc));
        const lifetime = { sound: start.sound, category: start.category, asset: start.asset, source: start.source,
          startedUtc: start.startedUtc, stoppedUtc: event.timeUtc, durationMs, reason };
        longestSounds.push(lifetime); trimSmallest(longestSounds, 25, (item) => item.durationMs);
        if (durationMs > 5000) { potentiallyOrphaned.push(lifetime); trimSmallest(potentiallyOrphaned, 100, (item) => item.durationMs); }
        activeRequests.delete(event.id);
      }
    } else if (event.type === 'source-scheduled') {
      sourceCounts.scheduled++;
      pendingSources.set(sourceKey(event), compactSource(event));
    } else if (event.type === 'source-start') {
      sourceCounts.started++;
      const key = sourceKey(event), info = pendingSources.get(key) || compactSource(event);
      pendingSources.delete(key);
      activeSources.set(key, { ...info, startedUtc: event.timeUtc,
        startBasis: event.startObservation || (event.inferredFromEnd ? 'inferred-from-ended-source' : 'audio-clock-estimate') });
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
      pendingSources.delete(key); activeSources.delete(key);
    } else if (event.type === 'combat-end' || event.type === 'area-exit') {
      transitions.push(event);
      if (transitions.length > 1000) transitions.shift();
    } else if (event.type === 'processing-spike') {
      processingSpikeCount++;
      processingSpikes.push({ timeUtc: event.timeUtc, durationMs: Number(event.durationMs) || 0,
        sound: event.sound || null, category: event.category || null });
      trimSmallest(processingSpikes, 100, (item) => item.durationMs);
    }
  }

  function snapshotSources() {
    return { pending: [...pendingSources.values()].map((source) => ({ ...source })),
      active: [...activeSources.values()].map((source) => ({ ...source })) };
  }

  function recentImportantEvents() {
    if (importantEvents.length < importantLimit || importantCursor === 0) return importantEvents.slice();
    return [...importantEvents.slice(importantCursor), ...importantEvents.slice(0, importantCursor)];
  }

  function report() {
    const top = (map, key) => Object.entries(map).map(([name, count]) => ({ [key]: name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 25);
    const requests = { requested: requestCounts.total, finished: Object.values(requestCounts.finishedByReason).reduce((a, n) => a + n, 0),
      suppressed: requestCounts.suppressed, unknownSounds: requestCounts.unknownSounds,
      finishedByReason: { ...requestCounts.finishedByReason }, bySound: { ...requestCounts.bySound }, byCategory: { ...requestCounts.byCategory } };
    const sources = { scheduled: sourceCounts.scheduled, started: sourceCounts.started, stopped: sourceCounts.stopped,
      pendingAtReport: pendingSources.size, activeAtReport: activeSources.size };
    return { requests, webAudioSources: sources, eventTypeCounts: { ...eventTypeCounts }, importantEventCounts: { ...importantEventCounts },
      mostFrequentSounds: top(requestCounts.bySound, 'sound'), mostFrequentCategories: top(requestCounts.byCategory, 'category'),
      longestSounds: [...longestSounds].sort((a, b) => b.durationMs - a.durationMs),
      potentiallyOrphaned: [...potentiallyOrphaned].sort((a, b) => b.durationMs - a.durationMs),
      playbackAfterTransitions: [...playbackAfterTransitions], stillActiveRequests: [...activeRequests.values()].map((item) => ({ ...item })),
      processingSpikes: [...processingSpikes].sort((a, b) => b.durationMs - a.durationMs), processingSpikeCount,
      activeSourcesAtReport: snapshotSources(),
      retainedEvents: events.length, importantEvents: importantEvents.length, totalEvents, detailDropped, importantDropped };
  }

  return { record, report, snapshotSources, events, get importantEvents() { return recentImportantEvents(); }, get totalEvents() { return totalEvents; },
    get detailDropped() { return detailDropped; }, get importantDropped() { return importantDropped; },
    get detailLimit() { return detailLimit; }, get importantLimit() { return importantLimit; } };
}

/** Compatibility helper for bounded event samples and small non-browser tests. */
export function summarizeAudioDiagnosticEvents(events = []) {
  const session = createAudioDiagnosticSession({ detailLimit: Math.max(events.length, 1), importantLimit: Math.max(events.length, 1) });
  for (const event of events) session.record(event);
  return session.report();
}
