// Heirlooms, Covenants, Sigil Stones, Glyphwords, the Reliquary and its Codex, and Town Commissions (data/relics.js,
// game/relicprocs.js, game/reliquary.js, ui/reliquary.js, game/commissions.js).
//   node tools/tests/relics.js
// 1. Data: every power, stat and Sigil a relic names exists; recipes fit their bases; the drop odds come out right.
// 2. (Balance in item levels is tools/tests/relic_balance.js.)
// 3. Live: a Glyphword is written by socketing Sigils in order (and unwritten by prying them out), set bonuses and
//    procs reach the hero, the Codex records finds, the Reliquary stores and returns items for another hero.
// 4. Commissions: offered in town, objects placed in a matching level, opened by auto-play, chapters pay out.
// Shots: tooltips, the Reliquary (vault and Codex), the Quest Log, a commission object in a level.
const { openGame, report } = require('./harness');

(async () => {
  const { browser, page, errors, shot } = await openGame({ width: 1600, height: 900 });
  let fails = 0;
  const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
  await page.evaluate(() => { try { localStorage.removeItem('velscour_reliquary_v1'); } catch (e) {} });
  await page.evaluate(async () => { await window.VELSCOUR.game.newChar('paladin', 'Relicbot'); });
  await page.waitForTimeout(1500);

  // ---- 1: data and drop odds
  const d = await page.evaluate(async () => {
    const I = await import('/src/data/items.js');
    const R = await import('/src/data/relics.js');
    const { G } = window.VELSCOUR, c = G.char, p = G.player;
    const out = { bad: [] };
    for (const h of R.HEIRLOOMS) { if (!R.POWERS[h.power]) out.bad.push(h.id); for (const [s] of h.lines) if (!I.AFFIX_BY_STAT[s]) out.bad.push(h.id + ':' + s); }
    for (const g of R.GLYPHWORDS) for (const sl of g.slots) if (I.HOLLOW[sl] < g.sig.length) out.bad.push(g.id);
    const savedRandom = Math.random;
    const heirloom = R.makeHeirloom(999, { id: 'verdict' });
    const covenant = R.makeCovenant(15, { pieceId: 'templar_wpn', rarity: 1, maxRarity: 1 });
    const heirloomRules = heirloom?.ilvl === 1 && heirloom.req === 1 && heirloom.rarity === I.RARITY_COMMON && R.relicItemStats(heirloom).length === 0 && I.itemSellValue(heirloom) === 0;
    const covenantTier = covenant?.ilvl === 15 && covenant.tier === I.tierOf(15) && covenant.rarity === 1;
    Math.random = () => 0;
    const lowTierCovenant = R.maybeRelic(I.rollItem(1, { slot: 'weapon', rarity: 0, base: 'mace', generic: true }), 1, []);
    const old = R.makeCovenant(70, { pieceId: 'templar_head', rarity: 3, maxRarity: 3 });
    old.rarity = 3; old.uid = 'legacy-set-uid'; old.upg = 4; old.sockets = 1; old.maxSockets = 3; old.gems = [{ gem: 'ruby', tier: 2 }];
    const migrated = R.migrateCovenantItem(old);
    const { migrate: migrateSave } = await import('/src/game/save.js');
    const saveFixture = JSON.parse(JSON.stringify(c));
    const saveItem = R.makeCovenant(70, { pieceId: 'templar_head', preview: true });
    saveItem.rarity = 3; saveItem.uid = 'save-set-uid'; saveItem.upg = 2; saveItem.sockets = 1; saveItem.gems = [{ gem: 'ruby', tier: 1 }];
    saveFixture.bag[0] = saveItem; saveFixture.covenantTier20V1 = false;
    migrateSave(saveFixture);
    const saveMigration = saveFixture.bag.some((it) => it?.uid === 'save-set-uid' && it.rarity === 3 && it.upg === 2 && it.gems?.[0]?.gem === 'ruby');
    const Q = await import('/src/game/reliquary.js');
    const vaultItem = R.makeCovenant(70, { pieceId: 'templar_head', preview: true });
    vaultItem.rarity = 3; vaultItem.uid = 'vault-set-uid';
    const vaultData = { tabs: [Array.from({ length: 96 }, (_, i) => i === 0 ? vaultItem : null)], codex: {}, lines: 0 };
    localStorage.setItem('velscour_reliquary_v1', JSON.stringify(vaultData)); Q.resetReliquaryCache();
    const vaultMigration = Q.reliquary().tabs[0][0]?.uid === 'vault-set-uid' && Q.reliquary().tabs[0][0]?.rarity === 3;
    const migration = { ok: !migrated && old.rarity === 3 && old.uid === 'legacy-set-uid' && old.upg === 4 && old.gems.length === 1 && old.gems[0].gem === 'ruby' && old.rid === 'templar_head' && saveMigration && vaultMigration };
    Math.random = savedRandom;
    out.tier = { heirloomRules, covenantTier, lowTierCovenant: lowTierCovenant.relic === 'cov' && lowTierCovenant.ilvl === 1 && lowTierCovenant.rarity === 0, migration };
    // drop odds over 200k level-150 drops at the newly eligible depth
    G.world = { depth: 456 };
    let heir = 0, cov = 0, myth = 0;
    const eligibleHeirlooms = R.HEIRLOOMS.map((h) => h.id);
    for (let i = 0; i < 50000; i++) { const it = R.maybeRelic(I.rollItem(150), 1, eligibleHeirlooms); if (it.relic === 'heir') heir++; else if (it.relic === 'cov') cov++; else if (it.rarity === 5) myth++; }
    out.odds = { heir: heir / 500, cov: cov / 500, myth: myth / 500 };
    p.recompute();
    return out;
  });
  console.log(JSON.stringify(d.odds));
  check(!d.bad.length, `relic data consistent ${d.bad.join(',')}`);
  check(Object.values(d.tier).every(Boolean), `Heirlooms remain Tier 1 and Covenant drops follow their eligible tier; existing Covenant equipment is not rewritten`);
  check(d.odds.heir > 2 && d.odds.heir < 35, `Heirloom drop chance is active for eligible account entries (${d.odds.heir.toFixed(2)}% of drops)`);
  check(d.odds.cov > 1 && d.odds.cov < 10, `Covenant pieces remain repeatable at eligible tiers (${d.odds.cov.toFixed(2)}% of drops)`);
  // ---- 3: live Glyphword, procs, Codex, Reliquary
  const live = await page.evaluate(async () => {
    const { G } = window.VELSCOUR, c = G.char, p = G.player;
    const I = await import('/src/data/items.js');
    const R = await import('/src/data/relics.js');
    const { addToBag } = await import('/src/game/player.js');
    const { socketGem } = await import('/src/ui/inventory.js');
    const Q = await import('/src/game/reliquary.js');
    const out = {};
    c.level = 120; c.gold = 1e9; p.recompute();
    const staff = I.rollItem(110, { slot: 'weapon', rarity: 0, base: 'staff', generic: true }); staff.req = 1; staff.sockets = 4;
    addToBag(c, staff);
    const wantGlyph = R.GLYPH_BY_ID.starfall;
    for (const r of wantGlyph.sig) addToBag(c, I.makeGem('sig', r));
    for (const r of wantGlyph.sig) { const gi = c.bag.findIndex((b) => b && b.type === 'gem' && b.gem === 'sig' && b.tier === r); socketGem(gi, { where: 'bag', idx: c.bag.indexOf(staff) }); }
    out.glyph = I.itemName(staff);
    out.codexGlyph = !!Q.reliquary().codex['g:starfall'];
    out.sigilsNoted = Object.keys(Q.reliquary().codex).filter((k) => k.startsWith('s:')).length;
    const bi = c.bag.indexOf(staff);
    const { equipFromBag } = await import('/src/ui/inventory.js');
    equipFromBag(bi, 'weapon');
    out.procs = p.st.procs.map((x) => x.name);
    out.skillsAll = p.st.skillsAll;
    // pry the stones out: plain again
    const g = staff.gems; staff.gems = []; out.plain = I.itemName(staff) !== 'Starfall'; staff.gems = g;
    // a full Templar set: bonuses and the Pyre power
    for (const q of R.COVENANTS[0].pieces) { const it = R.makeCovenant(110, { pieceId: q.id, preview: true }); it.req = 1; c.equip[q.slot] = it; Q.noteFind(it); }
    p.recompute();
    out.setProcs = p.st.procs.map((x) => x.name);
    out.reduce = p.st.reduce;
    // the Reliquary: store from the bag, a new hero sees it
    const h = R.makeHeirloom(110, { id: 'verdict' }); addToBag(c, h);
    out.codexHeir = !!Q.reliquary().codex['h:verdict'];
    Q.addToVault(h); c.bag[c.bag.indexOf(h)] = null;
    out.prog = Q.codexProgress();
    out.tabs = Q.openTabs();
    // auto-play writes a Glyphword from the bag's Sigils on a plain sword
    const { Auto } = await import('/tools/tests/auto_player.js');
    const sw = I.rollItem(115, { slot: 'weapon', rarity: 0, base: 'sword', generic: true }); sw.req = 1; sw.sockets = 0; addToBag(c, sw);
    addToBag(c, I.makeGem('sig', 0)); addToBag(c, I.makeGem('sig', 5));
    Auto.glyphwork();
    out.autoGlyph = I.itemName(sw);
    return out;
  });
  console.log(JSON.stringify(live));
  check(live.glyph === 'Starfall', `Sigils socketed in order write a Glyphword (${live.glyph})`);
  check(live.codexGlyph && live.sigilsNoted >= 4, 'the Codex records the Glyphword and the Sigils');
  check(live.procs.includes('Starfall') && live.skillsAll >= 1, 'the Glyphword power and its +1 to All Skills reach the hero');
  check(live.plain, 'prying the Sigils out makes the staff plain again');
  check(live.setProcs.includes('Pyre of Vows') && live.reduce > 0, 'a full Covenant set gives its bonuses and power');
  check(live.autoGlyph === 'Kindle', `auto-play writes a Glyphword at the jeweler (${live.autoGlyph})`);
  check(live.codexHeir && live.prog.have >= 8, `Codex: ${live.prog.have}/${live.prog.total}`);

  // vault survives a reload for another hero
  await page.evaluate(async () => { await window.VELSCOUR.game.newChar('wizard', 'Vaultbot'); });
  await page.waitForTimeout(1200);
  const other = await page.evaluate(async () => {
    const Q = await import('/src/game/reliquary.js');
    Q.resetReliquaryCache();
    const r = Q.reliquary();
    return { inVault: r.tabs.flat().some((it) => it && it.rid === 'verdict'), codex: Object.keys(r.codex).length };
  });
  check(other.inVault && other.codex >= 8, 'another hero sees the shared vault and Codex');

  // shots: tooltips + Reliquary + Codex
  await page.evaluate(async () => {
    const { G } = window.VELSCOUR, c = G.char;
    G.ui.reliquary.open();
  });
  await page.waitForTimeout(500);
  await shot('relics_vault');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.reliquary-panel .tab')].find((x) => x.textContent === 'Codex'); b && b.click(); });
  await page.waitForTimeout(500);
  await shot('relics_codex');
  await page.evaluate(() => window.VELSCOUR.G.ui.closeAll());

  // ---- 4: Commissions
  const comm = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR, c = G.char;
    const C = await import('/src/game/commissions.js');
    const { Auto: Auto0 } = await import('/tools/tests/auto_player.js');
    const { BIOME_BY_ID } = await import('/src/data/biomes.js');
    c.deepest = 3; c.depth = 3; c.level = 14; c.statPoints = 13 * 5; c.skillPoints = 28; Auto0.spendStats(); Auto0.spendSkills(); Auto0.arrangeBar(); G.player.recompute();
    game.enterTown();
    await new Promise((r) => setTimeout(r, 800));
    const out = { open: C.commState(c).open.map((e) => e.id) };
    // the first chapter of the bells: three bells in the Desecrated Cathedral
    await game.teleportToBiome(BIOME_BY_ID.cathedral);
    await new Promise((r) => setTimeout(r, 1500));
    const objs = G.world.chests.filter((ch) => ch.commission);
    out.objs = objs.length;
    out.reach = objs.map((o) => G.world.map.walkable(o.x, o.y));
    G.godMode = true;
    return out;
  });
  console.log(JSON.stringify(comm));
  check(comm.open[0] === 'bells' && comm.open.length === 1, `the first commission is offered in town at depth 3 (${comm.open.join(',')})`);
  check(comm.objs === 3 && comm.reach.every(Boolean), 'three Silent Bells placed on the floor of a Cathedral level');
  // the bot walks to them
  const bot = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR, c = G.char;
    const { Auto } = await import('/tools/tests/auto_player.js');
    const C = await import('/src/game/commissions.js');
    const e = C.commState(c).open.find((x) => x.id === 'bells');
    Auto.toggle(true);
    for (let t = 0; t < 30 * 900 && e.ch === 0; t++) {
      G.dt = 1 / 30; G.time += G.dt; G.frame++; game.update(1 / 30);
      if (t % 90 === 0) await new Promise((r) => setTimeout(r, 0));
      if (G.world.kind !== 'dungeon') break;
    }
    Auto.toggle(false);
    return { ch: e.ch, n: e.n, kind: G.world.kind };
  });
  console.log(JSON.stringify(bot));
  check(bot.ch >= 1, `auto-play rang the bells: chapter 1 done (chapter ${bot.ch}, ${bot.n})`);
  await page.keyboard.press('q'); await page.waitForTimeout(400);
  await shot('relics_questlog');
  report(errors);
  if (fails) { console.log(fails + ' FAILED'); process.exitCode = 1; }
  await browser.close();
})();
