import { key, neighbor } from './hex.js';
import { cornerPoint } from './build-board.js';
import { RESOURCES, type MapDefinition, type MapTile, type Resource } from './types.js';
import { Rng } from './rng.js';

const BASE_RESOURCE_COUNTS = [3, 4, 4, 4, 3] as const;
const BASE_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12] as const;
const RED_NUMBERS = new Set([6, 8]);
const TOKEN_VALUES = new Set<number>(BASE_TOKENS);

export class BalanceError extends Error {
  constructor(message: string) { super(message); this.name = 'BalanceError'; }
}

function largestRemainder(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0 || weights.length === 0 || weights.some(weight => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError('total and weights must be non-negative, and weights must not be empty');
  }
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) throw new RangeError('weights must have a positive sum');
  const quotas = weights.map(weight => total * weight / weightTotal);
  const counts = quotas.map(Math.floor);
  const remainder = total - counts.reduce((sum, count) => sum + count, 0);
  const order = quotas.map((quota, index) => ({ index, fraction: quota - counts[index]! }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) counts[order[i]!.index]!++;
  return counts;
}

export function scaleResourceCounts(landTileCount: number, players: number): Record<Resource | 'desert', number> {
  if (!Number.isInteger(landTileCount) || landTileCount < 1 || landTileCount > 150) {
    throw new RangeError('landTileCount must be an integer from 1 to 150');
  }
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new RangeError('players must be an integer from 2 to 8');
  const desert = landTileCount <= 30
    ? Math.max(1, Math.round(landTileCount / 19))
    : Math.ceil(landTileCount / 22);
  const resources = largestRemainder(landTileCount - desert, BASE_RESOURCE_COUNTS);
  return {
    brick: resources[0]!,
    lumber: resources[1]!,
    wool: resources[2]!,
    grain: resources[3]!,
    ore: resources[4]!,
    desert
  };
}

export function scaleTokens(resourceTileCount: number): number[] {
  if (!Number.isInteger(resourceTileCount) || resourceTileCount < 0) {
    throw new RangeError('resourceTileCount must be a non-negative integer');
  }
  if (resourceTileCount === 0) return [];
  const values = [...new Set(BASE_TOKENS)];
  const counts = values.map(value => BASE_TOKENS.filter(token => token === value).length);
  return largestRemainder(resourceTileCount, counts).flatMap((count, index) => Array(count).fill(values[index]!));
}

function resourceTiles(tiles: readonly MapTile[]): MapTile[] {
  return tiles.filter((tile): tile is MapTile & { kind: Resource } => (RESOURCES as readonly string[]).includes(tile.kind));
}

function redAdjacencyCount(tiles: readonly MapTile[]): number {
  const byPosition = new Map(tiles.map(tile => [key(tile), tile] as const));
  let count = 0;
  for (const tile of tiles) {
    if (!RED_NUMBERS.has(tile.number ?? 0)) continue;
    for (const side of [0, 1, 2]) {
      if (RED_NUMBERS.has(byPosition.get(key(neighbor(tile, side)))?.number ?? 0)) count++;
    }
  }
  return count;
}

function redAdjacencyPair(tiles: readonly MapTile[]): [MapTile, MapTile] | null {
  const byPosition = new Map(tiles.map(tile => [key(tile), tile] as const));
  for (const tile of tiles) {
    if (!RED_NUMBERS.has(tile.number ?? 0)) continue;
    for (const side of [0, 1, 2]) {
      const adjacent = byPosition.get(key(neighbor(tile, side)));
      if (adjacent && RED_NUMBERS.has(adjacent.number ?? 0)) return [tile, adjacent];
    }
  }
  return null;
}

function isAdjacentToRed(tiles: readonly MapTile[], candidate: MapTile, ignoredKey: string): boolean {
  const byPosition = new Map(tiles.map(tile => [key(tile), tile] as const));
  for (let side = 0; side < 6; side++) {
    const adjacent = key(neighbor(candidate, side));
    if (adjacent === ignoredKey) continue;
    if (RED_NUMBERS.has(byPosition.get(adjacent)?.number ?? 0)) return true;
  }
  return false;
}

