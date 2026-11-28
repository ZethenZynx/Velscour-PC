import { FINAL_DEPTH, getActForDepth } from '../data/depth.js';

const ACT_PROGRESS_FIELDS = [
  'lastTown', 'visitedAct2Town', 'act2AutoTravelDone', 'visitedAct3Town', 'act3AutoTravelDone',
  'visitedAct4Town', 'act4AutoTravelDone',
];

function copyCleared(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

/** Durable character progression snapshot for a temporary Heresy challenge. */
export function snapshotHeresyProgression(character, origin, kind) {
  const depth = Math.max(1, Math.floor(Number(character?.depth) || 1));
  const flags = Object.fromEntries(ACT_PROGRESS_FIELDS.map((key) => [key, character?.[key]]));
  const originMode = origin?.breach ? 'eternal-breach'
    : origin?.rift ? 'abyssal-rift'
      : origin?.unboundExploration ? 'unbound-exploration'
        : origin?.unbound ? 'velscour-unbound'
          : depth > FINAL_DEPTH ? 'infinite-endgame' : 'campaign';
  return {
    version: 1,
    characterId: character?.id || null,
    kind: kind === 'throne' ? 'throne' : 'sanctum',
    enteredAt: Date.now(),
    originMode,
    origin: origin ? {
      kind: origin.kind || null,
      biomeId: origin.biome?.id || null,
      depth: Number.isFinite(Number(origin.depth)) ? Number(origin.depth) : null,
      breachFloor: Number.isFinite(Number(origin.breach?.floor)) ? Number(origin.breach.floor) : null,
      riftTier: Number.isFinite(Number(origin.rift?.tier)) ? Number(origin.rift.tier) : null,
      unboundFloor: Number.isFinite(Number(origin.unboundExploration?.floor)) ? Number(origin.unboundExploration.floor) : null,
      x: Number.isFinite(Number(origin.player?.x)) ? Number(origin.player.x) : null,
      y: Number.isFinite(Number(origin.player?.y)) ? Number(origin.player.y) : null,
    } : { kind: 'town', biomeId: null, depth: null, breachFloor: null, riftTier: null, unboundFloor: null, x: null, y: null },
    progression: {
      depth,
      deepest: Math.max(0, Math.floor(Number(character?.deepest) || 0)),
      cleared: copyCleared(character?.cleared),
      nextBiome: typeof character?.nextBiome === 'string' ? character.nextBiome : null,
      biomeBag: Array.isArray(character?.biomeBag) ? [...character.biomeBag] : [],
      lastBiome: character?.lastBiome ?? null,
      act: getActForDepth(Math.min(FINAL_DEPTH, depth))?.act || 1,
      flags,
    },
  };
}

/** Restore only progression values a temporary challenge must never own. */
export function restoreHeresyProgression(character, context) {
  if (!character || !context || context.version !== 1 || context.characterId !== character.id || !context.progression) return false;
  const p = context.progression;
  const depth = Math.floor(Number(p.depth));
  if (!Number.isFinite(depth) || depth < 1 || depth > 300) return false;
  character.depth = depth;
  character.deepest = Math.max(0, Math.min(300, Math.floor(Number(p.deepest) || 0)));
  character.cleared = copyCleared(p.cleared);
  if (p.nextBiome === null || typeof p.nextBiome === 'string') character.nextBiome = p.nextBiome;
  character.biomeBag = Array.isArray(p.biomeBag) ? [...p.biomeBag] : [];
  character.lastBiome = p.lastBiome ?? null;
  for (const key of ACT_PROGRESS_FIELDS) {
    if (Object.hasOwn(p.flags || {}, key)) character[key] = p.flags[key];
  }
  character.heresyEncounterContext = null;
  return true;
}

/** Highest verified campaign clear excluding the Depth 100 marker. */
export function lastVerifiedCampaignClear(character) {
  const cleared = copyCleared(character?.cleared);
  let deepest = 0;
  for (const [key, value] of Object.entries(cleared)) {
    const depth = Number(key);
    if (value && Number.isInteger(depth) && depth >= 1 && depth < FINAL_DEPTH) deepest = Math.max(deepest, depth);
  }
  return deepest;
}

export function isLegacySanctumDepthCorruption(character) {
  return Number(character?.depth) === FINAL_DEPTH + 1
    && Number(character?.deepest) >= FINAL_DEPTH
    && !!character?.cleared?.[FINAL_DEPTH];
}

export function suggestedSanctumRecoveryDepth(character) {
  return Math.min(FINAL_DEPTH, lastVerifiedCampaignClear(character) + 1);
}

/** Death penalties inside a Heresy challenge use the real progression depth, never its scaling floor. */
export function heresyDeathProgression(character, world) {
  if (!world?.heresyChallenge) return { depth: world?.kind === 'dungeon' ? world.depth : character?.depth, context: null };
  const context = character?.heresyEncounterContext || world.heresyChallenge.progression || null;
  const depth = Number(context?.progression?.depth);
  return { depth: Number.isFinite(depth) && depth >= 1 ? depth : character?.depth, context };
}
