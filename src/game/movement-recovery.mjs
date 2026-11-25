/** Clear stale movement/ability locks after the map has safely recovered an actor. */
export function clearInterruptedMovement(entity) {
  if (!entity) return false;
  entity.channel = null;
  entity.castLock = 0;
  entity.castFree = false;
  entity.queued = null;
  entity.z = 0;
  entity.lunge = 0;
  entity.attackAnimT = 0;
  entity.moving = false;
  entity.moveVec = [0, 0];
  entity.moveTarget = null;
  entity.path = null;
  entity.pathFor = null;
  entity.attackTarget = null;
  entity.interact = null;
  entity.lootTarget = null;
  return true;
}
