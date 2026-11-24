// The spectator's features (things to do while the hero plays): gilded critters to tap, the Divine Smite meter,
// stance dial, the three-portal choice at a cleared exit (auto-play's countdown), and Greed settings/rewards.
// Taps go through the real input (mouse clicks, or touch taps with `mobile`) and must never move the hero or take
// over from auto-play. Screenshots: spectate_*.png.
//   node tools/tests/spectate.js            # 1280x720 mouse
//   node tools/tests/spectate.js mobile     # 844x390 touch
const { openGame, report } = require('./harness');
const mobile = process.argv[2] === 'mobile';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) { fails++; process.exitCode = 1; } };

(async () => {
  const { browser, page, errors, shot } = await openGame(mobile ? { width: 844, height: 390, mobile: true } : {});
  const tap = (x, y) => (mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tag = mobile ? '_mobile' : '';
  const press = async (sel) => { const bb = await (await page.$(sel)).boundingBox(); await tap(bb.x + bb.width / 2, bb.y + bb.height / 2); }; // pulsing buttons never hold still for page.click
  // a hero in a catacombs depth, god mode, auto-play on (spawning critters must not need anything else)
  await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    await game.newChar('wizard', 'Spectator');
    G.char.nextBiome = 'catacombs'; G.char.depth = 3;
    game.enterDungeon();
  });
  await page.waitForFunction(() => window.VELSCOUR.G.world && window.VELSCOUR.G.world.kind === 'dungeon' && document.querySelector('#loading').classList.contains('hidden'), null, { timeout: 30000 });
  await page.evaluate(() => { const { G } = window.VELSCOUR; G.godMode = true; for (const m of G.world.creatures) if (m.team === 'enemy' && m !== G.world.boss) m.dead = true; });
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------- 4. gilded critters
  for (const key of ['wisp', 'moth', 'scarab', 'prism']) {
    const pos = await page.evaluate(async (key) => {
      const { G } = window.VELSCOUR;
      const { spawnCritter } = await import('/src/game/critters.js');
      const { Auto } = await import('/tools/tests/auto_player.js');
      if (!Auto.on) Auto.toggle(true);
      for (const c of G.world.critters || []) c.caught = true;
      const cr = spawnCritter(G.world, key);
      if (!cr) return null;
      cr.x = G.player.x + 1.2; cr.y = G.player.y - 1.2; cr.K = { ...cr.K, speed: 0.05 }; // hold still for the test's click
      G.player.moveTarget = null; G.player.lootTarget = null;
      window._before = { gold: G.char.gold, xp: G.char.xp, lvl: G.char.level, pots: { ...G.char.potions }, gems: G.char.bag.filter((b) => b && b.type === 'gem').length, n: G.char.critters || 0 };
      const [x, y] = cr.screen();
      return { x, y, tutorial: G.critterTutorial === cr, rendered: cr.tutorialRendered, arrow: cr.showArrow };
    }, key);
    if (!pos) { check(false, `${key}: spawned`); continue; }
    if (key === 'wisp') {
      const spawning = await page.evaluate(() => {
        const cr = window.VELSCOUR.G.critterTutorial;
        return !!cr && cr.t < 1 / 3 && !cr.tutorialRendered && !window.VELSCOUR.G.paused;
      });
      check(pos.tutorial && spawning, 'tutorial waits while the critter completes its fade-in');
      await page.waitForTimeout(550);
      const stillAppearing = await page.evaluate(() => {
        const cr = window.VELSCOUR.G.critterTutorial;
        return !!cr && cr.t < 1 && !cr.tutorialRendered && !window.VELSCOUR.G.paused;
      });
      check(pos.tutorial && stillAppearing, 'tutorial leaves time for the critter spawn effects to finish');
      await page.waitForFunction(() => window.VELSCOUR.G.paused && !!window.VELSCOUR.G.critterTutorial?.tutorialRendered, null, { timeout: 2000 });
      const visible = await page.evaluate(() => window.VELSCOUR.G.paused && !!window.VELSCOUR.G.critterTutorial?.tutorialRendered);
      check(pos.tutorial && visible, 'first critter finishes appearing before the tutorial pauses the game');
      await shot('spectate_critter' + tag);
    } else check(pos.arrow, `${key}: red arrow remains during the learning encounters`);
    const p2 = await page.evaluate(() => { const c = window.VELSCOUR.G.world.critters.find((x) => x.alive); const [x, y] = c.screen(); return { x, y }; });
    await tap(p2.x, p2.y);
    await page.waitForTimeout(120);
    const r = await page.evaluate(async () => {
      const { G } = window.VELSCOUR;
      const { Auto } = await import('/tools/tests/auto_player.js');
      const b = window._before;
      return { caught: (G.char.critters || 0) - b.n, gold: G.char.gold - b.gold, xp: G.char.level > b.lvl || G.char.xp > b.xp, override: Auto.overrideT, status: Auto.status };
    });
    check(r.caught === 1, `${key}: caught by a ${mobile ? 'tap' : 'click'}`);
    if (key === 'scarab') check(r.gold > 0 && !r.xp, `${key}: paid gold only (gold ${r.gold})`);   // the Golden Scarab pays gold
    else check(r.xp && r.gold === 0, `${key}: paid experience only (gold ${r.gold})`);
    check(!(r.override > 0) && !/Manual/.test(r.status), `${key}: auto-play kept control (overrideT ${r.override}, "${r.status}")`);
  }
  // one that gets away
  const away = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    const { spawnCritter } = await import('/src/game/critters.js');
    const cr = spawnCritter(G.world, 'wisp');
    const n = G.char.critters || 0;
    for (let i = 0; i < 30 * 15; i++) game.update(1 / 30);
    return { gone: cr.gone, caught: cr.caught, n: (G.char.critters || 0) - n, listed: G.world.critters.includes(cr), arrow: cr.showArrow };
  });
  check(away.gone && !away.caught && away.n === 0 && !away.listed && away.arrow, 'an untouched learning-stage critter escapes and is cleared');
  // the hero walking over one never catches it: only a click or a tap does (and it shies away)
  const walk = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    const { spawnCritter } = await import('/src/game/critters.js');
    const out = [];
    for (const key of ['scarab', 'moth']) {
      for (const c of G.world.critters || []) c.caught = true;
      const cr = spawnCritter(G.world, key), n = G.char.critters || 0;
      if (!cr) { out.push(null); continue; }
      cr.x = G.player.x; cr.y = G.player.y;
      for (let i = 0; i < 30 * 3; i++) { game.update(1 / 30); if (cr.alive && i < 45) { G.player.x = cr.x; G.player.y = cr.y; } }
      out.push({ caught: cr.caught, n: (G.char.critters || 0) - n, d: Math.hypot(cr.x - G.player.x, cr.y - G.player.y), arrow: cr.showArrow });
    }
    return out;
  });
  check(walk.every((w) => w && !w.caught && w.n === 0), `the hero standing on critters never catches them ${JSON.stringify(walk)}`);
  check(walk.every((w) => w && w.d > 0.8), 'critters shy away from the hero');
  check(walk.every((w) => w && w.arrow), 'red arrows remain through the seventh post-tutorial encounter');
  // the spawning clock
  const clock = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    const { Auto } = await import('/tools/tests/auto_player.js');
    Auto.toggle(false);
    G.world.critterT = 0.5; G.world.critters = [];
    for (let i = 0; i < 30; i++) game.update(1 / 30);
    return { count: (G.world.critters || []).filter((c) => c.alive).length, arrow: G.world.critters.find((c) => c.alive)?.showArrow, seen: G.char.critterArrowEncounters };
  });
  check(clock.count === 1, 'the clock spawns a critter on its own');
  check(clock.seen === 7 && clock.arrow, 'red arrow remains through seven post-tutorial encounters');
  const arrowGone = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { spawnCritter } = await import('/src/game/critters.js');
    for (const c of G.world.critters || []) c.caught = true;
    const next = spawnCritter(G.world, 'wisp');
    return !!next && !next.showArrow && G.char.critterArrowEncounters === 8;
  });
  check(arrowGone, 'red arrow disappears after the seventh post-tutorial encounter');

  // ---------------------------------------------------------------- 5. SMITE
  const fill = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { onKill } = await import('/src/game/happenings.js');
    const { SMITE_KILLS } = await import('/src/game/smite.js');
    G.char.smite = 0;
    for (let i = 0; i < 10; i++) onKill({ team: 'enemy', rank: 'normal', world: G.world, x: G.player.x, y: G.player.y, xp: 1 });
    const a = G.char.smite;
    onKill({ team: 'enemy', rank: 'boss', world: G.world, x: G.player.x, y: G.player.y, xp: 1 });
    return { a, b: G.char.smite, want: 10 / SMITE_KILLS, boss: 12 / SMITE_KILLS };
  });
  check(Math.abs(fill.a - fill.want) < 1e-6 && Math.abs(fill.b - fill.a - fill.boss) < 1e-6, `kills fill the SMITE meter (${fill.a.toFixed(3)}, a guardian +${(fill.b - fill.a).toFixed(3)})`);
  const pack = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    const { makeMonster } = await import('/src/game/monster.js');
    const { Auto } = await import('/tools/tests/auto_player.js');
    Auto.toggle(true);
    G.char.smite = 1;
    const p = G.player, w = G.world, made = [];
    const cx = p.x + 2.5, cy = p.y + 0.5;
    for (let i = 0; i < 5; i++) { const [x, y] = w.map.randomNear(cx, cy, 0.8); const m = makeMonster(w, w.roster[0] || 'skeleton', w.biome, 5, 'normal', x, y, 0); w.add(m); made.push(m); }
    window._pack = made;
    game.update(1 / 30);
    return { ready: !document.querySelector('#smite-btn').classList.contains('hidden') };
  });
  check(pack.ready, 'a full meter shows the SMITE button');
  await shot('spectate_smite_ready' + tag);
  await press('#smite-btn');
  const armed = await page.evaluate(() => window.VELSCOUR.G.smiteArmed === true);
  check(armed, 'the SMITE button arms the strike');
  const at = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { camera } = await import('/src/core/view.js');
    const m = window._pack[0];
    G.player.moveTarget = null;
    const [x, y] = camera.tileToScreen(m.x, m.y);
    return { x, y };
  });
  if (!mobile) { await page.mouse.move(at.x, at.y); await page.waitForTimeout(150); await shot('spectate_smite_aim'); }
  await tap(at.x, at.y);
  await page.waitForTimeout(150);
  await shot('spectate_smite_strike' + tag);
  await page.waitForTimeout(600);
  const hitR = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { Auto } = await import('/tools/tests/auto_player.js');
    return { dead: window._pack.filter((m) => m.dead || m.hp < m.maxHp * 0.2).length, smite: G.char.smite, armed: !!G.smiteArmed, override: Auto.overrideT, smites: G.char.smites };
  });
  check(hitR.dead >= 4, `SMITE flattened the pack (${hitR.dead}/5)`);
  check(hitR.smite === 0 && !hitR.armed && hitR.smites === 1, 'SMITE spent the meter');
  check(!(hitR.override > 0), 'aiming SMITE never took over from auto-play');

  // ---------------------------------------------------------------- 6. stance
  const st = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { Auto } = await import('/tools/tests/auto_player.js');
    const out = {};
    for (const k of ['cautious', 'balanced', 'reckless']) { G.char.stance = k; Auto.hurt = 0; out[k] = Auto.boldness(); }
    G.char.stance = 'balanced';
    return out;
  });
  check(st.cautious < st.balanced && st.balanced < st.reckless, `stance moves auto-play's boldness (${st.cautious.toFixed(2)} < ${st.balanced.toFixed(2)} < ${st.reckless.toFixed(2)})`);

  // ---------------------------------------------------------------- 9. portal choice, auto-play's countdown
  const pc = await page.evaluate(async () => {
    const { G, game } = window.VELSCOUR;
    const { Auto } = await import('/tools/tests/auto_player.js');
    const { kill } = await import('/src/game/combat.js');
    Auto.toggle(true);
    G.char.stance = 'reckless';
    const b = G.world.boss; b.awake = true; kill(b, G.player, {});
    game.update(1 / 30);
    Auto.leaveLevel(G.world);
    return { cards: document.querySelectorAll('.portal-choice .pc-card').length, depth: G.world.depth };
  });
  check(pc.cards === 3, `the exit offers three portals (${pc.cards})`);
  await page.evaluate(() => { for (let i = 0; i < 45; i++) window.VELSCOUR.game.update(1 / 30); });
  await page.waitForTimeout(100);
  await shot('spectate_portals' + tag);
  const cd = await page.evaluate(() => document.querySelector('.pc-auto').textContent);
  check(/Auto-play picks a portal in [5-7]/.test(cd), `auto-play counts down ("${cd}")`);
  // the player taps the second portal: auto-play takes that one
  await page.click('.pc-card[data-i="1"]');
  const want = await page.evaluate(() => document.querySelector('.pc-card[data-i="1"] .pc-name').textContent);
  const told = await page.evaluate(() => { const g = window.VELSCOUR.game; let n = 0; while (g.pick && n++ < 400) g.update(1 / 30); return { secs: n / 30, omen: window.VELSCOUR.G.char.nextOmen, biome: window.VELSCOUR.G.char.nextBiome }; });
  check(told.secs <= 3.1, `a tapped portal goes after ${told.secs.toFixed(1)} s`);
  await page.waitForFunction((d) => window.VELSCOUR.G.world && window.VELSCOUR.G.world.depth === d + 1 && document.querySelector('#loading').classList.contains('hidden'), pc.depth, { timeout: 30000 }).catch(() => {});
  const after = await page.evaluate(async () => { const { G } = window.VELSCOUR; const { BIOME_BY_ID } = await import('/src/data/biomes.js'); return { depth: G.world.depth, biome: G.world.biome.name, omen: G.world.happen && G.world.happen.omen, kind: G.world.kind, pending: G.char.nextOmen, name: (BIOME_BY_ID[G.char.nextBiome] || {}).name }; });
  check(after.depth === pc.depth + 1 && after.biome === want, `descended into the chosen portal (${after.biome}, wanted ${want})`);
  check(told.omen === undefined || (told.omen === 'none' ? !after.omen : after.omen === told.omen), `the depth keeps the omen its portal showed (${told.omen} -> ${after.omen})`);
  check(after.pending === undefined, 'the promised omen is spent');

  // ---------------------------------------------------------------- 11. Greed configuration and endgame rewards
  const gr = await page.evaluate(async () => {
    const { G } = window.VELSCOUR;
    const { GREED_LEVELS, greedWorld, rollGreedAffixes } = await import('/src/game/greed.js');
    const campaign = { kind: 'dungeon', depth: 100, goldMul: 1 };
    const campaignApplied = greedWorld(campaign, { greedLevel: 5 });
    const endgame = { kind: 'dungeon', depth: 101, goldMul: 1, lootMul: 1 };
    greedWorld(endgame, { greedLevel: 5 });
    return { levels: GREED_LEVELS.length, campaignApplied, campaignGreed: campaign.greed, endgame, affixes: rollGreedAffixes(5), hudGreed: !!document.querySelector('#greed') };
  });
  check(gr.levels === 6, 'Greed exposes six settings, 0 through 5');
  check(!gr.campaignApplied && gr.campaignGreed === undefined, 'Greed has no effect through campaign depth 100');
  check(gr.endgame.greed === 5 && gr.endgame.greedGoldPct === 150 && gr.endgame.greedXpPct === 100 && gr.endgame.greedLootPct === 75, 'Greed 5 applies the documented endgame reward bonuses');
  check(gr.affixes.length === 5, 'Greed 5 rolls five affixes');
  check(!gr.hudGreed, 'the Greed meter is absent from the gameplay HUD');

  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  report(errors);
  await browser.close();
})();
