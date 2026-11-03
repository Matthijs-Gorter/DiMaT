import { connectedComponents, CORNER_OFFSETS, disc, distance, key, neighbor, ring, type Axial } from './hex.js';
import type { MapRiverEdge } from './types.js';
import { Rng } from './rng.js';

export type TerrainStyle = 'standard' | 'continent' | 'archipelago' | 'river' | 'lakes' | 'atoll' | 'irregular' | 'random';

export interface TerrainOptions {
  players: number;
  landTarget?: number;
  islandCount?: number;
  riverCount?: number;
  lakeCount?: number;
  innerRadius?: 1 | 2;
  compactness?: number;
}

export interface TerrainResult {
  land: Axial[];
  water: Axial[];
  rivers: MapRiverEdge[];
  islands: Axial[][];
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number };
}

export class GenerationError extends Error {
  constructor(message: string) { super(message); this.name = 'GenerationError'; }
}

function assertPlayers(players: number): void {
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new RangeError('players must be an integer from 2 to 8');
}

function defaultTarget(style: TerrainStyle, players: number, rng: Rng): number {
  if (style === 'standard') return players <= 4 ? 19 : players <= 6 ? 30 : 44;
  if (style === 'irregular') return 50 + rng.int(31);
  const [min, max] = players <= 4 ? [19, 24] : players <= 6 ? [30, 36] : [44, 50];
  return min + rng.int(max - min + 1);
}

function compareAxial(a: Axial, b: Axial): number {
  return a.r - b.r || a.q - b.q;
}

function sorted(tiles: Iterable<Axial>): Axial[] {
  return [...tiles].sort(compareAxial);
}

function bounds(tiles: readonly Axial[]): TerrainResult['bounds'] {
  if (tiles.length === 0) throw new GenerationError('terrain has no land tiles');
  return {
    minQ: Math.min(...tiles.map(tile => tile.q)),
    maxQ: Math.max(...tiles.map(tile => tile.q)),
    minR: Math.min(...tiles.map(tile => tile.r)),
    maxR: Math.max(...tiles.map(tile => tile.r))
  };
}

function result(landTiles: readonly Axial[], waterTiles: readonly Axial[] = [], rivers: MapRiverEdge[] = []): TerrainResult {
  const land = sorted(landTiles), water = sorted(waterTiles);
  return { land, water, rivers, islands: connectedComponents(land), bounds: bounds(land) };
}

function growBlob(seedCells: readonly Axial[], targetSize: number, allowed: readonly Axial[], rng: Rng, compactness: number): Axial[] {
  const allowedByKey = new Map(allowed.map(tile => [key(tile), tile] as const));
  const land = new Map<string, Axial>();
  for (const tile of seedCells) {
    if (!allowedByKey.has(key(tile))) throw new GenerationError(`growth seed ${key(tile)} is outside allowed terrain`);
    land.set(key(tile), allowedByKey.get(key(tile))!);
  }
  if (land.size > targetSize) throw new GenerationError(`growth seed has ${land.size} tiles, exceeding target ${targetSize}`);
  while (land.size < targetSize) {
    const frontier = new Map<string, { tile: Axial; neighbors: number }>();
    for (const tile of land.values()) for (let side = 0; side < 6; side++) {
      const next = neighbor(tile, side), nextKey = key(next);
      if (land.has(nextKey) || !allowedByKey.has(nextKey)) continue;
      const current = frontier.get(nextKey);
      frontier.set(nextKey, { tile: allowedByKey.get(nextKey)!, neighbors: (current?.neighbors ?? 0) + 1 });
    }
    if (frontier.size === 0) throw new GenerationError(`cannot grow terrain to ${targetSize} tiles`);
    const candidates = [...frontier.values()];
    const selected = rng.weightedPick(candidates, candidate => 1 + compactness * candidate.neighbors + rng.float());
    land.set(key(selected.tile), selected.tile);
  }
  return sorted(land.values());
}

