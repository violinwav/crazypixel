// Pure track-space geometry. Knows nothing about home stretches or blockades - see
// GameEngine.ts's planMovement for the rules layered on top of this.

function wrap(index: number, trackLength: number): number {
  return ((index % trackLength) + trackLength) % trackLength;
}

/**
 * Every track index passed through when moving `steps` from `fromIndex`, ending with the
 * destination. Negative `steps` walks backward. `trackLength` is a parameter rather than an
 * import because it depends on player count (see constants.ts's trackLengthFor).
 */
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
