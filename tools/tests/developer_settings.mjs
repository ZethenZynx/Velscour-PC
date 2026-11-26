import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [screens, state, audio, profiler, main, unified, session] = await Promise.all([
  readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/state.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/perfdiagnostics.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/developer-diagnostics.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/developer-session.js', import.meta.url), 'utf8'),
]);

const developerPane = screens.slice(screens.indexOf('data-pane="developer"'), screens.indexOf('data-pane="mouseCursor"'));
const recorderMarkup = screens.slice(screens.indexOf('function unifiedDiagnosticsMarkup'), screens.indexOf('export function settingsDialog'));
assert.match(developerPane, /Enable Developer Mode[\s\S]*Developer monitoring can add processing overhead/);
assert.equal((developerPane.match(/data-developer-mode/g) || []).length, 1, 'one master mode toggle remains');
for (const control of ['start', 'stop', 'clear', 'export']) assert.match(recorderMarkup, new RegExp(`data-unified-record-${control}`));
assert.match(recorderMarkup, /data-unified-marker/);
assert.doesNotMatch(developerPane, /data-developer-section|data-export-performance|data-reset-performance|data-audio-record-|Export Audio Report|Reset Performance Statistics/);
assert.match(screens, /stopUnifiedDiagnosticRecording\('developer-mode-disabled'\)/);
assert.match(screens, /exportUnifiedDiagnosticReport\(\)/, 'one combined report is exported');
assert.match(state, /developerMode:\s*false/, 'Developer Mode defaults off');
assert.match(audio, /!developerRecordingActive\(\)/, 'audio recording requires an active unified session');
assert.match(audio, /sessionId: audioRecording\.sessionId/);
assert.match(profiler, /performanceProfilerEnabled = developerRecordingActive/);
assert.match(profiler, /completeSessionStatistics/);
assert.match(profiler, /detailedFramesTruncated/);
assert.match(main, /setPerformanceProfilerEnabled\(false\)/, 'boot does not enable monitoring from the saved master toggle');
assert.doesNotMatch(main, /setPerformanceProfilerEnabled\(G\.settings\.developerMode\)/);
assert.match(main, /console\.error\(err\)/, 'normal console error reporting remains active regardless of recording');
assert.match(unified, /startAudioDiagnosticRecording\(\{ sessionId: session\.id \}\)/);
assert.match(unified, /performance:\s*\{ sessionId: session\.sessionId/);
assert.match(unified, /audio:\s*\{ sessionId: session\.sessionId/);
assert.match(unified, /timeline:/);
assert.match(unified, /gitCommitId:/);
assert.match(unified, /entitiesAndLifecycle:/);
assert.match(unified, /aiCollisionPathfinding:/);
assert.match(unified, /browserLongTasks:/);
assert.match(session, /EVENT_LIMIT = 5000/);
assert.match(session, /IMPORTANT_LIMIT = 1500/);
assert.match(session, /detailedEventsDropped/);
console.log('Unified Developer Mode controls, lifecycle, session IDs, and bounded reports passed.');
