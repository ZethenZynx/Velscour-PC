// Non-browser regression coverage for full-body movement collision and stuck recovery.
// Run: node tools/tests/movement_collision_safety.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TileMap } from '../../src/world/map.js';
import { Leap } from '../../src/game/hazards.js';
import { clearInterruptedMovement } from '../../src/game/movement-recovery.mjs';

const mapSource = await readFile(new URL('../../src/world/map.js', import.meta.url), 'utf8');
const ninjaSource = await readFile(new URL('../../src/game/ninja.js', import.meta.url), 'utf8');
const skillSource = await readFile(new URL('../../src/game/skillrun.js', import.meta.url), 'utf8');
const rogueSource = await readFile(new URL('../../src/game/rogue.js', import.meta.url), 'utf8');
const playerSource = await readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8');

function room(w = 12, h = 9) { const map = new TileMap(w, h); map.t.fill(1); return map; }
function actor(x, y, r = 0.3) { return { x, y, r, isPlayer: true, team: 'player', z: 0, face() {} }; }

// True disk-vs-tile tests: the first point clears a blocked tile's square corner,
// while the second overlaps the tile with the body circle and must be rejected.
const corner = room(); corner.block[2 * corner.w + 2] = 1;
assert.equal(corner.circleFree(1.75, 1.75, 0.3), true, 'a circle may pass the clear diagonal corner of a blocked tile');
assert.equal(corner.circleFree(1.8, 1.8, 0.3), false, 'the full body radius may not overlap a blocked tile');

// Body sizes at small and large values are honored against map edges and obstacles.
const wall = room();
for (let y = 0; y < wall.h; y++) wall.block[y * wall.w + 6] = 1;
for (const r of [0.15, 0.3, 0.42, 0.6]) {
  const a = actor(5.4, 4.5, r);
  const trace = wall.traceMovement(a, 4, 0);
  assert.ok(wall.positionFree(a, trace.x, trace.y), `radius ${r} ends at a valid position`);
  assert.ok(trace.x <= 6 - Math.min(r * 0.8, 0.42) + 0.001, `radius ${r} stops before the wall`);
  assert.equal(wall.circleFree(-0.1, 4.5, r), false, `radius ${r} cannot leave map bounds`);
}

// Very large frame motion is continuously sampled and cannot tunnel through a thin wall.
const fast = actor(2.5, 4.5, 0.28);
wall.moveDash(fast, 8, 0);
assert.ok(fast.x < 6 - 0.22, 'a high-speed dash cannot tunnel through a single-tile wall');
assert.equal(wall.positionFree(fast, fast.x, fast.y), true);

// A narrow walkable corridor accepts a body that fits, but not one wider than its walls.
const corridor = new TileMap(10, 7);
for (let x = 1; x < 9; x++) corridor.t[3 * corridor.w + x] = 1;
const fits = actor(1.5, 3.5, 0.3);
assert.ok(corridor.moveDash(fits, 5, 0) > 4, 'a fitting body crosses a narrow corridor');
const tooWide = actor(1.5, 3.5, 0.6);
assert.ok(corridor.moveDash(tooWide, 4, 0) > 3.5, 'the maximum supported collision radius fits the one-tile corridor without crossing its walls');
assert.ok(corridor.positionFree(tooWide, tooWide.x, tooWide.y));

const doorway = room(12, 9);
for (let x = 1; x < doorway.w - 1; x++) if (x !== 6) doorway.block[4 * doorway.w + x] = 1;
const doorRunner = actor(6.5, 2, 0.3);
assert.ok(doorway.moveDash(doorRunner, 0, 4) > 3.5, 'a fitting character can dash through an open doorway');
assert.ok(doorway.positionFree(doorRunner, doorRunner.x, doorRunner.y));

const repeated = room();
for (let y = 0; y < repeated.h; y++) repeated.block[y * repeated.w + 6] = 1;
const repeatedlyDashing = actor(5.4, 4.5, 0.3);
for (let i = 0; i < 20; i++) {
  repeated.moveDash(repeatedlyDashing, 0.5, 0.02);
  assert.ok(repeated.positionFree(repeatedlyDashing, repeatedlyDashing.x, repeatedlyDashing.y), 'repeated wall dashes never embed the character');
}

