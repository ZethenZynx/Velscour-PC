// Non-browser regression coverage for the dedicated chest mimic art and safe one-shot spawn.
// Run: node tools/tests/mimic_enemy.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TileMap } from '../../src/world/map.js';
import { findMimicSpawn } from '../../src/game/mimic.mjs';
import { ART_BY_ID, BESTIARY } from '../../src/data/bestiary.js';
import { makeMonster } from '../../src/game/monster.js';

const [game, artSource, artMeta, sprite] = await Promise.all([
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/data/bestiary.js', import.meta.url), 'utf8'),
  readFile(new URL('../../assets/sprites/enemies/enemies.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../../assets/sprites/enemies/mimic.webp', import.meta.url)),
]);

assert.match(artSource, /MIMIC_ART\s*=\s*\{\s*id:\s*'chest_mimic'/);
assert.match(artSource, /\.\.\.REPLACEMENT_ART, MIMIC_ART/);
assert.ok(ART_BY_ID.chest_mimic, 'the dedicated look is available to the shared enemy renderer');
assert.ok(!BESTIARY.some((entry) => entry.id === 'chest_mimic'), 'the Mimic does not enter ordinary random enemy rolls');
assert.doesNotMatch(artSource.slice(artSource.indexOf('export const BESTIARY'), artSource.indexOf('import { REPLACEMENT_ART')), /chest_mimic/,
  'the dedicated encounter look is not added to ordinary random enemy pools');
assert.deepEqual(artMeta['special/mimic'].file, 'mimic.webp');
assert.equal(artMeta['special/mimic'].cells.length, 1);
assert.equal(sprite.toString('ascii', 0, 4), 'RIFF');
assert.equal(sprite.toString('ascii', 8, 12), 'WEBP');

// The art override must leave the existing champion stat/scaling pipeline intact.
const originalRandom = Math.random;
try {
  Math.random = () => 0.41;
  for (const depth of [1, 25, 100, 250, 500, 1000]) {
    const biome = { id: 'catacombs', el: 'phys' };
    const world = { depth, biome, dungeonAffixes: [] };
    const mimicLook = makeMonster(world, 'beetle', biome, depth, 'champion', 10, 10, 0, { art: 'chest_mimic', swap: null });
    const ordinaryLook = makeMonster(world, 'beetle', biome, depth, 'champion', 10, 10, 0, { art: 'powder_keg', swap: null });
    assert.equal(mimicLook.rank, 'champion');
    assert.equal(mimicLook.art, 'chest_mimic');
    assert.equal(mimicLook.maxHp, ordinaryLook.maxHp, `champion health scaling remains unchanged at depth ${depth}`);
    assert.equal(mimicLook.dmg, ordinaryLook.dmg, `champion damage scaling remains unchanged at depth ${depth}`);
    assert.equal(mimicLook.xp, ordinaryLook.xp, `champion reward scaling remains unchanged at depth ${depth}`);
    assert.deepEqual(mimicLook.affixes, ordinaryLook.affixes, `champion abilities/affixes remain unchanged at depth ${depth}`);
  }
} finally {
  Math.random = originalRandom;
}

const map = new TileMap(12, 8);
map.t.fill(1);
const player = { x: 2.5, y: 3.5, r: 0.22, isPlayer: true };
const mimic = { x: 3.5, y: 3.5, r: 0.42 };
const pos = findMimicSpawn(map, mimic, [player], 3.5, 3.5);
assert.ok(pos, 'a nearby clear floor tile provides a safe spawn');
assert.ok(map.positionFree(mimic, pos.x, pos.y), 'spawn point clears terrain using the mimic body radius');
assert.ok(Math.hypot(pos.x - player.x, pos.y - player.y) >= 0.42 + 0.22 + 0.12,
  'the mimic does not spawn inside the player collision space');
assert.ok(map.movementCanReach([player.x, player.y], [pos.x, pos.y], 0.42),
  'the mimic spawns in the same walkable component as the player');

// A solid barrier cannot be crossed to choose an otherwise open spawn tile.
const divided = new TileMap(8, 8);
divided.t.fill(1);
for (let y = 0; y < divided.h; y++) divided.block[y * divided.w + 4] = 1;
const leftPlayer = { x: 2.5, y: 3.5, r: 0.22, isPlayer: true };
const leftMimic = { x: 3.5, y: 3.5, r: 0.42 };
const safeLeft = findMimicSpawn(divided, leftMimic, [leftPlayer], 3.5, 3.5);
assert.ok(safeLeft && safeLeft.x < 4, 'spawn selection stays on the reachable side of a wall');
assert.ok(divided.movementCanReach([leftPlayer.x, leftPlayer.y], [safeLeft.x, safeLeft.y], 0.42));

// A cramped chest location falls back safely instead of overlapping the hero.
const cramped = new TileMap(2, 2);
cramped.t.fill(0);
cramped.t[0] = 1;
const crowdedPlayer = { x: 0.5, y: 0.5, r: 0.22, isPlayer: true };
assert.equal(findMimicSpawn(cramped, { r: 0.42 }, [crowdedPlayer], 0.5, 0.5), null);

const useStart = game.indexOf("if (this.chestType === 'mimic') {");
const useEnd = game.indexOf("if (this.chestType === 'explosive')", useStart);
const mimicUse = game.slice(useStart, useEnd);
assert.match(mimicUse, /depthLevel\(depth\), 'champion', this\.x, this\.y, 0,\s*\{ art: 'chest_mimic', swap: null \}\)/,
  'the existing champion rank/stat path is retained while only its art changes');
assert.match(game, /use\(\) \{\n\s+if \(this\.opened\) return/,
  'opened chests reject repeat interactions');
assert.match(mimicUse, /world\.chests\.splice\(chestIndex, 1\)/,
  'the opened chest object is removed only when the mimic can spawn');
assert.match(mimicUse, /mimic\.awake = true/);
assert.match(mimicUse, /mimic\.onDeath = \(\) =>/);
assert.match(mimicUse, /dropChest\(world, rewardChest, depth\)/,
  'the existing reward chest is preserved for the mimic death reward');
assert.match(mimicUse, /new Ring\(/, 'the reveal has a brief transformation pulse');
assert.match(mimicUse, /sfx\('boss'\)/, 'existing reveal audio is retained');

console.log('Mimic art registration, collision-safe placement, reachability, one-time transformation, and rewards passed.');
