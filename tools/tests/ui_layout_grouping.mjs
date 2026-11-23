// Headless regression checks for the grouped HUD layout migration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activeLayoutMap, effectiveLayoutEntry, migrateGroupedHudLayout, normalizeLayoutEntry, normalizeLayoutState,
} from '../../src/ui/ui-layout.mjs';

const normalized = normalizeLayoutEntry({ anchor: 'center', attachment: 'detached', scale: 135 });
assert.equal(normalized.anchor, 'center');
assert.equal(normalized.attachment, 'detached');
assert.equal(normalized.scale, 135);
assert.equal(normalizeLayoutEntry({ anchor: 'diagonal', attachment: 'loose' }).anchor, 'left');
assert.equal(normalizeLayoutEntry({ anchor: 'diagonal', attachment: 'loose' }).attachment, 'attached');

const state = normalizeLayoutState({
  activeProfile: 'default',
  profiles: {
    default: {
      layouts: {
        'ability-hotbar': { x: 0.43, y: 0.82, scale: 120 },
        experience: { x: 0.5, y: 0.91 },
        health: { x: 0.12, y: 0.68, scale: 90 },
        'mana-value': { x: 0.74, y: 0.69 },
        'buff-icons': { anchor: 'right' },
      },
      characterOverrides: {
        hero: { 'ability-hotbar': { x: 0.51, y: 0.85 }, mana: { x: 0.8, y: 0.7 } },
      },
    },
  },
});
assert.equal(migrateGroupedHudLayout(state), true);
const global = activeLayoutMap(state);
assert.deepEqual([global['main-action-bar'].x, global['main-action-bar'].y, global['main-action-bar'].scale], [0.43, 0.82, 120]);
assert.equal(global['health-orb'].attachment, 'detached', 'legacy independent orb layout should stay independently placed');
assert.equal(global['mana-orb'].attachment, 'detached');
assert.equal(global['buff-icons'].anchor, 'right');
const character = state.profiles.default.characterOverrides.hero;
assert.equal(character['main-action-bar'].x, 0.51);
assert.equal(character['mana-orb'].attachment, 'detached');
state.characterSpecific = true;
assert.equal(effectiveLayoutEntry(state, 'main-action-bar', 'hero').x, 0.51, 'migrated grouped character positions remain applied');
assert.equal(effectiveLayoutEntry(state, 'main-action-bar', 'hero').scale, 120, 'grouped character layouts inherit account-wide scale');
assert.equal(effectiveLayoutEntry(state, 'mana-orb', 'hero').x, 0.8, 'migrated detached-orb position remains a character override');
assert.equal(effectiveLayoutEntry(state, 'mana-orb', 'hero').attachment, 'detached', 'migrated detached-orb state remains explicit');
assert.equal(migrateGroupedHudLayout(state), false, 'migration must be idempotent');

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
for (const [group, content, next] of [
  ['life-orb-group', ['life-cover', 'life-text'], 'mana-orb-group'],
  ['mana-orb-group', ['mana-cover', 'mana-text'], 'xp-text'],
]) {
  const start = html.indexOf(`id="${group}"`), end = html.indexOf(`id="${next}"`, start);
  assert.ok(start >= 0 && end > start, `${group} should exist in the HUD`);
  const markup = html.slice(start, end);
  for (const id of content) assert.ok(markup.includes(`id="${id}"`), `${id} should stay inside ${group}`);
}
assert.match(html, /id="hud-bar"[\s\S]*id="xp-track"[\s\S]*id="hud-img"[\s\S]*id="life-orb-group"[\s\S]*id="mana-orb-group"[\s\S]*id="xp-text"[\s\S]*id="hud-slots"/,
  'the Main Action Bar parent should contain its artwork, experience UI, orb groups and slots');

console.log('Grouped HUD layout migration checks passed.');
