import { useEffect, useRef, useState } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import { useGameState } from './game/useGameState';
import { computeBoardGeometry, discardPileCenter, drawPileCenter } from './game/boardLayout';
import { HandPanel } from './HandPanel';
import { BoardOverlay } from './BoardOverlay';
import { BoardStatus } from './BoardStatus';
import { TurnLabel } from './TurnLabel';
import { FlyingCard } from './FlyingCard';
import type { FlightPlan } from './FlyingCard';
import { DealAnimation } from './DealAnimation';
import type { DealPlan } from './DealAnimation';
import { WinScreen } from './WinScreen';
import type { GameSetup } from './Lobby';

interface Props {
  setup: GameSetup;
}

export function GameView({ setup }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const { state, play, passCurrentHand, restart, lastPlanRef } = useGameState(setup.config);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  // Which roundIndex we've already played the fly-in for - a real new deal (including the
  // very first one) gets the animation once; merely cycling the turn to a player who was
  // dealt to earlier this same round does not (they already have their cards, nothing new
  // is arriving - see DealAnimation.tsx).
  const dealtRoundRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || bridgeRef.current) return;
    bridgeRef.current = createPhaserGame(containerRef.current);
    bridgeRef.current.setColorAssignment(setup.colors);
    // No cleanup/destroy on purpose: React 18 StrictMode's dev-only double-invoke (mount ->
    // cleanup -> mount) was tearing down a Phaser.Game before its async boot even finished,
    // leaving an orphaned 0x0 canvas behind rather than a clean instance - Phaser's
    // canvas/WebGL lifecycle doesn't tolerate that rapid churn. Leaving bridgeRef.current
    // set (never reset to null) also means the guard above turns StrictMode's phantom
    // remount into a no-op, so only one Phaser.Game is ever created. GameView is mounted
    // once per game (the lobby is a one-way door for this pass) and never unmounts during
    // normal use, so skipping teardown here doesn't leak in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef]);

  // BoardOverlay needs the container's pixel size to compute the same board-center math
  // TableScene uses, so its highlighted hit targets land exactly on top of what's drawn.
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

  // Fires once per genuinely new deal (initial deal included) - not on every turn switch,
  // even though switching players swaps in a different (already-dealt) hands array too.
  useEffect(() => {
    if (dealtRoundRef.current === state.roundIndex) return;
    // Container isn't laid out yet (0x0 at boot, before the ResizeObserver's first real
    // report) - don't mark this round "handled" until a plan is actually computed, or the
    // very first deal (the one most worth animating) would get silently skipped and never
    // retried once real dimensions do land.
    if (!containerRef.current || !handPanelRef.current || containerSize.width === 0) return;
    dealtRoundRef.current = state.roundIndex;
    const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config));
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
      ? `Player ${state.lastPlayedBy + 1} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';

  const selectedCard = state.hands[state.currentPlayer].find((c) => c.id === selectedCardId) ?? null;

  const handlePlay = (player: PlayerId, move: Move) => {
    // Every Move variant carries the actual card played, regardless of kind - including
    // wildAs/copyLastCard, where it's the Joker/8 itself, not whatever it's impersonating.
    const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${move.card.id}"]`);
    const containerEl = containerRef.current;
    if (cardEl && containerEl && containerSize.width > 0) {
      const fromRect = cardEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config));
      const dest = discardPileCenter(geo);
      setFlight({
        card: move.card,
        from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
        to: { x: containerRect.left + dest.x, y: containerRect.top + dest.y },
      });
    }
    play(player, move);
  };

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Game board. Player ${state.currentPlayer + 1}'s turn.`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        <BoardOverlay state={state} selectedCard={selectedCard} containerSize={containerSize} onPlay={handlePlay} />
        <BoardStatus state={state} containerSize={containerSize} onPassHand={passCurrentHand} />
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {lastMoveAnnouncement}
      </p>
      <TurnLabel player={state.currentPlayer} />
      <div ref={handPanelRef} className="hand-panel-slot" style={{ opacity: dealPlan ? 0 : 1 }}>
        <HandPanel
          state={state}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
        />
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={setup.colors} onPlayAgain={restart} />
    </main>
  );
}
