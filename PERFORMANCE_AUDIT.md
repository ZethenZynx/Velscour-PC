# Non-browser performance audit

Run the repeatable diagnostic suite with:

```sh
node tools/tests/performance_audit.mjs
```

The suite uses production helpers and deterministic synthetic workloads. It covers town update work and lifecycle cleanup, VFX cleanup and ambient-light candidates, Storm Tether combat, lightning geometry, Pirate Seas wave accounting, ground-loot distance checks, Iron Express light selection and scenery, gore cleanup, traps, Eternal Breach generation, Sea of Sand generation, and terrain/minimap rules. It never opens a browser.

## Findings

Town updates no longer schedule the dungeon-only player flow field. In a four-second synthetic update, the town built zero fields while the dungeon control retained 15 scheduled builds; the production 96×96 flat-map helper cost a median 0.112 ms and p95 0.159 ms when a new tile origin forced a rebuild (worst sample 0.757 ms). This removes irrelevant route-field work from both act towns without changing dungeon pathing. A late-run lifecycle fixture also injected 250 dead creatures, 80 expired hazards, 80 expired loot entries, expired corpses/remains, and expired VFX; all were removed from their live arrays in the next update. This is a bounded synthetic check, not a full-session browser memory profile.

The audit confirmed several existing optimizations: VFX arrays compact in one pass, expired effects are released, recurring Pirate Seas checks avoid copying/filtering, Iron Express chooses nearest lights without sorting a temporary array, Storm Tether has localized enemy searches and no lightning visual workload, large map features are cached, and A* work is limited by the world's per-frame path budget. It also found one additional safe hot path: every ground item calculated a square root each update for magnet and pickup radius checks. Those comparisons now use squared distances, preserving the same strict radius boundaries and behavior.

The following Node microbenchmarks were recorded during the audit. They compare an old/reference operation with the current implementation under each listed synthetic workload; timings are not directly comparable across different workloads.

| System and workload | Reference | Current | Change |
|---|---:|---:|---:|
| VFX cleanup, 10,000 entries per collection, median | 3.863 ms | 0.285 ms | 92.6% lower |
| VFX cleanup, same workload, worst of 12 samples | 5.365 ms | 0.449 ms | 91.6% lower |
| Iron Express nearest-light selection, 1,200 renders, median | 5.608 ms | 0.389 ms | 93.1% lower |
| Iron Express nearest-light selection, 1,200 renders, worst | 6.193 ms | 0.574 ms | 90.7% lower |
| Pirate Seas wave status, 512 enemies × 1,500 checks, median | 3.512 ms | 1.709 ms | 51.3% lower |
| Pirate Seas wave status, same workload, p95 | 5.906 ms | 3.010 ms | 49.0% lower |
| Ground-loot radius checks, 20,000 drops x 8 passes, p50 | 2.193 ms | 0.255 ms | 88.4% lower |
| Ground-loot radius checks, same workload, p95 | 2.517 ms | 0.873 ms | 65.3% lower |
| Storm Tether, 100 hammers, 400 synthetic enemies, 120 pulses, old full connection layout vs current | 70.56 ms | 15.07 ms | 78.6% lower |
| Storm Tether hit path, 4,800 hits, full vs lightweight feedback | 42.35 ms | 13.35 ms | 68.5% lower |
| Ambient lights, 3,001 props, p95 / p99 | 0.093 / 0.194 ms | 0.060 / 0.107 ms | 35.5% / 44.8% lower |

The ambient-light workload returned fewer light records (473 to 128), and p95/p99 improved, but the latest median was 0.027 ms before and 0.033 ms now; its worst sample was also higher (0.233 ms vs 0.556 ms). The workload is very small and noisy, so this audit does not claim a consistent latency improvement for ambient lights; the cap does reduce emitted light records by 73%.

For the Storm Tether fixture, 100 links now test 4,776 local candidates per pulse instead of 80,000 for the old 200-link spoke/ring layout. This is an 88% candidate reduction; the 4 Hz damage cadence and damage formula remain unchanged. Cosmetic tether visuals are disabled in the current code.

## Ranked review areas

This ordering ranks workload risk and measured synthetic cost, not a single apples-to-apples game frame. `Measured` means the suite times an isolated production helper; `source-reviewed` means the path was inspected but requires live frame profiling for a numeric rank.

