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
