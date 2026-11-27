import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SAND_KIN, DESERT_BIOMES } from '../../src/data/sandkin.js';
import { SAND_KITS } from '../../src/data/sandkits.js';
import { ART_BY_ID, rollLooks } from '../../src/data/bestiary.js';
import { ARCH } from '../../src/data/enemies.js';
import { SAND_VOICES } from '../../src/data/sandvoices.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'assets/sprites/enemies/enemies.json'), 'utf8'));
const errors = [];
const count = (fn) => SAND_KIN.filter(fn).length;
const expected = [
  ['small', count(a => a.tier === 'small'), 50], ['large', count(a => a.tier === 'large'), 70],
  ['mythic', count(a => a.mythic), 30], ['desert bosses', count(a => a.boss && !a.kind), 50],
  ['mummies', count(a => a.kind === 'mummy'), 50], ['zombies', count(a => a.kind === 'zombie'), 40],
  ['pharaohs', count(a => /pharaoh/.test(a.kind || '')), 40], ['nomads', count(a => a.kind === 'nomad'), 40],
  ['knights', count(a => a.kind === 'knight'), 30], ['djinn', count(a => a.kind === 'djinn'), 50],
  ['humanoid bosses', count(a => a.kind === 'humanoid_boss'), 40], ['djinn bosses', count(a => a.kind === 'djinn_boss'), 20],
];
if (SAND_KIN.length !== 510 || new Set(SAND_KIN.map(a => a.id)).size !== 510) errors.push('bestiary count or IDs are not unique');
for (const [name, actual, want] of expected) if (actual !== want) errors.push(`${name}: ${actual}, expected ${want}`);
if (Object.keys(SAND_KITS).length !== 510) errors.push(`kit count ${Object.keys(SAND_KITS).length}`);
if (DESERT_BIOMES.join(',') !== 'sea_of_sand,scorpion_king_pyramid') errors.push(`unexpected spawn environments: ${DESERT_BIOMES}`);
if (Object.keys(ARCH).some(k => !ARCH[k])) errors.push('invalid archetype registry');
const rosters = [...BIOME_BY_ID.sea_of_sand.roster, ...BIOME_BY_ID.scorpion_king_pyramid.roster];
for (const a of SAND_KIN) {
  if (!ARCH[a.arch]) errors.push(`${a.id}: unknown archetype ${a.arch}`);
  if (!ART_BY_ID[a.id]?.sandKin) errors.push(`${a.id}: not registered in art lookup`);
  if (!SAND_KITS[a.id]) errors.push(`${a.id}: missing combat kit`);
  if (!manifest[a.sheet]) errors.push(`${a.id}: atlas ${a.sheet} missing from asset manifest`);
  else {
    const atlas = manifest[a.sheet];
    if (!atlas.cells || !atlas.cells[a.i]) errors.push(`${a.id}: atlas cell ${a.i} missing`);
    if (!existsSync(join(root, 'assets/sprites/enemies', atlas.file))) errors.push(`${a.id}: atlas file ${atlas.file} missing`);
  }
}
if (Object.values(SAND_VOICES).flat().length !== 1200) errors.push('expected 1,200 voice lines');
for (const id of rosters) if (!ARCH[id]) errors.push(`desert roster archetype ${id} is not registered`);
const sourcePngs = ['sand', 'sand2'].map((d) => readdirSync(join(root, 'assets/source/enemies', d), { withFileTypes: true })
  .filter(x => x.isDirectory()).flatMap(x => readdirSync(join(root, 'assets/source/enemies', d, x.name)).filter(f => f.endsWith('.png'))).length);
if (sourcePngs[0] !== 200 || sourcePngs[1] !== 310) errors.push(`source art count ${sourcePngs.join('/')}`);
const atlasCounts = [Object.keys(manifest).filter(k => k.startsWith('sand/')).length, Object.keys(manifest).filter(k => k.startsWith('sand2/')).length];
if (atlasCounts[0] !== 20 || atlasCounts[1] !== 31) errors.push(`atlas count ${atlasCounts.join('/')}`);

