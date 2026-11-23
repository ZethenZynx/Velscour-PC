/** A live gameplay timer exists only when an effect carries a finite, positive t value. */
export function effectRemainingSeconds(effect) {
  if (effect?.t == null || !Number.isFinite(Number(effect.t)) || Number(effect.t) <= 0) return null;
  return Number(effect.t);
}

/** Keep each potion use distinct so simultaneous drinks retain their own gameplay countdown. */
export function potionRegenBuffs(regen = []) {
  return (Array.isArray(regen) ? regen : []).flatMap((effect, index) => {
    const t = effectRemainingSeconds(effect);
    const kind = effect?.kind || (Number(effect?.hp) > 0 ? 'hp' : Number(effect?.mp) > 0 ? 'mp' : '');
    if (t == null || !['hp', 'mp'].includes(kind)) return [];
    const id = effect.id ?? `${kind}-${index}`;
    const max = Number(effect.max);
    return [{
      id: `potion-${kind}-${id}`,
      iconItem: { type: 'potion', kind },
      name: kind === 'hp' ? 'Healing Potion' : 'Mana Potion',
      description: kind === 'hp' ? 'Gradually restores health.' : 'Gradually restores mana.',
      t,
      max: Number.isFinite(max) && max > 0 ? max : t,
    }];
  });
}

/** Compact, live timer label shared by every timed buff/debuff icon. */
export function formatEffectDuration(seconds) {
  const remaining = Number(seconds);
  if (!Number.isFinite(remaining) || remaining <= 0) return '';
  const total = Math.ceil(remaining);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
