// The in-game screen, shared by local hotseat and online play. Composes the Phaser board, the
// DOM overlay of move targets, the hand, and every transient animation between them.
//
// The two game-state hooks (useGameState, useOnlineGameState) expose the same shape, so this
// component is the only place that knows how a turn is presented. `mySeat` is what makes it
// correct for both modes: the hand panel and board overlay render only when
// mySeat === state.currentPlayer, which is always true in hotseat and is how online play hides
// other players' hands.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { activePlayerIds, emoteById, trackLengthFor } from '@crazypixel/shared';
import type { Card, GameConfig, GameState, Move, PlayerId } from '@crazypixel/shared';
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

// Matches .hand-panel's top/bottom padding asymmetry in theme.css (28px vs 8px, an extra 20px
// split evenly around dead center). The real hand cards sit this far below the true vertical
// center of the hand-panel slot, so anything animating a card to or from "the hand" has to aim
// here too, or it lands looking offset from where the cards actually are.
const HAND_CARDS_CENTER_OFFSET = 10;

// Steal presentation, victim's side. The card sits marked - red, lifted out of the row - for
// this long before it flies, which is long enough to actually find it among six cards and read
// what it was. The two together land just under 2s.
const STEAL_MARK_MS = 1100;
const STEAL_TRANSFER_MS = 700;
// The same flight for everyone who is neither victim nor thief, minus the marking beat: nothing
// of theirs is being singled out, so there is nothing to hold on.
const THIRD_PARTY_TRANSFER_MS = 780;
// Starting size of that third-party flight - a face-down card leaving a stack of 18px fanned
// backs, so it starts nearer that scale than a full 80px hand card would.
const THIRD_PARTY_CARD_WIDTH = 44;
// One beat of the destination stack popping as the card lands on it - the "and now it's theirs"
// full stop.
const FAN_POP_MS = 280;
// How long the hand keeps a departed thief's color after their threat ends, so the hand's own
// dither doesn't snap back to the viewer's color midway through its 300ms fade-out.
const ALERT_FADE_HOLD_MS = 360;

const EMOTES_MUTED_KEY = 'crazypixel.emotesMuted';

interface StealPresentation {
  thief: PlayerId;
  card: Card;
  /** The slot the card occupied, so the ghost stays exactly where it was. */
  index: number;
  /** 'marked' = still in the hand, highlighted; 'flying' = handed off to StealTransfer. */
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
  /** Win-screen label for `restart`. Defaults to 'Play Again'. */
  restartLabel?: string;
  /** Shown on the win screen in `restart`'s place when it is absent - online, only the host can
   * start a rematch. Undefined for local hotseat. */
  restartHint?: string;
  lastPlanRef: MutableRefObject<TurnAnimation>;
  mySeat: PlayerId;
  /** Which seat's base renders at the bottom of the ring. Defaults to mySeat, which is what
   * online play always wants (a fixed seat for the session, so it is a no-op there). Local
   * hotseat passes a fixed seat instead - mySeat tracks state.currentPlayer there, and
   * re-rotating the board every turn read as disorienting. */
  viewerSeat?: PlayerId;
  colors: number[];
  /** Display names by seat - online only. Undefined for local hotseat, which has no
   * display-name concept; everything falls back to "Player N". */
  playerNames?: string[];
  /** Epoch ms when the current turn auto-plays. Online: the server's clock. Local singleplayer:
   * a client-computed one (see useSingleplayerAutopilot.ts) - undefined only when a human turn's
   * timer has been switched off in the setup screen. */
  turnDeadline?: number;
  /** Reports the app-wide dither background this board wants while active: visible only on the
   * viewer's own turn, tinted the current player's color. A side effect rather than a return
   * value, since the background lives above GameBoard in the tree (App.tsx owns the single
   * shared PixelDither instance). */
  onBackgroundChange?: (background: BoardBackground) => void;
  /** Live "player X has singled out player Y's hand, but hasn't taken a card yet" signal -
   * online only. Local hotseat passes nothing, where warning a player about the person sitting
   * next to them holding the same phone would be theatre. Everything below keys off
   * `target === mySeat`. */
  stealIntent?: { by: PlayerId; target: PlayerId; card: Card } | null;
  /** The reverse direction: this client's player has committed to reaching into `target`'s hand
   * with `card`, so everyone else can be warned and lay that card on the pile at the same
   * moment this client does. Online only. */
  onStealIntent?: (target: PlayerId, card: Card) => void;
  /** Recent emotes to show beside the discard pile, newest last - online only. Local hotseat
   * renders no emote UI at all: an emote is a message to someone looking at a different screen,
   * and everyone sharing one device can say it out loud. */
  emotes?: FeedEmote[];
  /** Sends one emote id from the shared catalogue. Its presence is what turns the emote HUD on,
   * so it and `emotes` always arrive together. */
  onEmote?: (emoteId: string) => void;
}

