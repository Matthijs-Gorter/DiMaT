// Seeded RNG for map generation. The xorshift32 algorithm is identical to
// packages/engine/src/random.ts (same constants) so that outputs can be cross-checked,
// but this package must not import the engine (dependency direction: engine -> maps).

export interface RandomResult { value: number; state: number; }

const FALLBACK_STATE = 0x9e3779b9;

export function nextUint32(state: number): RandomResult {
  let x = state >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  x >>>= 0;
  return { value: x, state: x || FALLBACK_STATE };
}

/** FNV-1a (32 bit) of `${seed}:${label}`. Never returns 0, so it is always a valid RNG state. */
export function hashSeed(seed: number, label: string): number {
  let hash = 2166136261;
  for (const char of `${seed >>> 0}:${label}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) || FALLBACK_STATE;
}

/** Small stateful wrapper around the pure generator. One instance per sub-stream. */
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || FALLBACK_STATE; }

  next(): number {
    const draw = nextUint32(this.state);
    this.state = draw.state;
    return draw.value;
  }
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) throw new RangeError('maxExclusive must be a positive integer');
    return this.next() % maxExclusive;
  }
  /** Float in [0, 1). */
  float(): number { return this.next() / 4294967296; }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty array');
    return items[this.int(items.length)]!;
  }
  /** Fisher-Yates, same iteration order as the engine's shuffle. Returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    const weights = items.map(weight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!(total > 0)) throw new RangeError('weights must sum to a positive number');
    let roll = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }
}

export function makeRng(seed: number, label: string): Rng {
  return new Rng(hashSeed(seed, label));
}
