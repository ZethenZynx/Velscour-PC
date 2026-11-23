// Seed-matched endgame spawn-density soak for Greed 0-5. No browser or game runtime required.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BIOMES } from '../../src/data/biomes.js';
import { RNG } from '../../src/core/util.js';
import { generateDungeon } from '../../src/world/dungeon.js';
import { GREED_LEVELS, greedPacks, greedQuantity } from '../../src/game/greed.js';

const regions = ['catacombs', 'castle_keep', 'molten', 'fungal', 'frozen', 'desert', 'void', 'sewers', 'storm'];
const seeds = 25;
const directions = ['NE', 'SE', 'SW', 'NW'];
const masks = {};
for (let mask = 0; mask < 16; mask++) masks[mask] = [directions.filter((_, bit) => mask & (1 << bit)).map((arm) => ({ arm, ox: 0, oy: 0 }))];
const tileset = {
  floors: [{ name: 'base', lum: 0.2 }, { name: 'base2', lum: 0.2 }, { name: 'feature', lum: 0.2 }],
  bases: [0, 1], features: [2], walls: { mock: masks }, families: ['mock'], arches: {}, doors: {}, scatter: [],
};
const byLevel = GREED_LEVELS.map(() => ({ enemies: 0, leaders: 0, packs: 0 }));
let packScalingNs = 0n;
const rewardRolls = GREED_LEVELS.map(() => ({ loot: 0, goldMultiplier: 1, xpMultiplier: 1 }));
const rewardSamples = 10000;
for (let level = 0; level <= 5; level++) {
  const pct = GREED_LEVELS[level].lootPct;
  const rng = new RNG(`greed-loot-simulation-${level}`);
  for (let i = 0; i < rewardSamples; i++) rewardRolls[level].loot += greedQuantity(4, pct, () => rng.next());
  rewardRolls[level].loot /= rewardSamples;
  rewardRolls[level].goldMultiplier += GREED_LEVELS[level].goldPct / 100;
  rewardRolls[level].xpMultiplier += GREED_LEVELS[level].xpPct / 100;
  assert.ok(Math.abs(rewardRolls[level].loot - 4 * (1 + pct / 100)) < 0.04, `Greed ${level}: simulated loot amount matches the configured bonus`);
}
let layouts = 0;

for (const id of regions) {
  const biome = BIOMES.find((entry) => entry.id === id);
  assert.ok(biome?.roster?.length, `Missing eligible endgame environment ${id}`);
  for (let seed = 1; seed <= seeds; seed++) {
    const key = `${id}-depth-101-seed-${seed}`;
    const generated = generateDungeon(101, biome, tileset, key);
    const ordinary = generated.spawns.filter((spawn) => spawn?.n && !['raid', 'boss'].includes(spawn.rank));
    assert.ok(ordinary.length > 0, `${id}/${seed}: expected ordinary packs`);
    layouts++;
    let previousEnemies = 0, previousLeaders = 0;
    for (let level = 0; level <= 5; level++) {
      const rng = new RNG(`${key}-greed-rolls`); // identical random sequence for every Greed comparison
      const scalingStart = process.hrtime.bigint();
      const scaled = greedPacks(ordinary, level, () => rng.next());
      packScalingNs += process.hrtime.bigint() - scalingStart;
      const enemies = scaled.reduce((sum, spawn) => sum + spawn.n, 0);
      const leaders = scaled.reduce((sum, spawn) => sum + (spawn.rank === 'champion' ? spawn.n : 0) + (spawn.champ ? 1 : 0), 0);
      byLevel[level].packs += scaled.length;
      byLevel[level].enemies += enemies;
      byLevel[level].leaders += leaders;
      assert.ok(scaled.every((spawn, i) => spawn.n >= ordinary[i].n), `${id}/${seed}: Greed ${level} reduced a pack`);
      assert.ok(enemies >= previousEnemies, `${id}/${seed}: population should not fall as Greed rises`);
      assert.ok(leaders >= previousLeaders, `${id}/${seed}: champion leaders should not fall as Greed rises`);
      previousEnemies = enemies;
      previousLeaders = leaders;
    }
  }
}

const average = byLevel.map((entry) => ({
  enemies: entry.enemies / layouts,
  leaders: entry.leaders / layouts,
  packs: entry.packs / layouts,
}));
const scalingMs = Number(packScalingNs) / 1e6;
for (let level = 1; level <= 5; level++) assert.ok(average[level].enemies > average[level - 1].enemies, `Greed ${level} should increase mean enemy count`);
for (let level = 1; level <= 5; level++) assert.ok(average[level].leaders > average[level - 1].leaders, `Greed ${level} should increase champion leaders`);

const lootSource = await readFile(new URL('../../src/game/loot.js', import.meta.url), 'utf8');
assert.match(lootSource, /world\.greedLootPct/, 'ground loot quantity reads the selected Greed bonus');
assert.match(lootSource, /rollGroundItem\(ilvl/, 'Greed does not bypass equipment tier eligibility');
assert.match(lootSource, /rollGroundGem\(lvl/, 'Greed does not bypass gem tier eligibility');
const playerSource = await readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8');
assert.match(playerSource, /this\.st\.xpPct \+ \(this\.world\?\.xpBonusPct \|\| 0\)/, 'Greed XP is included in actual XP gains, including capped progression');

console.log(`Seed-matched layouts: ${layouts} (${regions.length} environments × ${seeds} seeds at depth 101)`);
console.table(average.map((row, level) => ({
  greed: level,
  enemyPopulationBonus: `+${GREED_LEVELS[level].populationPct}%`,
  championLeaderChance: `+${GREED_LEVELS[level].championPct}%`,
  meanEnemies: row.enemies.toFixed(2),
  meanChampionLeaders: row.leaders.toFixed(2),
})));
console.table(rewardRolls.map((row, level) => ({
  greed: level,
  goldBonus: `+${GREED_LEVELS[level].goldPct}%`,
  xpBonus: `+${GREED_LEVELS[level].xpPct}%`,
  lootBonus: `+${GREED_LEVELS[level].lootPct}%`,
  avgLootFromFour: row.loot.toFixed(3),
  goldMultiplier: row.goldMultiplier.toFixed(2),
  xpMultiplier: row.xpMultiplier.toFixed(2),
})));
console.log(`Pack-scaling overhead: ${scalingMs.toFixed(3)} ms total (${(scalingMs / layouts / 6).toFixed(5)} ms per layout/Greed combination). Reward simulation: ${rewardSamples.toLocaleString()} rolls at each Greed level.`);
