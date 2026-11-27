import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { generateKeep } from '../../src/world/keepworld.js';
import { reachableKeepSpot } from '../../src/game/tessarielskeep.js';
import { KEEP_TABS } from '../../src/ui/keep.js';
import { keepState, sagaList, keepBonuses } from '../../src/game/keep.js';
import { shouldReleaseCastle3D, shouldReleaseTownSheets } from '../../src/game/levelart.mjs';
import { TROPHIES } from '../../src/data/keep.js';
import * as KeepArt from '../../src/gfx/keepart.js';

const { map, start, anchors } = generateKeep();
assert.equal(map.keep, true);
assert.equal(map.c3only, true, 'the original baked isometric architecture remains active');
assert.ok(map.walkable(start[0], start[1]), 'the player arrival point is walkable');
const bakedIndex = JSON.parse(await readFile(new URL('../../assets/tiles/tkeep/index.json', import.meta.url), 'utf8'));
const keepBuilderSource = await readFile(new URL('../../src/game/tessarielskeep.js', import.meta.url), 'utf8');
assert.match(keepBuilderSource, /G\.ui\.keep\s*\?\?=\s*KeepUI/, 'Saga givers and companions open Keep panels through the fork UI');
const renderSource = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
assert.match(renderSource, /pr\.keepDecor\s*&&\s*typeof pr\.fx === 'function'/, "the Keep's rasterized static decorations retain animated candle and brazier effects");
for (const page of bakedIndex.pages) await access(new URL(`../../assets/tiles/tkeep/${page}`, import.meta.url));
await access(new URL('../../assets/tiles/tkeep/brazier_front.json', import.meta.url));
for (const name of ['drawBrazierFront', 'drawCandle', 'drawFire', 'chandelierSprite', 'ghostSprite'])
  assert.equal(typeof KeepArt[name], 'function', `the upstream Keep artwork export ${name} is available`);

const occupied = [];
const place = (label, point) => {
  const at = reachableKeepSpot(map, start, point, occupied);
  assert.ok(at, `${label} has a reachable interaction position`);
  assert.ok(map.circleFree(at[0], at[1], 0.38), `${label} fits the player collision radius`);
  assert.ok(map.findPath(start[0], start[1], at[0], at[1], 9000, 0.38), `${label} is reachable by walking`);
  assert.ok(occupied.every(([x, y]) => Math.hypot(at[0] - x, at[1] - y) >= 2.05), `${label} does not overlap another interaction point`);
  occupied.push(at);
  return at;
};

// The core folk, storage, portals and service anchors all use the movement map.
const castellan = place('Castellan Elsabet', anchors.castellan);
place('Sacred Flame', [anchors.flame[0] - 2.7, anchors.flame[1] + 1.2]);
place('Brother Cael', [anchors.flame[0] - 2.7, anchors.flame[1] + 1.2]);
place('Ser Cassius', [anchors.columns[1][0] + 1.4, anchors.columns[1][1] - 1.2]);
place('Kestrel', [anchors.waygate[0] + 3.2, anchors.start[1]]);
place('Mother Agatha', [anchors.chronicle[0] + 1.3, anchors.chronicle[1] + 0.6]);
place('Halvard', [anchors.townPortal[0] + 3.2, anchors.townPortal[1] - 1.2]);
place('War Table', anchors.warTable);
place('Chronicle', anchors.chronicle);
place('Vault', anchors.vault);
place('Storage Chest', anchors.stash);
place('Reliquary', anchors.reliquary);
place('Jewel Box', anchors.jewelBox);
place('Portal to the Acts', anchors.townPortal);

const oldDepthPortal = place('old depth portal anchor', anchors.waygate);
const depthPortal = place('repositioned depth portal', [17.5, 27.5]);
assert.ok(Math.hypot(...depthPortal.map((v, i) => v - oldDepthPortal[i])) > 4, 'depth portal moves inward from the battlement edge');
const altar = place('Altar of Heresy', [21, 14.5]);
assert.ok(Math.hypot(altar[0] - anchors.vault[0], altar[1] - anchors.vault[1]) > 4, 'altar is separated from the treasury chest');
assert.ok(anchors.columns.every(([x, y]) => Math.hypot(altar[0] - x, altar[1] - y) > 4), 'altar clears the pillars');
assert.ok(Math.hypot(castellan[0] - altar[0], castellan[1] - altar[1]) > 2.05, 'altar does not overlap Castellan Elsabet');

