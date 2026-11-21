// Node-only regression checks for portrait resource selection and class-specific maxima.
//   node tools/tests/character_portrait_resources.mjs
import assert from 'node:assert/strict';
import { portraitResource } from '../../src/ui/characterportrait.js';

assert.deepEqual(portraitResource({ classId: 'barbarian' }, { rage: 62 }), {
  kind: 'rage', label: 'Rage', current: 62, max: 100,
});
assert.deepEqual(portraitResource({ classId: 'barbarian' }, { rage: 140 }), {
  kind: 'rage', label: 'Rage', current: 100, max: 100,
});
assert.deepEqual(portraitResource({ classId: 'rogue' }, { st: { talents: {} } }), {
  kind: 'combo', label: 'Combo', current: 0, max: 5,
});
assert.deepEqual(portraitResource({ classId: 'rogue' }, { rogue: { cp: 6 }, st: { talents: { deeper_stratagem: true } } }), {
  kind: 'combo', label: 'Combo', current: 6, max: 6,
});
assert.equal(portraitResource({ classId: 'wizard' }, {}), null, 'classes without an extra resource should have no third bar');
assert.equal(portraitResource(null, {}), null);

console.log('Character portrait resource checks passed (Rage, Combo Points, and classes without extra resources).');
