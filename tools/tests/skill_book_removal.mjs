import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [html, inputSource, gameSource, skillSource, hudSource, css, readme, assetBuilder, ringTest] = await Promise.all([
  read('../../index.html'), read('../../src/core/input.js'), read('../../src/game/game.js'), read('../../src/ui/skills.js'),
  read('../../src/ui/hud.js'), read('../../css/style.css'), read('../../README.md'), read('../process_assets.py'), read('./rings.js'),
]);
assert.doesNotMatch(html, /data-act="book"|btn_book/i, 'HUD has no Skill Book button or icon');
assert.doesNotMatch(inputSource, /id:\s*['"]spellbook['"]|defaultKey:\s*['"]KeyB['"]/, 'Skill Book shortcut is absent from configurable key bindings');
assert.doesNotMatch(gameSource, /toggleBook|renderBook|consume\(['"]KeyB['"]\)|case ['"]book['"]/, 'game has no Skill Book window action');
assert.doesNotMatch(skillSource, /renderBook|toggleBook|book-list|book-item|Skill Book/i, 'skill UI module contains only Skill Tree functionality');
assert.match(skillSource, /export function renderTree/);
assert.match(skillSource, /UI\.tip\(node, \(\) => skillTooltip\(sk\)/, 'Skill Tree retains full ability tooltips');
assert.match(skillSource, /makeDrag\(node, sk\)/, 'Skill Tree retains drag-to-hotbar assignment');
assert.match(skillSource, /Next level: \$\{nd\[0\]\}[\-–]\$\{nd\[1\]\} damage/, 'Skill Tree retains next-rank damage information');
assert.match(skillSource, /Cooldown:/, 'Skill Tree retains effective cooldown information');
assert.doesNotMatch(hudSource, /Skill Book|\(B\)/, 'hotbar help points to current Skill Tree assignment');
assert.doesNotMatch(css, /\.book-list|\.book-item/, 'book-only styles are removed');
assert.match(css, /body\.touch\.portrait #hud-buttons[^\n]*grid-template-rows:\s*repeat\(3, 34px\)/, 'portrait HUD menu buttons no longer reserve an empty fourth row');
assert.doesNotMatch(readme, /Skill Book|\bB\s*\/\s*Q\b/i, 'player documentation has no Skill Book references');
assert.doesNotMatch(assetBuilder, /"book"|btn_book/, 'asset generation no longer emits the removed icon');
assert.match(ringTest, /rings_skill_tree/, 'mastery regression now exercises the Skill Tree');
await assert.rejects(access(new URL('../../assets/ui/btn_book.webp', import.meta.url), constants.F_OK), 'book-only generated art is removed');

const persisted = {
  keybinds: { spellbook: 'KeyN', skillTree: 'KeyK' },
  panelPositions: { book: { x: 0.2, y: 0.3 }, character: { x: 0.6, y: 0.2 } },
  tabMapTransparency: 63,
};
let saved = '';
globalThis.localStorage = {
  getItem: () => JSON.stringify(persisted),
  setItem: (_key, value) => { saved = value; },
};
const { G, loadSettings } = await import('../../src/state.js');
const { KEY_BINDING_ACTIONS, getKeyBinding } = await import('../../src/core/input.js');
loadSettings();
assert.ok(!KEY_BINDING_ACTIONS.some(({ id }) => id === 'spellbook'));
assert.equal(getKeyBinding('skillTree'), 'KeyK');
assert.ok(!Object.hasOwn(G.settings.keybinds, 'spellbook'), 'legacy shortcut is removed');
assert.ok(!Object.hasOwn(G.settings.panelPositions, 'book'), 'legacy window position is removed');
assert.deepEqual(G.settings.panelPositions.character, persisted.panelPositions.character, 'other saved window positions remain intact');
assert.equal(G.settings.tabMapTransparency, 63, 'unrelated saved settings remain intact');
const migrated = JSON.parse(saved);
assert.ok(!Object.hasOwn(migrated.keybinds, 'spellbook') && !Object.hasOwn(migrated.panelPositions, 'book'), 'migration persists the cleanup');

console.log('Skill Book removal regression passed: UI, shortcut, saved settings migration, Skill Tree tooltips/dragging, styles, and icon cleanup.');
