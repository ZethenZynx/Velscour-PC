/** Write a jagged bolt into a reusable interleaved xy buffer; returns its point count. */
export function writeBoltGeometry(out, ax, ay, bx, by, random = Math.random) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const n = Math.min(48, Math.max(3, Math.floor(len / 12)));
  const nx = -dy / (len || 1), ny = dx / (len || 1), offset = Math.min(18, len * 0.12);
  out[0] = ax; out[1] = ay;
  for (let i = 1; i < n; i++) {
    const t = i / n, off = (random() * 2 - 1) * offset, at = i * 2;
    out[at] = ax + dx * t + nx * off;
    out[at + 1] = ay + dy * t + ny * off;
  }
  out[n * 2] = bx; out[n * 2 + 1] = by;
  return n + 1;
}

/** Draw the cached interleaved bolt points without creating temporary point arrays. */
export function strokeBoltGeometry(ctx, points, count) {
  if (count < 2) return;
  ctx.beginPath(); ctx.moveTo(points[0], points[1]);
  for (let i = 1; i < count; i++) ctx.lineTo(points[i * 2], points[i * 2 + 1]);
  ctx.stroke();
}
