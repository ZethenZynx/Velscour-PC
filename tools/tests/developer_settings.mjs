import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [screens, state, chat, profiler, render, game, css, audio] = await Promise.all([
  readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/state.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/chat.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/perfdiagnostics.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
]);

const settings = screens.slice(screens.indexOf('export function settingsDialog()'), screens.indexOf('/** Shared item type'));
assert.match(settings, /data-tab="controls"[\s\S]*data-tab="developer"/, 'Developer is the final Settings tab');
assert.match(settings, /data-pane="developer"[\s\S]*Enable Developer Mode[\s\S]*Developer monitoring can add processing overhead/, 'Developer tab has the master toggle and concise overhead warning');
assert.match(settings, /data-developer-mode/, 'one master Developer Mode toggle is present');
assert.doesNotMatch(settings, /data-developer-profiler|data-developer-chat-debug|data-reset-developer|Rendering Diagnostics|Entity Diagnostics|Memory Diagnostics|Other Developer Tools/, 'redundant diagnostic toggles and empty sections are removed');
assert.doesNotMatch(settings.match(/data-pane="graphics"[\s\S]*?<\/div>\s*<div class="settings-tab-pane" data-pane="controls"/)?.[0] || '', /Performance profiler|data-export-performance/, 'profiler controls are absent from Graphics');
assert.match(settings, /data-export-performance/, 'performance report export remains available');
assert.match(settings, /data-reset-performance/, 'performance statistics reset remains available');
assert.match(settings, /GameChat\.setDebugEnabled\(st\.developerMode\)/, 'master toggle controls debug event logging');
assert.match(settings, /if \(!st\.developerMode\) stopAudioDiagnosticRecording\(\)/, 'disabling Developer Mode stops active audio recording');
assert.match(settings, /data-audio-record-start/, 'audio recording remains manually controlled');
assert.match(screens, /data-audio-record-export/, 'audio reports remain exportable while Developer Mode is off');
assert.match(audio, /if \(!developerModeEnabled\(\) \|\| audioRecording\?\.active\) return false/, 'audio event recording cannot start while Developer Mode is off');
assert.match(settings, /!\['general',[^\]]*'developer'\]\.includes\(activeSettingsTab\)/, 'Developer tab selection persists across opening Settings');
assert.match(state, /developerMode:\s*false/, 'Developer Mode is disabled by default');
assert.match(state, /s\.developerMode === 'boolean' \? s\.developerMode : s\.performanceProfiler === true/, 'legacy profiler preferences migrate to Developer Mode');
assert.match(chat, /debug:false/, 'verbose chat diagnostics are disabled by default');
assert.match(chat, /setDebugEnabled\(enabled\)/, 'debug logging retains its persistence/update path');
assert.match(chat, /Debug event logging is managed from Settings &gt; Developer/, 'duplicate debug toggle was removed from journal settings');
assert.doesNotMatch(chat, /Enable Debug tab|data-debug/, 'journal no longer exposes a duplicate debug preference');
assert.match(profiler, /performanceProfilerEnabled = developerModeEnabled/, 'the profiler uses the master setting');
assert.match(profiler, /Stop monitoring without discarding the report/, 'disabling monitoring preserves collected performance data');
assert.match(profiler, /if \(performanceProfilerEnabled\(\)\) \{ allocateHistory\(\)/, 'reset only restarts monitoring when Developer Mode is enabled');
assert.match(profiler, /row\.environment = history\.environments\[at\]/, 'reports include environment context for each frame');
assert.match(profiler, /row\.depth = history\.depths\[at\]/, 'reports include depth context for each frame');
assert.match(profiler, /row\.resolutionScale = history\.resolutionScale\[at\]/, 'reports include per-frame adaptive resolution');
assert.match(profiler, /renderResolution:/, 'reports include canvas backing-store size');
assert.doesNotMatch(profiler, /data-pd-export/, 'report export is only available from Developer settings');
assert.match(render, /markRenderPhase\('floorDraw'\)/, 'profiler separates floor drawing from other render stages');
assert.match(render, /markRenderPhase\('renderSort'\)/, 'profiler separates visible-entity collection and sorting');
assert.match(render, /markRenderPhase\('depthDraw'\)/, 'profiler separates depth-sorted scene rendering');
assert.match(render, /markRenderPhase\('lighting'\)/, 'profiler isolates lighting work');
assert.match(render, /world\._perfRenderCounts = counts/, 'profiler records visible render queue counts');
assert.match(profiler, /'renderQueue',[\s\S]*'renderViews'/, 'profiler includes visible draw queue and occlusion-view counts');
assert.match(game, /profileRecord\('automap'/, 'profiler separately times the expanded TAB map');
assert.match(css, /\.developer-mode-card[^\{]*\{[^}]*#c28a35/s, 'compact master toggle retains the gold styling');
console.log('Developer Mode consolidation, persistence, retained reports, and manual audio recording checks passed.');
