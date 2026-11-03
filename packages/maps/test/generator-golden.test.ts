import { describe, expect, it } from 'vitest';
import { generateMap, GENERATOR_VERSION } from '../src/generate.js';
import { evaluateMapQuality } from '../src/quality.js';
import { scaleResourceCounts } from '../src/balance.js';
import type { TerrainStyle } from '../src/generators.js';

const STYLES: TerrainStyle[] = ['standard', 'continent', 'archipelago', 'river', 'lakes', 'atoll', 'irregular', 'random'];

function hash(value: string): string {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

describe(`generator version ${GENERATOR_VERSION} representative seeds`, () => {
  it('pins a generated map signature for every style', () => {
    const signatures = Object.fromEntries(STYLES.map(style => {
      const map = generateMap({ style, seed: 42, players: 4, balance: 'balanced' });
      return [style, hash(JSON.stringify(map))];
    }));
    expect(signatures).toMatchSnapshot();
  });

  it('makes random mode seed-sensitive and stores the relaxed red-token option', () => {
    const first = generateMap({ style: 'random', seed: 41, players: 4, balance: 'random', avoidAdjacentRed: false });
    const second = generateMap({ style: 'random', seed: 42, players: 4, balance: 'random', avoidAdjacentRed: false });
    expect(first).not.toEqual(second);
    expect(first.meta.generatorVersion).toBe(GENERATOR_VERSION);
    expect(first.meta.options?.avoidAdjacentRed).toBe(false);
    const expected = scaleResourceCounts(first.tiles.filter(tile => tile.kind !== 'water').length, 4);
    const actual = evaluateMapQuality(first).resourceTileCounts;
    expect([actual.brick, actual.lumber, actual.wool, actual.grain, actual.ore]).not.toEqual(
      [expected.brick, expected.lumber, expected.wool, expected.grain, expected.ore]
    );
  });
});
