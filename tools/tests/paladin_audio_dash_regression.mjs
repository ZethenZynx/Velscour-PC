// Non-browser regression coverage for one-shot audio tracing and cursor-directed movement skills.
// Run: node tools/tests/paladin_audio_dash_regression.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { audioDiagnosticStats, setAudioDiagnosticSink, sfx } from '../../src/core/audio.js';
import { Dash, cursorDashLength } from '../../src/game/hazards.js';
import { SKILLS, isMovementSkill } from '../../src/data/skills.js';
import { TileMap } from '../../src/world/map.js';

const files = await Promise.all([
  'src/game/relicprocs.js', 'src/game/skillrun.js', 'src/game/controls.js',
  'src/game/sigs/paladin.js', 'src/game/rogue.js', 'src/game/ninja.js', 'src/game/player.js',
  'src/core/audio.js', 'src/world/map.js', 'src/data/skilldata.js',
].map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')));
const [relicprocs, skillrun, controls, paladin, rogue, ninja, playerSource, audio, mapSource, skilldata] = files;
const thunderWav = await readFile(new URL('../../assets/source/audio/oneshots/thunder_crack.wav', import.meta.url));
const fmtOffset = thunderWav.indexOf('fmt '), dataOffset = thunderWav.indexOf('data');
assert.ok(fmtOffset >= 0 && dataOffset >= 0, 'thunder sample is a valid WAV asset');
const channels = thunderWav.readUInt16LE(fmtOffset + 10), sampleRate = thunderWav.readUInt32LE(fmtOffset + 12);
const bytesPerSample = thunderWav.readUInt16LE(fmtOffset + 22) / 8;
assert.equal(thunderWav.readUInt32LE(dataOffset + 4) / (sampleRate * channels * bytesPerSample), 6,
  'the thunder_crack asset responsible for the post-combat tail is six seconds long');
const movementSkills = Object.values(SKILLS).filter(isMovementSkill);
assert.ok(movementSkills.length >= 30, 'movement ability audit covers registered class skill data');
assert.ok(movementSkills.some((skill) => skill.classId === 'paladin' && skill.kind === 'dash'));
assert.ok(movementSkills.some((skill) => skill.classId === 'rogue' && skill.kind === 'dash'));
assert.ok(movementSkills.some((skill) => skill.classId === 'ninja' && skill.kind === 'dash'));
assert.ok(movementSkills.every((skill) => ['blink', 'dash', 'leap'].includes(skill.kind)));

// Audio tracing is opt-in, records the originating event, and cannot keep active entries when
// audio is unavailable. This exercises the same central sfx() boundary used by all abilities.
assert.equal(audioDiagnosticStats().enabled, false, 'diagnostic overhead is disabled by default');
const trace = [];
const disableTrace = setAudioDiagnosticSink((event) => trace.push(event));
sfx('light', 0.35, 1, { source: 'test:chain-lightning', sourceActive: false });
assert.deepEqual(trace.map((event) => event.type), ['play', 'stop']);
assert.equal(trace[0].sound, 'light');
assert.equal(trace[0].source, 'test:chain-lightning');
assert.equal(trace[0].sourceActive, false);
assert.equal(audioDiagnosticStats().active, 0, 'completed or unavailable one-shots leave no active diagnostic record');
disableTrace();
assert.equal(audioDiagnosticStats().enabled, false, 'diagnostics can be disabled after investigation');

// Confirm the long cue was emitted by chain procs, not idle Paladin updates, and that the
// proc now uses the short lightning snap while level-up retains its separate thunder cue.
const chainStart = relicprocs.indexOf("case 'chain': {");
const chainEnd = relicprocs.indexOf("case 'consecrate':", chainStart);
const chain = relicprocs.slice(chainStart, chainEnd);
assert.match(chain, /source: 'relicProc:chain', sourceActive: \(\) =>/);
assert.match(chain, /sfx\('light', 0\.35, 1, audioTrace\)/);
assert.doesNotMatch(chain, /sfx\('thunder'/, 'chain procs no longer trigger the long thunder sample');
assert.match(audio, /thunder: \{ s: \['thunder_crack'\], v: 0\.6, max: 1 \}/,
  'the long shared sample was assigned to the chain proc sound name');
assert.match(audio, /noise\(t, 2\.4, \{ f0: 1400 \* p/, 'the long fallback sound remains available for its intended level-up cue');
assert.match(paladin, /sfx\('judgement_cast', 0\.78, 1, \{ source: 'Paladin\/Judgement cast'/);
assert.match(paladin, /sfx\('judgement_impact', 0\.9, 1, \{ source: 'Paladin\/Judgement impact'/);
const judgementUpdate = paladin.slice(paladin.indexOf('  update(p, s, dt) {'), paladin.indexOf('  fill:'));
assert.doesNotMatch(judgementUpdate, /sfx\(/, 'Judgement has no idle sound producer');
const strikeStart = skillrun.indexOf("    case 'strike': {");
const strikeEnd = skillrun.indexOf("    case 'fissure': {", strikeStart);
const strike = skillrun.slice(strikeStart, strikeEnd);
assert.match(strike, /pendingStrikes > 0/);
assert.match(strike, /strikeFx\(x, y, fx, E, !paladinLightningStrikes\)/);
assert.match(strike, /finally \{ pendingStrikes--; \}/, 'delayed impacts release their diagnostic source state on every exit path');

// Test distance and straight-line motion with a fake map that blocks at x=2. A hostile may
// exist at any position; Dash must not query the nearest-target API or steer toward it.
assert.equal(cursorDashLength(1, 1, 3, 1, 6), 2, 'near cursor stops at cursor distance');
assert.equal(cursorDashLength(1, 1, 20, 1, 6), 6, 'far cursor is clamped to the skill maximum');
assert.equal(cursorDashLength(1, 1, NaN, 1, 6), 0, 'invalid aim cannot produce runaway travel');

function makeDash({ tx, ty, maxDistance = 4, n = 1 }) {
  const player = { x: 0.5, y: 0.5, r: 0.2, team: 'player', isPlayer: true, face(a) { this.facing = a; } };
  const world = {
    creatures: [{ x: -2, y: 0.5, team: 'enemy' }],
    hostiles() { return []; },
    nearestHostile() { throw new Error('directional Dash must not search for an enemy target'); },
    map: { moveDash(entity, dx, dy) {
      const nx = entity.x + dx, ny = entity.y + dy;
      entity.x = nx; entity.y = ny; return Math.hypot(dx, dy);
    } },
  };
  const dash = new Dash({ world, src: player, ang: Math.atan2(ty - player.y, tx - player.x),
    len: cursorDashLength(player.x, player.y, tx, ty, maxDistance), dmg: [1, 1], el: 'phys', n, speed: 10 });
  let steps = 0;
  while (dash.update(0.05)) assert.ok(++steps < 200, 'dash sequence always terminates');
  return { player, dash, world };
}

for (const [tx, ty] of [[4, 0.5], [-3, 0.5], [0.5, 5], [4, 4]]) {
  const { player } = makeDash({ tx, ty });
  const aim = Math.atan2(ty - 0.5, tx - 0.5);
  const travelledAngle = Math.atan2(player.y - 0.5, player.x - 0.5);
  assert.ok(Math.abs(Math.atan2(Math.sin(travelledAngle - aim), Math.cos(travelledAngle - aim))) < 1e-6,
    `dash follows cursor direction for (${tx}, ${ty})`);
}
const multi = makeDash({ tx: 8, ty: 0.5, maxDistance: 4, n: 3 });
assert.ok(Math.abs(multi.player.x - 4.5) < 1e-6, 'multi-segment dash keeps the intended total range instead of tripling it');

function runTileDash(map, [x, y], [tx, ty], maxDistance = 10, frameDt = 0.05) {
  const player = { x, y, r: 0.2, team: 'player', isPlayer: true, face(a) { this.facing = a; } };
  const world = { map, hostiles() { return []; } };
  const dash = new Dash({ world, src: player, ang: Math.atan2(ty - y, tx - x),
    len: cursorDashLength(x, y, tx, ty, maxDistance), dmg: [1, 1], el: 'phys', speed: 10 });
  let steps = 0;
  while (dash.update(frameDt)) assert.ok(++steps < 200, 'collision-limited dash always terminates');
  return { player, dash };
}

const tileMap = new TileMap(7, 5);
tileMap.t.fill(1); tileMap.block[2 * tileMap.w + 3] = 1;
const blockedPlayer = { x: 1.5, y: 2.5, r: 0.25, isPlayer: true };
assert.equal(tileMap.moveStraight(blockedPlayer, 2, 0.8), true, 'actual map collision advances to the nearest valid body position');
assert.ok(blockedPlayer.x < 3 && blockedPlayer.y > 2.5, 'a blocked straight move stops safely at the wall without passing through it');
assert.equal(tileMap.positionFree(blockedPlayer, blockedPlayer.x, blockedPlayer.y), true, 'the blocked movement endpoint remains collision-valid');
assert.match(mapSource, /moveDash\(e, dx, dy\)/, 'cursor dashes use the dedicated collision-safe sliding movement');

// Direct walls stop at the last valid body position; diagonal movement projects onto a
// wall and can follow its edge, pass around an open end, fit a corridor, and respect bounds.
const directWallMap = new TileMap(10, 7); directWallMap.t.fill(1);
for (let y = 0; y < directWallMap.h; y++) directWallMap.block[y * directWallMap.w + 4] = 1;
const direct = runTileDash(directWallMap, [2.5, 3.5], [9, 3.5]);
assert.ok(direct.player.x <= 3.84 && direct.player.x > 3.7, 'direct wall dash stops at the nearest valid body position');
assert.equal(direct.player.channel, null, 'wall contact immediately releases the dash channel');
const lowFps = runTileDash(directWallMap, [2.5, 5.5], [9, 5.5], 10, 0.8);
assert.ok(directWallMap.positionFree(lowFps.player, lowFps.player.x, lowFps.player.y),
  'a large single-frame dash step still ends at a valid full-body position');
assert.ok(lowFps.player.x <= 3.84, 'frame-time spikes cannot tunnel a dash through the wall');
assert.equal(lowFps.player.channel, null, 'a dash obstructed during a frame spike releases its movement channel');
const sliding = runTileDash(directWallMap, [2.5, 1.5], [8, 6]);
assert.ok(sliding.player.x <= 3.84 && sliding.player.y > 2, 'angled dash slides along a wall without crossing it');
const cornerMap = new TileMap(10, 9); cornerMap.t.fill(1);
for (let y = 0; y < 3; y++) cornerMap.block[y * cornerMap.w + 4] = 1;
const corner = runTileDash(cornerMap, [2.5, 1.5], [8, 7]);
assert.ok(corner.player.x > 4 && corner.player.y > 3.16, 'dash can continue around an open wall corner after sliding');
const corridorMap = new TileMap(10, 5);
for (let x = 1; x < 9; x++) corridorMap.t[2 * corridorMap.w + x] = 1;
const corridor = runTileDash(corridorMap, [1.5, 2.5], [8.5, 2.5]);
assert.ok(corridor.player.x > 7.5, 'dash traverses a one-tile corridor with correct body clearance');
const boundaryMap = new TileMap(8, 6); boundaryMap.t.fill(1);
const boundary = runTileDash(boundaryMap, [1.5, 2.5], [-8, 2.5]);
assert.ok(boundary.player.x >= 0.16 && boundary.player.x < 0.3, 'dash stops at map boundaries instead of leaving the map');

// Mouse target selection keeps the cursor tile for movement skills; ordinary movement kinds
// are centralized, while special skills still inspect the same cursor coordinates.
assert.match(controls, /if \(isMovementSkill\(sk\)\)[\s\S]*?p\.tryUseSkill\(sk, tx, ty, null\);[\s\S]*?return;/);
assert.match(controls, /!isMovementSkill\(SKILLS\[G\.char\.bar\[0\]\]\)/, 'held mouse attacks cannot repeatedly activate a movement skill');
assert.match(controls, /input\.down\(k\) && p\.castLock <= 0 && !isMovementSkill\(sk\)/, 'held hotkeys cannot repeat movement skills');
assert.match(skillrun, /cursorDashLength\(p\.x, p\.y, tx, ty, 5 \* \(m\.range \?\? 1\)\)/);
assert.match(playerSource, /sk\.kind === 'dash' && \(!Number\.isFinite\(tx\).*?dist\(this\.x, this\.y, tx, ty\) <= 0\.05\)/,
  'zero-length and invalid dash requests do not spend a charge');
assert.match(mapSource, /moveStraight\(e, dx, dy, ghost = false\)/);
assert.match(skilldata, /Swashbuckle\|dash\|/);
assert.match(skilldata, /Crossing Blades\|dash\|/);
assert.match(rogue, /case 'backstab': return backstab\(p, sk, tx, ty, C, ambush\)/,
  'Rogue Backstab retains its cursor-selected enemy behavior');
assert.match(ninja, /case 'drop': return heavensDrop\(p, sk, tx, ty, C\)/,
  'Ninja Heaven’s Drop retains its cursor-selected enemy behavior');
assert.match(rogue, /w\.nearestHostile\(p\.team, tx, ty, 2\.2, false\)/);
assert.match(ninja, /w\.nearestHostile\(p\.team, tx, ty, 2\.2, false\)/);
console.log('paladin_audio_dash_regression.mjs: all checks passed');