function standardLand(players: number): Axial[] {
  if (players <= 4) return disc({ q: 0, r: 0 }, 2);
  if (players <= 6) {
    const removed = new Set(ring({ q: 0, r: 0 }, 3).slice(0, 7).map(key));
    return disc({ q: 0, r: 0 }, 3).filter(tile => !removed.has(key(tile)));
  }
  const outer = ring({ q: 0, r: 0 }, 4);
  const selected = new Set<number>();
  for (let index = 0; index < 7; index++) selected.add(Math.round(index * outer.length / 7) % outer.length);
  return [...disc({ q: 0, r: 0 }, 3), ...[...selected].sort((a, b) => a - b).map(index => outer[index]!)].sort(compareAxial);
}

function makeContinent(target: number, rng: Rng, compactness = 0.7): Axial[] {
  const radius = Math.ceil(Math.sqrt(target)) + 2;
  const allowed = disc({ q: 0, r: 0 }, radius);
  return growBlob([{ q: 0, r: 0 }], target, allowed, rng, compactness);
}

/** Carve a connected, ragged coastline from a larger landmass by deterministic boundary erosion. */
function makeIrregularLand(target: number, rng: Rng): Axial[] {
  const initial = makeContinent(target + Math.max(5, Math.ceil(target * 0.22)), rng, 0.82);
  const selected = new Map(initial.map(tile => [key(tile), tile] as const));
  const protectedCore = new Set(initial.filter(tile => distance(tile, { q: 0, r: 0 }) <= 1).map(key));
  while (selected.size > target) {
    const land = [...selected.values()], occupied = new Set(land.map(key));
    const boundary = land.map(tile => ({ tile, contacts: Array.from({ length: 6 }, (_, side) => key(neighbor(tile, side))).filter(id => occupied.has(id)).length, noise: rng.float() }))
      .filter(item => !protectedCore.has(key(item.tile)) && item.contacts < 6)
      .sort((a, b) => a.contacts - b.contacts || a.noise - b.noise);
    const removable = boundary.find(item => connectedComponents(land.filter(tile => key(tile) !== key(item.tile))).length === 1);
    if (!removable) throw new GenerationError('coastline erosion would disconnect the map');
    selected.delete(key(removable.tile));
  }
  return sorted(selected.values());
}

/** Random maps are connected polyhexes grown from a seeded off-center nucleus. */
function makeRandomLand(target: number, rng: Rng): Axial[] {
  const radius = Math.ceil(Math.sqrt(target)) + 3, allowed = new Set(disc({ q: 0, r: 0 }, radius).map(key));
  const nucleus = rng.pick(ring({ q: 0, r: 0 }, Math.max(1, Math.floor(radius / 3))));
  const land = new Map<string, Axial>([[key(nucleus), nucleus]]);
  while (land.size < target) {
    const frontier = new Map<string, { tile: Axial; contacts: number }>();
    for (const tile of land.values()) for (let side = 0; side < 6; side++) {
      const candidate = neighbor(tile, side), id = key(candidate);
      if (!allowed.has(id) || land.has(id)) continue;
      const previous = frontier.get(id);
      frontier.set(id, { tile: candidate, contacts: (previous?.contacts ?? 0) + 1 });
    }
    if (!frontier.size) throw new GenerationError('random growth exhausted its allowed region');
    const candidates = [...frontier.values()];
    const selected = rng.weightedPick(candidates, item => 1 + item.contacts * (0.25 + rng.float() * 0.4) + rng.float() * 3);
    land.set(key(selected.tile), selected.tile);
  }
  return sorted(land.values());
}

