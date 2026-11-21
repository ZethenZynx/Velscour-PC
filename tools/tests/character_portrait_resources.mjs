// Node-only regression checks for portrait resource selection and class-specific maxima.
//   node tools/tests/character_portrait_resources.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CharacterPortrait, portraitResource } from '../../src/ui/characterportrait.js';
import { G } from '../../src/state.js';

assert.deepEqual(portraitResource({ classId: 'barbarian' }, { rage: 62 }), {
  kind: 'rage', label: 'Rage', current: 62, max: 100,
});
assert.deepEqual(portraitResource({ classId: 'barbarian' }, { rage: 140 }), {
  kind: 'rage', label: 'Rage', current: 100, max: 100,
});
assert.deepEqual(portraitResource({ classId: 'rogue' }, { st: { talents: {} } }), {
  kind: 'combo', label: 'Combo', current: 0, max: 5,
});
assert.deepEqual(portraitResource({ classId: 'rogue' }, { rogue: { cp: 6 }, st: { talents: { deeper_stratagem: true } } }), {
  kind: 'combo', label: 'Combo', current: 6, max: 6,
});
assert.equal(portraitResource({ classId: 'wizard' }, {}), null, 'classes without an extra resource should have no third bar');
assert.equal(portraitResource(null, {}), null);

// Exercise the actual UI updater: classes with an extra resource must unhide the
// third row at zero, and switching to a class without one must hide it again.
const selectors = [
  '[data-portrait-name]', '[data-portrait-level]', '[data-portrait-health-fill]', '[data-portrait-health-text]',
  '[data-portrait-mana-fill]', '[data-portrait-mana-text]', '[data-portrait-resource]',
  '[data-portrait-resource-fill]', '[data-portrait-resource-text]',
];
const nodes = Object.fromEntries(selectors.map((key) => [key, { style: {}, textContent: '', className: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }]));
const root = { classList: { contains: () => false }, querySelector: (key) => nodes[key] };
CharacterPortrait.root = root;
CharacterPortrait.artCanvas = null;
CharacterPortrait.lastArtKey = JSON.stringify(['barbarian', null, null, false]);
CharacterPortrait.artRetryAt = Infinity;
CharacterPortrait.lastVitalsRoot = null;
CharacterPortrait.lastVitals = 'stale prior-root cache';
G.char = { classId: 'barbarian', name: 'Test', level: 1, equip: {} };
G.player = { hp: 50, maxHp: 100, mana: 20, maxMana: 40, rage: 0, classId: 'barbarian' };
G.time = 0;
CharacterPortrait.update();
assert.equal(nodes['[data-portrait-resource]'].className, 'character-portrait-meter rage', 'Barbarian Rage row should be visible at zero');
assert.equal(nodes['[data-portrait-resource-text]'].textContent, 'Rage 0 / 100');
assert.equal(nodes['[data-portrait-resource-fill]'].style.width, '0%');
G.char = { classId: 'wizard', name: 'Test', level: 1, equip: {} };
G.player = { hp: 50, maxHp: 100, mana: 20, maxMana: 40, classId: 'wizard' };
CharacterPortrait.lastArtKey = JSON.stringify(['wizard', null, null, false]);
CharacterPortrait.update();
assert.equal(nodes['[data-portrait-resource]'].className, 'character-portrait-meter hidden', 'classes without an extra resource should hide the third row');

const css = fs.readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
assert.match(css, /\.character-portrait-content\s*\{[^}]*align-items:\s*stretch/s, 'portrait content should align the bars to the art top');
assert.match(css, /\.character-portrait-vitals\s*\{[^}]*justify-content:\s*flex-start/s, 'vitals should begin at the top of their column');
assert.match(css, /\.character-portrait-meter\s*\{[^}]*width:\s*100%[^}]*height:/s, 'resource bars should share full column width and height rules');

console.log('Character portrait checks passed (top alignment, equal bars, zero-value resources, and classes without extra resources).');
