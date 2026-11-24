// The original Keep's free decoration set, retained without importing its
// unrelated Ember, quest, reward or character-progression systems.
export const KEEP_NAME = "Tessariel's Keep";
export const TROPHY_BY_ID = Object.create(null);

export function defaultDecor() {
  const banners = ['tess_a', 'tess_b', 'tess_a1', 'tess_b1'];
  const glass = ['glass_a', 'glass_c'];
  return {
    banner: Array.from({ length: 14 }, (_, i) => banners[i % banners.length]),
    glass: Array.from({ length: 10 }, (_, i) => (i === 2 ? 'glass_c' : glass[i % glass.length])),
    rug: ['blue_wool', 'blue_wool', 'gold_wool'],
    pedestal: Array(16).fill(null),
  };
}
