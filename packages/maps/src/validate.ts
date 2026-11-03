import { connectedComponents, key, neighbor, oppositeSide } from './hex.js';
import { vertexKey } from './build-board.js';
import { RESOURCES, type MapDefinition, type MapTile, type ValidationResult } from './types.js';
import { countOuterCoastEdges, harborTarget, scaleResourceCounts, scaleTokens } from './balance.js';

export interface ValidateOptions {
  /** Custom (user made) maps get warnings instead of errors for balance rules. */
  custom?: boolean;
  /** Skip start fairness checks for randomly balanced maps. */
  balance?: 'random' | 'balanced';
  /** Player count to use for fairness checks. Defaults to the map maximum. */
  players?: number;
  /** Minimum tiles per region/island. Default 3. */
  minIslandSize?: number;
  /** Hard cap on land tiles. Default 150. */
  maxLandTiles?: number;
  /** Maximum permitted score spread among fair starting spots. Default 5. */
  startSpreadMax?: number;
}
export const DEFAULT_MAX_LAND_TILES = 150;
export const START_SPREAD_MAX = 5;
const KNOWN_KINDS = new Set<string>([...RESOURCES, 'desert', 'water', 'gold', 'fog']);
const NUMBERS = new Set([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

type Check = (def: MapDefinition, options: ValidateOptions) => { errors: string[]; warnings: string[] };
const isLand = (tile: MapTile): boolean => tile.kind !== 'water';
const isResource = (tile: MapTile): boolean => (RESOURCES as readonly string[]).includes(tile.kind);
const landTiles = (def: MapDefinition): MapTile[] => def.tiles.filter(isLand);
const none = () => ({ errors: [] as string[], warnings: [] as string[] });

function tileIndex(def: MapDefinition): Map<string, MapTile> {
  return new Map(def.tiles.map(tile => [key(tile), tile] as const));
}
/** Canonical id of a tile side, identical from both tiles that share it. */
function sideKey(q: number, r: number, side: number): string {
  const n = neighbor({ q, r }, side);
  const a = `${q},${r}:${side}`, b = `${n.q},${n.r}:${oppositeSide(side)}`;
  return a < b ? a : b;
}

/** Region id (0-based, largest first) per land tile key: land connected without crossing a river edge. */
export function computeRegions(def: MapDefinition): Map<string, number> {
  const riverSides = new Set(def.rivers.map(river => sideKey(river.tile.q, river.tile.r, river.side)));
  const land = landTiles(def);
  const components = connectedComponents(land, (tile, side) => riverSides.has(sideKey(tile.q, tile.r, side)));
  const regions = new Map<string, number>();
  components.forEach((component, index) => component.forEach(tile => regions.set(key(tile), index)));
  return regions;
}

export const checkShape: Check = (def, options) => {
  const result = none();
  const seen = new Set<string>();
  for (const tile of def.tiles) {
    const k = key(tile);
    if (!Number.isInteger(tile.q) || !Number.isInteger(tile.r)) result.errors.push(`tile ${k} has non-integer coordinates`);
    if (seen.has(k)) result.errors.push(`duplicate tile ${k}`);
    seen.add(k);
    if (!KNOWN_KINDS.has(tile.kind)) { result.errors.push(`tile ${k} has unknown kind ${String(tile.kind)}`); continue; }
    if ((tile.kind === 'gold' || tile.kind === 'fog') && !def.features.includes(tile.kind)) result.errors.push(`tile ${k} uses ${tile.kind} but the map does not enable that feature`);
    if (isResource(tile)) {
      if (tile.number === null) result.errors.push(`resource tile ${k} has no number token`);
      else if (!NUMBERS.has(tile.number)) result.errors.push(`tile ${k} has invalid number ${tile.number}`);
    } else if (tile.number !== null) result.errors.push(`non-resource tile ${k} must not have a number token`);
  }
  for (let i = 1; i < def.tiles.length; i++) {
    const a = def.tiles[i - 1]!, b = def.tiles[i]!;
    if (a.r > b.r || (a.r === b.r && a.q > b.q)) { result.errors.push('tiles are not in deterministic order (r ascending, then q ascending)'); break; }
  }
  const landCount = landTiles(def).length;
  const maxLand = options.maxLandTiles ?? DEFAULT_MAX_LAND_TILES;
  if (landCount === 0) result.errors.push('map has no land tiles');
  if (landCount > maxLand) result.errors.push(`map has ${landCount} land tiles, the maximum is ${maxLand}`);
  return result;
};

export const checkPlayers: Check = (def) => {
  const result = none();
  const { min, max } = def.players;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max < min || max > 8) result.errors.push(`invalid player range ${min} to ${max}`);
  if (!Number.isInteger(def.victoryTarget) || def.victoryTarget < 3) result.errors.push(`invalid victory target ${def.victoryTarget}`);
  // Each player needs room for two settlements under the distance rule.
  const landCount = landTiles(def).length;
  if (Number.isInteger(max) && landCount < max * 3) result.warnings.push(`only ${landCount} land tiles for up to ${max} players`);
  return result;
};

export const checkCounts: Check = (def, options) => {
  const result = none();
  const landCount = landTiles(def).length;
  if (landCount < 1 || landCount > DEFAULT_MAX_LAND_TILES) return result;
  const players = options.players ?? def.players.max;
  if (!Number.isInteger(players) || players < 2 || players > 8) return result;
  const actual: Record<string, number> = Object.fromEntries([...RESOURCES, 'desert'].map(kind => [kind, 0]));
  for (const tile of landTiles(def)) if (tile.kind in actual) actual[tile.kind] = actual[tile.kind]! + 1;
  const expected = scaleResourceCounts(landCount, players);
  const relaxed = options.custom || def.style === 'custom';
  const report = relaxed ? result.warnings : result.errors;
  for (const kind of [...RESOURCES, 'desert'] as const) {
    const difference = Math.abs(actual[kind]! - expected[kind]);
    if (relaxed ? difference > 1 : difference !== 0) report.push(`${kind} count is ${actual[kind]}, expected ${expected[kind]}${relaxed ? ' ±1' : ''}`);
  }
  const expectedTokens = scaleTokens(resourceTiles(def).length);
  const actualTokens = resourceTiles(def).map(tile => tile.number).sort((a, b) => a! - b!);
  if (!relaxed && JSON.stringify(actualTokens) !== JSON.stringify([...expectedTokens].sort((a, b) => a - b))) {
    result.errors.push('number token distribution does not match the scaled token supply');
  }
  return result;
};

function resourceTiles(def: MapDefinition): MapTile[] {
  return landTiles(def).filter(tile => (RESOURCES as readonly string[]).includes(tile.kind));
}

export const checkNoAdjacentRed: Check = (def, options) => {
  const result = none();
  const byKey = tileIndex(def);
  const red = (tile: MapTile | undefined) => !!tile && (tile.number === 6 || tile.number === 8);
  const report = options.custom || def.style === 'custom' ? result.warnings : result.errors;
  for (const tile of def.tiles) {
    if (!red(tile)) continue;
    for (const side of [0, 1, 2]) { // each pair once
      const other = byKey.get(key(neighbor(tile, side)));
      if (red(other)) report.push(`adjacent 6/8 tokens at ${key(tile)} and ${key(other!)}`);
    }
  }
  return result;
};

export const checkConnectivity: Check = (def) => {
  const result = none();
  // Rivers are crossable by bridges, so they do not split land for this check.
  const components = connectedComponents(landTiles(def));
  if (components.length > 1 && !def.allowSeparateIslands) {
    result.errors.push(`land is split into ${components.length} separate islands but allowSeparateIslands is false`);
  }
  return result;
};

export const checkIslands: Check = (def, options) => {
  const result = none();
  const regions = computeRegions(def);
  const minSize = options.minIslandSize ?? 3;
  const sizes = new Map<number, number>();
  for (const tile of landTiles(def)) {
    const region = regions.get(key(tile))!;
    sizes.set(region, (sizes.get(region) ?? 0) + 1);
    if (tile.islandId !== region) result.errors.push(`tile ${key(tile)} has islandId ${tile.islandId}, expected region ${region}`);
  }
  for (const [region, size] of sizes) if (size < minSize) result.errors.push(`region ${region} has only ${size} tiles, minimum is ${minSize}`);
  const declared = new Map(def.islands.map(island => [island.id, island.tileCount] as const));
  if (declared.size !== def.islands.length) result.errors.push('duplicate island ids');
  if (declared.size !== sizes.size) result.errors.push(`map declares ${declared.size} islands but has ${sizes.size} regions`);
  for (const [region, size] of sizes) if (declared.get(region) !== size) result.errors.push(`island ${region} declares ${declared.get(region)} tiles, actual ${size}`);
  return result;
};

export const checkRivers: Check = (def) => {
  const result = none();
  const byKey = tileIndex(def);
  const seen = new Set<string>();
  for (const river of def.rivers) {
    const label = `river at ${river.tile.q},${river.tile.r} side ${river.side}`;
    const tile = byKey.get(key(river.tile));
    if (!Number.isInteger(river.side) || river.side < 0 || river.side > 5) { result.errors.push(`${label} has invalid side`); continue; }
    if (!tile || !isLand(tile)) { result.errors.push(`${label} is not on a land tile`); continue; }
    const other = byKey.get(key(neighbor(river.tile, river.side)));
    if (!other || !isLand(other)) { result.errors.push(`${label} is not between two land tiles`); continue; }
    const id = sideKey(river.tile.q, river.tile.r, river.side);
    if (seen.has(id)) result.errors.push(`${label} is listed twice`);
    seen.add(id);
  }
  if (def.rivers.length > 0 && result.errors.length === 0) {
    const landComponents = connectedComponents(landTiles(def)).length;
    const regionCount = new Set(computeRegions(def).values()).size;
    if (regionCount === landComponents) result.warnings.push('river does not separate any region; it is only decoration');
  }
  return result;
};

export const checkHarbors: Check = (def) => {
  const result = none();
  const byKey = tileIndex(def);
  const ids = new Set<number>();
  const usedVertices = new Set<string>();
  const usedEdges = new Set<string>();
  for (const harbor of def.harbors) {
    const label = `harbor ${harbor.id}`;
    if (ids.has(harbor.id)) result.errors.push(`${label} has a duplicate id`);
    ids.add(harbor.id);
    if (harbor.ratio !== (harbor.kind === 'generic' ? 3 : 2)) result.errors.push(`${label} has ratio ${harbor.ratio} for kind ${harbor.kind}`);
    if (harbor.kind !== 'generic' && !(RESOURCES as readonly string[]).includes(harbor.kind)) result.errors.push(`${label} has unknown kind ${String(harbor.kind)}`);
    const tile = byKey.get(key(harbor.tile));
    if (!tile || !isLand(tile)) { result.errors.push(`${label} is not on a land tile`); continue; }
    if (!Number.isInteger(harbor.side) || harbor.side < 0 || harbor.side > 5) { result.errors.push(`${label} has invalid side`); continue; }
    const across = byKey.get(key(neighbor(harbor.tile, harbor.side)));
    if (across && isLand(across)) { result.errors.push(`${label} is not on a coast edge`); continue; }
    const edge = sideKey(harbor.tile.q, harbor.tile.r, harbor.side);
    if (usedEdges.has(edge)) result.errors.push(`${label} shares its edge with another harbor`);
    usedEdges.add(edge);
    for (const corner of [harbor.side, (harbor.side + 1) % 6]) {
      const vertex = vertexKey(harbor.tile.q, harbor.tile.r, corner);
      if (usedVertices.has(vertex)) result.errors.push(`${label} shares a vertex with another harbor`);
      usedVertices.add(vertex);
    }
  }
  const expected = harborTarget(countOuterCoastEdges(def));
  if (def.harbors.length !== expected) {
    const report = def.style === 'custom' ? result.warnings : result.errors;
    report.push(`map has ${def.harbors.length} harbors, expected ${expected}`);
  }
  return result;
};

export const checkStartSpots: Check = (def, options) => {
  const result = none();
  if (options.balance !== 'balanced') return result;
  const players = options.players ?? def.players.max;
  const vertices = new Map<string, { neighbors: Set<string>; resources: Set<string>; pips: number }>();
  const connect = (a: string, b: string) => {
    vertices.get(a)!.neighbors.add(b);
    vertices.get(b)!.neighbors.add(a);
  };
  for (const tile of landTiles(def)) {
    const corners = Array.from({ length: 6 }, (_, corner) => vertexKey(tile.q, tile.r, corner));
    const pips = tile.number === null ? 0 : 6 - Math.abs(7 - tile.number);
    for (const vertex of corners) {
      const current = vertices.get(vertex) ?? { neighbors: new Set<string>(), resources: new Set<string>(), pips: 0 };
      current.pips += pips;
      if ((RESOURCES as readonly string[]).includes(tile.kind)) current.resources.add(tile.kind);
      vertices.set(vertex, current);
    }
    for (let side = 0; side < 6; side++) connect(corners[side]!, corners[(side + 1) % 6]!);
  }
  const candidates = [...vertices].map(([id, vertex]) => ({
    id,
    score: vertex.pips + (vertex.resources.size >= 3 ? 1 : 0),
    neighbors: vertex.neighbors
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selectSpots = (spots: typeof candidates, limit: number) => {
    const selected: typeof candidates = [];
    for (const candidate of spots) {
      if (selected.some(item => item.id === candidate.id || item.neighbors.has(candidate.id))) continue;
      selected.push(candidate);
      if (selected.length === limit) break;
    }
    return selected;
  };
  const minimum = players * 2 + 2;
  if (selectSpots(candidates, minimum).length < minimum) result.errors.push(`fewer than ${minimum} non-adjacent legal start vertices`);
  const fairSpots = selectSpots(candidates, players * 2);
  if (fairSpots.length === players * 2) {
    const scores = fairSpots.map(spot => spot.score);
    const spread = Math.max(...scores) - Math.min(...scores);
    const maxSpread = options.startSpreadMax ?? START_SPREAD_MAX;
    if (spread > maxSpread) result.errors.push(`fair start spot spread ${spread} exceeds ${maxSpread}`);
  }
  if (selectSpots(candidates.filter(candidate => candidate.score >= 8), minimum).length < minimum) {
    result.errors.push(`fewer than ${minimum} non-adjacent start vertices have score 8 or higher`);
  }
  return result;
};

export const checkDesertPlacement: Check = (def) => {
  const result = none();
  const byKey = tileIndex(def);
  for (const desert of def.tiles.filter(tile => tile.kind === 'desert')) {
    let adjacentDeserts = 0, adjacentNonDeserts = 0;
    for (let side = 0; side < 6; side++) {
      const adjacent = byKey.get(key(neighbor(desert, side)));
      if (adjacent?.kind === 'desert') adjacentDeserts++;
      else if (adjacent && adjacent.kind !== 'water') adjacentNonDeserts++;
    }
    if (adjacentDeserts > 2) result.errors.push(`desert at ${key(desert)} touches ${adjacentDeserts} other deserts (maximum 2)`);
    if (adjacentNonDeserts === 0) result.errors.push(`desert at ${key(desert)} has no non-desert land neighbor`);
  }
  return result;
};

const CHECKS: readonly Check[] = [checkShape, checkPlayers, checkCounts, checkNoAdjacentRed, checkConnectivity, checkIslands, checkRivers, checkHarbors, checkStartSpots, checkDesertPlacement];

export function validateMap(def: MapDefinition, options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shape = checkShape(def, options);
  errors.push(...shape.errors); warnings.push(...shape.warnings);
  // Later checks assume well-formed, unique tiles, so stop early on a broken shape.
  if (shape.errors.length === 0) {
    for (const check of CHECKS.slice(1)) {
      const result = check(def, options);
      errors.push(...result.errors); warnings.push(...result.warnings);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
