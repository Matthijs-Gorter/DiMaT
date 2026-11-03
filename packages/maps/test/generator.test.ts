import { describe, expect, it } from 'vitest';
import { connectedComponents, key, neighbor } from '../src/hex.js';
import { cornerPoint } from '../src/build-board.js';
import { Rng } from '../src/rng.js';
import { generateTerrain, type TerrainStyle } from '../src/generators.js';

const CASES: Array<{ style: TerrainStyle; options: Parameters<typeof generateTerrain>[1] }> = [
  { style: 'standard', options: { players: 4 } },
  { style: 'continent', options: { players: 4, landTarget: 22 } },
  { style: 'archipelago', options: { players: 4, landTarget: 22, islandCount: 3 } },
  { style: 'river', options: { players: 4, landTarget: 24 } },
  { style: 'lakes', options: { players: 4, landTarget: 24, lakeCount: 2 } },
  { style: 'atoll', options: { players: 4, landTarget: 19 } },
  { style: 'irregular', options: { players: 4, landTarget: 50 } },
  { style: 'random', options: { players: 4, landTarget: 24 } }
];

describe('terrain generators', () => {
  for (const { style, options } of CASES) {
    it(`generates deterministic valid ${style} terrain for 200 seeds`, () => {
      for (let seed = 0; seed < 200; seed++) {
        const first = generateTerrain(style, options, new Rng(seed + 1));
        const second = generateTerrain(style, options, new Rng(seed + 1));
        expect(first).toEqual(second);
        expect(first.land).toHaveLength(options.landTarget ?? 19);
        expect(new Set(first.land.map(key)).size).toBe(first.land.length);
        expect(first.land.every(tile => Number.isInteger(tile.q) && Number.isInteger(tile.r))).toBe(true);
      }
    });
  }

  it('uses the fixed standard board sizes for every supported player count', () => {
    for (const [players, count] of [[3, 19], [4, 19], [5, 30], [6, 30], [7, 44], [8, 44]] as const) {
      expect(generateTerrain('standard', { players }, new Rng(42)).land).toHaveLength(count);
    }
  });

  it('generates every terrain style for 200 seeds at each supported player count', () => {
    const styles: TerrainStyle[] = ['standard', 'continent', 'archipelago', 'river', 'lakes', 'atoll', 'irregular', 'random'];
    for (const style of styles) for (let players = 3; players <= 8; players++) for (let seed = 0; seed < 200; seed++) {
      const terrain = generateTerrain(style, { players }, new Rng(seed + 1));
      expect(terrain.land.length).toBeGreaterThan(0);
      expect(new Set(terrain.land.map(key)).size).toBe(terrain.land.length);
      if (style === 'standard') expect(terrain.land.length).toBe(players <= 4 ? 19 : players <= 6 ? 30 : 44);
      if (style === 'irregular') expect(terrain.land.length).toBeGreaterThanOrEqual(50);
    }
  }, 30_000);

  it('makes archipelago landmasses separate and rivers divide land regions', () => {
    const archipelago = generateTerrain('archipelago', { players: 4, landTarget: 24, islandCount: 4 }, new Rng(15));
    expect(connectedComponents(archipelago.land).length).toBe(4);
    const river = generateTerrain('river', { players: 4, landTarget: 24 }, new Rng(15));
    expect(river.rivers.length).toBeGreaterThan(0);
    expect(new Set(river.rivers.map(edge => `${key(edge.tile)}:${edge.side}`)).size).toBe(river.rivers.length);
  });

  it('can grow a tributary from the main river while preserving its land split', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const terrain = generateTerrain('river', { players: 4, landTarget: 30, riverCount: 2 }, new Rng(seed));
      const riverKeys = new Set(terrain.rivers.map(edge => `${key(edge.tile)}:${edge.side}`));
      const degrees = new Map<string, number>();
      for (const edge of terrain.rivers) for (const vertex of [cornerPoint(edge.tile.q, edge.tile.r, edge.side), cornerPoint(edge.tile.q, edge.tile.r, (edge.side + 1) % 6)]) {
        const vertexKey = vertex.join(',');
        degrees.set(vertexKey, (degrees.get(vertexKey) ?? 0) + 1);
      }
      const regions = connectedComponents(terrain.land, (tile, side) =>
        riverKeys.has(`${key(tile)}:${side}`) || riverKeys.has(`${key(neighbor(tile, side))}:${(side + 3) % 6}`)
      );
      expect(terrain.rivers.length).toBeGreaterThan(1);
      expect(riverKeys.size).toBe(terrain.rivers.length);
      expect(regions.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...degrees.values())).toBeGreaterThanOrEqual(3);
    }
  });

  it('adds explicit interior water for lakes and atoll lagoons', () => {
    const lake = generateTerrain('lakes', { players: 4, landTarget: 24, lakeCount: 2 }, new Rng(5));
    const atoll = generateTerrain('atoll', { players: 4, landTarget: 19 }, new Rng(5));
    expect(lake.water.length).toBeGreaterThanOrEqual(1);
    expect(atoll.water.length).toBeGreaterThan(0);
    expect(lake.land.some(tile => lake.water.some(water => key(tile) === key(water)))).toBe(false);
  });
});
