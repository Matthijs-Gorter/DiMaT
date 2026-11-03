// Map schema and board graph types. This package owns the geometry types; the engine's Board
// becomes a structural superset of BoardData when the engine is wired to maps.

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export const RESOURCES: readonly Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** gold and fog are schema-reserved: validators reject them unless `features` lists them. */
export type MapTileKind = Resource | 'desert' | 'water' | 'gold' | 'fog';
export type MapStyle = 'base' | 'standard' | 'continent' | 'archipelago' | 'river' | 'lakes' | 'atoll' | 'irregular' | 'random' | 'custom';
export type EdgeKind = 'land' | 'coast' | 'sea' | 'river';
export type MapSelection =
  | { kind: 'base' }
  | { kind: 'generated'; style: MapStyle; seed?: number; options?: Record<string, unknown> }
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; definition: MapDefinition };

export interface MapTile {
  q: number;
  r: number;
  kind: MapTileKind;
  number: number | null;
  /** Region id: land tiles connected without crossing open water or a river edge. */
  islandId: number;
  fixedNumber?: boolean;
  fixedKind?: boolean;
}

/** A tile side: side i is the edge between hex corner i and corner i+1 (see hex.ts). */
export interface TileSide { q: number; r: number; side: 0 | 1 | 2 | 3 | 4 | 5; }

export interface MapHarbor {
  id: number;
  kind: 'generic' | Resource;
  ratio: 2 | 3;
  tile: { q: number; r: number };
  side: 0 | 1 | 2 | 3 | 4 | 5;
}

/** A river runs along a tile edge between two land tiles. Roads cannot be built on it, bridges can. */
export interface MapRiverEdge { tile: { q: number; r: number }; side: 0 | 1 | 2 | 3 | 4 | 5; }

export interface IslandInfo { id: number; tileCount: number; specialVP: number; }

export interface MapDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  style: MapStyle;
  seed: number;
  players: { min: number; max: number };
  victoryTarget: number;
  /** Land and water tiles in deterministic order: r ascending, then q ascending. */
  tiles: MapTile[];
  harbors: MapHarbor[];
  rivers: MapRiverEdge[];
  islands: IslandInfo[];
  startRestrictions?: Array<{ islandId: number; maxPlayers?: number }>;
  features: Array<'gold' | 'fog' | 'seaTiles'>;
  allowSeparateIslands: boolean;
  meta: { generatorVersion: number; attempts?: number; options?: Record<string, unknown> };
}

// ---- Board graph (output of buildBoard) ----

export interface BoardTile {
  id: number; q: number; r: number; kind: Exclude<MapTileKind, 'water'>; number: number | null;
  vertices: number[]; edges: number[]; islandId: number;
}
export interface BoardVertex {
  id: number; x: number; y: number; edges: number[]; tiles: number[];
  harbor?: { id: number; kind: 'generic' | Resource; ratio: number };
}
export interface BoardEdge { id: number; vertices: [number, number]; tiles: number[]; kind: EdgeKind; }
export interface BoardData {
  tiles: BoardTile[];
  vertices: BoardVertex[];
  edges: BoardEdge[];
  /** First desert tile, or null when the map has none. */
  desertTile: number | null;
}

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[]; }
