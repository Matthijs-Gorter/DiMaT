import type { MapDefinition, MapTile } from './types.js';

export const BEGINNER_MAP_CODE = 'BEGINR';
export const BEGINNER_MAP_VERSION = 1;

const tiles: MapTile[] = [
  { q: 0, r: -2, kind: 'brick', number: 11, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 1, r: -2, kind: 'lumber', number: 10, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 2, r: -2, kind: 'wool', number: 8, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -1, r: -1, kind: 'grain', number: 9, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 0, r: -1, kind: 'lumber', number: 5, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 1, r: -1, kind: 'lumber', number: 2, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 2, r: -1, kind: 'ore', number: 9, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -2, r: 0, kind: 'lumber', number: 8, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -1, r: 0, kind: 'grain', number: 12, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 0, r: 0, kind: 'wool', number: 3, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 1, r: 0, kind: 'grain', number: 3, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 2, r: 0, kind: 'brick', number: 11, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -2, r: 1, kind: 'grain', number: 4, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -1, r: 1, kind: 'wool', number: 10, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 0, r: 1, kind: 'wool', number: 4, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 1, r: 1, kind: 'ore', number: 6, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -2, r: 2, kind: 'brick', number: 5, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: -1, r: 2, kind: 'ore', number: 6, islandId: 0, fixedKind: true, fixedNumber: true },
  { q: 0, r: 2, kind: 'desert', number: null, islandId: 0, fixedKind: true, fixedNumber: true }
];

const definition: MapDefinition = {
  schemaVersion: 1, id: 'dimat-beginner-v1', name: 'Beginnerskaart', style: 'base', seed: 1,
  players: { min: 3, max: 4 }, victoryTarget: 10, tiles,
  harbors: [
    { id: 0, kind: 'brick', ratio: 2, tile: { q: 2, r: -2 }, side: 0 },
    { id: 1, kind: 'wool', ratio: 2, tile: { q: 2, r: 0 }, side: 5 },
    { id: 2, kind: 'generic', ratio: 3, tile: { q: 1, r: 1 }, side: 1 },
    { id: 3, kind: 'generic', ratio: 3, tile: { q: 0, r: 2 }, side: 2 },
    { id: 4, kind: 'generic', ratio: 3, tile: { q: -2, r: 2 }, side: 1 },
    { id: 5, kind: 'generic', ratio: 3, tile: { q: -2, r: 1 }, side: 3 },
    { id: 6, kind: 'ore', ratio: 2, tile: { q: -2, r: 0 }, side: 4 },
    { id: 7, kind: 'grain', ratio: 2, tile: { q: 0, r: -2 }, side: 3 },
    { id: 8, kind: 'lumber', ratio: 2, tile: { q: 1, r: -2 }, side: 5 }
  ],
  rivers: [], islands: [{ id: 0, tileCount: 19, specialVP: 0 }], features: [], allowSeparateIslands: false,
  meta: { generatorVersion: BEGINNER_MAP_VERSION, options: { fixedLayout: true, description: 'Hand-tuned fixed board for learning the base game.' } }
};

/** Return a fresh copy so a room or editor cannot mutate the bundled canonical map. */
export function getBeginnerMap(): MapDefinition { return structuredClone(definition); }
