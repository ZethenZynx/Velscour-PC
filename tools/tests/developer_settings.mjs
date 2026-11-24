import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [screens, state, chat, profiler, css] = await Promise.all([
  readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/state.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/chat.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/perfdiagnostics.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
]);

const settings = screens.slice(screens.indexOf('export function settingsDialog()'), screens.indexOf('/** Shared item type'));
assert.match(settings, /data-tab="controls"[\s\S]*data-tab="developer"/, 'Developer is the final Settings tab');
assert.match(settings, /data-pane="developer"[\s\S]*WARNING — DEVELOPER SETTINGS[\s\S]*Leave these options disabled during regular gameplay/, 'Developer tab has the prominent warning and usage guidance');
assert.match(settings, /data-developer-profiler/, 'profiler toggle is in Developer settings');
assert.doesNotMatch(settings.match(/data-pane="graphics"[\s\S]*?<\/div>\s*<div class="settings-tab-pane" data-pane="controls"/)?.[0] || '', /Performance profiler|data-export-performance/, 'profiler controls are absent from Graphics');
assert.match(settings, /data-export-performance/, 'performance report export remains available');
assert.match(settings, /data-reset-performance/, 'performance statistics reset remains available');
assert.match(settings, /UI\.confirm\('Enable Performance Profiler\?'/, 'enabling performance collection requires confirmation');
assert.match(settings, /UI\.confirm\('Enable Debug Event Logging\?'/, 'enabling verbose diagnostic logging requires confirmation');
assert.match(settings, /UI\.confirm\('Reset Developer Settings\?'/, 'developer reset requires confirmation');
assert.match(settings, /GameChat\.setDebugEnabled\(false\)/, 'reset disables debug event logging');
assert.match(settings, /!\['general',[^\]]*'developer'\]\.includes\(activeSettingsTab\)/, 'Developer tab selection persists across opening Settings');
assert.match(state, /performanceProfiler:\s*false/, 'the profiler is disabled by default');
assert.match(chat, /debug:false/, 'verbose chat diagnostics are disabled by default');
assert.match(chat, /setDebugEnabled\(enabled\)/, 'debug logging retains its persistence/update path');
assert.match(chat, /Debug event logging is managed from Settings &gt; Developer/, 'duplicate debug toggle was removed from journal settings');
assert.doesNotMatch(chat, /Enable Debug tab|data-debug/, 'journal no longer exposes a duplicate debug preference');
assert.match(profiler, /if \(!performanceProfilerEnabled\(\)\) return false;/, 'performance history reset does no work while profiling is disabled');
assert.match(profiler, /row\.environment = history\.environments\[at\]/, 'reports include environment context for each frame');
assert.match(profiler, /row\.depth = history\.depths\[at\]/, 'reports include depth context for each frame');
assert.doesNotMatch(profiler, /data-pd-export/, 'report export is only available from Developer settings');
assert.match(css, /\.developer-warning[^\{]*\{[^}]*#e2a33a/s, 'developer warning has amber styling');
console.log('Developer settings placement, warnings, persistence, opt-in diagnostics, and reset checks passed.');
