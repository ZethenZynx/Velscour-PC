// Node-only checks for the global photosensitivity warning preference.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setSkipSeizureWarning, shouldShowSeizureWarning } from '../../src/ui/seizurewarning.mjs';
import { G, loadSettings, saveSettings, SETTINGS_KEY } from '../../src/state.js';

const settings = {};
assert.equal(shouldShowSeizureWarning(settings), true, 'the warning is shown by default');
setSkipSeizureWarning(settings, true);
assert.equal(shouldShowSeizureWarning(settings), false, 'checked preference bypasses warning');
setSkipSeizureWarning(settings, false);
assert.equal(shouldShowSeizureWarning(settings), true, 'settings can re-enable the warning');

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
setSkipSeizureWarning(G.settings, true);
saveSettings();
assert.ok(storage.has(SETTINGS_KEY), 'the preference is stored with global UI settings');
setSkipSeizureWarning(G.settings, false);
loadSettings();
assert.equal(G.settings.skipSeizureWarning, true, 'the preference restores after a fresh settings load');

const screens = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
const title = await readFile(new URL('../../src/ui/titlefx.js', import.meta.url), 'utf8');
const state = await readFile(new URL('../../src/state.js', import.meta.url), 'utf8');
assert.match(screens, /id="seizure-skip-warning-checkbox"/);
assert.match(screens, /Don't show this warning again/);
assert.match(screens, /setSkipSeizureWarning\(G\.settings, skipWarningCheckbox\?\.checked\)/);
assert.match(screens, /data-k="skipSeizureWarning"/);
assert.match(title, /shouldShowSeizureWarning\(G\.settings\)/);
assert.match(state, /skipSeizureWarning: false/);
console.log('Photosensitivity warning preference checks passed.');
