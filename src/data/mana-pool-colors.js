/** Class-specific mana liquid tint. These are separate from CLASSES.color, which is
 * used by portraits, class accents and other interface artwork. */
export const MANA_POOL_COLORS = Object.freeze({
  paladin: '#FFD860',
  ranger: '#228B22',
  wizard: '#4169E1',
  necromancer: '#A070FF',
  barbarian: '#B87333',
  dragoon: '#0088CC',
  totem_master: '#40E0D0',
  death_knight: '#A5E8FF',
  arcane_sorcerer: '#302B80', // Astronomer; retained class id is used by saves.
  carrion_witch: '#9BAE32',
  bard: '#FF6A9D',
  slime_lord: '#7FFF00',
  boomerang_knight: '#00A86B',
  lancer: '#C0C0D0',
  dragon_knight: '#FF4500',
  gunner: '#708090',
  monk: '#FFE4B5',
  rogue: '#800020',
  ninja: '#49275E',
});

export const manaPoolColor = (classId) => MANA_POOL_COLORS[classId] || MANA_POOL_COLORS.wizard;

// The original orb liquid is Royal Blue. Filter only that artwork's hue and
// saturation; backdrop-filter preserves the asset's pixel luminance, texture,
// reflections, and highlights instead of painting a flat color over it.
function hslFromHex(hex) {
  const values = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255);
  const [r, g, b] = values, max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { hue, saturation };
}

const SOURCE = hslFromHex(MANA_POOL_COLORS.wizard);

export function manaPoolTintFilter(classId) {
  const { hue, saturation } = hslFromHex(manaPoolColor(classId));
  const turn = ((hue - SOURCE.hue + 540) % 360) - 180;
  return `hue-rotate(${turn.toFixed(2)}deg) saturate(${(saturation / SOURCE.saturation).toFixed(3)})`;
}
