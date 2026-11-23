import { ACTS } from '../data/depth.js';

/** Only the first two act towns are implemented. */
export const ACT_TOWN_NAMES = Object.freeze({
  1: 'Herrington Hollow',
  2: 'Sunscorch Oasis',
  3: '',
  4: '',
});

/** Act II opens only after Depth 25 has actually been cleared. */
export function act2Unlocked(character) {
  return Number(character?.deepest || 0) >= 25 || !!character?.cleared?.[25] || !!character?.visitedAct2Town;
}

/** A fresh character is sent to Act II exactly once, on its first Depth 25 clear. */
export function shouldAutoTravelToAct2(character, depth, firstClear) {
  return Number(depth) === 25 && !!firstClear && !character?.act2AutoTravelDone && !act2Unlocked(character);
}

export function actSelectionRows(character) {
  return ACTS.map((act, index) => {
    const implemented = act.act <= 2;
    const unlocked = implemented && (act.act === 1 || act2Unlocked(character));
    return {
      ...act,
      town: ACT_TOWN_NAMES[act.act],
      implemented,
      unlocked,
      status: implemented ? (unlocked ? 'Available' : 'Locked') : 'Coming Soon',
      requirement: act.act === 2 ? 'Defeat Ossuarch and complete Depth 25 to unlock Act 2.' : '',
    };
  });
}
