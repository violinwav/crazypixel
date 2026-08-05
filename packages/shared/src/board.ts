function wrap(index: number, trackLength: number): number {
  return ((index % trackLength) + trackLength) % trackLength;
}

/** Every track index passed through when moving `steps` from `fromIndex` (direction-aware),
 * ending with the destination. Pure track-space - doesn't know about home-stretch entry,
 * see GameEngine.ts's plannedLocation for the higher-level "does this move cross into
 * home" logic that sits on top of this. `trackLength` depends on player count (see
 * constants.ts trackLengthFor), so it's a parameter rather than a fixed import. */
export function pathIndices(fromIndex: number, steps: number, trackLength: number): number[] {
  const direction = steps >= 0 ? 1 : -1;
  const path: number[] = [];
  let cur = fromIndex;
  for (let i = 0; i < Math.abs(steps); i++) {
    cur = wrap(cur + direction, trackLength);
    path.push(cur);
  }
  return path;
}
