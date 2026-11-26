// World: everything that lives in the current level.
import { augHazard } from './augments.js';
import { Clutter, isTreeProp } from './clutter.js';
import { G } from '../state.js';
import { applyDungeonAffix } from '../data/dungeonaffixes.js';
import { camera, isoX, isoY } from '../core/view.js';
import { rand, dist2, TAU, chance } from '../core/util.js';
import { sfx, audioDiagnosticsEnabled, audioCombatStatus, recordAudioDiagnosticMarker } from '../core/audio.js';
import { spawn, updateVfx, addLight, sparkle, smoke, lights } from '../gfx/vfx.js';
import { bodyR } from '../world/map.js';
import { profileEnd, profileRecord, profileStart } from '../core/perfdiagnostics.js';
import { groundLootLifetime, OBJECT_LIFETIMES } from '../core/objectlifetimes.mjs';
import { reconcileBossDefeats } from './bosscompletion.js';
import { sheerUpdate } from './sheer.js';

const CELL = 2;
const LOOT_CELL = 8;

const LOOT_CAP = 240;
let WORLD_SERIAL = 0;

function heapPush(heap, node) {
  let i = heap.length; heap.push(node);
  while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].at <= node.at) break; heap[i] = heap[parent]; i = parent; }
  heap[i] = node;
}
function heapPop(heap) {
  if (!heap.length) return null;
  const first = heap[0], last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (true) { let child = i * 2 + 1; if (child >= heap.length) break; if (child + 1 < heap.length && heap[child + 1].at < heap[child].at) child++;
      if (heap[child].at >= last.at) break; heap[i] = heap[child]; i = child; }
    heap[i] = last;
  }
  return first;
}
export class World {
  constructor(kind, opts) {
    this.kind = kind; // 'town' | 'dungeon'
    this.id = ++WORLD_SERIAL;
    Object.assign(this, opts); // map, tileset, biome, depth, ...
    this.creatures = [];
    this.hazards = [];
    this.loot = [];
    this.lootCells = new Map();
    this.lootCellByItem = new WeakMap();
    this.movingLoot = new Set();
    this.fadingLoot = new Set();
    this.fadingLootOrder = [];
    this.lootExpiry = [];
    this.lootNearBuffer = [];
    this._lootUpdateSerial = 0;
    this._lootRegistered = 0;
    this.unindexedLoot = new Set();
    this._lootTimerStale = 0;
    this._creatureSerial = 0;
    this._renderCreatureBuffer = [];
    this.lifecycle = { creaturesCreated: 0, creaturesRemoved: 0, hazardsCreated: 0, hazardsRemoved: 0, lootCreated: 0, lootRemoved: 0 };
    this.corpses = [];
    this.fallen = []; // dead summons' last poses (core/petart.js)
    this.props = this.props || [];
    this._ambientPropSource = null;
    this._ambientPropCount = -1;
    this._ambientPropCache = [];
    this.buildings = this.buildings || [];
    this.npcs = this.npcs || [];
    this.chests = this.chests || [];
    this.torches = this.torches || [];
    this.wallHangings = this.wallHangings || [];
    this.portals = this.portals || [];
    this.grid = new Map();
    this.gridPool = [];
    this.time = 0;
    this.flowTimer = 0;
    this.ambT = 0;
    this.boss = null;
    this.exitOpen = kind === 'town';
    this.kills = 0;
    this.lastPlayerTile = -1;
    this._audioDiagnosticCombat = false;
    this._audioCombatUntil = 0;
    if (this.kind === 'dungeon') {
      this.initClutter();
    }
    recordAudioDiagnosticMarker('area-enter', { worldId: this.id, kind: this.kind, environment: this.biome?.name || this.kind, depth: this.depth ?? null });
  }

