import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BESTIARY, ART_BY_ID, artPool, rollLooks } from '../../src/data/bestiary.js';
import { CASTLE_KIN } from '../../src/data/castlekin.js';
import { DISTRICTS, PHOBOS_ART } from '../../src/data/phobos.js';
import { HORRORS_ROSTER } from '../../src/data/horrorsroster.js';
import { KNIGHTS_ROSTER } from '../../src/data/knightsroster.js';
import { ARCH } from '../../src/data/enemies.js';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'assets/sprites/enemies/enemies.json'), 'utf8'));
const errors = [];
const expect = (condition, message) => { if (!condition) errors.push(message); };
expect(CASTLE_KIN.length === 60, `castle roster should contain 60 entries (50 creatures + 10 bosses), found ${CASTLE_KIN.length}`);
expect(HORRORS_ROSTER.length === 130, `Dungeon Horrors roster should contain 130 entries, found ${HORRORS_ROSTER.length}`);
expect(KNIGHTS_ROSTER.length === 100, `Hulking Knights roster should contain 100 entries, found ${KNIGHTS_ROSTER.length}`);
expect(PHOBOS_ART.length >= HORRORS_ROSTER.length + KNIGHTS_ROSTER.length, 'Phobos art catalogue omitted an imported roster');
expect(new Set(BESTIARY.map(a => a.id)).size === BESTIARY.length, 'combined bestiary contains duplicate IDs');

for (const art of [...CASTLE_KIN, ...PHOBOS_ART.filter(a => !['gray', 'good'].includes(a.cat))]) {
  expect(!!ARCH[art.arch], `${art.id}: unregistered combat archetype ${art.arch}`);
  expect(ART_BY_ID[art.id] === art, `${art.id}: missing from the runtime art registry`);
  const atlas = manifest[art.sheet];
  expect(!!atlas, `${art.id}: missing atlas mapping ${art.sheet}`);
  if (atlas) {
    expect(!!atlas.cells?.[art.i], `${art.id}: missing atlas cell ${art.i}`);
    expect(existsSync(join(root, 'assets/sprites/enemies', atlas.file)), `${art.id}: missing atlas file ${atlas.file}`);
  }
}
expect(!artPool('knight').some(a => a.phobos || a.castleKin), 'themed imports leaked into the global knight pool');

let seed = 0x94f31a2d;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rookery = DISTRICTS.find(d => d.id === 'rookeries');
const city = { id: 'phobos_test', phobos: true, phobosDistrict: rookery.name,
  phobosFoeIds: rookery.foes.map(a => a.id), phobosBossIds: rookery.bosses.map(a => a.id),
  roster: [...new Set(rookery.foes.map(a => a.arch))] };
const looks = rollLooks(city, rnd);
for (const arch of city.roster) {
  const pick = looks.pick(arch, rnd);
  expect(!!pick, `Phobos test district has no ${arch} look`);
  if (pick) expect(ART_BY_ID[pick.art]?.phobos === true, `${arch} look escaped the Phobos-only pool`);
}
const guardian = looks.boss(rookery.bosses.map(a => a.arch), rnd);
expect(!!guardian && ART_BY_ID[guardian.look.art]?.phobos === true, 'Phobos guardian did not resolve to the district art pool');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${CASTLE_KIN.length} castle creatures/bosses, ${HORRORS_ROSTER.length} Dungeon Horrors, ${KNIGHTS_ROSTER.length} Hulking Knights, ${PHOBOS_ART.length} Phobos entries and all referenced atlases registered.`);
}
