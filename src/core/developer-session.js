// Shared, bounded recording context for every optional developer diagnostic.
// This module intentionally does no work until a manual recording is started.
import { G } from '../state.js';

const EVENT_LIMIT = 5000;
const IMPORTANT_LIMIT = 1500;
const METRIC_LIMIT = 256;
let session = null;
let eventObserver = null;

function uuid() {
  try { return crypto.randomUUID(); }
  catch { return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}

export function beginDeveloperSession(metadata = {}) {
  session = {
    id: uuid(), active: true, startedUtc: new Date().toISOString(), startedPerfMs: performance.now(),
    stoppedUtc: null, stoppedPerfMs: null, stopReason: null, metadata: { ...metadata },
    events: [], importantEvents: [], countsByCategory: Object.create(null), countsByType: Object.create(null),
    metrics: Object.create(null), metricCount: 0,
    totalEvents: 0, droppedEvents: 0, droppedImportantEvents: 0,
  };
  return session;
}

export function endDeveloperSession(reason = 'stopped') {
  if (!session?.active) return false;
  session.active = false;
  session.stoppedUtc = new Date().toISOString();
  session.stoppedPerfMs = performance.now();
  session.stopReason = String(reason);
  return true;
}

export function clearDeveloperSession() { session = null; }
export function developerRecordingActive() { return session?.active === true; }
export function setDeveloperEventObserver(observer) { eventObserver = typeof observer === 'function' ? observer : null; }
export function recordDeveloperMetric(name, value = 1, details = null) {
  if (!session?.active || !name || !Number.isFinite(Number(value))) return false;
  let key = String(name).slice(0, 120);
  if (!session.metrics[key] && session.metricCount >= METRIC_LIMIT) key = 'diagnostics.metricOverflow';
  const n = Number(value), metric = session.metrics[key] || (session.metricCount++, session.metrics[key] = { samples: 0, total: 0, minimum: Infinity, maximum: -Infinity, details: Object.create(null), detailCount: 0 });
  metric.samples++; metric.total += n; metric.minimum = Math.min(metric.minimum, n); metric.maximum = Math.max(metric.maximum, n);
  if (details && typeof details === 'object') for (const [field, amount] of Object.entries(details)) {
    const detailKey = String(field).slice(0, 64);
    if (Number.isFinite(Number(amount)) && (metric.details[detailKey] !== undefined || metric.detailCount < 32)) {
      if (metric.details[detailKey] === undefined) metric.detailCount++;
      metric.details[detailKey] = (metric.details[detailKey] || 0) + Number(amount);
    }
  }
  return true;
}
export function developerSessionStatus() {
  if (!session) return { active: false, hasRecording: false, elapsedMs: 0, sessionId: null, startedUtc: null, stoppedUtc: null };
  const end = session.active ? performance.now() : (session.stoppedPerfMs ?? session.startedPerfMs);
  return { active: session.active, hasRecording: true, elapsedMs: Math.max(0, end - session.startedPerfMs), startedPerfMs: session.startedPerfMs,
    sessionId: session.id, startedUtc: session.startedUtc, stoppedUtc: session.stoppedUtc, stopReason: session.stopReason };
}

export function recordDeveloperEvent(type, details = {}, category = 'game') {
  if (!session?.active || !type) return false;
  const now = performance.now(), name = String(type), group = String(category || 'game');
  const event = {
    id: ++session.totalEvents, sessionId: session.id, type: name, category: group,
    timeUtc: new Date().toISOString(), perfMs: Number(now.toFixed(3)), elapsedMs: Number((now - session.startedPerfMs).toFixed(3)),
    worldId: G.world?.id ?? null, environment: G.world?.biome?.name || G.world?.kind || null,
    depth: G.world?.depth ?? null, inCombat: typeof G.world?._audioCombatUntil === 'number' ? G.world._audioCombatUntil > Number(G.world.time || 0) : null,
    details: details && typeof details === 'object' ? { ...details } : { value: details },
  };
  session.countsByCategory[group] = (session.countsByCategory[group] || 0) + 1;
  session.countsByType[name] = (session.countsByType[name] || 0) + 1;
  const important = /error|exception|marker|transition|area-|combat-|guardian|recording-stop|movement-|collision-|position-invalid|position-recover|attack-interruption|input-focus-reset|input-mouse-(down|up)|simulation-spike|accumulation/i.test(name);
  if (session.events.length < EVENT_LIMIT) session.events.push(event);
  else session.droppedEvents++;
  if (important) {
    if (session.importantEvents.length < IMPORTANT_LIMIT) session.importantEvents.push(event);
    else session.droppedImportantEvents++;
  }
  if (eventObserver && /error|exception|marker|transition|area-|combat-|movement-|collision-|position-invalid|position-recover|attack-interruption|simulation-spike|accumulation/i.test(name)) {
    try { eventObserver(event); } catch { /* diagnostics must never affect gameplay */ }
  }
  return true;
}

export function developerSessionReport() {
  if (!session) return { error: 'No diagnostic recording has been started.' };
  const now = session.active ? performance.now() : (session.stoppedPerfMs ?? session.startedPerfMs);
  const events = [...session.events, ...session.importantEvents];
  const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.perfMs - b.perfMs);
  return {
    sessionId: session.id, active: session.active, startedUtc: session.startedUtc, stoppedUtc: session.stoppedUtc,
    startedPerfMs: Number(session.startedPerfMs.toFixed(3)), stoppedPerfMs: session.stoppedPerfMs == null ? null : Number(session.stoppedPerfMs.toFixed(3)),
    durationMs: Number(Math.max(0, now - session.startedPerfMs).toFixed(2)), stopReason: session.stopReason,
    metadata: { ...session.metadata },
    statisticsScope: { summary: 'complete-session', timeline: 'bounded-retained-events', totalEvents: session.totalEvents,
      detailedEventsStored: session.events.length, detailedEventLimit: EVENT_LIMIT, detailedEventsDropped: session.droppedEvents,
      importantEventsStored: session.importantEvents.length, importantEventLimit: IMPORTANT_LIMIT,
      importantEventsDropped: session.droppedImportantEvents, timelineTruncated: session.droppedEvents > 0 || session.droppedImportantEvents > 0 },
    eventCounts: { byCategory: { ...session.countsByCategory }, byType: { ...session.countsByType } }, timeline: unique,
    metrics: Object.fromEntries(Object.entries(session.metrics).map(([key, metric]) => [key, {
      samples: metric.samples, total: Number(metric.total.toFixed(3)), mean: Number((metric.total / metric.samples).toFixed(3)),
      minimum: Number(metric.minimum.toFixed(3)), maximum: Number(metric.maximum.toFixed(3)), accumulatedDetails: { ...metric.details },
    }])),
  };
}
