import assert from 'node:assert/strict';

let stored = { gore: 0 };
globalThis.localStorage = {
  getItem: () => JSON.stringify(stored),
  setItem: (_key, value) => { stored = JSON.parse(value); },
};
const { G, loadSettings, saveSettings } = await import('../../src/state.js');

assert.equal(G.settings.gore, 3, 'new players default to Bloody');
loadSettings();
assert.equal(G.settings.gore, 0, 'legacy Off stays Off');
assert.equal(G.settings.gorePresetVersion, 2);
stored = { gore: 1 };
loadSettings();
assert.equal(G.settings.gore, 3, 'legacy Bloody becomes the Bloody preset');
stored = { gore: 2 };
loadSettings();
assert.equal(G.settings.gore, 5, 'legacy Extreme becomes the Extreme preset');
stored = { gore: 6, gorePresetVersion: 2, goreCustomEnabled: true, goreCustomLimit: 321 };
loadSettings();
assert.equal(G.settings.gore, 6, 'versioned presets load without remapping');
assert.equal(G.settings.goreCustomEnabled, true);
assert.equal(G.settings.goreCustomLimit, 321);
saveSettings();
assert.equal(stored.gore, 6, 'preset changes remain in the existing settings store');
assert.equal(stored.goreCustomLimit, 321);

console.log('Gore settings migration and persistence checks passed.');
