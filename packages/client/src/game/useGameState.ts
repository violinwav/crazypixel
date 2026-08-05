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

// @crazypixel/shared's engine mutates GameState in place by design (see GameEngine.ts) -
// fine for its primary use case, but React 18 StrictMode double-invokes a functional
// setState updater with the *same* previous-state object both times (to help catch
// impure updaters). Mutating that shared object directly meant the second invocation ran
// against already-mutated state: passHand+advanceTurn silently advanced the turn twice,
// applyMove+advanceTurn silently applied the same move twice. Cloning before mutating
// keeps the two StrictMode invocations independent (same input in, same output out),
// which is what makes the updater actually pure.
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
  // Side-channel, not React state: TableScene needs to know *how* each marble moved (walk
  // a path vs. teleport) to animate it, computed against the pre-move state before
  // applyMove touches anything. A ref (not state) because it's read once synchronously
  // right after the state update commits (see App.tsx), not something that should trigger
  // its own render. Safe to recompute on StrictMode's double-invoke same as the state
  // update itself - planAnimation only reads, so calling it twice on equivalent input is
  // harmless (unlike mutating, which was the actual bug - see cloneState above).
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);

  const play = useCallback((player: PlayerId, move: Move) => {
    setState((prev) => {
      const plan = planTurn(prev, move);
      const next = cloneState(prev);
      applyMove(next, player, move);
      // Needs the post-move state too (who actually ended up in kennel), so this can't be
      // folded into planTurn above, which only ever sees the pre-move snapshot.
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
