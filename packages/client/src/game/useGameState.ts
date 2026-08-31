// Local hotseat game state: the engine runs in-process and this hook owns the GameState.
// Its online counterpart is useOnlineGameState.ts, which exposes the same shape but sends
// intents to the server instead of mutating anything locally.

import { useCallback, useRef, useState } from 'react';
import {
  advanceTurn, applyMove, createInitialState, passHand, startGame,
} from '@crazypixel/shared';
import type { GameConfig, GameState, Move, PlayerId } from '@crazypixel/shared';
import { planTurn, planCaptures, EMPTY_TURN_ANIMATION } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

function newGame(config: GameConfig): GameState {
  const state = createInitialState(config);
  startGame(state);
  return state;
}

/**
 * The engine mutates GameState in place by design, but React 18 StrictMode double-invokes a
 * functional setState updater with the *same* previous-state object both times. Mutating it
 * directly meant the second invocation ran against already-mutated state: passHand advanced
 * the turn twice, applyMove applied the same move twice. Cloning first keeps the two
 * invocations independent, which is what makes the updater actually pure.
 */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    marbles: state.marbles.map((m) => ({ ...m, location: { ...m.location } })),
    hands: {
      0: [...state.hands[0]],
      1: [...state.hands[1]],
      2: [...state.hands[2]],
      3: [...state.hands[3]],
      4: [...state.hands[4]],
      5: [...state.hands[5]],
    },
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
  };
}

export function useGameState(config: GameConfig) {
  const [state, setState] = useState<GameState>(() => newGame(config));
  // A side-channel rather than React state: TableScene needs to know *how* each marble moved
  // (walk a path vs. teleport), computed against the pre-move state before applyMove touches
  // anything. A ref because it's read once synchronously right after the state update
  // commits (see GameBoard.tsx), not something that should trigger its own render. Safe
  // under StrictMode's double-invoke - planning only reads.
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);

  const play = useCallback((player: PlayerId, move: Move) => {
    setState((prev) => {
      const plan = planTurn(prev, move);
      const next = cloneState(prev);
      applyMove(next, player, move);
      // Needs the post-move state (who ended up in kennel), so it can't fold into planTurn,
      // which only ever sees the pre-move snapshot.
      plan.capturedMarbleIds = planCaptures(prev, next);
      lastPlanRef.current = plan;
      advanceTurn(next);
      return next;
    });
  }, []);

  const passCurrentHand = useCallback(() => {
    setState((prev) => {
      lastPlanRef.current = EMPTY_TURN_ANIMATION;
      const next = cloneState(prev);
      passHand(next, next.currentPlayer);
      advanceTurn(next);
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    lastPlanRef.current = EMPTY_TURN_ANIMATION;
    setState(newGame(config));
  }, [config]);

  return { state, play, passCurrentHand, restart, lastPlanRef };
}
