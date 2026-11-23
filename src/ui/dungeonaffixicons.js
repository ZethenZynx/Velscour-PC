// Stable, distinct spell-icon assignments for dungeon affixes. These use the game's
// procedural/painted skill icon collection and do not introduce any new artwork.
import { DUNGEON_AFFIXES } from '../data/dungeonaffixes.js';
import { SKILLS } from '../data/skills.js';
import { skillIconURL } from './icons.js';

const SPELLS = Object.values(SKILLS).sort((a, b) => a.id.localeCompare(b.id));
const ELEMENT_HINTS = [
  [/fire|flame|burn|ember|infernal|hellfire|molten|lava|pyre/i, 'fire'],
  [/lightning|thunder|storm|electric|shock|charged/i, 'light'],
  [/cold|ice|frost|freeze|snow|blizzard/i, 'cold'],
  [/poison|toxin|venom|plague/i, 'poison'],
  [/acid|corros/i, 'acid'],
  [/blood|bleed|hemorrhage/i, 'blood'],
  [/shadow|darkness|dark|void|necrot|unholy|curse|death/i, 'shadow'],
  [/arcane|magic|rune|crystal|rift|chaos|gravity/i, 'arcane'],
  [/holy|divine|sanctif|bless|radiant/i, 'holy'],
  [/earth|stone|rock|quake|boulder|spike|physical|armor/i, 'phys'],
];
const FX_HINTS = [
  [/fire|flame|burn|ember|infernal|hellfire|molten|lava|pyre/i, ['fireball', 'fire', 'eruption', 'meteor', 'breath', 'flare', 'explosion']],
  [/lightning|thunder|storm|electric|shock|charged/i, ['lightning', 'tesla', 'storm', 'shock', 'spark', 'chain']],
  [/cold|ice|frost|freeze|snow|blizzard/i, ['frost', 'ice', 'blizzard', 'shard', 'wave']],
  [/poison|toxin|venom|plague/i, ['poison', 'plague', 'cloud', 'locust', 'thorn']],
  [/acid|corros/i, ['acid', 'blob', 'mine', 'nova']],
  [/blood|bleed|hemorrhage/i, ['blood', 'gore', 'drain', 'slash']],
  [/shadow|darkness|dark|void|necrot|unholy|curse|death/i, ['void', 'skull', 'bone', 'wraith', 'skeleton', 'drain']],
  [/arcane|magic|rune|crystal|rift|chaos|gravity/i, ['rune', 'orb', 'prism', 'mirror', 'supernova', 'blackhole', 'wormhole', 'nova']],
  [/holy|divine|sanctif|bless|radiant/i, ['holy', 'light', 'guardian', 'aura', 'shield', 'pillar']],
  [/shield|armor|armour|resist|fortif|guard|barrier|protect|defen|tough|ward/i, ['shield', 'pshield', 'tshield', 'guardian', 'aura', 'armor']],
  [/move|swift|speed|charge|leap|teleport|pursuit|flank|chase/i, ['charge', 'wind', 'dash', 'leap', 'blink', 'wolf', 'shuriken']],
  [/summon|reinforce|horde|spawn|clone|reanim|undead|minion|pack|swarm/i, ['skeleton', 'summon', 'wolf', 'clone', 'golem', 'hydra', 'locust', 'bird', 'drone']],
  [/death|corpse|kill|explod|deton|blast|impact/i, ['explosion', 'meteor', 'bone', 'gore', 'skull', 'smash']],
  [/gold|loot|treasure|fortune|reward|vault|bounty/i, ['star', 'prism', 'orb', 'rune', 'firework', 'comet']],
];

