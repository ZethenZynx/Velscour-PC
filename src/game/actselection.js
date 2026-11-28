import { ACTS } from '../data/depth.js';

export const ACT_TOWN_NAMES = Object.freeze({
  1: 'Herrington Hollow',
  2: 'Sunscorch Oasis',
  3: 'Bellmourn',
  4: "Tessariel's Keep",
});

/** Act II opens only after Depth 25 has actually been cleared. */
export function act2Unlocked(character) {
  return Number(character?.deepest || 0) >= 25 || !!character?.cleared?.[25] || !!character?.visitedAct2Town;
}

/** Act III opens when the Scorpion King is defeated; old saves inherit access from recorded progression. */
export function act3Unlocked(character) {
  return Number(character?.deepest || 0) >= 50 || !!character?.cleared?.[50] || !!character?.visitedAct3Town || act4Unlocked(character);
}

/** Act IV opens after the Act III finale at Depth 75; old endgame saves are already unlocked. */
export function act4Unlocked(character) {
  return Number(character?.deepest || 0) >= 75 || !!character?.cleared?.[75] || !!character?.visitedAct4Town;
}

const ACT_FINALE_EXITS = Object.freeze({
  25: Object.freeze({ depth: 26, town: 'act2', townName: ACT_TOWN_NAMES[2] }),
  50: Object.freeze({ depth: 51, town: 'act3', townName: ACT_TOWN_NAMES[3] }),
  75: Object.freeze({ depth: 76, town: 'act4', townName: ACT_TOWN_NAMES[4] }),
  100: Object.freeze({ depth: 101, town: 'post-campaign', townName: 'the post-campaign town' }),
});

/** An Act finale's exit destination; movement into that destination is always player-initiated. */
export function actFinaleExit(depth) { return ACT_FINALE_EXITS[Number(depth)] || null; }

/** Persist cleared campaign progression without changing the active world or town location. */
export function recordActFinaleProgress(character, depth) {
  const destination = actFinaleExit(depth);
  if (!character || !destination) return null;
  character.cleared ||= {};
  character.cleared[Number(depth)] = true;
  character.deepest = Math.max(Number(character.deepest) || 0, Number(depth));
  character.depth = Math.max(Number(character.depth) || 1, destination.depth);
  return destination;
}

export function actSelectionRows(character) {
  return ACTS.map((act, index) => {
    const implemented = act.act <= 4;
    const unlocked = implemented && (act.act === 1 || (act.act === 2 && act2Unlocked(character)) || (act.act === 3 && act3Unlocked(character)) || (act.act === 4 && act4Unlocked(character)));
    return {
      ...act,
      town: ACT_TOWN_NAMES[act.act],
      implemented,
      unlocked,
      status: implemented ? (unlocked ? 'Available' : 'Locked') : 'Coming Soon',
      requirement: act.act === 2 ? 'Defeat Ossuarch and complete Depth 25 to unlock Act 2.'
        : act.act === 3 ? 'Defeat the Scorpion King and clear Depth 50 to unlock Act III.'
          : act.act === 4 ? "Complete the Act III finale at Depth 75 to unlock Tessariel's Keep." : '',
    };
  });
}
