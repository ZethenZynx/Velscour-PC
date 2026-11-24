/** The castle 3D atlas is shared by Castle, Skyship and Tessariel's Keep. */
export function shouldReleaseCastle3D(biome, activeWorld, keepTransitionPending = false) {
  return biome?.id !== 'castle' && biome?.id !== 'skyship' && biome?.id !== 'tkeep' && !activeWorld?.keep && !keepTransitionPending;
}

export function shouldReleaseTownSheets(biome, activeWorld, keepTransitionPending = false) {
  return !biome?.overworld && biome?.id !== 'town' && !activeWorld?.keep && !keepTransitionPending;
}

/** A late async transition must never release art used by a different active world. */
export function isCurrentWorldForArtRelease(expectedWorld, activeWorld) {
  return !expectedWorld || expectedWorld === activeWorld;
}
