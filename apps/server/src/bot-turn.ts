import type { GameState } from '@dimat/engine';

/** The actor that must decide next; a seven can require discards from players other than the active turn owner. */
export function decisionActorIndex(state: Pick<GameState, 'phase' | 'activePlayer' | 'pendingDiscards'>): number | null {
  if (state.phase === 'discard') return state.pendingDiscards[0] ?? null;
  if (state.phase === 'finished') return null;
  return state.activePlayer;
}