assert.deepEqual(KEEP_TABS.map(([, name]) => name), ['Sagas', 'Bounties', 'Deeds', 'Ember Trade', 'Vault', 'Furnish', 'Chronicle', 'War Table']);
assert.ok(TROPHIES.length >= 25, 'the restored trophy catalogue is available to the Furnish tab');
const savedKeep = { embers: 73, renown: 30, sagas: { ember_road: { ch: 2, base: 17 } }, done: { old_deed: 123 }, have: { trophy: ['ember_shield'] } };
const hero = { id: 'keep-test', classId: 'paladin', level: 100, deepest: 75, keep: structuredClone(savedKeep) };
const state = keepState(hero);
assert.equal(state.embers, savedKeep.embers, 'migration preserves Embers');
assert.equal(state.renown, savedKeep.renown, 'migration preserves Renown');
assert.deepEqual(state.sagas, savedKeep.sagas, 'migration preserves saga chapter progress');
assert.deepEqual(state.done, savedKeep.done, 'migration preserves deed records');
assert.deepEqual(state.have.trophy, savedKeep.have.trophy, 'migration preserves earned trophies');
assert.equal(sagaList(hero).length, 11, 'all authored Sagas are available');
assert.ok(keepBonuses(hero).gf > 0, 'Renown bonuses contribute to active player stats');

assert.equal(shouldReleaseCastle3D({ id: 'catacombs' }, { keep: true }), false, 'late dungeon cleanup cannot unload the active Keep');
assert.equal(shouldReleaseCastle3D({ id: 'tkeep' }, null), false, 'the Keep atlas is not treated as disposable level art');
assert.equal(shouldReleaseCastle3D({ id: 'catacombs' }, null, true), false, 'cleanup cannot unload the bake during the Keep transition');
assert.equal(shouldReleaseCastle3D({ id: 'catacombs' }, { keep: false }), true, 'the bake is still released after leaving the Keep');
assert.equal(shouldReleaseTownSheets({ id: 'catacombs' }, null, true), false, 'townfolk sheets survive late cleanup during Keep entry');

const artSource = await readFile(new URL('../../src/gfx/keepart.js', import.meta.url), 'utf8');
const keepUiSource = await readFile(new URL('../../src/ui/keep.js', import.meta.url), 'utf8');
assert.doesNotMatch(artSource, /sacredFlameEmblem|badgeW|badgeH/, 'the former programmatic emblem overlay is removed');
assert.doesNotMatch(artSource, /sacred_flame_(?:navy|ivory)\.png|sacredNavy|sacredIvory/,
  'banner art is no longer supplied through a fragile runtime-only override');
assert.match(artSource, /loadImg\(DECOR_DIR \+ 'banners\.webp'\)/,
  'the standard banner atlas remains the single runtime source');
assert.match(keepUiSource, /m\?\.img \|\| A\.banners/, 'Furnish thumbnails show the replacement art too');
const decorMeta = JSON.parse(await readFile(new URL('../../assets/tiles/tkeep/decor/decor.json', import.meta.url), 'utf8'));
assert.deepEqual(decorMeta.banners.filter(({ id }) => /^tess_[ab]1?$/.test(id)).map(({ id, r }) => [id, r]), [
  ['tess_a', [0, 0, 128, 255]], ['tess_a1', [128, 0, 128, 254]],
  ['tess_b', [256, 0, 128, 255]], ['tess_b1', [384, 0, 128, 254]],
], 'saved banner IDs retain their original atlas frames, now replaced in-place');
for (const asset of ['sacred_flame_navy.png', 'sacred_flame_ivory.png']) {
  const bytes = await readFile(new URL(`../../assets/tiles/tkeep/decor/${asset}`, import.meta.url));
  assert.equal(bytes.readUInt32BE(16), 256, `${asset} retains the source sprite width`);
  assert.equal(bytes.readUInt32BE(20), 512, `${asset} retains the source sprite height`);
  assert.equal(bytes[25], 6, `${asset} is RGBA with a transparent background`);
}
for (const sprite of ['07_knight_ivory_mantle', '41_friar', '09_knight_silver_censer', '14_knight_dusk_lancer', '42_priest', '13_knight_frostbound']) {
  await access(new URL(`../../assets/sprites/people/${sprite}.webp`, import.meta.url));
}
for (const asset of ['assets/tiles/tkeep/index.json', 'assets/tiles/tkeep/page_0.webp', 'assets/tiles/tkeep/decor/decor.json', 'assets/tiles/tkeep/decor/banners.webp', 'assets/tiles/tkeep/decor/glass.webp', 'assets/tiles/tkeep/decor/rugs.webp', 'assets/tiles/castle_keep/scatter.webp', 'assets/tiles/castle_keep/pack.json']) {
  await access(new URL(`../../${asset}`, import.meta.url));
}
const bannerAtlas = await readFile(new URL('../../assets/tiles/tkeep/decor/banners.webp', import.meta.url));
assert.equal(bannerAtlas.toString('ascii', 0, 4), 'RIFF');
assert.equal(bannerAtlas.toString('ascii', 8, 12), 'WEBP', 'the replaced original atlas is a valid WebP asset');
console.log('Tessariel’s Keep content, persistence, layout anchors and cleanup regression checks passed.');
