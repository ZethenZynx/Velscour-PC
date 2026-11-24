const POTION_ICON_COLORS = Object.freeze({ hp: 'red', mp: 'blue', rejuv: 'purple', fury: 'orange' });
const VALID_POTION_COLORS = new Set(['red', 'blue', 'purple', 'orange']);

/** Accept either an inventory color key or the gameplay potion kind used by effect records. */
export function potionIconColor(value) {
  const key = String(value || '').toLowerCase();
  const color = POTION_ICON_COLORS[key] || key;
  return VALID_POTION_COLORS.has(color) ? color : null;
}
