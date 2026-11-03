import { describe, expect, it } from 'vitest';
import { generateMap } from '@dimat/maps';
import { apply, createGame, legalActions, replayGame } from '../src/index.js';

describe('engine map settings', () => {
  it('builds and replays a validated map from stored game settings', () => {
    const map = generateMap({ style: 'standard', seed: 1, players: 3, balance: 'random' });
    const state = createGame(73, { playerCount: 3, map });
    const action = legalActions(state, state.players[state.activePlayer]!.id)[0]!;
    const transitioned = apply(state, action).state;
    expect(state.board.tiles).toHaveLength(19);
    expect(state.board.tiles[state.board.desertTile]!.kind).toBe('desert');
    expect(state.settings.map).toEqual(map);
    expect(replayGame({ seed: 73, settings: state.settings, actions: [action] })).toEqual(transitioned);
  });

  it('scales the bank to map land size', () => {
    const map = generateMap({ style: 'irregular', seed: 7, players: 3, landTarget: 50, balance: 'random' });
    const state = createGame(73, { playerCount: 3, map });
    expect(state.bank).toEqual({ brick: 50, lumber: 50, wool: 50, grain: 50, ore: 50 });
  });

  it('honors the saved random-map red-token adjacency preference', () => {
    const map = generateMap({ style: 'random', seed: 8, players: 4, balance: 'random', avoidAdjacentRed: false });
    expect(map.meta.options?.avoidAdjacentRed).toBe(false);
    expect(() => createGame(73, { playerCount: 4, map })).not.toThrow();
  });

  it('supports two through eight participants regardless of map preset metadata', () => {
    const map = generateMap({ style: 'standard', seed: 1, players: 3, balance: 'random' });
    map.players = { min: 3, max: 4 };
    for (const playerCount of [2,3,4,5,6,7,8]) {
      const state = createGame(73, { playerCount, map });
      expect(state.players).toHaveLength(playerCount);
      expect(state.setupOrder).toHaveLength(playerCount * 2);
    }
  });

  it('rejects invalid map data on game initialization', () => {
    const map = generateMap({ style: 'standard', seed: 1, players: 3, balance: 'random' });
    const invalid = structuredClone(map);
    invalid.tiles[0]!.number = 1;
    expect(() => createGame(73, { playerCount: 3, map: invalid })).toThrow(/invalid/);
  });
});
