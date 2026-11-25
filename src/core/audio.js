// Sound: the user's samples (assets/audio/, imported by `process_assets.py audio`), with procedural Web Audio
// fallbacks for sounds that have no sample (or until the samples finish loading), plus the music + ambience directors.
//   sfx(name)           one-shot: a random sample from SAMPLES[name] if loaded, else the procedural SOUNDS[name]
//   playMusic(kind)     'title' | 'town' | 'wilds' (dungeons + overworld biomes): songs with quiet breaks between them
//   setAmbience(key)    a biome id or 'town': a looped ambient bed that drifts louder and softer (the title has none)
// Songs and beds stream through <audio> elements routed into the Web Audio graph, so they're never fully decoded.
import { G } from '../state.js';
import { AUDIO_VOLUME_GROUPS, audioGroupForSound, isCombatAudioCategory, normalizeAudioSettings } from './audio-settings.js';
import { AUDIO_DIAGNOSTIC_CALLSITE_SAMPLE_INTERVAL, AUDIO_DIAGNOSTIC_STACK_LIMIT, createAudioDiagnosticSession, summarizeAudioDiagnosticEvents } from './audio-diagnostics.mjs';

let ac = null, master, sfxBus, musicBus, ambBus, noiseBuf, pulseWave, activeOutputBus = null;
const categoryBuses = {};
let currentSoundName = null;
let currentPlaybackRecord = null;
let audioRecording = null;
let nextPlaybackId = 0;
const liveSoundInstances = [];
const audioMetrics = { discarded: 0, duplicateSuppressed: 0, distanceCulled: 0, offscreenCulled: 0, cancelledAfterCombat: 0, sampleVoiceSuppressed: 0, playbackErrors: 0 };
const peakByCategory = {};
const metricsByCategory = {};
let audioProcessingMs = 0, audioProcessingSamples = 0, audioProcessingWorstMs = 0;
let audioFrameProcessingMs = 0;
let audioFocusGain = 1;
const ironExpressWhistleSources = new Set();
let fanfareEnd = 0;
let notificationDuckUntil = 0;
let audioDiagnosticSink = null, currentDiagnostic = null, nextDiagnosticId = 0;
const activeDiagnostics = new Map();
let diagnosticStackIds = new Map();
let diagnosticStackSamples = new Map();
let lastDiagnosticStackIds = new Map();
const last = {};
const AUDIO = 'assets/audio/';
let manifest = null;               // assets/audio/audio.json
const buffers = {};                // sample slug -> AudioBuffer
const voices = {};                 // sound name -> live sample voices (capped)

