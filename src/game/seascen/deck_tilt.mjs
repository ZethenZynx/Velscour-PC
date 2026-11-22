/** Rotate the game canvas for a listing deck without changing the player's zoom. */
export function deckTiltTransform(deg) {
  return Math.abs(deg) > 0.01 ? `rotate(${deg.toFixed(2)}deg)` : '';
}

/** Map a pointer coordinate through the inverse of the deck's visual rotation. */
export function untiltPointerPoint(x, y, cx, cy, deg) {
  const th = -deg * Math.PI / 180, dx = x - cx, dy = y - cy;
  return [cx + dx * Math.cos(th) - dy * Math.sin(th), cy + dx * Math.sin(th) + dy * Math.cos(th)];
}
