export const AUDIO_VOLUME_GROUPS = [
  { id: 'master', label: 'Master Volume' },
  { id: 'music', label: 'Music Volume' },
  { id: 'ambient', label: 'Ambient Volume' },
  { id: 'interface', label: 'Interface Volume' },
  { id: 'playerAttack', label: 'Player Attack Sounds' },
  { id: 'playerSpell', label: 'Player Spell Sounds' },
  { id: 'playerMovement', label: 'Player Movement and Footsteps' },
  { id: 'playerDamage', label: 'Player Damage and Hurt Sounds' },
  { id: 'playerBuff', label: 'Player Buff and Aura Sounds' },
  { id: 'enemyAttack', label: 'Enemy Attack Sounds' },
  { id: 'enemySpell', label: 'Enemy Spell Sounds' },
  { id: 'enemyMovement', label: 'Enemy Movement Sounds' },
  { id: 'enemyDamage', label: 'Enemy Damage and Hurt Sounds' },
  { id: 'enemyDeath', label: 'Enemy Death Sounds' },
  { id: 'boss', label: 'Boss and Guardian Sounds' },
  { id: 'weaponImpact', label: 'Weapon Impact Sounds' },
  { id: 'critical', label: 'Critical Hit Sounds' },
  { id: 'damageOverTime', label: 'Damage-over-Time Sounds' },
  { id: 'persistentSpell', label: 'Persistent Spell Effects' },
  { id: 'explosions', label: 'Explosions and Area-of-Effect Sounds' },
  { id: 'combatWarnings', label: 'Combat Warning Sounds' },
  { id: 'environment', label: 'Environmental Sounds' },
  { id: 'npc', label: 'NPC Sounds' },
  { id: 'portal', label: 'Portal Sounds' },
  { id: 'shrine', label: 'Shrine and Altar Sounds' },
  { id: 'chest', label: 'Chest and Container Sounds' },
  { id: 'itemDrop', label: 'Item Drop Sounds' },
  { id: 'itemPickup', label: 'Item Pickup Sounds' },
  { id: 'currency', label: 'Gold and Currency Sounds' },
  { id: 'rareItem', label: 'Rare Item Drop Notifications' },
  { id: 'questAchievement', label: 'Quest and Achievement Notifications' },
];

export const AUDIO_SECTIONS = [
  { id: 'general', label: 'General', groups: ['master', 'interface'] },
  { id: 'music-ambience', label: 'Music & Ambience', groups: ['music', 'ambient'] },
  { id: 'player', label: 'Player', groups: ['playerAttack', 'playerSpell', 'playerMovement', 'playerDamage', 'playerBuff'] },
  { id: 'enemies', label: 'Enemies', groups: ['enemyAttack', 'enemySpell', 'enemyMovement', 'enemyDamage', 'enemyDeath', 'boss'] },
  { id: 'combat', label: 'Combat', groups: ['weaponImpact', 'critical', 'damageOverTime', 'persistentSpell', 'explosions', 'combatWarnings'] },
  { id: 'world', label: 'World & Environment', groups: ['environment', 'npc', 'portal', 'shrine', 'chest'] },
  { id: 'loot', label: 'Loot & Notifications', groups: ['itemDrop', 'itemPickup', 'currency', 'rareItem', 'questAchievement'] },
];

const GROUP_IDS = AUDIO_VOLUME_GROUPS.map(({ id }) => id);
const DEFAULT_VOLUMES = () => Object.fromEntries(GROUP_IDS.map((id) => [id, id === 'master' ? 100 : id === 'music' ? 35 : id === 'ambient' ? 50 : 60]));
const ALL_UNMUTED = () => Object.fromEntries(GROUP_IDS.map((id) => [id, false]));

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  preset: 'Default', volumes: Object.freeze(DEFAULT_VOLUMES()), muted: Object.freeze(ALL_UNMUTED()),
  maxCombatSounds: 48, maxIdenticalSounds: 2, repetitiveSuppression: 'Low',
  distanceCulling: false, offscreenEnemySounds: true, persistentSpellSounds: true,
  environmentalDensity: 'Full', stereoPositioning: false, backgroundAudio: true,
  muteWhenUnfocused: false, dynamicCombatMusic: false, musicFadeSeconds: 1.5,
  notificationDucking: true, duckAmount: 35,
});

