// Shared world-space speech bubbles for NPCs, town props and the player. Text wraps
// without a line limit, and bubble bounds stay inside the current camera viewport.
import { G } from '../state.js';
import { clamp } from '../core/util.js';
import { camera } from '../core/view.js';

const FONT = '600 11px "Alegreya Sans", "Segoe UI", sans-serif';
const LINE_HEIGHT = 14;
const MAX_WIDTH = 260;
const PAD_X = 12;
const PAD_Y = 6;

/** Estimate a comfortable reading time for speech bubbles (roughly 165 words/minute). */
export function townSpeechDuration(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.2, 1.2 + words / 2.75);
}

/** Wrap by words, then by characters for long unbroken strings; never drops message text. */
export function wrapTownSpeech(text, maxTextWidth, measureText) {
  const lines = [];
  const paragraphs = String(text ?? '').split(/\r?\n/);
  const fits = (s) => measureText(s) <= maxTextWidth;
  const pushLongWord = (word) => {
    let part = '';
    for (const char of word) {
      if (part && !fits(part + char)) { lines.push(part); part = ''; }
      part += char;
    }
    return part;
  };
  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      line = fits(word) ? word : pushLongWord(word);
    }
    if (line) lines.push(line);
    else if (!paragraph.trim()) lines.push('');
  }
  return lines.length ? lines : [''];
}

/** Keep a world-space speech bubble inside the camera's visible world rectangle. */
export function clampSpeechBubble(x, y, width, height, bounds, margin = 8) {
  const minX = bounds.x0 + margin, minY = bounds.y0 + margin;
  const maxX = Math.max(minX, bounds.x1 - width - margin);
  const maxY = Math.max(minY, bounds.y1 - height - margin);
  return [clamp(x, minX, maxX), clamp(y, minY, maxY)];
}

export function drawTownSpeech(ctx, n, x, spriteTop) {
  if (!n.talkText || n.talkT <= 0) { n.bubbleRect = null; n._townSpeechTimedText = null; return; }
  // Extend short script-provided timers to match the full message. talkAge is reset by
  // speech setters, so the same line can be spoken again without carrying old timing.
  const age = Math.max(0, n.talkAge || 0);
  if (n._townSpeechTimedText !== n.talkText || age < 0.1) {
    n.talkT = Math.max(n.talkT, townSpeechDuration(n.talkText) - age);
    n._townSpeechTimedText = n.talkText;
  }
  ctx.save();
  const k = Math.min(1, age / 0.18), fade = Math.min(1, n.talkT / 0.35);
  ctx.globalAlpha = Math.min(k, fade);
  ctx.font = `${n.dark ? 'italic ' : ''}${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const bounds = camera.viewRect();
  const visibleWidth = Math.max(72, bounds.x1 - bounds.x0 - 24);
  const maxWidth = Math.min(MAX_WIDTH, visibleWidth);
  const lines = wrapTownSpeech(n.talkText, maxWidth - PAD_X * 2, (s) => ctx.measureText(s).width);
  const width = Math.min(maxWidth, Math.max(60, ...lines.map((line) => ctx.measureText(line).width + PAD_X * 2)));
  const height = lines.length * LINE_HEIGHT + PAD_Y * 2;
  const startX = x - width / 2, startY = spriteTop - height - 12 + (1 - k) * 6;
  const occupied = [...(G.world?.npcs || []).filter(q => q !== n && q.talkT > 0).map(q => q.bubbleRect), n !== G.player && G.player?.talkT > 0 && G.player.bubbleRect, n !== G.player && G.player?.sbox].filter(Boolean);
  const intersects = (bx, by) => occupied.some(([l, t, r, b]) => bx < r + 5 && bx + width > l - 5 && by < b + 5 && by + height > t - 5);
  const offsets = [[0, 0], [-38, -6], [38, -6], [0, -height - 6], [-70, -10], [70, -10], [-38, -height - 8], [38, -height - 8]];
  const [ox, oy] = offsets.find(([dx, dy]) => !intersects(startX + dx, startY + dy)) || [0, 0];
  const [clampedX, clampedY] = clampSpeechBubble(startX + ox, startY + oy, width, height, bounds);
  const bx = Math.round(clampedX), by = Math.round(clampedY), radius = 8;
  n.bubbleRect = [bx - 3, by - 3, bx + width + 3, by + height + 9];
  const rounded = (x0, y0, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0);
    ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r); ctx.lineTo(x0 + w, y0 + h - r);
    ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h); ctx.lineTo(x0 + r, y0 + h);
    ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r); ctx.lineTo(x0, y0 + r);
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
  };
  // Soft shadow, double-trimmed rounded parchment and anchored tail.
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#19100d'; rounded(bx - 3, by - 3, width + 6, height + 6, radius + 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const [rimC, paper, inkC, lineC] = n.dark ? ['#4fae88', '#16211f', '#bff4dc', '#2e6a58'] : ['#bb9360', '#f0dfbc', '#302115', '#7b573b'];
  ctx.fillStyle = rimC; rounded(bx - 1, by - 1, width + 2, height + 2, radius + 1); ctx.fill();
  ctx.fillStyle = paper; rounded(bx + 1, by + 1, width - 2, height - 2, radius); ctx.fill();
  ctx.strokeStyle = lineC; ctx.lineWidth = .9; rounded(bx + 3, by + 3, width - 6, height - 6, radius - 1); ctx.stroke();
  const baseX = clamp(x, bx + 15, bx + width - 15), bottom = by + height, tipY = spriteTop - 2;
  ctx.fillStyle = '#19100d'; ctx.beginPath(); ctx.moveTo(baseX - 8, bottom - 2); ctx.lineTo(baseX + 8, bottom - 2); ctx.lineTo(x, tipY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = paper; ctx.beginPath(); ctx.moveTo(baseX - 5, bottom - 4); ctx.lineTo(baseX + 5, bottom - 4); ctx.lineTo(x, tipY - 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = inkC;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + width / 2, by + PAD_Y + LINE_HEIGHT / 2 + i * LINE_HEIGHT);
  ctx.restore();
}
