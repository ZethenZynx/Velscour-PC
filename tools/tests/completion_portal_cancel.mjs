import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, rifts, ui] = await Promise.all([
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/rifts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/ui.js', import.meta.url), 'utf8'),
]);

test('campaign/overworld completion choices can cancel and reopen without consuming the exit', () => {
  const method = game.slice(game.indexOf('  portalChoice(world) {'), game.indexOf('  awardFloorClear(depth) {'));
  assert.match(method, /closable:\s*true/);
  assert.match(method, /buttons:\s*\[\{\s*label:\s*'Cancel'/);
  assert.match(method, /choiceState\s*=\s*world\.completionPortalChoice/);
  assert.match(method, /choiceState\.selected\s*=\s*sel/);
  assert.match(method, /if \(choiceState\.used\) return/);
  assert.match(method, /if \(firstClear\) this\.brokeThrough\(world\.depth\)/);
  assert.doesNotMatch(method, /world\.portals\.(?:splice|filter)/);
});

test('Breach, Rift, checkpoint and throne completion dialogs expose a non-transitioning Cancel action', () => {
  assert.match(game, /Breach Floor \$\{floor\} Sealed[\s\S]{0,400}buttons:\s*\[\{\s*label:\s*'Cancel'/);
  assert.match(game, /Unbound Checkpoint: Floor \$\{floor\} Cleared[\s\S]{0,500}closable:\s*true[\s\S]{0,120}label:\s*'Cancel'/);
  assert.match(game, /buttons:\s*\[[\s\S]{0,220}label:\s*'Cancel'[\s\S]{0,500}Stay in Throne Room|label:\s*'Cancel'/);
  assert.match(rifts, /buttons:\s*\[\{\s*label:\s*'Cancel'/);
});

test('Escape closes a closable modal in the modal branch instead of opening the pause menu', () => {
  assert.match(game, /\} else if \(input\.consume\('Escape'\)\) \{\s*const top = UI\.screensEl\.lastElementChild;[\s\S]*?top\.dispatchEvent\(new PointerEvent\('pointerdown'\)\);\s*\}/);
  assert.match(ui, /if \(closable\) wrap\.addEventListener\('pointerdown', \(e\) => \{ if \(e\.target === wrap\) close\(\); \}\)/);
});
