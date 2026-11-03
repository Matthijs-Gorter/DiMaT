import { CORNER_OFFSETS, key as tileKey } from './hex.js';
import type { BoardData, BoardEdge, BoardTile, BoardVertex, MapDefinition } from './types.js';

export class MapBuildError extends Error {
  constructor(message: string) { super(message); this.name = 'MapBuildError'; }
}

/** Lattice coordinates of corner `corner` of tile (q, r). Same lattice as the engine's reprojected vertices. */
export function cornerPoint(q: number, r: number, corner: number): [number, number] {
  const offset = CORNER_OFFSETS[corner]!;
  return [2 * q + r + offset[0], 3 * r + offset[1]];
}
export const vertexKey = (q: number, r: number, corner: number): string => cornerPoint(q, r, corner).join(',');

/**
 * Build the integer-id graph for the land tiles of a map. Ids follow definition order: tiles by
 * their position among land tiles, vertices and edges by first encounter (tile order, then corner order).
 * Water tiles create no graph elements. Throws MapBuildError on dangling harbor or river references.
 */
export function buildBoard(def: MapDefinition): BoardData {
  const landDefs = def.tiles.filter(tile => tile.kind !== 'water');
  const tileIdByKey = new Map<string, number>();
  landDefs.forEach((tile, index) => tileIdByKey.set(tileKey(tile), index));

  const vertices: BoardVertex[] = [];
  const vertexIdByKey = new Map<string, number>();
  const edges: BoardEdge[] = [];
  const edgeIdByKey = new Map<string, number>();
  const tiles: BoardTile[] = [];

  landDefs.forEach((tile, tileId) => {
    const cornerIds: number[] = [];
    for (let corner = 0; corner < 6; corner++) {
      const [x, y] = cornerPoint(tile.q, tile.r, corner);
      const k = `${x},${y}`;
      let id = vertexIdByKey.get(k);
      if (id === undefined) {
        id = vertices.length;
        vertexIdByKey.set(k, id);
        vertices.push({ id, x, y, edges: [], tiles: [] });
      }
      cornerIds.push(id);
    }
    const edgeIds: number[] = [];
    for (let side = 0; side < 6; side++) {
      const a = cornerIds[side]!, b = cornerIds[(side + 1) % 6]!;
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      let id = edgeIdByKey.get(k);
      if (id === undefined) {
        id = edges.length;
        edgeIdByKey.set(k, id);
        edges.push({ id, vertices: [Math.min(a, b), Math.max(a, b)], tiles: [], kind: 'coast' });
      }
      edges[id]!.tiles.push(tileId);
      edgeIds.push(id);
    }
    tiles.push({
      id: tileId, q: tile.q, r: tile.r, kind: tile.kind as BoardTile['kind'], number: tile.number,
      vertices: cornerIds, edges: edgeIds, islandId: tile.islandId
    });
  });

  for (const edge of edges) {
    edge.kind = edge.tiles.length === 1 ? 'coast' : 'land';
    for (const v of edge.vertices) vertices[v]!.edges.push(edge.id);
  }
  for (const tile of tiles) for (const v of tile.vertices) vertices[v]!.tiles.push(tile.id);

  const resolveEdge = (ref: { tile: { q: number; r: number }; side: number }, label: string): BoardEdge => {
    const tileId = tileIdByKey.get(tileKey(ref.tile));
    if (tileId === undefined) throw new MapBuildError(`${label} references missing or water tile ${tileKey(ref.tile)}`);
    if (!Number.isInteger(ref.side) || ref.side < 0 || ref.side > 5) throw new MapBuildError(`${label} has invalid side ${ref.side}`);
    return edges[tiles[tileId]!.edges[ref.side]!]!;
  };

  for (const river of def.rivers) {
    const edge = resolveEdge(river, `river at ${tileKey(river.tile)}`);
    if (edge.tiles.length !== 2) throw new MapBuildError(`river at ${tileKey(river.tile)} side ${river.side} is not between two land tiles`);
    edge.kind = 'river';
  }

  for (const harbor of def.harbors) {
    const edge = resolveEdge(harbor, `harbor ${harbor.id}`);
    if (edge.tiles.length !== 1) throw new MapBuildError(`harbor ${harbor.id} is not on a coast edge`);
    for (const v of edge.vertices) vertices[v]!.harbor = { id: harbor.id, kind: harbor.kind, ratio: harbor.ratio };
  }

  const desert = tiles.find(tile => tile.kind === 'desert');
  return { tiles, vertices, edges, desertTile: desert ? desert.id : null };
}
