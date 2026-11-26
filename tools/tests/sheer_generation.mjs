import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { BIOME_BY_ID, BIOMES, CAMPAIGN_ENVIRONMENT_ROTATIONS, biomesForDepth, campaignBiomeForDepth } from '../../src/data/biomes.js';
import { SHEER } from '../../src/data/sheer.js';
import { generateDungeon } from '../../src/world/dungeon.js';
import { TileMap } from '../../src/world/map.js';
import { sheerUpdate } from '../../src/game/sheer.js';
import { drawAbyss, drawSheerTiles } from '../../src/gfx/sheer.js';
import '../../src/core/assets.js';
import '../../src/core/audio.js';
import '../../src/game/creature.js';
import '../../src/game/hazards.js';
import '../../src/game/monster.js';
import '../../src/game/render.js';
import '../../src/game/world.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sheerIds = SHEER.map((v) => v.id);
const tileset = {
  bases: [0], features: [], floors: [{ name: 'test stone', lum: 0.5 }], families: ['test'],
  scatter: [], k: 1, pack: 'catacombs', arches: [], archSpan: {}, doors: [],
};

function assertGenerated(gen, id, label = id) {
  const { map, start, exit, spawns = [], props = [] } = gen;
  assert.equal(map.sheer.id, id, `${label}: cliff metadata attached to generated map`);
  assert.equal(map.walls.length, 0, `${label}: enclosed wall segments are omitted`);
  assert.ok(gen.accessibility?.validated, `${label}: generator ran movement accessibility validation`);
  const reachable = map.movementReachable(start, 0.24);
  assert.ok(map.movementCanReach(start, exit, 0.24, reachable), `${label}: exit is reachable by walking`);
  for (const spawn of spawns) {
    assert.ok(map.circleFree(spawn.x, spawn.y, 0.42), `${label}: ${spawn.rank} spawn fits its full collision radius`);
  }
  for (const prop of props) {
    assert.ok(map.isFloor(prop.x, prop.y), `${label}: prop is placed on floor`);
  }
}

test('all Sheer Drops are registered in endgame, excluded from campaign, and included in Rift eligibility', () => {
  assert.equal(sheerIds.length, 10);
  const endgame = biomesForDepth(101);
  const rift = BIOMES.filter((b) => !b.overworld && !b.beta && !b.challenge && !b.tower && !b.cave && b.id !== 'throne');
  for (const v of SHEER) {
    assert.ok(BIOME_BY_ID[v.id], `${v.id}: biome registry entry exists`);
    assert.equal(BIOME_BY_ID[v.id].act, v.act, `${v.id}: intended act identity is retained`);
    assert.ok(endgame.includes(v.id), `${v.id}: Infinite Endgame pool`);
    assert.ok(rift.some((b) => b.id === v.id), `${v.id}: Abyssal Rift candidate pool`);
    assert.notEqual(campaignBiomeForDepth(v.act * 25), v.id, `${v.id}: not added to act rotation`);
  }
  assert.ok(Object.values(CAMPAIGN_ENVIRONMENT_ROTATIONS).flat().every((id) => !sheerIds.includes(id)), 'campaign rotations are unchanged');
  assert.equal(new Set(sheerIds).size, 10, 'all ids are unique');
  assert.equal(typeof sheerUpdate, 'function', 'falling lifecycle module imports cleanly');
  assert.equal(typeof drawAbyss, 'function', 'isometric renderer imports cleanly');
  assert.equal(typeof drawSheerTiles, 'function', 'cliff tile renderer imports cleanly');
});

test('all ten maps generate repeatedly for endgame and small Rift layouts', () => {
  for (const [mode, options, count] of [
    ['endgame', {}, 12],
    ['rift', { rift: true, raid: true, small: true }, 4],
  ]) {
    for (const id of sheerIds) {
      const biome = BIOME_BY_ID[id];
      for (let seed = 1; seed <= count; seed++) {
        const gen = generateDungeon(101, biome, tileset, seed * 7919, options);
        assertGenerated(gen, id, `${id} (${mode} seed ${seed})`);
      }
    }
  }
});

