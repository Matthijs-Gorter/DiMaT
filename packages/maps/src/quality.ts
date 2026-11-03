import { vertexKey } from './build-board.js';
import { key, neighbor } from './hex.js';
import { RESOURCES, type MapDefinition, type Resource } from './types.js';
import { scaleResourceCounts } from './balance.js';

const PIPS: Readonly<Record<number, number>> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const RESOURCE_SET = new Set<string>(RESOURCES);

export interface StartingPositionQuality {
  vertices: [string, string];
  expectedCardsPerRoll: number;
  productionPips: number;
  settlementExpectedCardsPerRoll: [number, number];
  settlementBalanceScore: number;
  resourceDiversity: number;
  resourcePips: Record<Resource, number>;
  /** Setup cards paid if the first or the second vertex in `vertices` is placed second. */
  startingCardsBySecondSettlement: [Record<Resource, number>, Record<Resource, number>];
}

export interface MapQualityReport {
  legalStartingCombinationCount: number;
  requiredSetupPositions: number;
  availableSetupPositions: number;
  resourceTileCounts: Record<Resource, number>;
  desertTileCount: number;
  resourceDistributionScore: number;
  settlementBalanceScore: number;
  medianExpectedCardsPerRoll: number;
  lowerDecileExpectedCardsPerRoll: number;
  upperDecileExpectedCardsPerRoll: number;
  resourceDiversityAverage: number;
  fairnessScore: number;
  diversityScore: number;
  overallQualityScore: number;
  weakestPosition: StartingPositionQuality | null;
  strongestPosition: StartingPositionQuality | null;
  warnings: string[];
}

interface Spot {
  id: string;
  neighbors: Set<string>;
  pips: Record<Resource, number>;
  startingCards: Record<Resource, number>;
}

const emptyResources = (): Record<Resource, number> => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * fraction)));
  return values[index]!;
};

/**
 * Evaluate the actual two-settlement placement rule. The combined yield uses the
 * published 2d6 probability distribution (pip weights out of 36); the separate
 * starting-card field reflects the rule that only the second setup settlement
 * pays cards immediately.
 */
