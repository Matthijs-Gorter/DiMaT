import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { assignNumbers, balanceResources, placeHarbors, scaleResourceCounts, scaleTokens } from '../src/balance.js';
import { key, neighbor } from '../src/hex.js';
import { vertexKey } from '../src/build-board.js';
import { discMap } from './fixtures.js';

describe('resource and token scaling', () => {
  it('matches the 19-tile base distribution and scales totals exactly', () => {
    expect(scaleResourceCounts(19, 4)).toEqual({ brick: 3, lumber: 4, wool: 4, grain: 4, ore: 3, desert: 1 });
    expect(scaleResourceCounts(30, 5)).toEqual({ brick: 5, lumber: 6, wool: 6, grain: 6, ore: 5, desert: 2 });
    for (let count = 12; count <= 60; count++) {
      expect(Object.values(scaleResourceCounts(count, 4)).reduce((sum, value) => sum + value, 0)).toBe(count);
      expect(scaleTokens(count - scaleResourceCounts(count, 4).desert))
        .toHaveLength(count - scaleResourceCounts(count, 4).desert);
    }
  });

  it('scales the pip distribution with deterministic largest remainders', () => {
    expect(scaleTokens(18)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(scaleTokens(28)).toHaveLength(28);
    expect(scaleTokens(28)).toEqual(scaleTokens(28));
  });
});

describe('number and terrain balancing', () => {
  it('assigns the scaled number tokens without adjacent red numbers for many seeds', () => {
    const tiles = discMap(2).tiles;
    for (let seed = 0; seed < 1000; seed++) {
      const balanced = assignNumbers(tiles, new Rng(seed + 1));
      const byPosition = new Map(balanced.map(tile => [`${tile.q},${tile.r}`, tile]));
      for (const tile of balanced) {
        if (tile.number !== 6 && tile.number !== 8) continue;
        for (const side of [0, 1, 2]) {
          const adjacent = byPosition.get(key(neighbor(tile, side)));
          expect(adjacent?.number === 6 || adjacent?.number === 8).toBe(false);
        }
      }
    }
  });

  it('balances resource adjacency without changing the resource inventory', () => {
    const tiles = discMap(2).tiles;
    const first = balanceResources(tiles, new Rng(17));
    const second = balanceResources(tiles, new Rng(17));
    const counts = (items: typeof tiles) => items.reduce<Record<string, number>>((result, tile) => {
      result[tile.kind] = (result[tile.kind] ?? 0) + 1;
      return result;
    }, {});
    expect(first).toEqual(second);
    expect(counts(first)).toEqual(counts(tiles));
  });
});

describe('harbor placement', () => {
  it('places spaced harbors on the outer coast without shared vertices', () => {
    const map = placeHarbors(discMap(2), new Rng(29), 4);
    expect(map.harbors).toHaveLength(9);
    const occupied = map.harbors.flatMap(harbor => [harbor.side, (harbor.side + 1) % 6]
      .map(corner => vertexKey(harbor.tile.q, harbor.tile.r, corner)));
    expect(new Set(occupied).size).toBe(occupied.length);
  });

  it('does not place harbors on a small interior lake coast', () => {
    const base = discMap(2);
    const lake = {
      ...base,
      tiles: base.tiles.map(tile => tile.q === 0 && tile.r === 0
        ? { ...tile, kind: 'water' as const, number: null }
        : tile)
    };
    const map = placeHarbors(lake, new Rng(8), 4);
    expect(map.harbors.some(harbor => key(neighbor(harbor.tile, harbor.side)) === '0,0')).toBe(false);
  });
});
