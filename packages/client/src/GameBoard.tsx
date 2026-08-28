import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { activePlayerIds, emoteById, trackLengthFor } from '@crazypixel/shared';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import type { TurnAnimation } from './game/animationPlan';
import { computeBoardGeometry, discardPileCenter, drawPileCenter, handCountPoint } from './game/boardLayout';
import { HandPanel } from './HandPanel';
import { BoardOverlay } from './BoardOverlay';
import { BoardStatus } from './BoardStatus';
import { OpponentHandCounts } from './OpponentHandCounts';
import { LaidCard } from './LaidCard';
import { TurnLabel } from './TurnLabel';
import { TurnTimerBar } from './TurnTimerBar';
import { FlyingCard } from './FlyingCard';
import type { FlightPlan } from './FlyingCard';
import type { FeedEmote } from './game/useOnlineGameState';
import { DealAnimation } from './DealAnimation';
import type { DealPlan } from './DealAnimation';
import { StealTransfer } from './StealTransfer';
import type { StealTransferPlan } from './StealTransfer';
import { StealAlert } from './StealAlert';
import { EmoteFeed } from './EmoteFeed';
import { EmotePicker } from './EmotePicker';
import { WinScreen } from './WinScreen';
import { playerLabel } from './game/playerName';
import { hueToCss } from './game/color';
import { PixelDither } from './PixelDither';
import { handCardWidthFor } from './game/cardArt';

// Matches .hand-panel's own top/bottom padding asymmetry in theme.css (28px vs 8px, an extra
// 20px split evenly around dead-center) - the real hand cards sit this far below the true
// vertical center of the hand-panel-slot rect, so anything animating a card to/from "the
// hand" has to aim here too, not at handRect's own geometric center, or it lands/departs
// looking offset from where the real cards actually are the instant the animation hands off.
const HAND_CARDS_CENTER_OFFSET = 10;

// Steal presentation, victim's side. The card sits marked (red, lifted out of the row) for
// this long before it flies - long enough to actually find it among six cards and read what
// it was, which the old version (a 420ms unmarked flight from the middle of the hand toward
// the board's center) gave nobody a chance to do. The two together land just under 2s.
const STEAL_MARK_MS = 1100;
const STEAL_TRANSFER_MS = 700;
// Same flight for everyone who isn't the victim or the thief, minus the marking beat -
// nothing of theirs is being singled out, so there's nothing to hold on.
const THIRD_PARTY_TRANSFER_MS = 780;
// Starting size of that third-party flight: a face-down card leaving a stack of 18px fanned
// backs, so it starts nearer that scale than a full 80px hand card would.
const THIRD_PARTY_CARD_WIDTH = 44;
// One beat of the destination stack popping as the card lands on it - the "and now it's
// theirs" full stop.
const FAN_POP_MS = 280;

interface StealPresentation {
  thief: PlayerId;
  card: Card;
  /** Slot the card occupied in the hand, so the ghost goes back exactly where it was. */
  index: number;
  /** 'marked' = still sitting in the hand, highlighted; 'flying' = handed off to StealTransfer. */
  stage: 'marked' | 'flying';
}

export interface BoardBackground {
  visible: boolean;
  color: string;
}

interface Props {
  state: GameState;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
  restart?: () => void;
  /** Win-screen label for `restart`. Defaults to 'Play Again' (see WinScreen). */
  restartLabel?: string;
  /** Shown on the win screen in `restart`'s place when it's absent - online, only the host
   * can start a rematch (see GameRoom.handleRematch). Undefined for local hotseat. */
  restartHint?: string;
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
  /** Live "player X has singled out player Y's hand for a steal, but hasn't taken a card
   * yet" signal - online only (see useOnlineGameState; local hotseat passes nothing, where
   * warning a player about the person sitting next to them holding the same phone would be
   * theatre). Drives the warning half of the steal presentation: everything below keys off
   * `target === mySeat`. */
  stealIntent?: { by: PlayerId; target: PlayerId; card: Card } | null;
  /** Reports the reverse direction - this client's player has just committed to reaching
   * into `target`'s hand with `card`, so everyone else can be warned and can lay that card
   * on the pile at the same moment this client does. Online only, same as above. */
  onStealIntent?: (target: PlayerId, card: Card) => void;
  /** Recent emotes to show beside the discard pile, newest last - online only (see
   * useOnlineGameState). Local hotseat passes nothing and renders no emote UI at all: an
   * emote is a message to someone looking at a different screen, and everyone sharing one
   * device can just say it out loud. */
  emotes?: FeedEmote[];
  /** Sends one emote id from the shared EMOTES catalogue. Its presence is what turns the
   * emote HUD on, so it and `emotes` always arrive together. */
  onEmote?: (emoteId: string) => void;
}

