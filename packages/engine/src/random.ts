export interface RandomResult { value: number; state: number; }
export function nextUint32(state: number): RandomResult {
  let x = state >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  x >>>= 0;
  return { value: x, state: x || 0x9e3779b9 };
}
export function randomInt(state: number, maxExclusive: number): RandomResult {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) throw new RangeError('maxExclusive must be positive');
  const next = nextUint32(state);
  return { value: next.value % maxExclusive, state: next.state };
}
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; state: number } {
  const result = [...items]; let state = seed >>> 0 || 0x9e3779b9;
  for (let i = result.length - 1; i > 0; i--) {
    const draw = randomInt(state, i + 1); state = draw.state;
    [result[i], result[draw.value]] = [result[draw.value]!, result[i]!];
  }
  return { items: result, state };
}