const words = (text) => new Set(String(text || '').toLowerCase().replace(/[_'-]/g, ' ').match(/[a-z0-9]+/g) || []);
const affixText = (affix) => `${affix.id} ${affix.name} ${affix.category} ${affix.description || ''}`;
const affixElement = (affix) => ELEMENT_HINTS.find(([pattern]) => pattern.test(affixText(affix)))?.[1] || null;

function spellScore(affix, skill) {
  const text = affixText(affix).toLowerCase();
  const tokens = words(text);
  const skillTokens = words(`${skill.name} ${skill.fx} ${skill.el} ${skill.kind}`);
  let score = 0;
  for (const [pattern, element] of ELEMENT_HINTS) if (pattern.test(text)) { if (skill.el === element) score += 9; break; }
  for (const [pattern, effects] of FX_HINTS) {
    if (!pattern.test(text) || !effects.includes(skill.fx)) continue;
    score += /shield|armor|armour|resist|fortif|guard|barrier|protect|defen|tough|ward/i.test(pattern.source) ? 27 : 13;
  }
  if (/shield|armor|armour|resist|fortif|guard|barrier|protect|defen|tough|ward/i.test(text)) {
    if (['shield', 'pshield', 'tshield'].includes(skill.fx)) score += 15;
    else if (['guardian', 'aura'].includes(skill.fx)) score += 2;
    if (!ELEMENT_HINTS.slice(0, 9).some(([pattern]) => pattern.test(text))) score += ['phys', 'holy'].includes(skill.el) ? 8 : -3;
  }
  for (const token of skillTokens) if (token.length > 3 && tokens.has(token)) score += 2.5;
  if (/elite|boss|enemy stat|reinforce/i.test(affix.category) && ['shield', 'buff', 'summon'].includes(skill.kind)) score += 1;
  if (/hazard|environment|world effect/i.test(affix.category) && ['zone', 'trap', 'rain', 'fissure', 'wall'].includes(skill.kind)) score += 1;
  return score;
}

function affixFamily(affix) {
  const text = affixText(affix);
  for (const [pattern, element] of ELEMENT_HINTS) if (pattern.test(text)) return `element:${element}`;
  if (/shield|armor|armour|resist|fortif|guard|barrier|protect|defen|tough|ward/i.test(text)) return 'defense';
  if (/summon|reinforce|horde|spawn|clone|reanim|undead|minion|pack|swarm/i.test(text)) return 'summoning';
  if (/move|swift|speed|charge|leap|teleport|pursuit|flank|chase/i.test(text)) return 'movement';
  if (/death|corpse|kill|explod|deton|blast|impact/i.test(text)) return 'death';
  if (/gold|loot|treasure|fortune|reward|vault|bounty/i.test(text)) return 'rewards';
  return `category:${affix.category}`;
}

const assigned = new Map();
const reservedSkills = new Set();
const reservedByFamily = new Map();
const rankedAffixes = DUNGEON_AFFIXES.map((affix, order) => ({
  affix,
  order,
  ranked: SPELLS.map((skill) => ({ skill, score: spellScore(affix, skill) }))
    .filter(({ skill }) => !affixElement(affix) || skill.el === affixElement(affix))
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id)),
})).sort((a, b) => b.ranked[0].score - a.ranked[0].score || a.order - b.order);

for (const { affix, ranked } of rankedAffixes) {
  const bestScore = ranked[0]?.score ?? 0;
  const family = affixFamily(affix);
  const familyUsed = reservedByFamily.get(family) || new Set();
  // Keep icon art unique across unrelated affix families when a near-equivalent spell exists.
  // Reuse an icon only within a related family, and prefer alternate matching spell art first.
  const choice = ranked.find(({ skill, score }) => !reservedSkills.has(skill.id) && score >= bestScore - 2)?.skill
    || ranked.find(({ skill, score }) => familyUsed.has(skill.id) && score >= bestScore - 2)?.skill
    || ranked[0]?.skill;
  if (choice) {
    assigned.set(affix.id, choice);
    reservedSkills.add(choice.id);
    familyUsed.add(choice.id);
    reservedByFamily.set(family, familyUsed);
  }
}

export function dungeonAffixSkill(id) {
  return assigned.get(typeof id === 'string' ? id : id?.id) || null;
}

export function dungeonAffixIconURL(id) {
  const skill = dungeonAffixSkill(id);
  return skill ? skillIconURL(skill) : '';
}

export function dungeonAffixIconHTML(id, size = 24) {
  const url = dungeonAffixIconURL(id);
  return url ? `<img class="dungeon-affix-spell-icon" width="${size}" height="${size}" src="${url}" alt="">` : '';
}
