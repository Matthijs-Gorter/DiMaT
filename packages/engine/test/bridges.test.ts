import { describe, expect, it } from 'vitest';
import { apply, legalActions, longestRoadLength } from '../src/index.js';
import { connectRoad, placeSetupSettlement, stateAt } from './helpers.js';
import type { GameState } from '../src/types.js';

function riverState(): GameState {
  const state = stateAt('build');
  state.board.vertices = [
    { id: 0, x: 0, y: 0, edges: [0], tiles: [] },
    { id: 1, x: 1, y: 0, edges: [0, 1], tiles: [] },
    { id: 2, x: 2, y: 0, edges: [1], tiles: [] }
  ];
  state.board.edges = [
    { id: 0, vertices: [0, 1], tiles: [], kind: 'land' },
    { id: 1, vertices: [1, 2], tiles: [], kind: 'river' }
  ];
  state.roads = [null, null];
  state.buildings = [null, null, null];
  return state;
}

describe('river bridges', () => {
  it('requires a connected river edge and does not allow ordinary roads on rivers', () => {
    const state = riverState();
    expect(legalActions(state, 'p0').some(action => action.type === 'buildBridge' && action.edge === 1)).toBe(false);
    placeSetupSettlement(state, 0);
    connectRoad(state, 0);
    state.players[0]!.resources = { brick: 2, lumber: 2, wool: 0, grain: 0, ore: 0 };
    const actions = legalActions(state, 'p0');
    expect(actions.some(action => action.type === 'buildRoad' && action.edge === 1)).toBe(false);
    expect(actions.some(action => action.type === 'buildBridge' && action.edge === 1)).toBe(true);
  });

  it('costs two brick and lumber, uses a shared road piece and extends longest road', () => {
    const state = riverState();
    placeSetupSettlement(state, 0);
    connectRoad(state, 0);
    state.players[0]!.resources = { brick: 2, lumber: 2, wool: 0, grain: 0, ore: 0 };
    const action = legalActions(state, 'p0').find(candidate => candidate.type === 'buildBridge' && candidate.edge === 1)!;
    const next = apply(state, action);
    expect(next.state.players[0]!.resources).toMatchObject({ brick: 0, lumber: 0 });
    expect(next.state.players[0]!.roadsLeft).toBe(13);
    expect(next.state.players[0]!.bridgesLeft).toBe(2);
    expect(next.state.roads[1]).toEqual({ owner: 0 });
    expect(longestRoadLength(next.state, 0)).toBe(2);
    expect(next.events).toContainEqual({ type: 'bridgeBuilt', playerId: 'p0', edge: 1 });
  });

  it('enforces the three-bridge component limit', () => {
    const state = riverState();
    placeSetupSettlement(state, 0);
    connectRoad(state, 0);
    state.players[0]!.resources = { brick: 19, lumber: 19, wool: 0, grain: 0, ore: 0 };
    state.players[0]!.bridgesLeft = 0;
    expect(legalActions(state, 'p0').some(action => action.type === 'buildBridge')).toBe(false);
  });
});
