# Environmental trap artwork review

Open `trap-art-review.html` from a local static server or the repository's published source preview to see all 21 trap types, their four state frames, the six explicit environment-specific variants, GIF previews for moving/activating traps, and sampled game floor tiles. It contains no game code and does not launch the game.

Generated atlas sources:

- `assets/sprites/environment-traps/mechanical.png` — pressure plate, swinging blade, collapsing floor, retractable spikes, quicksand, rolling boulder.
- `assets/sprites/environment-traps/elemental.png` — poison vent, flame jet, arcane turret, explosive obstacle, falling icicles, storm conductor.
- `assets/sprites/environment-traps/nature.png` — venomous growth, thorn snare, cursed cage trap, bone spikes, explosive rune, cracking ice, freezing vent, lava fissure, unstable crystal.
- `assets/sprites/environment-traps/environment-variations.png` — pressure plate (crypt/frozen/desert), root snare, bone and desert spike apertures, swamp/sewer vents, infernal/volcanic flame jets, arcane/storm turrets.

Each sprite row has four matching states, left to right: idle, warning, active, destroyed. Trap assignments, trigger timing, damage and spawn frequencies remain in the existing system. A dedicated dart-trap type does not exist in the current game, so it was not added as a new mechanic.
