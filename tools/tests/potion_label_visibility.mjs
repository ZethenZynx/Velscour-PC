import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changePotionCount, potionCapacity, potionLabelCanCollect, setPotionCounts } from '../../src/game/potionpurchase.js';

const kinds = ['hp', 'mp', 'rejuv', 'fury'];
const character = { potions: { hp: 0, mp: 0, rejuv: 0, fury: 0 } };
assert.deepEqual(kinds.map((kind) => potionLabelCanCollect(character, kind)), [true, true, true, true]);
assert.equal(potionCapacity(character, 'hp'), 30, 'the current game capacity is read from the shared belt rule');

setPotionCounts(character, { hp: 30 });
assert.equal(potionLabelCanCollect(character, 'hp'), false, 'full health potion labels are suppressed');
assert.equal(potionLabelCanCollect(character, 'mp'), true, 'health capacity does not suppress mana potion labels');
changePotionCount(character, 'hp', -1);
assert.equal(potionLabelCanCollect(character, 'hp'), true, 'consuming a potion restores its label eligibility');
setPotionCounts(character, { mp: 30, rejuv: 30 });
assert.equal(potionLabelCanCollect(character, 'mp'), false);
assert.equal(potionLabelCanCollect(character, 'rejuv'), false);
assert.equal(potionLabelCanCollect(character, 'fury'), true);
setPotionCounts(character, { hp: 30, fury: 30 });
assert.deepEqual(kinds.map((kind) => potionLabelCanCollect(character, kind)), [false, false, false, false]);
setPotionCounts(character, { hp: 31 });
assert.equal(potionLabelCanCollect(character, 'hp'), false, 'legacy or bonus-granted over-cap counts stay hidden');
const otherCharacter = { potions: { hp: 0, mp: 0, rejuv: 0, fury: 0 } };
assert.equal(potionLabelCanCollect(otherCharacter, 'hp'), true, 'availability is isolated per character');

const loot = await readFile(new URL('../../src/game/loot.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8');
const vendor = await readFile(new URL('../../src/ui/vendor.js', import.meta.url), 'utf8');
const encounters = await readFile(new URL('../../src/game/encounters.js', import.meta.url), 'utf8');
const happenings = await readFile(new URL('../../src/game/happenings.js', import.meta.url), 'utf8');
const save = await readFile(new URL('../../src/game/save.js', import.meta.url), 'utf8');
const render = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
assert.match(loot, /_potionLabelSuppressedForCapacity = !potionLabelCanCollect/);
assert.match(loot, /if \(l\._potionLabelSuppressedForCapacity\) \{[\s\S]*?continue;/, 'only label drawing is skipped while the silent hitbox remains');
assert.match(loot, /draw\(ctx\)[\s\S]*?const img = this\.icon\(\)/, 'the ground potion sprite rendering path remains intact');
assert.match(player, /changePotionCount\(c, g\.item\.kind, 1\)/);
assert.match(player, /changePotionCount\(c, kind, -1\)/);
assert.match(vendor, /potionCapacity\(c, kind\)/);
assert.match(encounters, /changePotionCount\(c, id, 1\)/);
assert.match(happenings, /changePotionCount\(c, 'hp', 3\)/);
assert.match(save, /setPotionCounts\(c, c\.potions\)/, 'loading saved counts invalidates cached availability');
assert.match(player, /invalidatePotionAvailability\(c\)/, 'equipment/stat recomputes invalidate capacity eligibility');
assert.match(render, /G\.lootBoxes = drawLootLabels\(ctx, world/, 'the shared renderer applies this label rule in every mode');

console.log('Potion ground-label capacity, per-type updates, count mutation hooks, and sprite preservation checks passed.');