export const AUDIO_PRESETS = {
  Default: { volumes: { ...DEFAULT_VOLUMES() }, maxCombatSounds: 48, maxIdenticalSounds: 2, repetitiveSuppression: 'Low', environmentalDensity: 'Full' },
  Immersive: { volumes: { ...DEFAULT_VOLUMES(), enemyAttack: 80, enemySpell: 85, environment: 90, npc: 80, explosions: 85 }, maxCombatSounds: 96, maxIdenticalSounds: 4, repetitiveSuppression: 'Off', environmentalDensity: 'Full' },
  'Balanced Combat': { volumes: { ...DEFAULT_VOLUMES(), enemyAttack: 48, enemySpell: 60, weaponImpact: 48, explosions: 55 }, maxCombatSounds: 48, maxIdenticalSounds: 2, repetitiveSuppression: 'Medium', environmentalDensity: 'Full' },
  Performance: { volumes: { ...DEFAULT_VOLUMES(), enemyAttack: 48, enemySpell: 55, environment: 35, explosions: 55 }, maxCombatSounds: 32, maxIdenticalSounds: 1, repetitiveSuppression: 'High', environmentalDensity: 'Reduced' },
  'Quiet Combat': { volumes: { ...DEFAULT_VOLUMES(), enemyAttack: 33, enemySpell: 39, weaponImpact: 33, critical: 42, damageOverTime: 21, persistentSpell: 30, explosions: 36 }, maxCombatSounds: 32, maxIdenticalSounds: 1, repetitiveSuppression: 'High', environmentalDensity: 'Reduced' },
  Minimal: { maxCombatSounds: 16, maxIdenticalSounds: 1, repetitiveSuppression: 'High', environmentalDensity: 'Minimal', volumes: { ...DEFAULT_VOLUMES(), playerAttack: 24, playerSpell: 39, playerMovement: 0, playerDamage: 48, playerBuff: 21, enemyAttack: 18, enemySpell: 27, enemyMovement: 0, enemyDamage: 21, enemyDeath: 9, boss: 51, weaponImpact: 15, critical: 21, damageOverTime: 0, persistentSpell: 15, explosions: 21, combatWarnings: 60, environment: 9, npc: 15, portal: 21, shrine: 15, chest: 15, itemDrop: 18, itemPickup: 18, currency: 15, rareItem: 60, questAchievement: 60 } },
};

const LEGACY_SOUND_GROUPS = {
  ui: 'interface', error: 'interface', note: 'playerSpell',
  step: 'playerMovement',
  swing: 'playerAttack', phys: 'playerAttack', bow: 'playerAttack', shoot: 'playerAttack',
  hit: 'weaponImpact', thud: 'weaponImpact', block: 'playerDamage', hurt: 'playerDamage',
  crit: 'critical', critping: 'critical', gore: 'enemyDeath', squish: 'enemyDeath', bones: 'enemyDeath', die: 'enemyDeath',
  fire: 'playerSpell', cold: 'playerSpell', light: 'playerSpell', holy_bolt: 'playerSpell', consecration: 'playerSpell', condemn: 'playerSpell',
  lightwell: 'playerSpell', judgment_beam: 'playerSpell', judgement_cast: 'playerSpell', judgement_impact: 'playerSpell', sanctuary: 'playerSpell',
  blessed_shield_cast: 'playerSpell', radiant_cascade: 'playerSpell', purifying_nova: 'playerSpell', apocalypse_light: 'playerSpell',
  wings_judgment: 'playerSpell', apocalypse_impact: 'playerSpell', wings_judgment_impact: 'playerSpell',
  arcane: 'playerSpell', holy: 'playerSpell', shadow: 'playerSpell', poison: 'playerSpell', acid: 'playerSpell', blood: 'playerSpell',
  sonic: 'playerSpell', thunder: 'playerSpell', summon: 'playerSpell', heal: 'playerBuff', buff: 'playerBuff',
  explode: 'explosions', portal: 'portal', gate: 'portal', iron_express_whistle: 'environment', bell: 'environment', roar: 'boss', boss: 'boss',
  chest: 'chest', door: 'chest', pickup: 'itemPickup', gold: 'currency', orb: 'itemDrop', potion: 'itemPickup', cluck: 'ambient', levelup: 'questAchievement',
  infernal_mark: 'questAchievement', ready_hearth: 'questAchievement', gore_burst: 'enemyDeath',
};

