// Keep routine entity scans sparse, but never carry one world's counts into a new world.
export function shouldSampleCounts(frameSerial, previousWorld, world) {
  return frameSerial % 15 === 0 || world !== previousWorld;
}
