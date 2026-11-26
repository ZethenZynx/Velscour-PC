// VELSCOUR - entry point.
import { G, loadSettings, saveSettings } from './state.js';
import { initInput, input } from './core/input.js';
import { camera } from './core/view.js';
import { loadAssets } from './core/assets.js';
import { loadEnemyArt, loadPetArt } from './core/enemyart.js';
import { rand, TAU } from './core/util.js';
import { UI, $ } from './ui/ui.js';
import { initMouseCursor } from './ui/mousecursor.js';
import { HUD } from './ui/hud.js';
import { applyUILayoutSettings } from './ui/layoutcustomizer.js';
import { LoadingScreen } from './ui/loading.js';
import { titleScreen } from './ui/screens.js';
import { GameChat } from './ui/chat.js';
import { Vendor } from './ui/vendor.js';
import { Stash } from './ui/stash.js';
import { JewelBox } from './ui/jewelbox.js';
import { Reliquary } from './ui/reliquary.js';
import { Heresies } from './ui/heresies.js';
import { Rifts } from './ui/rifts.js';
import { Marks } from './ui/marks.js';
import { MacrosUI } from './ui/macros.js';
import { game } from './game/game.js';
import { dropBakes } from './game/render.js';
import { controls } from './game/controls.js';
import { initSpectate } from './game/spectate.js';
import { applyVolumes, preloadSong, TITLE_SONG, recordAudioDiagnosticMarker, recordAudioDiagnosticFrame } from './core/audio.js';
import { performanceProfilerEnabled, profileBeginFrame, profileEnd, profileFinishFrame, profileSetRender, profileSetUpdate, recordSimulationTiming, setPerformanceProfilerEnabled } from './core/perfdiagnostics.js';
import { observeAdaptivePerformance, performanceTier } from './core/performancequality.mjs';
import { applyPerformanceQuality } from './gfx/vfx.js';
import { ensureJewelBoxMigration } from './game/jewelboxstorage.mjs';
import { renderResolutionScale } from './core/render-resolution.mjs';

function resize() {
  G.W = window.innerWidth;
  G.H = window.innerHeight;
  const maxDpr = G.touch ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  // cap the backing store to keep fill-rate sane on huge / high-dpi screens
  const maxPixels = G.touch ? 1.6e6 : 4.2e6;
  if (G.W * G.H * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (G.W * G.H));
  // Adaptive Performance changes cosmetic quality only; the selected graphics
  // preset controls backing-store scale. Apply the pixel budget after that scale.
  // A minimum 0.75 DPR could otherwise
  // undo the cap on large phones/tablets and silently allocate oversized buffers.
  G.dpr = Math.max(0.5, Math.min(dpr * (G.resScale || 1), Math.sqrt(maxPixels / (G.W * G.H))));
  G.canvas.width = Math.round(G.W * G.dpr);
  G.canvas.height = Math.round(G.H * G.dpr);
  camera.computeZoom();
  const portrait = G.H > G.W || window.innerHeight > window.innerWidth;
  document.body.classList.toggle('portrait', portrait);
  document.body.classList.toggle('landscape', !portrait);
  document.body.classList.toggle('compact-mobile-hud', G.touch);
}

// ---------------------------------------------------------- title backdrop
const embers = [];
function makeTitleEmber(W, H, spawnAnywhere = false) {
  const life = rand(4.0, 9.5);
  const t = spawnAnywhere ? rand(0, life) : 0;
  return {
    x: rand(0, W),
    y: spawnAnywhere ? rand(-20, H + 20) : H + rand(5, 30),
    vx: rand(-12, 12),
    vy: rand(28, 75),
    t,
    life,
    sz: rand(0.8, 2.2),
    seed: rand(100),
    drift: rand(-8, 8),
    swayAmp: rand(14, 28),
    flutterFreq: rand(6, 14),
    flickerRate: rand(10, 20),
    baseAlpha: rand(0.45, 0.95),
    popTimer: rand(1.0, 3.5),
    flare: 0,
    trailLen: rand(0.03, 0.065),
  };
}