export function evaluateMapQuality(definition: MapDefinition, players = definition.players.max): MapQualityReport {
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new RangeError('players must be an integer from 2 to 8');
  const spots = new Map<string, Spot>();
  const tiles = definition.tiles.filter(tile => tile.kind !== 'water');
  const counts = emptyResources();

  for (const tile of tiles) {
    if (RESOURCE_SET.has(tile.kind)) counts[tile.kind as Resource]++;
    const pips = tile.number === null ? 0 : PIPS[tile.number] ?? 0;
    const corners = Array.from({ length: 6 }, (_, corner) => vertexKey(tile.q, tile.r, corner));
    for (let corner = 0; corner < 6; corner++) {
      const id = corners[corner]!;
      const spot = spots.get(id) ?? { id, neighbors: new Set<string>(), pips: emptyResources(), startingCards: emptyResources() };
      if (RESOURCE_SET.has(tile.kind)) {
        const resource = tile.kind as Resource;
        spot.pips[resource] += pips;
        spot.startingCards[resource]++;
      }
      spots.set(id, spot);
    }
    for (let side = 0; side < 6; side++) {
      const first = corners[side]!, second = corners[(side + 1) % 6]!;
      spots.get(first)!.neighbors.add(second);
      spots.get(second)!.neighbors.add(first);
    }
  }

  const candidates = [...spots.values()].sort((a, b) => a.id.localeCompare(b.id));
  const requiredSetupPositions = players * 2;
  const availableSpots: Spot[] = [];
  const rankedSpots = [...candidates].sort((a, b) => {
    const score = (spot: Spot) => RESOURCES.reduce((total, resource) => total + spot.pips[resource], 0) + (RESOURCES.filter(resource => spot.pips[resource] > 0).length >= 3 ? 1 : 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  for (const spot of rankedSpots) {
    if (availableSpots.some(selected => selected.neighbors.has(spot.id))) continue;
    availableSpots.push(spot);
    if (availableSpots.length === requiredSetupPositions) break;
  }
  const positions: StartingPositionQuality[] = [];
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex++) {
    const first = candidates[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex++) {
      const second = candidates[secondIndex]!;
      if (first.neighbors.has(second.id)) continue;
      const resourcePips = emptyResources();
      for (const resource of RESOURCES) resourcePips[resource] = first.pips[resource] + second.pips[resource];
      const productionPips = RESOURCES.reduce((total, resource) => total + resourcePips[resource], 0);
      const firstPips = RESOURCES.reduce((total, resource) => total + first.pips[resource], 0);
      const secondPips = RESOURCES.reduce((total, resource) => total + second.pips[resource], 0);
      positions.push({
        vertices: [first.id, second.id],
        expectedCardsPerRoll: productionPips / 36,
        productionPips,
        settlementExpectedCardsPerRoll: [firstPips / 36, secondPips / 36],
        settlementBalanceScore: Math.round(100 * Math.min(firstPips, secondPips) / Math.max(1, Math.max(firstPips, secondPips))),
        resourceDiversity: RESOURCES.filter(resource => resourcePips[resource] > 0).length,
        resourcePips,
        startingCardsBySecondSettlement: [{ ...first.startingCards }, { ...second.startingCards }]
      });
    }
  }
  positions.sort((a, b) => a.expectedCardsPerRoll - b.expectedCardsPerRoll || a.vertices[0].localeCompare(b.vertices[0]) || a.vertices[1].localeCompare(b.vertices[1]));

  const expected = scaleResourceCounts(Math.max(1, tiles.length), players);
  const desertTileCount = tiles.filter(tile => tile.kind === 'desert').length;
  const absoluteDifference = RESOURCES.reduce((sum, resource) => sum + Math.abs(counts[resource] - expected[resource]), 0) + Math.abs(desertTileCount - expected.desert);
  const resourceDistributionScore = Math.round(100 * Math.max(0, 1 - absoluteDifference / Math.max(1, tiles.length)));
  const yields = positions.map(position => position.expectedCardsPerRoll);
  const lower = percentile(yields, 0.1), median = percentile(yields, 0.5), upper = percentile(yields, 0.9);
  const diversityAverage = positions.length === 0 ? 0 : positions.reduce((sum, position) => sum + position.resourceDiversity, 0) / positions.length;
  const settlementBalanceAverage = positions.length === 0 ? 0 : positions.reduce((sum, position) => sum + position.settlementBalanceScore, 0) / positions.length;
  // Equal weighting keeps the composite transparent; the constituent metrics remain visible.
  const fairnessScore = upper > 0 ? Math.round(100 * lower / upper) : 0;
  const diversityScore = Math.round(100 * diversityAverage / RESOURCES.length);
  const settlementBalanceScore = Math.round(settlementBalanceAverage);
  const overallQualityScore = Math.round((fairnessScore + settlementBalanceScore + diversityScore + resourceDistributionScore) / 4);
  const warnings: string[] = [];
  if (positions.length === 0) warnings.push('No legal pair of starting settlements exists.');
  else {
    if (upper > 0 && lower < upper * 0.5) warnings.push('The weakest legal starting pairs produce less than half the expected resources of the strongest typical pairs.');
    const weak = percentile(yields, 0.1);
    const strong = percentile(yields, 0.9);
    if (strong > 0 && weak / strong < 0.65) warnings.push('Starting-pair production varies considerably; consider balanced mode or editing number tokens.');
    const q1 = percentile(yields, .25), q3 = percentile(yields, .75), iqr = q3 - q1;
    const unusuallyWeak = yields.filter(value => value < q1 - 1.5 * iqr).length;
    const unusuallyStrong = yields.filter(value => value > q3 + 1.5 * iqr).length;
    if (unusuallyWeak) warnings.push(`${unusuallyWeak} legal starting combinations are unusually weak compared with the map's other choices.`);
    if (unusuallyStrong) warnings.push(`${unusuallyStrong} legal starting combinations are unusually strong compared with the map's other choices.`);
  }
  return {
    legalStartingCombinationCount: positions.length,
    requiredSetupPositions,
    availableSetupPositions: availableSpots.length,
    resourceTileCounts: counts,
    desertTileCount,
    resourceDistributionScore,
    settlementBalanceScore,
    medianExpectedCardsPerRoll: median,
    lowerDecileExpectedCardsPerRoll: lower,
    upperDecileExpectedCardsPerRoll: upper,
    resourceDiversityAverage: diversityAverage,
    fairnessScore,
    diversityScore,
    overallQualityScore,
    weakestPosition: positions[0] ?? null,
    strongestPosition: positions[positions.length - 1] ?? null,
    warnings: [...new Set(warnings)]
  };
}

/** A missing map cell can be added by touching a land tile along a hex side. */
export function adjacentEmptyCoordinates(definition: MapDefinition): Array<{ q: number; r: number }> {
  const occupied = new Set(definition.tiles.map(tile => key(tile)));
  const candidates = new Map<string, { q: number; r: number }>();
  for (const tile of definition.tiles) if (tile.kind !== 'water') {
    for (let side = 0; side < 6; side++) {
      const next = neighbor(tile, side), id = key(next);
      if (!occupied.has(id)) candidates.set(id, next);
    }
  }
  return [...candidates.values()].sort((a, b) => a.r - b.r || a.q - b.q);
}

/** Center position in the same pointy-top world coordinates used by buildBoard. */
export function mapTileCenter(q: number, r: number): [number, number] {
  return [(2 * q + r) * Math.sqrt(3), 3 * r];
}
