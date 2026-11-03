import { describe, expect, it } from 'vitest';
import { Rng, hashSeed, nextUint32 } from '../src/rng.js';

// Expected values were recorded from packages/engine/src/random.ts (the maps package may not import the engine).
describe('rng', () => {
  it('matches the engine xorshift32 sequence', () => {
    let state = 42; const values: number[] = [];
    for (let i = 0; i < 5; i++) { const draw = nextUint32(state); values.push(draw.value); state = draw.state; }
    expect(values).toEqual([11355432, 2836018348, 476557059, 3648046016, 3759983556]);
  });
  it('shuffles exactly like the engine', () => {
    expect(new Rng(42).shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([8, 9, 1, 5, 4, 0, 6, 3, 7, 2]);
  });
  it('draws ints like the engine randomInt', () => {
    const rng = new Rng(7);
    expect(Array.from({ length: 6 }, () => rng.int(10))).toEqual([3, 5, 7, 5, 7, 6]);
  });
  it('is deterministic and independent per label', () => {
    expect(hashSeed(1, 'terrain')).toBe(hashSeed(1, 'terrain'));
    expect(hashSeed(1, 'terrain')).not.toBe(hashSeed(1, 'numbers'));
    expect(hashSeed(0, '')).not.toBe(0);
  });
  it('keeps float in [0, 1) and weightedPick inside the list', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) { const f = rng.float(); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1); }
    for (let i = 0; i < 200; i++) expect(['a', 'b', 'c']).toContain(rng.weightedPick(['a', 'b', 'c'], x => (x === 'b' ? 5 : 1)));
    expect(() => new Rng(1).weightedPick(['a'], () => 0)).toThrow();
    expect(() => new Rng(1).int(0)).toThrow();
  });
});
