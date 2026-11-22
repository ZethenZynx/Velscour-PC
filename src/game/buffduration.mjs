// Player- and creature-scoped buff records are temporary effects. Persistent
// bonuses belong in equipment, passives, or character progression instead.
export const MAX_TEMPORARY_BUFF_SECONDS = 120;

/** Return a safe finite buff record, or null for an invalid/permanent timer. */
export function normalizeTemporaryBuff(buff, maximum = MAX_TEMPORARY_BUFF_SECONDS) {
  if (!buff || typeof buff !== 'object') return null;
  const remaining = Number(buff.t);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const cap = Number.isFinite(maximum) && maximum > 0 ? maximum : MAX_TEMPORARY_BUFF_SECONDS;
  const t = Math.min(remaining, cap);
  const requestedMax = Number(buff.max);
  const max = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(cap, Math.max(t, requestedMax))
    : t;
  return { ...buff, t, max };
}
