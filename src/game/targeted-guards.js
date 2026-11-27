/** Small pure eligibility checks shared by gameplay paths and regression tests. */
export function isUsableInteraction(target) {
  return typeof target?.use === 'function';
}

/** Only awake, ordinary enemies participate in generic movement-affix teleports. */
export function canReceiveMovementAffix(enemy) {
  return !!enemy && enemy.team === 'enemy' && !enemy.dead && !!enemy.awake && !enemy.static &&
    !enemy.isVelscour && !enemy.raid && !(enemy.vel && enemy.vel.holdBoss());
}

/** Twin Guardians apply to ordinary dungeon guardians, never the Velscour encounter. */
export function shouldSpawnTwinGuardian(world) {
  const boss = world?.boss;
  return !!world?.dungeonAffixes?.includes('twin_guardians') && !!boss && !boss.dead && !boss.raid && !boss.isVelscour;
}
