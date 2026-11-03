import { describe, expect, it } from 'vitest';
import { buildBoard, MapBuildError, vertexKey } from '../src/build-board.js';
import { createBoard } from '../../engine/src/board.js';
import { discMap, finish } from './fixtures.js';

describe('buildBoard', () => {
  it('builds the standard 19 tile graph: 54 vertices, 72 edges, 30 coast edges', () => {
    const board = buildBoard(discMap(2));
    expect(board.tiles.length).toBe(19);
    expect(board.vertices.length).toBe(54);
    expect(board.edges.length).toBe(72);
    expect(board.edges.filter(e => e.kind === 'coast').length).toBe(30);
    expect(board.edges.filter(e => e.kind === 'land').length).toBe(42);
    expect(board.desertTile).not.toBeNull();
  });
  it('shares vertices and edges exactly once with consistent adjacency', () => {
    const board = buildBoard(discMap(3));
    for (const tile of board.tiles) {
      expect(new Set(tile.vertices).size).toBe(6);
      expect(new Set(tile.edges).size).toBe(6);
      tile.edges.forEach((edgeId, side) => {
        const edge = board.edges[edgeId]!;
        expect(edge.tiles).toContain(tile.id);
        expect(edge.vertices).toContain(tile.vertices[side]);
        expect(edge.vertices).toContain(tile.vertices[(side + 1) % 6]);
      });
    }
    for (const vertex of board.vertices) {
      expect(vertex.tiles.length).toBeGreaterThanOrEqual(1);
      expect(vertex.tiles.length).toBeLessThanOrEqual(3);
      expect(vertex.edges.length).toBeGreaterThanOrEqual(2);
      expect(vertex.edges.length).toBeLessThanOrEqual(3);
    }
  });
  it('uses regular equally spaced pointy-top corners (edge length 2 in physical units)', () => {
    const board = buildBoard(discMap(2));
    for (const edge of board.edges) {
      const [a, b] = edge.vertices.map(id => board.vertices[id]!) as [typeof board.vertices[number], typeof board.vertices[number]];
      expect(Math.hypot((a.x - b.x) * Math.sqrt(3), a.y - b.y)).toBeCloseTo(2, 6);
    }
  });
  it('matches the legacy radius-2 board topology independent of graph ids', () => {
    const mapped = buildBoard(discMap(2));
    const legacy = createBoard(1).board;
    expect(mapped.tiles).toHaveLength(legacy.tiles.length);
    expect(mapped.vertices).toHaveLength(legacy.vertices.length);
    expect(mapped.edges).toHaveLength(legacy.edges.length);
    expect(mapped.edges.filter(edge => edge.kind === 'coast')).toHaveLength(30);

    const vertexCoordinates = (board: typeof mapped, ids: number[]) =>
      ids.map(id => `${board.vertices[id]!.x},${board.vertices[id]!.y}`).sort();
    const legacyVertexCoordinates = (ids: number[]) =>
      ids.map(id => `${legacy.vertices[id]!.x},${legacy.vertices[id]!.y}`).sort();
    const mappedTiles = new Map(mapped.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    for (const tile of legacy.tiles) {
      expect(vertexCoordinates(mapped, mappedTiles.get(`${tile.q},${tile.r}`)!.vertices))
        .toEqual(legacyVertexCoordinates(tile.vertices));
    }

    const edgeKey = (board: typeof mapped, edge: typeof mapped.edges[number]) =>
      edge.vertices.map(id => `${board.vertices[id]!.x},${board.vertices[id]!.y}`).sort().join('|');
    const mappedEdges = new Map(mapped.edges.map(edge => [edgeKey(mapped, edge), edge.kind]));
    for (const edge of legacy.edges) {
      const key = legacyVertexCoordinates(edge.vertices).join('|');
      expect(mappedEdges.get(key)).toBe(edge.tiles.length === 1 ? 'coast' : 'land');
    }
  });
  it('is deterministic', () => {
    expect(JSON.stringify(buildBoard(discMap(2)))).toBe(JSON.stringify(buildBoard(discMap(2))));
  });
  it('ignores water tiles and marks their borders as coast', () => {
    const base = discMap(2);
    const tiles = base.tiles.map(t => (t.q === 1 && t.r === 0 ? { ...t, kind: 'water' as const, number: null } : t));
    const board = buildBoard(finish({ ...base, tiles }));
    expect(board.tiles.length).toBe(18);
    expect(board.edges.filter(e => e.kind === 'coast').length).toBeGreaterThan(30);
  });
  it('marks river edges and attaches harbors to both vertices of a coast edge', () => {
    const base = discMap(2);
    const def = finish({ ...base, rivers: [{ tile: { q: 0, r: 0 }, side: 0 }], harbors: [{ id: 0, kind: 'generic', ratio: 3, tile: { q: 2, r: 0 }, side: 0 }] });
    const board = buildBoard(def);
    expect(board.edges.filter(e => e.kind === 'river').length).toBe(1);
    const river = board.edges.find(e => e.kind === 'river')!;
    expect(river.tiles.length).toBe(2);
    expect(board.vertices.filter(v => v.harbor).length).toBe(2);
    const harbored = board.vertices.filter(v => v.harbor).map(v => `${v.x},${v.y}`).sort();
    expect(harbored).toEqual([vertexKey(2, 0, 0), vertexKey(2, 0, 1)].sort());
  });
  it('throws a typed error for dangling references', () => {
    const base = discMap(2);
    expect(() => buildBoard({ ...base, rivers: [{ tile: { q: 9, r: 9 }, side: 0 }] })).toThrow(MapBuildError);
    expect(() => buildBoard({ ...base, rivers: [{ tile: { q: 2, r: 0 }, side: 0 }] })).toThrow(MapBuildError); // coast edge
    expect(() => buildBoard({ ...base, harbors: [{ id: 0, kind: 'generic', ratio: 3, tile: { q: 0, r: 0 }, side: 0 }] })).toThrow(MapBuildError); // inner edge
  });
});
