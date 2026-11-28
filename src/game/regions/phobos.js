// Compact City State Phobos districts use a shared, seeded city-block generator. The
// 38 biome IDs remain distinct for campaign/endgame selection while sharing this loader.
import { registerRegion } from '../regions.js';
import { loadBiomeArt } from '../../core/assets.js';
import { loadArtFor } from '../../core/enemyart.js';
import { BESTIARY } from '../../data/bestiary.js';
import { DISTRICTS } from '../../data/phobos.js';
import { PHOBOS_DISTRICTS } from '../../data/phobosfamily.js';
import { RNG } from '../../core/util.js';
import { generatePhobosDistrict } from '../../world/phobosdistrict.js';
import { biomeTileSet } from '../../core/assets.js';

const artOf = (entry) => typeof entry === 'string' ? BESTIARY.find((a) => a.id === entry) : entry;
const districtOf = (biome) => DISTRICTS.find((d) => d.id === biome.phobosDistrict) || DISTRICTS[0];
const descriptorOf = (biome) => PHOBOS_DISTRICTS.find((d) => d.id === biome.phobosDistrict) || PHOBOS_DISTRICTS[0];

registerRegion({
  id: 'phobos_city_family',
  words: ['phobos', 'city state phobos', 'the city state'],
  portal: 'City State Phobos: a walled city district of streets, squares and Ward Lords.',
  townLine: 'The road leads to <b>City State Phobos</b>, where one ward waits to be reclaimed.',
  load(biome) {
    const d = districtOf(biome);
    const ids = [...d.foes, ...d.bosses].map(artOf).filter(Boolean).map((a) => a.id);
    if (biome.phobosAct === 2) ids.push(...BESTIARY.filter((a) => a.sandKin && !a.boss).map((a) => a.id));
    return Promise.all([loadBiomeArt(biome), loadArtFor([...new Set(ids)])]);
  },
  ready: () => true,
  generate(depth, biome, seed) {
    const descriptor = descriptorOf(biome), district = districtOf(biome);
    const gen = generatePhobosDistrict(depth, biome, biomeTileSet(biome), seed, descriptor);
    const rng = new RNG((Number(seed) || 0) >>> 0);
    let local = district.foes.map(artOf).filter((a) => a?.id && a.arch && a.cat !== 'good' && a.cat !== 'gray');
    let desert = biome.phobosAct === 2 ? BESTIARY.filter((a) => a.sandKin && a.id && a.arch && !a.boss) : [];
    if (!local.length) local = BESTIARY.filter((a) => a.phobos && a.arch && !a.boss && String(a.at || '').toLowerCase().includes(descriptor.id));
    const bosses = district.bosses.map(artOf).filter((a) => a?.id && a.arch && a.boss);
    if (!local.length) local = BESTIARY.filter((a) => a.phobos && a.arch && !a.boss);
    if (!bosses.length) bosses.push(...BESTIARY.filter((a) => a.phobos && a.arch && a.boss));
    const pick = (pool) => pool.length ? pool[rng.int(0, pool.length - 1)] : null;
    const spawnArtIds = new Set(), byArch = new Map();
    for (let i = 0; i < gen.spawns.length; i++) {
      const useDesert = desert.length && rng.next() < 0.48;
      const art = pick(useDesert ? desert : local);
      if (!art) continue;
      spawnArtIds.add(art.id);
      if (!byArch.has(art.arch)) byArch.set(art.arch, []);
      byArch.get(art.arch).push(art.id);
      Object.assign(gen.spawns[i], { arch: art.arch, look: { art: art.id }, name: art.name });
    }
    const boss = pick(bosses);
    if (boss) {
      spawnArtIds.add(boss.id);
      if (!byArch.has(boss.arch)) byArch.set(boss.arch, []);
      byArch.get(boss.arch).push(boss.id);
      gen.spawns.push({ x: gen.boss[0], y: gen.boss[1], arch: boss.arch, rank: 'boss', n: 1, look: { art: boss.id }, name: boss.name, phobosWardLord: true });
      gen.bossArt = boss.id;
    }
    gen.roster = [...new Set(gen.spawns.filter((s) => s.arch && s.rank !== 'boss' && s.rank !== 'raid').map((s) => s.arch))];
    const bossIds = bosses.map((a) => a.id);
    gen.looks = {
      all: () => [...spawnArtIds].map((id) => ({ art: id })),
      ids: () => [...spawnArtIds],
      pick: (arch, random = Math.random) => {
        const pool = byArch.get(arch) || [...spawnArtIds];
        if (!pool.length) return null;
        const n = Number(random());
        return { art: pool[Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(n) ? n : 0) * pool.length)))] };
      },
      boss: (index = 0) => bossIds.length ? { arch: (bosses.find((a) => a.id === bossIds[index % bossIds.length]) || boss).arch, look: { art: bossIds[index % bossIds.length] } } : null,
    };
    gen.phobosEnvironment = biome.phobosEnvironment;
    gen.phobosDistrict = descriptor.id;
    gen.phobosDistrictName = descriptor.name;
    return gen;
  },
  createRun(world, gen, biome, depth, win) {
    // The district's authored population is finite. Disable the generic AFK
    // ambush scheduler too, so a cleared block cannot become a repeat farm.
    world.noAmbushRespawn = true;
    world.ambushT = Infinity;
    const run = { district: biome.phobosDistrict, environment: biome.phobosEnvironment, depth, completed: false, win,
      bossDefeated() {
        if (run.completed) return;
        run.completed = true;
        win();
      } };
    world.phobosDistrictRun = run;
    return run;
  },
  intro: (_world, gen) => `${gen.phobosDistrictName || gen.phobosDistrict}: streets and ward square of ${gen.phobosEnvironment}. Defeat its Ward Lord to open the exit.`,
  amb: 'necropolis',
});