1. **VFX, particles, decals, text, and gore cleanup** — measured under 1k–10k entries; cleanup now compacts arrays linearly.
2. **Combat and Storm Tether** — measured with 400 targets and 1–100 connections; candidate searches are localized and cosmetic tether work is absent.
3. **Enemy AI, pathfinding, and collision/separation** — source-reviewed; A* has a bounded per-frame budget, but crowded-world end-to-end CPU was not measured here.
4. **World entity rendering and depth sorting** — source-reviewed; render records are reused, but canvas draw/sort cost needs a live renderer profile.
5. **Pirate Seas wave accounting** — measured with 16–512 enemies; copied temporary arrays were removed from the hot check.
6. **Iron Express nearest-light selection and scenery** — measured with 120 candidate lights; a fixed five-slot selection replaced repeated filtering and sorting.
7. **Environment generation (Eternal Breach and Sea of Sand)** — measured during generation tests, not the steady-state frame loop; 30 Breach maps and 100 Sea of Sand seeds completed.
8. **Ambient lights and environment effects** — measured with 3,001 props; active emitters are cached and the light output is capped, but very small timing samples are noisy.
9. **Minimap/TAB map and terrain cache** — invalidation, fog, and cache rules were tested; canvas rendering time was not measurable without the game renderer.
10. **Autosave, audio, inventory/HUD, and loot labels** — source-reviewed; autosave is periodic and memoized per character, while most UI work is event-driven. Storage/audio device latency was not measured in Node.

## Memory and frame-time limits

A Node `--expose-gc` retention check temporarily added 10,000 synthetic effects, measured about 3.64 MiB of additional live heap, expired and compacted them, and observed about 0.03 MiB retained over baseline after GC. This tests JavaScript heap retention for that fixture only; it does not include browser canvas/GPU memory, full enemy sessions, or the platform's garbage collector behavior during gameplay.

No browser or game UI was launched, as requested. Consequently this audit cannot measure actual 60 FPS delivery, GPU draw time, live frame-time percentiles, sound-device overhead, browser allocation rate, or long-session degradation in Eternal Breach/Pirate Seas/Iron Express. It also cannot establish a global ranking of ten systems from incomparable microbenchmarks. The ten areas ranked above reflect risk and available isolated evidence, not a controlled end-to-end workload. Real-device frame profiles remain necessary before making further broad runtime changes.

## Rolling in-game profiler and gore follow-up

The Graphics settings now include an opt-in **Performance profiler**. It is off by default. When enabled, it records a time-based rolling three-minute history (up to 150 Hz) and shows frame interval, update/render processing time, median/p95/p99/worst processing, current/average/1%-low FPS, sampled object counts, and heap readings when the runtime exposes them. Counts are sampled every 15 frames; processing timers are sampled each displayed frame. **Export performance report** downloads the history as JSON. Turning the option off releases the ring buffers and removes the panel. The reporter does not include GPU time, actual display presentation time, garbage-collection event counts, timer/listener totals, or audio hardware latency; those need browser/device diagnostics and are not claimed here. `frameMs` is measured on the main thread from the start of game update/draw to the end of input-frame handling; `gapMs` is the animation-frame interval. They are deliberately separate.

The gore audit found a duplicate pass that earlier profiling missed: stationary gore was traversed once per update to decrement age/update growth and then again during rendering to cull, fade, and draw. Lifetime, fade, and pool growth are now derived from a shared VFX clock during the existing render traversal. Expired and offscreen decals are still compacted out there, and active visual results remain unchanged. In an 8,000-visible-decal, 120-frame Node fixture, the update-plus-render traversal took **39.24 ms** before and **30.80 ms** after (21.5% lower in this run); the revised path also removes one complete per-decal pass. This is an isolated synthetic CPU result, not a game-frame or GPU result. The comparison fixture and clock/fade/growth regression checks are in `tools/tests/gore_performance.mjs`.

The late-dungeon tests were rerun. With 20,000 settled drops outside the player radius, the indexed world update invoked zero loot updates (the former full-list loop would invoke 20,000). For 10,000 distant settled items, the production `World.update` workload measured p50/p95/p99/max **0.0041/0.0090/0.0355/0.0927 ms**, compared with **0.2443/0.4687/1.2807/3.2151 ms** for the old per-item update fixture. This confirms the loot lifecycle/index work remains effective; it does not explain every user's reported slideshow by itself.

No controlled before/after end-to-end dungeon run, maximum Greed/Heresy run, GPU/render pass, long-session browser heap profile, or input-device benchmark can be done under the requested no-browser validation. Therefore the profiler is included to collect that missing evidence during the user's own repro; the available synthetic results above and in the ranked review are not presented as a verified 60-FPS target or a global ten-system frame-time ranking.

## Critical performance emergency update (2026-11-24)

### Confirmed accumulation and hot paths

