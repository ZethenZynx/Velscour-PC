import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { G } from '../../src/state.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';

const [gameSource, riftSource, townSource, gameRiftSource] = await Promise.all([
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/rifts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/town.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/rifts.js', import.meta.url), 'utf8'),
]);
const buildRiftSource = gameSource.slice(gameSource.indexOf('buildRift(tier'), gameSource.indexOf('riftDeath(src)'));
assert.match(gameSource, />Abyssal Rifts<\/button>/, 'Portal to the Depths includes an Abyssal Rifts button');
assert.match(gameSource, /if \(canUnbound\) tabRifts\.addEventListener\('click',[\s\S]*?confirmRift\(undefined, \{ backToDepths: true \}\)/,
  'the Rift button observes endgame unlock and opens the existing selector with a return path');
assert.match(gameSource, /confirmRift\(tier, \{ backToDepths = false \} = \{\}\)/, 'direct Rift entry remains supported');
assert.match(gameSource, /Rifts\.open\(tier, \{ onBack: backToDepths \? \(\) => this\.confirmDungeon\(\) : null \}\)/,
  'Back returns to the normal Depths selection');
assert.match(riftSource, /buttons: \[\{ label: onBack \? 'Back' : 'Not yet', fn: onBack \|\| undefined \}/,
  'Rift selection retains its original close button for direct entry and adds Back when entered from Depths');
assert.doesNotMatch(gameSource, /world\.portals\.push\(\{[^\n]*rift: true/, 'Herrington Hollow has no standalone Rift entrance');
assert.doesNotMatch(gameSource, /rift: true,[\s\S]{0,250}use: \(\) => this\.confirmRift\(\)/,
  'Sunscorch Oasis has no standalone Rift entrance');
assert.doesNotMatch(townSource, /const rift = spot|\bportal, breach, rift, altar\b/, 'town generation no longer reserves or exposes a separate Rift entrance spot');
assert.doesNotMatch(buildRiftSource, /type: 'exit'|type: \"exit\"/,
  'Rift generation has no completion exit portal or portal interaction requirement');
assert.match(gameSource, /if \(w\?\.rift\?\.done\) \{ requestRiftReturn\(w, false\); return; \}/,
  'the existing Rift town portal routes completed runs through reward-safety return handling');
assert.doesNotMatch(riftSource, /activateRiftExit|exitPortal/,
  'Rift completion no longer maintains an exit portal or its activation state');
assert.match(gameRiftSource, /R\.timedOut = true[\s\S]*?Defeat the Guardian in overtime/,
  'clock expiry leaves the Guardian encounter available in overtime rather than collapsing the run');

// Exercise the real Rift selector button configuration and its Back callback
// without constructing or launching a browser.
const originalDialog = UI.dialog;
const originalConfirmDungeon = game.confirmDungeon;
let spec, returnedToDepths = false;
const pick = { value: '2', addEventListener() {}, focus() {}, select() {} };
const warn = { innerHTML: '' };
UI.dialog = (options) => {
  spec = options;
  return { box: { querySelector(selector) { return selector === '#rift-pick' ? pick : warn; } } };
};
game.confirmDungeon = () => { returnedToDepths = true; };
G.char = { classId: 'paladin', level: 100, cleared: { 100: true }, rifts: { open: 2, bestTime: {}, cleared: {}, runs: 0, fails: 0, deaths: 0 } };
G.game = game;
try {
  game.confirmRift(2, { backToDepths: true });
  assert.equal(spec.title, 'ABYSSAL RIFT');
  assert.equal(spec.buttons[0].label, 'Back');
  spec.buttons[0].fn();
  assert.equal(returnedToDepths, true, 'Back callback reopens the normal Depths picker');
} finally {
  UI.dialog = originalDialog;
  game.confirmDungeon = originalConfirmDungeon;
  G.char = null;
  G.game = null;
}
console.log('Abyssal Rift town portal consolidation checks passed.');