function archipelago(target: number, players: number, rng: Rng, requestedCount?: number): Axial[] {
  const maxCount = Math.min(Math.floor(target / 4), Math.floor((target - Math.ceil(target * 0.35)) / 4) + 1);
  const defaultCount = players <= 4 ? Math.min(maxCount, 3 + rng.int(3)) : players <= 6 ? Math.min(maxCount, 4 + rng.int(3)) : Math.min(maxCount, 6 + rng.int(4));
  const count = requestedCount ?? defaultCount;
  if (!Number.isInteger(count) || count < 2 || count > maxCount) {
    throw new RangeError(`islandCount must be from 2 to ${Math.floor(target / 4)} for ${target} tiles`);
  }

  const sizes = Array<number>(count).fill(4);
  let remainder = target - sizes.reduce((sum, size) => sum + size, 0);
  if (remainder < 0) throw new RangeError(`islandCount ${count} cannot fit ${target} tiles with 4-tile minima`);
  while (remainder-- > 0) sizes[rng.int(count)]!++;
  const maxRadius = Math.ceil(Math.sqrt(Math.max(...sizes))) + 1;
  const candidateRadius = (maxRadius + 1) * (count + 1);
  const centers = rng.shuffle(disc({ q: 0, r: 0 }, candidateRadius));
  const seeds: Axial[] = [];
  for (const candidate of centers) {
    if (seeds.every(seed => distance(seed, candidate) >= 2 * maxRadius + 2)) seeds.push(candidate);
    if (seeds.length === count) break;
  }
  if (seeds.length !== count) throw new GenerationError(`could not place ${count} separated island centers`);
  const land: Axial[] = [];
  for (let index = 0; index < count; index++) {
    const center = seeds[index]!;
    const allowed = disc(center, Math.ceil(Math.sqrt(sizes[index]!)) + 1);
    land.push(...growBlob([center], sizes[index]!, allowed, rng, 0.7));
  }
  return sorted(land);
}

