/** Keep a fixed-size, nearest-first light list without allocating candidate arrays or sorting each render. */
export function clearNearestLights(slots) {
  for (const slot of slots) { slot.distance = Infinity; slot.light = null; }
}

export function insertNearestLight(slots, distance, light) {
  if (!slots.length || distance >= slots[slots.length - 1].distance) return;
  let i = slots.length - 1;
  while (i > 0 && distance < slots[i - 1].distance) {
    slots[i].distance = slots[i - 1].distance;
    slots[i].light = slots[i - 1].light;
    i--;
  }
  slots[i].distance = distance;
  slots[i].light = light;
}

/** Roll only a scenery instance that has actually crossed the looping strip's rear edge. */
export function recycleTrainScenery(item, scroll, minX, span, roll) {
  if (item.x - scroll >= minX) return false;
  roll(item, item.x + span);
  return true;
}

/** A scenery matrix only needs rewriting when recycled or when the moving gorge hides/reveals it. */
export function sceneryVisibilityChanged(item, inGorge) {
  if (item.gorgeHidden === inGorge) return false;
  item.gorgeHidden = inGorge;
  return true;
}