function renderTitle(dt) {
  const ctx = G.ctx, W = G.canvas.width, H = G.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#060203'); g.addColorStop(0.7, '#1a0503'); g.addColorStop(1, '#3a0a04');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const maxEmbers = G.touch ? 75 : 140;
  const initial = embers.length === 0;
  while (embers.length < maxEmbers) embers.push(makeTitleEmber(W, H, initial));

  const dpr = G.dpr || 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (let i = 0; i < embers.length; i++) {
    const e = embers[i];
    e.t += dt;
    const u = e.t / e.life;
    if (u >= 1 || e.y < -40 || e.x < -30 || e.x > W + 30) {
      embers[i] = makeTitleEmber(W, H, false);
      continue;
    }

    const eddy1 = Math.sin(e.y * 0.007 + G.time * 1.6 + e.seed) * e.swayAmp;
    const eddy2 = Math.cos(e.x * 0.012 - G.time * 2.2 + e.seed * 1.5) * (e.swayAmp * 0.45);
    const flutter = Math.sin(G.time * e.flutterFreq + e.seed * 2.5) * (e.swayAmp * 0.3);
    e.vx += (eddy1 + eddy2 + flutter + e.drift) * dt * 1.2;
    e.vx *= (1 - dt * 1.1);

    e.popTimer -= dt;
    if (e.popTimer <= 0) {
      e.popTimer = rand(1.5, 4.0);
      e.vx += rand(-18, 18);
      e.vy += rand(8, 20);
      e.flare = 0.55;
      e.drift = rand(-10, 10);
    }
    if (e.flare > 0) e.flare = Math.max(0, e.flare - dt * 2.0);

    e.x += e.vx * dt * dpr;
    e.y -= e.vy * dt * dpr;

    const fadeIn = u < 0.08 ? u / 0.08 : 1;
    const fadeOut = u > 0.8 ? (1 - u) / 0.2 : 1;
    const flicker = 0.8 + 0.2 * Math.sin(e.t * e.flickerRate + e.seed);
    const brightness = Math.min(1.5, flicker + e.flare);
    const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut * e.baseAlpha * brightness));
    if (alpha <= 0.01) continue;

    let r, g2, b;
    if (u < 0.25) {
      const k = u / 0.25;
      r = 255; g2 = Math.round(230 - 65 * k); b = Math.round(140 - 110 * k);
    } else if (u < 0.6) {
      const k = (u - 0.25) / 0.35;
      r = 255; g2 = Math.round(165 - 95 * k); b = Math.round(30 - 20 * k);
    } else if (u < 0.85) {
      const k = (u - 0.6) / 0.25;
      r = Math.round(255 - 85 * k); g2 = Math.round(70 - 52 * k); b = Math.round(10 - 5 * k);
    } else {
      const k = (u - 0.85) / 0.15;
      r = Math.round(170 - 90 * k); g2 = Math.round(18 - 12 * k); b = 5;
    }

    const trailTime = e.trailLen * (1 + e.flare * 0.7);
    const tx = e.x - e.vx * trailTime * dpr;
    const ty = e.y + e.vy * trailTime * dpr;

    ctx.strokeStyle = `rgba(${r},${g2},${b},${(alpha * 0.75).toFixed(3)})`;
    ctx.lineWidth = Math.max(0.6 * dpr, e.sz * dpr * 0.65);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();

    const headR = Math.max(0.7 * dpr, e.sz * dpr * 0.6);
    ctx.fillStyle = `rgba(${r},${g2},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, headR, 0, TAU);
    ctx.fill();

    if (brightness > 1.1 || u < 0.2) {
      ctx.fillStyle = `rgba(255,255,230,${Math.min(1, alpha * 1.2).toFixed(3)})`;
      const coreR = Math.max(0.4 * dpr, headR * 0.45);
      ctx.beginPath();
      ctx.arc(e.x, e.y, coreR, 0, TAU);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const cx = W * 0.5, cy = H * 0.5, rad = Math.max(W, H) * 0.72;
  const vig = ctx.createRadialGradient(cx, cy, rad * 0.25, cx, cy, rad);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(0.65, 'rgba(0, 0, 0, 0.6)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.94)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function applyGraphicsQualitySettings() {
  const tier = performanceTier(G.settings);
  const changed = tier !== (G.performanceQualityTier || 0);
  G.performanceQualityTier = tier;
  G.resScale = renderResolutionScale(G.settings);
  if (changed) applyPerformanceQuality();
  resize();
  dropBakes();
}

function adaptCosmeticQuality(raw) {
  const result = observeAdaptivePerformance(raw, G.settings, performance.now());
  if (result.changed) {
    G.performanceQualityTier = result.tier;
    applyPerformanceQuality();
  }
  if (result.recommend) {
    G.settings.performanceRecommendationShown = true;
    saveSettings();
    UI.log?.('<span style="color:#ffc66b">Sustained low frame rate detected. Try the <b>Extreme Performance</b> preset in Settings &gt; Graphics.</span>');
  }
}

window.addEventListener('velscour-graphics-quality-change', applyGraphicsQualitySettings);

let last = performance.now(), lastFrame = 0;   // last: how far the game clock has run; lastFrame: the last animation frame
function loop(now) {
  requestAnimationFrame(loop);
  lastFrame = now;   // frames the cap skips count too, or tick() would keep moving `last` and the cap would skip them all
  // The loading screen owns the frame while assets and the new world are prepared. In particular, don't let the old
  // or newly built world fight, advance ambushes, render expensive maps, or consume input behind the overlay.
  if (G.loading) {
    last = now;
    input.reset();
    input.endFrame();
    return;
  }
  // Settings › frame rate cap: a phone drawing 30 frames a second instead of 60 does half the work and heats up less
  // (a hot phone slows itself down after a long session); 2 ms slack so a 60 Hz display shows every other frame
  const cap = G.mode === 'game' ? G.settings.fpsCap || 0 : 0;
  if (cap && now - last < 1000 / cap - 2) return;
  const raw = Math.max(0, (now - last) / 1000), dt = Math.min(0.05, raw);
  const profiling = profileBeginFrame(now, { rawDeltaMs: raw * 1000, simulationDeltaMs: dt * 1000, discardedMs: Math.max(0, raw - dt) * 1000 });
  last = now;
  adaptCosmeticQuality(raw);
  G.time += dt;
  G.dt = dt;
  G.frame++;
  // the update and the draw each get their own try: an update that throws every frame (a broken fight) used to skip
  // every draw too, and the screen went black
  if (G.mode === 'game' && G.world) {
    const started = profiling ? performance.now() : 0;
    try { game.update(dt); } catch (err) { reportError(err); }
    if (profiling) profileSetUpdate(profileEnd(started));
  }
  const renderStarted = profiling ? performance.now() : 0;
  try {
    if (G.mode === 'game' && G.world) game.render();
    else renderTitle(dt);
  } catch (err) {
    reportError(err);
    // a draw that threw left its save()s (clips, alpha, transforms) on the stack: unwind them, or every later frame
    // draws through them (restore() past the bottom of the stack does nothing)
    if (G.ctx) for (let i = 0; i < 64; i++) G.ctx.restore();
  }
  if (profiling) profileSetRender(profileEnd(renderStarted));
  input.endFrame();
  recordAudioDiagnosticFrame();
  if (profiling) profileFinishFrame(G.world);
}

// A hidden page (minimised, covered by other windows, a locked PC) gets no animation frames, and its timers are
// running in real time while nothing is drawn. They also step in when frames stop on a page that still counts as visible.
let lastTick = 0;
function tick() {
  const now = performance.now(), gap = now - lastTick;
  lastTick = now;
  // A hidden-page worker must respect the same loading pause as the visible animation loop.
  if (G.loading) { last = now; input.reset(); input.endFrame(); return; }
  // a short gap means the ticks arrive on time: frames stopped, not one long frame holding up this thread
  if (!document.hidden && !(now - lastFrame > 500 && gap < 100)) return;
  const observedElapsedMs = Math.max(0, Math.min(now - last, gap));
  let left = Math.min(observedElapsedMs, 1000) / 1000;
  const catchupBudgetMs = left * 1000, discardedMs = Math.max(0, observedElapsedMs - catchupBudgetMs);
  let simulatedMs = 0;
  let updates = 0;
  last = now;
  const startedAt = performanceProfilerEnabled() ? performance.now() : 0;
  try {
    while (left > 1e-4 && G.mode === 'game' && G.world) {
      const dt = Math.min(1 / 30, left);
      left -= dt;
      G.time += dt; G.dt = dt; G.frame++;
      simulatedMs += dt * 1000;
      game.update(dt);
      input.endFrame();
      updates++;
    }
  } catch (err) {
    reportError(err);
  } finally {
    if (startedAt) recordSimulationTiming({ source: 'catchup', realElapsedMs: observedElapsedMs, simulatedMs,
      discardedMs, unprocessedMs: Math.max(0, catchupBudgetMs - simulatedMs), updates, workMs: performance.now() - startedAt });
  }
}
function startTicker() {
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' })));
    w.onmessage = tick;
  } catch (e) {
    setInterval(tick, 1000 / 30);   // no workers: throttled while hidden, but each tick still catches up a second
  }
}

let errShown = 0;
function reportError(err) {
  const message = String(err && err.message || err);
  recordAudioDiagnosticMarker('error', { source: 'runtime', message: message.slice(0, 500), stack: String(err?.stack || '').slice(0, 4000) });
  console.error(err);
  if (errShown++ > 3) return;
  UI.log && UI.logEl && UI.log(`<span style="color:#ff6060">Error: ${message.slice(0, 140)}</span>`);
}

async function boot() {
  loadSettings();
  G.performanceQualityTier = performanceTier(G.settings);
  // Developer Mode only unlocks the manual recorder; booting the game never starts monitoring.
  setPerformanceProfilerEnabled(false);
  initMouseCursor();
  G.canvas = $('#game');
  G.ctx = G.canvas.getContext('2d', { alpha: false });
  G.touch = false; // PC edition: touch controls and mobile HUD are not enabled.
  G.input = input;
  G.controls = controls;
  G.game = game;
  G.resScale = renderResolutionScale(G.settings);
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  initInput(G.canvas);
  initSpectate(); // taps that catch critters / aim SMITE without moving the hero (game/spectate.js)
  UI.init();
  GameChat.init();
  UI.vendor = Vendor;
  UI.stash = Stash;
  UI.jewelBox = JewelBox;
  UI.reliquary = Reliquary;
  UI.heresies = Heresies; UI.rifts = Rifts; UI.marks = Marks; // the Endgame's panels (docs/ENDGAME.md)
  UI.macros = MacrosUI;
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
  window.addEventListener('beforeunload', () => { if (G.char) game.autosave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.char) game.autosave(); else if (!document.hidden) dropBakes(); });
  G.canvas.addEventListener('contextrestored', dropBakes); // a GPU reset wiped the baked floors (game/render.js)
  requestAnimationFrame(loop);
  startTicker();
  LoadingScreen.show({
    title: 'VELSCOUR',
    subtitle: 'The Abyss Awaits',
    text: 'Summoning the depths…',
    progress: 0,
  });
  try {
    // the title song downloads in full alongside the art, so on mobile its intro never waits on the network
    let pa = 0, ps = 0;
    const show = () => { const p = pa * 0.8 + ps * 0.2; LoadingScreen.setProgress(p * 100, 'Summoning the depths…'); };
    await Promise.all([loadAssets((p) => { pa = p; show(); }), preloadSong(TITLE_SONG, (p) => { ps = p; show(); }).then(() => { ps = 1; show(); })]);
  } catch (e) {
    $('#loading-text').innerHTML = `Could not load game assets.<br><small>${e.message}</small><br><small>If you opened index.html directly from disk, serve the folder over http instead (see README).</small>`;
    return;
  }
  const jewelBoxMigration = await ensureJewelBoxMigration();
  if (!jewelBoxMigration.ok) {
    console.error('The shared Jewel Box migration was stopped safely.', jewelBoxMigration.error);
    const message = $('#loading-text');
    if (message) message.textContent = `The shared Jewel Box could not be migrated safely. Your character saves and migration backup are preserved. Reload to retry. ${jewelBoxMigration.error?.message || ''}`;
    return;
  }
  HUD.init();
  applyUILayoutSettings();
  applyVolumes();
  titleScreen();
  await LoadingScreen.hide();
  // prefetch monster art while the player is on the title screen; then redraw skill icons that show summon art
  const redrawIcons = () => {
    for (const s of HUD.slots) s.last.icon = s.last.id = undefined;
    if (G.char) HUD.refreshStatic();
  };
  loadEnemyArt().then(redrawIcons).then(loadPetArt).then(redrawIcons).catch((e) => console.warn(e));
  // debug helpers for testing in the console
  window.VELSCOUR = { G, game };
}

boot();
