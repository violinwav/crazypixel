/** Falls back to "Player N" for local hotseat (no `playerNames` at all - there's no
 * display-name concept there, everyone shares one screen) and for any seat online play
 * hasn't heard a name for yet. */
export function playerLabel(playerNames: string[] | undefined, seat: number): string {
  return playerNames?.[seat]?.trim() || `Player ${seat + 1}`;
}
