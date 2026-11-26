import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const audioMarkup = source.slice(source.indexOf('function audioSettingsMarkup'), source.indexOf('function audioDiagnosticsMarkup'));
const audioDiagnosticsMarkup = source.slice(source.indexOf('function audioDiagnosticsMarkup'), source.indexOf('export function settingsDialog'));
const developerPane = source.slice(source.indexOf('data-pane="developer"'), source.indexOf('data-pane="mouseCursor"'));

test('audio diagnostics remain in Developer, separate from ordinary audio settings', () => {
  assert.doesNotMatch(audioMarkup, /Audio Diagnostics|data-audio-record-/);
  assert.match(developerPane, /data-developer-section="audio"[^>]*><summary>Audio Diagnostics<\/summary>/);
  assert.equal((audioDiagnosticsMarkup.match(/data-audio-record-start/g) || []).length, 1);
});

test('Developer has one master switch and only the two interactive diagnostic sections', () => {
  assert.match(developerPane, /data-developer-mode/);
  assert.match(developerPane, /<summary>Performance Diagnostics<\/summary>/);
  assert.match(developerPane, /<summary>Audio Diagnostics<\/summary>/);
  assert.doesNotMatch(developerPane, /data-developer-profiler|data-developer-chat-debug|data-reset-developer|Rendering Diagnostics|Entity Diagnostics|Memory Diagnostics|Debugging &amp; Error Logging|Other Developer Tools/);
});
