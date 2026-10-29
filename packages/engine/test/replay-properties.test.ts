import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cardCounts, createGame, replayGame, resourceTotal, RESOURCES, viewFor } from '../src/index.js';
import { assertInvariant, simulateGame } from '../../../scripts/sim.js';

describe('determinism and hidden information',()=>{
  it('replays an action log to the identical final state',()=>{
    const {state,actions}=simulateGame(73,3);const replayed=replayGame({seed:73,settings:{playerCount:3,victoryTarget:10},actions});expect(replayed).toEqual(state);
  });
  it('does not expose another player hand or development-card identities',()=>{
    const s=createGame(1);s.players[1]!.resources={brick:2,lumber:3,wool:4,grain:0,ore:1};s.players[1]!.devCards=[{kind:'monopoly',boughtTurn:0}];const view=viewFor(s,'p0');expect(view.players[1]).not.toHaveProperty('resources');expect(view.players[1]).not.toHaveProperty('devCards');expect(view.players[1]).not.toHaveProperty('developmentCards');expect(view.players[1]!.resourceCount).toBe(10);expect(view.players[1]!.developmentCardCount).toBe(1);expect(view.bank).toEqual(s.bank);expect(view.developmentCardsRemaining).toBe(25);expect(JSON.stringify(view)).not.toContain('monopoly');
  });
  it('keeps initial inventory and deterministic boards across arbitrary seeds',()=>{
    fc.assert(fc.property(fc.integer(),seed=>{
      const a=createGame(seed),b=createGame(seed);expect(a.board).toEqual(b.board);expect(a.rngState).toBe(b.rngState);expect(a.board.tiles).toHaveLength(19);expect(a.board.vertices).toHaveLength(54);expect(a.board.edges).toHaveLength(72);
      for(const resource of RESOURCES)expect(resourceTotal(a,resource)).toBe(19);
      expect(cardCounts(a)).toEqual({knight:14,victoryPoint:5,roadBuilding:2,yearOfPlenty:2,monopoly:2});
    }),{numRuns:100});
  });
  it('preserves invariants through full random-bot games for arbitrary seeds',()=>{
    fc.assert(fc.property(fc.integer(),seed=>{const result=simulateGame(seed,3);assertInvariant(result.state);expect(result.state.phase).toBe('finished');}),{numRuns:5});
  },30000);
});
