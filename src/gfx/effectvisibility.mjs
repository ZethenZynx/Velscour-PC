import { HW, currentWarp } from '../core/view.js';

// Conservative visual bounds for effects with a world-space origin. Unknown/custom effects stay visible.
export function effectOutsideView(effect, x0, y0, x1, y1, projectX, projectY) {
  if (currentWarp()) return false; // warped worlds can bend between two projected endpoints
  if (Array.isArray(effect.bolts)) return false; // sky-wide forks can cross the view from an offscreen origin
  if (Number.isFinite(effect.x0) && Number.isFinite(effect.y0) && Number.isFinite(effect.x1) && Number.isFinite(effect.y1)) {
    const ax = projectX(effect.x0, effect.y0), ay = projectY(effect.x0, effect.y0);
    const bx = projectX(effect.x1, effect.y1), by = projectY(effect.x1, effect.y1);
    const pad = Math.max(32, Math.abs(effect.width || effect.w || 0) * HW * 1.5 + 16);
    return Math.max(ax, bx) + pad < x0 || Math.min(ax, bx) - pad > x1 ||
      Math.max(ay, by) + pad < y0 || Math.min(ay, by) - pad > y1;
  }
  const origin = Number.isFinite(effect.x) && Number.isFinite(effect.y) ? effect : effect.sig;
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return false;
  const px = projectX(origin.x, origin.y), py = projectY(origin.x, origin.y) - (effect.z || 0);
  const tileRadius = Math.max(0, Math.abs(effect.r || 0), Math.abs(effect.r0 || 0), Math.abs(effect.r1 || 0), Math.abs(effect.len || 0), Math.abs(effect.radius || 0));
  const pixelRadius = Math.max(0, Math.abs(effect.R || 0), Math.abs(effect.height || 0), Math.abs(effect.w || 0), Math.abs(effect.h || 0), Math.abs(effect.width || 0));
  const pad = Math.max(256, tileRadius * HW * 2 + pixelRadius + 32);
  return px + pad < x0 || px - pad > x1 || py + pad < y0 || py - pad > y1;
}