export function assignNumbers(tiles: readonly MapTile[], rng: Rng, avoidAdjacentRed = true): MapTile[] {
  const resources = resourceTiles(tiles);
  const tokenPool = scaleTokens(resources.length);
  const fixed = resources.filter(tile => tile.fixedNumber);
  for (const tile of fixed) {
    if (tile.number === null || !Number.isInteger(tile.number) || !TOKEN_VALUES.has(tile.number)) {
      throw new BalanceError(`fixed number at ${key(tile)} is invalid`);
    }
    const index = tokenPool.indexOf(tile.number);
    if (index < 0) throw new BalanceError(`fixed number ${tile.number} at ${key(tile)} exceeds the scaled token supply`);
    tokenPool.splice(index, 1);
  }
  const variable = resources.filter(tile => !tile.fixedNumber);
  for (let attempt = 0; attempt < 200; attempt++) {
    const shuffled = rng.shuffle(tokenPool);
    let tokenIndex = 0;
    const numbered = tiles.map(tile => {
      if (!(RESOURCES as readonly string[]).includes(tile.kind)) return { ...tile, number: null };
      return tile.fixedNumber ? { ...tile } : { ...tile, number: shuffled[tokenIndex++]! };
    });
    if (!avoidAdjacentRed) return numbered;
    for (let repair = 0; repair < resources.length; repair++) {
      const conflict = redAdjacencyPair(numbered);
      if (!conflict) return numbered;
      const movable = conflict.filter(tile => !tile.fixedNumber);
      if (movable.length === 0) break;
      const redTile = rng.pick(movable);
      const target = rng.shuffle(variable.filter(tile =>
        !RED_NUMBERS.has(numbered.find(candidate => key(candidate) === key(tile))?.number ?? 0) &&
        !isAdjacentToRed(numbered, tile, key(redTile))
      ))[0];
      if (!target) break;
      const redIndex = numbered.findIndex(tile => key(tile) === key(redTile));
      const targetIndex = numbered.findIndex(tile => key(tile) === key(target));
      const redNumber = numbered[redIndex]!.number;
      numbered[redIndex] = { ...numbered[redIndex]!, number: numbered[targetIndex]!.number };
      numbered[targetIndex] = { ...numbered[targetIndex]!, number: redNumber };
    }
    if (redAdjacencyCount(numbered) === 0) return numbered;
  }
  throw new BalanceError(`could not assign non-adjacent 6/8 tokens after 200 attempts (${variable.length} unfixed resource tiles)`);
}

function resourcePenalty(tiles: readonly MapTile[]): number {
  const byPosition = new Map(tiles.map(tile => [key(tile), tile] as const));
  let penalty = 0;
  for (const tile of tiles) {
    if (!(RESOURCES as readonly string[]).includes(tile.kind)) continue;
    let sameNeighbors = 0;
    for (let side = 0; side < 6; side++) if (byPosition.get(key(neighbor(tile, side)))?.kind === tile.kind) sameNeighbors++;
    penalty += Math.max(0, sameNeighbors - 2);
  }
  return penalty;
}

export function balanceResources(tiles: readonly MapTile[], rng: Rng): MapTile[] {
  const result = tiles.map(tile => ({ ...tile }));
  const mutable = result.filter(tile => !tile.fixedKind && (RESOURCES as readonly string[]).includes(tile.kind));
  if (mutable.length < 2) return result;
  let penalty = resourcePenalty(result);
  for (let iteration = 0; iteration < mutable.length * 20 && penalty > 0; iteration++) {
    const first = mutable[rng.int(mutable.length)]!;
    const second = mutable[rng.int(mutable.length)]!;
    if (first === second || first.kind === second.kind) continue;
    const firstKind = first.kind, secondKind = second.kind;
    first.kind = secondKind;
    second.kind = firstKind;
    const nextPenalty = resourcePenalty(result);
    if (nextPenalty < penalty) penalty = nextPenalty;
    else {
      first.kind = firstKind;
      second.kind = secondKind;
    }
  }
  return result;
}

interface CoastEdge {
  tile: { q: number; r: number };
  side: 0 | 1 | 2 | 3 | 4 | 5;
  vertices: [string, string];
  angle: number;
  edgeKey: string;
}

function outsideWater(def: MapDefinition): Set<string> {
  const byPosition = new Map(def.tiles.map(tile => [key(tile), tile] as const));
  const qValues = def.tiles.map(tile => tile.q), rValues = def.tiles.map(tile => tile.r);
  const minQ = Math.min(...qValues) - 1, maxQ = Math.max(...qValues) + 1;
  const minR = Math.min(...rValues) - 1, maxR = Math.max(...rValues) + 1;
  const queue: Array<{ q: number; r: number }> = [];
  const visited = new Set<string>();
  const add = (tile: { q: number; r: number }) => {
    const id = key(tile);
    if (visited.has(id) || tile.q < minQ || tile.q > maxQ || tile.r < minR || tile.r > maxR) return;
    const occupant = byPosition.get(id);
    if (occupant && occupant.kind !== 'water') return;
    visited.add(id);
    queue.push(tile);
  };
  for (let q = minQ; q <= maxQ; q++) {
    add({ q, r: minR });
    add({ q, r: maxR });
  }
  for (let r = minR; r <= maxR; r++) {
    add({ q: minQ, r });
    add({ q: maxQ, r });
  }
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index]!;
    for (let side = 0; side < 6; side++) add(neighbor(tile, side));
  }
  return new Set([...visited].filter(id => byPosition.get(id)?.kind === 'water'));
}

