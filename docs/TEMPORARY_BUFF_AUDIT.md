# Temporary Buff Audit and Duration Changes

This reference covers temporary player buffs and short-lived player effects implemented through the buff system. Equipment affixes, character passives, and class auras stored outside the buff list are not timed or changed. The town blessing remains account/character progression tracked for three depth clears, rather than a timed combat buff, so that progression is unchanged.

Treasure chest reward review: `dropChest()` no longer rolls the `orb_fury` reward. That was the chest path capable of granting the Fury movement/attack/cast/critical buff. The Orb remains obtainable from its other eligible sources. Chest gear, gold, gems, sigils, healing orbs, and normal mechanics are unchanged. Abyssal Rift chests use the same reward function and therefore no longer grant Fury.

## Temporary effect duration reference

| Source / effect | Previous duration | Revised duration |
| --- | ---: | ---: |
| Treasure chest Fury Orb chance | 2% per eligible chest; Fury lasts 15s | Chest grant removed; no temporary buff from any treasure chest |
| Elixir of Fury / Fury Orb | 15s | 15s (kept; strong mixed haste/crit effect) |
| Constellation boons (all 8 zodiac effects) | 15s | 20s |
| Sanctuary Grace (event) | 45s | 45s |
| Temporal Haste (event) | 30s | 20s |
| Muted Casting (event debuff) | 16s | 20s |
| Harvested Soul (event) | 20s | 20s |
| Warrior’s Resolve (encounter) | 60s | 25s |
| Cursebreaker’s Grace (encounter) | 50s | 45s |
| Mage’s Force (encounter) | 60s | 25s |
| Mage’s Reserve (encounter) | 60s | 45s |
| Pilgrim’s Might (encounter) | 60s | 30s |
| Pilgrim’s Fleetness (encounter) | 60s | 15s |
| Pilgrim’s Clarity (encounter) | 60s | 30s |
| Knight’s Oath (encounter) | 90s | 30s |
| Purple Blessing (encounter; XP + cooldown) | 120s | 90s |
| Bramble Brew (encounter; regen / defense roll) | 90s | 45s |
| Bramble Brew (encounter; attack speed roll) | 90s | 20s |
| Bramble Brew (encounter; gold/find roll) | 90s | 60s |
| Bramble Brew (encounter; damage roll) | 90s | 25s |
| Shrine of Frenzy | 40s | 20s |
| Shrine of Fortune | 60s | 60s |
| Shrine of the Bulwark | 60s | 45s |
| Shrine of Wisdom (XP) | 90s | 90s |
| Shrine of Wrath | 40s | 25s |
| Storm Shrine | 30s | 30s |
| Shrine of Renewal | 30s | 45s |
| Critter Shrine blessing | `20 + floor(tier / 4)` seconds (unbounded by tier) | 60s |
| Treasure Imp: Blood Rush | 22s | 20s |
| Treasure Imp: Alchemical Renewal | 18s | 45s |
| Treasure Imp: Verdant Vitality | 24s | 45s |
| Treasure Imp: Prosperity | 30s | 60s |
| Treasure Imp: Arcane Reserve | 24s | 45s |
| Treasure Imp: Celestial blessing | Shrine-specific 30-90s | 20-90s using the selected shrine's revised duration |
| Arcane Surge dungeon affix | 1,000,000s (~11.6 days) | 60s, renewed while the affix is active; cleared on leaving the floor |
| World-object shrine blessings (all ten) | 105s or 210s, multiplied up to 1.4x by rarity | 60s |
| Blood Price | 150s | 25s |
| Torment | 90s | 30s |
| Shadow Pact | 150s | 30s |
| Chaotic Boon (combat rolls) | 150s | 25s |
| Chaotic Boon (fortune roll) | 150s | 60s |
| Chaotic Price curse | 150s | 30s |
| Decaying Might | 120s | 25s |
| Unstable Boon | 120s | 25s |
| Offering’s Favor | 150s | 25s |
| Monolith’s Might | 120s | 25s |
| Forbidden Insight | 150s | 25s |
| Runic Field | 20s | 20s (aligned with the field lifetime) |
| Whispered Boon | 120s | 25s |
| Whispered Hex | 75s | 30s |
| Hostile monster aura affecting the player | 1.5s per proximity refresh | 1.5s (kept; refreshes only while in range) |
| Slime Court: Gilded Aegis | 5s | 5s (kept; short reactive defense) |
| Slime Court: Amber Barrier | 6s | 6s (kept; short reactive defense) |
| Slime Court: Slime Serenade | 7s | 7s (kept; short summon proc) |
| Signature: Wyrmblood | 7s | 7s (kept; short signature proc) |
| Signature: Highwind | 6s | 6s (kept; short signature proc) |
| Signature: Rallied | 8s | 8s (kept; short signature proc) |
| Signature: Hunter’s Focus | 8s | 8s (kept; short signature proc) |
| Skill buff abilities (rank scaling; full catalog below) | Per-skill base duration + 0.3s per rank after rank 1 | Caps by effect: 10s for strong movement speed, 15s moderate movement, 20s attack speed, 30s offensive/crit, 45s defensive/regen; lower authored durations remain unchanged |
| Skill curses/debuffs | Per-skill base duration + 0.15s per rank after rank 1 | Maximum 60s |

### Class ability buff catalog

The “previous” column shows authored rank-1 duration and the rank-20 duration before this change. The revised column shows those same values after the new effect-category cap. Intermediate ranks retain the existing progression formula.