/** The board geometry for this render. Every measurement in this file goes through it, so
 * Phaser, the DOM overlay and every flight animation agree on where things are. Takes `config`
 * rather than the whole GameState so callers inside effects can depend on state.config, which
 * is stable across turns, instead of state itself, which is not. */
function boardGeometryFor(config: GameConfig, containerSize: { width: number; height: number }, viewerSeat: PlayerId) {
  return computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(config), viewerSeat, config.playerCount,
  );
}

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
  // The two halves of watching a steal happen: `stealPresentation` is only set when the stolen
  // card was MINE (it drives the ghost in the hand and the alert text); `transfer` is the card
  // actually crossing the board, and is set for onlookers too.
  const [stealPresentation, setStealPresentation] = useState<StealPresentation | null>(null);
  const [transfer, setTransfer] = useState<{ plan: StealTransferPlan; toSeat: PlayerId } | null>(null);
  const [fanPop, setFanPop] = useState<PlayerId | null>(null);
  // Set the instant this player picks whose hand to reach into, cleared when the turn moves on.
  // Picking a target is the point of no return - the card is spent right there - so this is what
  // makes the rest of the UI act like it: the hand goes inert and the card lays itself on the
  // discard pile ahead of the move actually being sent.
  const [stealCommit, setStealCommit] = useState<{ card: Card; target: PlayerId } | null>(null);
  // A card on its way into this hand, set when its reveal starts being held up. This only opens
  // the gap; the card itself is still the flying element until the move commits.
  const [incomingCard, setIncomingCard] = useState<Card | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);
  // Set by handleStealCommit the moment a target is picked, before StealCardOverlay's reveal
  // flight runs, so handlePlay doesn't start a second overlapping fly-to-discard for the same
  // card once the move commits a tap later.
  const pendingFlightCardIdRef = useRef<string | null>(null);
  // Previous state, kept purely to detect "one of MY cards just vanished because someone ELSE'S
  // move took it" - see the effect below. Not used for anything else.
  const prevStateRef = useRef<GameState | null>(null);
  // Hides the feed and stops feeding the announcement log. Persisted so a player who doesn't
  // want reactions in the corner doesn't have to re-mute every game: a stream of emotes from
  // five seats is motion parked over the board for the whole match, and turning it off has to be
  // one control, not a per-message dismiss.
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
      // The preference just doesn't persist - not worth failing the toggle over.
    }
  }, []);

  // Ends with the game, for the same reason emotes do (see emotesEnabled): the win screen is
  // position:fixed with no focus trap, so the board overlay's move buttons, the "Lay down
  // cards" button and the hand's cards would all stay tabbable underneath it - focusable
  // controls with nothing visible on screen. The winning seat stays `currentPlayer` now that
  // advanceTurn leaves a finished game alone, so this is what makes their board go inert.
  const isMyTurn = mySeat === state.currentPlayer && state.phase !== 'gameEnd';

  useEffect(() => {
    if (!canvasMountRef.current || bridgeRef.current) return;
    bridgeRef.current = createPhaserGame(canvasMountRef.current);
    bridgeRef.current.setColorAssignment(colors);
    // No cleanup/destroy on purpose: StrictMode's dev-only double-invoke tearing down a
    // Phaser.Game mid-boot leaves an orphaned canvas. GameBoard is mounted once per game session
    // and never unmounts during normal use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Before setGameState - viewerSeat has to be current before the render it drives (see
    // PhaserGame's pushState ordering).
    bridgeRef.current?.setViewerSeat(viewerSeat);
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef, viewerSeat]);

  useEffect(() => {
    // colors[mySeat], not colors[state.currentPlayer]. The two are equal at the instant this
    // becomes visible (isMyTurn means they're the same seat) but diverge the instant the turn
    // passes, and mySeat is the one that stays constant while this fades OUT. Using
    // currentPlayer made the background visibly jump to the next player's color mid-fade: that
    // value updates in the same tick the turn changes, ahead of the crossfade finishing. A
    // player should only ever see their own color animate.
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

  // Keyed on the whole state object, NOT on state.currentPlayer. Both hooks hand back a fresh
  // GameState per committed move, so this fires exactly once per turn that actually commits.
  //
  // currentPlayer was wrong because it does not always change between consecutive turns:
  // advanceTurn skips seats with empty hands, so once you are the last player holding cards it
  // walks all the way round and lands back on you - the value is identical, the effect never
  // re-runs, and none of this per-turn state gets cleared. stealCommit surviving that way left a
  // whole hand inert (the hand is interactive only while stealCommit is null), so every card read
  // as "no legal moves" on a turn the player could legally act.
  useEffect(() => {
    setSelectedCardId(null);
    // A commit only ever spans one turn: by the time the turn has moved on, the steal has either
    // played out or been finished by the server's turn clock, and either way state.lastPlayedCard
    // has taken over from pendingLaidCard below.
    setStealCommit(null);
    setIncomingCard(null);
  }, [state]);

  useEffect(() => {
    if (dealtRoundRef.current === state.roundIndex) return;
    if (!containerRef.current || !handPanelRef.current || containerSize.width === 0) return;
    dealtRoundRef.current = state.roundIndex;
    const geo = boardGeometryFor(state.config, containerSize, viewerSeat);
    const containerRect = containerRef.current.getBoundingClientRect();
    const deckPoint = drawPileCenter(geo);
    const handRect = handPanelRef.current.getBoundingClientRect();
    setDealPlan({
      // mySeat, not state.currentPlayer: this effect fires for every client on every new round
      // (a deal is round-based, not turn-based), and currentPlayer is whoever happens to open
      // the round, which is only sometimes "my" seat. Using it here flew and flipped-to-reveal a
      // DIFFERENT player's real hand on screen before the real HandPanel replaced it - a genuine
      // card-visibility leak online, not just a visual glitch.
      cards: state.hands[mySeat],
      from: { x: containerRect.left + deckPoint.x, y: containerRect.top + deckPoint.y },
      to: { x: handRect.left, y: handRect.top + handRect.height / 2 + HAND_CARDS_CENTER_OFFSET, width: handRect.width },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, containerSize]);

  // Who, if anyone, is currently menacing this hand. The pre-steal warning and the steal itself
  // are one continuous signal in the same player's color, so they resolve to a single value here
  // rather than two independent bits of UI that happen to overlap.
  const threatBy = stealIntent?.target === mySeat ? stealIntent.by : null;
  const alertSeat = stealPresentation?.thief ?? threatBy;
  // Holds the last alert color for a moment after the threat ends, so the hand's dither doesn't
  // snap back to the viewer's own color midway through its fade-out - the same class of problem
  // as the app-wide background's, documented above: a color that changes while a crossfade is
  // still running is visible as a flash, not a fade.
  const [fadingAlertSeat, setFadingAlertSeat] = useState<PlayerId | null>(null);
  useEffect(() => {
    if (alertSeat !== null) {
      setFadingAlertSeat(alertSeat);
      return undefined;
    }
    if (fadingAlertSeat === null) return undefined;
    const timer = setTimeout(() => setFadingAlertSeat(null), ALERT_FADE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [alertSeat, fadingAlertSeat]);
  // Your own turn always wins the hand panel back - it is the "you're up" signal, and it can
  // legitimately arrive while the steal presentation is still playing out (the turn advances
  // server-side the instant the steal commits, and the presentation runs for ~2s after).
  const handDitherSeat = isMyTurn ? mySeat : (alertSeat ?? fadingAlertSeat ?? mySeat);

  const stealAnnouncement = stealPresentation
    ? `${playerLabel(playerNames, stealPresentation.thief)} took your ${stealPresentation.card.rank}.`
    : threatBy !== null
      ? `${playerLabel(playerNames, threatBy)} is about to take a card from your hand.`
      : '';

  // A committed steal's card belongs on the pile immediately, before its move is sent: the thief
  // knows it from their own stealCommit, everyone else from the broadcast. Both resolve to the
  // same card, and once the move lands state.lastPlayedCard IS that card - so the handover is a
  // no-op: same id, same key, no remount, no second pop-in.
  const pendingLaidCard = stealCommit?.card ?? stealIntent?.card ?? null;
  const laidCard = pendingLaidCard ?? state.lastPlayedCard;
  // The same card seen from the other side: one that is on the pile but still listed in
  // someone's hand has to stop being counted in their stack. Only stealIntent feeds this -
  // OpponentHandCounts never renders the viewer's own seat, and stealCommit is always about this
  // client's own hand.
  const spentCard = stealIntent ? { seat: stealIntent.by, cardId: stealIntent.card.id } : null;
  // Held open only until the real card lands in the hand - at that point the hand provides the
  // slot, and a second one would leave a gap hanging off the end. Checking the hand rather than
  // clearing on a timer means this is right whether the move commits instantly (hotseat) or a
  // round-trip later (online).
  const incomingSlotWidth = incomingCard && !state.hands[mySeat].some((c) => c.id === incomingCard.id)
    ? handCardWidthFor(containerSize.width)
    : null;

  const lastMoveAnnouncement =
    state.lastPlayedCard && state.lastPlayedBy !== null
      ? `${playerLabel(playerNames, state.lastPlayedBy)} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';
  // Announces whose turn it now is, not just what was played. This matters most online, where the
  // board overlay silently mounts or unmounts on isMyTurn with no other cue for a screen reader
  // user that the board just became (or stopped being) interactive.
  const turnAnnouncement = state.phase === 'gameEnd'
    ? ''
    : isMyTurn ? "It's your turn." : `Waiting for ${playerLabel(playerNames, state.currentPlayer)}.`;

  // The win screen is position:fixed over the whole viewport with no focus trap, so an emote HUD
  // left mounted underneath it would be invisible but still tabbable - a focused control
  // completely hidden behind an overlay. Emotes end with the game rather than being reachable
  // through it.
  const emotesEnabled = onEmote !== undefined && state.phase !== 'gameEnd';
  const visibleEmotes = emotesMuted ? [] : (emotes ?? []);
  // Your own emotes are skipped: you pressed the button, and every announcement here competes for
  // the same polite queue as the turn narration. Names are user-authored, so they are capped - a
  // 200-character display name is a denial of service on a screen reader.
  const announcedEmotes = visibleEmotes.filter((e) => e.by !== mySeat);

  const selectedCard = state.hands[state.currentPlayer].find((c) => c.id === selectedCardId) ?? null;

  const startCardFlight = (card: Card) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
    const containerEl = containerRef.current;
    if (!cardEl || !containerEl || containerSize.width === 0) return;
    const fromRect = cardEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const dest = discardPileCenter(boardGeometryFor(state.config, containerSize, viewerSeat));
    setFlight({
      card,
      from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
      to: { x: containerRect.left + dest.x, y: containerRect.top + dest.y },
    });
  };

  // Fires when the player picks whose hand to reach into, ahead of the blind position and so
  // ahead of the move itself. That tap spends the card, so everything that would normally happen
  // at play time happens here: the card flies out of the hand, lands on the discard pile (locally
  // via stealCommit, and on every other client via the broadcast), and the hand stops accepting
  // input.
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

  // Detects "a hand just lost a card its owner didn't play". The only move that can do that to
  // someone else's hand is a steal (see applyMove - every other kind either doesn't touch hands
  // or only removes the ACTING player's own card). Runs on every client and branches on who is
  // watching: the victim gets the full marked-card presentation below, everyone else gets a
  // face-down card crossing from one stack to the other. The thief's own client returns early -
  // StealCardOverlay already ran the reveal flight there before the move was sent.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;
    // A round boundary re-deals every hand at once, which would otherwise read as every seat
    // being robbed simultaneously.
    if (prev.roundIndex !== state.roundIndex) return;
    const thief = prev.currentPlayer;
    if (thief === mySeat) return;
    // The acting player's own hand always shrinks (they played a card), so they are excluded from
    // the search rather than special-cased afterwards - a steal nets them zero anyway.
    const victim = activePlayerIds(state.config)
      .find((p) => p !== thief && state.hands[p].length < prev.hands[p].length);
    if (victim === undefined) return;

    const containerEl = containerRef.current;
    if (!containerEl || containerSize.width === 0) return;
    const geo = boardGeometryFor(state.config, containerSize, viewerSeat);
    const containerRect = containerEl.getBoundingClientRect();
    const thiefFan = handCountPoint(state.config, thief, geo);
    const destination = { x: containerRect.left + thiefFan.x, y: containerRect.top + thiefFan.y };

    if (victim !== mySeat) {
      const victimFan = handCountPoint(state.config, victim, geo);
      const height = THIRD_PARTY_CARD_WIDTH * 7 / 5; // .playing-card's own 5/7 aspect ratio
      setTransfer({
        toSeat: thief,
        plan: {
          // Face down on purpose: an onlooker seeing the rank would leak a card neither of the
          // two players involved has shown them (the victim knows it because it was theirs, the
          // thief because they now hold it).
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
    // rendered in place so it can be marked where the player last saw it; the effect below takes
    // over once that beat is done.
    setStealPresentation({ thief, card: prev.hands[mySeat][index], index, stage: 'marked' });
  }, [state, mySeat, viewerSeat, containerSize, colors]);

  // Second beat of the victim's presentation: the marked card leaves the hand and crosses to the
  // thief's own stack. Measured off the ghost's live DOM node rather than a computed position, so
  // it departs from exactly where the player has been looking at it.
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
      const geo = boardGeometryFor(state.config, containerSize, viewerSeat);
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
      // Drops the ghost in the same tick the flying clone appears, so the card is never visibly
      // in two places at once - the same two-elements-one-motion handoff FlyingCard relies on.
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
        {/* role="img" is scoped to the Phaser canvas alone, NOT the whole board area. `img` is a
            children-presentational role: everything inside it is pruned from the accessibility
            tree, so while this label sat on the container it silently swallowed every real
            control positioned over the canvas - the move buttons, "Lay down cards", the emote
            picker - leaving a screen reader one flat "Game board, image" node and no way to
            play. The canvas gets its own mount element; the DOM layer stays a sibling of it,
            sharing the container's coordinate system exactly as before. */}
        <div
          ref={canvasMountRef}
          className="board-canvas"
          role="img"
          aria-label={`Game board. ${playerLabel(playerNames, state.currentPlayer)}'s turn.`}
        />
        {/* Straight after the canvas and before every game overlay, on purpose. The emote HUD is
            chrome, not play: it has to sit in front of the board art but behind anything the
            player acts on, so a rank picker, steal overlay or move target can never end up
            underneath it. ORDERING, not z-index, is what enforces that - these carry z-index
            20/30 and so paint over .board-overlay (which has none of its own) wherever they sit
            in the DOM, which is exactly how the Joker picker once ended up trapped under the
            emote button. Anything with an explicit z-index further down this tree stays above
            them for free. */}
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
      </div>
      {/* Board changes are narrated from here, not by the canvas - the canvas has no way to
          expose them to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {stealAnnouncement} {lastMoveAnnouncement} {turnAnnouncement}
      </p>
      {/* Emotes get their own region rather than joining the line above. That line is five text
          nodes (three expressions plus the two literal spaces), and with the default
          aria-atomic="false" only the node that actually changed is re-announced - which is why
          the three sentences are kept as separate expressions and must NOT be collapsed into one
          template literal. Even so, an emote joining them would be a fourth thing competing for
          that region on every arrival. role="log" is
          append-only by definition (aria-relevant defaults to additions, so the expiries are
          silent) and NOT implicitly atomic the way role="status" is, which would re-read all
          four lines on each arrival. aria-live is set alongside the role because VoiceOver's
          support for bare role="log" is unreliable. Two polite regions serialize rather than
          interrupt each other. Rendered whether or not there is anything in it: a live region
          only announces mutations observed after it is in the DOM, so one mounted on its first
          message never announces that message. */}
      {emotesEnabled && (
        <div role="log" aria-live="polite" className="visually-hidden">
          {announcedEmotes.map((entry) => (
            <span key={entry.id}>{`${playerLabel(playerNames, entry.by).slice(0, 20)}: ${emoteById(entry.emoteId)?.label ?? ''}. `}</span>
          ))}
        </div>
      )}
      <div ref={handPanelRef} className="hand-panel-slot">
        {/* The same vivid dither as the menu background, tinted to your own seat color - the
            app-wide background behind the board keeps the calmer single-tone look, so this is a
            second independent PixelDither instance rather than a change to the shared one.
            Deliberately OUTSIDE the opacity toggle below: inside it, the plainer app-wide
            background showed through here for the whole deal animation and only switched once
            the deal finished, reading as the old background hanging around during a load.
            visible follows the app-wide background's own rule - your seat color only lights up
            the hand while you are acting, so online the panel reads as inert on other players'
            turns instead of implying an interactive hand. A crossfade rather than unmounting, so
            the dither's animation phase doesn't reset each turn. Always true in local hotseat. */}
        <PixelDither vivid visible={isMyTurn || alertSeat !== null} color={hueToCss(colors[handDitherSeat])} className="hand-panel__background" />
        <div style={{ opacity: dealPlan ? 0 : 1 }}>
          {/* One line, one message - the alert takes the turn label's exact position, so they
              can't both render. */}
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
            // A committed steal locks the hand: the card is already spent and on the pile, so
            // letting another be selected would offer a way out of an irreversible decision.
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
