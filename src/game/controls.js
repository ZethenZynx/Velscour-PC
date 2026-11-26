// Translates raw input into hero actions.
import { G } from '../state.js';
import { input } from '../core/input.js';
import { camera, screenDirToTile } from '../core/view.js';
import { dist, angleTo } from '../core/util.js';
import { SKILLS, isMovementSkill } from '../data/skills.js';
import { SLOT_KEYS, RMB } from '../data/bar.js';
import { Macros } from './macros.js';
import { isPlayerHostile, isPlayerTargetable, pickPlayerTarget } from './targeting.js';
import { activeExitSpriteAt, chestSpriteHit, portalSpriteHit } from '../core/interactable-hit.js';

function creatureAt(sx, sy) {
  const w = G.world;
  return pickPlayerTarget(w?.creatures, sx, sy);
}

function interactableAt(tx, ty, sx, sy) {
  const w = G.world;
  const project = (x, y, z) => camera.tileToScreen(x, y, z);
  // Dungeon event portals are tall world-space objects. Check their full visible sprite
  // before NPCs and chests so nearby scenery/interactables cannot steal the click.
  for (const p of w.portals) {
    if (!p?.isDungeonEventPortal || p.opened || p.hidden) continue;
    if (portalSpriteHit(p, sx, sy, camera.zoom, project) || dist(p.x, p.y, tx, ty) < (p.reach || 1.7)) return p;
  }
  for (const n of w.npcs) {
    if (n.sbox) {
      const [x0, y0, x1, y1] = n.sbox;
      const [a, b] = camera.toScreen(x0, y0), [c, d] = camera.toScreen(x1, y1);
      if (sx >= a - 4 && sx <= c + 4 && sy >= b - 4 && sy <= d + 4) return n;
    }
  }
  // Chest art is much taller than its ground anchor. Picking only within 0.8 world
  // tiles made the visible lid/body non-interactive, especially when a nearby
  // isometric prop visually covered the floor point under the cursor.
  for (const c of w.chests) {
    if (!c || c.opened || c.hidden) continue;
    if (chestSpriteHit(c, sx, sy, camera.zoom, project) || dist(c.x, c.y, tx, ty) < 0.8) return c;
  }
  for (const p of w.portals) {
    if (p?.isDungeonEventPortal || p?.opened || p?.hidden) continue;
    if (dist(p.x, p.y, tx, ty) < 1.2 || portalSpriteHit(p, sx, sy, camera.zoom, project)) return p;
  }
  return null;
}

function lootAt(sx, sy) {
  for (const b of G.lootBoxes || []) if (Math.abs(sx - b.x) < b.w / 2 && Math.abs(sy - b.y) < b.h / 2) return b.loot;
  return null;
}