| Ability | Previous duration | Revised duration |
| --- | --- | --- |
| Holy Shield | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.7s at rank 20 |
| Fanaticism | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Holy Freeze Aura | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Bastion of Faith | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 17.7s at rank 20 |
| Crusade | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Windrunner | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 10.0s at rank 20 |
| Hunter's Call | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Heart of the Oak | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.7s at rank 20 |
| Avatar of the Wild | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Ice Armor | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.7s at rank 20 |
| Deep Freeze | 6s at rank 1; 11.7s at rank 20 | 6s at rank 1; 11.7s at rank 20 |
| Bone Armor | 28s at rank 1; 33.7s at rank 20 | 28s at rank 1; 33.7s at rank 20 |
| Dark Pact | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Unholy Command | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 10.0s at rank 20 |
| Lich Form | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Bloodlust | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 17.7s at rank 20 |
| Wrath of the Berserker | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 10.0s at rank 20 |
| Battle Orders | 30s at rank 1; 35.7s at rank 20 | 30s at rank 1; 35.7s at rank 20 |
| Battle Command | 30s at rank 1; 35.7s at rank 20 | 30s at rank 1; 30.0s at rank 20 |
| Undying Rage | 10s at rank 1; 15.7s at rank 20 | 10s at rank 1; 15.7s at rank 20 |
| Stone Skin | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Feather Fall | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 10.0s at rank 20 |
| Wyrm Scale | 28s at rank 1; 33.7s at rank 20 | 28s at rank 1; 33.7s at rank 20 |
| Blood Pact | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Dragonsoul | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Rallying Standard | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 15.0s at rank 20 |
| Aegis of the Wyrm | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Spirit Shield | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.7s at rank 20 |
| Avatar of Storms | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Icebound Fortitude | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 17.7s at rank 20 |
| Horn of Winter | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Anti-Magic Shell | 10s at rank 1; 15.7s at rank 20 | 10s at rank 1; 15.7s at rank 20 |
| Bone Shield | 24s at rank 1; 29.7s at rank 20 | 24s at rank 1; 29.7s at rank 20 |
| Vampiric Blood | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Purgatory | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 17.7s at rank 20 |
| Celestial Mirror | 4s at rank 1; 9.7s at rank 20 | 4s at rank 1; 9.7s at rank 20 |
| Cosmic Ascension | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Feathered Cloak | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 15.0s at rank 20 |
| Nevermore | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 10.0s at rank 20 |
| Witching Hour | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Hymn of Mending | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.7s at rank 20 |
| Ballad of Valor | 25s at rank 1; 30.7s at rank 20 | 25s at rank 1; 30.0s at rank 20 |
| Song of Swiftness | 24s at rank 1; 29.7s at rank 20 | 24s at rank 1; 15.0s at rank 20 |
| Symphony of Storms | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Magnum Opus | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Slime Hivemind | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 10.0s at rank 20 |
| Slime Armor | 24s at rank 1; 29.7s at rank 20 | 24s at rank 1; 29.7s at rank 20 |
| Colossal Form | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Slime God | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Catch & Release | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 10.0s at rank 20 |
| Blade Barrier | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Tailwind Aura | 24s at rank 1; 29.7s at rank 20 | 24s at rank 1; 15.0s at rank 20 |
| Shield Wall | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Ironclad Juggernaut | 15s at rank 1; 20.7s at rank 20 | 15s at rank 1; 20.7s at rank 20 |
| Living Fortress | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Hold the Line | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Hero's Ascension | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Fire Aura | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Dragon Scales | 28s at rank 1; 33.7s at rank 20 | 28s at rank 1; 33.7s at rank 20 |
| Spiked Carapace | 20s at rank 1; 25.7s at rank 20 | 20s at rank 1; 25.7s at rank 20 |
| Dragon Heart | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Ironclad Wyrmform | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Blood Frenzy | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| True Dragon Form | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 10.0s at rank 20 |
| Gunslinger Stance | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 10.0s at rank 20 |
| Overclock | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Mech Suit | 18s at rank 1; 23.7s at rank 20 | 18s at rank 1; 23.7s at rank 20 |
| Asura Stance | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 10.0s at rank 20 |
| Mantra of Retribution | 22s at rank 1; 27.7s at rank 20 | 22s at rank 1; 27.7s at rank 20 |
| Avatar of Enlightenment | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Vendetta | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 19.7s at rank 20 |
| Stealth | 8s at rank 1; 13.7s at rank 20 | 8s at rank 1; 13.7s at rank 20 |
| Shadow Dance | 10s at rank 1; 15.7s at rank 20 | 10s at rank 1; 15.7s at rank 20 |
| Cloak of Shadows | 8s at rank 1; 13.7s at rank 20 | 8s at rank 1; 13.7s at rank 20 |
| Blade Flurry | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 17.7s at rank 20 |
| Flowing Water | 14s at rank 1; 19.7s at rank 20 | 14s at rank 1; 10.0s at rank 20 |
| Mirror Shadows | 16s at rank 1; 21.7s at rank 20 | 16s at rank 1; 21.7s at rank 20 |
| Eclipse Veil | 12s at rank 1; 17.7s at rank 20 | 12s at rank 1; 10.0s at rank 20 |

## Expiration and persistence safeguards

- Every buff accepted by player or creature `addBuff()` must have a finite, positive timer. Invalid, missing, zero, `NaN`, and infinite timers are rejected.
- Active timer and display maximum are capped at 120 seconds. Legacy in-memory timers above the cap are normalized on update; invalid/expired entries are removed and player stats recomputed.
- Arcane Surge uses a finite 60-second buff refreshed only while its dungeon affix remains active and is removed when leaving the floor.
- HUD icons show a whole-second countdown and include remaining time in their tooltip, including short aura buffs.
- Player buff records are transient and are not part of character save data. Permanent equipment, passive, progression bonuses, town blessings, and class aura systems stored outside temporary buff records are unchanged.
- Reapplying the same buff identifier refreshes that entry instead of stacking duplicates, following the existing stacking behavior.