export function initAudio() {
  if (ac) { if (ac.state !== 'running') ac.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  // iOS: play like a media app, not through the ringer (the silent switch would otherwise mute everything)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
  ac = new AC();
  if (ac.state !== 'running') ac.resume().catch(() => {});
  // a Home Screen app comes back from the background with its context suspended/'interrupted': resume on the next touch
  const wake = () => { if (ac.state !== 'running') ac.resume().catch(() => {}); };
  for (const k of ['touchend', 'pointerup', 'keydown', 'click']) window.addEventListener(k, wake, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 6;
  comp.connect(master);
  sfxBus = ac.createGain(); sfxBus.connect(comp);
  for (const { id } of AUDIO_VOLUME_GROUPS) {
    if (id === 'master' || id === 'music' || id === 'ambient') continue;
    categoryBuses[id] = ac.createGain(); categoryBuses[id].connect(comp);
  }
  musicBus = ac.createGain(); musicBus.connect(master);
  ambBus = ac.createGain(); ambBus.connect(master);
  applyVolumes();
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 25% pulse, the classic arcade lead
  const n = 32, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
  pulseWave = ac.createPeriodicWave(re, im);
  decks.music = [new Deck(musicBus), new Deck(musicBus)];
  decks.amb = [new Deck(ambBus), new Deck(ambBus)];
  for (const k in decks) for (const dk of decks[k]) dk.unlock();   // iOS: media elements must first play inside a gesture
  loadSamples();
  setInterval(tick, 250);
  const updateAudioFocus = () => {
    const unfocused = document.visibilityState !== 'visible' || !document.hasFocus();
    audioFocusGain = unfocused && (G.settings.audio?.muteWhenUnfocused || !G.settings.audio?.backgroundAudio) ? 0 : 1;
    if (master) applyVolumes();
  };
  window.addEventListener('focus', updateAudioFocus);
  window.addEventListener('blur', updateAudioFocus);
  document.addEventListener('visibilitychange', updateAudioFocus);
  updateAudioFocus();
  if (pending.music) { const m = pending.music; pending.music = null; playMusic(m.kind, m.opts); }
  if (pending.amb) { const a = pending.amb; pending.amb = null; setAmbience(a); }
}

export const audioReady = () => !!ac && ac.state === 'running';
/** Audio-only encounter state: recent real damage or a nearby engaged hostile, never dungeon membership alone. */
export function audioCombatStatus(world = G.world) {
  if (!world) return { active: false, reason: 'no-world' };
  if (Number(world._audioCombatUntil) > Number(world.time || 0)) return { active: true, reason: world._audioCombatReason || 'recent-hostile-damage' };
  const player = world.player;
  if (!player || player.dead || !Array.isArray(world.creatures)) return { active: false, reason: 'no-living-player' };
  const rangeSq = 12 * 12;
  const engaged = world.creatures.some((creature) => {
    if (!creature || creature.team !== 'enemy' || creature.dead) return false;
    if (creature.aggro !== player && creature.target !== player && creature.state !== 'act') return false;
    const dx = (creature.x || 0) - (player.x || 0), dy = (creature.y || 0) - (player.y || 0);
    return dx * dx + dy * dy <= rangeSq;
  });
  return { active: engaged, reason: engaged ? 'nearby-engaged-hostile' : 'no-nearby-engagement' };
}

export function isAudioCombatActive(world = G.world) { return audioCombatStatus(world).active; }

/** Called only for successful hostile damage; the short tail covers active DOTs and brief attack gaps. */
export function markAudioCombatActivity(world = G.world, seconds = 4, reason = 'recent-hostile-damage') {
  if (!world) return;
  const until = (Number(world.time) || 0) + seconds;
  if (until >= (Number(world._audioCombatUntil) || 0)) world._audioCombatReason = reason;
  world._audioCombatUntil = Math.max(Number(world._audioCombatUntil) || 0, until);
}
/** The shared context and the sfx bus, for the instrument sampler (src/core/sampler.js). */
export const audioCtx = () => ac;
export const audioOut = (category = 'playerSpell') => categoryBuses[category] || sfxBus;
/** For tests: what's loaded and playing. */
export const audioStats = () => ({ samples: Object.keys(buffers).length, music: music && music.kind, song: music && music.song, amb: amb && amb.bed });
/** Approximate live logical sounds across samples, procedural cues, instruments, and dialogue. */
export function audioActiveCount() {
  const now = ac?.currentTime || 0;
  let count = 0;
  for (let i = liveSoundInstances.length - 1; i >= 0; i--) {
    if (liveSoundInstances[i].endsAt <= now) liveSoundInstances.splice(i, 1);
    else count++;
  }
  return count;
}

export function audioActiveByCategory() {
  const now = ac?.currentTime || 0, counts = {};
  for (let i = liveSoundInstances.length - 1; i >= 0; i--) {
    const item = liveSoundInstances[i];
    if (item.endsAt <= now) { liveSoundInstances.splice(i, 1); continue; }
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

/** Register a non-sfx Web Audio voice (for example the Bard sampler) with the same limits and diagnostics. */
export function beginAudioVoice(sound, category, source, durationSeconds = 1, { combat = false } = {}) {
  const diagnosticCombat = combat || isCombatAudioCategory(category);
  const diagnostic = beginDiagnostic(sound, { category, source, combat: diagnosticCombat, inCombat: isAudioCombatActive() });
  const audio = G.settings.audio = normalizeAudioSettings(G.settings.audio);
  if (audio.muted.master || audio.volumes.master <= 0 || audio.muted[category] || audio.volumes[category] <= 0) { finishRequestedDiagnostic(diagnostic, 'muted'); return null; }
  const now = ac?.currentTime || 0;
  for (let i = liveSoundInstances.length - 1; i >= 0; i--) if (liveSoundInstances[i].endsAt <= now) liveSoundInstances.splice(i, 1);
  if (liveSoundInstances.filter((item) => item.sound === sound).length >= audio.maxIdenticalSounds) { recordAudioMetric('duplicateSuppressed', category); finishRequestedDiagnostic(diagnostic, 'duplicate-suppressed'); return null; }
  if (combat && liveSoundInstances.filter((item) => item.combat).length >= audio.maxCombatSounds) { recordAudioMetric('discarded', category); finishRequestedDiagnostic(diagnostic, 'channel-limit'); return null; }
  const playback = { id: ++nextPlaybackId, sound, category, combat, endsAt: now + Math.max(0.05, durationSeconds), route: null };
  liveSoundInstances.push(playback);
  if (diagnostic) { diagnostic.playbackId = playback.id; diagnostic.asset = `sampler:${sound}`; diagnostic.combatAudio = diagnosticCombat;
    diagnosticEvent('playback-registered', diagnostic, { category, playbackId: playback.id, asset: diagnostic.asset, combatAudio: diagnosticCombat }); }
  if (audioRecording?.active) peakByCategory[category] = Math.max(peakByCategory[category] || 0, liveSoundInstances.filter((item) => item.category === category).length);
  return { playback, diagnostic };
}

export function finishAudioVoice(token, reason = 'ended') {
  if (!token) return;
  token.playback.endsAt = ac?.currentTime || 0;
  if (token.diagnostic) { token.diagnostic.sealed = true; if (!token.diagnostic.sources) finishDiagnostic(token.diagnostic, reason); }
}

/** Add a real Web Audio source to a registered voice's diagnostics after scheduling it. */
export function registerAudioVoiceSource(token, source, startAt, stopAt) {
  trackDiagnosticSource(source, startAt, stopAt, token?.diagnostic);
}

/** Optional, disabled-by-default one-shot tracing for audio investigations. */
export function setAudioDiagnosticSink(sink) {
  audioDiagnosticSink = typeof sink === 'function' ? sink : null;
  if (!audioDiagnosticSink) activeDiagnostics.clear();
  return () => { if (audioDiagnosticSink === sink) setAudioDiagnosticSink(null); };
}

export function startAudioDiagnosticRecording() {
  if (audioRecording?.active) return false;
  audioRecording = { active: true, startedUtc: new Date().toISOString(), startedPerfMs: performance.now(),
    session: createAudioDiagnosticSession(), stackTraces: {}, nextStackId: 0 };
  diagnosticStackIds = new Map(); diagnosticStackSamples = new Map(); lastDiagnosticStackIds = new Map();
  for (const key of Object.keys(audioMetrics)) audioMetrics[key] = 0;
  for (const key of Object.keys(peakByCategory)) delete peakByCategory[key];
  for (const key of Object.keys(metricsByCategory)) delete metricsByCategory[key];
  audioProcessingMs = audioProcessingSamples = audioProcessingWorstMs = audioFrameProcessingMs = 0;
  setAudioDiagnosticSink(captureAudioDiagnosticEvent);
  recordAudioDiagnosticMarker('recording-start');
  return true;
}

export function stopAudioDiagnosticRecording() {
  if (!audioRecording?.active) return false;
  recordAudioDiagnosticMarker('recording-stop');
  audioRecording.activeInstancesAtStop = audioActiveByCategory();
  audioRecording.activeAtStop = [...activeDiagnostics.values()].map(({ id, sound, asset, assetPath, category, source, sources }) => ({ id, sound, asset, assetPath, category, source, activeSources: sources }));
  audioRecording.sourceSnapshotAtStop = audioRecording.session.snapshotSources();
  audioRecording.active = false;
  audioRecording.stoppedUtc = new Date().toISOString();
  audioRecording.durationMs = Number((performance.now() - audioRecording.startedPerfMs).toFixed(2));
  setAudioDiagnosticSink(null);
  return true;
}

export function clearAudioDiagnosticRecording() {
  const wasActive = !!audioRecording?.active;
  setAudioDiagnosticSink(null);
  audioRecording = null;
  if (wasActive) startAudioDiagnosticRecording();
}

export function recordAudioDiagnosticMarker(type, detail = {}) {
  if (!audioRecording?.active) return false;
  const world = G.world;
  captureAudioDiagnosticEvent({ type, timeUtc: new Date().toISOString(), perfMs: performance.now(),
    worldId: detail.worldId ?? world?.id ?? null, environment: detail.environment ?? world?.biome?.name ?? world?.kind ?? null,
    inCombat: detail.inCombat ?? isAudioCombatActive(world), ...detail });
  return true;
}

/** Samples audio work once per rendered frame while recording; a no-op during normal gameplay. */
export function recordAudioDiagnosticFrame() {
  if (!audioRecording?.active) return;
  audioRecording.session.recordFrameAudio(audioFrameProcessingMs);
  audioFrameProcessingMs = 0;
}

/** Record a deliberately coalesced combat cue without creating an audio request or Web Audio source. */
export function recordAudioDiagnosticOriginSuppression(sound, category, source, origin) {
  if (!audioRecording?.active) return;
  audioRecording.session.suppressAtOrigin({ sound, category, source: source || 'unattributed', origin,
    timeUtc: new Date().toISOString(), perfMs: performance.now() });
}

function captureAudioDiagnosticEvent(event) {
  if (!audioRecording?.active || !event) return;
  const { stack, ...rest } = event;
  const stackId = stack ? storeDiagnosticStack(`event:${event.type}:${event.name || ''}:${event.message || ''}`, stack) : event.stackId;
  audioRecording.session.record(stackId == null ? rest : { ...rest, stackId });
}

function storeDiagnosticStack(key, stack) {
  if (!audioRecording?.active) return null;
  if (diagnosticStackIds.has(key)) return diagnosticStackIds.get(key);
  if (audioRecording.nextStackId >= AUDIO_DIAGNOSTIC_STACK_LIMIT) return null;
  const stackId = ++audioRecording.nextStackId;
  diagnosticStackIds.set(key, stackId);
  audioRecording.stackTraces[stackId] = stack || '';
  return stackId;
}

function diagnosticStackId(sound, category) {
  const key = `${category || 'uncategorized'}:${sound}`;
  if (!audioRecording?.active) return { id: null, sampled: false };
  const sampleCount = (diagnosticStackSamples.get(key) || 0) + 1;
  diagnosticStackSamples.set(key, sampleCount);
  const sampled = sampleCount === 1 || sampleCount % AUDIO_DIAGNOSTIC_CALLSITE_SAMPLE_INTERVAL === 1;
  if (sampled) {
    const stack = new Error().stack || '';
    const frames = stack.split('\n').slice(4, 10).join('\n');
    const id = storeDiagnosticStack(`callsite:${frames}`, stack);
    if (id != null) lastDiagnosticStackIds.set(key, id);
    else return { id: null, sampled: false };
  }
  return { id: lastDiagnosticStackIds.get(key) ?? null, sampled };
}

export function audioDiagnosticReport() {
  if (!audioRecording) return { error: 'No audio diagnostic recording has been started.' };
  const durationMs = audioRecording.durationMs ?? Number((performance.now() - audioRecording.startedPerfMs).toFixed(2));
  const session = audioRecording.session.report(durationMs), events = audioRecording.session.events.slice();
  const retainedEventSummary = summarizeAudioDiagnosticEvents(events);
  const eventCount = audioRecording.session.totalEvents;
  const detailLimit = audioRecording.session.detailLimit;
  const importantLimit = audioRecording.session.importantLimit;
  const sourcesAtStop = audioRecording.sourceSnapshotAtStop || audioRecording.session.snapshotSources();
  const settings = normalizeAudioSettings(G.settings.audio);
  return {
    title: 'Velscour Audio Diagnostics', startedUtc: audioRecording.startedUtc, stoppedUtc: audioRecording.stoppedUtc || null,
    durationMs,
    statisticsScope: { sessionStatistics: 'complete-session', eventStatistics: 'retained-detailed-events-only',
      totalEventsObserved: eventCount, detailedEventsStored: events.length, detailedEventLimit: detailLimit,
      detailedEventsDropped: audioRecording.session.detailDropped, importantEventsStored: audioRecording.session.importantEvents.length,
      importantEventLimit: importantLimit, importantEventsDropped: audioRecording.session.importantDropped,
      detailedEventsTruncated: audioRecording.session.detailDropped > 0 },
    character: G.char?.name || null, environment: G.world?.biome?.name || G.world?.kind || null,
    audioSettings: { ...settings, volumes: { ...settings.volumes }, muted: { ...settings.muted } },
    activeInstancesByCategory: audioRecording.activeInstancesAtStop || audioActiveByCategory(), peakInstancesByCategory: { ...peakByCategory },
    metrics: { ...audioMetrics, byCategory: structuredCloneSafe(metricsByCategory), audioProcessingAverageMs: audioProcessingSamples ? Number((audioProcessingMs / audioProcessingSamples).toFixed(3)) : 0, audioProcessingWorstMs: Number(audioProcessingWorstMs.toFixed(3)), audioProcessingSamples, combatSoundsQueued: 0 },
    summary: { mostFrequentSounds: session.mostFrequentSounds, mostFrequentCategories: session.mostFrequentCategories,
      requestRates: session.requestRates, perSoundAudio: session.perSound,
      requestOrigins: session.requestOrigins, originSuppression: session.originSuppression,
      peakSimultaneousCombatSounds: session.peaks.simultaneousCombatSounds,
      peakSimultaneousWebAudioSources: session.peaks.simultaneousWebAudioSources,
      requestToPlaybackLatencyMs: session.requestToPlaybackLatencyMs,
      audioProcessingPerFrameMs: session.audioProcessingPerFrameMs,
      longestSounds: session.longestSounds, potentiallyOrphaned: session.potentiallyOrphaned,
      stillActiveWhenRecordingStopped: audioRecording.activeAtStop || [],
      pendingSourcesWhenRecordingStopped: sourcesAtStop.pending,
      activeSourcesWhenRecordingStopped: sourcesAtStop.active,
      audioProcessingSpikes: session.processingSpikes,
      audioProcessingSpikeCount: session.processingSpikeCount,
      totalRequests: session.requests.requested, fullSessionRequests: session.requests.requested,
      lifecycle: { ...session, retainedEventLifecycle: retainedEventSummary } },
    eventLimit: detailLimit, importantEventLimit: importantLimit,
    truncated: audioRecording.session.detailDropped > 0,
    events, importantEvents: audioRecording.session.importantEvents.slice(), stackTraces: { ...audioRecording.stackTraces },
  };
}

function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }

function recordAudioMetric(metric, category) {
  audioMetrics[metric] = (audioMetrics[metric] || 0) + 1;
  const counters = metricsByCategory[category] || (metricsByCategory[category] = {});
  counters[metric] = (counters[metric] || 0) + 1;
}

export function exportAudioDiagnosticReport() {
  const report = audioDiagnosticReport(), blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `velscour-audio-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return report;
}
export const audioDiagnosticsEnabled = () => !!audioDiagnosticSink;
export function audioDiagnosticStats() {
  return { enabled: !!audioDiagnosticSink, active: activeDiagnostics.size,
    activeByCategory: audioActiveByCategory(), peakByCategory: { ...peakByCategory },
    sounds: [...activeDiagnostics.values()].map(({ id, sound, asset, source, sources, category }) => ({ id, sound, asset, source, category, activeSources: sources })) };
}
function diagnosticEvent(type, record, details = {}) {
  if (!audioDiagnosticSink || !record) return;
  try { audioDiagnosticSink({ type, timeUtc: new Date().toISOString(), perfMs: performance.now(), id: record.id, sound: record.sound, asset: record.asset,
    assetPath: record.assetPath || null, category: record.category || null, playbackId: record.playbackId || null,
    source: record.source, origin: record.origin || null, stackId: record.stackId ?? null, callsiteSample: record.callsiteSample === true,
    worldId: record.worldId ?? null, environment: record.environment ?? null,
    inCombat: record.inCombat ?? null, combatAudio: record.combatAudio ?? null, activeInstances: activeDiagnostics.size,
    activeSources: record.sources, ...details }); } catch { /* diagnostics must never affect sound playback */ }
}
function diagnosticSourceActive(record) {
  if (typeof record?.sourceActive !== 'function') return record?.sourceActive ?? null;
  try { return !!record.sourceActive(); } catch { return null; }
}
function beginDiagnostic(sound, context) {
  if (!audioDiagnosticSink) return null;
  const stack = diagnosticStackId(sound, context?.category);
  const record = { id: ++nextDiagnosticId, sound, asset: `procedural:${sound}`, source: context?.source || 'unattributed',
    origin: context?.origin || null,
    assetPath: null, category: context?.category || null, sourceActive: context?.sourceActive,
    worldId: context?.worldId ?? G.world?.id ?? null, environment: context?.environment ?? G.world?.biome?.name ?? G.world?.kind ?? null,
    inCombat: context?.inCombat ?? isAudioCombatActive(), combatAudio: context?.combat ?? isCombatAudioCategory(context?.category),
    stackId: stack.id, callsiteSample: stack.sampled, sources: 0, sourceSerial: 0, sealed: false };
  activeDiagnostics.set(record.id, record);
  diagnosticEvent('play', record, { sourceActive: diagnosticSourceActive(record) });
  return record;
}
function finishDiagnostic(record, reason = 'ended') {
  if (!audioDiagnosticSink || !record || !activeDiagnostics.has(record.id)) return;
  activeDiagnostics.delete(record.id);
  diagnosticEvent('stop', record, { reason, sourceActive: diagnosticSourceActive(record) });
}
function trackDiagnosticSource(source, startAt = ac?.currentTime || 0, stopAt = null, record = currentDiagnostic) {
  if (!audioDiagnosticSink || !record || !source) return;
  record.sources++;
  const sourceId = ++record.sourceSerial;
  const scheduledAt = Number.isFinite(startAt) ? startAt : ac?.currentTime || 0;
  diagnosticEvent('source-scheduled', record, { sourceId, audioTime: scheduledAt,
    scheduledInMs: Math.max(0, (scheduledAt - (ac?.currentTime || 0)) * 1000), expectedStopAt: Number.isFinite(stopAt) ? stopAt : null });
  let started = false;
  let startTimer = setTimeout(() => {
    if (ac?.state === 'running' && (ac.currentTime + 0.015 >= scheduledAt) && activeDiagnostics.has(record.id)) {
      started = true;
      diagnosticEvent('source-start', record, { sourceId, audioTime: scheduledAt, inferredFromEnd: false, startObservation: 'audio-clock-estimate' });
    }
  }, Math.max(0, (scheduledAt - (ac?.currentTime || 0)) * 1000) + 20);
  const previous = source.onended;
  source.onended = (event) => {
    try { previous?.call(source, event); } finally {
      clearTimeout(startTimer);
      if (!started && (ac?.currentTime || 0) >= scheduledAt) {
        started = true;
        diagnosticEvent('source-start', record, { sourceId, audioTime: scheduledAt, inferredFromEnd: true, startObservation: 'inferred-from-ended-source' });
      }
      record.sources = Math.max(0, record.sources - 1);
      diagnosticEvent('source-stop', record, { sourceId, audioTime: ac?.currentTime ?? null, endedBeforeStart: !started });
      if (record.sealed && record.sources === 0) finishDiagnostic(record);
    }
  };
}

export function applyVolumes() {
  if (!ac) return;
  const audio = G.settings.audio = normalizeAudioSettings(G.settings.audio);
  const unfocused = document.visibilityState !== 'visible' || !document.hasFocus();
  audioFocusGain = unfocused && (audio.muteWhenUnfocused || !audio.backgroundAudio) ? 0 : 1;
  const volume = (id) => Math.max(0, Math.min(1, audio.volumes[id] / 100)) * (audio.muted[id] ? 0 : 1);
  master.gain.value = 0.9 * volume('master') * audioFocusGain;
  sfxBus.gain.value = 1;
  musicBus.gain.value = volume('music');
  ambBus.gain.value = volume('ambient');
  for (const [id, bus] of Object.entries(categoryBuses)) bus.gain.value = volume(id);
}

function env(g, t, a, peak, dec, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(sus, t + a + dec);
}

function noise(t, dur, { type = 'lowpass', f0 = 1000, f1 = f0, q = 1, vol = 0.5, a = 0.005 } = {}) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filt = ac.createBiquadFilter(); filt.type = type; filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t); filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain(); env(g, t, a, vol, dur);
  src.connect(filt); filt.connect(g); g.connect(activeOutputBus || sfxBus); trackPlaybackEnd(t + dur + 0.05);
  trackIronExpressWhistleSource(src); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05); trackDiagnosticSource(src, t, t + dur + 0.05);
}

function tone(t, dur, { wave = 'sine', f0 = 440, f1 = f0, vol = 0.3, a = 0.005, detune = 0 } = {}) {
  const o = ac.createOscillator(); o.detune.value = detune;
  if (wave === 'pulse') o.setPeriodicWave(pulseWave); else o.type = wave;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain(); env(g, t, a, vol, dur);
  o.connect(g); g.connect(activeOutputBus || sfxBus); trackPlaybackEnd(t + dur + 0.05);
  trackIronExpressWhistleSource(o); o.start(t); o.stop(t + dur + 0.05); trackDiagnosticSource(o, t, t + dur + 0.05);
}

function trackIronExpressWhistleSource(source) {
  if (currentSoundName !== 'iron_express_whistle') return;
  ironExpressWhistleSources.add(source);
  const previous = source.onended;
  source.onended = (event) => {
    ironExpressWhistleSources.delete(source);
    previous?.call(source, event);
  };
}

const R = (a, b) => a + Math.random() * (b - a);

const SOUNDS = {
  swing: (t, p) => noise(t, 0.14, { type: 'bandpass', f0: 3000 * p, f1: 600, q: 2, vol: 0.25 }),
  hit: (t, p) => { noise(t, 0.09, { f0: 1800 * p, f1: 300, vol: 0.35 }); tone(t, 0.1, { f0: 160 * p, f1: 60, vol: 0.3 }); },
  crit: (t, p) => { SOUNDS.hit(t, p); tone(t, 0.08, { wave: 'square', f0: 1400, f1: 700, vol: 0.08 }); },
  squish: (t, p) => { noise(t, 0.22, { f0: 900 * p, f1: 120, q: 4, vol: 0.4 }); tone(t, 0.18, { f0: 90, f1: 40, vol: 0.2, wave: 'triangle' }); },
  gore: (t, p) => { noise(t, 0.4, { f0: 1400 * p, f1: 80, q: 3, vol: 0.5 }); noise(t + 0.05, 0.3, { type: 'bandpass', f0: 400, f1: 150, q: 6, vol: 0.35 }); tone(t, 0.3, { f0: 70, f1: 30, vol: 0.35, wave: 'triangle' }); },
  bones: (t, p) => { for (let i = 0; i < 4; i++) tone(t + i * 0.035, 0.05, { wave: 'square', f0: R(700, 1300) * p, f1: 300, vol: 0.06 }); },
  fire: (t, p) => noise(t, 0.35, { f0: 2400 * p, f1: 300, vol: 0.35, a: 0.03 }),
  cold: (t, p) => { tone(t, 0.25, { f0: 2200 * p, f1: 3400, vol: 0.07 }); noise(t, 0.2, { type: 'highpass', f0: 5000, f1: 2500, vol: 0.18 }); },
  light: (t, p) => { const o = ac.createOscillator(); o.type = 'sawtooth'; const g = ac.createGain(); env(g, t, 0.003, 0.12, 0.2); for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(R(150, 1800) * p, t + i * 0.02); o.connect(g); g.connect(activeOutputBus || sfxBus); trackPlaybackEnd(t + 0.3); o.start(t); o.stop(t + 0.25); trackDiagnosticSource(o, t, t + 0.25); noise(t, 0.15, { type: 'highpass', f0: 3000, vol: 0.2 }); },
  holy_bolt: (t, p) => {
    noise(t, 0.2, { type: 'bandpass', f0: 4200, f1: 700, q: 1.2, vol: 0.22, a: 0.002 });
    for (let i = 0; i < 3; i++) noise(t + 0.025 + i * 0.035, 0.045, { type: 'highpass', f0: R(2800, 5200), f1: 900, vol: 0.12, a: 0.001 });
    tone(t, 0.2, { f0: 155 * p, f1: 48, vol: 0.16, wave: 'triangle', a: 0.002 });
  },
  consecration: (t, p) => {
    noise(t, 0.65, { type: 'lowpass', f0: 180, f1: 1500, q: 0.7, vol: 0.13, a: 0.16 });
    tone(t + 0.04, 0.75, { f0: 220 * p, f1: 330 * p, vol: 0.08, a: 0.18 });
    tone(t + 0.11, 0.62, { f0: 330 * p, f1: 440 * p, vol: 0.045, a: 0.2 });
  },
  condemn: (t, p) => {
    noise(t, 0.38, { type: 'lowpass', f0: 950, f1: 55, q: 1.4, vol: 0.42, a: 0.004 });
    noise(t + 0.05, 0.24, { type: 'bandpass', f0: 420, f1: 90, q: 3, vol: 0.2, a: 0.01 });
    tone(t, 0.42, { f0: 95 * p, f1: 34, vol: 0.4, wave: 'triangle', a: 0.004 });
  },
  lightwell: (t, p) => {
    noise(t, 0.48, { type: 'highpass', f0: 3600, f1: 1800, vol: 0.11, a: 0.08 });
    tone(t, 0.62, { f0: 610 * p, f1: 880 * p, vol: 0.075, a: 0.12 });
    tone(t + 0.1, 0.55, { f0: 920 * p, f1: 1240 * p, vol: 0.04, a: 0.15 });
  },
  judgment_beam: (t, p) => {
    noise(t, 0.52, { type: 'bandpass', f0: 3200, f1: 1100, q: 1.4, vol: 0.25, a: 0.025 });
    noise(t + 0.08, 0.34, { type: 'highpass', f0: 5200, f1: 1800, vol: 0.12, a: 0.01 });
    tone(t, 0.55, { f0: 185 * p, f1: 125 * p, vol: 0.16, wave: 'triangle', a: 0.04 });
  },
  judgement_cast: (t, p) => {
    // Finish before the hammer's 0.55s impact cue so the two distinct sounds do not smear together.
    noise(t, 0.36, { type: 'lowpass', f0: 120, f1: 520, q: 0.7, vol: 0.16, a: 0.035 });
    noise(t + 0.06, 0.28, { type: 'highpass', f0: 1500, f1: 3600, vol: 0.09, a: 0.025 });
    tone(t, 0.38, { f0: 110 * p, f1: 196 * p, vol: 0.2, wave: 'triangle', a: 0.03 });
    tone(t + 0.06, 0.3, { f0: 330 * p, f1: 587 * p, vol: 0.07, wave: 'sine', a: 0.03 });
  },
  judgement_impact: (t, p) => {
    // Keep a forceful but finite tail; this is a one-shot, not an ambient or looping sound.
    noise(t, 0.5, { type: 'lowpass', f0: 620, f1: 38, q: 0.8, vol: 0.34, a: 0.002 });
    noise(t, 0.19, { type: 'highpass', f0: 5200, f1: 850, vol: 0.2, a: 0.001 });
    tone(t, 0.52, { f0: 92 * p, f1: 34 * p, vol: 0.28, wave: 'triangle', a: 0.002 });
    [392, 523, 659].forEach((f, i) => tone(t + 0.025 + i * 0.018, 0.3, { f0: f * p, f1: f * p * 0.96, vol: 0.055 - i * 0.008, wave: 'sine', a: 0.006 }));
  },
  sanctuary: (t, p) => {
    noise(t, 0.9, { type: 'lowpass', f0: 260, f1: 1200, q: 0.7, vol: 0.1, a: 0.25 });
    [146.8, 220, 293.7].forEach((f, i) => tone(t + i * 0.055, 0.95, { f0: f * p, f1: f * p * 1.015, vol: 0.055 - i * 0.009, wave: 'sine', a: 0.22 }));
  },
  blessed_shield_cast: (t, p) => {
    noise(t, 0.24, { type: 'bandpass', f0: 2600, f1: 420, q: 1.6, vol: 0.32, a: 0.003 });
    tone(t + 0.035, 0.32, { f0: 290 * p, f1: 92 * p, vol: 0.26, wave: 'triangle', a: 0.003 });
    tone(t + 0.04, 0.24, { f0: 510 * p, f1: 210 * p, vol: 0.09, wave: 'sine', a: 0.002 });
  },
  radiant_cascade: (t, p) => {
    noise(t, 0.42, { type: 'bandpass', f0: 4600, f1: 650, q: 1.1, vol: 0.3, a: 0.002 });
    for (let i = 0; i < 6; i++) noise(t + 0.025 + i * 0.045, 0.055, { type: 'highpass', f0: R(3000, 6200), f1: 700, vol: 0.18, a: 0.001 });
    tone(t, 0.38, { f0: 185 * p, f1: 48, vol: 0.22, wave: 'triangle', a: 0.002 });
  },
  purifying_nova: (t, p) => {
    noise(t, 0.45, { type: 'lowpass', f0: 130, f1: 2400, q: 0.8, vol: 0.34, a: 0.004 });
    noise(t + 0.07, 0.38, { type: 'highpass', f0: 5000, f1: 1300, vol: 0.16, a: 0.012 });
    tone(t, 0.42, { f0: 115 * p, f1: 42, vol: 0.3, wave: 'triangle', a: 0.002 });
  },
  apocalypse_light: (t, p) => {
    noise(t, 0.95, { type: 'lowpass', f0: 85, f1: 1300, q: 0.8, vol: 0.3, a: 0.42 });
    [73.4, 110, 146.8].forEach((f, i) => tone(t + i * 0.07, 1.05, { f0: f * p, f1: f * p * 1.03, vol: 0.12 - i * 0.018, wave: 'sine', a: 0.42 }));
    noise(t + 0.35, 0.52, { type: 'bandpass', f0: 1800, f1: 360, q: 1.2, vol: 0.18, a: 0.08 });
  },
  wings_judgment: (t, p) => {
    noise(t, 0.38, { type: 'bandpass', f0: 2100, f1: 260, q: 0.8, vol: 0.26, a: 0.045 });
    noise(t + 0.08, 0.34, { type: 'highpass', f0: 4400, f1: 1700, vol: 0.13, a: 0.06 });
    tone(t + 0.08, 0.48, { f0: 330 * p, f1: 190 * p, vol: 0.12, wave: 'triangle', a: 0.1 });
  },
  apocalypse_impact: (t, p) => {
    noise(t, 0.2, { type: 'lowpass', f0: 620, f1: 70, vol: 0.28, a: 0.002 });
    noise(t + 0.025, 0.14, { type: 'highpass', f0: 4100, f1: 1200, vol: 0.12, a: 0.002 });
    tone(t, 0.2, { f0: 105 * p, f1: 44, vol: 0.2, wave: 'triangle', a: 0.002 });
  },
  wings_judgment_impact: (t, p) => {
    noise(t, 0.16, { type: 'bandpass', f0: 1800, f1: 340, q: 1, vol: 0.18, a: 0.003 });
    tone(t, 0.18, { f0: 220 * p, f1: 90, vol: 0.17, wave: 'triangle', a: 0.002 });
  },
  arcane: (t, p) => { tone(t, 0.3, { f0: 500 * p, f1: 1400 * p, vol: 0.12 }); tone(t, 0.3, { f0: 750 * p, f1: 2100 * p, vol: 0.06, wave: 'triangle' }); },
  holy: (t, p) => { [523, 659, 784].forEach((f, i) => tone(t + i * 0.02, 0.5, { f0: f * p, vol: 0.07, a: 0.03 })); },
  ready_hearth: (t, p) => { [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.05, 0.45, { f0: f * p, vol: 0.09, wave: 'triangle' })); },
  shadow: (t, p) => { tone(t, 0.4, { wave: 'sawtooth', f0: 220 * p, f1: 55, vol: 0.12 }); noise(t, 0.3, { f0: 600, f1: 100, vol: 0.2 }); },
  poison: (t, p) => { for (let i = 0; i < 5; i++) tone(t + i * 0.04, 0.06, { f0: R(200, 500) * p, f1: R(400, 800), vol: 0.07 }); },
  acid: (t, p) => { noise(t, 0.25, { type: 'bandpass', f0: 500 * p, f1: 200, q: 8, vol: 0.4 }); SOUNDS.poison(t, p * 0.7); },
  blood: (t, p) => SOUNDS.squish(t, p),
  phys: (t, p) => SOUNDS.swing(t, p),
  explode: (t, p) => { noise(t, 0.7, { f0: 1600 * p, f1: 60, vol: 0.7, a: 0.004 }); tone(t, 0.5, { f0: 90 * p, f1: 30, vol: 0.5, wave: 'triangle' }); },
  shoot: (t, p) => { noise(t, 0.12, { type: 'highpass', f0: 2500 * p, f1: 800, vol: 0.4 }); tone(t, 0.06, { wave: 'square', f0: 180, f1: 60, vol: 0.15 }); },
  bow: (t, p) => { tone(t, 0.12, { wave: 'triangle', f0: 320 * p, f1: 180, vol: 0.2 }); noise(t, 0.08, { type: 'bandpass', f0: 2000, f1: 900, q: 3, vol: 0.15 }); },
  pickup: (t) => { tone(t, 0.07, { f0: 660, vol: 0.12 }); tone(t + 0.07, 0.1, { f0: 990, vol: 0.12 }); },
  gold: (t) => { for (let i = 0; i < 3; i++) tone(t + i * 0.05, 0.12, { f0: R(2400, 3600), vol: 0.06, wave: 'triangle' }); },
  orb: (t) => { tone(t, 0.18, { f0: 400, f1: 900, vol: 0.1 }); },
  potion: (t) => { for (let i = 0; i < 4; i++) tone(t + i * 0.06, 0.08, { f0: R(300, 600), f1: R(150, 300), vol: 0.12 }); },
  levelup: (t) => { [392, 523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, 0.5, { f0: f, vol: 0.12, wave: 'triangle' })); },
  infernal_mark: (t, p) => {
    // A compact reward chime: a restrained low resonance, warm bell partials and one brief metallic shimmer.
    tone(t, 0.82, { f0: 82, f1: 62, vol: 0.16, wave: 'triangle', a: 0.012 });
    tone(t, 0.78, { f0: 196 * p, f1: 192 * p, vol: 0.105, wave: 'sine', a: 0.004 });
    tone(t + 0.045, 0.68, { f0: 293.7 * p, f1: 290 * p, vol: 0.065, wave: 'sine', a: 0.004 });
    tone(t + 0.09, 0.54, { f0: 587.3 * p, f1: 580 * p, vol: 0.035, wave: 'sine', a: 0.003 });
    noise(t + 0.035, 0.16, { type: 'highpass', f0: 6800, f1: 3200, vol: 0.025, a: 0.003 });
  },
  thunder: (t, p) => { SOUNDS.light(t, p); noise(t, 2.4, { f0: 1400 * p, f1: 60, vol: 0.35, a: 0.004 }); tone(t, 1.8, { f0: 55, f1: 28, vol: 0.25 }); }, // until the sample loads
  portal: (t) => { noise(t, 1.0, { type: 'bandpass', f0: 200, f1: 2400, q: 3, vol: 0.4, a: 0.2 }); tone(t, 1.0, { f0: 200, f1: 800, vol: 0.08, a: 0.2 }); },
  ui: (t) => tone(t, 0.05, { wave: 'triangle', f0: 900, f1: 700, vol: 0.1 }),
  error: (t) => tone(t, 0.18, { wave: 'square', f0: 130, f1: 110, vol: 0.08 }),
  boss: (t) => { tone(t, 1.2, { wave: 'sawtooth', f0: 90, f1: 40, vol: 0.3, a: 0.1 }); noise(t, 1.2, { f0: 800, f1: 100, vol: 0.4, a: 0.1 }); },
  die: (t) => { tone(t, 1.4, { wave: 'sawtooth', f0: 300, f1: 40, vol: 0.25 }); noise(t, 1.0, { f0: 1000, f1: 50, vol: 0.3 }); },
  summon: (t, p) => { noise(t, 0.5, { type: 'bandpass', f0: 300 * p, f1: 1500 * p, q: 4, vol: 0.3, a: 0.1 }); tone(t, 0.4, { f0: 200 * p, f1: 600 * p, vol: 0.06 }); },
  heal: (t) => { [660, 880, 1100].forEach((f, i) => tone(t + i * 0.07, 0.4, { f0: f, vol: 0.07 })); },
  buff: (t, p) => { tone(t, 0.5, { f0: 300 * p, f1: 900 * p, vol: 0.1, a: 0.05 }); noise(t, 0.4, { type: 'highpass', f0: 4000, vol: 0.08, a: 0.1 }); },
  thud: (t, p) => { tone(t, 0.25, { f0: 110 * p, f1: 35, vol: 0.5, wave: 'triangle' }); noise(t, 0.25, { f0: 700, f1: 60, vol: 0.4 }); },
  roar: (t) => { tone(t, 0.6, { wave: 'sawtooth', f0: 140, f1: 70, vol: 0.18, a: 0.05 }); noise(t, 0.6, { type: 'bandpass', f0: 500, f1: 250, q: 2, vol: 0.3, a: 0.05 }); },
  hurt: (t) => { tone(t, 0.15, { wave: 'square', f0: 220, f1: 140, vol: 0.08 }); noise(t, 0.1, { f0: 1200, f1: 300, vol: 0.2 }); },
  block: (t) => { tone(t, 0.12, { wave: 'square', f0: 900, f1: 600, vol: 0.08 }); noise(t, 0.06, { type: 'highpass', f0: 3000, vol: 0.2 }); },
  sonic: (t, p) => { tone(t, 0.3, { wave: 'square', f0: 110 * p, f1: 55, vol: 0.12 }); tone(t, 0.3, { wave: 'square', f0: 165 * p, f1: 82, vol: 0.08 }); },
  critping: (t) => tone(t, 0.08, { wave: 'square', f0: 1400, f1: 700, vol: 0.06 }),
  chest: (t) => { SOUNDS.thud(t, 1.4); SOUNDS.pickup(t + 0.1); },
  door: (t) => SOUNDS.thud(t, 0.7),
  gate: (t) => { tone(t, 0.8, { wave: 'sawtooth', f0: 70, f1: 50, vol: 0.12 }); noise(t, 0.8, { type: 'bandpass', f0: 900, f1: 400, q: 6, vol: 0.2 }); },
  step: (t, p) => noise(t, 0.05, { f0: 700 * p, f1: 200, vol: 0.06 }),
  bell: (t, p) => { [[1, 0.16, 2.4], [2.0, 0.09, 1.6], [2.76, 0.07, 1.2], [5.4, 0.04, 0.7], [0.5, 0.06, 2.8]].forEach(([k, v, d]) => tone(t, d, { wave: 'sine', f0: 392 * k * p, f1: 392 * k * p * 0.995, vol: v, a: 0.004 })); },
  iron_express_whistle: (t, p) => {
    // Fallback to the generated old-fashioned steam whistle: a low three-note chord, soft breath, and finite release.
    for (const [f, v] of [[293.66, 0.2], [369.99, 0.15], [440, 0.11]]) {
      tone(t, 1.12, { f0: f * p * 0.98, f1: f * p * 0.965, vol: v, wave: 'sine', a: 0.055 });
      tone(t, 1.05, { f0: f * p * 1.96, f1: f * p * 1.93, vol: v * 0.18, wave: 'sine', a: 0.055 });
    }
    noise(t + 0.58, 0.68, { type: 'lowpass', f0: 1500, f1: 430, q: 0.8, vol: 0.09, a: 0.08 });
  },
  note: (t, p) => { const f = [523, 587, 659, 784, 880][Math.floor(Math.random() * 5)]; tone(t, 0.3, { wave: 'triangle', f0: f * p, vol: 0.12 }); },
};

let infernalMarkChimeUntil = 0;
/** Play one short, non-overlapping chime for post-cap XP Mark awards. */
export function infernalMarkRewardSfx() {
  if (!ac || G.settings.sfx <= 0 || ac.currentTime < infernalMarkChimeUntil) return false;
  infernalMarkChimeUntil = ac.currentTime + 0.9;
  sfx('infernal_mark', 0.72, 1, { source: 'post-cap XP Infernal Mark reward', sourceActive: false });
  return true;
}

export function sfx(name, vol = 1, pitch = 1, context = null) {
  // Catch legacy and future notification bells while aboard; preserve every other sound and region.
  if (name === 'bell' && ironExpressActive()) return ironExpressWhistleSfx(vol);
  const category = audioGroupForSound(name, context);
  const combat = context?.combat ?? isCombatAudioCategory(category);
  const diagnostic = beginDiagnostic(name, { ...context, category, combat, inCombat: context?.inCombat ?? isAudioCombatActive() });
  if (!ac || G.settings.sfx <= 0) return finishRequestedDiagnostic(diagnostic, 'unavailable');
  const fn = SOUNDS[name];
  if (!fn) return finishRequestedDiagnostic(diagnostic, 'unknown-sound');
  const now = ac.currentTime;
  const audio = G.settings.audio = normalizeAudioSettings(G.settings.audio);
  if (audio.muted.master || audio.volumes.master <= 0 || audio.muted[category] || audio.volumes[category] <= 0) return finishRequestedDiagnostic(diagnostic, 'muted');
  if (context?.cancelIfInactive && typeof context.sourceActive === 'function' && !context.sourceActive()) {
    recordAudioMetric('cancelledAfterCombat', category); return finishRequestedDiagnostic(diagnostic, 'source-ended');
  }
  if (context?.cancelIfInactive && context.worldId != null && G.world?.id !== context.worldId) {
    recordAudioMetric('cancelledAfterCombat', category); return finishRequestedDiagnostic(diagnostic, 'area-ended');
  }
  if (audio.persistentSpellSounds === false && (context?.persistent === true || category === 'persistentSpell')) return finishRequestedDiagnostic(diagnostic, 'persistent-disabled');
  const needsDistance = audio.distanceCulling || audio.stereoPositioning;
  const distance = needsDistance && context?.x != null && context?.y != null && G.player ? Math.hypot(context.x - G.player.x, context.y - G.player.y) : null;
  if (distance != null && audio.distanceCulling && distance > 28 && !['boss', 'combatWarnings', 'questAchievement'].includes(category)) {
    recordAudioMetric('distanceCulled', category); return finishRequestedDiagnostic(diagnostic, 'distance-culled');
  }
  if ((context?.actor === 'enemy' || context?.sourceType === 'enemy') && context?.offscreen === true && !audio.offscreenEnemySounds) {
    recordAudioMetric('offscreenCulled', category); return finishRequestedDiagnostic(diagnostic, 'offscreen-culled');
  }
  if (category === 'environment' && audio.environmentalDensity !== 'Full' && context?.important !== true) {
    const probability = audio.environmentalDensity === 'Minimal' ? 0.35 : 0.65;
    if (Math.random() > probability) { recordAudioMetric('environmentDensitySuppressed', category); return finishRequestedDiagnostic(diagnostic, 'environment-density'); }
  }
  for (let i = liveSoundInstances.length - 1; i >= 0; i--) if (liveSoundInstances[i].endsAt <= now) liveSoundInstances.splice(i, 1);
  const identicalLimit = Math.max(1, Math.min(5, Number(audio.maxIdenticalSounds) || 2));
  if (liveSoundInstances.filter((item) => item.sound === name).length >= identicalLimit) {
    recordAudioMetric('duplicateSuppressed', category); return finishRequestedDiagnostic(diagnostic, 'duplicate-suppressed');
  }
  if (combat && liveSoundInstances.filter((item) => item.combat).length >= audio.maxCombatSounds) {
    recordAudioMetric('discarded', category); return finishRequestedDiagnostic(diagnostic, 'channel-limit');
  }
  const repetitionMs = ({ Off: 0, Low: 45, Medium: 100, High: 220 })[audio.repetitiveSuppression] ?? 45;
  const l = last[name] || (last[name] = { t: -Infinity, n: 0 });
  if (repetitionMs && (now - l.t) * 1000 < repetitionMs) {
    if (++l.n > (audio.repetitiveSuppression === 'High' ? 1 : 2)) {
      recordAudioMetric('duplicateSuppressed', category); return finishRequestedDiagnostic(diagnostic, 'repeat-suppressed');
    }
  } else l.n = 0;
  l.t = now;
  const route = createSpatialRoute(categoryBuses[category] || sfxBus, context, distance, audio);
  const playback = { id: ++nextPlaybackId, sound: name, category, combat, endsAt: now + 0.2, route: route.cleanup };
  liveSoundInstances.push(playback);
  if (diagnostic) { diagnostic.category = category; diagnostic.combatAudio = combat; diagnostic.playbackId = playback.id; }
  if (diagnostic) diagnosticEvent('playback-registered', diagnostic, { category, playbackId: playback.id, combatAudio: combat, durationEstimateMs: 200 });
  if (audioRecording?.active) peakByCategory[category] = Math.max(peakByCategory[category] || 0, liveSoundInstances.filter((item) => item.category === category).length);
  if (['rareItem', 'questAchievement'].includes(category) && audio.notificationDucking) duckForNotification(now, audio);
  const previousDiagnostic = currentDiagnostic;
  const previousSoundName = currentSoundName;
  const previousOutputBus = activeOutputBus;
  const previousPlayback = currentPlaybackRecord;
  currentDiagnostic = diagnostic;
  currentSoundName = name;
  activeOutputBus = route.node;
  currentPlaybackRecord = playback;
  const started = audioRecording?.active ? performance.now() : 0;
  try {
    const p = pitch * (0.92 + Math.random() * 0.16);
    const sampleResult = playSample(name, vol * route.attenuation, p, now, route.node);
    if (sampleResult === 'limited') {
      recordAudioMetric('sampleVoiceSuppressed', category);
      const liveIndex = liveSoundInstances.indexOf(playback);
      if (liveIndex >= 0) liveSoundInstances.splice(liveIndex, 1);
      route.cleanup?.();
      return finishRequestedDiagnostic(diagnostic, 'sample-voice-limit');
    }
    if (sampleResult) return true;
    voice(vol * route.attenuation, () => fn(now, p), route.node);
    return true;
  } catch (e) { recordAudioMetric('playbackErrors', category); if (diagnostic) diagnosticEvent('error', diagnostic, { message: String(e?.message || e) }); return false; }
  finally {
    if (started) {
      const elapsed = performance.now() - started;
      audioProcessingMs += elapsed; audioProcessingSamples++; audioProcessingWorstMs = Math.max(audioProcessingWorstMs, elapsed);
      audioFrameProcessingMs += elapsed;
      if (elapsed > 2 && audioRecording?.active) captureAudioDiagnosticEvent({ type: 'processing-spike', timeUtc: new Date().toISOString(), perfMs: performance.now(), durationMs: Number(elapsed.toFixed(3)), sound: name, category });
    }
    currentDiagnostic = previousDiagnostic;
    currentSoundName = previousSoundName;
    activeOutputBus = previousOutputBus;
    currentPlaybackRecord = previousPlayback;
    if (route.cleanup) setTimeout(route.cleanup, Math.max(0, (playback.endsAt - now) * 1000) + 120);
    if (diagnostic) { diagnostic.sealed = true; if (!diagnostic.sources) finishDiagnostic(diagnostic); }
  }
}

function duckForNotification(now, audio) {
  if (!ac || now < notificationDuckUntil) return;
  notificationDuckUntil = now + 0.8;
  const depth = Math.max(0.2, 1 - audio.duckAmount / 100);
  for (const [bus, base] of [[musicBus, audio.volumes.music / 100], [ambBus, audio.volumes.ambient / 100]]) {
    const param = bus.gain;
    param.cancelScheduledValues(now); param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(base * depth, now + 0.06);
    param.setValueAtTime(base * depth, notificationDuckUntil);
    param.linearRampToValueAtTime(base, notificationDuckUntil + 0.18);
  }
}

function finishRequestedDiagnostic(diagnostic, reason) {
  if (diagnostic) { diagnostic.sealed = true; finishDiagnostic(diagnostic, reason); }
  return false;
}

function trackPlaybackEnd(at) {
  if (currentPlaybackRecord && Number.isFinite(at)) currentPlaybackRecord.endsAt = Math.max(currentPlaybackRecord.endsAt, at);
}

function createSpatialRoute(bus, context, distance, audio) {
  const usesDistance = audio.stereoPositioning || audio.distanceCulling;
  const attenuation = usesDistance ? Math.max(0.12, 1 / (1 + Math.max(0, distance || 0) * 0.08)) : 1;
  if (!audio.stereoPositioning || !context || context.x == null || context.y == null || !G.player || typeof ac.createStereoPanner !== 'function') {
    return { node: bus, attenuation, cleanup: null };
  }
  const panner = ac.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, ((context.x - G.player.x) - (context.y - G.player.y)) / 12));
  panner.connect(bus);
  const cleanup = () => { try { panner.disconnect(); } catch {} };
  return { node: panner, attenuation, cleanup };
}
// A procedural sound's oscillators, filters and gains go through a gain of their own that is unplugged once the sound
// is over (the longest is ~2.5 s): left wired into the mix, a long session piles up thousands of finished nodes, which
// WebKit keeps processing.
function voice(vol, play, bus = sfxBus) {
  const g = ac.createGain(); g.gain.value = vol;
  const prev = activeOutputBus; activeOutputBus = g; g.connect(bus);
  try { play(); } finally { activeOutputBus = prev; }
  const delay = Math.max(100, ((currentPlaybackRecord?.endsAt || ac.currentTime + 0.25) - ac.currentTime) * 1000 + 100);
  setTimeout(() => {
    g.disconnect();
  }, delay);
}


// ------------------------------------------------------------------ level up
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

/**
 * Grim level-up toll: a rising dread swell, then a sub boom, a cracked funeral bell and a low diminished choir drone.
 * Returns { voiceAt, voiceDur } (the moment of the toll, 0), or null when sound is off or one is still ringing.
 */
export function levelUpFanfare() {
  const audio = normalizeAudioSettings(G.settings.audio);
  if (!ac || G.settings.sfx <= 0 || audio.muted.master || audio.muted.questAchievement || audio.volumes.master <= 0 || audio.volumes.questAchievement <= 0) return null;
  const now = ac.currentTime;
  if (now < fanfareEnd) return null;
  const previousOutputBus = activeOutputBus, previousDiagnostic = currentDiagnostic, previousPlayback = currentPlaybackRecord, previousName = currentSoundName;
  const diagnostic = beginDiagnostic('levelup-fanfare', { category: 'questAchievement', source: 'Character level-up celebration', sourceActive: false });
  const playback = { id: ++nextPlaybackId, sound: 'levelup-fanfare', category: 'questAchievement', combat: false, endsAt: now + 4.2, route: null };
  liveSoundInstances.push(playback);
  activeOutputBus = categoryBuses.questAchievement || sfxBus;
  currentDiagnostic = diagnostic; currentPlaybackRecord = playback; currentSoundName = 'levelup-fanfare';
  if (diagnostic) diagnostic.playbackId = playback.id;
  const t0 = now + 0.02, ts = t0 + 0.55;
  try {
    // dread swell into the toll
    noise(t0, 0.6, { type: 'bandpass', f0: 120, f1: 900, q: 2, vol: 0.3, a: 0.5 });
    tone(t0, 0.6, { f0: 40, f1: 70, vol: 0.25, a: 0.5 });
    // the toll: sub boom, thud, a cracked low bell (inharmonic partials)
    tone(ts, 1.4, { f0: 70, f1: 26, vol: 0.7, a: 0.003 });
    noise(ts, 0.5, { f0: 500, f1: 60, vol: 0.6, a: 0.002 });
    [[0.5, 0.2], [1, 0.16], [1.19, 0.1], [1.5, 0.07], [2, 0.06], [2.74, 0.04], [3.76, 0.025]].forEach(([m, v], i) =>
      tone(ts, 3.6 - i * 0.3, { f0: 98 * m, f1: 98 * m * 0.985, vol: v, a: 0.004, detune: i % 2 ? 6 : -6 }));
    // a low diminished choir under it (D, F, Ab), detuned saws through a dark filter
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.connect(categoryBuses.questAchievement || sfxBus);
    [38, 41, 44, 50].forEach((n, i) => [-9, 9].forEach((dt) => {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = dt;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, ts); g.gain.exponentialRampToValueAtTime(0.03 - i * 0.004, ts + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, ts + 3.4);
      o.connect(g); g.connect(lp); trackPlaybackEnd(ts + 3.5); o.start(ts); o.stop(ts + 3.5); trackDiagnosticSource(o, ts, ts + 3.5);
    }));
    noise(ts + 0.3, 2.6, { type: 'bandpass', f0: 380, f1: 180, q: 4, vol: 0.12, a: 0.8 });   // a breath in the dark
  } catch (e) { audioMetrics.playbackErrors++; }
  finally {
    activeOutputBus = previousOutputBus; currentDiagnostic = previousDiagnostic; currentPlaybackRecord = previousPlayback; currentSoundName = previousName;
    if (diagnostic) { diagnostic.sealed = true; if (!diagnostic.sources) finishDiagnostic(diagnostic); }
  }
  const voiceAt = 0.57, voiceDur = 0;
  const end = voiceAt + 3;
  fanfareEnd = now + end;
  // duck the music and ambience under it
  for (const [bus, v] of [[musicBus, audio.volumes.music / 100], [ambBus, audio.volumes.ambient / 100]]) {
    const g = bus.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(v, now);
    g.linearRampToValueAtTime(v * 0.25, now + 0.15); g.setValueAtTime(v * 0.25, now + end);
    g.linearRampToValueAtTime(v, now + end + 1.2);
  }
  return { voiceAt, voiceDur };
}

// ------------------------------------------------------------------ samples
const n3 = (base, n) => Array.from({ length: n }, (_, i) => `${base}_${i + 1}`);
const STEP = (kind) => ({ s: [...n3(`${kind}_walk`, 5), ...n3(`${kind}_run`, 5)], v: 0.2, max: 2 }); // missing slugs are skipped
// sound name -> { s: sample slugs (one picked at random), v: gain, layer: procedural sound played on top, max: voices }
const SAMPLES = {
  swing: { s: [...n3('sword_attack', 3), ...n3('torch_attack_strike', 2)], v: 0.5 },
  phys: { s: n3('sword_attack', 3), v: 0.5 },
  hit: { s: [...n3('sword_impact_hit', 3), ...n3('bow_impact_hit', 3), ...n3('torch_impact', 2)], v: 0.55 },
  crit: { s: n3('sword_impact_hit', 3), v: 0.75, layer: 'critping' },
  block: { s: [...n3('sword_blocked', 3), ...n3('sword_parry', 3), ...n3('bow_blocked', 3)], v: 0.55 },
  bow: { s: n3('bow_attack', 2), v: 0.55 },
  fire: { s: [...n3('fireball', 3), ...n3('firespray', 2)], v: 0.45 },
  cold: { s: [...n3('ice_throw', 2), ...n3('ice_freeze', 2), ...n3('ice_barrage', 2), ...n3('ice_wall', 2)], v: 0.45 },
  acid: { s: [...n3('waterspray', 2), ...n3('wave_attack', 2)], v: 0.4 },
  thud: { s: n3('rock_wall', 2), v: 0.35, max: 2 },
  arcane: { s: n3('spell_impact', 3), v: 0.5 },
  explode: { s: [...n3('rock_meteor_throw', 2), ...n3('rock_meteor_swarm', 2)], v: 0.55, layer: 'explode' },
  buff: { s: [...n3('firebuff', 2), ...n3('light_torch', 2), ...n3('light_torch_with_starting_loop', 2)], v: 0.4, max: 1 },
  chest: { s: [...n3('chest_open', 2), ...n3('chest_close', 2), 'lock_unlock'], v: 0.7, max: 1 },
  door: { s: [...n3('door_open', 2), ...n3('door_close', 2)], v: 0.45, max: 2 },
  gate: { s: ['gate_open', 'gate_close', 'portcullis_gate'], v: 0.7, max: 1 },
  thunder: { s: ['thunder_crack'], v: 0.6, max: 1 }, // the level-up's lightning (oneshots/, tools/audiopack.py)
  iron_express_whistle: { s: ['iron_express_whistle'], ext: 'wav', v: 0.72, max: 1 },
  step_stone: STEP('stone'), step_dirt: STEP('dirt'), step_water: STEP('water'), step_wood: STEP('wood'),
};
// Footstep surfaces have sample sets, but the sound router also requires a procedural
// registry entry before it checks those sets. Reuse the generic footstep fallback.
for (const name of ['step_stone', 'step_dirt', 'step_water', 'step_wood']) SOUNDS[name] = SOUNDS.step;
export const hasSoundDefinition = (name) => typeof SOUNDS[name] === 'function';

async function loadSamples() {
  try {
    manifest = await (await fetch(AUDIO + 'audio.json')).json();
  } catch (e) { return; }   // no audio files: everything stays procedural
  const want = [...new Map(Object.entries(SAMPLES).flatMap(([, d]) => d.s.map((slug) => [slug, { slug, ext: d.ext || 'mp3' }]))).values()]
    .filter(({ slug }) => manifest.sfx.includes(slug));
  let i = 0;
  const worker = async () => {
    while (i < want.length) {
      const { slug, ext } = want[i++];
      try {
        const data = await (await fetch(`${AUDIO}sfx/${slug}.${ext}`)).arrayBuffer();
        buffers[slug] = await new Promise((ok, no) => ac.decodeAudioData(data, ok, no));
      } catch (e) { /* that sound stays procedural */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

let ironExpressWhistleUntil = 0;
let ironExpressWhistleTimer = null;
const pendingIronExpressWhistles = [];
const ironExpressActive = () => !!(G.world?.map?.ghostTrain || G.world?.trainRun?.id === 'ghost_train');
function scheduleIronExpressWhistle() {
  if (ironExpressWhistleTimer || !pendingIronExpressWhistles.length) return;
  const delay = Math.max(0, (ironExpressWhistleUntil - (ac?.currentTime || 0)) * 1000);
  ironExpressWhistleTimer = setTimeout(() => {
    ironExpressWhistleTimer = null;
    if (!ironExpressActive() || !ac || G.settings.sfx <= 0) { pendingIronExpressWhistles.length = 0; return; }
    const volume = pendingIronExpressWhistles.shift();
    ironExpressWhistleUntil = 0;
    ironExpressWhistleSfx(volume);
    scheduleIronExpressWhistle();
  }, delay);
}
/** One finite, non-overlapping notification whistle for Iron Express announcements. */
export function ironExpressWhistleSfx(volume = 1) {
  if (!ironExpressActive() || !ac || G.settings.sfx <= 0) return false;
  if (ac.currentTime < ironExpressWhistleUntil) {
    pendingIronExpressWhistles.push(volume);
    scheduleIronExpressWhistle();
    return true;
  }
  ironExpressWhistleUntil = ac.currentTime + 1.42;
  sfx('iron_express_whistle', volume, 1, { source: 'Iron Express notification', sourceActive: false, important: true });
  scheduleIronExpressWhistle();
  return true;
}
/** Stop a pending/ringing train notification as soon as the player leaves the Iron Express. */
export function stopIronExpressWhistleSfx() {
  ironExpressWhistleUntil = 0;
  if (ironExpressWhistleTimer) clearTimeout(ironExpressWhistleTimer);
  ironExpressWhistleTimer = null;
  pendingIronExpressWhistles.length = 0;
  for (const source of [...ironExpressWhistleSources]) {
    try { source.stop(); } catch { /* a source that already ended needs no further action */ }
  }
  ironExpressWhistleSources.clear();
}

/** Notification-only router: Iron Express uses its whistle; other areas keep their requested cue. */
export function notificationSfx(fallback = 'ui', volume = 1) {
  if (ironExpressActive()) return ironExpressWhistleSfx(volume);
  if (fallback) { sfx(fallback, volume); return true; }
  return false;
}

function playSample(name, vol, p, now, bus = sfxBus) {
  const d = SAMPLES[name];
  if (!d) return false;
  const ready = d.s.filter((k) => buffers[k]);
  if (!ready.length) return false;
  const live = voices[name] || (voices[name] = []);
  for (let i = live.length - 1; i >= 0; i--) if (live[i] < now) live.splice(i, 1);
  if (live.length >= (d.max || 3)) return 'limited';
  const buf = ready[Math.floor(Math.random() * ready.length)];
  const src = ac.createBufferSource(); src.buffer = buffers[buf]; src.playbackRate.value = p;
  const g = ac.createGain(); g.gain.value = d.v * vol;
  src.connect(g); g.connect(bus); src.start(now);
  src.onended = () => { src.disconnect(); g.disconnect(); };
  trackIronExpressWhistleSource(src);
  if (currentDiagnostic) currentDiagnostic.asset = `sample:${buf}`;
  if (currentDiagnostic) currentDiagnostic.assetPath = `${AUDIO}${manifest?.sfxFiles?.[buf] || `${buf}.${d.ext || 'mp3'}`}`;
  const endAt = now + buffers[buf].duration / p;
  trackDiagnosticSource(src, now, endAt);
  trackPlaybackEnd(endAt); live.push(endAt);
  if (d.layer) voice(vol * 0.6, () => SOUNDS[d.layer](now, p), bus);
  return true;
}

/** Footsteps: call every frame with the walker; plays a step every ~0.85 tiles walked on the given surface. */
let stepX = null, stepY = 0, stepD = 0;
export function footsteps(p, surface) {
  if (!ac || !p) return;
  if (!p.moving || p.dead) { stepX = p.x; stepY = p.y; return; }
  if (stepX === null || Math.abs(p.x - stepX) + Math.abs(p.y - stepY) > 3) { stepX = p.x; stepY = p.y; return; }   // teleported
  stepD += Math.hypot(p.x - stepX, p.y - stepY); stepX = p.x; stepY = p.y;
  if (stepD < 0.85) return;
  stepD = 0;
  sfx(SAMPLES['step_' + surface] ? 'step_' + surface : 'step_stone', 1, 1,
    { category: 'playerMovement', combat: false, source: 'Player footsteps' });
}

// ------------------------------------------------------------------ streamed tracks
const decks = {};
const pending = {};
let silentUrl = null;
function silence() {   // a 0.05 s silent WAV, used to unlock the media elements inside the first gesture
  if (silentUrl) return silentUrl;
  const n = 2205, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return (silentUrl = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
}

/** One <audio> element -> gain -> bus. fade() ramps the gain; the element itself always plays at full volume. */
class Deck {
  constructor(bus) {
    this.el = new Audio(); this.el.preload = 'auto';
    this.g = ac.createGain(); this.g.gain.value = 0; this.g.connect(bus);
    try { ac.createMediaElementSource(this.el).connect(this.g); } catch (e) { this.direct = true; }
    this.name = null; this.gen = 0;
  }
  unlock() { if (this.name) return; this.el.src = silence(); const p = this.el.play(); if (p) p.then(() => { if (!this.name) this.el.pause(); }).catch(() => {}); }
  load(name, url, loop, at = 0) {
    this.gen++; this.name = name;
    this.el.loop = loop;
    if (!this.el.src.endsWith(url)) this.el.src = url;
    try { this.el.currentTime = at; } catch (e) { /* not seekable yet */ }
    const p = this.el.play(); if (p) p.catch(() => {});
    return this.gen;
  }
  fade(v, sec) {
    const g = this.g.gain, t = ac.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + Math.max(0.02, sec));
    if (this.direct) this.el.volume = Math.min(1, v);
  }
  stop(sec) {
    const gen = ++this.gen; this.fade(0, sec);
    setTimeout(() => { if (this.gen === gen) { this.el.pause(); this.name = null; } }, sec * 1000 + 60);
  }
  get playing() { return !!this.name && !this.el.paused; }
}

// ------------------------------------------------------------------ music director
const R2 = ([a, b]) => a + Math.random() * (b - a);
// songs in order of play (shuffled when `shuffle`); `gap` = seconds of silence (ambience only) between songs
export const TITLE_SONG = 'hymn_of_the_abyss';
const MUSIC = {
  title: { songs: [TITLE_SONG], gap: [10, 16], vol: 0.9 },
  town: { songs: ['empty_school'], gap: [30, 70], vol: 0.75 },
  // dungeons and overworld biomes: shuffled, with long ambience-only breaks; it carries on across levels
  wilds: { songs: ['stone_room_reverberation', 'stone_room_reverberation_2'], shuffle: true, gap: [45, 120], vol: 0.6 },
};
let music = null;   // { kind, def, deck, queue, next (ac time of next song or 0), gen }
const songUrls = {};   // song -> blob URL of a fully downloaded copy (preloadSong)

/** Download a song completely before the title shows, so its intro never waits on the network. Never rejects. */
export function preloadSong(song, progress) {
  return fetch(`${AUDIO}music/${song}.mp3`).then(async (r) => {
    if (!r.ok) throw new Error(r.status);
    const total = +r.headers.get('content-length') || 0;   // getReader() locks the body, so take it only when streaming
    if (!r.body || !total) { songUrls[song] = URL.createObjectURL(await r.blob()); return; }
    const rd = r.body.getReader();
    const parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; progress && progress(Math.min(1, got / total)); }
    songUrls[song] = URL.createObjectURL(new Blob(parts, { type: 'audio/mpeg' }));
  }).catch((e) => console.warn('song preload failed, it will stream:', song, e));
}

/** Inside a tap/click: point a free music deck at the kind's first song and buffer it (silently), so on mobile the
 *  song is decoded and allowed to play the moment playMusic's delay runs out. Resolves once it can play through
 *  (or after `wait` ms). */
export function primeMusic(kind, wait = 4000) {
  const def = MUSIC[kind]; if (!ac || !def) return Promise.resolve();
  const song = def.songs[0], url = songUrls[song] || `${AUDIO}music/${song}.mp3`;
  const deck = decks.music.find((d) => !d.playing) || decks.music[0], el = deck.el;
  if (deck.playing) return Promise.resolve();
  if (!el.src.endsWith(url)) { el.loop = false; el.src = url; }
  const p = el.play(); if (p) p.then(() => { if (!deck.name) el.pause(); }).catch(() => {}); else el.pause();
  if (el.readyState >= 4) return Promise.resolve();
  return new Promise((ok) => { const t = setTimeout(ok, wait); el.addEventListener('canplaythrough', () => { clearTimeout(t); ok(); }, { once: true }); });
}

/** Start a music kind (no-op if it's already the current one). opts.delay: seconds before the first song starts. */
export function playMusic(kind, opts = {}) {
  if (!ac) { pending.music = { kind, opts }; return; }
  if (music && music.kind === kind) return;
  const def = MUSIC[kind]; if (!def) return;
  if (music && music.deck) music.deck.stop(normalizeAudioSettings(G.settings.audio).musicFadeSeconds);
  const deck = decks.music.find((d) => !d.playing && (!music || d !== music.deck)) || decks.music[0];
  const queue = def.shuffle ? [...def.songs].sort(() => Math.random() - 0.5) : [...def.songs];
  music = { kind, def, deck, queue, next: ac.currentTime + (opts.delay ?? (music ? 1.2 : 0.3)), song: null };
}

export function stopMusic(sec = normalizeAudioSettings(G.settings.audio).musicFadeSeconds) {
  pending.music = null;
  if (!music || !ac) { music = null; return; }
  if (music.deck) music.deck.stop(sec);
  music = null;
}

function startSong(at = 0) {
  const m = music, def = m.def;
  if (!m.queue.length) {
    m.queue = def.shuffle ? [...def.songs].sort(() => Math.random() - 0.5) : [...def.songs];
    if (m.queue.length > 1 && m.queue[0] === m.last) m.queue.push(m.queue.shift());   // never the same song twice running
  }
  m.song = m.last = m.queue.shift();
  if (manifest && !(m.song in manifest.music)) { m.song = null; m.next = 0; return; }
  const deck = m.deck;
  deck.load(m.song, songUrls[m.song] || `${AUDIO}music/${m.song}.mp3`, false, at || def.at || 0);
  deck.g.gain.cancelScheduledValues(ac.currentTime); deck.g.gain.setValueAtTime(0, ac.currentTime);
  deck.fade(def.vol, normalizeAudioSettings(G.settings.audio).musicFadeSeconds);
  m.next = 0;
}

/** Current song position, for syncing visuals to it: { kind, song, t } or null while nothing is audible. */
export function musicClock() {
  if (!music || !music.song || !music.deck.playing) return null;
  return { kind: music.kind, song: music.song, t: music.deck.el.currentTime };
}
/** Jump the current kind's song to t seconds (starting it now if it's still waiting). */
export function seekMusic(t) {
  if (!music) return;
  if (!music.song || !music.deck.playing) { music.queue.unshift(music.def.songs[0]); startSong(t); return; }
  try { music.deck.el.currentTime = t; } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ ambience director
// Each area gets one or more 60 s beds; one plays at a time, drifting between soft and fuller every 10-25 s and now and
// then crossfading to another of its beds. Beds sit lower while a song plays and come up in the breaks between songs.
const AMB = {
  skyship_clear: ['sea', 'beach'], skyship_storm: ['sea_storm', 'forest_day_storm'], skyship_night: ['sea', 'forest_night'], skyship_fog: ['sea_rain', 'sea'],
  pirate_seas_fog: ['sea_rain', 'sea'], pirate_seas_blood: ['sea_storm', 'sea'], pirate_seas_day: ['sea', 'beach'],
  skyship_sunset: ['beach', 'sea'], skyship_gale: ['sea_storm', 'beach_storm'], skyship_blizzard: ['cave_storm', 'sea_storm'], skyship_ash: ['torch_loop', 'cave_storm'],
  town: ['forest_night', 'forest_night_rain', 'forest_day'],
  // Tessariel's Keep is a vaulted interior: reuse the existing subdued stone-room and torch beds.
  tkeep: ['inside_night', 'torch_loop'],
  catacombs: ['inside_night', 'cave'], frozen: ['cave_storm', 'forest_night_storm'],
  ice_temple: ['cave_storm', 'inside_night_storm', 'cave'], molten: ['cave', 'torch_loop'],
  fungal: ['cave_rain', 'cave'], sunken: ['sea', 'cave_rain', 'beach_rain'], blood: ['inside_night_rain', 'inside_night'],
  ashen: ['cave_storm', 'inside_day_storm'], void: ['cave', 'inside_night_storm'], gilded: ['inside_day', 'inside_night', 'inside_day_rain'],
  plague: ['river_stream_loop', 'cave_rain'], sewers: ['river_stream_loop', 'cave_rain', 'cave'], crystal: ['cave_rain', 'cave'], desert: ['inside_day_storm', 'beach_storm'],
  shadow: ['inside_night', 'cave'], forge: ['torch_loop', 'cave'], abyss: ['sea_storm', 'cave_storm', 'sea_rain'],
  thorn: ['forest_night', 'forest_day_rain'], dark_forest: ['forest_night', 'forest_night_rain', 'forest_night_storm'], mountainside: ['forest_day_storm', 'forest_day', 'forest_day_rain'], snowy_summit: ['cave_storm', 'forest_day_storm', 'sea_storm'], storm: ['forest_night_storm', 'cave_storm', 'forest_day_storm'], obsidian: ['cave', 'inside_night'],
  flesh: ['inside_night_rain', 'cave_rain'], serpent: ['river_loop', 'cave_rain'], shattered: ['inside_day_storm', 'cave_storm'],
  library: ['inside_night_rain', 'inside_night'], necropolis: ['forest_night', 'forest_night_storm'],
  amber: ['inside_day_storm', 'beach'], desert_temple: ['inside_day_storm', 'torch_loop', 'cave'],
  eternal_breach: ['inside_night_storm', 'cave_storm', 'sea_storm'],
  depths_edge: ['cave', 'cave_rain', 'river_stream_loop'], depths_edge_falls: ['waterfall_loop', 'river_loop'],
  hell: ['torch_loop', 'cave_storm', 'cave'], heavenly: ['inside_day', 'river_stream_loop', 'waterfall_loop'], astral_plane: ['cave', 'inside_night_storm', 'waterfall_loop'], throne: ['cave_storm', 'waterfall_loop'],
};
let amb = null;   // { key, beds, deck, bed, level, nextDrift, nextSwap }

export function setAmbience(key) {
  if (!ac) { pending.amb = key; return; }
  if (amb && amb.key === key) return;
  const beds = AMB[key] || AMB.catacombs;
  const old = amb;
  amb = { key, beds, deck: null, bed: null, level: 0.7, nextDrift: 0, nextSwap: ac.currentTime + R2([50, 110]) };
  swapBed(beds[0], old && old.deck, 3);
}
export function stopAmbience(sec = 2) { pending.amb = null; if (amb && amb.deck) amb.deck.stop(sec); amb = null; }

function swapBed(bed, from, sec) {
  if (manifest && !(bed in manifest.amb)) return;
  if (from) from.stop(sec);
  const deck = decks.amb.find((d) => d !== from) || decks.amb[0];
  deck.load(bed, `${AUDIO}amb/${bed}.mp3`, true, Math.random() * 50);
  deck.g.gain.cancelScheduledValues(ac.currentTime); deck.g.gain.setValueAtTime(0, ac.currentTime);
  amb.deck = deck; amb.bed = bed;
  deck.fade(ambTarget(), sec);
}
const ambTarget = () => amb.level * (music && music.song && music.deck.playing ? 0.45 : 1);

let songOn = false;
function tick() {
  if (!ac) return;
  const now = ac.currentTime;
  if (music) {
    const m = music;
    if (m.song && !m.deck.playing && m.deck.el.ended) { m.song = null; m.next = now + R2(m.def.gap); }   // song over: a break
    if (!m.song && m.next && now >= m.next) startSong();
  }
  const on = !!(music && music.song && music.deck.playing);
  if (amb && amb.deck && on !== songOn) amb.deck.fade(ambTarget(), on ? 3 : 8);   // duck under songs, swell in the breaks
  songOn = on;
  if (amb && amb.deck) {
    if (now >= amb.nextSwap && amb.beds.length > 1) {
      amb.nextSwap = now + R2([60, 140]);
      const others = amb.beds.filter((b) => b !== amb.bed);
      swapBed(others[Math.floor(Math.random() * others.length)], amb.deck, 8);
    } else if (now >= amb.nextDrift) {
      amb.nextDrift = now + R2([10, 25]);
      amb.level = R2([0.3, 1]);
      amb.deck.fade(ambTarget(), R2([6, 12]));
    }
  }
}
