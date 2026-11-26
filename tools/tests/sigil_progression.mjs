import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { SIGILS, SIGIL_MAX, makeGem, rollSigil, sigilCap, sigilMinDepth } from '../../src/data/items.js';
import { breachDepth } from '../../src/data/breach.js';
import { groundRewardSigilDepth, rollGroundSigil } from '../../src/game/loot.js';
import { riftLootDepth, riftRewardProgressionDepth } from '../../src/data/rifts.js';

test('all Sigil ranks unlock at the intended 25-depth thresholds and remain eligible deeper', () => {
  const random = Math.random;
  try {
    Math.random = () => 0.999999; // keep the highest currently eligible rank
    assert.equal(SIGILS.length, 20);
    for (let rank = 0; rank <= SIGIL_MAX; rank++) {
      const threshold = sigilMinDepth(rank);
      assert.equal(threshold, 1 + rank * 25, `${SIGILS[rank].name} unlock depth`);
      const below = Math.max(1, threshold - 1);
      assert.equal(sigilCap(below), Math.max(0, rank - 1), `${SIGILS[rank].name} immediately below threshold`);
      assert.equal(sigilCap(threshold), rank, `${SIGILS[rank].name} at threshold`);
      assert.equal(sigilCap(threshold + 1), rank, `${SIGILS[rank].name} immediately above threshold`);
      assert.equal(rollSigil(below).tier, Math.max(0, rank - 1), `${SIGILS[rank].name} cannot drop early`);
      assert.equal(rollSigil(threshold).tier, rank, `${SIGILS[rank].name} is available at its threshold`);
      assert.equal(rollSigil(threshold + 1).tier, rank, `${SIGILS[rank].name} remains eligible after its threshold`);
      assert.equal(makeGem('sig', rank).ilvl, threshold, `${SIGILS[rank].name} item level metadata agrees with unlock depth`);
      let draws = 0;
      const toRank = [...Array(SIGIL_MAX - rank).fill(0), 0.999999];
      Math.random = () => toRank[draws++] ?? 0.999999;
      assert.equal(rollSigil(Number.MAX_SAFE_INTEGER).tier, rank, `${SIGILS[rank].name} remains eligible in deep content`);
    }
  } finally {
    Math.random = random;
  }
});

test('shared Sigil reward depth follows the owning mode and Rift normal-progression cap', () => {
  const originalChar = G.char;
  try {
    G.char = { depth: 500, deepest: 499 };
    const campaign = { kind: 'dungeon', depth: 26 };
    const endgame = { kind: 'dungeon', depth: 501 };
    const breach = { kind: 'dungeon', depth: breachDepth(8), breach: { floor: 8 } };
    const unbound = { kind: 'dungeon', depth: 100, unbound: true };
    assert.equal(groundRewardSigilDepth(campaign), 26);
    assert.equal(groundRewardSigilDepth(endgame), 501);
    assert.equal(groundRewardSigilDepth(breach), 80, 'Eternal Breach uses its effective ten-depth-per-floor progression');
    assert.equal(groundRewardSigilDepth(unbound), 100, 'Unbound boss rewards use their owning depth');

    for (const tier of [1, 2, 20, 100]) {
      const world = { kind: 'dungeon', depth: 100, rift: { tier } };
      const effective = groundRewardSigilDepth(world, riftLootDepth(tier));
      assert.equal(effective, riftRewardProgressionDepth(tier, G.char), `Rift tier ${tier} uses shared effective progression depth`);
      assert.ok(rollGroundSigil(world, riftLootDepth(tier), 99).tier <= sigilCap(effective), `Rift tier ${tier} cannot bypass the effective Sigil cap`);
    }

    G.char = { depth: 50, deepest: 49 };
    const overleveledRift = { kind: 'dungeon', depth: 100, rift: { tier: 100 } };
    assert.equal(groundRewardSigilDepth(overleveledRift, riftLootDepth(100)), 50);
    assert.ok(rollGroundSigil(overleveledRift, riftLootDepth(100), 99).tier <= sigilCap(50), 'Rift tier cannot outrun normal-depth Sigil eligibility');
  } finally {
    G.char = originalChar;
  }
});

test('Sigil descriptions use the same authoritative unlock threshold as the drop table', async () => {
  const { readFile } = await import('node:fs/promises');
  const [itemTip, reliquaryTip, wiki, commissions, happenings, rifts, velscour] = await Promise.all([
    readFile(new URL('../../src/ui/itemui.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/reliquary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/wiki/wiki-shell.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/commissions.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/happenings.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/rifts.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/velscour.js', import.meta.url), 'utf8'),
  ]);
  assert.match(itemTip, /drops from Depth \$\{sigilMinDepth\(r\)\} onward/);
  assert.match(reliquaryTip, /from Depth \$\{sigilMinDepth\(e\.rank\)\} onward/);
  assert.match(wiki, /Drops from Depth \$\{itemsMod\.sigilMinDepth\(rank\)\} onward/);
  for (const source of [itemTip, reliquaryTip, wiki]) assert.doesNotMatch(source, /rank \* 24|r \* 24|e\.rank \* 24/);
  for (const source of [commissions, happenings, rifts, velscour]) assert.doesNotMatch(source, /\brollSigil\s*\(/, 'game reward sources use the shared mode-aware Sigil roller');
  assert.match(velscour, /makeGem\('sig', sigilCap\(sigilDepth\)\)/, 'Velscour’s guaranteed Sigil respects its effective depth cap');
  assert.doesNotMatch(velscour, /15 \+ Math\.floor\(rand\(/, 'Velscour has no hard-coded premature high-rank Sigil reward');
});

