import { describe, expect, it } from 'vitest';
import { key, neighbor } from '../src/hex.js';
import { checkCounts, checkDesertPlacement, checkHarbors, checkIslands, checkNoAdjacentRed, checkRivers, checkShape, checkStartSpots, computeRegions, validateMap } from '../src/validate.js';
import { assignNumbers } from '../src/balance.js';
import { Rng } from '../src/rng.js';
import type { MapDefinition, MapRiverEdge } from '../src/types.js';
import { discMap, finish } from './fixtures.js';

const withTile = (def: MapDefinition, q: number, r: number, patch: Record<string, unknown>) =>
  finish({ ...def, tiles: def.tiles.map(t => (t.q === q && t.r === r ? { ...t, ...patch } : t)) });

/** A river along the row boundary r=0 | r=1: splits a radius-2 disc into regions of 12 and 7 tiles. */
function splitRiver(def: MapDefinition): MapRiverEdge[] {
  const exists = new Set(def.tiles.map(key));
  const rivers: MapRiverEdge[] = [];
  for (const tile of def.tiles.filter(t => t.r === 0)) for (const side of [1, 2] as const) {
    if (exists.has(key(neighbor(tile, side)))) rivers.push({ tile: { q: tile.q, r: tile.r }, side });
  }
  return rivers;
}

