import { describe, expect, it } from 'vitest';
import { DIRECTIONS, connectedComponents, disc, distance, fromOffsetOddR, key, neighbor, neighbors, oppositeSide, ring, toCube, toOffsetOddR } from '../src/hex.js';

describe('hex math', () => {
  it('has six distinct neighbours at distance 1, and reciprocal sides', () => {
    const origin = { q: 3, r: -2 };
    expect(new Set(neighbors(origin).map(key)).size).toBe(6);
    DIRECTIONS.forEach((_, side) => {
      const n = neighbor(origin, side);
      expect(distance(origin, n)).toBe(1);
      expect(neighbor(n, oppositeSide(side))).toEqual(origin);
    });
  });
  it('is a symmetric distance', () => {
    const a = { q: -3, r: 4 }, b = { q: 2, r: -1 };
    expect(distance(a, b)).toBe(distance(b, a));
    expect(distance(a, a)).toBe(0);
  });
  it('converts axial coordinates to cube coordinates', () => {
    expect(toCube({ q: 4, r: -7 })).toEqual({ x: 4, y: 3, z: -7 });
    expect(toCube({ q: 0, r: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('builds rings and discs of the right size, order and radius', () => {
    for (let radius = 0; radius <= 6; radius++) {
      const tiles = disc({ q: 0, r: 0 }, radius);
      expect(tiles.length).toBe(1 + 3 * radius * (radius + 1));
      expect(new Set(tiles.map(key)).size).toBe(tiles.length);
      for (let i = 1; i < tiles.length; i++) expect(tiles[i - 1]!.r < tiles[i]!.r || (tiles[i - 1]!.r === tiles[i]!.r && tiles[i - 1]!.q < tiles[i]!.q)).toBe(true);
      const edgeRing = ring({ q: 0, r: 0 }, radius);
      expect(edgeRing.length).toBe(radius === 0 ? 1 : 6 * radius);
      expect(new Set(edgeRing.map(key)).size).toBe(edgeRing.length);
      for (const tile of edgeRing) expect(distance({ q: 0, r: 0 }, tile)).toBe(radius);
      // ring is a closed walk: consecutive tiles touch
      for (let i = 0; i < edgeRing.length && radius > 0; i++) expect(distance(edgeRing[i]!, edgeRing[(i + 1) % edgeRing.length]!)).toBe(1);
    }
    expect(() => ring({ q: 0, r: 0 }, -1)).toThrow(RangeError);
    expect(() => ring({ q: 0, r: 0 }, 1.5)).toThrow(RangeError);
    expect(() => disc({ q: 0, r: 0 }, -1)).toThrow(RangeError);
    expect(() => disc({ q: 0, r: 0 }, 1.5)).toThrow(RangeError);
  });
  it('round-trips odd-r offset coordinates', () => {
    for (let row = -5; row <= 5; row++) for (let col = -5; col <= 5; col++) {
      const axial = fromOffsetOddR(col, row);
      expect(toOffsetOddR(axial)).toEqual({ col, row });
    }
  });
  it('finds components sorted by size, and honours blocked sides', () => {
    const tiles = [...disc({ q: 0, r: 0 }, 1), { q: 5, r: 5 }, { q: 6, r: 5 }];
    const components = connectedComponents(tiles);
    expect(components.map(c => c.length)).toEqual([7, 2]);
    // block every step across the east side of the centre: centre still connects through other sides
    expect(connectedComponents(tiles, (a, side) => side === 0 && a.q === 0 && a.r === 0).map(c => c.length)).toEqual([7, 2]);
    // blocking all six sides of the centre isolates it only if neighbours also refuse: block both directions
    const wall = connectedComponents(tiles, (a, side) => key(a) === '0,0' || key(neighbor(a, side)) === '0,0');
    expect(wall.map(c => c.length).sort((x, y) => y - x)).toEqual([6, 2, 1]);
  });
});
