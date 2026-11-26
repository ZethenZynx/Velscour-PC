import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const audioMarkup = source.slice(source.indexOf('function audioSettingsMarkup'), source.indexOf('function unifiedDiagnosticsMarkup'));
const diagnosticsMarkup = source.slice(source.indexOf('function unifiedDiagnosticsMarkup'), source.indexOf('export function settingsDialog'));
const developerPane = source.slice(source.indexOf('data-pane="developer"'), source.indexOf('data-pane="mouseCursor"'));
const recorderMarkup = source.slice(source.indexOf('function unifiedDiagnosticsMarkup'), source.indexOf('export function settingsDialog'));

test('ordinary audio controls remain separate from developer recording controls', () => {
  assert.doesNotMatch(audioMarkup, /Diagnostic|data-unified-record-/);
  assert.match(developerPane, /Enable Developer Mode/);
  assert.equal((diagnosticsMarkup.match(/data-unified-record-start/g) || []).length, 1);
  assert.match(diagnosticsMarkup, /data-unified-record-export/);
  assert.match(diagnosticsMarkup, /data-unified-marker-add/);
});

test('Developer pane exposes one unified recorder and no duplicate report/reset controls', () => {
  assert.equal((developerPane.match(/data-developer-mode/g) || []).length, 1);
  assert.doesNotMatch(developerPane, /data-developer-section|Export Performance Report|Export Audio Report|Reset Performance Statistics|data-export-performance|data-audio-record-/);
  for (const action of ['start', 'stop', 'clear', 'export']) assert.match(recorderMarkup, new RegExp(`data-unified-record-${action}`));
});
