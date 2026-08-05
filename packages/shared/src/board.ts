import { TRACK_LENGTH } from './constants';

function wrap(index: number): number {
  return ((index % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
}

/** Every track index passed through when moving `steps` from `fromIndex` (direction-aware), ending with the destination. */
export function pathIndices(fromIndex: number, steps: number): number[] {
  const direction = steps >= 0 ? 1 : -1;
  const path: number[] = [];
  let cur = fromIndex;
  for (let i = 0; i < Math.abs(steps); i++) {
    cur = wrap(cur + direction);
    path.push(cur);
  }
  return path;
}
