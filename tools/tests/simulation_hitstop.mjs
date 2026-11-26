import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gameSource = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

// The render loop supplies elapsed real time to every simulation update, with
// an intentional 50 ms safety clamp for unusually long stalls.
assert.match(mainSource, /const raw = Math\.max\(0, \(now - last\) \/ 1000\), dt = Math\.min\(0\.05, raw\)/);
assert.match(mainSource, /game\.update\(dt\)/);

// Hit-stop requests may decay, but must not gate world updates. The old branch
// skipped controls and the entire world update until the timer reached zero.
assert.match(gameSource, /if \(G\.hitStop > 0\) G\.hitStop = Math\.max\(0, G\.hitStop - dt\);/);
assert.doesNotMatch(gameSource, /else\s+if\s*\(G\.hitStop\s*>\s*0\)/);
assert.match(gameSource, /if \(!G\.paused\)\s*\{\s*controls\.update\(dt\);[\s\S]*?w\.update\(dt\);/);

// Reproduce repeated qualifying hits at 120 rendered frames per second. Under
// the old branch, each world tick renewed a 35 ms global stop, so only one in
// five updates advanced combat. The corrected path advances all 120 updates.
const run = ({ pauseWholeWorld, repeatHitStop }) => {
  const dt = 1 / 120;
  let hitStop = 0, worldSeconds = 0, worldUpdates = 0;
  for (let frame = 0; frame < 1200; frame++) {
    if (hitStop > 0) {
      hitStop = Math.max(0, hitStop - dt);
      if (pauseWholeWorld) continue;
    }
    worldSeconds += dt;
    worldUpdates++;
    if (repeatHitStop) hitStop = Math.max(hitStop, 0.035); // a large critical hit during the update
  }
  return { worldSeconds, worldUpdates, ratio: worldSeconds / 10 };
};

const baseline = run({ pauseWholeWorld: true, repeatHitStop: false });
const old = run({ pauseWholeWorld: true, repeatHitStop: true });
const corrected = run({ pauseWholeWorld: false, repeatHitStop: true });
assert.ok(Math.abs(baseline.worldSeconds - 10) < 1e-9, 'empty and ordinary combat frames preserve wall-clock simulation');
assert.ok(old.ratio < 0.21, `expected old repeated hit-stop to slow simulation, got ${old.ratio}`);
assert.ok(Math.abs(corrected.worldSeconds - 10) < 1e-9);
assert.equal(corrected.worldUpdates, 1200);
assert.ok(Math.abs(corrected.ratio - 1) < 1e-9);

console.log(JSON.stringify({ noRepeatedHitStopBaseline: baseline, oldRepeatedHitStop: old, corrected: corrected }, null, 2));
