// Repeatable non-browser performance and stress suite.
// Run from the repository root: node tools/tests/performance_audit.mjs
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = [
  ['Shared VFX cleanup and ambient lighting', ['tools/tests/performance_hotpaths.mjs']],
  ['Storm Tether combat and target-search stress', ['tools/tests/storm_tether_fourth_attempt.mjs']],
  ['Lightning renderer and geometry', ['tools/tests/lightning_performance.mjs']],
  ['Pirate Seas large-wave hot paths', ['tools/tests/seabattle_hotpaths.mjs']],
  ['Ground-loot distance and pickup checks', ['tools/tests/loot_hotpaths.mjs']],
  ['Iron Express lights, scenery, and map generation', ['tools/tests/ghosttrain_hotpaths.mjs']],
  ['Gore cleanup and cap regression', ['tools/tests/gore_performance.mjs']],
  ['Environmental trap profiles and placement', ['--test', 'tools/tests/environmental_traps.mjs']],
  ['Eternal Breach randomized island layouts', ['tools/tests/breach_gen.mjs', '10', '1,11,21']],
  ['Sea of Sand generation (100 seeds)', ['tools/tests/sea_of_sand_generation.mjs']],
  ['Terrain and minimap rendering rules', ['tools/tests/minimap_terrain_render.mjs']],
];

let failed = false;
for (const [label, args] of suite) {
  console.log(`\n=== ${label} ===`);
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  console.log(`Elapsed: ${((performance.now() - start) / 1000).toFixed(2)} s`);
  if (result.error) { console.error(result.error); failed = true; }
  else if (result.status !== 0) { console.error(`Failed with exit code ${result.status}`); failed = true; }
}
console.log(`\nNon-browser performance suite ${failed ? 'FAILED' : 'PASSED'} (${suite.length} scenarios).`);
process.exitCode = failed ? 1 : 0;