function coastEdges(def: MapDefinition): CoastEdge[] {
  const byPosition = new Map(def.tiles.map(tile => [key(tile), tile] as const));
  const land = def.tiles.filter(tile => tile.kind !== 'water');
  if (land.length === 0) throw new BalanceError('cannot place harbors on a map without land');
  const outerWater = outsideWater(def);
  const center = land.reduce<[number, number]>((sum, tile) => [
    sum[0] + Math.sqrt(3) * (tile.q + tile.r / 2) / land.length,
    sum[1] + 1.5 * tile.r / land.length
  ], [0, 0]);
  const seen = new Set<string>();
  const result: CoastEdge[] = [];
  for (const tile of land) for (let side = 0; side < 6; side++) {
    const across = neighbor(tile, side);
    const acrossKey = key(across);
    const other = byPosition.get(acrossKey);
    if (other && other.kind !== 'water') continue;
    if (other?.kind === 'water' && !outerWater.has(acrossKey)) continue;
    const edgeKey = [key(tile), side, acrossKey, (side + 3) % 6].sort().join(':');
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    const corners = [cornerPoint(tile.q, tile.r, side), cornerPoint(tile.q, tile.r, (side + 1) % 6)];
    const vertices = corners.map(([x, y]) => `${x},${y}`).sort() as [string, string];
    const midpointX = (corners[0]![0] + corners[1]![0]) * Math.sqrt(3) / 2;
    const midpointY = (corners[0]![1] + corners[1]![1]) / 2;
    result.push({
      tile: { q: tile.q, r: tile.r },
      side: side as CoastEdge['side'],
      vertices,
      angle: Math.atan2(midpointY - center[1], midpointX - center[0]),
      edgeKey
    });
  }
  return result.sort((a, b) => a.angle - b.angle || a.edgeKey.localeCompare(b.edgeKey));
}

export function countOuterCoastEdges(def: MapDefinition): number {
  return coastEdges(def).length;
}

export function harborTarget(coastEdgeCount: number): number {
  if (!Number.isInteger(coastEdgeCount) || coastEdgeCount < 0) throw new RangeError('coastEdgeCount must be a non-negative integer');
  if (coastEdgeCount === 0) return 0;
  return Math.min(coastEdgeCount, Math.max(6, Math.min(16, Math.round(coastEdgeCount / 3.3))));
}

function harborKindCounts(count: number): Array<'generic' | Resource> {
  const genericCount = Math.round(count * 0.45);
  const resourceCounts = largestRemainder(count - genericCount, RESOURCES.map(() => 1));
  return [
    ...Array<'generic'>(genericCount).fill('generic'),
    ...resourceCounts.flatMap((amount, index) => Array<Resource>(amount).fill(RESOURCES[index]!))
  ];
}

export function placeHarbors(def: MapDefinition, rng: Rng, players: number): MapDefinition {
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new RangeError('players must be an integer from 2 to 8');
  const coast = coastEdges(def);
  const count = harborTarget(coast.length);
  if (count === 0) return { ...def, harbors: [] };
  if (coast.length < count) throw new BalanceError(`only ${coast.length} eligible coast edges for ${count} harbors`);
  const phase = rng.int(coast.length);
  const selected: CoastEdge[] = [];
  const usedVertices = new Set<string>();
  for (let harbor = 0; harbor < count; harbor++) {
    const target = phase + harbor * coast.length / count;
    let chosen: CoastEdge | undefined;
    for (let distance = 0; distance < coast.length && !chosen; distance++) {
      for (const direction of [1, -1]) {
        const index = ((Math.round(target) + direction * distance) % coast.length + coast.length) % coast.length;
        const candidate = coast[index]!;
        if (selected.some(item => item.edgeKey === candidate.edgeKey) || candidate.vertices.some(vertex => usedVertices.has(vertex))) continue;
        chosen = candidate;
        break;
      }
    }
    if (!chosen) throw new BalanceError(`could not place ${count} non-overlapping harbors`);
    selected.push(chosen);
    chosen.vertices.forEach(vertex => usedVertices.add(vertex));
  }
  const kinds = rng.shuffle(harborKindCounts(count));
  const harbors = selected.map((edge, id) => {
    const kind = kinds[id]!;
    return {
      id,
      kind,
      ratio: kind === 'generic' ? 3 as const : 2 as const,
      tile: edge.tile,
      side: edge.side
    };
  });
  return { ...def, harbors };
}
