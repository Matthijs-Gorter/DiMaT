import { connectedComponents, key, neighbor, oppositeSide } from './hex.js';
import { vertexKey } from './build-board.js';
import { RESOURCES, type MapDefinition, type MapTile, type ValidationResult } from './types.js';

export interface ValidateOptions {
  /** Custom (user made) maps get warnings instead of errors for balance rules. */
  custom?: boolean;
  /** Minimum tiles per region/island. Default 3. */
  minIslandSize?: number;
  /** Hard cap on land tiles. Default 150. */
  maxLandTiles?: number;
}
export const DEFAULT_MAX_LAND_TILES = 150;
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

export const checkNoAdjacentRed: Check = (def, options) => {
  const result = none();
  const byKey = tileIndex(def);
  const red = (tile: MapTile | undefined) => !!tile && (tile.number === 6 || tile.number === 8);
  const report = options.custom ? result.warnings : result.errors;
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
  return result;
};

const CHECKS: readonly Check[] = [checkShape, checkPlayers, checkNoAdjacentRed, checkConnectivity, checkIslands, checkRivers, checkHarbors];

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