// Stuck recovery returns to the recent safe side of the wall, not to a point across it.
const recovery = room();
for (let y = 0; y < recovery.h; y++) recovery.block[y * recovery.w + 5] = 1;
const stuck = actor(4.7, 4.5, 0.3);
recovery.rememberPosition(stuck); stuck.x = 4.8;
assert.doesNotMatch(JSON.stringify(stuck), /_lastValid/, 'runtime recovery data is not written into serialized saves');
assert.equal(recovery.positionFree(stuck, stuck.x, stuck.y), false);
assert.equal(recovery.recoverEmbedded(stuck), true, 'embedded player is recovered');
assert.deepEqual([stuck.x, stuck.y], [4.7, 4.5], 'recovery uses the immediate last safe position');
assert.equal(recovery.positionFree(stuck, stuck.x, stuck.y), true);

// No prior in-memory anchor (e.g. a legacy save loaded at an invalid coordinate):
// recovery is bounded and cannot cross a second wall tile.
const legacy = room(); legacy.block[4 * legacy.w + 5] = 1; legacy.block[4 * legacy.w + 6] = 1;
const legacyStuck = actor(5.5, 4.5, 0.3);
assert.equal(legacy.recoverEmbedded(legacyStuck, 2), true, 'an invalid legacy position is recovered locally');
assert.ok(Math.hypot(legacyStuck.x - 5.5, legacyStuck.y - 4.5) <= 2);
assert.ok(legacy.positionFree(legacyStuck, legacyStuck.x, legacyStuck.y));
assert.ok(legacyStuck.x < 6.24 && legacyStuck.x > 4.7,
  'legacy recovery escapes only through the embedded tile boundary, not across the additional wall tile');

const edgeStuckMap = room(); edgeStuckMap.block[4 * edgeStuckMap.w + 5] = 1;
const edgeStuck = actor(4.8, 4.5, 0.3);
assert.equal(edgeStuckMap.recoverEmbedded(edgeStuck), true, 'legacy positions overlapping an adjacent wall are recovered');
assert.ok(edgeStuckMap.positionFree(edgeStuck, edgeStuck.x, edgeStuck.y));

// A scripted terrain change can invalidate a position more than the local repair
// radius from its anchor. Recovery still selects a safe tile in the anchor's
// walk-connected component, never on the far side of a full-height wall.
const farRecoveryMap = room(20, 9);
for (let y = 0; y < farRecoveryMap.h; y++) farRecoveryMap.block[y * farRecoveryMap.w + 10] = 1;
farRecoveryMap.block[4 * farRecoveryMap.w + 14] = 1;
const farStuck = actor(14.5, 4.5, 0.3);
farRecoveryMap.rememberPosition(Object.assign(farStuck, { x: 4.5, y: 4.5 }));
farStuck.x = 14.5;
assert.equal(farRecoveryMap.recoverEmbedded(farStuck), true, 'recovery extends beyond the local radius when the player is embedded');
assert.ok(farRecoveryMap.positionFree(farStuck, farStuck.x, farStuck.y));
assert.ok(farStuck.x < 10, 'the recovery destination remains in the last-safe connected component');

const nonFinite = actor(Number.NaN, Number.POSITIVE_INFINITY, 0.3);
farRecoveryMap.rememberPosition(Object.assign(nonFinite, { x: 4.5, y: 4.5 }));
nonFinite.x = Number.NaN; nonFinite.y = Number.POSITIVE_INFINITY;
assert.equal(farRecoveryMap.recoverEmbedded(nonFinite), true, 'non-finite interrupted coordinates recover through the safe anchor');
assert.deepEqual([nonFinite.x, nonFinite.y], [4.5, 4.5]);

// Recovery unlocks player input immediately, discards stale queued casts, and
// leaves cooldown/resource balance untouched.
const interrupted = { channel: {}, castLock: 2, castFree: true, queued: { skill: 'stale' }, z: 20,
  lunge: 1, attackAnimT: 0.5, moving: true, moveVec: [1, 0], moveTarget: [9, 9], path: [[8, 8]],
  pathFor: '8,8', attackTarget: {}, interact: {}, lootTarget: {}, cooldowns: { dash: 4 }, mana: 20 };