function riverEdges(land: readonly Axial[], count: number, rng: Rng): MapRiverEdge[] {
  if (!Number.isInteger(count) || count < 1 || count > 2) throw new RangeError('riverCount must be 1 or 2');
  const occupied = new Set(land.map(key));
  const vertexKey = (tile: Axial, corner: number) => {
    const offset = CORNER_OFFSETS[corner]!;
    return `${2 * tile.q + tile.r + offset[0]},${3 * tile.r + offset[1]}`;
  };
  type Edge = { river: MapRiverEdge; id: string; vertices: [string, string] };
  const vertexTiles = new Map<string, Set<string>>();
  for (const tile of land) for (let corner = 0; corner < 6; corner++) {
    const vertex = vertexKey(tile, corner), adjacentTiles = vertexTiles.get(vertex) ?? new Set<string>();
    adjacentTiles.add(key(tile)); vertexTiles.set(vertex, adjacentTiles);
  }
  const boundaryVertices = new Set([...vertexTiles].filter(([, tiles]) => tiles.size < 3).map(([vertex]) => vertex));
  const edges: Edge[] = [];
  for (const tile of land) for (const side of [0, 1, 2] as const) {
    const other = neighbor(tile, side);
    if (!occupied.has(key(other))) continue;
    const vertices: [string, string] = [vertexKey(tile, side), vertexKey(tile, (side + 1) % 6)];
    edges.push({
      river: { tile: { q: tile.q, r: tile.r }, side }, id: vertices.slice().sort().join('|'), vertices
    });
  }
  const adjacent = new Map<string, Edge[]>();
  for (const edge of edges) for (const vertex of edge.vertices) {
    const list = adjacent.get(vertex) ?? []; list.push(edge); adjacent.set(vertex, list);
  }
  const point = (vertex: string): [number, number] => vertex.split(',').map(Number) as [number, number];
  const unit = (vector: [number, number]): [number, number] => {
    const length = Math.hypot(vector[0], vector[1]) || 1;
    return [vector[0] / length, vector[1] / length];
  };
  const walk = (start: Edge, forbidden: Set<string>, minLength: number, maxLength: number, startAt?: string): Edge[] | null => {
    const origin = startAt ?? rng.pick(start.vertices), first = origin === start.vertices[0] ? start.vertices[1] : start.vertices[0];
    const path = [start], used = new Set([start.id]), visited = new Set([origin, first]);
    let attempts = 0;
    const search = (current: string, direction: [number, number]): Edge[] | null => {
      if (path.length >= maxLength || attempts++ > 100000) return null;
      const options = (adjacent.get(current) ?? []).filter(edge => {
        const next = edge.vertices[0] === current ? edge.vertices[1] : edge.vertices[0];
        return !used.has(edge.id) && !visited.has(next) && !forbidden.has(next);
      }).map(edge => {
        const next = edge.vertices[0] === current ? edge.vertices[1] : edge.vertices[0];
        const from = point(current), to = point(next), nextDirection = unit([to[0] - from[0], to[1] - from[1]]);
        const persistence = direction[0] * nextDirection[0] + direction[1] * nextDirection[1];
        return { edge, next, nextDirection, persistence };
      });
      const ordered = rng.shuffle(options).sort((a, b) => b.persistence - a.persistence);
      for (const choice of ordered) {
        path.push(choice.edge);
        if (boundaryVertices.has(choice.next) && path.length >= minLength) return [...path];
        used.add(choice.edge.id); visited.add(choice.next);
        const found = search(choice.next, choice.nextDirection);
        if (found) return found;
        visited.delete(choice.next); used.delete(choice.edge.id); path.pop();
      }
      return null;
    };
    const firstDirection = unit([point(first)[0] - point(origin)[0], point(first)[1] - point(origin)[1]]);
    return search(first, firstDirection);
  };
  const starts = rng.shuffle(edges.flatMap(edge => edge.vertices.filter(vertex => boundaryVertices.has(vertex)).map(startAt => ({ edge, startAt }))));
  let main: Edge[] | null = null;
  const maximum = Math.max(12, Math.min(land.length, Math.ceil(Math.sqrt(land.length) * 3.5)));
  for (const { edge, startAt } of starts) {
    main = walk(edge, new Set(), 2, maximum, startAt);
    if (main) break;
  }
  if (!main) throw new GenerationError('could not generate a continuous river from coastline to coastline');
  if (count === 1) return main.map(edge => edge.river);

  const mainVertices = new Set(main.flatMap(edge => edge.vertices));
  const junctions = rng.shuffle([...mainVertices].filter(vertex => (adjacent.get(vertex) ?? []).length > 2));
  let fallbackBranch: Edge | undefined;
  for (const junction of junctions) {
    const startsAtJunction = rng.shuffle((adjacent.get(junction) ?? []).filter(edge => !main!.some(part => part.id === edge.id)));
    for (const start of startsAtJunction) {
      fallbackBranch ??= start;
      const forbidden = new Set([...mainVertices].filter(vertex => vertex !== junction));
      const branch = walk(start, forbidden, 3, 7, junction);
      if (branch) return [...main, ...branch].map(edge => edge.river);
    }
  }
  if (fallbackBranch) return [...main, fallbackBranch].map(edge => edge.river);
  throw new GenerationError('could not grow a continuous river tributary');
}
function makeLakes(target: number, lakeCount: number, rng: Rng): { land: Axial[]; water: Axial[] } {
  for (let extra = 4; extra <= 34; extra += 2) {
    const initial = makeContinent(target + lakeCount + extra, rng, 0.85);
    const occupied = new Set(initial.map(key));
    const candidates = initial.filter(tile =>
      Array.from({ length: 6 }, (_, side) => key(neighbor(tile, side))).every(id => occupied.has(id))
    );
    const selected: Axial[] = [];
    for (const tile of rng.shuffle(candidates)) {
      if (selected.every(other => distance(other, tile) >= 3)) selected.push(tile);
      if (selected.length === lakeCount) break;
    }
    if (selected.length !== lakeCount) continue;

    const waterKeys = new Set(selected.map(key));
    const protectedCoast = new Set(selected.flatMap(tile => Array.from({ length: 6 }, (_, side) => key(neighbor(tile, side)))));
    const land = initial.filter(tile => !waterKeys.has(key(tile)));
    while (land.length > target) {
      const degrees = new Map(land.map(tile => [key(tile), 0]));
      const occupiedLand = new Set(degrees.keys());
      for (const tile of land) for (let side = 0; side < 6; side++) {
        const nextKey = key(neighbor(tile, side));
        if (occupiedLand.has(nextKey)) degrees.set(key(tile), degrees.get(key(tile))! + 1);
      }
      const candidatesToRemove = rng.shuffle(land.filter(tile => !protectedCoast.has(key(tile))))
        .sort((a, b) => degrees.get(key(a))! - degrees.get(key(b))!);
      const removable = candidatesToRemove.find(tile =>
        connectedComponents(land.filter(candidate => key(candidate) !== key(tile))).length === 1
      );
      if (!removable) break;
      land.splice(land.findIndex(tile => key(tile) === key(removable)), 1);
    }
    if (land.length === target) return { land, water: selected };
  }
  throw new GenerationError(`could not place ${lakeCount} interior lakes and restore ${target} land tiles after 16 attempts`);
}

