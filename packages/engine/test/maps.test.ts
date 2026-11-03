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

  it('rejects maps that do not support the room player count or violate validation', () => {
    const map = generateMap({ style: 'standard', seed: 1, players: 3, balance: 'random' });
    expect(() => createGame(73, { playerCount: 4, map })).toThrow(/does not support 4 players/);
    const invalid = structuredClone(map);
    invalid.tiles[0]!.number = 1;
    expect(() => createGame(73, { playerCount: 3, map: invalid })).toThrow(/is invalid/);
  });
});