assert.equal(clearInterruptedMovement(interrupted), true);
for (const key of ['channel', 'queued', 'moveTarget', 'path', 'pathFor', 'attackTarget', 'interact', 'lootTarget']) assert.equal(interrupted[key], null, `${key} is cleared after recovery`);
assert.equal(interrupted.castLock, 0); assert.equal(interrupted.castFree, false); assert.equal(interrupted.z, 0);
assert.equal(interrupted.moving, false); assert.deepEqual(interrupted.moveVec, [0, 0]);
assert.equal(interrupted.cooldowns.dash, 4, 'movement recovery does not reset ability cooldowns');
assert.equal(interrupted.mana, 20, 'movement recovery does not grant resources');

const movedFromInvalid = actor(4.8, 4.5, 0.3);
movedFromInvalid.x = 4.7; recovery.rememberPosition(movedFromInvalid); movedFromInvalid.x = 4.8;
assert.equal(recovery.move(movedFromInvalid, 0.2, 0), false, 'normal movement first repairs an embedded start instead of moving through the wall');
assert.ok(recovery.positionFree(movedFromInvalid, movedFromInvalid.x, movedFromInvalid.y));

// Sealed gate tiles are treated as collision geometry by all new movement paths.
const gate = room(); gate.castleGateLocked = true;
gate.castleGateTiles = [4 * gate.w + 5];
const gateActor = actor(4.4, 4.5, 0.3);
const gateEnd = gate.traceMovement(gateActor, 2, 0);
assert.ok(gateEnd.x < 4.78, 'trace stops before a sealed gate using full body clearance');
const gateStuck = actor(5.1, 4.5, 0.3);
gateStuck.x = 4.7; gate.rememberPosition(gateStuck); gateStuck.x = 5.1;
assert.equal(gate.recoverEmbedded(gateStuck), true, 'an embedded character at a sealed gate recovers');
assert.equal(gateStuck.x, 4.7, 'gate recovery retains the last valid side of the locked crossing');

// Leap keeps its original arc/landing behavior while following only the collision-safe route.
const leapMap = room();
for (let y = 0; y < leapMap.h; y++) leapMap.block[y * leapMap.w + 5] = 1;
const jumper = actor(2.5, 4.5, 0.28), world = { map: leapMap, biome: { id: 'forest' } };
jumper.world = world;
const leap = new Leap({ world, src: jumper, tx: 8.5, ty: 4.5, dur: 0.7, dmg: [1, 1], el: 'phys', fx: 'physical' });
assert.ok(leap.tx < 5 - 0.22, 'Leap endpoint is clipped to the collision-safe side of a wall');
for (let i = 0; i < 5; i++) {
  leap.update(0.05);
  assert.ok(leapMap.positionFree(jumper, jumper.x, jumper.y), 'every airborne Leap position stays collision-valid');
}

assert.match(mapSource, /circle-vs-cell overlap/, 'shared map collision uses exact body-to-cell geometry');
assert.match(mapSource, /recoverEmbedded\(e, maxDistance = 3\)/, 'all players can use bounded embedded-position recovery');
assert.match(playerSource, /recoverEmbedded\?\.\(this\)/, 'player update checks and recovers an invalid location automatically');
assert.match(playerSource, /clearInterruptedMovement\(this\)/, 'recovery releases channel, cast lock, and stale input together');
assert.match(skillSource, /const safe = \(x, y\) => w\.map\.positionFree\(p, x, y\) && canLand\(x, y\)/,
  'Blink preserves teleport behavior but only chooses a full-body-safe landing');
assert.match(rogueSource, /w\.map\.positionFree\(p, x, y\).*w\.map\.los/,
  'Rogue Backstab validates full-body landing locations');
assert.match(ninjaSource, /traceMovement\(p, Math\.cos\(ang\) \* max, Math\.sin\(ang\) \* max\)/,
  'Ninja Iaido uses the shared continuous movement trace');
assert.match(ninjaSource, /moveStraight\(p, dx, dy\)/,
  'Ninja Backflip and forced movement cannot directly interpolate through walls');

console.log('movement_collision_safety.mjs: all checks passed');
