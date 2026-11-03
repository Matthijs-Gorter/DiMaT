import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/build-board.js';
import { getBeginnerMap } from '../src/beginner.js';
import { generateMap } from '../src/generate.js';
import { evaluateMapQuality } from '../src/quality.js';
import { validateMap } from '../src/validate.js';

describe('map quality and fixed beginner board', () => {
  it('counts every legal two-settlement pair using the distance rule', () => {
    const map = generateMap({ style: 'standard', seed: 23, players: 4, balance: 'balanced' });
    const vertices = buildBoard(map).vertices;
    let combinations = 0;
    for (let first = 0; first < vertices.length; first++) for (let second = first + 1; second < vertices.length; second++) {
      if (!vertices[first]!.edges.some(edge => vertices[second]!.edges.includes(edge))) combinations++;
    }
    const report = evaluateMapQuality(map);
    expect(report.legalStartingCombinationCount).toBe(combinations);
    expect(report.weakestPosition).not.toBeNull();
    expect(report.strongestPosition?.productionPips).toBeGreaterThanOrEqual(report.weakestPosition!.productionPips);
    expect(report.medianExpectedCardsPerRoll).toBeGreaterThan(0);
    expect(report.resourceDiversityAverage).toBeGreaterThan(0);
    expect(report.settlementBalanceScore).toBeGreaterThanOrEqual(0);
    expect(report.settlementBalanceScore).toBeLessThanOrEqual(100);
  });

  it('reports second-settlement setup cards separately from production potential', () => {
    const map = generateMap({ style: 'standard', seed: 1, players: 3, balance: 'random' });
    const report = evaluateMapQuality(map);
    const position = report.strongestPosition!;
    expect(position.startingCardsBySecondSettlement).toHaveLength(2);
    for (const cardSet of position.startingCardsBySecondSettlement) expect(Object.values(cardSet).reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(3);
    expect(position.expectedCardsPerRoll).toBe(position.productionPips / 36);
  });

  it('checks the requested participant count when reporting setup position capacity', () => {
    const map = generateMap({ style: 'standard', seed: 23, players: 4, balance: 'balanced' });
    const twoPlayers = evaluateMapQuality(map, 2), eightPlayers = evaluateMapQuality(map, 8);
    expect(twoPlayers.requiredSetupPositions).toBe(4);
    expect(eightPlayers.requiredSetupPositions).toBe(16);
    expect(eightPlayers.availableSetupPositions).toBeLessThanOrEqual(16);
    expect(eightPlayers.availableSetupPositions).toBeGreaterThanOrEqual(twoPlayers.availableSetupPositions);
  });

  it('keeps the beginner map fixed, balanced and independent from mutable callers', () => {
    const first = getBeginnerMap(), second = getBeginnerMap();
    first.tiles[0]!.kind = 'desert';
    expect(second.name).toBe('Beginnerskaart');
    expect(second.tiles).toHaveLength(19);
    expect(JSON.stringify(getBeginnerMap())).toBe(JSON.stringify(second));
    expect(validateMap(second, { players: 4, balance: 'balanced' }).errors).toEqual([]);
  });

  it('preserves the beginner map through JSON serialization', () => {
    expect(JSON.parse(JSON.stringify(getBeginnerMap()))).toEqual(getBeginnerMap());
  });
});
