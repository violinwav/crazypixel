import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import type { TurnAnimation } from './game/animationPlan';
import { computeBoardGeometry, discardPileCenter, drawPileCenter } from './game/boardLayout';
import { HandPanel } from './HandPanel';
import { BoardOverlay } from './BoardOverlay';
import { BoardStatus } from './BoardStatus';
import { OpponentHandCounts } from './OpponentHandCounts';
import { TurnLabel } from './TurnLabel';
import { TurnTimerBar } from './TurnTimerBar';
import { FlyingCard } from './FlyingCard';
import type { FlightPlan } from './FlyingCard';
import { DealAnimation } from './DealAnimation';
import type { DealPlan } from './DealAnimation';
import { WinScreen } from './WinScreen';
import { playerLabel } from './game/playerName';
import { hueToCss } from './game/color';

export interface BoardBackground {
  visible: boolean;
  color: string;
}

interface Props {
  state: GameState;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
  restart?: () => void;
  lastPlanRef: MutableRefObject<TurnAnimation>;
  mySeat: PlayerId;
  /** Which seat's base renders at the bottom of the ring - see boardLayout.ts's
   * BoardGeometry.rotation. Defaults to mySeat, which is what online play always wants (a
   * fixed seat for the whole session, so this is a no-op there). Local hotseat explicitly
   * passes a fixed seat instead (see GameView.tsx) - mySeat tracks state.currentPlayer
   * there, and re-rotating the whole board every turn read as disorienting rather than
   * helpful, per direct feedback. */
  viewerSeat?: PlayerId;
  colors: number[];
  /** Display names by seat - online only (see OnlineSession.playerNames). undefined for
   * local hotseat, which has no display-name concept (everyone shares one screen); falls
   * back to "Player N" everywhere it's used (see game/playerName.ts). */
  playerNames?: string[];
  /** Server epoch ms when the current turn auto-plays - online only (see GameRoom.ts /
   * useOnlineGameState.ts). undefined for local hotseat, which has no server to enforce a
   * timeout and so shows no timer at all. */
  turnDeadline?: number;
  /** Reports the app-wide pixel-dither background (see App.tsx/PixelDither.tsx) this board
   * wants while it's active - visible only on the viewer's own turn (in local hotseat that's
   * every turn, since mySeat always equals state.currentPlayer there), tinted the current
   * player's own color. A side effect, not a return value, since the background lives above
   * GameBoard in the tree (App.tsx owns the single shared PixelDither instance). */
  onBackgroundChange?: (background: BoardBackground) => void;
}

