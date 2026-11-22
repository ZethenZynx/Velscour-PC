/** Allocation-free summaries used by the Pirate Seas frame loop. */
export function waveEnemyStatus(live, out) {
  let count = 0, settled = true;
  for (const m of live) {
    if (m.dead || m.wave >= 90) continue;
    count++;
    if (m.entering) settled = false;
  }
  out.count = count; out.settled = settled;
  return out;
}

export function hasLivingEnemy(live) {
  for (const m of live) if (!m.dead) return true;
  return false;
}
