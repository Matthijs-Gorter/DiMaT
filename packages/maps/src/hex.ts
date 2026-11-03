// Axial hex math, pointy-top, matching the engine lattice: vertex x = 2q + r (+ corner), y = 3r (+ corner).

export interface Axial { q: number; r: number; }

export const key = (a: Axial): string => `${a.q},${a.r}`;

/** Neighbour directions. Index i is the neighbour across the edge between corner i and corner i+1
 *  (corners as in CORNER_OFFSETS: 0 = right-top, 1 = right-bottom, 2 = bottom, 3 = left-bottom, 4 = left-top, 5 = top). */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },   // side 0: east
  { q: 0, r: 1 },   // side 1: south-east
  { q: -1, r: 1 },  // side 2: south-west
  { q: -1, r: 0 },  // side 3: west
  { q: 0, r: -1 },  // side 4: north-west
  { q: 1, r: -1 }   // side 5: north-east
];

/** Corner offsets (in lattice units) of a hex, ordered so corner i to i+1 is side i. */
export const CORNER_OFFSETS: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2]];

export const neighbor = (a: Axial, side: number): Axial => {
  const d = DIRECTIONS[((side % 6) + 6) % 6]!;
  return { q: a.q + d.q, r: a.r + d.r };
};
export const neighbors = (a: Axial): Axial[] => DIRECTIONS.map((_, side) => neighbor(a, side));

export const oppositeSide = (side: number): number => (side + 3) % 6;

/** Axial -> cube s coordinate; distance in hex steps. */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** Tiles at exactly `radius` steps from `center`, clockwise starting at the north-east corner tile.
 *  Deterministic order. */
export function ring(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [{ ...center }];
  const result: Axial[] = [];
  const ne = DIRECTIONS[5]!;
  let current: Axial = { q: center.q + ne.q * radius, r: center.r + ne.r * radius };
  for (const side of [1, 2, 3, 4, 5, 0]) {
    for (let step = 0; step < radius; step++) {
      result.push(current);
      current = neighbor(current, side);
    }
  }
  return result;
}

/** All tiles within `radius` of `center`, ordered r ascending then q ascending. */
export function disc(center: Axial, radius: number): Axial[] {
  const result: Axial[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dq = Math.max(-radius, -radius - dr); dq <= Math.min(radius, radius - dr); dq++) {
      result.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return result;
}

/** Odd-r offset (rows shifted right when odd) conversions, used by the ASCII map format. */
export function fromOffsetOddR(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}
export function toOffsetOddR(a: Axial): { col: number; row: number } {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r };
}

/** Pixel position of a tile centre (pointy-top, circumradius `size`). */
export function cartesian(a: Axial, size = 2): [number, number] {
  return [size * Math.sqrt(3) * (a.q + a.r / 2), size * 1.5 * a.r];
}

/** Connected components of a tile set. Components are sorted by size (desc), then by smallest key;
 *  tiles inside a component are sorted by (r, q). `blocked(a, side)` may forbid stepping across a side. */
export function connectedComponents(tiles: readonly Axial[], blocked?: (a: Axial, side: number) => boolean): Axial[][] {
  const byKey = new Map(tiles.map(t => [key(t), t] as const));
  const seen = new Set<string>();
  const components: Axial[][] = [];
  const ordered = [...tiles].sort((a, b) => a.r - b.r || a.q - b.q);
  for (const start of ordered) {
    if (seen.has(key(start))) continue;
    const component: Axial[] = [];
    const stack: Axial[] = [start];
    seen.add(key(start));
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (let side = 0; side < 6; side++) {
        if (blocked?.(current, side)) continue;
        const next = byKey.get(key(neighbor(current, side)));
        if (!next || seen.has(key(next))) continue;
        seen.add(key(next));
        stack.push(next);
      }
    }
    component.sort((a, b) => a.r - b.r || a.q - b.q);
    components.push(component);
  }
  const smallest = (c: Axial[]) => key(c[0]!);
  return components.sort((a, b) => b.length - a.length || smallest(a).localeCompare(smallest(b)));
}
