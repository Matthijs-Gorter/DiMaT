import { describe, expect, it } from 'vitest';
import { decisionActorIndex } from '../src/bot-turn.js';

describe('decisionActorIndex', () => {
  it('chooses the first player who still has to discard after a seven', () => {
    expect(decisionActorIndex({ phase: 'discard', activePlayer: 0, pendingDiscards: [2, 3] })).toBe(2);
  });

  it('returns the active player outside the discard phase', () => {
    expect(decisionActorIndex({ phase: 'robber', activePlayer: 1, pendingDiscards: [] })).toBe(1);
  });

  it('returns no actor for a finished game or an empty discard queue', () => {
    expect(decisionActorIndex({ phase: 'finished', activePlayer: 1, pendingDiscards: [] })).toBeNull();
    expect(decisionActorIndex({ phase: 'discard', activePlayer: 1, pendingDiscards: [] })).toBeNull();
  });
});