export function GameBoard({
  state, play, passCurrentHand, restart, lastPlanRef, mySeat, viewerSeat = mySeat, colors, playerNames, turnDeadline, onBackgroundChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  const [stolenFlight, setStolenFlight] = useState<FlightPlan | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);
  // Set by onCardLeavingHand the moment the player commits to a steal target (tapping the
  // opponent's kennel), before StealCardOverlay's own reveal flight runs - handlePlay checks
  // this so it doesn't start a second, overlapping fly-to-discard animation for the same
  // card once the actual move commits a few taps later.
  const pendingFlightCardIdRef = useRef<string | null>(null);
  // Previous state, kept purely to detect "one of MY cards just vanished because someone
  // ELSE'S move took it" (a steal) - see the effect below. Not used for anything else;
  // GameBoard doesn't otherwise need history.
  const prevStateRef = useRef<GameState | null>(null);

  const isMyTurn = mySeat === state.currentPlayer;

  useEffect(() => {
    if (!containerRef.current || bridgeRef.current) return;
    bridgeRef.current = createPhaserGame(containerRef.current);
    bridgeRef.current.setColorAssignment(colors);
    // No cleanup/destroy on purpose - see GameView's original comment (StrictMode's
    // dev-only double-invoke tearing down a Phaser.Game mid-boot leaves an orphaned
    // canvas). GameBoard is mounted once per game session and never unmounts during
    // normal use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Before setGameState - viewerSeat has to be current before the render it drives (see
    // PhaserGame.ts's pushState ordering).
    bridgeRef.current?.setViewerSeat(viewerSeat);
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef, viewerSeat]);

  useEffect(() => {
    // colors[mySeat], not colors[state.currentPlayer] - the two are equal at the instant
    // this becomes visible (isMyTurn means state.currentPlayer === mySeat), but diverge the
    // instant a turn passes to someone else, and mySeat is the one that stays constant while
    // this fades out (a bug caught live: using state.currentPlayer here made the background
    // visibly jump to the *next* player's color mid-fade, right before disappearing, since
    // that value updates in the same tick the turn changes, ahead of the opacity crossfade
    // actually finishing). A player should only ever see their own color animate, never a
    // glimpse of whoever's turn it's becoming.
    onBackgroundChange?.({ visible: isMyTurn, color: hueToCss(colors[mySeat]) });
  }, [isMyTurn, colors, mySeat, onBackgroundChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setSelectedCardId(null), [state.currentPlayer]);

  useEffect(() => {
    if (dealtRoundRef.current === state.roundIndex) return;
    if (!containerRef.current || !handPanelRef.current || containerSize.width === 0) return;
    dealtRoundRef.current = state.roundIndex;
    const geo = computeBoardGeometry(
      containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
    );
    const containerRect = containerRef.current.getBoundingClientRect();
    const deckPoint = drawPileCenter(geo);
    const handRect = handPanelRef.current.getBoundingClientRect();
    setDealPlan({
      cards: state.hands[state.currentPlayer],
      from: { x: containerRect.left + deckPoint.x, y: containerRect.top + deckPoint.y },
      to: { x: handRect.left, y: handRect.top + handRect.height / 2, width: handRect.width },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, containerSize]);

  const lastMoveAnnouncement =
    state.lastPlayedCard && state.lastPlayedBy !== null
      ? `${playerLabel(playerNames, state.lastPlayedBy)} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';
  // Announces whose turn it now is, not just what was played - matters most online, where
  // the board overlay silently mounts or unmounts based on isMyTurn with no other cue for a
  // screen reader user that the board just became (or stopped being) interactive.
  const turnAnnouncement = isMyTurn ? "It's your turn." : `Waiting for ${playerLabel(playerNames, state.currentPlayer)}.`;

  const selectedCard = state.hands[state.currentPlayer].find((c) => c.id === selectedCardId) ?? null;

  const startCardFlight = (card: Card) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
    const containerEl = containerRef.current;
    if (!cardEl || !containerEl || containerSize.width === 0) return;
    const fromRect = cardEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const geo = computeBoardGeometry(
      containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
    );
    const dest = discardPileCenter(geo);
    setFlight({
      card,
      from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
      to: { x: containerRect.left + dest.x, y: containerRect.top + dest.y },
    });
  };

  // See BoardOverlay.tsx's onCardLeavingHand: fires early for a steal, ahead of the actual
  // move being chosen, so the card visually leaves the moment the player commits to a
  // target rather than after the whole steal-reveal sequence plays out.
  const handleCardLeavingHand = (card: Card) => {
    pendingFlightCardIdRef.current = card.id;
    startCardFlight(card);
  };

  const handlePlay = (player: PlayerId, move: Move) => {
    if (pendingFlightCardIdRef.current !== move.card.id) {
      startCardFlight(move.card);
    }
    pendingFlightCardIdRef.current = null;
    play(player, move);
  };

  // Detects "my hand just lost a card I didn't play myself" - the only way that happens is
  // an opponent's steal (forceDraw) targeting me (see GameEngine.ts's applyMove: every other
  // move kind either doesn't touch hands or only removes the ACTING player's own card).
  // prev.currentPlayer !== mySeat is what distinguishes this from my own ordinary play,
  // which already gets its fly-to-discard animation from handlePlay above.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev || prev.currentPlayer === mySeat) return;
    const prevHand = prev.hands[mySeat];
    const nextIds = new Set(state.hands[mySeat].map((c) => c.id));
    if (state.hands[mySeat].length >= prevHand.length) return;
    const stolenCard = prevHand.find((c) => !nextIds.has(c.id));
    if (!stolenCard) return;
    const containerEl = containerRef.current;
    const handEl = handPanelRef.current;
    if (!containerEl || !handEl || containerSize.width === 0) return;
    const handRect = handEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const geo = computeBoardGeometry(
      containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
    );
    // The stolen card's own DOM position is long gone by the time this runs (state already
    // updated) - the hand panel's own center stands in as "somewhere in my hand" instead,
    // flying out toward the board's center ("taken away"), a reverse of the normal
    // card-to-discard flight simultaneous with the thief's own animation on their screen.
    setStolenFlight({
      card: stolenCard,
      from: { x: handRect.left + handRect.width / 2 - 40, y: handRect.top, width: 80, height: handRect.height },
      to: { x: containerRect.left + geo.center.x, y: containerRect.top + geo.center.y },
    });
  }, [state, mySeat, viewerSeat, containerSize]);

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Game board. ${playerLabel(playerNames, state.currentPlayer)}'s turn.`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        <OpponentHandCounts
          state={state}
          containerSize={containerSize}
          mySeat={mySeat}
          viewerSeat={viewerSeat}
          playerNames={playerNames}
        />
        {isMyTurn && (
          <BoardOverlay
            state={state}
            selectedCard={selectedCard}
            containerSize={containerSize}
            onPlay={handlePlay}
            viewerSeat={viewerSeat}
            onCardLeavingHand={handleCardLeavingHand}
          />
        )}
        {isMyTurn && <BoardStatus state={state} containerSize={containerSize} onPassHand={passCurrentHand} viewerSeat={viewerSeat} />}
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {lastMoveAnnouncement} {turnAnnouncement}
      </p>
      <div ref={handPanelRef} className="hand-panel-slot" style={{ opacity: dealPlan ? 0 : 1 }}>
        <TurnLabel player={state.currentPlayer} playerNames={playerNames} />
        {turnDeadline !== undefined && <TurnTimerBar deadline={turnDeadline} />}
        <HandPanel
          state={state}
          player={mySeat}
          interactive={isMyTurn}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
        />
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {stolenFlight && <FlyingCard plan={stolenFlight} onDone={() => setStolenFlight(null)} />}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={colors} playerNames={playerNames} onPlayAgain={restart} />
    </main>
  );
}
