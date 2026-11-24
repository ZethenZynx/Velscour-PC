import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const audioMarkup = source.slice(source.indexOf('function audioSettingsMarkup'), source.indexOf('function audioDiagnosticsMarkup'));
const audioDiagnosticsMarkup = source.slice(source.indexOf('function audioDiagnosticsMarkup'), source.indexOf('export function settingsDialog'));
const developerPane = source.slice(source.indexOf('data-pane="developer"'), source.indexOf('data-pane="mouseCursor"'));

test('diagnostic settings live in a single collapsible Developer section, not Audio', () => {
  assert.doesNotMatch(audioMarkup, /Audio Diagnostics|data-audio-record-/);
  assert.match(developerPane, /data-developer-section="audio"[^>]*><summary>Audio Diagnostics<\/summary>/);
  assert.equal((audioDiagnosticsMarkup.match(/data-audio-record-start/g) || []).length, 1);
});

test('Developer exposes the requested diagnostic categories without duplicate controls', () => {
  for (const label of [
    'Performance Diagnostics', 'Audio Diagnostics', 'Rendering Diagnostics', 'Entity Diagnostics',
    'Memory Diagnostics', 'Debugging &amp; Error Logging', 'Other Developer Tools',
  ]) assert.ok(developerPane.includes(`<summary>${label}</summary>`), `missing ${label} section`);
  assert.equal((developerPane.match(/data-developer-profiler/g) || []).length, 1);
  assert.equal((developerPane.match(/data-developer-chat-debug/g) || []).length, 1);
});
