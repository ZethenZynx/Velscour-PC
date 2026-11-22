import assert from 'node:assert/strict';
import { resolveBuffIcon } from '../../src/ui/icons.js';
import { SKILLS } from '../../src/data/skills.js';

const skill = Object.values(SKILLS).find((entry) => entry.kind === 'buff');
assert.ok(skill, 'the game has at least one spell that grants a buff');
assert.deepEqual(resolveBuffIcon({ id: skill.id }), { type: 'skill', skill });
assert.equal(resolveBuffIcon({ id: `aura_${skill.id}` }).skill, skill, 'enemy ability buffs reuse their originating skill icon');
for (const buffSkill of Object.values(SKILLS).filter((entry) => entry.kind === 'buff')) {
  assert.equal(resolveBuffIcon({ id: buffSkill.id }).skill, buffSkill, `${buffSkill.id} uses its originating skill artwork`);
}

const fury = resolveBuffIcon({ id: 'fury', name: 'Elixir of Fury' });
assert.equal(fury.type, 'item');
assert.equal(fury.item.type, 'potion');
assert.equal(fury.item.kind, 'fury');
assert.deepEqual(resolveBuffIcon({ id: 'equipment_proc', sourceItem: { type: 'weapon', base: 'sword' } }), {
  type: 'item', item: { type: 'weapon', base: 'sword' },
}, 'equipment sourced buffs can use their originating equipment icon');

for (const key of ['frenzy', 'fortune', 'bulwark', 'wisdom', 'wrath', 'storm', 'renewal']) {
  const icon = resolveBuffIcon({ id: `shrine_${key}`, iconKey: `shrine:${key}`, el: 'holy' });
  assert.equal(icon.type, 'effect');
  assert.equal(icon.key, `shrine:${key}`);
}

const equipment = resolveBuffIcon({ id: 'sig_focus', name: "Hunter's Focus", iconKey: 'signature:ranger-focus', el: 'phys' });
assert.equal(equipment.type, 'effect');
assert.equal(equipment.key, 'signature:ranger-focus');
const passive = resolveBuffIcon({ id: 'astro_hunter', iconKey: 'constellation:hunter', el: 'astral' });
assert.equal(passive.key, 'constellation:hunter');

const a = resolveBuffIcon({ id: 'event_temporal', name: 'Temporal Haste', el: 'light' });
const b = resolveBuffIcon({ id: 'event_sanctuary', name: 'Sanctuary Grace', el: 'holy' });
assert.equal(a.type, 'effect');
assert.equal(b.type, 'effect');
assert.notEqual(a.key, b.key, 'distinct effects receive distinct emblem keys');

console.log('Passed buff icon source resolution for spell, potion, shrine, passive, equipment-signature, and event buffs.');
