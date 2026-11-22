# Environmental trap artwork review

Open `trap-art-review.html` from a local static server or the repository's published source preview to see all 22 trap types, their four state frames, 15 explicit material/environment variants, GIF previews for moving/activating traps, and sampled game floor tiles. It contains no game code and does not launch the game.

Labeled image sheets are also provided for direct inspection without the HTML preview:

- `trap-review-01.png` through `trap-review-04.png` cover all 22 trap types.
- `trap-environment-variations.png` shows the environmental material variants.
- `gifs/` contains transparent animated previews of the swinging blade, retractable spikes, rolling boulder, falling icicles, arcane turret, volcanic flame jet, and wall dart trap.

Generated atlas sources:

- `assets/sprites/environment-traps/mechanical.png` — pressure plate, swinging blade, collapsing floor, retractable spikes, quicksand, rolling boulder.
- `assets/sprites/environment-traps/elemental.png` — poison vent, flame jet, arcane turret, explosive obstacle, falling icicles, storm conductor.
- `assets/sprites/environment-traps/nature.png` — venomous growth, thorn snare, cursed cage trap, bone spikes, explosive rune, cracking ice, freezing vent, lava fissure, unstable crystal.
- `assets/sprites/environment-traps/environment-variations.png` - pressure plate (crypt/frozen/desert), root snare, bone and desert spike apertures, swamp/sewer vents, infernal/volcanic flame jets, arcane/storm turrets.
- `assets/sprites/environment-traps/dart-wall.png` - four wall-opening materials: ancient ruin, castle iron, poisoned sandstone tomb, and poisoned bone crypt. Each row has idle, warning, active muzzle flash, and destroyed states.

Each sprite row has four matching states, left to right: idle, warning, active, destroyed. Other trap assignments, trigger timing, damage and spawn frequencies remain in the existing system. The approved dart-trap expansion is implemented as a new wall-mounted hazard with a three-dart volley; physical projectiles use existing combat mitigation and independent trap scaling.