const EMOTES_MUTED_KEY = 'crazypixel.emotesMuted';

export function GameBoard({
  state, play, passCurrentHand, restart, restartLabel, restartHint, lastPlanRef, mySeat, viewerSeat = mySeat, colors, playerNames, turnDeadline, onBackgroundChange, stealIntent, onStealIntent, emotes, onEmote,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  // The two halves of watching a steal happen: `stealPresentation` is only set when the
  // stolen card was MINE (it drives the ghost in the hand and the alert text), `transfer` is
  // the card actually crossing the board and is set for onlookers too.
  const [stealPresentation, setStealPresentation] = useState<StealPresentation | null>(null);
  const [transfer, setTransfer] = useState<{ plan: StealTransferPlan; toSeat: PlayerId } | null>(null);
  const [fanPop, setFanPop] = useState<PlayerId | null>(null);
  // Set the instant this player picks whose hand to reach into, cleared when the turn moves
  // on. Picking a target is the point of no return - the card is spent right there - so this
  // is what makes the rest of the UI act like it: the hand goes inert (no swapping to a
  // different card) and the card lays itself on the discard pile ahead of the move actually
  // being sent, which is otherwise a full reveal animation away.
  const [stealCommit, setStealCommit] = useState<{ card: Card; target: PlayerId } | null>(null);
  // A card on its way into this hand, set when its reveal starts being held up (see
  // StealFlight's onMakeRoom). Only opens the gap - the card itself is still the flying
  // element until the move commits.
  const [incomingCard, setIncomingCard] = useState<Card | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);
  // Set by handleStealCommit the moment the player picks whose hand to reach into, before
  // StealCardOverlay's own reveal flight runs - handlePlay checks this so it doesn't start a
  // second, overlapping fly-to-discard animation for the same card once the actual move
  // commits a tap later.
  const pendingFlightCardIdRef = useRef<string | null>(null);
  // Previous state, kept purely to detect "one of MY cards just vanished because someone
  // ELSE'S move took it" (a steal) - see the effect below. Not used for anything else;
  // GameBoard doesn't otherwise need history.
  const prevStateRef = useRef<GameState | null>(null);
  // Hides the feed and stops feeding the announcement log. Persisted so a player who doesn't
  // want reactions in the corner doesn't have to re-mute every game - a stream of emotes from
  // five other seats is motion parked over the board for the whole match, and turning it off
  // has to be one control, not a per-message dismiss.
  const [emotesMuted, setEmotesMuted] = useState(() => {
    try {
      return window.localStorage.getItem(EMOTES_MUTED_KEY) === '1';
    } catch {
      return false; // Safari private mode throws on localStorage access rather than no-oping.
    }
  });
  const handleMutedChange = useCallback((muted: boolean) => {
    setEmotesMuted(muted);
    try {
      window.localStorage.setItem(EMOTES_MUTED_KEY, muted ? '1' : '0');
    } catch {
      // Preference just doesn't persist - not worth failing the toggle over.
    }
  }, []);

  const isMyTurn = mySeat === state.currentPlayer;

  useEffect(() => {
    if (!canvasMountRef.current || bridgeRef.current) return;
    bridgeRef.current = createPhaserGame(canvasMountRef.current);
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

  useEffect(() => {
    setSelectedCardId(null);
    // The commit only ever spans one turn - by the time the turn has moved on, the steal has
    // either played out or been finished by the server's turn clock (GameRoom.autoPlayTurn),
    // and either way state.lastPlayedCard has taken over from pendingLaidCard below.
    setStealCommit(null);
    setIncomingCard(null);
  }, [state.currentPlayer]);

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
      // mySeat, not state.currentPlayer - this same effect fires for every client on every
      // new round (deal is round-based, not turn-based), and state.currentPlayer is
      // whoever's turn happens to open the round, which is only "my" seat sometimes. Using
      // it here flew and flipped-to-reveal a DIFFERENT player's real hand on-screen before
      // the real HandPanel (always state.hands[mySeat], see below) snapped in and replaced
      // it - a real card-visibility leak in online play, not just a visual glitch.
      cards: state.hands[mySeat],
      from: { x: containerRect.left + deckPoint.x, y: containerRect.top + deckPoint.y },
      to: { x: handRect.left, y: handRect.top + handRect.height / 2 + HAND_CARDS_CENTER_OFFSET, width: handRect.width },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, containerSize]);

  // Who, if anyone, is currently menacing this hand - the pre-steal warning (someone has
  // picked my hand but hasn't taken a card) and the steal itself are one continuous signal
  // in the same player's color, so they resolve to a single value here rather than two
  // independent bits of UI that happen to overlap.
  const threatBy = stealIntent?.target === mySeat ? stealIntent.by : null;
  const alertSeat = stealPresentation?.thief ?? threatBy;
  // Holds the last alert color for a moment after the threat ends, purely so the hand's
  // dither doesn't snap back to the viewer's own color midway through its 300ms fade-OUT -
  // same class of bug as the app-wide background's own documented one below (a color that
  // changes while a crossfade is still running is visible as a flash, not as a fade).
  const [fadingAlertSeat, setFadingAlertSeat] = useState<PlayerId | null>(null);
  useEffect(() => {
    if (alertSeat !== null) {
      setFadingAlertSeat(alertSeat);
      return undefined;
    }
    if (fadingAlertSeat === null) return undefined;
    const timer = setTimeout(() => setFadingAlertSeat(null), 360);
    return () => clearTimeout(timer);
  }, [alertSeat, fadingAlertSeat]);
  // Your own turn always wins the hand panel back - it's the "you're up" signal, and it can
  // legitimately arrive while the steal presentation is still playing out (the turn advances
  // server-side the instant the steal commits, and the presentation runs for ~2s after).
  const handDitherSeat = isMyTurn ? mySeat : (alertSeat ?? fadingAlertSeat ?? mySeat);

  const stealAnnouncement = stealPresentation
    ? `${playerLabel(playerNames, stealPresentation.thief)} took your ${stealPresentation.card.rank}.`
    : threatBy !== null
      ? `${playerLabel(playerNames, threatBy)} is about to take a card from your hand.`
      : '';

  // A committed steal's card belongs on the pile immediately, before its move is sent - the
  // thief knows it from their own stealCommit, everyone else from the broadcast. Both resolve
  // to the same card, and once the move lands state.lastPlayedCard IS that card, so the
  // handover is a no-op: same card id, same key, no remount, no second pop-in.
  const pendingLaidCard = stealCommit?.card ?? stealIntent?.card ?? null;
  const laidCard = pendingLaidCard ?? state.lastPlayedCard;
  // Same card, seen from the other side: a card that's on the pile but still listed in
  // someone's hand has to stop being counted in their stack too. Only stealIntent feeds this
  // - OpponentHandCounts never renders the viewer's own seat, so stealCommit (which is always
  // about this client's own hand) has nothing to say here.
  const spentCard = stealIntent ? { seat: stealIntent.by, cardId: stealIntent.card.id } : null;
  // Held open only until the real card lands in the hand - at that point the hand itself
  // provides the slot, and a second one would leave a gap hanging off the end. Checking the
  // hand rather than clearing on a timer means this is right whether the move commits
  // instantly (local hotseat) or a round-trip later (online).
  const incomingSlotWidth = incomingCard && !state.hands[mySeat].some((c) => c.id === incomingCard.id)
    ? handCardWidthFor(containerSize.width)
    : null;

  const lastMoveAnnouncement =
    state.lastPlayedCard && state.lastPlayedBy !== null
      ? `${playerLabel(playerNames, state.lastPlayedBy)} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';
  // Announces whose turn it now is, not just what was played - matters most online, where
  // the board overlay silently mounts or unmounts based on isMyTurn with no other cue for a
  // screen reader user that the board just became (or stopped being) interactive.
  const turnAnnouncement = isMyTurn ? "It's your turn." : `Waiting for ${playerLabel(playerNames, state.currentPlayer)}.`;

  // The win screen is position:fixed over the whole viewport with no focus trap, so an emote
  // HUD left mounted underneath it would be invisible but still tabbable - a focused control
  // completely hidden behind an overlay. Emotes end with the game rather than being reachable
  // through it.
  const emotesEnabled = onEmote !== undefined && state.phase !== 'gameEnd';
  const visibleEmotes = emotesMuted ? [] : (emotes ?? []);
  // Your own emotes are skipped - you pressed the button, and every announcement here is
  // competing for the same polite queue as the turn narration. Names are user-authored, so
  // they're capped: a 200-character display name is a denial of service on a screen reader.
  const announcedEmotes = visibleEmotes.filter((e) => e.by !== mySeat);

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

  // See BoardOverlay.tsx's onStealCommit: fires when the player picks whose hand to reach
  // into, ahead of the blind position and so ahead of the move itself. That tap spends the
  // card, so everything that would normally happen at play time happens here instead - the
  // card flies out of the hand, lands on the discard pile (locally via stealCommit, and on
  // every other client via the broadcast), and the hand stops accepting input.
  const handleStealCommit = (card: Card, target: PlayerId) => {
    pendingFlightCardIdRef.current = card.id;
    startCardFlight(card);
    setStealCommit({ card, target });
    onStealIntent?.(target, card);
  };

  const handlePlay = (player: PlayerId, move: Move) => {
    if (pendingFlightCardIdRef.current !== move.card.id) {
      startCardFlight(move.card);
    }
    pendingFlightCardIdRef.current = null;
    play(player, move);
  };

  // Detects "a hand just lost a card its owner didn't play" - the only move that can do that
  // to someone else's hand is a steal (forceDraw; see GameEngine.ts's applyMove, where every
  // other kind either doesn't touch hands or only removes the ACTING player's own card). Runs
  // on every client, and branches on who's watching: the victim gets the full marked-card
  // presentation below, everyone else gets a face-down card crossing from one stack to the
  // other. The thief's own client returns early - StealCardOverlay already ran the reveal
  // flight there before the move was even sent.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;
    // A round boundary re-deals every hand at once (advanceTurn -> dealRound), which would
    // otherwise read as every seat being robbed simultaneously.
    if (prev.roundIndex !== state.roundIndex) return;
    const thief = prev.currentPlayer;
    if (thief === mySeat) return;
    // The acting player's own hand always shrinks (they played a card), so they're excluded
    // from the search rather than special-cased afterwards - a steal nets them zero anyway
    // (minus the played card, plus the stolen one).
    const victim = activePlayerIds(state.config)
      .find((p) => p !== thief && state.hands[p].length < prev.hands[p].length);
    if (victim === undefined) return;

    const containerEl = containerRef.current;
    if (!containerEl || containerSize.width === 0) return;
    const geo = computeBoardGeometry(
      containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
    );
    const containerRect = containerEl.getBoundingClientRect();
    const thiefFan = handCountPoint(state.config, thief, geo);
    const destination = { x: containerRect.left + thiefFan.x, y: containerRect.top + thiefFan.y };

    if (victim !== mySeat) {
      const victimFan = handCountPoint(state.config, victim, geo);
      const height = THIRD_PARTY_CARD_WIDTH * 7 / 5; // .playing-card's own 5/7 aspect ratio
      setTransfer({
        toSeat: thief,
        plan: {
          // Face down on purpose - an onlooker seeing the rank would leak a card neither of
          // the two players involved has shown them (the victim knows it because it was
          // theirs, the thief because they now hold it).
          card: null,
          from: {
            x: containerRect.left + victimFan.x - THIRD_PARTY_CARD_WIDTH / 2,
            y: containerRect.top + victimFan.y - height / 2,
            width: THIRD_PARTY_CARD_WIDTH,
            height,
          },
          to: destination,
          color: hueToCss(colors[thief]),
          durationMs: THIRD_PARTY_TRANSFER_MS,
          endScale: 0.5,
        },
      });
      return;
    }

    const nextIds = new Set(state.hands[mySeat].map((c) => c.id));
    const index = prev.hands[mySeat].findIndex((c) => !nextIds.has(c.id));
    if (index === -1) return;
    // Nothing flies yet - the card first has to be *found* in the hand. The ghost keeps it
    // rendered in place (see HandPanel's stolenGhost) so it can be marked where the player
    // last saw it; the effect below takes over once that beat is done.
    setStealPresentation({ thief, card: prev.hands[mySeat][index], index, stage: 'marked' });
  }, [state, mySeat, viewerSeat, containerSize, colors]);

  // Second beat of the victim's presentation: the marked card leaves the hand and crosses to
  // the thief's own card stack. Measured off the ghost's live DOM node rather than a computed
  // position, so it departs from exactly where the player has been looking at it.
  useEffect(() => {
    if (stealPresentation?.stage !== 'marked') return undefined;
    const { card, thief } = stealPresentation;
    const timer = setTimeout(() => {
      const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
      const containerEl = containerRef.current;
      if (!cardEl || !containerEl || containerSize.width === 0) {
        setStealPresentation(null);
        return;
      }
      const fromRect = cardEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const geo = computeBoardGeometry(
        containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
      );
      const thiefFan = handCountPoint(state.config, thief, geo);
      setTransfer({
        toSeat: thief,
        plan: {
          card,
          from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
          to: { x: containerRect.left + thiefFan.x, y: containerRect.top + thiefFan.y },
          color: hueToCss(colors[thief]),
          durationMs: STEAL_TRANSFER_MS,
          endScale: 0.25,
        },
      });
      // Drops the ghost in the same tick the flying clone appears, so the card is never
      // visibly in two places at once - the same two-elements-one-motion handoff FlyingCard
      // relies on for a played card.
      setStealPresentation((p) => (p ? { ...p, stage: 'flying' } : null));
    }, STEAL_MARK_MS);
    return () => clearTimeout(timer);
  }, [stealPresentation, state.config, viewerSeat, containerSize, colors]);

  useEffect(() => {
    if (fanPop === null) return undefined;
    const timer = setTimeout(() => setFanPop(null), FAN_POP_MS);
    return () => clearTimeout(timer);
  }, [fanPop]);

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* role="img" scoped to the Phaser canvas alone, NOT to the whole board area. `img`
            is a children-presentational role: everything inside it is pruned from the
            accessibility tree, so while this label sat on the container it was silently
            swallowing every real control positioned over the canvas - BoardOverlay's move
            buttons, BoardStatus's "Lay down cards", and now the emote picker - leaving a
            screen reader one flat "Game board, image" node and no way to play at all. The
            canvas gets its own mount element (see createPhaserGame above); the DOM layer
            stays a sibling of it, sharing the container's coordinate system exactly as
            before. */}
        <div
          ref={canvasMountRef}
          className="board-canvas"
          role="img"
          aria-label={`Game board. ${playerLabel(playerNames, state.currentPlayer)}'s turn.`}
        />
        <OpponentHandCounts
          state={state}
          containerSize={containerSize}
          mySeat={mySeat}
          viewerSeat={viewerSeat}
          playerNames={playerNames}
          poppingSeat={fanPop}
          spentCard={spentCard}
        />
        {laidCard && (
          <LaidCard
            key={laidCard.id}
            card={laidCard}
            state={state}
            containerSize={containerSize}
            viewerSeat={viewerSeat}
          />
        )}
        {isMyTurn && (
          <BoardOverlay
            state={state}
            selectedCard={selectedCard}
            containerSize={containerSize}
            onPlay={handlePlay}
            viewerSeat={viewerSeat}
            onStealCommit={handleStealCommit}
            onStealIncoming={setIncomingCard}
          />
        )}
        {isMyTurn && <BoardStatus state={state} containerSize={containerSize} onPassHand={passCurrentHand} viewerSeat={viewerSeat} />}
        {emotesEnabled && (
          <EmoteFeed
            emotes={visibleEmotes}
            state={state}
            containerSize={containerSize}
            viewerSeat={viewerSeat}
            colors={colors}
            playerNames={playerNames}
          />
        )}
        {emotesEnabled && (
          <EmotePicker
            state={state}
            containerSize={containerSize}
            viewerSeat={viewerSeat}
            onEmote={onEmote!}
            muted={emotesMuted}
            onMutedChange={handleMutedChange}
          />
        )}
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {stealAnnouncement} {lastMoveAnnouncement} {turnAnnouncement}
      </p>
      {/* Emotes get their own region rather than joining the line above, because that one is
          three interpolated strings in a single text node: changing any part of it re-reads
          the whole thing, so every emote would drag "Waiting for Player 3" along behind it.
          role="log" is append-only by definition (aria-relevant defaults to additions, so the
          6.5s expiries are silent) and NOT implicitly atomic the way role="status" is, which
          would re-read all four lines on each arrival. aria-live is set alongside the role
          because VoiceOver's own support for bare role="log" is unreliable. Two polite
          regions serialize rather than interrupt each other. Rendered whether or not there's
          anything in it - a live region only announces mutations observed after it's in the
          DOM, so one mounted on its first message never announces that message. */}
      {emotesEnabled && (
        <div role="log" aria-live="polite" className="visually-hidden">
          {announcedEmotes.map((entry) => (
            <span key={entry.id}>{`${playerLabel(playerNames, entry.by).slice(0, 20)}: ${emoteById(entry.emoteId)?.label ?? ''}. `}</span>
          ))}
        </div>
      )}
      <div ref={handPanelRef} className="hand-panel-slot">
        {/* Same vivid dither look as the menu background (denser, brighter, multi-level),
            just tinted to your own seat color instead of white - the app-wide background
            behind the board itself stays the calmer single-tone look; this is scoped to just
            the hand area, a second independent PixelDither instance rather than changing the
            shared one App.tsx owns. Deliberately OUTSIDE the opacity toggle just below - it
            used to sit inside it (hidden along with the cards during the deal), which meant
            the plainer app-wide background showed through here for the whole deal animation
            and only switched to this one once the deal finished, reading as "the old
            background" hanging around during a load rather than a real fix.
            visible={isMyTurn} matches the app-wide background's own rule (see
            onBackgroundChange above): your seat color only lights up the hand area while
            you're actually acting, so online the panel reads as inert on other players'
            turns instead of implying an interactive hand. A `visible` crossfade rather than
            unmounting, so the dither's own animation phase doesn't reset each turn. Always
            true in local hotseat, where mySeat === state.currentPlayer by construction. */}
        <PixelDither vivid visible={isMyTurn || alertSeat !== null} color={hueToCss(colors[handDitherSeat])} className="hand-panel__background" />
        <div style={{ opacity: dealPlan ? 0 : 1 }}>
          {/* One line, one message - the alert takes the turn label's exact position, so
              they can't both render (they'd overlap). */}
          {alertSeat !== null ? (
            <StealAlert
              text={stealPresentation
                ? `${playerLabel(playerNames, stealPresentation.thief).toUpperCase()} TOOK YOUR ${stealPresentation.card.rank}`
                : `${playerLabel(playerNames, alertSeat).toUpperCase()} IS REACHING INTO YOUR HAND`}
              color={hueToCss(colors[alertSeat])}
              settled={stealPresentation !== null}
            />
          ) : (
            <TurnLabel player={state.currentPlayer} playerNames={playerNames} />
          )}
          {turnDeadline !== undefined && <TurnTimerBar deadline={turnDeadline} />}
          <HandPanel
            state={state}
            player={mySeat}
            // A committed steal locks the hand: the card is already spent and on the pile,
            // so letting another one be selected would offer a way out of a decision that
            // isn't reversible any more.
            interactive={isMyTurn && stealCommit === null}
            selectedCardId={selectedCardId}
            onSelectCard={setSelectedCardId}
            stolenGhost={stealPresentation?.stage === 'marked' ? stealPresentation : null}
            hiddenCardId={stealCommit?.card.id ?? null}
            incomingSlotWidth={incomingSlotWidth}
          />
        </div>
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {transfer && (
        <StealTransfer
          plan={transfer.plan}
          onDone={() => {
            setFanPop(transfer.toSeat);
            setTransfer(null);
            setStealPresentation(null);
          }}
        />
      )}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={colors} playerNames={playerNames} onPlayAgain={restart} playAgainLabel={restartLabel} playAgainHint={restartHint} />
    </main>
  );
}
