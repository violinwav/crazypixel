import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import type { TurnAnimation } from './game/animationPlan';
import { computeBoardGeometry, discardPileCenter, drawPileCenter } from './game/boardLayout';
import { HandPanel } from './HandPanel';
import type { StolenCardGhost } from './HandPanel';
import { HandBackground } from './HandBackground';
import { BoardOverlay } from './BoardOverlay';
import { BoardStatus } from './BoardStatus';
import { OpponentHandCounts } from './OpponentHandCounts';
import { TurnTimerBar } from './TurnTimerBar';
import { PALETTE, hexToCss } from './game/theme';
import { FlyingCard } from './FlyingCard';
import type { FlightPlan } from './FlyingCard';
import { DealAnimation } from './DealAnimation';
import type { DealPlan } from './DealAnimation';
import { WinScreen } from './WinScreen';

// How long a stolen card sits fully visible/highlighted (pulsing) in the victim's hand
// before fading - matches .playing-card--vanishing's own transition duration below.
const STOLEN_HOLD_MS = 1000;
// One committed frame between "stop pulsing" and "start fading" - an active CSS animation
// handing straight to a transition on the same property in one class swap snaps instead of
// interpolating (confirmed live, see theme.css's .playing-card--threatened-still comment).
// 20ms matches this codebase's own established value for "let the browser paint the before
// state first" (see FlyingCard.tsx).
const STOLEN_SETTLE_MS = 20;
const STOLEN_FADE_MS = 320;

interface Props {
  state: GameState;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
  restart?: () => void;
  lastPlanRef: MutableRefObject<TurnAnimation>;
  mySeat: PlayerId;
  colors: number[];
  /** Server epoch ms when the current turn auto-plays - online only (see GameRoom.ts /
   * useOnlineGameState.ts). undefined for local hotseat, which has no server to enforce a
   * timeout and so shows no timer at all. */
  turnDeadline?: number;
}

