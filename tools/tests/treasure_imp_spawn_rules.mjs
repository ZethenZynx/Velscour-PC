import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canSpawnTreasureImp, hasActiveTreasureImp } from '../../src/data/treasureimps.js';

const imp = (variant, extra = {}) => ({ goblin: true, impVariant: variant, dead: false, ...extra });

for (const variant of ['treasure', 'blood', 'abyssal', 'prismatic']) {
  const world = { creatures: [imp(variant)] };
  assert.equal(hasActiveTreasureImp(world), true, `${variant} shares the active slot`);
  assert.equal(canSpawnTreasureImp(world), false, `${variant} blocks another natural spawn`);
  assert.equal(canSpawnTreasureImp(world, { event: true }), true, `${variant} does not block an explicitly scripted event spawn`);
}

assert.equal(canSpawnTreasureImp({ creatures: [] }), true, 'a natural spawn is allowed when no imp is active');
assert.equal(hasActiveTreasureImp({ creatures: [imp('treasure', { dead: true })] }), false, 'dead imps release the slot');
assert.equal(hasActiveTreasureImp({ happen: { imps: [imp('merchant', { removed: true })] } }), false, 'removed imps release the slot');
assert.equal(hasActiveTreasureImp({ happen: { imp: imp('jackpot', { dungeonEventImpEscaped: true }) } }), false, 'escaped imps release the slot');
assert.equal(hasActiveTreasureImp({ happen: { imps: [imp('treasure', { dungeonEventImp: true })] } }), true, 'event imps block ordinary natural spawns');

const happenings = await readFile(new URL('../../src/game/happenings.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../../src/game/dungeonevents.js', import.meta.url), 'utf8');
assert.match(happenings, /if \(!canSpawnTreasureImp\(world, \{ event \}\)\) return null/, 'the shared natural spawn entrypoint enforces the family-wide slot');
assert.match(happenings, /if \(hasActiveTreasureImp\(world\)\) recordGuaranteedImp\(world\)/, 'a guaranteed attempt blocked by an active imp is consumed');
assert.match(happenings, /delete c\.treasureImpRandomPending\[key\]/, 'a chance attempt blocked by an active imp is discarded, not queued');
assert.match(events, /for\s*\(let i\s*=\s*0;\s*i\s*<\s*3;\s*i\+\+\)\s*spawnImp\(world,\s*\{\s*event:\s*true\s*\}\)/, 'the authored multi-imp event retains its explicit bypass');
assert.ok((events.match(/spawnImp\(world,\s*\{\s*event:\s*true\s*\}\)/g) || []).length >= 3, 'both authored multi-imp events retain their explicit bypasses');
assert.match(happenings, /specialEncounter: 'imp-gathering'/, 'the existing named Imp Gathering remains an intentional group encounter');

console.log('Treasure Imp natural-spawn and event-bypass checks passed.');
