// Endgame Greed settings and the affixes/reward dials locked to each Depth 101+ environment.
import { G } from '../state.js';
import { clamp } from '../core/util.js';
import { chooseDungeonAffix, normalizeDungeonAffixIds } from '../data/dungeonaffixes.js';

export const GREED_MAX = 5;
export const GREED_LEVELS = Object.freeze([
  { level: 0, name: 'Disabled', affixes: 0, goldPct: 0, xpPct: 0, lootPct: 0, populationPct: 0, championPct: 0 },
  { level: 1, name: 'Temptation', affixes: 1, goldPct: 20, xpPct: 10, lootPct: 10, populationPct: 12, championPct: 7 },
  { level: 2, name: 'Desire', affixes: 2, goldPct: 45, xpPct: 25, lootPct: 20, populationPct: 24, championPct: 14 },
  { level: 3, name: 'Avarice', affixes: 3, goldPct: 75, xpPct: 45, lootPct: 35, populationPct: 36, championPct: 21 },
  { level: 4, name: 'Obsession', affixes: 4, goldPct: 110, xpPct: 70, lootPct: 50, populationPct: 48, championPct: 28 },
  { level: 5, name: 'Insatiable', affixes: 5, goldPct: 150, xpPct: 100, lootPct: 75, populationPct: 60, championPct: 35 },
]);

export const greedOf = (c = G.char) => clamp(Math.floor(Number(c?.greedLevel ?? c?.greed) || 0), 0, GREED_MAX);
export const greedLevelInfo = (level) => GREED_LEVELS[clamp(Math.floor(Number(level) || 0), 0, GREED_MAX)];

/** Reward percentages are additive bonuses to existing reward dials, not stacked as another multiplier. */
export function greedMods(level) {
  const row = greedLevelInfo(level);
  return {
    level: row.level,
    affixes: row.affixes,
    gold: row.goldPct / 100,
    xp: row.xpPct / 100,
    loot: row.lootPct / 100,
    population: row.populationPct / 100,
    populationPct: row.populationPct,
    championPct: row.championPct,
    goldPct: row.goldPct,
    xpPct: row.xpPct,
    lootPct: row.lootPct,
  };
}

/** Restore the pre-redesign Greed pack-density and champion-leader rolls without changing enemy strength. */
export function greedPacks(spawns, level, random = Math.random) {
  const M = greedMods(level);
  if (!M.level || !Array.isArray(spawns)) return spawns;
  return spawns.map((spawn) => {
    if (!spawn?.n || ['raid', 'boss'].includes(spawn.rank)) return spawn;
    const n = spawn.n + Math.floor(spawn.n * M.population + random());
    const champ = !!spawn.champ || (spawn.rank === 'normal' && random() < M.championPct / 100);
    return { ...spawn, n, champ };
  });
}

/** Stochastic rounding shared by live loot generators, so fractional quantity bonuses stay unbiased. */
export function greedQuantity(count, bonusPct, random = Math.random) {
  const exact = Math.max(0, Number(count) || 0) * (1 + (Number(bonusPct) || 0) / 100);
  const whole = Math.floor(exact);
  const fraction = exact - whole;
  return whole + (fraction > 0 && random() < fraction ? 1 : 0);
}

/** Select exactly one implemented affix from a distinct category per Greed level. */
export function rollGreedAffixes(level, random = Math.random) {
  const target = greedLevelInfo(level).affixes;
  const ids = [];
  while (ids.length < target) {
    const next = chooseDungeonAffix(ids, random);
    if (!next) break;
    ids.push(next.id);
  }
  return normalizeDungeonAffixIds(ids);
}

/** Reuse a saved plan for the same level/depth/environment so opening the menu never rerolls it. */
export function getGreedAffixPreview(character, depth, environment = '', selectedLevel = greedOf(character)) {
  const n = Math.floor(Number(depth) || 0);
  if (n <= 100) return [];
  const level = clamp(Math.floor(Number(selectedLevel) || 0), 0, GREED_MAX);
  environment = String(environment || 'random');
  const key = `${n}|${environment}|${level}`;
  if (character) {
    const previews = character.greedAffixPreviews && typeof character.greedAffixPreviews === 'object' && !Array.isArray(character.greedAffixPreviews)
      ? character.greedAffixPreviews : (character.greedAffixPreviews = {});
    const cached = previews[key];
    if (Array.isArray(cached)) {
      const ids = normalizeDungeonAffixIds(cached).slice(0, level);
      if (ids.length === level) return ids;
    }
  }
  const current = character?.greedAffixPreview;
  const saved = current && current.level === level && current.depth === n && current.environment === environment
    ? normalizeDungeonAffixIds(current.ids).slice(0, level) : [];
  const ids = saved.length === level ? saved : rollGreedAffixes(level);
  if (character) {
    const previews = character.greedAffixPreviews && typeof character.greedAffixPreviews === 'object' && !Array.isArray(character.greedAffixPreviews)
      ? character.greedAffixPreviews : (character.greedAffixPreviews = {});
    previews[key] = [...ids];
    const keys = Object.keys(previews);
    if (keys.length > 72) for (const old of keys.slice(0, keys.length - 72)) delete previews[old];
    if (level === greedOf(character)) character.greedAffixPreview = { level, depth: n, environment, ids: [...ids] };
  }
  return ids;
}

/** Save a preferred difficulty. Its effects are applied only when a Depth 101+ dungeon is built. */
export function setGreed(level, c = G.char) {
  if (!c) return 0;
  const next = clamp(Math.floor(Number(level) || 0), 0, GREED_MAX);
  c.greedLevel = next;
  c.greed = next; // retain the legacy field for existing save readers and integrations
  return next;
}

/** Apply Greed once to reward dials, and only to infinite campaign depths (101+). */
export function greedWorld(world, c = G.char) {
  if (!world || world.kind !== 'dungeon' || Number(world.depth) <= 100 || world.greedApplied) return false;
  const level = greedOf(c), M = greedMods(level);
  world.greedApplied = true;
  world.greed = level;
  world.greedAffixCount = M.affixes;
  world.greedGoldPct = M.goldPct;
  world.greedXpPct = M.xpPct;
  world.greedLootPct = M.lootPct;
  world.greedPopulationPct = M.populationPct;
  world.greedChampionPct = M.championPct;
  if (level) {
    world.xpBonusPct = (world.xpBonusPct || 0) + M.xpPct;
  }
  return true;
}