export function normalizeAudioSettings(saved = {}) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const volumes = { ...DEFAULT_VOLUMES(), ...(source.volumes || {}) };
  const muted = { ...ALL_UNMUTED(), ...(source.muted || {}) };
  for (const id of GROUP_IDS) {
    const value = Number(volumes[id]);
    volumes[id] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_AUDIO_SETTINGS.volumes[id];
    muted[id] = muted[id] === true;
  }
  const choices = [16, 32, 48, 64, 96];
  const normalized = {
    ...DEFAULT_AUDIO_SETTINGS, ...source, volumes, muted,
    preset: ['Default', 'Immersive', 'Balanced Combat', 'Performance', 'Quiet Combat', 'Minimal', 'Custom'].includes(source.preset) ? source.preset : 'Default',
    maxCombatSounds: choices.includes(Number(source.maxCombatSounds)) ? Number(source.maxCombatSounds) : DEFAULT_AUDIO_SETTINGS.maxCombatSounds,
    maxIdenticalSounds: Math.max(1, Math.min(5, Math.round(Number(source.maxIdenticalSounds) || DEFAULT_AUDIO_SETTINGS.maxIdenticalSounds))),
    repetitiveSuppression: ['Off', 'Low', 'Medium', 'High'].includes(source.repetitiveSuppression) ? source.repetitiveSuppression : 'Low',
    environmentalDensity: ['Full', 'Reduced', 'Minimal'].includes(source.environmentalDensity) ? source.environmentalDensity : 'Full',
    musicFadeSeconds: Number.isFinite(Number(source.musicFadeSeconds)) ? Math.max(0, Math.min(8, Number(source.musicFadeSeconds))) : 1.5,
    duckAmount: Number.isFinite(Number(source.duckAmount)) ? Math.max(0, Math.min(80, Number(source.duckAmount))) : 35,
  };
  for (const key of ['distanceCulling', 'offscreenEnemySounds', 'persistentSpellSounds', 'stereoPositioning', 'backgroundAudio', 'muteWhenUnfocused', 'dynamicCombatMusic', 'notificationDucking']) {
    normalized[key] = source[key] == null ? DEFAULT_AUDIO_SETTINGS[key] : source[key] === true;
  }
  return normalized;
}

export function applyAudioPreset(current, presetName) {
  const base = normalizeAudioSettings(current);
  if (!AUDIO_PRESETS[presetName]) return { ...base, preset: 'Custom' };
  const preset = AUDIO_PRESETS[presetName];
  return normalizeAudioSettings({
    ...DEFAULT_AUDIO_SETTINGS,
    preset: presetName,
    volumes: { ...DEFAULT_VOLUMES(), ...preset.volumes },
    muted: ALL_UNMUTED(),
    ...Object.fromEntries(Object.entries(preset).filter(([key]) => key !== 'volumes')),
  });
}

export function audioGroupForSound(name, context = null) {
  const explicit = context?.category || context?.audioCategory;
  if (GROUP_IDS.includes(explicit)) return explicit;
  if (context?.actor === 'enemy' || context?.sourceType === 'enemy') {
    if (context?.boss || context?.rank === 'boss') return 'boss';
    if (context?.dot) return 'damageOverTime';
    return ['fire', 'cold', 'arcane', 'holy', 'poison', 'acid', 'shadow', 'thunder', 'light', 'sonic'].includes(name) ? 'enemySpell' : 'enemyAttack';
  }
  if (['consecration', 'sanctuary', 'judgment_beam'].includes(name)) return 'persistentSpell';
  if (String(name).startsWith('step_')) return 'playerMovement';
  return LEGACY_SOUND_GROUPS[name] || 'environment';
}

const NON_COMBAT_AUDIO_CATEGORIES = new Set(['music', 'ambient', 'interface', 'playerMovement', 'environment', 'npc',
  'portal', 'shrine', 'chest', 'itemDrop', 'itemPickup', 'currency', 'rareItem', 'questAchievement']);

export function isCombatAudioCategory(category) { return !NON_COMBAT_AUDIO_CATEGORIES.has(category); }

export function audioGroupIds() { return GROUP_IDS.slice(); }
