import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import type { TurnAnimation } from './game/animationPlan';
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

interface Props {
  state: GameState;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
  restart?: () => void;
  lastPlanRef: MutableRefObject<TurnAnimation>;
  mySeat: PlayerId;
  colors: number[];
}

export function GameBoard({ state, play, passCurrentHand, restart, lastPlanRef, mySeat, colors }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);

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
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef]);

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
        {isMyTurn && (
          <BoardOverlay state={state} selectedCard={selectedCard} containerSize={containerSize} onPlay={handlePlay} />
        )}
        {isMyTurn && <BoardStatus state={state} containerSize={containerSize} onPassHand={passCurrentHand} />}
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {lastMoveAnnouncement}
      </p>
      <TurnLabel player={state.currentPlayer} />
      <div ref={handPanelRef} className="hand-panel-slot" style={{ opacity: dealPlan ? 0 : 1 }}>
        {isMyTurn ? (
          <HandPanel state={state} selectedCardId={selectedCardId} onSelectCard={setSelectedCardId} />
        ) : (
          <p className="lobby__hint online-wait-message">Waiting for Player {state.currentPlayer + 1}...</p>
        )}
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={colors} onPlayAgain={restart} />
    </main>
  );
}