export function GameBoard({ state, play, passCurrentHand, restart, lastPlanRef, mySeat, colors, turnDeadline }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  const [stolenGhost, setStolenGhost] = useState<StolenCardGhost | null>(null);
  const [stolenAnnouncement, setStolenAnnouncement] = useState('');
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);
  // Previous state, kept purely to detect "one of MY cards just vanished because someone
  // ELSE'S move took it" (a steal) - see the effect below. Not used for anything else;
  // GameBoard doesn't otherwise need history.
  const prevStateRef = useRef<GameState | null>(null);
  // Ghost's hold/fade timers, kept in a ref (not the effect's own cleanup) specifically so
  // an unrelated later state change - my own turn coming around, say - doesn't cancel a
  // steal reveal that's still mid-hold. Only a *newer* steal should ever pre-empt one
  // that's still showing.
  const stolenTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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
    // PhaserGame.ts's pushState ordering). mySeat changes turn to turn in local hotseat (it's
    // always state.currentPlayer there), fixed for the whole session online - either way this
    // re-rotates the board to keep mySeat's base at the bottom, "my base always faces me."
    bridgeRef.current?.setViewerSeat(mySeat);
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef, mySeat]);

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
      containerSize.width, containerSize.height, trackLengthFor(state.config), mySeat, state.config.playerCount,
    );
    const containerRect = containerRef.current.getBoundingClientRect();
    const deckPoint = drawPileCenter(geo);
    const handRect = handPanelRef.current.getBoundingClientRect();
    setDealPlan({
      // mySeat, not state.currentPlayer - they're always equal in local hotseat, which is
      // why this bug was invisible there, but online state.currentPlayer is whoever's turn
      // it is, not the viewer. Using it here meant every deal animated *that* player's real
      // cards into your own hand-panel slot on your screen - both a mismatch (what animated
      // in didn't match what HandPanel then actually showed) and a real leak (you'd
      // genuinely see another player's hand face-up for the length of the animation).
      cards: state.hands[mySeat],
      from: { x: containerRect.left + deckPoint.x, y: containerRect.top + deckPoint.y },
      to: { x: handRect.left, y: handRect.top + handRect.height / 2, width: handRect.width },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, containerSize]);

  const lastMoveAnnouncement =
    state.lastPlayedCard && state.lastPlayedBy !== null
      ? `Player ${state.lastPlayedBy + 1} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';
  // Announces whose turn it now is, not just what was played - matters most online, where
  // the board overlay silently mounts or unmounts based on isMyTurn with no other cue for a
  // screen reader user that the board just became (or stopped being) interactive.
  const turnAnnouncement = isMyTurn ? "It's your turn." : `Waiting for Player ${state.currentPlayer + 1}.`;

  // mySeat, not state.currentPlayer - only ever meaningfully non-null while isMyTurn (so the
  // two happen to be equal today, same as HandBackground's colorHex below), but mySeat is
  // what this actually means ("the card I've selected") and matches every other hand
  // lookup in this file after the deal-plan bug above.
  const selectedCard = state.hands[mySeat].find((c) => c.id === selectedCardId) ?? null;

  const handlePlay = (player: PlayerId, move: Move) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${move.card.id}"]`);
    const containerEl = containerRef.current;
    if (cardEl && containerEl && containerSize.width > 0) {
      const fromRect = cardEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const geo = computeBoardGeometry(
        containerSize.width, containerSize.height, trackLengthFor(state.config), mySeat, state.config.playerCount,
      );
      const dest = discardPileCenter(geo);
      setFlight({
        card: move.card,
        from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
        to: { x: containerRect.left + dest.x, y: containerRect.top + dest.y },
      });
    }
    play(player, move);
  };

  // Detects "my hand just lost a card I didn't play myself" - the only way that happens is
  // an opponent's steal (forceDraw) targeting me (see GameEngine.ts's applyMove: every other
  // move kind either doesn't touch hands or only removes the ACTING player's own card).
  // prev.currentPlayer !== mySeat is what distinguishes this from my own ordinary play,
  // which already gets its fly-to-discard animation from handlePlay above. Deliberately the
  // *only* signal either side gets that a steal happened - no advance warning, no preview
  // while the thief is still picking, this only fires once the real move has actually
  // landed. Holds the card in place, highlighted, rather than flying it anywhere - per
  // feedback, a flight animation read as too abrupt to actually register which card was
  // taken; sitting still and red for a beat reads clearly, then a smooth fade hands it off.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev || prev.currentPlayer === mySeat) return;
    const prevHand = prev.hands[mySeat];
    const nextIds = new Set(state.hands[mySeat].map((c) => c.id));
    if (state.hands[mySeat].length >= prevHand.length) return;
    const stolenIndex = prevHand.findIndex((c) => !nextIds.has(c.id));
    if (stolenIndex === -1) return;
    const stolenCard = prevHand[stolenIndex];

    stolenTimersRef.current.forEach(clearTimeout);
    setStolenGhost({ card: stolenCard, index: stolenIndex, phase: 'held' });
    setStolenAnnouncement(
      `Your ${stolenCard.rank}${stolenCard.suit ? ` of ${stolenCard.suit}` : ''} was taken by Player ${prev.currentPlayer + 1}.`,
    );
    const settleTimer = setTimeout(() => {
      setStolenGhost((g) => (g ? { ...g, phase: 'settled' } : g));
    }, STOLEN_HOLD_MS);
    const vanishTimer = setTimeout(() => {
      setStolenGhost((g) => (g ? { ...g, phase: 'vanishing' } : g));
    }, STOLEN_HOLD_MS + STOLEN_SETTLE_MS);
    const clearTimer = setTimeout(
      () => setStolenGhost(null),
      STOLEN_HOLD_MS + STOLEN_SETTLE_MS + STOLEN_FADE_MS,
    );
    stolenTimersRef.current = [settleTimer, vanishTimer, clearTimer];
  }, [state, mySeat]);

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Game board. Player ${state.currentPlayer + 1}'s turn.`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        <OpponentHandCounts state={state} containerSize={containerSize} mySeat={mySeat} />
        {isMyTurn && (
          <BoardOverlay state={state} selectedCard={selectedCard} containerSize={containerSize} onPlay={handlePlay} mySeat={mySeat} />
        )}
        {isMyTurn && <BoardStatus state={state} onPassHand={passCurrentHand} />}
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {lastMoveAnnouncement} {turnAnnouncement} {stolenAnnouncement}
      </p>
      <div ref={handPanelRef} className="hand-panel-slot" style={{ opacity: dealPlan ? 0 : 1 }}>
        {/* mySeat, not state.currentPlayer - only visible while isMyTurn (so equal today,
            same reasoning as selectedCard above), but this is "my color," not "whoever's
            turn's color." */}
        <HandBackground active={isMyTurn} colorHex={hexToCss(PALETTE.players[colors[mySeat]])} />
        {turnDeadline !== undefined && <TurnTimerBar deadline={turnDeadline} />}
        <HandPanel
          state={state}
          player={mySeat}
          interactive={isMyTurn}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          ghost={stolenGhost}
        />
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={colors} onPlayAgain={restart} />
    </main>
  );
}
