/** Pixel anchor for an atlas frame: midpoint of its lowest visible row, at the ground-contact edge. */
export function findTrapGroundAnchor(rgba, width, height, alphaThreshold = 16) {
  width = Math.max(0, Math.floor(Number(width) || 0));
  height = Math.max(0, Math.floor(Number(height) || 0));
  if (!rgba || width < 1 || height < 1) return null;
  for (let y = height - 1; y >= 0; y--) {
    let minX = width, maxX = -1;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      maxX = x;
    }
    if (maxX >= 0) return { x: (minX + maxX + 1) / 2, y: y + 1 };
  }
  return null;
}

/** Corners of a one-by-one world tile. Isometric projection renders this square as a floor diamond. */
export function isometricTileCorners(tile) {
  const x = Number(tile?.x), y = Number(tile?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  return [
    { x: x - 0.5, y: y - 0.5 },
    { x: x + 0.5, y: y - 0.5 },
    { x: x + 0.5, y: y + 0.5 },
    { x: x - 0.5, y: y + 0.5 },
  ];
}

/** Collision against the same one-by-one tile footprint shown by its warning diamond. */
export function pointInTrapTile(point, tile, padding = 0) {
  const x = Number(point?.x), y = Number(point?.y), tx = Number(tile?.x), ty = Number(tile?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  const pad = Math.max(0, Number(padding) || 0);
  return Math.abs(x - tx) <= 0.5 + pad && Math.abs(y - ty) <= 0.5 + pad;
}