describe('validateMap', () => {
  it('accepts a plain radius 2 disc', () => {
    const result = validateMap(discMap(2));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it('accepts a large map up to the cap and rejects one above it', () => {
    expect(validateMap(discMap(6)).ok).toBe(true); // 127 tiles
    const tooBig = validateMap(discMap(7)); // 169 tiles
    expect(tooBig.ok).toBe(false);
    expect(tooBig.errors.join()).toMatch(/maximum is 150/);
    expect(validateMap(discMap(7), { maxLandTiles: 200 }).ok).toBe(true);
  });
});

describe('checkShape', () => {
  const run = (def: MapDefinition) => checkShape(def, {}).errors.join('\n');
  it('flags duplicates, bad numbers, unknown kinds and disabled features', () => {
    const base = discMap(2);
    expect(run({ ...base, tiles: [...base.tiles, base.tiles[0]!] })).toMatch(/duplicate tile/);
    expect(run(withTile(base, 1, 0, { number: null }))).toMatch(/no number token/);
    expect(run(withTile(base, 1, 0, { number: 7 }))).toMatch(/invalid number 7/);
    expect(run(withTile(base, 0, 0, { number: 5 }))).toMatch(/must not have a number/);
    expect(run(withTile(base, 1, 0, { kind: 'lava' }))).toMatch(/unknown kind/);
    expect(run(withTile(base, 1, 0, { kind: 'gold' }))).toMatch(/feature/);
    expect(checkShape(withTile({ ...base, features: ['gold'] }, 1, 0, { kind: 'gold', number: null }), {}).errors.join()).not.toMatch(/feature/);
  });
  it('requires deterministic tile order', () => {
    const base = discMap(1);
    expect(run({ ...base, tiles: [...base.tiles].reverse() })).toMatch(/deterministic order/);
  });
  it('rejects maps without land', () => {
    expect(run(finish({ ...discMap(1), tiles: discMap(1).tiles.map(t => ({ ...t, kind: 'water' as const, number: null })) }))).toMatch(/no land/);
  });
});

describe('checkNoAdjacentRed', () => {
  const adjacentReds = () => withTile(withTile(discMap(2), 1, 0, { kind: 'brick', number: 6 }), 2, 0, { kind: 'ore', number: 8 });
  it('is an error for generated maps and a warning for custom maps', () => {
    const def = { ...adjacentReds(), style: 'standard' as const };
    expect(checkNoAdjacentRed(def, {}).errors.length).toBe(1);
    const custom = checkNoAdjacentRed(def, { custom: true });
    expect(custom.errors).toEqual([]);
    expect(custom.warnings.length).toBe(1);
  });
  it('accepts 6 and 8 that do not touch', () => {
    const def = withTile(withTile(discMap(2), 1, 0, { kind: 'brick', number: 6 }), -1, 0, { kind: 'ore', number: 8 });
    expect(checkNoAdjacentRed(def, {}).errors).toEqual([]);
  });
});

describe('checkCounts', () => {
  it('checks generated resource and number distributions exactly', () => {
    const base = discMap(2);
    const resourceKinds = ['brick', 'brick', 'brick', 'lumber', 'lumber', 'lumber', 'lumber', 'wool', 'wool', 'wool', 'wool', 'grain', 'grain', 'grain', 'grain', 'ore', 'ore', 'ore'] as const;
    let resourceIndex = 0;
    const tiles = base.tiles.map(tile => tile.kind === 'desert' ? tile : { ...tile, kind: resourceKinds[resourceIndex++]! });
    const numbered = assignNumbers(tiles, new Rng(123));
    const generated = { ...base, style: 'standard' as const, tiles: numbered };
    expect(checkCounts(generated, {}).errors).toEqual([]);
    const badTokens = { ...generated, tiles: generated.tiles.map(tile => tile.kind === 'desert' ? tile : { ...tile, number: 2 }) };
    expect(checkCounts(badTokens, {}).errors).toContain('number token distribution does not match the scaled token supply');
  });

  it('allows custom terrain counts within one tile and warns about relaxed counts', () => {
    const base = discMap(2);
    const custom = {
      ...base,
      tiles: base.tiles.map((tile, index) => index === 1 ? { ...tile, kind: 'brick' as const } : tile)
    };
    const result = checkCounts(custom, {});
    expect(result.errors).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });
});

describe('checkStartSpots', () => {
  it('skips fairness checks for random maps and checks the configured player count for balanced maps', () => {
    const base = discMap(2);
    expect(checkStartSpots(base, { balance: 'random' })).toEqual({ errors: [], warnings: [] });
    const rich = {
      ...base,
      tiles: base.tiles.map(tile => (tile.kind === 'desert' ? tile : { ...tile, number: 6 }))
    };
    expect(checkStartSpots(rich, { balance: 'balanced', players: 3 }).errors).toEqual([]);
    expect(checkStartSpots(discMap(1), { balance: 'balanced', players: 8 }).errors.join()).toMatch(/fewer than 16 non-adjacent legal setup vertices/);
  });
});

describe('checkDesertPlacement', () => {
  it('rejects clusters of more than two adjacent deserts', () => {
    const base = discMap(2);
    const desertKeys = new Set(['0,0', '1,0', '0,1', '1,-1']);
    const tiles = base.tiles.map(tile => desertKeys.has(key(tile))
      ? { ...tile, kind: 'desert' as const, number: null }
      : tile);
    expect(checkDesertPlacement({ ...base, tiles }, {}).errors.join()).toMatch(/maximum 2/);
  });

  it('requires each desert to touch at least one other land tile', () => {
    const base = discMap(1);
    const tiles = base.tiles.map(tile => tile.q === 0 && tile.r === 0
      ? { ...tile, kind: 'desert' as const, number: null }
      : { ...tile, kind: 'water' as const, number: null });
    expect(checkDesertPlacement({ ...base, tiles }, {}).errors.join()).toMatch(/no non-desert land neighbor/);
  });
});

describe('connectivity and islands', () => {
  const twoIslands = (): MapDefinition => {
    const base = discMap(2);
    // remove the whole q=0 column except nothing: carve a water wall at r=0 row ... easier: make a far island
    const far = [{ q: 6, r: 0 }, { q: 7, r: 0 }, { q: 6, r: 1 }].map((a, i) => ({ ...a, kind: 'lumber' as const, number: [2, 3, 4][i]!, islandId: 0 }));
    return finish({ ...base, tiles: [...base.tiles, ...far].sort((a, b) => a.r - b.r || a.q - b.q) });
  };
  it('rejects separate islands unless allowed', () => {
    expect(validateMap(twoIslands()).errors.join()).toMatch(/separate islands/);
    expect(validateMap({ ...twoIslands(), allowSeparateIslands: true }).ok).toBe(true);
  });
  it('numbers regions largest first', () => {
    const regions = computeRegions(twoIslands());
    expect(regions.get('0,0')).toBe(0);
    expect(regions.get('6,0')).toBe(1);
  });
  it('flags wrong island ids and tiny regions', () => {
    const base = discMap(2);
    const wrong = { ...base, tiles: base.tiles.map(t => (t.q === 1 && t.r === 0 ? { ...t, islandId: 5 } : t)) };
    expect(checkIslands(wrong, {}).errors.join()).toMatch(/islandId 5/);
    const tiny = { ...twoIslands(), allowSeparateIslands: true, tiles: twoIslands().tiles.filter(t => t.q !== 7) };
    expect(checkIslands(finish(tiny), {}).errors.join()).toMatch(/only 2 tiles/);
  });
  it('flags island infos that disagree with the tiles', () => {
    const def = { ...discMap(2), islands: [{ id: 0, tileCount: 3, specialVP: 0 }] };
    expect(checkIslands(def, {}).errors.join()).toMatch(/declares 3 tiles, actual 19/);
  });
});

describe('rivers', () => {
  it('splits a landmass into regions without breaking connectivity', () => {
    const base = discMap(2);
    const def = finish({ ...base, rivers: splitRiver(base) });
    expect(new Set(computeRegions(def).values()).size).toBe(2);
    expect(def.islands.map(i => i.tileCount)).toEqual([12, 7]);
    const result = validateMap(def);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).not.toMatch(/decoration/);
  });
  it('warns when a river separates nothing', () => {
    const def = finish({ ...discMap(2), rivers: [{ tile: { q: 0, r: 0 }, side: 0 }] });
    expect(checkRivers(def, {}).warnings.join()).toMatch(/decoration/);
  });
  it('rejects rivers on water, on the coast, duplicated or with a bad side', () => {
    const base = discMap(2);
    expect(checkRivers({ ...base, rivers: [{ tile: { q: 9, r: 9 }, side: 0 }] }, {}).errors.join()).toMatch(/not on a land tile/);
    expect(checkRivers({ ...base, rivers: [{ tile: { q: 2, r: 0 }, side: 0 }] }, {}).errors.join()).toMatch(/not between two land tiles/);
    const dup: MapRiverEdge[] = [{ tile: { q: 0, r: 0 }, side: 0 }, { tile: { q: 1, r: 0 }, side: 3 }];
    expect(checkRivers({ ...base, rivers: dup }, {}).errors.join()).toMatch(/listed twice/);
    expect(checkRivers({ ...base, rivers: [{ tile: { q: 0, r: 0 }, side: 7 as 0 }] }, {}).errors.join()).toMatch(/invalid side/);
  });
});

describe('harbors', () => {
  const harbor = (id: number, q: number, r: number, side: 0 | 1 | 2 | 3 | 4 | 5, kind: 'generic' | 'ore' = 'generic') =>
    ({ id, kind, ratio: (kind === 'generic' ? 3 : 2) as 2 | 3, tile: { q, r }, side });
  it('accepts well spaced coast harbors', () => {
    const def = { ...discMap(2), harbors: [harbor(0, 2, 0, 0), harbor(1, -2, 0, 3, 'ore')] };
    expect(checkHarbors(def, {}).errors).toEqual([]);
  });
  it('rejects inner edges, wrong ratios, duplicate ids and shared vertices', () => {
    const base = discMap(2);
    expect(checkHarbors({ ...base, harbors: [harbor(0, 0, 0, 0)] }, {}).errors.join()).toMatch(/not on a coast edge/);
    expect(checkHarbors({ ...base, harbors: [{ ...harbor(0, 2, 0, 0), ratio: 2 }] }, {}).errors.join()).toMatch(/ratio 2/);
    expect(checkHarbors({ ...base, harbors: [harbor(0, 2, 0, 0), harbor(0, -2, 0, 3)] }, {}).errors.join()).toMatch(/duplicate id/);
    // (2,0) side 0 and (2,0) side 1 meet at corner 1
    expect(checkHarbors({ ...base, harbors: [harbor(0, 2, 0, 0), harbor(1, 2, 0, 1)] }, {}).errors.join()).toMatch(/shares a vertex/);
    expect(checkHarbors({ ...base, harbors: [harbor(0, 7, 7, 0)] }, {}).errors.join()).toMatch(/not on a land tile/);
  });
});