- Ordinary non-gore floor decals could be baked into the floor-chunk decal cache and persist for the life of the generated area (the baked list was capped at 8,000, but repeated chunk invalidation/rebuild work and retained decoration still accumulated). New cosmetic decals now remain in a bounded live collection and expire; one-shot impact primitives with explicit duration are capped at two seconds. Damage numbers are capped at 1.5 seconds. Cosmetic blood/gore retains its established 10-second maximum and two-second fade.
- Corpses previously remained for up to 40 seconds (with a six-second fade) and retained sprite/art fields. They are now lightweight render records kept for ten seconds, fading over the final two. Dead creatures continue to be removed from the combat collection after the existing short death handoff; removal counters are recorded.
- Ordinary ground drops previously had inconsistent lifetimes: gold/orbs commonly expired at 120 seconds, gear used 45/60/120-second drop values, ordinary gems could remain 180 seconds, relics and some equipment could have no timer, and progression keys were permanent. All ordinary loot is now anchored to absolute world time, capped at 120 seconds (or 90 seconds for health/mana orbs), and fades during the final five seconds. Existing shorter drop timers remain shorter. Keys and explicitly flagged required rewards remain protected. The expiry heap removes objects even if targeted, clears the target reference, removes spatial-index entries, and compacts expired records from the main loot array in one batch. Pausing does not advance world time because the world update is suspended; loading an existing active Rift reward remains protected as before.
- Container splinters already lasted under one second, and common particle bursts/smoke were already shorter than the new caps. Gore chunks were already 4–9 seconds and remain within the ten-second limit; their last two seconds now fade. Combat damage pools remain world hazards and are not subject to cosmetic decal cleanup.
- The cited capture had 943 enemies, 933 inactive and largely offscreen. Previously, the renderer repeatedly traversed the full creature array for depth enqueueing, wall see-through views, and overhead labels. Those paths now reuse a spatially culled actor list. The minimap's nearby hostile markers also use the spatial grid, while marker distance/discovery rules remain unchanged.
- No conclusion from source review alone establishes that Canvas2D is the only cause of the reported 10 FPS. The supplied capture's effect-drawing time (median 26.4 ms) and 3,034 particles indicate that transparent VFX/particle rendering is a major confirmed cost. The inactive population also unnecessarily inflated the renderer's candidate work. GPU overdraw and browser presentation remain unmeasured without gameplay profiling.

### Lifetime comparison

| Object type | Prior observed behavior | New maximum | Fade |
|---|---|---:|---:|
| Defeated bodies | Up to 40 s; final 6 s faded; max 70 records | 10 s | Final 2 s |
| Cosmetic gore | 10 s and 2 s fade already in place | 10 s | Final 2 s |
| Non-gore splats/trails | Could be baked and retained with the area | 3 s | Final 1 s |
| Other cosmetic decals/impacts | Scorch/frost commonly 14 s; grown pools could be baked | 2 s | Final 0.5 s |
| Container splinters | Approximately 0.45–0.95 s | 5 s maximum | Final 1 s if applicable |
| Gore body parts | 4–9 s | 10 s | Final 2 s |
| Damage numbers | Existing styles 0.85–1.35 s | 1.5 s | Final 0.5 s |
| Ground equipment | 45/60/120 s by rarity or sometimes unbounded | 120 s | Final 5 s |
| Gold | Up to 120 s for ordinary drops; protected rewards were exempt | 120 s | Final 5 s |
| Gems | Ordinary drops could remain 180 s; sigils/relics could be exempt | 120 s | Final 5 s |
| Potions | 120 s | 120 s | Final 5 s |
| Health/mana orbs | 120 s | 90 s | Final 5 s |
| Required keys/progression rewards | Intentionally persistent | Protected | None |

“Prior” values are based on the source paths found in the existing project, not a full asset-by-asset gameplay trace. Timers use world time and do not reset when an item is offscreen or the loot index is rebuilt.

### Non-browser measurements for this update

The new regression fixture reproduces the reported 943-actor shape (10 visible, 933 distant/inactive). A plain full-array bounds scan measured p50/p95 **0.0113/0.0460 ms**; the production grid query measured **0.0016/0.0041 ms** in this Node run, with the same ten visible candidates (about 86% lower p50 and 91% lower p95 for this isolated candidate-query operation). This does not include projection, sorting, Canvas drawing, or GPU time.

A second synthetic fixture inserted 10,000 equipment drops, expired them, compacted all indexes, and forced V8 garbage collection. The Node heap rose from **20,931,648** to **25,762,848 bytes**, then returned to **21,037,040 bytes** after expiry: **4,725,808 bytes (97.8% of the measured fixture delta) reclaimed**. This is a V8 heap-only microbenchmark; it does not represent browser canvas/GPU memory or a real dungeon session.

