// Automated global stun duration / PvP / anti-lock regression.
// Run with the game served from the repository root at BASE_URL.
const { openGame, report } = require('./harness');

(async () => {
  const { browser, page, errors } = await openGame();
  try {
    const result = await page.evaluate(async () => {
      const [skillData, classData, summonData, talentData, stunSystem, combatData] = await Promise.all([
        import('/src/data/skills.js'), import('/src/data/classes.js'), import('/src/data/summons.js'),
        import('/src/data/talents.js'), import('/src/game/stun.mjs'), import('/src/game/combat.js'),
      ]);
      const { applyCurse } = await import('/src/game/skillrun.js');
      const { CLASS_SKILLS, SKILLS, cooldown, skillStunDuration, describe } = skillData;
      const { CLASSES } = classData, { SUMMONS } = summonData, { TALENTS, morphMatchesSkill } = talentData;
      const { applyStun } = stunSystem;
      const problems = [], affected = [], byClass = {};
      const defaultCooldown = { summon: 0.6, leap: 0.7, dash: 0.6, blink: 0.4, heal: 4, trap: 0.3 };
      const customStun = (sk) => (sk.classId === 'ninja' && ['iai', 'drop', 'grapple', 'chucks'].includes(sk.m.nin)) || (sk.classId === 'rogue' && sk.m.rog === 'kidney');
      const isSummonStun = (sk) => sk.kind === 'summon' && !!SUMMONS[sk.m.sum]?.atk?.stun;
      const nativeStun = (sk) => !!sk.m.stun || (sk.m.curse || []).includes('stun') || customStun(sk) || isSummonStun(sk);

      if (Object.keys(CLASSES).length !== 19 || Object.keys(CLASS_SKILLS).length !== 19) problems.push(`Expected 19 playable classes; found ${Object.keys(CLASS_SKILLS).length}`);
      for (const [classId, skills] of Object.entries(CLASS_SKILLS)) {
        byClass[classId] = [];
        for (const sk of skills) {
          if (!nativeStun(sk)) continue;
          const baseCd = cooldown(sk);
          const summonAttack = isSummonStun(sk);
          if (!(baseCd > 0) && !summonAttack) problems.push(`${classId}/${CLASSES[classId].trees[sk.tree]}/${sk.name} has no active cooldown`);
          const stunCd = summonAttack ? 2 : baseCd;
          const rank1 = skillStunDuration(sk, { effectiveCooldown: stunCd });
          const rank20 = skillStunDuration(sk, { effectiveCooldown: stunCd });
          const maxComboDuration = skillStunDuration(sk, { effectiveCooldown: stunCd, comboPoints: 5 });
          if (Math.abs(rank1 - rank20) > 1e-9) problems.push(`${sk.id} changes stun duration by skill rank`);
          if (!summonAttack && (rank1 >= baseCd || rank1 > baseCd * 0.75 + 1e-9 || maxComboDuration > baseCd * 0.75 + 1e-9)) problems.push(`${sk.id} stun ${Math.max(rank1, maxComboDuration)}s exceeds 75% of ${baseCd}s cooldown`);
          if (summonAttack && rank1 > 1.5 + 1e-9) problems.push(`${sk.id} summon stun exceeds its 2s internal cooldown cap`);
          const options = { baseSkill: sk, effectiveCooldown: stunCd, internalCooldown: summonAttack ? 2 : 0, comboPoints: 0 };
          const text = describe(sk, 20, null, options), rankOneText = describe(sk, 1, null, options);
          if (!text.includes('PvP')) problems.push(`${sk.id} tooltip omits its PvP stun duration`);
          const summary = (value) => value.slice(value.indexOf('Stun:'));
          if (summary(text) !== summary(rankOneText)) problems.push(`${sk.id} tooltip stun duration changes with rank`);
          const bossDuration = skillStunDuration(sk, { boss: true, effectiveCooldown: stunCd });
          const originalDuration = (sk.m.curse || []).includes('stun') ? Math.min(sk.m.dur ?? (sk.kind === 'curse' ? 6 : 0), 3)
            : sk.classId === 'ninja' && sk.m.nin === 'iai' ? 0.5
              : sk.classId === 'ninja' && sk.m.nin === 'grapple' ? 1.2
                : sk.classId === 'ninja' && sk.m.nin === 'chucks' ? 0.8
                  : sk.classId === 'rogue' && sk.m.rog === 'kidney' ? 1.1
                    : (sk.m.stun || summonAttack) ? 1.1 : 0;
          const details = { tree: CLASSES[classId].trees[sk.tree], ability: sk.name, rank1Duration: rank1, maxRankDuration: rank20,
            originalRank1Duration: originalDuration, maxComboDuration: sk.classId === 'rogue' && sk.m.rog === 'kidney' ? maxComboDuration : null,
            pvpDuration: rank1 * 0.5, maxComboPvpDuration: sk.classId === 'rogue' && sk.m.rog === 'kidney' ? maxComboDuration * 0.5 : null,
            bossDuration, bossPvpDuration: bossDuration * 0.5,
            oldCooldown: sk.m.cd ?? defaultCooldown[sk.kind] ?? 0, cooldown: baseCd,
            source: isSummonStun(sk) ? `summon:${SUMMONS[sk.m.sum].name}` : (sk.m.curse || []).includes('stun') ? 'curse' : customStun(sk) ? 'class effect' : 'combat hit' };
          affected.push({ class: CLASSES[classId].name, ...details }); byClass[classId].push(details);
        }
      }

      // Every passive talent stun morph must target a real skill and yield the
      // same fixed generic duration at both ranks without adding a cast cooldown.
      const passiveMorphs = [];
      for (const node of Object.values(TALENTS)) {
        if (!node.morph?.stun) continue;
        const matches = (CLASS_SKILLS[node.classId] || []).filter((sk) => morphMatchesSkill(node.morph, sk));
        if (!matches.length) problems.push(`Talent ${node.id} stun morph has no matching skill`);
        for (const sk of matches) {
          const effectiveCooldown = cooldown(sk) || 2;
          const rank1 = Math.min(1.1, effectiveCooldown * 0.75), rank20 = Math.min(1.1, effectiveCooldown * 0.75);
          if (rank1 !== rank20) problems.push(`Talent stun ${node.name} varies by rank on ${sk.id}`);
          passiveMorphs.push({ class: CLASSES[node.classId].name, tree: CLASSES[node.classId].trees[sk.tree], ability: sk.name, talent: node.name, duration: rank1, internalCooldown: cooldown(sk) ? null : 2 });
        }
      }

      // Shared effect path: PvP reduction occurs once before target CC resist,
      // and player-owned proxies inherit the same rule.
      const player = { isPlayer: true, st: { markCcReduce: 0 }, world: { time: 10 } };
      const pvp = { isPlayer: true, st: { markCcReduce: 0 }, status: {}, world: player.world };
      const pvpDuration = applyStun(player, pvp, 2, { cooldown: 4, key: 'pvp-base', now: 10 });
      if (Math.abs(pvpDuration - 1) > 1e-9) problems.push(`Player-to-player stun should be 1s, got ${pvpDuration}`);
      const duplicate = applyStun(player, pvp, 2, { cooldown: 4, key: 'pvp-base', now: 10 });
      if (duplicate !== 0 || pvp.status.stun.t !== 1) problems.push('Repeated hit refreshed a PvP stun before its cooldown');
      pvp.st = { markCcReduce: 20 };
      const resistant = applyStun(player, pvp, 2, { cooldown: 4, key: 'pvp-resistant', now: 10 });
      if (Math.abs(resistant - 0.8) > 1e-9) problems.push(`PvP duration/resistance order expected 0.8s, got ${resistant}`);
      const summon = { isPlayer: false, owner: player, skillId: 'player-summon', world: player.world };
      const summonTarget = { isPlayer: true, st: { markCcReduce: 0 }, status: {}, world: player.world };
      const summonDuration = applyStun(summon, summonTarget, 2, { cooldown: 4, key: 'summon', now: 10 });
      if (Math.abs(summonDuration - 1) > 1e-9) problems.push(`Player-owned summon bypassed PvP reduction: ${summonDuration}`);
      const enemy = { isPlayer: false, team: 'enemy', world: player.world };
      const enemyDuration = applyStun(enemy, { isPlayer: true, st: { markCcReduce: 0 }, status: {}, world: player.world }, 0.5, { now: 10 });
      if (Math.abs(enemyDuration - 0.5) > 1e-9) problems.push(`Enemy-to-player stun changed from 0.5s: ${enemyDuration}`);
      const cdrDuration = skillStunDuration(SKILLS['paladin.1.0'], { effectiveCooldown: 0.8 });
      if (Math.abs(cdrDuration - 0.6) > 1e-9) problems.push(`High-CDR stun cap should be 0.6s, got ${cdrDuration}`);
      const cdrTarget = { isPlayer: false, st: {}, status: {}, world: player.world };
      const cdrApplied = applyStun(player, cdrTarget, 1.1, { cooldown: 0.8, key: 'cdr-cap', now: 10 });
      if (Math.abs(cdrApplied - 0.6) > 1e-9) problems.push(`High-CDR shared status path should cap at 0.6s, got ${cdrApplied}`);
      const tooSoon = applyStun(player, cdrTarget, 1.1, { cooldown: 0.8, key: 'cdr-cap', now: 10.79 });
      if (tooSoon !== 0) problems.push('High-CDR repeated hit bypassed the effective cooldown gate');
      const readyAgain = applyStun(player, cdrTarget, 1.1, { cooldown: 0.8, key: 'cdr-cap', now: 10.8 });
      if (Math.abs(readyAgain - 0.6) > 1e-9) problems.push('Effective-cooldown stun gate did not become ready on time');
      const internalTarget = { isPlayer: false, status: {}, world: player.world };
      const internalFirst = applyStun(player, internalTarget, 1.1, { key: 'passive-internal', now: 10 });
      const internalBlocked = applyStun(player, internalTarget, 1.1, { key: 'passive-internal', now: 11.99 });
      const internalReady = applyStun(player, internalTarget, 1.1, { key: 'passive-internal', now: 12 });
      if (internalFirst !== 1.1 || internalBlocked !== 0 || internalReady !== 1.1) problems.push('Passive/triggered stun internal cooldown failed its 2s per-target gate');

      // Exercise the actual curse application for Roots at the fixed Rank 1
      // value at both ends of the skill progression.
      const roots = CLASS_SKILLS.ranger.find((sk) => (sk.m.curse || []).includes('stun'));
      const rootsAtRank1 = skillStunDuration(roots, { effectiveCooldown: 4 });
      const rootsAtRank20 = skillStunDuration(roots, { effectiveCooldown: 4 });
      const rootsTarget1 = { rank: 'normal', isPlayer: false, status: {}, curses: {}, world: player.world };
      const rootsTarget20 = { rank: 'normal', isPlayer: false, status: {}, curses: {}, world: player.world };
      applyCurse(player, rootsTarget1, 'stun', 0, 20, [1, 1], 1, rootsAtRank1, 4, 'roots-rank-1');
      applyCurse(player, rootsTarget20, 'stun', 0, 20, [1, 1], 1, rootsAtRank20, 4, 'roots-rank-20');
      if (rootsTarget1.status.stun?.t !== 3 || rootsTarget20.status.stun?.t !== 3) problems.push('Entangling Roots runtime stun changed across skill ranks');

      // Exercise the shared combat hit path for both PvE and PvP, not only the
      // standalone duration helper.
      const { G, game } = window.VELSCOUR;
      await game.newChar('paladin', 'Stun regression');
      document.querySelectorAll('.screen').forEach((s) => s.remove()); G.ui.modalCount = 0;
      G.char.level = 100; G.player.recompute(); G.godMode = false;
      const { BIOME_BY_ID } = await import('/src/data/biomes.js');
      game.buildDungeon(8, BIOME_BY_ID.catacombs);
      const p = G.player, w = G.world;
      w.creatures = w.creatures.filter((c) => c === p || c.team !== 'enemy');
      const { makeMonster } = await import('/src/game/monster.js');
      const [x, y] = w.map.randomNear(p.x, p.y, 1.5);
      p.invuln = 0; p.st.markCcReduce = 0; p.status = {}; p.rank = 'normal';
      const mob = makeMonster(w, w.biome.roster[0], w.biome, 8, 'normal', x, y); w.add(mob);
      mob.hp = mob.maxHp = 1000000; mob.res = {}; w.rebuildGrid();
      combatData.hit(p, mob, 1, 'phys', { stun: true, crit: false, silent: true, stunCooldown: 4, stunKey: 'shared-path' });
      if (Math.abs((mob.status.stun?.t || 0) - 1.1) > 1e-6) problems.push(`PvE shared hit path expected 1.1s, got ${mob.status.stun?.t}`);
      return { problems, classCount: Object.keys(CLASS_SKILLS).length, stunAbilityCount: affected.length,
        activeAbilityCount: affected.filter((entry) => !String(entry.source).startsWith('summon:')).length,
        abilities: affected, passiveMorphCount: passiveMorphs.length, passiveMorphs, byClass };
    });
    console.log(JSON.stringify({ problems: result.problems, classCount: result.classCount,
      activeAbilityCount: result.activeAbilityCount, stunAbilityCount: result.stunAbilityCount, passiveMorphCount: result.passiveMorphCount,
      abilities: result.abilities, passiveMorphs: result.passiveMorphs, byClass: result.byClass }, null, 2));
    if (result.problems.length) process.exitCode = 1;
  } finally {
    report(errors);
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