export const controls = {
  holdLeft: 0,
  leftShiftActive: false,

  /** Use the skill on bar slot i. */
  useSlot(i, at) {
    const id = G.char.bar[i];
    if (id && SKILLS[id]) this.castSkill(SKILLS[id], at);
  },
  /** Cast a skill aimed at the mouse or at an explicit tile.
   *  True if it went off (game/macros.js moves on to the next skill). */
  castSkill(sk, at) {
    const p = G.player;
    if (!p || p.dead || G.ui.modal || !sk) return false;
    let tx, ty, target = null;
    if (at) { [tx, ty] = at; target = isPlayerHostile(G.hover) ? G.hover : null; }
    else {
      [tx, ty] = camera.screenToTile(input.mouse.x, input.mouse.y);
      target = G.hover && G.hover.team !== 'player' ? G.hover : null;
    }
    if (['blink', 'dash', 'leap'].includes(sk.kind)) {
      Macros.clearKeep();
    }
    if (sk.kind === 'melee' && target && !at) return p.tryUseSkill(sk, target.x, target.y, target);
    return p.tryUseSkill(sk, tx, ty, null);
  },

  update(dt) {
    const p = G.player, w = G.world;
    if (!p || !w) return;
    const ui = G.ui;
    const blocked = ui.modal || G.paused || G.cine;
    // ---- hover
    const mouse = input.mouse;
    const useMouse = input.lastPointerType === 'mouse';
    G.hover = useMouse && mouse.inside ? creatureAt(mouse.x, mouse.y) : null;
    if (G.hover && G.hover.team === 'player') G.hover = null;
    if (p.dead || blocked) { this.leftShiftActive = false; p.moveVec = [0, 0]; p.moveTarget = null; p.path = null; p.attackTarget = null; p.interact = null; p.moving = false; input.endFrame(); return; }

    // ---- direct movement (WASD / joystick)
    let mx = 0, my = 0;
    if (!ui.anyOpen()) {
      if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    }
    let mag = Math.hypot(mx, my);
    if (mag > 0.15) {
      let [tx, ty] = screenDirToTile(mx, my);
      const l = Math.hypot(tx, ty);
      const k = Math.min(1, mag) / (l || 1);
      p.moveVec = [tx * k, ty * k];
    } else p.moveVec = [0, 0];

    // ---- aim point for channels / whirlwind
    if (mouse.inside) p.aim = camera.screenToTile(mouse.x, mouse.y);

    // ---- mouse
    if (!mouse.left) this.leftShiftActive = false;
    if (useMouse) {
      const [tx, ty] = camera.screenToTile(mouse.x, mouse.y);
      const shift = input.down('ShiftLeft') || input.down('ShiftRight');
      if (mouse.leftPressed) {
        this.holdLeft = 0;
        this.leftShiftActive = shift;
        if (shift) {
          // Shift-click is an explicit combat command: cancel any prior loot walk
          // before choosing the primary target or firing at the cursor.
          p.lootTarget = null; p.interact = null; p.moveTarget = null; p.path = null; p.attackTarget = null;
          this.mode = 'attack';
          if (isPlayerTargetable(G.hover)) this.attack(G.hover, tx, ty);
          else this.useSlot(0, [tx, ty]);
        } else {
          const exit = activeExitSpriteAt(G.world?.portals, mouse.x, mouse.y, camera.zoom, (x, y, z) => camera.tileToScreen(x, y, z), G.world?.rift);
          const loot = lootAt(mouse.x, mouse.y);
          const it = exit || interactableAt(tx, ty, mouse.x, mouse.y);
          // A completed exit's visible artwork takes priority over overlapping
          // loot-label hitboxes, so portal clicks do not silently pick loot only.
          if (exit) { this.mode = 'interact'; p.attackTarget = null; p.lootTarget = null; p.interact = exit; }
          else if (loot) { p.lootTarget = loot; p.interact = null; p.attackTarget = null; p.setMoveTarget(loot.x, loot.y); this.mode = 'loot'; }
          // A visible hostile body owns its click even when a chest, portal, trap,
          // or decoration overlaps it. Interactables remain clickable elsewhere.
          else if (isPlayerTargetable(G.hover)) { this.mode = 'attack'; this.attack(G.hover, tx, ty); }
          else if (it) { this.mode = 'interact'; p.attackTarget = null; p.interact = it; }
          else { this.mode = 'move'; p.attackTarget = null; p.interact = null; p.setMoveTarget(tx, ty); }
        }
      } else if (mouse.left) {
        this.holdLeft += dt;
        if (shift) {
          if (!this.leftShiftActive || this.mode === 'loot' || p.lootTarget) {
            p.lootTarget = null; p.interact = null; p.moveTarget = null; p.path = null; p.attackTarget = null;
            this.mode = 'attack'; this.leftShiftActive = true;
            if (isPlayerTargetable(G.hover)) this.attack(G.hover, tx, ty);
            else this.useSlot(0, [tx, ty]);
          } else if (this.mode === 'attack' && p.castLock <= 0 && !p.attackTarget && !isMovementSkill(SKILLS[G.char.bar[0]])) {
            if (isPlayerHostile(G.hover)) this.attack(G.hover, tx, ty);
            else this.useSlot(0, [tx, ty]);
          }
        } else {
          if (this.leftShiftActive) {
            this.leftShiftActive = false;
            const loot = lootAt(mouse.x, mouse.y);
            if (loot) { p.lootTarget = loot; p.interact = null; p.attackTarget = null; p.setMoveTarget(loot.x, loot.y); this.mode = 'loot'; }
          }
          if (this.mode === 'move' && this.holdLeft > 0.12) {
            if (isPlayerHostile(G.hover) && this.holdLeft > 0.4) { this.mode = 'attack'; }
            else if (!p.moveTarget || dist(p.moveTarget[0], p.moveTarget[1], tx, ty) > 0.6) p.setMoveTarget(tx, ty);
          } else if (this.mode === 'attack' && p.castLock <= 0 && !p.attackTarget && !isMovementSkill(SKILLS[G.char.bar[0]])) {
            if (isPlayerHostile(G.hover)) this.attack(G.hover, tx, ty);
            else this.useSlot(0, [tx, ty]);
          }
        }
      }
      const id = G.char.bar[RMB];
      const sk = id && SKILLS[id];
      if (mouse.rightPressed || (mouse.right && p.castLock <= 0 && !isMovementSkill(sk))) {
        if (id) {
          if (shift) { p.lootTarget = null; p.interact = null; p.moveTarget = null; p.path = null; p.attackTarget = null; this.mode = 'attack'; }
          p.moveTarget = null; this.useSlotAt(RMB, tx, ty);
        }
      }
    }

    // ---- macros (their keys, the queue, Keep up), then number keys & potions
    Macros.tick(dt);
    SLOT_KEYS.forEach((k, i) => {
      const id = G.char.bar[i];
      const sk = id && SKILLS[id];
      if (k && (input.consume(k) || (input.down(k) && p.castLock <= 0 && !isMovementSkill(sk)))) this.useSlot(i);
    });
    if (input.consume('KeyZ')) p.usePotion('hp');
    if (input.consume('KeyX')) p.usePotion('mp');
    if (input.consume('KeyR')) p.usePotion('rejuv');
    if (input.consume('KeyV')) p.usePotion('fury');

    input.endFrame();
  },

  useSlotAt(i, tx, ty) {
    const id = G.char.bar[i];
    const sk = id && SKILLS[id];
    if (!sk) return;
    const target = isPlayerHostile(G.hover) ? G.hover : null;
    if (sk.kind === 'melee' && target) G.player.tryUseSkill(sk, target.x, target.y, target);
    else G.player.tryUseSkill(sk, tx, ty, null);
  },

  attack(target, tx, ty) {
    const p = G.player;
    const id = G.char.bar[0];
    const sk = id && SKILLS[id];
    p.interact = null; p.moveTarget = null; p.path = null;
    if (!sk) return;
    if (isMovementSkill(sk)) {
      // A direct enemy click still means "move toward this cursor point" for directional skills.
      // Keep the sampled cursor coordinates and never pass the hovered enemy as a steering target.
      p.tryUseSkill(sk, tx, ty, null);
      return;
    }
    if (sk.kind === 'melee') p.tryUseSkill(sk, target.x, target.y, target);
    else p.tryUseSkill(sk, target ? target.x : tx, target ? target.y : ty, target);
    p.face(angleTo(p.x, p.y, target.x, target.y));
  },
};
