import { disc, key, neighbor } from '../src/hex.js';
import { computeRegions } from '../src/validate.js';
import type { MapDefinition, MapTile, Resource } from '../src/types.js';

const KINDS: Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
// Mild numbers only, so fixtures never contain adjacent 6/8 unless a test adds them.
const NUMBERS = [2, 3, 4, 5, 9, 10, 11, 12];

export function discMap(radius: number, overrides: Partial<MapDefinition> = {}): MapDefinition {
  const tiles: MapTile[] = disc({ q: 0, r: 0 }, radius).map((a, i) => {
    const desert = a.q === 0 && a.r === 0;
    return { q: a.q, r: a.r, kind: desert ? 'desert' : KINDS[i % KINDS.length]!, number: desert ? null : NUMBERS[i % NUMBERS.length]!, islandId: 0 };
  });
  return finish({
    schemaVersion: 1, id: 'test', name: 'Test', style: 'custom', seed: 1, players: { min: 3, max: 4 }, victoryTarget: 10,
    tiles, harbors: [], rivers: [], islands: [], features: [], allowSeparateIslands: false, meta: { generatorVersion: 1 },
    ...overrides
  });
}

/** Recompute islandId and island infos from tiles and rivers, so fixtures stay consistent after edits. */
export function finish(def: MapDefinition): MapDefinition {
  const regions = computeRegions(def);
  const counts = new Map<number, number>();
  const tiles = def.tiles.map(tile => {
    if (tile.kind === 'water') return { ...tile, islandId: 0 };
    const id = regions.get(key(tile))!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return { ...tile, islandId: id };
  });
  const islands = [...counts].sort(([a], [b]) => a - b).map(([id, tileCount]) => ({ id, tileCount, specialVP: 0 }));
  return { ...def, tiles, islands };
}

export { neighbor };