  initClutter() {
    if (!this.map || !this.props || this.map.darkForest) return;
    const W = this.map.w, H = this.map.h;
    if (!this.map.clutter) this.map.clutter = new Uint8Array(W * H);
    for (const pr of this.props) {
      if ((pr.kind === 'scatter' || pr.kind === 'decor') && !pr.throne) {
        if (isTreeProp(pr)) {
          pr.destructible = false;
          pr.tree = true;
          continue;
        }
        const tx = Math.floor(pr.x), ty = Math.floor(pr.y);
        if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
          const idx = ty * W + tx;
          if (this.map.block && this.map.block[idx]) {
            this.map.clutter[idx] = 1;
            pr.destructible = true;
            const c = new Clutter(this, pr);
            this.add(c);
          }
        }
      }
    }
  }

  add(c) {
    c.world = this;
    // never start inside a wall or prop: a body that overlaps one can't take a step
    if (this.map && !c.ghost && !c.isPlayer && !c.clutter) [c.x, c.y] = this.map.nudge(c.x, c.y, bodyR(c));
    this.creatures.push(c);
    c._worldRenderOrder = ++this._creatureSerial;
    if (G.settings?.performanceProfiler === true) this.lifecycle.creaturesCreated++;
    if (Array.isArray(this.dungeonAffixes)) for (const id of this.dungeonAffixes) applyDungeonAffix(c, id);
    return c;
  }
  remove(c) {
    const idx = this.creatures.indexOf(c);
    if (idx !== -1) { this.creatures.splice(idx, 1); if (G.settings?.performanceProfiler === true) this.lifecycle.creaturesRemoved++; }
    if (c.world === this) c.world = null;
    return c;
  }
  addHazard(h) { h.world = this; this.hazards.push(h); if (G.settings?.performanceProfiler === true) this.lifecycle.hazardsCreated++; return h; }
  addLoot(l) {
    l._lootRemoved = false;
    l._lootBornAt = this.time;
    const lifetime = groundLootLifetime(l, this.time);
    l._lootExpiryAt = lifetime.expiresAt;
    l._lootFadeAt = lifetime.fadeAt;
    l._lootMaxLifetime = lifetime.duration;
    this.loot.push(l);
    if (G.settings?.performanceProfiler === true) this.lifecycle.lootCreated++;
    this._lootRegistered++;
    this._indexLoot(l);
    if (l.z > 0 || l.vz > 0) this.movingLoot.add(l);
    l._lootTimerToken = (l._lootTimerToken || 0) + 1;
    if (l.fades) { this.fadingLoot.add(l); heapPush(this.fadingLootOrder, { at: l.fades, ref: new WeakRef(l), token: l._lootTimerToken }); }
    if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) this.unindexedLoot.add(l);
    if (Number.isFinite(l._lootExpiryAt)) heapPush(this.lootExpiry, { at: l._lootExpiryAt, ref: new WeakRef(l), token: l._lootTimerToken });
    // Keep the legacy cap for short-lived drops without scanning the permanent loot pile.
    // A cap overflow containing only persistent items must never evict collectible gear.
    if (this.loot.length > LOOT_CAP && this.fadingLoot.size) {
      const held = []; let oldest = null;
      while (this.fadingLootOrder.length) {
        const entry = heapPop(this.fadingLootOrder), g = entry.ref.deref();
        if (!g || g._lootRemoved || !this.fadingLoot.has(g) || g._lootTimerToken !== entry.token || g.fades !== entry.at) continue;
        if (this.player && this.player.lootTarget === g) { held.push(entry); continue; }
        oldest = g; break;
      }
      for (const entry of held) heapPush(this.fadingLootOrder, entry);
      if (oldest) this.removeLoot(oldest);
    }
    return l;
  }

  _lootKey(x, y) { return `${Math.floor(x / LOOT_CELL)},${Math.floor(y / LOOT_CELL)}`; }
  _indexLoot(l) {
    if (!l || l._lootRemoved || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
    const key = this._lootKey(l.x, l.y), prev = this.lootCellByItem.get(l);
    if (prev === key) return;
    if (prev !== undefined) {
      const old = this.lootCells.get(prev);
      if (old) { old.delete(l); if (!old.size) this.lootCells.delete(prev); }
    }
    let cell = this.lootCells.get(key);
    if (!cell) this.lootCells.set(key, (cell = new Set()));
    cell.add(l); this.lootCellByItem.set(l, key);
  }
  updateLootPosition(l) { this._indexLoot(l); }
  queryLootRect(x0, y0, x1, y1, out = []) {
    out.length = 0;
    const cx0 = Math.floor(x0 / LOOT_CELL), cy0 = Math.floor(y0 / LOOT_CELL);
    const cx1 = Math.floor(x1 / LOOT_CELL), cy1 = Math.floor(y1 / LOOT_CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cell = this.lootCells.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const l of cell) if (!l._lootRemoved && l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1) out.push(l);
    }
    return out;
  }
  removeLoot(l) {
    if (!l || l._lootRemoved) return false;
    l._lootRemoved = true;
    if (G.settings?.performanceProfiler === true) this.lifecycle.lootRemoved++;
    l._lootTimerToken = (l._lootTimerToken || 0) + 1;
    if (l.fades) this._lootTimerStale++;
    if (Number.isFinite(l._lootExpiryAt)) this._lootTimerStale++;
    this.movingLoot.delete(l); this.fadingLoot.delete(l);
    this.unindexedLoot.delete(l);
    const key = this.lootCellByItem.get(l), cell = key === undefined ? null : this.lootCells.get(key);
    if (cell) { cell.delete(l); if (!cell.size) this.lootCells.delete(key); }
    this.lootCellByItem.delete(l);
    if (this.player && this.player.lootTarget === l) this.player.lootTarget = null;
    this._lootTombstones = (this._lootTombstones || 0) + 1;
    this._lootRegistered = Math.max(0, (this._lootRegistered || 0) - 1);
    // Persist completion-hoard pickups immediately so reloads cannot duplicate a claimed reward.
    if (l.riftCompletionReward && G.world === this) G.game?.autosave?.();
    return true;
  }
  rebuildLootIndex() {
    this.lootCells.clear(); this.lootCellByItem = new WeakMap(); this.movingLoot.clear(); this.fadingLoot.clear(); this.unindexedLoot.clear(); this.lootExpiry.length = 0; this.fadingLootOrder.length = 0;
    this._lootRegistered = 0; this._lootTimerStale = 0;
    for (const l of this.loot) {
      if (l._lootRemoved) continue;
      this._lootRegistered++;
      if (!Number.isFinite(l._lootBornAt)) l._lootBornAt = this.time - (l.t || 0);
      if (!Number.isFinite(l._lootExpiryAt)) {
        const lifetime = groundLootLifetime(l, l._lootBornAt);
        l._lootExpiryAt = lifetime.expiresAt;
        l._lootFadeAt = lifetime.fadeAt;
        l._lootMaxLifetime = lifetime.duration;
      }
      l._lootTimerToken = (l._lootTimerToken || 0) + 1;
      this._indexLoot(l);
      if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) this.unindexedLoot.add(l);
      if (l.z > 0 || l.vz > 0) this.movingLoot.add(l);
      if (l.fades) { this.fadingLoot.add(l); heapPush(this.fadingLootOrder, { at: l.fades, ref: new WeakRef(l), token: l._lootTimerToken }); }
      if (Number.isFinite(l._lootExpiryAt)) heapPush(this.lootExpiry, { at: l._lootExpiryAt, ref: new WeakRef(l), token: l._lootTimerToken });
    }
    this._lootTombstones = 0;
    return this;
  }
  _compactLoot(force = false) {
    if (!force && (this._lootTombstones || 0) < 32 && (this._lootTombstones || 0) * 10 < this.loot.length) return;
    let write = 0;
    for (let read = 0; read < this.loot.length; read++) if (!this.loot[read]._lootRemoved) this.loot[write++] = this.loot[read];
    this.loot.length = write; this._lootTombstones = 0;
  }
  _compactLootTimers() {
    const total = this.lootExpiry.length + this.fadingLootOrder.length;
    if (this._lootTimerStale < 64 || this._lootTimerStale * 2 <= total) return;
    const keep = (heap) => {
      const live = [];
      for (const entry of heap) {
        const l = entry.ref.deref();
        if (l && !l._lootRemoved && l._lootTimerToken === entry.token) live.push(entry);
      }
      heap.length = 0;
      for (const entry of live) heapPush(heap, entry);
    };
    keep(this.lootExpiry); keep(this.fadingLootOrder); this._lootTimerStale = 0;
  }

  rebuildGrid() {
    for (const cell of this.grid.values()) { cell.length = 0; this.gridPool.push(cell); }
    this.grid.clear();
    // also: the creatures of each team (in grid order) with the cell each was bucketed in, and whether anything
    // taunts, so nearestHostile/pickTarget can skip the grid when the other side is a handful (the hero and summons)
    const teams = this.teams || (this.teams = new Map());
    for (const a of teams.values()) a.length = 0;
    this.taunters = 0;
    let maxCreatureRadius = 0;
    for (const c of this.creatures) {
      if (c.dead) continue;
      if (Number.isFinite(c.r) && c.r > maxCreatureRadius) maxCreatureRadius = c.r;
      const gx = Math.floor(c.x / CELL), gy = Math.floor(c.y / CELL), k = (gx << 16) | (gy & 0xffff);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = this.gridPool.pop() || []));
      a.push(c);
      c._gx = (k >> 16); c._gy = (k << 16) >> 16; // the cell as the grid key encodes it
      let t = teams.get(c.team);
      if (!t) teams.set(c.team, (t = []));
      t.push(c);
      if (c.taunt) this.taunters++;
    }
    this.maxCreatureRadius = maxCreatureRadius;
  }

  /** Creatures within r of (x,y). filter(c) optional. */
  query(x, y, r, filter, out = []) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const a = this.grid.get((cx << 16) | (cy & 0xffff));
        if (!a) continue;
        for (const c of a) {
          if (this._perfProfiling) this._perfSpatialCandidates++;
          if (c.dead) continue;
          const rr = r + c.r;
          if (dist2(x, y, c.x, c.y) <= rr * rr && (!filter || filter(c))) out.push(c);
        }
      }
    }
    return out;
  }
  hostiles(team, x, y, r, out = []) {
    out.length = 0;
    return this.query(x, y, r, (c) => c.team !== team && c.targetable !== false, out);
  }
  /** Hostile bodies whose collision circles overlap a world-space rectangle. */
  hostilesInBounds(team, minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    const pad = this.maxCreatureRadius || 0;
    const x0 = Math.floor((minX - pad) / CELL), x1 = Math.floor((maxX + pad) / CELL);
    const y0 = Math.floor((minY - pad) / CELL), y1 = Math.floor((maxY + pad) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.grid.get((cx << 16) | (cy & 0xffff));
      if (!cell) continue;
      for (const c of cell) {
        if (c.dead || c.team === team || c.targetable === false) continue;
        const r = c.r || 0;
        if (c.x + r < minX || c.x - r > maxX || c.y + r < minY || c.y - r > maxY) continue;
        out.push(c);
      }
    }
    return out;
  }
  /** Non-dead creatures in a conservative tile-space rectangle, in stable world insertion order. */
  creaturesInBounds(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL), y1 = Math.floor(maxY / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.grid.get((cx << 16) | (cy & 0xffff));
      if (!cell) continue;
      for (const c of cell) {
        if (c.dead || c.x + (c.r || 0) < minX || c.x - (c.r || 0) > maxX || c.y + (c.r || 0) < minY || c.y - (c.r || 0) > maxY) continue;
        out.push(c);
      }
    }
    out.sort((a, b) => a._worldRenderOrder - b._worldRenderOrder);
    return out;
  }
  nearestHostile(team, x, y, r, needLos = false, allowClutter = false) {
    let best = null, bd = Infinity;
    let bestX = Infinity, bestY = Infinity;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    const visit = (cell, cx, cy) => {
      for (const c of cell) {
        if (c.dead || c.team === team || c.targetable === false || (!allowClutter && c.clutter)) continue;
        const d = dist2(x, y, c.x, c.y), rr = r + c.r;
        // Preserve query's row/column tie order even when scanning occupied cells.
        if (d > rr * rr || d > bd || (d === bd && (cy > bestY || (cy === bestY && cx >= bestX)))) continue;
        if (needLos && !this.map.los(x, y, c.x, c.y)) continue;
        bd = d; best = c; bestX = cx; bestY = cy;
      }
    };
    // the other teams' creatures, when they are fewer than the cells to scan (a monster looking for the hero and his
    // summons among hundreds of monsters): same cells, same distance test and tie order as the grid scans below
    let others = 0;
    if (this.teams) for (const [t, a] of this.teams) if (t !== team) others += a.length;
    if (this.teams && others < Math.min(this.grid.size, (x1 - x0 + 1) * (y1 - y0 + 1))) {
      for (const [t, a] of this.teams) {
        if (t === team) continue;
        for (const c of a) {
          const cx = c._gx, cy = c._gy;
          if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
          if (c.dead || c.targetable === false || (!allowClutter && c.clutter)) continue;
          const d = dist2(x, y, c.x, c.y), rr = r + c.r;
          if (d > rr * rr || d > bd || (d === bd && (cy > bestY || (cy === bestY && cx >= bestX)))) continue;
          if (needLos && !this.map.los(x, y, c.x, c.y)) continue;
          bd = d; best = c; bestX = cx; bestY = cy;
        }
      }
    } else if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.grid.size) {
      // Awake monsters search thirty tiles: visiting hundreds of empty buckets
      // per monster costs much more than scanning the sparse occupied grid.
      for (const [key, cell] of this.grid) {
        const cx = key >> 16, cy = (key << 16) >> 16;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) visit(cell, cx, cy);
      }
    } else {
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const cell = this.grid.get((cx << 16) | (cy & 0xffff));
        if (cell) visit(cell, cx, cy);
      }
    }
    return best;
  }
  alliesOf(team, x, y, r, out = []) { out.length = 0; return this.query(x, y, r, (c) => c.team === team, out); }

  /** Static prop metadata is generated once per area. Keep only props that can
   * emit ambient smoke/light so the per-frame ambience pass avoids scanning
   * every decorative object. Array replacement and additions/removals rebuild
   * the small cache automatically. */
  ambientProps() {
    if (this._ambientPropSource !== this.props || this._ambientPropCount !== this.props.length) {
      const props = this.props, active = [];
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        if (prop && (prop.light || prop.smoke)) active.push(prop);
      }
      this._ambientPropSource = props;
      this._ambientPropCount = props.length;
      this._ambientPropCache = active;
    }
    return this._ambientPropCache;
  }

  update(dt) {
    if (audioDiagnosticsEnabled()) {
      const combat = audioCombatStatus(this), inCombat = combat.active;
      if (this._audioDiagnosticCombat !== inCombat) {
        recordAudioDiagnosticMarker(inCombat ? 'combat-start' : 'combat-end', { worldId: this.id, environment: this.biome?.name || this.kind,
          depth: this.depth ?? null, inCombat, reason: combat.reason });
        this._audioDiagnosticCombat = inCombat;
      }
    } else this._audioDiagnosticCombat = null;
    const profiling = this._perfProfiling = G.settings?.performanceProfiler === true;
    if (profiling) { this._perfSpatialCandidates = 0; this._perfCollisionPairs = 0; this._perfPathSearches = 0; }
    const worldStart = profiling ? profileStart() : 0;
    this.time += dt;
    lights.length = 0; // refilled by this update's addLight calls, drawn by the next render (paused frames keep the last set)
    let envStart = profiling ? profileStart() : 0;
    this.ambientLights();
    if (profiling) profileRecord('environment', profileEnd(envStart));
    this.pathBudget = 10; // A* searches monsters and minions may run this frame (Monster.navTo), and for at most
    this.pathEnd = performance.now() + 3; // 3 ms of it: a phone a few times slower runs fewer, the rest wait a frame
    const p = this.player;
    // Flow fields are only consumed by dungeon enemies. Town residents use their own
    // bounded A* routes, so rebuilding a full player-centered field there is wasted work.
    this.flowTimer -= dt;
    if (this.kind !== 'town' && p && !p.dead && this.flowTimer <= 0) {
      const pathStart = profiling ? profileStart() : 0;
      this.map.buildFlow(p.x, p.y, this.map.flowRange || 64); // (the Castle's: far enough to lead round by its stairs)
      if (profiling) profileRecord('path', profileEnd(pathStart));
      this.flowTimer = 0.25;
    }
    let collisionStart = profiling ? profileStart() : 0;
    this.rebuildGrid();
    if (profiling) profileRecord('collision', profileEnd(collisionStart));
    const aiStart = profiling ? profileStart() : 0;
    if (p && !p.dead) p.update(dt);
    if (G.world && G.world !== this) { if (profiling) { profileRecord('ai', profileEnd(aiStart)); profileRecord('world', profileEnd(worldStart)); } return; } // the hero just stepped through a portal: this world stops with him gone
    const ax = p ? p.x : 0, ay = p ? p.y : 0;
    for (const c of this.creatures) {
      if (c === p || c.dead) continue;
      // only simulate creatures near the action
      if (c.team === 'enemy' && !c.awake && dist2(c.x, c.y, ax, ay) > 26 * 26) continue;
      c.update(dt);
    }
    if (this.townLife) this.townLife.update(dt);
    for (const n of this.npcs) n.update && n.update(dt);
    this.openDoors();
    if (profiling) profileRecord('ai', profileEnd(aiStart));
    const hazardStart = profiling ? profileStart() : 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.update(dt) === false || h.dead) {
        this.hazards.splice(i, 1); if (G.settings?.performanceProfiler === true) this.lifecycle.hazardsRemoved++;
        if (h.world === this) h.world = null;
      }
      else if (h.o && h.o.aug) augHazard(h, dt);
    }
    if (profiling) profileRecord('hazard', profileEnd(hazardStart));
    collisionStart = profiling ? profileStart() : 0;
    this.separate();
    if (this.map.sheer) sheerUpdate(this, dt);
    if (profiling) profileRecord('collision', profileEnd(collisionStart));
    // Completion must observe a defeated guardian before cleanup detaches dead
    // entities. This also catches scripted deaths that set `dead` directly
    // instead of flowing through combat.kill().
    reconcileBossDefeats(this);
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.dead && c !== p && (c.removeT = (c.removeT || 0) + dt) > 0.05) {
        this.creatures.splice(i, 1); if (G.settings?.performanceProfiler === true) this.lifecycle.creaturesRemoved++;
        if (c.world === this) c.world = null;
      }
    }
    // Loot may stay on the floor indefinitely, so only airborne loot, nearby loot, and
    // the player's explicit target need per-frame simulation. A time heap handles expiry
    // for distant drops without waking every item on every frame.
    const lootStart = profiling ? profileStart() : 0;
    if (this.loot.length - (this._lootTombstones || 0) !== (this._lootRegistered || 0)) this.rebuildLootIndex();
    let expiredLoot = false;
    while (this.lootExpiry.length && this.lootExpiry[0].at <= this.time) {
      const entry = heapPop(this.lootExpiry), l = entry.ref.deref();
      if (!l || l._lootRemoved || l._lootTimerToken !== entry.token || l._lootExpiryAt !== entry.at) continue;
      this.removeLoot(l); expiredLoot = true;
    }
    // Expiry can happen in a large batch after menus or a paused/resumed scene.
    // Compact once after the batch so expired records are not retained by loot[].
    if (expiredLoot) this._compactLoot(true);
    const serial = ++this._lootUpdateSerial;
    const updateLoot = (l) => {
      if (!l || l._lootRemoved || l._lootUpdateSerial === serial) return;
      l._lootUpdateSerial = serial;
      if (l.update(dt, this) === false) { this.removeLoot(l); return; }
      this.updateLootPosition(l);
      if (l.z <= 0 && l.vz <= 0) this.movingLoot.delete(l);
    };
    for (const l of this.movingLoot) updateLoot(l);
    for (const l of this.unindexedLoot) updateLoot(l);
    if (p && !p.dead) {
      const radius = Math.max(4, p.st?.markPickupRadius || 0);
      const near = this.queryLootRect(p.x - radius, p.y - radius, p.x + radius, p.y + radius, this.lootNearBuffer);
      for (const l of near) updateLoot(l);
      if (p.lootTarget && !p.lootTarget._lootRemoved) updateLoot(p.lootTarget);
    }
    this._compactLoot();
    this._compactLootTimers();
    if (profiling) profileRecord('loot', profileEnd(lootStart));
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      if (c.t >= OBJECT_LIFETIMES.corpse.max || c.used) this.corpses.splice(i, 1);
    }
    if (this.corpses.length > 70) this.corpses.splice(0, this.corpses.length - 70);
    for (let i = this.fallen.length - 1; i >= 0; i--) if ((this.fallen[i].t += dt) > 3) this.fallen.splice(i, 1);
    if (p) this.map.reveal(p.x, p.y, 11);
    envStart = profiling ? profileStart() : 0;
    this.ambient(dt);
    if (profiling) profileRecord('environment', profileEnd(envStart));
    const vfxStart = profiling ? profileStart() : 0;
    updateVfx(dt, this);
    if (profiling) { profileRecord('vfx', profileEnd(vfxStart)); profileRecord('world', profileEnd(worldStart)); }
  }

  /** Push overlapping creatures apart. */
  separate() {
    const p = this.player, px = p?.x || 0, py = p?.y || 0, sleepRadius2 = 26 * 26;
    const dormantAndFar = (c) => c.team === 'enemy' && !c.awake && p && dist2(c.x, c.y, px, py) > sleepRadius2;
    for (const [, cell] of this.grid) {
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i];
        if (a.static || dormantAndFar(a)) continue;
        for (let j = i + 1; j < cell.length; j++) {
          const b = cell[j];
          // Sleeping enemies beyond the AI wake radius still participate in
          // spatial queries, but need no physical separation until they wake.
          if (dormantAndFar(b) || (b.static && b.owner === a)) continue;
          if (this._perfProfiling) this._perfCollisionPairs++;
          const dx = b.x - a.x, dy = b.y - a.y;
          const rr = (a.r + b.r) * 0.85;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          const nx = dx / d, ny = dy / d;
          const wa = b.static ? 1 : a.isPlayer ? 0.25 : b.isPlayer ? 0.75 : 0.5;
          const wb = 1 - wa;
          this.map.move(a, -nx * push * wa * 2, -ny * push * wa * 2, a.ghost);
          if (!b.static) this.map.move(b, nx * push * wb * 2, ny * push * wb * 2, b.ghost);
        }
      }
    }
  }

  /** Doors swing open (and stay open) when anyone walks up to them. They never block: monsters path straight through. */
  openDoors() {
    for (const d of this.map.doors) {
      if (d.open || d.locked || this.query(d.x, d.y, 1.1).length === 0) continue;   // (a locked one: the Snowy Summit's gates)
      d.open = true;
      sfx('door', 0.8);
    }
  }

  /** Ambient environmental lights (torches, braziers, portals) registered first with priority so they are never starved by combat/loot lights. */
  ambientLights() {
    const b = this.biome;
    // torches & lamps: a light reaches ~240px from sconce, so cull by 280px margin (offset by flame height)
    const lr = camera.viewRect(280);
    for (const t of this.torches) {
      const fz = t.flameZ ?? 60;
      const px = isoX(t.x, t.y), py = isoY(t.x, t.y) - fz;
      if (px < lr.x0 || px > lr.x1 || py < lr.y0 || py > lr.y1 + 80) continue;
      addLight(t.x, t.y, 5.5 + Math.sin(this.time * 9 + t.x) * 0.3, 0.9, fz, b.torch || '#ff9a40', true);
    }
    const lit = (x, y) => { const px = isoX(x, y), py = isoY(x, y); return px > lr.x0 && px < lr.x1 && py > lr.y0 && py < lr.y1 + 80; };
    for (const pr of this.ambientProps()) {
      if (pr.light && lit(pr.x, pr.y)) addLight(pr.x, pr.y, pr.light + Math.sin(this.time * 7 + pr.x) * 0.15, 0.8, 20 + (pr.z || 0), pr.lightColor || '#ffb050');
    }
    for (const po of this.portals) {
      if (po.active && lit(po.x, po.y)) addLight(po.x, po.y, 6, 1, 20, po.color || '#ff6030', true);
    }
  }

  ambient(dt) {
    const b = this.biome;
    const vr = camera.viewRect(60);
    // torch glow motes near the view
    for (const t of this.torches) {
      const fz = t.flameZ ?? 60;
      const px = isoX(t.x, t.y), py = isoY(t.x, t.y) - fz;
      if (px < vr.x0 || px > vr.x1 || py < vr.y0 || py > vr.y1 + 80) continue;
      if (chance(dt * 18)) spawn({ type: 'glow', x: t.x + rand(-0.04, 0.04), y: t.y + rand(-0.04, 0.04), z: fz + 20, vz: rand(15, 35), life: rand(0.3, 0.6), size: rand(2, 3.5), size1: 0.5, color: chance(0.5) ? (b.torch || '#ff9a40') : '#fff0a0', add: true });
    }
    // lit props and portals near the view only: smoke & glow particles
    for (const pr of this.ambientProps()) {
      if (!pr.smoke) continue;
      // camp fires and chimneys (the Castle): a slow plume drifting downwind, embers off a fire
      const px = isoX(pr.x, pr.y), py = isoY(pr.x, pr.y);
      if (px < vr.x0 || px > vr.x1 || py < vr.y0 || py > vr.y1 + 160) continue;
      if (chance(dt * pr.smoke)) spawn({ type: 'smoke', x: pr.x + rand(-0.15, 0.15), y: pr.y + rand(-0.15, 0.15), z: pr.smokeZ ?? 16, vx: rand(0.05, 0.3), vy: rand(-0.25, 0), vz: rand(12, 22), life: rand(2.4, 3.8), size: rand(4, 7), size1: rand(15, 24), color: '#3b3733', alpha: 0.26 });
      if (pr.light && chance(dt * 5)) spawn({ type: 'glow', x: pr.x + rand(-0.2, 0.2), y: pr.y + rand(-0.2, 0.2), z: 14, vz: rand(30, 60), life: rand(0.6, 1.2), size: rand(1.5, 2.5), size1: 0.4, color: chance(0.5) ? '#ffb050' : '#ffe0a0', add: true });
    }
    // portals
    const lr = camera.viewRect(280);
    const lit = (x, y) => { const px = isoX(x, y), py = isoY(x, y); return px > lr.x0 && px < lr.x1 && py > lr.y0 && py < lr.y1 + 80; };
    for (const po of this.portals) {
      if (!po.active || !lit(po.x, po.y)) continue;
      if (chance(dt * 30)) sparkle(po.x, po.y, rand(10, 60), po.color || '#ff6030', 1, 0.6);
    }
    if (this.raining) {
      this.rainT = (this.rainT || 0) + dt;
      const rate = G.touch ? 26 : 70;
      while (this.rainT >= 1 / rate) {
        this.rainT -= 1 / rate;
        const [x, y] = camera.screenToTile(rand(0, G.W), rand(-G.H * 0.1, G.H));
        spawn({ type: 'streak', x, y, z: rand(100, 180), vx: 0.35, vy: 0.1, vz: -105,
          life: 1.4, size: G.touch ? 1 : 1.25, color: '#c6dbe5' });
      }
    }
    // ambient particles around the camera
    const amb = this.ambientFx || b?.ambient;   // a castle variant's own drift (snow, ash, petals...) over the biome's
    if (!amb) return;
    this.ambT += dt;
    const rate = G.touch ? 10 : 22;
    while (this.ambT > 1 / rate) {
      this.ambT -= 1 / rate;
      const [tx, ty] = camera.screenToTile(rand(0, G.W), rand(-G.H * 0.1, G.H));
      const a = amb, col = a.color;
      switch (a.type) {
        case 'snow': spawn({ type: 'dot', x: tx, y: ty, z: rand(80, 160), vx: rand(-0.3, 0.3), vy: rand(0.1, 0.4), vz: -rand(25, 45), life: 4, size: rand(1.2, 2.4), color: col }); break;
        case 'ember': spawn({ type: 'glow', x: tx, y: ty, z: rand(0, 30), vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(15, 40), life: rand(1.5, 3), size: rand(1, 2.2), size1: 0, color: col, add: true }); break;
        case 'ash': spawn({ type: 'dot', x: tx, y: ty, z: rand(60, 140), vx: rand(-0.4, 0.1), vy: rand(0, 0.3), vz: -rand(10, 25), life: 5, size: rand(1, 2), color: col }); break;
        case 'spore': case 'mote': case 'glitter': case 'firefly':
          spawn({ type: 'glow', x: tx, y: ty, z: rand(10, 70), vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25), vz: rand(-5, 8), life: rand(2, 4), size: rand(0.8, 1.8), size1: 0.2, color: col, add: true }); break;
        case 'drip': if (chance(0.5)) spawn({ type: 'dot', x: tx, y: ty, z: 120, vz: -60, g: 200, life: 1.2, size: 1.5, color: col }); break;
        case 'bubble': spawn({ type: 'glow', x: tx, y: ty, z: 0, vz: rand(8, 20), life: rand(0.8, 1.6), size: rand(1, 2), size1: 2.5, color: col, add: true }); break;
        case 'sand': spawn({ type: 'dot', x: tx, y: ty, z: rand(5, 40), vx: rand(0.6, 1.2), vy: rand(-0.6, -0.2), life: 2.5, size: 1.2, color: col }); break;
        case 'leaf': spawn({ type: 'dot', x: tx, y: ty, z: rand(60, 120), vx: rand(-0.4, 0.4), vy: rand(0, 0.4), vz: -rand(10, 20), life: 5, size: 2, color: col }); break;
        case 'spark': if (chance(0.3)) spawn({ type: 'glow', x: tx, y: ty, z: rand(20, 80), vx: rand(-2, 2), vy: rand(-2, 2), life: 0.3, size: 1.5, color: col, add: true }); break;
        case 'wisp': smoke(tx, ty, 0, '#120c18', 1, 10); break;
        default: spawn({ type: 'dot', x: tx, y: ty, z: rand(10, 90), vx: rand(-0.1, 0.1), vy: rand(-0.1, 0.1), vz: rand(-3, 3), life: 4, size: 1, color: col });
      }
    }
  }
}

export { TAU };
