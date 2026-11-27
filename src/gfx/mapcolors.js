// Muted, deliberately separated map colors. These colors describe game terrain, not the floor art's lighting.
export const MAP_TERRAIN_COLORS = Object.freeze({
  grass: '#536743', vegetation: '#304a34', dirt: '#806044', mud: '#594536',
  sand: '#b7a06f', water: '#426f82', deepWater: '#293f60', stone: '#777a7a',
  wall: '#41474d', wood: '#775a40', snow: '#c5cbd0', ice: '#7fa8bb',
  lava: '#a84d32', blood: '#713b40', swamp: '#626744', void: '#171a21',
  bridge: '#75664e', rail: '#4c4c51', crystal: '#638995', fungal: '#69724a',
});

// The Eternal Breach has a fixed void-island palette shared by the TAB map and minimap.
export const ETERNAL_BREACH_MAP_COLORS = Object.freeze({
  walkable: '#645476', boundary: '#929BA8', inaccessible: '#141217', pathway: '#847396',
});

// Herrington Hollow uses the town tileset, whose rendered floor materials do
// not carry the semantic names used by dungeon floor atlases. Keep its map
// palette local so the shared stone/wall colors for other areas stay intact.
export const HERRINGTON_TOWN_MAP_COLORS = Object.freeze({
  grass: '#536743', gravel: '#947754', dirt: '#806044', mud: '#594536',
  stone: '#88785f', concrete: '#786e5e', boundary: '#484137',
});

const TOWN_FLOOR_MATERIALS = ['grass', 'gravel', 'dirt', 'mud', 'stone', 'concrete'];
const townTransitionColors = new Map();
function blendTownFloorColors(a, b) {
  const x = HERRINGTON_TOWN_MAP_COLORS[a] || HERRINGTON_TOWN_MAP_COLORS.stone;
  const y = HERRINGTON_TOWN_MAP_COLORS[b] || HERRINGTON_TOWN_MAP_COLORS.stone;
  const channel = (offset) => Math.round((parseInt(x.slice(offset, offset + 2), 16) + parseInt(y.slice(offset, offset + 2), 16)) / 2);
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, '0')).join('')}`;
}

/** Return a Herrington Hollow map color, or null for every other area. */
export function herringtonTownMapColor(world, variant, transitionPairs = [], blocked = false) {
  if (world?.kind !== 'town' || world?.biome?.id !== 'town') return null;
  if (blocked) return HERRINGTON_TOWN_MAP_COLORS.boundary;
  const tile = Number(variant);
  if (Number.isInteger(tile) && tile >= 0 && tile < TOWN_FLOOR_MATERIALS.length) return HERRINGTON_TOWN_MAP_COLORS[TOWN_FLOOR_MATERIALS[tile]];
  const pairIndex = Number.isInteger(tile) && tile >= 6 ? Math.floor((tile - 6) / 8) : -1;
  const pair = transitionPairs[pairIndex];
  if (pair) {
    if (townTransitionColors.has(pair)) return townTransitionColors.get(pair);
    const [a, b] = pair.split('__');
    const color = blendTownFloorColors(a, b);
    townTransitionColors.set(pair, color);
    return color;
  }
  return HERRINGTON_TOWN_MAP_COLORS.stone;
}

/** Resolve the Breach's revealed collision grid into its dedicated map palette. */
export function eternalBreachMapColor(map, i) {
  const own = map?.breach?.own, bridges = map?.breach?.bridgeOf;
  if (!own || !bridges || i < 0 || i >= own.length) return null;
  const colors = ETERNAL_BREACH_MAP_COLORS;
  if (map.t?.[i] !== 1) return colors.inaccessible;
  if (map.block?.[i] || map.breach.rock?.[i] || (own[i] >= 0 && map.rounded?.[i])) return colors.boundary;
  if (bridges[i] >= 0 && own[i] < 0) return colors.pathway;
  return own[i] >= 0 ? colors.walkable : colors.inaccessible;
}

const RULES = [
  ['deepWater', /deep\s*water|abyss(?:al)?\s*(?:water|pool)|ocean|open\s*sea|void\s*water/],
  ['lava', /lava|magma|molten|volcanic|fire\s*river/],
  ['blood', /blood|gore|flesh|sanguine/],
  ['ice', /ice|frost|glacier|rime/],
  ['snow', /snow|powder|windpacked/],
  ['rail', /rail(?:way)?|track|sleeper|iron\s*line/],
  ['bridge', /bridge|drawbridge|trestle|gangway/],
  ['swamp', /swamp|marsh|bog|fen|mire|sewer|sludge|sewage/],
  ['water', /water|moat|pond|river|stream|lake|pool|oasis|wetland/],
  ['sand', /sand|dune|desert|wadi|salt\s*flat|beach/],
  ['vegetation', /forest|tree|canopy|root|thicket|undergrowth|briar|vine|dense\s*vegetation/],
  ['grass', /moss|reed|meadow|lawn|clover|wildflower|grass|turf|verdant|herb/],
  ['dirt', /gravel\s*path|gravel\s*wash|packed\s*ground/],
  ['fungal', /fung|mushroom|mycel|spore/],
  ['crystal', /crystal|quartz|gem|amethyst|shard/],
  ['wood', /wood|plank|board|timber/],
  ['wall', /wall|rampart|battlement|parapet|masonry|brickwork|fortification|cliff|ledge/],
  ['stone', /stone|rock|granite|slate|limestone|flagstone|marble|basalt|cobble|gravel|grit|ore|ore|rubble|pav(?:e|ing)|brick|shale|bedrock/],
  ['mud', /mud|clay|earth|loam|silt|soil|rut|peat/],
  ['dirt', /dirt|trail|path|road|gravel\s*wash|packed\s*ground/],
];

const BIOME_DEFAULTS = Object.freeze({
  dark_forest: 'vegetation', overworld: 'grass', castle: 'grass', sea_of_sand: 'sand',
  snowy_summit: 'snow', mountainside: 'stone', depths_edge: 'stone', pirate_seas: 'deepWater',
  skyship: 'void', ghost_train: 'rail', deep_mines: 'stone', endless_siege: 'stone', eternal_breach: 'void',
  catacombs: 'stone', castle_keep: 'wall', frozen: 'ice', ice_temple: 'ice', molten: 'lava',
  fungal: 'fungal', sunken: 'water', blood: 'blood', ashen: 'stone', void: 'void', gilded: 'stone',
  plague: 'swamp', crystal: 'crystal', desert: 'sand', shadow: 'void', forge: 'lava', abyss: 'void',
  thorn: 'vegetation', storm: 'stone', obsidian: 'stone', flesh: 'blood', serpent: 'stone',
  shattered: 'stone', library: 'wood', sewers: 'swamp', necropolis: 'stone', cathedral: 'stone',
  amber: 'sand', desert_temple: 'sand', hell: 'lava', astral_plane: 'void', heavenly: 'stone', throne: 'lava',
});

export function terrainKindFromName(name) {
  const text = String(name || '').toLowerCase().replace(/[_-]+/g, ' ');
  for (const [kind, pattern] of RULES) if (pattern.test(text)) return kind;
  return null;
}

export function terrainColor(kind, biomeId = '') {
  const resolved = kind || BIOME_DEFAULTS[biomeId] || 'stone';
  return MAP_TERRAIN_COLORS[resolved] || MAP_TERRAIN_COLORS.stone;
}

