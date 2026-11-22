import { ACTS } from '../data/depth.js';

/** The campaign currently has two authored towns; later acts share Herrington Hollow as their town hub. */
export const ACT_TOWN_NAMES = Object.freeze({
  1: 'Herrington Hollow',
  2: 'Sunscorch Oasis',
  3: 'Herrington Hollow',
  4: 'Herrington Hollow',
});

/**
 * An act becomes available only after the preceding act's finale has been recorded as cleared.
 * `deepest` is the game's canonical campaign milestone, while `cleared` supports older saves.
 */
export function actSelectionRows(character) {
  const cleared = character?.cleared || {};
  const campaignWon = Number(character?.depth) > 100 || Number(character?.deepest) >= 100;
  return ACTS.map((act, index) => {
    const requiredDepth = index ? ACTS[index - 1].finaleDepth : 0;
    const unlocked = index === 0 || campaignWon || Number(character?.deepest || 0) >= requiredDepth || !!cleared[requiredDepth]
      || (act.act === 2 && !!character?.visitedAct2Town);
    return {
      ...act,
      town: ACT_TOWN_NAMES[act.act],
      unlocked,
      requirement: index === 0 ? '' : `Complete Depth ${requiredDepth} to unlock Act ${act.act}.`,
    };
  });
}
