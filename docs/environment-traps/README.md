# Environmental trap artwork review

Open `trap-art-review.html` from a local static server or the repository's published source preview to see all 21 trap types, their four state frames, 12 explicit material/environment variants, GIF previews for moving/activating traps, and sampled game floor tiles. It contains no game code and does not launch the game.

Labeled image sheets are also provided for direct inspection without the HTML preview:

- `trap-review-01.png`, `trap-review-02.png`, and `trap-review-03.png` cover all 21 trap types.
- `trap-environment-variations.png` shows the environmental material variants.
- `gifs/` contains transparent animated previews of the swinging blade, retractable spikes, rolling boulder, falling icicles, arcane turret, and volcanic flame jet.

Generated atlas sources:

- `assets/sprites/environment-traps/mechanical.png` — pressure plate, swinging blade, collapsing floor, retractable spikes, quicksand, rolling boulder.
- `assets/sprites/environment-traps/elemental.png` — poison vent, flame jet, arcane turret, explosive obstacle, falling icicles, storm conductor.
- `assets/sprites/environment-traps/nature.png` — venomous growth, thorn snare, cursed cage trap, bone spikes, explosive rune, cracking ice, freezing vent, lava fissure, unstable crystal.
- `assets/sprites/environment-traps/environment-variations.png` - pressure plate (crypt/frozen/desert), root snare, bone and desert spike apertures, swamp/sewer vents, infernal/volcanic flame jets, arcane/storm turrets.

Each sprite row has four matching states, left to right: idle, warning, active, destroyed. Trap assignments, trigger timing, damage and spawn frequencies remain in the existing system. A dedicated dart-trap type does not exist in the current game, so it was not added as a new mechanic.
