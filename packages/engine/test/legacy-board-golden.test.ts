import { describe, expect, it } from 'vitest';
import { createBoard } from '../src/index.js';

// Regression guard: action logs store vertex/edge/tile ids, so the legacy board for a
// given seed must never change. If this test fails, old replays are broken.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function fnv1a(text: string): string {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const GOLDEN: Record<number, string> = {
  1: '571c79a7',
  2: '396d4e75',
  3: 'a8b09eb6',
  42: 'af12d7bb',
  12345: '6e319e3d'
};

describe('legacy board golden hashes', () => {
  for (const [seed, expected] of Object.entries(GOLDEN)) {
    it(`seed ${seed} still builds the same board and rng state`, () => {
      const { board, rngState } = createBoard(Number(seed));
      expect(fnv1a(canonical({ board, rngState }))).toBe(expected);
    });
  }
});
