import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { recordAudioDiagnosticMarker } from '../../src/core/audio.js';
import { profileBeginFrame, profileFinishFrame } from '../../src/core/perfdiagnostics.js';
import { addUnifiedDiagnosticMarker, clearUnifiedDiagnosticRecording, recordDeveloperDiagnosticEvent, startUnifiedDiagnosticRecording, stopUnifiedDiagnosticRecording, unifiedDiagnosticReport, unifiedDiagnosticStatus } from '../../src/core/developer-diagnostics.js';

G.settings.developerMode = false;
assert.equal(startUnifiedDiagnosticRecording(), false, 'recording stays off until Developer Mode is enabled');
G.settings.developerMode = true;
G.char = { name: 'Diagnostics Test', classId: 'paladin', level: 12 };
G.world = { id: 'synthetic-dungeon', kind: 'dungeon', depth: 12, biome: { name: 'Diagnostics Cave' }, time: 1,
  creatures: [], npcs: [], hazards: [], corpses: [], loot: [], environmentTraps: [], lifecycle: {} };

assert.equal(startUnifiedDiagnosticRecording(), true, 'one action starts the unified session');
const sessionId = unifiedDiagnosticStatus().sessionId;
assert.ok(sessionId);
assert.equal(recordAudioDiagnosticMarker('area-enter', { environment: 'Diagnostics Cave' }), true);
assert.equal(addUnifiedDiagnosticMarker('synthetic test marker'), true);
assert.equal(profileBeginFrame(16.67), true);
profileFinishFrame(G.world);
assert.equal(profileBeginFrame(100), true);
profileFinishFrame(G.world);

let report = unifiedDiagnosticReport();
assert.equal(report.sessionId, sessionId);
assert.equal(report.recording.metadata.game.version, report.game.version);
assert.equal(report.sections.performance.sessionId, sessionId);
assert.equal(report.sections.audio.sessionId, sessionId);
assert.equal(report.sections.performance.completeSessionStatistics.framesObserved, 2);
assert.ok(report.sections.performance.completeSessionStatistics.significantSpikes.length > 0, 'noteworthy pacing spikes survive in the complete-session aggregate');
assert.ok(report.timeline.markers.some((event) => event.details.marker === 'synthetic test marker'));
assert.ok(report.timeline.areaTransitions.some((event) => event.type === 'area-enter'));
for (let i = 0; i < 5050; i++) recordDeveloperDiagnosticEvent('synthetic-detail', { index: i }, 'simulation');
recordDeveloperDiagnosticEvent('synthetic-error', { message: 'preserved after detail limit' }, 'error');
report = unifiedDiagnosticReport();
assert.equal(report.recording.eventCounts.byType['synthetic-detail'], 5050, 'session event counters continue after detailed data is full');
assert.equal(report.recording.statisticsScope.detailedEventsStored, 5000);
assert.ok(report.recording.statisticsScope.detailedEventsDropped > 0);
assert.ok(report.timeline.errors.some((event) => event.type === 'synthetic-error'), 'important events remain available after detail truncation');

assert.equal(stopUnifiedDiagnosticRecording(), true);
G.settings.developerMode = false;
assert.equal(unifiedDiagnosticStatus().active, false);
report = unifiedDiagnosticReport();
assert.equal(report.sessionId, sessionId, 'stopping or disabling preserves the report');
assert.ok(report.recording.stoppedUtc);
clearUnifiedDiagnosticRecording();
assert.equal(unifiedDiagnosticStatus().hasRecording, false, 'Clear removes the combined session');
console.log('Unified diagnostic session start, event correlation, performance sample, stop, preserve, and clear passed.');
