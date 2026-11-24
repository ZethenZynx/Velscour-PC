const SUPPRESSED_REASONS = new Set([
  'duplicate-suppressed', 'repeat-suppressed', 'unknown-sound', 'unavailable', 'muted',
  'source-ended', 'area-ended', 'persistent-disabled', 'distance-culled', 'offscreen-culled',
  'environment-density', 'channel-limit', 'sample-voice-limit',
]);

/** Summaries derived from request and Web Audio source lifecycle events. */
export function summarizeAudioDiagnosticEvents(events = []) {
  const byReason = {};
  let requested = 0, requestsFinished = 0, suppressed = 0, sourceScheduled = 0, sourceStarted = 0, sourceStopped = 0, unknownSounds = 0;
  for (const event of events) {
    if (event.type === 'play') requested++;
    if (event.type === 'stop') {
      requestsFinished++;
      const reason = event.reason || 'ended';
      byReason[reason] = (byReason[reason] || 0) + 1;
      if (SUPPRESSED_REASONS.has(reason)) suppressed++;
      if (reason === 'unknown-sound') unknownSounds++;
    }
    if (event.type === 'source-scheduled') sourceScheduled++;
    if (event.type === 'source-start') sourceStarted++;
    if (event.type === 'source-stop') sourceStopped++;
  }

  const sourceStarts = new Map(), transitions = [], tails = [];
  for (const event of events) {
    if (event.type === 'source-scheduled') sourceStarts.set(`${event.id}:${event.sourceId}`, event);
    if (event.type === 'combat-end' || event.type === 'area-exit') transitions.push(event);
    if (event.type !== 'source-stop' || event.endedBeforeStart) continue;
    const start = sourceStarts.get(`${event.id}:${event.sourceId}`);
    if (!start || start.worldId == null) continue;
    const endedAt = Date.parse(event.timeUtc);
    const transition = transitions.filter((entry) => entry.worldId === start.worldId && Date.parse(entry.timeUtc) >= Date.parse(start.timeUtc) && Date.parse(entry.timeUtc) <= endedAt).at(-1);
    if (transition) tails.push({ sound: start.sound, category: start.category, source: start.source, worldId: start.worldId,
      transition: transition.type, transitionReason: transition.reason || null, transitionUtc: transition.timeUtc,
      endedUtc: event.timeUtc, durationAfterTransitionMs: Math.max(0, endedAt - Date.parse(transition.timeUtc)) });
  }
  return {
    requests: { requested, finished: requestsFinished, suppressed, unknownSounds, finishedByReason: byReason },
    webAudioSources: { scheduled: sourceScheduled, started: sourceStarted, stopped: sourceStopped,
      activeAtReport: Math.max(0, sourceStarted - sourceStopped) },
    playbackAfterTransitions: tails.slice(-100),
  };
}
