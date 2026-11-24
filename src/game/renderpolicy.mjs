/**
 * The spatial creature grid is in unprojected tile coordinates. It can only
 * conservatively cull actors when the camera uses the ordinary isometric
 * projection; height-mapped and 3D environments need their complete actor
 * list because screen-space view bounds do not include their elevation/warp.
 */
export function canCullCreaturesByViewport(world) {
  const map = world?.map;
  if (!world?.creaturesInBounds || !map) return false;
  return !(
    map.hgt || map.smoothField || map.c3struct || map.tallOcclusion || map.castleMat || map.sea || map.sky ||
    world.cave || world.tower || world.sky || world.seaRun || world.warped
  );
}

/** A stale/incomplete grid must never cull the player from the render list. */
export function viewportCandidatesContainPlayer(world, candidates) {
  return !world?.player || candidates?.includes(world.player) === true;
}