The pre-existing 8,000-gore benchmark and 10,000-entry VFX cleanup benchmarks in this file remain isolated synthetic tests. The full 17-scenario non-browser suite passed after these changes. Actual gameplay FPS, browser frame pacing, memory during a complete dungeon, GC pauses, draw calls, compositing cost, GPU memory, and device audio timing remain unmeasured. We therefore do not claim a verified 60 FPS target or that the entire performance emergency is conclusively resolved.

### Profiler coverage

The opt-in Developer profiler now retains up to 180 seconds in a fixed-capacity ring, samples entity and lifecycle/type telemetry every 15 frames, and exports frame interval and processing percentiles, low-frame estimates, long-frame counts, world context, render settings, enemy/offscreen counts, effects by layer/type, VFX and world created/removed rates, and JS heap when exposed. It remains off by default; turning it off releases the ring and overlay. This is intentionally a bounded data stream. Accurate GPU timings, GC event data, active listener/timer totals, cache byte sizes, and full object lifetime distributions are still unavailable in the current runtime and are explicitly marked unavailable rather than estimated.

### Architecture and migration assessment

The production client is a custom native-ES-module JavaScript game with a Canvas 2D isometric renderer, world-space entity/collision/pathfinding systems, DOM/CSS interfaces, browser storage, and Web Audio. There is no production dependency manifest or rendering framework. The source tree contains **368 JS/MJS modules and about 117,354 JavaScript lines**; the tracked repository contains **721 JS/MJS files including tools/tests**, six CSS files, and 364 JSON/data-definition files. The asset directory currently contains 5,292 files (about 1,489 MiB on disk). The source is spread across combat, 20+ classes and ability systems, enemies/affixes, loot/economy, procedural environments, quests/events, hazards, saves, UI, audio, rendering, wiki/docs and world generation.

Reusable without major translation: images, sprite sheets, audio files, JSON tables, names/descriptions, progression constants, and algorithm specifications (isometric transforms, drop eligibility, generation rules). Code requiring substantial rewrite or adaptation includes rendering, DOM UI, input, audio, storage, collision/physics, pathfinding integration, entity lifecycle, save migration, procedural systems, and nearly every animation/ability integration. The game's save schema is web-storage JSON; a desktop version would need an explicit export/import bridge and versioned migration tests.

| Option | Likely benefit and fit | Rough effort / risk |
|---|---|---|
| Continue Canvas 2D restructuring | Lowest-risk; preserves all game systems. Chunked static terrain, spatial actor/loot culling, bounded effects, cached sprites, and fewer transparent layers can address the confirmed costs. Canvas remains CPU-commanded and cannot batch every custom effect automatically. | 2–6 weeks for a focused rendering pass; low-to-medium risk. Recommended immediate path. |
| PixiJS/WebGL renderer while retaining JS gameplay | GPU sprite batching can substantially help large sprite/particle workloads. It does not automatically speed AI/collision and custom Canvas effects need porting. Reuse data and gameplay modules; replace world drawing incrementally behind a renderer interface. | 2–4 months for an isolated renderer port, then parity/performance testing; medium-to-high visual and depth-sorting risk. Best renderer PoC candidate. |
| Tauri Windows package | Uses the system WebView2 on Windows. Packaging may reduce install size and expose native file APIs; it uses the same JS/game/rendering and will not itself fix frame time. | 1–3 weeks for a packaging/save bridge; low-to-medium deployment risk, negligible expected frame improvement by itself. |
| Electron Windows package | Bundles Chromium, making runtime behavior consistent; keeps existing web code and storage more directly. It retains browser-rendering limitations and adds substantial baseline memory/runtime overhead. | 1–3 weeks packaging, but no direct performance fix; medium maintenance and memory cost. |
| Godot 4 rewrite | Dedicated engine renderer and native export offer strong performance headroom. Assets/data reuse well, but gameplay, UI, input, save, and rendering integrations require a port; JS cannot be reused directly as Godot gameplay code. | Roughly 12–24 person-months for broad feature parity, plus 6–12 months of staged testing/content fixes; high risk. AI-assisted work likely tens of millions of tokens over many code/review cycles, not one task. |
| Unity rewrite | Mature 2D/3D tools and deployment; similar GPU potential, but the current DOM/JS game is not directly reusable and the C# gameplay port is large. | Roughly 18–36 person-months including parity and testing; high engineering, build, and long-term project-management cost. |

