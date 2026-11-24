/**
 * Deliver each defeated boss to the world's completion hook at most once.
 * Combat normally calls this synchronously from kill(). The world update pass
 * also reconciles dead boss entities before cleanup so scripted deaths that
 * set `dead` directly cannot lose completion when their entity is detached.
 */
export function notifyBossDefeated(world, boss) {
  if (!world || !boss || !boss.dead ||
      (boss.rank !== 'boss' && boss.rank !== 'raid' && boss !== world.boss)) return false;
  const notified = world._bossDefeatsNotified || (world._bossDefeatsNotified = new WeakSet());
  if (notified.has(boss)) return false;
  notified.add(boss);
  if (typeof world.onBossKilled === 'function') world.onBossKilled(boss);
  return true;
}

/** Check tracked bosses while they still belong to the world, before cleanup detaches them. */
export function reconcileBossDefeats(world) {
  if (!world) return 0;
  let count = 0;
  const creatures = world.creatures || [];
  for (const creature of creatures) {
    if (creature?.dead && (creature.rank === 'boss' || creature.rank === 'raid' || creature === world.boss)) {
      count += Number(notifyBossDefeated(world, creature));
    }
  }
  // Some scripted removals detach the primary guardian from creatures in the
  // same tick; retain its world.boss reference as the authoritative fallback.
  if (world.boss?.dead && !creatures.includes(world.boss)) count += Number(notifyBossDefeated(world, world.boss));
  return count;
}
