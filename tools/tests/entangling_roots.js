// Focused regression for Ranger / Wilds / Entangling Roots.
// Run from the repo root with the game served at BASE_URL (default localhost:8123):
//   node tools/tests/entangling_roots.js
const { openGame, report } = require('./harness');

(async () => {
  const { browser, page, errors } = await openGame();
  try {
    const result = await page.evaluate(async () => {
      const { G, game } = window.VELSCOUR;
      const { SKILLS, cooldown, skillDuration } = await import('/src/data/skills.js');
      const { makeMonster } = await import('/src/game/monster.js');
      const { skillTooltip } = await import('/src/ui/skills.js');
      const { shownDmg, heroDmgLevel } = await import('/src/data/depth.js');
      const { fmtDmg } = await import('/src/core/util.js');
      const problems = [];
      const sk = SKILLS['ranger.1.1'];
      if (!sk) return ['Entangling Roots skill is missing'];

      await game.newChar('ranger', 'Entangling Roots regression');
      document.querySelectorAll('.screen').forEach((s) => s.remove());
      G.ui.modalCount = 0;
      G.char.level = 30;
      G.char.skills[sk.id] = 5;
      G.player.recompute();
      G.player.mana = G.player.maxMana = 9999;
      // Keep the one-hit damage assertion deterministic; the regression is
      // about one cast's baseline damage, not random critical hit variance.
      G.player.st.critChance = 0;
      G.godMode = false;
      const { BIOME_BY_ID } = await import('/src/data/biomes.js');
      game.buildDungeon(8, BIOME_BY_ID.catacombs);
      const p = G.player;
      G.godMode = false;

      // Isolate one real monster in the ability's target area so the assertion
      // exercises castSkill -> curse handler -> shared combat hit().
      G.world.creatures = G.world.creatures.filter((c) => c === p || c.team !== 'enemy');
      const [tx, ty] = G.world.map.randomNear(p.x, p.y, 1.5);
      const target = makeMonster(G.world, G.world.biome.roster[0], G.world.biome, 8, 'normal', tx, ty);
      G.world.add(target);
      target.maxHp = target.hp = 1000000;
      target.res ||= {};
      target.res.poison = 0;
      G.world.rebuildGrid();

      const before = target.hp;
      p.castLock = 0;
      p.cooldowns = {};
      const cast = p.tryUseSkill(sk, target.x, target.y, target);
      const afterCast = target.hp;
      if (!cast) problems.push('Roots cast was rejected in a valid combat state');
      if (!(afterCast < before)) problems.push('Roots cast applied no combat damage');
      if (!target.curses?.slow || target.curses.slow.amt <= 0) problems.push('Roots slow was not applied');
      if (!target.status?.stun || target.status.stun.t <= 0) problems.push('Roots stun was not applied');
      if (!target.status?.poison || target.status.poison.t <= 0) problems.push('Poison damage-over-time was not applied by the shared combat system');

      const hitDamage = before - afterCast;
      const expected = p.skillDamage(sk, 5);
      const rankOne = p.skillDamage(sk, 1);
      if (!(expected[0] > rankOne[0] && expected[1] > rankOne[1])) problems.push('Direct damage does not scale upward with skill rank');
      if (hitDamage < expected[0] * 0.7 || hitDamage > expected[1] * 1.05)
        problems.push(`One-hit damage ${hitDamage} outside expected range ${expected.join('-')} (with target mitigation)`);

      // Poison's element intentionally applies the normal 30%/s poison status.
      // Clear that expected DoT to isolate accidental direct re-hits from the
      // ability on later update frames.
      const expectedPoisonDps = hitDamage * 0.3;
      if (Math.abs(target.status.poison.dps - expectedPoisonDps) > 0.01)
        problems.push(`Poison DoT ${target.status.poison.dps} did not match the standard 30% of hit (${expectedPoisonDps})`);
      target.status.poison.t = 0;
      for (let i = 0; i < 60; i++) G.world.update(1 / 30);
      if (target.hp !== afterCast) problems.push(`Roots repeated direct damage after its cast (${afterCast} -> ${target.hp})`);

      p.castLock = 0;
      const blocked = p.tryUseSkill(sk, target.x, target.y, target);
      if (blocked !== false || target.hp !== afterCast) problems.push('Four-second cooldown did not block an immediate recast');
      if (cooldown(sk) !== 4) problems.push(`Expected 4s base cooldown; got ${cooldown(sk)}`);

      // Player damage modifiers flow through the same skillDamage calculation.
      const oldDmgPct = p.st.dmgPct;
      p.st.dmgPct = oldDmgPct + 50;
      const boosted = p.skillDamage(sk, 5);
      p.st.dmgPct = oldDmgPct;
      if (!(boosted[0] > expected[0] && boosted[1] > expected[1])) problems.push('Skill damage modifiers do not scale Roots damage');

      // Verify the tooltip uses the same effective damage range and names the
      // damage and crowd-control properties; cooldown is read from the skill.
      const tooltip = skillTooltip(sk).html;
      const current = p.skillDamage(sk, p.skillLevel(sk));
      const displayed = current.map((value) => fmtDmg(shownDmg(value, heroDmgLevel(G.char))));
      if (!tooltip.includes(`${displayed[0]}–${displayed[1]}`) || !tooltip.includes('poison damage once per cast'))
        problems.push('Main tooltip does not show current one-time poison damage from skillDamage()');
      const next = p.skillDamage(sk, p.skillLevel(sk) + 1).map((value) => fmtDmg(shownDmg(value, heroDmgLevel(G.char))));
      if (!tooltip.includes(`Next level: ${next[0]}–${next[1]} damage`))
        problems.push('Next-level tooltip damage does not match the next skillDamage() calculation');
      if (!tooltip.includes('slowed by') || !tooltip.includes(`${skillDuration(sk, 5).toFixed(1)}s`) || !tooltip.includes('Stun: 3s PvE / 1.5s PvP'))
        problems.push('Main tooltip omits Roots slow/stun values or durations');
      if (!tooltip.includes('30% of the hit per second for 3.5s')) problems.push('Main tooltip omits standard poison damage-over-time');
      if (!tooltip.includes('Cooldown: <b>4.0s</b>')) problems.push('Tooltip does not show the 4.0s cooldown');

      // Cooldown reduction still applies through the standard player cast path.
      p.cooldowns[sk.id] = 0;
      p.castLock = 0;
      p.st.cdr = 25;
      p.tryUseSkill(sk, target.x, target.y, target);
      if (Math.abs(p.cooldowns[sk.id] - 3) > 1e-6)
        problems.push(`25% cooldown reduction expected 3s; got ${p.cooldowns[sk.id]}`);
      return { problems, hitDamage, expected, slowPct: target.curses.slow.amt * 100,
        slowDuration: target.curses.slow.t, stunDuration: target.status.stun.t,
        cooldown: cooldown(sk), reducedCooldown: p.cooldowns[sk.id], poisonDps: expectedPoisonDps };
    });
    console.log(JSON.stringify(result, null, 2));
    if (Array.isArray(result) ? result.length : result.problems.length) process.exitCode = 1;
  } finally {
    report(errors);
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
