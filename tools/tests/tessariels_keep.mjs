import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { generateKeep } from '../../src/world/keepworld.js';
import { reachableKeepSpot } from '../../src/game/tessarielskeep.js';

const { map, start, anchors } = generateKeep();
assert.equal(map.keep, true);
assert.equal(map.c3only, true, 'the imported Keep uses its original baked isometric terrain');
assert.ok(map.walkable(start[0], start[1]), 'the player arrival point is walkable');

const occupied = [];
const place = (label, point, prior = occupied) => {
  const at = reachableKeepSpot(map, start, point, prior);
  assert.ok(at, `${label} has a walkable interaction location reachable from spawn`);
  assert.ok(map.circleFree(at[0], at[1], 0.38), `${label} has room for the player collision radius`);
  assert.ok(map.findPath(start[0], start[1], at[0], at[1], 9000, 0.38), `${label} path uses the actual movement map`);
  assert.ok(prior.every(([x, y]) => Math.hypot(at[0] - x, at[1] - y) >= 2.05), `${label} does not overlap another interaction point`);
  occupied.push(at);
  return at;
};

const townsfolk = [[21, 10.8], [17.2, 20.4], [24.8, 20.2], [14.5, 29.1], [27.5, 13.5], [18.2, 30]];
for (const [index, point] of townsfolk.entries()) place(`townsperson ${index + 1}`, point);

const services = [[11.5, 13.5], [11.5, 17.5], [11.5, 22.5], [11.5, 27.5], [30.5, 13.5], [30.5, 17.5], [30.5, 22.5], [30.5, 27.5]];
for (const [index, point] of services.entries()) place(`vendor ${index + 1}`, point);
for (const [label, point] of [['Storage Chest', anchors.stash], ['Reliquary', anchors.reliquary], ['Jewel Box', anchors.jewelBox], ['Portal to the Acts', anchors.townPortal], ['Portal to the Depths', anchors.waygate], ['Altar of Heresy', anchors.vault]]) place(label, point);

assert.equal(anchors.start[0], start[0]);
const audioSource = await readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8');
assert.match(audioSource, /tkeep:\s*\['inside_night',\s*'torch_loop'\]/, 'the Keep uses existing indoor and torch ambience');
for (const asset of ['assets/tiles/tkeep/index.json', 'assets/tiles/tkeep/page_0.webp', 'assets/tiles/tkeep/decor/decor.json', 'assets/tiles/tkeep/decor/banners.webp', 'assets/tiles/tkeep/decor/glass.webp', 'assets/tiles/tkeep/decor/rugs.webp', 'assets/tiles/castle_keep/scatter.webp', 'assets/tiles/castle_keep/pack.json', 'assets/audio/amb/inside_night.mp3', 'assets/audio/amb/torch_loop.mp3', 'assets/audio/music/empty_school.mp3']) {
  await access(new URL(`../../${asset}`, import.meta.url));
}
console.log('Tessariel’s Keep terrain and interaction accessibility checks passed.');
