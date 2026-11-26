// Verifies concise copy for every effect-granting shrine family without browser APIs.
// Run with: node tools/tests/shrine_floating_text.mjs
import assert from 'node:assert/strict';
import { shrineFloatingMessage, showShrineActivationMessage } from '../../src/game/shrineeffects.js';
import { texts } from '../../src/gfx/vfx.js';
import { SHRINES } from '../../src/game/happenings.js';

const legacyExpected = {
  frenzy: '+40% Attack & Cast Speed',
  fortune: '+150% Magic & Gold Find',
  bulwark: '+40% Max Health · +15% Damage Reduction',
  wisdom: '+75% Experience Gain',
  wrath: '+17.5% Skill Damage · +10% Critical Chance',
  storm: 'Lightning Strikes Nearby Foes',
  renewal: 'Health & Mana Restored · +3% Health Regen/s',
};
assert.deepEqual(Object.keys(SHRINES), Object.keys(legacyExpected), 'every legacy shrine has floating copy');
for (const [key, message] of Object.entries(legacyExpected)) {
  assert.equal(shrineFloatingMessage(key), message, `${key} message matches its actual effect`);
}

const worldObjectExpected = {
  might: '+8.4% Skill Damage',
  fortitude: '+25% Health · +20% Armor · +9% Damage Reduction',
  swiftness: '+22% Attack/Cast Speed · +12% Move Speed',
  sorcery: '+5.6% Skill Damage · +2.4% Health Regen/s',
  fortune: '+35% Magic Find · +45% Gold Find',
  precision: '+5% Crit Chance · +24% Crit Damage',
  phoenix: 'Phoenix Charge Granted',
  echoes: '+18% Skill Echo Chance',
  colossus: '+7.7% Skill Damage · +18% Area',
  elements: '+7% Lightning Skill Damage',
};
for (const [key, message] of Object.entries(worldObjectExpected)) {
  const stats = key === 'elements' ? { elemental: { light: 28 } }
    : key === 'phoenix' ? {}
      : key === 'might' || key === 'sorcery' || key === 'colossus' ? { dmg: key === 'might' ? 24 : key === 'sorcery' ? 16 : 22, regen: 24, areaPct: 18 }
        : key === 'fortitude' ? { life: 25, armor: 20, reduce: 9 }
          : key === 'swiftness' ? { as: 22, speed: 20 }
            : key === 'precision' ? { crit: 20, critDmg: 24 }
              : key === 'echoes' ? { echoChance: 18 }
                : { gf: 45, mf: 35 };
  assert.equal(shrineFloatingMessage(key, { stats, worldObjectId: key }), message, `${key} message reports actual applied values`);
}

texts.length = 0;
assert.equal(showShrineActivationMessage(4, 7, 'Trial begun', '#b070ff'), true);
assert.deepEqual(texts.at(-1), {
  x: 4, y: 7, z: 112, text: 'Trial begun', color: '#b070ff', gradient: null,
  size: 12, life: 2.5, max: 2.5, vz: 18,
  dx: texts.at(-1).dx, crit: undefined, dmg: undefined,
}, 'altar messages use the existing shrine position, typography, float and fade timing');
const messageCount = texts.length;
assert.equal(showShrineActivationMessage(4, 7, 'Trial begun', '#b070ff'), true);
assert.equal(texts.length, messageCount, 'rapid repeat activation merges with the existing floating message');
assert.equal(showShrineActivationMessage(Number.NaN, 7, 'Invalid'), false);
assert.equal(showShrineActivationMessage(4, 7, ''), false);
assert.equal(texts.length, messageCount, 'invalid or empty activation text does not create a floating message');

console.log('PASS: shared shrine/altar float presentation and concise shrine effect text.');
