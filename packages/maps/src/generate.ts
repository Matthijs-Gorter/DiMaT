import { BalanceError, assignNumbers, balanceResources, placeHarbors, scaleResourceCounts } from './balance.js';
import { generateTerrain, GenerationError, type TerrainOptions, type TerrainStyle } from './generators.js';
import { makeRng } from './rng.js';
import { computeRegions, validateMap } from './validate.js';
import { RESOURCES, type MapDefinition, type MapTile, type Resource } from './types.js';

export const GENERATOR_VERSION = 2;

export interface GenerateOptions extends TerrainOptions {
  style: TerrainStyle;
  seed: number;
  players: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  balance: 'random' | 'balanced';
  avoidAdjacentRed?: boolean;
  victoryTarget?: number;
  maxAttempts?: number;
}

export function generateMap(options: GenerateOptions): MapDefinition {
  if (!Number.isSafeInteger(options.seed)) throw new RangeError('seed must be a safe integer');
  if (!Number.isInteger(options.players) || options.players < 2 || options.players > 8) throw new RangeError('players must be from 2 to 8');
  const maxAttempts = options.maxAttempts ?? 64;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) throw new RangeError('maxAttempts must be from 1 to 1000');

  let lastFailure = 'no generation attempt completed';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const terrainOptions: TerrainOptions = {
        players: options.players,
        ...(options.landTarget === undefined ? {} : { landTarget: options.landTarget }),
        ...(options.islandCount === undefined ? {} : { islandCount: options.islandCount }),
        ...(options.riverCount === undefined ? {} : { riverCount: options.riverCount }),
        ...(options.lakeCount === undefined ? {} : { lakeCount: options.lakeCount }),
        ...(options.innerRadius === undefined ? {} : { innerRadius: options.innerRadius }),
        ...(options.compactness === undefined ? {} : { compactness: options.compactness })
      };
      const terrain = generateTerrain(options.style, terrainOptions, makeRng(options.seed, `terrain:${attempt}`));
      const counts = scaleResourceCounts(terrain.land.length, options.players);
      const resourceRng = makeRng(options.seed, `resources:${attempt}`);
      const resourceTiles = terrain.land.length - counts.desert;
      if (options.style === 'random' && resourceTiles < RESOURCES.length) throw new GenerationError('random maps need at least one tile for each resource type');
      const kinds: Resource[] = options.style === 'random'
        ? [...RESOURCES, ...Array.from({ length: Math.max(0, resourceTiles - RESOURCES.length) }, () => resourceRng.pick(RESOURCES))]
        : [
          ...Array<Resource>(counts.brick).fill('brick'),
          ...Array<Resource>(counts.lumber).fill('lumber'),
          ...Array<Resource>(counts.wool).fill('wool'),
          ...Array<Resource>(counts.grain).fill('grain'),
          ...Array<Resource>(counts.ore).fill('ore')
        ];
      const resourceKinds = resourceRng.shuffle(kinds);
      let resourceIndex = 0;
      const land: MapTile[] = terrain.land.map(tile => ({
        ...tile,
        kind: resourceIndex < resourceKinds.length ? resourceKinds[resourceIndex++]! : 'desert',
        number: null,
        islandId: 0
      }));
      const balancedResources = options.balance === 'balanced' && options.style !== 'random'
        ? balanceResources(land, makeRng(options.seed, `resource-balance:${attempt}`))
        : land;
      const tiles = assignNumbers([
        ...balancedResources,
        ...terrain.water.map(tile => ({ ...tile, kind: 'water' as const, number: null, islandId: 0 }))
      ], makeRng(options.seed, `numbers:${attempt}`), options.avoidAdjacentRed ?? options.style !== 'random');
      const definition: MapDefinition = {
        schemaVersion: 1,
        id: `generated-${options.style}-${options.seed}`,
        name: `${options.style} ${options.seed}`,
        style: options.style,
        seed: options.seed,
        players: { min: 2, max: 8 },
        victoryTarget: options.victoryTarget ?? 10,
        tiles: tiles.sort((a, b) => a.r - b.r || a.q - b.q),
        harbors: [],
        rivers: terrain.rivers,
        islands: [],
        features: [],
        allowSeparateIslands: options.style === 'archipelago',
        meta: {
          generatorVersion: GENERATOR_VERSION,
          attempts: attempt + 1,
          options: {
            balance: options.balance,
            avoidAdjacentRed: options.avoidAdjacentRed ?? options.style !== 'random',
            ...(options.landTarget === undefined ? {} : { landTarget: options.landTarget }),
            ...(options.islandCount === undefined ? {} : { islandCount: options.islandCount }),
            ...(options.riverCount === undefined ? {} : { riverCount: options.riverCount }),
            ...(options.lakeCount === undefined ? {} : { lakeCount: options.lakeCount }),
            ...(options.innerRadius === undefined ? {} : { innerRadius: options.innerRadius }),
            ...(options.compactness === undefined ? {} : { compactness: options.compactness })
          }
        }
      };
      const regions = computeRegions(definition);
      const islandSizes = new Map<number, number>();
      definition.tiles = definition.tiles.map(tile => {
        if (tile.kind === 'water') return tile;
        const islandId = regions.get(`${tile.q},${tile.r}`)!;
        islandSizes.set(islandId, (islandSizes.get(islandId) ?? 0) + 1);
        return { ...tile, islandId };
      });
      definition.islands = [...islandSizes].sort(([a], [b]) => a - b)
        .map(([id, tileCount]) => ({ id, tileCount, specialVP: 0 }));
      const withHarbors = placeHarbors(definition, makeRng(options.seed, `harbors:${attempt}`), options.players);
      const validation = validateMap(withHarbors, {
        balance: options.balance,
        players: options.players,
        startSpreadMax: 5,
        minIslandSize: options.style === 'archipelago' ? 4 : 3,
        avoidAdjacentRed: options.avoidAdjacentRed ?? options.style !== 'random'
      });
      if (validation.ok) return withHarbors;
      lastFailure = validation.errors.join('; ');
    } catch (error) {
      if (!(error instanceof BalanceError) && !(error instanceof GenerationError)) throw error;
      lastFailure = error.message;
    }
  }
  throw new GenerationError(`failed to generate ${options.style} map for seed ${options.seed} after ${maxAttempts} attempts: ${lastFailure}`);
}