let seed = 0x51a7d00d;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const seen = new Set();
const mix = {};
for (const id of DESERT_BIOMES) {
  const biome = BIOME_BY_ID[id];
  let sand = 0, mythic = 0, legacy = 0;
  for (let level = 0; level < 1000; level++) {
    const selector = rollLooks(biome, rnd);
    for (const arch of biome.roster) {
      const look = selector.pick(arch, rnd);
      if (!look) { errors.push(`${id}: no look for ${arch}`); continue; }
      const art = ART_BY_ID[look.art];
      if (art?.sandKin) { sand++; if (art.mythic) mythic++; seen.add(art.kind || art.tier); }
      else legacy++;
    }
  }
  mix[id] = { imported: sand, mythic, existing: legacy, importedShare: +(100 * sand / (sand + legacy)).toFixed(1) };
  if (sand === 0 || legacy === 0) errors.push(`${id}: mixed selection pool did not include both imported and existing art`);
  if (sand / (sand + legacy) < 0.57 || sand / (sand + legacy) > 0.63) errors.push(`${id}: regular spawn art share fell outside 60% target tolerance`);
  if (mythic / (sand + legacy) < 0.015 || mythic / (sand + legacy) > 0.035) errors.push(`${id}: regular mythic frequency fell outside rare compatible-pool range`);
}
const bossMix = {};
for (const id of DESERT_BIOMES) {
  const biome = BIOME_BY_ID[id];
  let imported = 0, mythic = 0, existing = 0, humanoidBoss = 0, djinnBoss = 0;
  for (let i = 0; i < 10000; i++) {
    const result = rollLooks(biome, rnd).boss(biome.roster, rnd);
    const art = result && ART_BY_ID[result.look.art];
    if (!art?.sandKin) existing++;
    else if (art.mythic) mythic++;
    else {
      imported++;
      if (art.kind === 'humanoid_boss') humanoidBoss++;
      if (art.kind === 'djinn_boss') djinnBoss++;
    }
  }
  bossMix[id] = { imported, mythic, existing, humanoidBoss, djinnBoss };
  if (imported < 3000 || mythic < 1000 || existing < 1000) errors.push(`${id}: boss pool categories missing or unexpectedly underweighted`);
  if (id === 'scorpion_king_pyramid' && (!humanoidBoss || !djinnBoss)) errors.push('Pyramid boss pool did not select both humanoid and djinn bosses');
  if (id === 'sea_of_sand' && (Math.abs(imported / 10000 - 0.65) > 0.03 || Math.abs(mythic / 10000 - 0.15) > 0.03 || Math.abs(existing / 10000 - 0.20) > 0.03)) errors.push('Sea of Sand boss weighting differs from 65/15/20 target');
  if (id === 'scorpion_king_pyramid' && (Math.abs(humanoidBoss / 10000 - 0.50) > 0.03 || Math.abs(djinnBoss / 10000 - 0.15) > 0.03 || Math.abs(mythic / 10000 - 0.15) > 0.03 || Math.abs(existing / 10000 - 0.20) > 0.03)) errors.push('Pyramid boss weighting differs from 50/15/15/20 target');
}
for (const id of ['overworld', 'desecrated_cathedral', 'eternal_breach']) {
  const biome = BIOME_BY_ID[id] || { id };
  const selector = rollLooks(biome, rnd);
  for (const arch of ['skeleton', 'zombie', 'knight', 'hound', 'scorpion', 'cultist']) selector.pick(arch);
  if (selector.all().some(x => ART_BY_ID[x.art]?.sandKin)) errors.push(`${id}: imported creature leaked outside desert zones`);
}
console.log('Creature distribution:', Object.fromEntries(expected.map(([name, actual]) => [name, actual])));
console.log('Regular look-selection sample (1,000 level rolls per environment):', mix);
console.log('Random boss-pool sample (10,000 selections per environment):', bossMix);
console.log('Source artwork:', sourcePngs.join(' + '), 'PNG files; atlas registry:', atlasCounts.join(' + '), 'sheets');
console.log('Desert types observed in sample:', [...seen].sort().join(', '));
console.log(errors.length ? `FAIL\n${errors.slice(0, 80).join('\n')}` : 'PASS');
process.exit(errors.length ? 1 : 0);
