import { describe, expect, it } from 'vitest';
import { createRoomSchema, mapCodeSchema, mapDefinitionSchema } from '../src/index.js';

const map = {
  schemaVersion: 1,
  id: 'map-1',
  name: 'Test map',
  style: 'custom',
  seed: 1,
  players: { min: 3, max: 4 },
  victoryTarget: 10,
  tiles: [{ q: 0, r: 0, kind: 'desert', number: null, islandId: 0 }],
  harbors: [],
  rivers: [],
  islands: [{ id: 0, tileCount: 1, specialVP: 0 }],
  features: [],
  allowSeparateIslands: false,
  meta: { generatorVersion: 1 }
} as const;

describe('map protocol schemas', () => {
  it('accepts a structurally valid map definition', () => {
    expect(mapDefinitionSchema.safeParse(map).success).toBe(true);
  });

  it('rejects malformed tile coordinates and oversized definitions', () => {
    expect(mapDefinitionSchema.safeParse({ ...map, tiles: [{ ...map.tiles[0], q: 0.5 }] }).success).toBe(false);
    expect(mapDefinitionSchema.safeParse({ ...map, tiles: Array(301).fill(map.tiles[0]) }).success).toBe(false);
  });

  it('accepts only six-character uppercase share codes and optional room map codes', () => {
    expect(mapCodeSchema.safeParse('A2BCDE').success).toBe(true);
    expect(mapCodeSchema.safeParse('abcde').success).toBe(false);
    expect(createRoomSchema.safeParse({ displayName: 'Host', mapCode: 'A2BCDE' }).success).toBe(true);
    expect(createRoomSchema.safeParse({ displayName: 'Host', mapCode: 'bad' }).success).toBe(false);
  });
});