function makeAtoll(target: number, innerRadius: number, rng: Rng): { land: Axial[]; water: Axial[] } {
  const minimumRadius = innerRadius + 1;
  const seeds = ring({ q: 0, r: 0 }, minimumRadius);
  if (seeds.length > target) throw new GenerationError(`atoll target ${target} is too small for inner radius ${innerRadius}`);
  const outerRadius = minimumRadius + Math.ceil(target / (6 * minimumRadius));
  const allowed = disc({ q: 0, r: 0 }, outerRadius).filter(tile => distance(tile, { q: 0, r: 0 }) >= minimumRadius);
  const land = growBlob(seeds, target, allowed, rng, 0.75);
  const water = disc({ q: 0, r: 0 }, innerRadius);
  return { land, water };
}

export function generateTerrain(style: TerrainStyle, options: TerrainOptions, rng: Rng): TerrainResult {
  assertPlayers(options.players);
  const target = options.landTarget ?? defaultTarget(style, options.players, rng);
  if (!Number.isInteger(target) || target < 1 || target > 150) throw new RangeError('landTarget must be an integer from 1 to 150');
  if (style === 'standard') {
    const expected = options.players <= 4 ? 19 : options.players <= 6 ? 30 : 44;
    if (target !== expected) throw new RangeError(`standard maps for ${options.players} players have ${expected} land tiles`);
    return result(standardLand(options.players));
  }
  if (style === 'archipelago') return result(archipelago(target, options.players, rng, options.islandCount));
  if (style === 'river') {
    const land = makeContinent(target, rng, 0.68);
    return result(land, [], riverEdges(land, options.riverCount ?? 1, rng));
  }
  if (style === 'lakes') {
    const count = options.lakeCount ?? 1 + rng.int(3);
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new RangeError('lakeCount must be from 1 to 3');
    const terrain = makeLakes(target, count, rng);
    return result(terrain.land, terrain.water);
  }
  if (style === 'atoll') {
    const radius = options.innerRadius ?? (rng.int(2) === 0 ? 1 : 2);
    const terrain = makeAtoll(target, radius, rng);
    return result(terrain.land, terrain.water);
  }
  if (style === 'irregular') {
    if (target < 50 || target > 80) throw new RangeError('irregular landTarget must be from 50 to 80');
    return result(makeIrregularLand(target, rng));
  }
  if (style === 'random') return result(makeRandomLand(target, rng));
  const compactness = options.compactness ?? 0.55 + rng.float() * 0.3;
  if (!Number.isFinite(compactness) || compactness < 0 || compactness > 1) throw new RangeError('compactness must be from 0 to 1');
  return result(makeContinent(target, rng, compactness));
}
