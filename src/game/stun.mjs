/** Resolve a source through player-owned summons, companions, traps and other proxies. */
export function isPlayerControlledSource(source) {
  const seen = new Set();
  let current = source;
  while (current && !seen.has(current)) {
    if (current.isPlayer === true) return true;
    seen.add(current);
    current = current.owner;
  }
  return false;
}

const playerStunReadyAt = new WeakMap();

/**
 * Apply one stun using its PvE duration as the input. Player-controlled sources
 * stun player targets for half that duration; target-specific CC resistance is
 * then applied once. Duration is capped at 75% of the effective ability or
 * internal cooldown, leaving a recovery window. Player-sourced repeated hits
 * share a per-target, per-effect cooldown so ticks and projectiles cannot keep
 * refreshing the stun. `max` preserves effects such as combo-point extensions.
 */
export function applyStun(source, target, pveDuration, {
  max = false, cooldown = 0, internalCooldown = 2, key = null, now = undefined, skipGate = false,
} = {}) {
  const base = Number(pveDuration);
  if (!target || !Number.isFinite(base) || base <= 0) return 0;
  target.status ||= {};
  const playerSource = isPlayerControlledSource(source);
  const effectiveCooldown = Number.isFinite(Number(cooldown)) && Number(cooldown) > 0
    ? Number(cooldown)
    : Math.max(0.2, Number(internalCooldown) || 2);
  const cappedBase = Math.min(base, effectiveCooldown * 0.75);
  if (playerSource && typeof source === 'object' && !skipGate) {
    let owner = source;
    const seen = new Set();
    while (owner?.owner && !seen.has(owner)) { seen.add(owner); owner = owner.owner; }
    if (owner && typeof owner === 'object') {
      let targets = playerStunReadyAt.get(owner);
      if (!targets) { targets = new WeakMap(); playerStunReadyAt.set(owner, targets); }
      let effects = targets.get(target);
      if (!effects) { effects = new Map(); targets.set(target, effects); }
      const effectKey = String(key || source.skillId || source.name || 'player-stun');
      const clock = Number.isFinite(now) ? now : Number(target.world?.time ?? source.world?.time ?? 0);
      const readyAt = effects.get(effectKey) || 0;
      if (clock < readyAt) return 0;
      effects.set(effectKey, clock + effectiveCooldown);
      if (effects.size > 64) {
        for (const [id, until] of effects) if (until <= clock) effects.delete(id);
      }
    }
  }
  const pvpScale = target.isPlayer && isPlayerControlledSource(source) ? 0.5 : 1;
  const ccReduction = target.isPlayer
    ? Math.min(60, Math.max(0, Number(target.st?.markCcReduce) || 0))
    : 0;
  const duration = cappedBase * pvpScale * (1 - ccReduction / 100);
  const previous = Number(target.status.stun?.t) || 0;
  target.status.stun = { t: max ? Math.max(previous, duration) : duration };
  return duration;
}
