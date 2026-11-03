import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/generate.js';
import { validateMap } from '../src/validate.js';
import type { TerrainStyle } from '../src/generators.js';

const STYLES: TerrainStyle[] = ['standard', 'continent', 'archipelago', 'river', 'lakes', 'atoll', 'irregular', 'random'];

describe('generateMap', () => {
  it('is byte-deterministic for identical style, seed, options and players', () => {
    const options = { style: 'river' as const, seed: 551, players: 4 as const, balance: 'random' as const, landTarget: 24 };
    expect(JSON.stringify(generateMap(options))).toBe(JSON.stringify(generateMap(options)));
  });

  it('returns validated maps across styles, player counts and 200 seeds', () => {
    for (const style of STYLES) for (let players = 3; players <= 8; players++) for (let seed = 1; seed <= 200; seed++) {
      const map = generateMap({ style, seed, players: players as 3 | 4 | 5 | 6 | 7 | 8, balance: 'random' });
      expect(validateMap(map, { balance: 'random', players }).errors, `${style}, ${players} players, seed ${seed}`).toEqual([]);
      expect(map.tiles.filter(tile => tile.kind !== 'water').length + map.tiles.filter(tile => tile.kind === 'water').length).toBe(map.tiles.length);
      expect(map.meta.generatorVersion).toBe(1);
      expect(map.meta.attempts).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it('tries balanced-map fairness checks when requested', () => {
    const map = generateMap({ style: 'standard', seed: 99, players: 3, balance: 'balanced' });
    expect(validateMap(map, { balance: 'balanced', players: 3 }).errors).toEqual([]);
  });

  it('generates and validates a map with two configured river cuts', () => {
    const map = generateMap({ style: 'river', seed: 551, players: 4, landTarget: 30, riverCount: 2, balance: 'random' });
    expect(map.rivers.length).toBeGreaterThan(1);
    expect(map.meta.options?.riverCount).toBe(2);
    expect(validateMap(map, { balance: 'random', players: 4 }).errors).toEqual([]);
  });
});