test('ground movement stops at a cliff, while a leap and a flyer can cross a gap safely', () => {
  const map = new TileMap(9, 5);
  map.sheer = { id: 'test' };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (x !== 4) map.t[y * map.w + x] = 1;
  const walker = { x: 3.4, y: 2.5, r: 0.15 };
  map.rememberPosition(walker);
  assert.ok(map.move(walker, 2, 0));
  assert.ok(walker.x < 4 && map.isFloor(walker.x, walker.y), 'grounded movement stops before the gap');
  const dasher = { x: 3.4, y: 3.5, r: 0.15 };
  assert.ok(map.moveDash(dasher, 2, 0) > 0);
  assert.ok(dasher.x < 4 && map.isFloor(dasher.x, dasher.y), 'ordinary Dash remains on reachable floor');

  const leaper = { x: 3.4, y: 2.5, r: 0.15, leaping: true };
  assert.ok(map.leapOk(leaper.x, leaper.y, 5.2, leaper.y, 0.12));
  assert.ok(map.moveStraight(leaper, 1.8, 0));
  assert.ok(leaper.x > 4 && map.isFloor(leaper.x, leaper.y), 'leap lands on reachable floor beyond the gap');

  const flyer = { x: 3.4, y: 1.5, r: 0.15, voidFly: true };
  assert.ok(map.move(flyer, 1.8, 0));
  assert.ok(flyer.x > 4 && map.isFloor(flyer.x, flyer.y), 'flyer crosses the void');
  const knocked = { x: 3.4, y: 4.5, r: 0.15 };
  assert.ok(map.shove(knocked, 1.8, 0));
  assert.ok(knocked.x > 4 && map.isFloor(knocked.x, knocked.y) && knocked._sheerCrossedVoid, 'low-FPS knockback crossing a gap is retained for fall handling');
  const recovered = map.nearestFloor(4.5, 2.5, 0.42, 2);
  assert.ok(recovered && map.circleFree(recovered[0], recovered[1], 0.42), 'fall recovery finds a body-clear floor position');
  const nearby = map.randomNear(4.5, 2.5, 1, () => 0.5);
  assert.ok(map.circleFree(nearby[0], nearby[1], 0.42), 'new spawns near a brink retain full body clearance');
  assert.equal(map.solid(4.5, 2.5), false, 'void does not block ordinary projectiles');
  assert.equal(map.rayLength(3.4, 2.5, 0, 3), 3, 'projectiles can cross the open gap');
});

test('solid terrain blocks flying, leaping and projectiles', () => {
  const map = new TileMap(9, 5);
  map.sheer = { id: 'test' };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) map.t[y * map.w + x] = 1;
  map.block[2 * map.w + 4] = 1;
  const flyer = { x: 3.4, y: 2.5, r: 0.15, voidFly: true };
  assert.ok(map.move(flyer, 2, 0));
  assert.ok(flyer.x < 4, 'full collision radius stops flyer before a solid prop');
  assert.equal(map.leapOk(3.4, 2.5, 4.6, 2.5, 0.12), false, 'leap cannot pass through a solid prop');
  assert.equal(map.solid(4.5, 2.5), true, 'solid prop blocks projectiles');
  assert.ok(map.rayLength(3.4, 2.5, 0, 3) < 0.7, 'ray ends before solid terrain');
});

test('all twenty Sheer Drop art files exist and have WebP headers', async () => {
  for (const v of SHEER) for (const dir of ['assets/source/sheer', 'assets/tiles/sheer']) {
    const path = resolve(root, dir, `${v.tex}.webp`);
    const [info, bytes] = await Promise.all([stat(path), readFile(path)]);
    assert.ok(info.size > 1000, `${path}: non-empty artwork`);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${path}: RIFF header`);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${path}: WebP image`);
  }
});