These estimates are order-of-magnitude planning figures, not quotes. A packaged web runtime is not an engine migration and should not be sold as a performance fix. Recommended sequence: retain Canvas2D for the immediate fix; collect the new in-game profiler report on the user's actual repro; build a separate, disposable Canvas-versus-Pixi proof of concept with an identical seeded scene (isometric terrain, 1,000 actors including 933 inactive, 3,000 particles, loot, movement/collision and camera); migrate only rendering if it demonstrates a material p95/worst-frame improvement on the target PC. Do not start Godot/Unity migration until parity cost is accepted.

## Emergency rendering follow-up (2026-11-24)

The previous deployed update improved world-entity culling and lifetime cleanup, but it did not reduce the normal desktop particle budget below 3,000. The supplied capture had 3,034 particles and 26.4 ms median effect drawing; therefore the normal budget still allowed roughly the same particle workload that appeared in the capture. Static terrain was already chunk-cached. The capture supports rendering/effect workload as a primary cost; it does not establish whether the browser used hardware or software Canvas acceleration.

### Production changes

- Added a **Graphics preset** selector in normal Graphics settings. **Extreme Performance** immediately trims active cosmetic particles to a strict 700 desktop / 300 touch maximum (76.7% / 78.6% fewer slots than the standard budgets). It stops new smoke, glow, flame and streak particles, caps active light records at 32, draws the fog/light buffer at one-eighth canvas resolution, and omits the additional colored additive glow pass. Simple combat particles, normal sprites, functional hazard warnings, enemy count, damage, drops and rewards remain intact. The game's main world canvas contains some floating world labels, so those canvas-drawn labels also use its reduced resolution; DOM menus and settings remain at display resolution.
- Added optional **Adaptive performance**. A two-second interval below about 47 FPS raises cosmetic shedding to a 1,400-particle/64-light tier; below about 25 FPS it selects the 700-particle/32-light tier. It waits at least six seconds between reductions and requires 15 seconds of at least 95% of the configured frame target before restoring one tier. The already-existing adaptive canvas scale can now reach 0.5 when Extreme or adaptive quality is selected; Extreme starts at 0.7. That scale affects the full game canvas, including canvas-rendered text, while DOM interface text remains sharp.
- When pacing remains below 24 FPS for three consecutive two-second measurement windows, the game logs a one-time, nonmodal recommendation to try Extreme Performance. A saved guard prevents repeated recommendations.
- The existing renderer remains Canvas 2D. This update does not claim WebGL batching. It removes additional per-frame allocations from the view's isometric corner transforms and actor wall-cutaway coordinates. In the 943-actor synthetic fixture, viewport candidate count remains 10 (933 culled); this does not include canvas raster or GPU time.
- Added the preset and adaptive status to exported graphics settings. Existing saved settings migrate by retaining the new defaults; no character saves or progression fields are touched.

### What is and is not confirmed

The 18-scenario non-browser suite passes. Regression tests confirm the Extreme particle/light caps, shedding and adaptive hysteresis. The caps prove bounded work counts, not a measured percentage reduction in GPU time. No new full-game FPS benchmark is possible in Node; the 10 FPS report has not been reproduced here. The current source requests a Canvas 2D context with `alpha: false`; the application cannot inspect whether the browser's Canvas2D backend is hardware accelerated. The profiler records context attributes but has no reliable device-level Canvas acceleration or GPU timing field. Consequently no particular computer setting can yet be named as the cause of software rendering; the owner should check browser hardware acceleration and the profiler's next in-game capture if FPS remains poor.

### Renderer decision

Canvas2D is the production renderer, but the evidence does not show that its architecture alone prevents acceptable frame pacing: the captured 26.4 ms effect cost includes a particle workload that the normal profile allowed almost in full, and static terrain caching plus spatial actor culling are already present. A PixiJS/WebGL replacement is therefore **not** promoted to production in this update. It would replace renderer behavior across 20+ class systems, environment-specific effects, isometric depth/occlusion, caves/towers, minimaps and canvas-based interfaces; a no-browser run cannot validate WebGL context creation, depth parity, visual warnings or GPU frame time. The next justified architecture step is a separate WebGL/Pixi prototype, compared on the target PC against an identical seeded 1,000-actor/3,000-particle scene. Keep the current game and saves intact until that prototype shows a substantial tail-frame improvement and gameplay parity.

Tauri/Electron packaging still does not replace Canvas2D and is not an FPS fix by itself. Godot/Unity port estimates and asset/save migration risks remain as detailed above; the full migration is not technically justified until the isolated renderer comparison shows the current canvas path cannot meet targets after Extreme Performance is evaluated.
