# Map system and generator: implementation plan for Codex

Task prompt for Phase 3 ("Map system", see `docs/PHASES.md`), extended with a styled map generator, custom map import, a CLI, 3 to 8 player support, and wiring into the engine, protocol, server and web client. Read `AGENTS.md`, `docs/RULES.md` section 12 and `docs/ARCHITECTURE.md` first. Follow the AGENTS.md working rules: one work package at a time, tests first for tricky logic, log every assumption in `docs/DECISIONS.md`, add open questions to `docs/OPEN_QUESTIONS.md`, small commits, and do not stop to ask. Write code, comments and docs in English. Reply to the owner in Dutch.

## 0. Goals and decisions already made by the owner

1. `packages/maps` becomes a real package: data-driven map definitions, seeded generators, validators, custom map import, and a CLI.
2. Generator styles: `standard`, `continent` (one big island), `archipelago` (several islands), `river`, `lakes`, `atoll`. More styles can be added later without touching callers.
3. "River" means a strip of water tiles that splits the land. Fords (land tiles left in the strip) keep the land connected in the base game. It is not a decorative overlay.
4. Player counts 3 to 8 are supported by the map system. 5 to 6 follow the base extension scaling. 7 to 8 have no official rules, so they are `ASSUMPTION`s.
5. The engine, protocol, server and web client use the map system in this same task. The engine's hardcoded `createBoard(seed)` stays available as the `base` map so old replays still reproduce bit for bit.

## 1. Current state (verified in the repo)

- `packages/engine/src/board.ts` hardcodes the 19 tile hex (radius 2), axial `q,r`, pointy-top, builds integer id vertex/edge graphs, and assigns harbors. All edges get `kind: 'land'`. All tiles get `islandId: 0`.
- `packages/engine/src/types.ts`: `Tile`, `Vertex`, `Edge` (`kind: 'land' | 'coast' | 'sea'`), `Board`, `GameSettings { playerCount: 3 | 4; victoryTarget }`, `GameState.board`.
- `packages/engine/src/random.ts`: xorshift32 `nextUint32`, `randomInt`, `shuffle(items, seed) -> { items, state }`.
- `packages/maps` contains only `export {}` and a placeholder test. Its `package.json` has no dependencies.
- `scripts/sim.ts` holds hardcoded invariants (19 cards per resource, 5/4/15 pieces, dev card counts 14/5/2/2/2). The root script is `"sim": "tsx scripts/sim.ts"`.
- Dependencies are installed (`pnpm install --frozen-lockfile` works). Node 22, pnpm 11.

## 2. Architecture decisions

- **Dependency direction:** `engine -> maps`. `maps` must not import `engine`, to avoid a cycle. `maps` owns the board geometry types (`BoardData`) and `buildBoard`. The engine's `Board` type becomes a re-export or structural superset of `BoardData`. Add `"@dimat/maps": "workspace:*"` to `packages/engine`, `packages/protocol`, `apps/server`, `apps/web`, `scripts` consumers as needed, and `exports` in `packages/maps/package.json` (`".": "./src/index.ts"`, same style as the engine).
- **Only land tiles live in the engine `Board`.** Water tiles are kept in the map definition for rendering and for coast detection, but do not create vertices or edges in the gameplay graph in this phase. Edges with exactly one land tile are `coast`. Edges with two land tiles are `land`. The `sea` edge kind stays reserved for Phase 4.
- **Determinism:** no `Math.random`, no `Date.now`, no iteration over unordered `Set`/`Map` where order affects output (use arrays or sort keys). A seed plus options must produce a byte-identical `MapDefinition` on every run. Use sub-streams: `rng = makeRng(hash(seed, 'terrain'))`, then separate streams for `'resources'`, `'numbers'`, `'harbors'`, so changing one stage does not reshuffle the others.
- **Replay compatibility:** `GameSettings` gains `map: MapSelection` (see section 5.1). A missing `map` means legacy `{ kind: 'base' }`, which must call the old `createBoard` path unchanged. A golden test pins the board hash for seeds 1, 2, 3, 42 and 12345, computed before any change is made.
- **No new third party dependencies** in `packages/maps`. Validation is hand-written. Tests use plain Vitest loops over seed ranges.

## 3. Work packages

Do them in order. Each package ends green on `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, and `pnpm sim --games 1000 --seed 1`.

### WP0. Safety net (before changing anything)

1. Add `packages/engine/test/legacy-board-golden.test.ts`: for seeds `[1, 2, 3, 42, 12345]` compute the FNV-1a hash (reuse the canonical JSON hash helper from the server or protocol if one exists, otherwise add a small local one) of `createBoard(seed).board`, and assert against hard-coded constants recorded from the current code. This is the regression guard for "old replays stay valid".
2. Run `pnpm sim --games 1000 --seed 1` and record the result line in `docs/PROJECT_LOG.md` as the baseline.

### WP1. Hex math and RNG (`packages/maps/src/`)

Files: `hex.ts`, `rng.ts`, `types.ts`.

- `rng.ts`: copy the xorshift32 algorithm from the engine exactly (same constants), plus a string/number hash `hashSeed(seed: number, label: string): number` (FNV-1a 32 bit, never returning 0), and a small class or closure `Rng` with `next()`, `int(maxExclusive)`, `float()` (uint32 / 2^32), `pick(array)`, `shuffle(array)` (Fisher-Yates), `weightedPick`. No global state.
- `hex.ts` (axial `q,r`, pointy-top, matching the engine's `x = 2q + r`, `y = 3r` vertex lattice):
  - `type Axial = { q: number; r: number }`, `key(a) = \`${q},${r}\``, `DIRECTIONS` (six neighbours in a fixed documented order), `neighbors(a)`, `distance(a, b)`, `ring(center, radius)`, `disc(center, radius)` in deterministic order, `toCube`, `fromOffsetOddR(col,row)` and `toOffsetOddR(q,r)` for the ASCII format, `cartesian(a, size)` for rendering.
  - `connectedComponents(tiles: Axial[]) -> Axial[][]`, with components sorted by size desc, then by smallest key, for determinism.
- `types.ts`: the schema (section 5.1).
- Tests: distance symmetry, ring and disc sizes (`1 + 3r(r+1)`), neighbour reciprocity, offset round trip, components on hand-made fixtures.

### WP2. Schema, `buildBoard`, validators

Files: `schema.ts` (types and constants), `build-board.ts`, `validate.ts`.

- `buildBoard(def: MapDefinition): BoardData` creates integer ids: iterate land tiles in definition order, create vertices and edges keyed by lattice coordinates (`x = 2q + r + cornerOffset.x`, `y = 3r + cornerOffset.y` with the same pointy corner offsets the engine uses `[[1,-1],[1,1],[0,2],[-1,1],[-1,-1],[0,-2]]`), fill `vertex.edges`, `vertex.tiles`, `edge.tiles`, `tile.vertices`, `tile.edges`. Set `edge.kind = 'coast'` when `edge.tiles.length === 1`, else `'land'`. Set `tile.islandId` from the definition (computed at generation time by `assignIslands`). Attach harbors to vertices from `def.harbors` (each harbor names an edge by the two tile-local corner indices, or by `{ q, r, side }`, see 5.1).
- `validateMap(def, options): ValidationResult` returns `{ ok: boolean; errors: string[]; warnings: string[] }`. Checks, each as its own exported function with its own test:
  1. `checkShape`: unique tile coordinates, known kinds, numbers only on resource tiles, numbers in `{2..12} \ {7}`.
  2. `checkCounts`: resource totals match `scaleResourceCounts(landCount)` within +-1 for `custom` maps, exactly for generated maps. Number token multiset matches `scaleTokens(resourceTileCount)` exactly for generated maps.
  3. `checkNoAdjacentRed`: no two tiles with number 6 or 8 (as a set `{6,8}`) are neighbours. Hard error for generated maps, warning for custom maps.
  4. `checkConnectivity`: in the base game every land tile is in one connected land component unless `def.allowSeparateIslands`. Island ids match actual components.
  5. `checkIslandSizes`: every island has at least `minIslandSize` tiles (default 3, 6 for the main island of `archipelago`).
  6. `checkHarbors`: count equals `harborTarget(landCount, players)`, each sits on a coast edge, no two harbors share a vertex, each harbor vertex pair is distinct, and harbors are spread (minimum coast-edge gap, see WP5).
  7. `checkStartSpots`: see 5.4. At least `players * 2 + 2` legal start vertices exist (distance rule satisfied), and the pip spread between the best and worst fair spots is within the configured bound.
  8. `checkDesertPlacement`: deserts not all clustered (no more than 2 adjacent deserts) and at least one non-desert neighbour each.
- Tests: for each check, one passing and one failing handcrafted fixture. `buildBoard` snapshot tests: tile, vertex and edge counts for the radius-2 hex must be `19 / 54 / 72`. Cross-check `buildBoard(baseDefinition)` structure against the legacy `createBoard` (same counts, same adjacency up to relabeling, same coastline edge count 30).

### WP3. Balancing helpers (resources, numbers, harbors)

File: `balance.ts`.

- `scaleResourceCounts(landTileCount, players)`: base ratios from the 19 tile board: brick 3, lumber 4, wool 4, grain 4, ore 3, desert 1. Scale with largest-remainder rounding so the sum equals `landTileCount`, keeping the relative proportions, with `desertCount = max(1, round(landTileCount / 19))` for maps up to 30 tiles, and `ceil(landTileCount / 22)` above that (`ASSUMPTION`, log it). The 5 to 6 player extension official numbers (30 tiles, 2 deserts) must come out of this function as a special case table entry marked `VERIFY` in `OPEN_QUESTIONS.md` if they differ from the scaling.
- `scaleTokens(resourceTileCount)`: base multiset `[2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12]` (18 tokens) scaled with largest-remainder per value so the distribution keeps its dice-probability shape and the total equals the number of non desert tiles.
- `assignNumbers(tiles, rng)`: shuffle the token multiset onto resource tiles, then repair adjacent red numbers. Algorithm: up to 200 attempts. Each attempt shuffles, then loops: find any adjacent pair among `{6,8}`, swap one of them with a random non-red tile's token that is not adjacent to another red after the swap. If still failing after the attempts, throw `BalanceError` so the generator retries with a different sub-seed.
- Resource adjacency (soft): penalize more than 2 adjacent tiles of the same resource. Do a bounded local-search pass (swap tiles of different kinds, accept if the penalty decreases). Exposed as `balanceResources(tiles, rng)`.
- `placeHarbors(def, rng, players)`: collect coast edges sorted by angle around the land centroid (like the legacy code), choose `harborCount` positions evenly spread along that ordering with a seeded phase offset, reject edges whose endpoints already host a harbor, and assign kinds: legacy ratio is 4 generic plus one of each resource (9 for 19 tiles). Scale: `harborCount = round(coastEdgeCount / 3.3)`, clamped to `[6, 16]`, with a generic share of about 45% and the remaining kinds distributed evenly over the 5 resources via largest remainder. Harbors may not be placed on lake coasts (edges bordering only interior water components). Detect interior water via flood fill of water tiles from outside the bounding box.
- Tests: counts for all land sizes 12 to 60, tokens preserved as a multiset, no adjacent reds for 1000 seeds, harbor spacing, no harbor on lake coast (use the `lakes` style).

### WP4. Terrain generators

File: `generators/` with one file per style plus `index.ts` exposing `generateTerrain(style, opts, rng): TerrainResult` where `TerrainResult = { land: Axial[]; water: Axial[]; islands: Axial[][]; bounds }`. All generators receive `landTarget` (from the size table in 5.3), `players`, the `rng` stream, and style options. Each generator must satisfy `land.length === landTarget` exactly, or throw `GenerationError` so the outer retry loop picks another sub-seed.

Shared growth primitive `growBlob(seedCells, targetSize, allowed, rng, compactness)`: frontier based random growth. Keep a frontier list of candidate cells adjacent to the blob. Score each candidate with `1 + compactness * neighborCountInBlob + jitter`, pick by weighted random. `compactness` 0 gives stringy shapes, 1 gives round shapes. After growth, run `smoothCoast(land, rng)`: remove land tiles with at most 1 land neighbour (spurs), re-add elsewhere to keep the target size, and fill 1 tile bays (water cells with at least 5 land neighbours) with 70% probability. This keeps coasts playable.

Styles:

1. `standard`: for 3 to 4 players the exact legacy hex (radius 2, 19 tiles). For 5 to 6 players the official 30 tile extension shape (use an explicit coordinate table, documented as a fixed layout, `VERIFY` against the real rulebook shape). For 7 to 8 players a radius 3 hex (37 tiles) plus 7 tiles of the next ring chosen symmetrically, for 44 (`ASSUMPTION`). Shuffling only affects resources, numbers and harbors, not the shape.
2. `continent`: one island. Start from the centre, run `growBlob` with `compactness` 0.55 to 0.85 (random per seed), within a bounding disc of radius `ceil(sqrt(landTarget)) + 2`. Then `smoothCoast`. One component guaranteed. Optional `peninsulas` option (0 to 3) that grows short arms of length 2 to 4 from the coast.
3. `archipelago`: `islandCount` option (default 3 to 5 for up to 4 players, scales to 6 to 9 for 8 players). Distribute `landTarget` over islands with a seeded split (largest island at least 35% of land, each island at least `minIslandSize` 4). Place island seed points by Poisson-disc style sampling in the bounding region with a minimum hex distance of `maxIslandRadius + 2` (so at least one water ring between islands), then grow each island blob independently inside its own exclusion zone. After growth, verify that the minimum distance between any two islands is at least 2 (a water gap). If not, shrink or regenerate. Mark `allowSeparateIslands: true` in the definition (the base rules cannot be played across water in this phase, so see the open question in section 9 about start restrictions).
4. `river`: start from a `continent` land mass with slightly elongated bounds, then carve the river: pick two border land tiles that are at least `0.7 * diameter` apart, find a path between them with a randomized A*/Dijkstra over land tiles (edge cost `1 + rng.float() * 1.5`, avoid the outermost ring where possible, forbid passing adjacent to the coast within 1 tile to avoid cutting off peninsulas, optionally allow one tributary branch of length 3 to 5). Convert path tiles to water. Then add `fords`: choose `fordCount` (default 2, option 0 to 4) path tiles, spaced at least 3 apart along the path, and restore them to land (these become land bridges, so players can build across). Compensate for the removed tiles by growing the land back to `landTarget` on the outer coast. Afterwards: compute components. With `fordCount >= 1` the land stays connected (validate), with 0 the result is two banks and `allowSeparateIslands` is true. The river water counts as inland water (no harbors on it) when both ends touch the outside water, since it is sea, so decide per validation: harbors only on coast edges that belong to outer sea or a component of water larger than 6 tiles.
5. `lakes`: generate a `continent`, then choose `lakeCount` (default 1 to 3) lake centers among interior land tiles (all six neighbours land, distance at least 3 from the coast and from each other), convert center tiles to water (optionally grow a lake to 2 tiles, never reaching the coast), then regrow land on the outside to restore `landTarget`. Lakes never get harbors (flood fill from outside says interior). Resource tiles around a lake are fine.
6. `atoll`: ring-shaped island: choose inner radius 1 or 2 (lagoon), outer radius so the ring holds about `landTarget` tiles, perturb with `growBlob` noise (remove up to 15% ring tiles to create 1 or 2 gaps, which are channels into the lagoon, but keep the ring connected: if the ring splits, restore the least damaging gap). The lagoon is inland water unless a channel connects it to the sea. Harbor rule from `lakes` applies.

After terrain: `assignIslands` labels components in deterministic order (largest first) and sets `islandId`, with `islandVP` left `0` (reserved for Seafarers).

### WP5. Generator orchestration (`generateMap`)

File: `generate.ts`.

```ts
export interface GenerateOptions {
  style: MapStyle;              // 'standard' | 'continent' | 'archipelago' | 'river' | 'lakes' | 'atoll'
  seed: number;
  players: 3 | 4 | 5 | 6 | 7 | 8;
  balance: 'random' | 'balanced';  // 'random': only structural rules; 'balanced': also fair start spots
  victoryTarget?: number;
  style options: islandCount?, fordCount?, lakeCount?, compactness?, peninsulas?
}
export function generateMap(opts: GenerateOptions): MapDefinition;  // throws GenerationError after maxAttempts
```

Algorithm: for `attempt` in `0..maxAttempts` (default 64): derive `terrainSeed = hashSeed(seed, \`terrain:${attempt}\`)`. Generate terrain, `balanceResources`, `assignNumbers`, `placeHarbors`, `assignIslands`, then `validateMap`. On any `BalanceError` or validation failure continue. Return the first valid definition and record `attempts` in `meta.generation` (`{ generatorVersion: 1, attempts }`). Throw with the last validation errors if all attempts fail. `generatorVersion` is part of the definition so future generator changes do not silently alter old seeds: keep old generator code behind the version if the algorithm changes.

#### 5.1 Schema (exact)

```ts
export type MapStyle = 'base' | 'standard' | 'continent' | 'archipelago' | 'river' | 'lakes' | 'atoll' | 'custom';
export type MapTileKind = Resource | 'desert' | 'water' | 'gold' | 'fog';   // gold and fog reserved: validators reject them unless def.features includes them
export interface MapTile { q: number; r: number; kind: MapTileKind; number: number | null; islandId: number; fixedNumber?: boolean; fixedKind?: boolean; }
export interface MapHarbor { id: number; kind: 'generic' | Resource; ratio: 2 | 3; tile: { q: number; r: number }; side: 0 | 1 | 2 | 3 | 4 | 5 }  // side = hex corner pair index, corner i to i+1
export interface IslandInfo { id: number; tileCount: number; specialVP: number }   // specialVP reserved, 0 for now
export interface MapDefinition {
  schemaVersion: 1; id: string; name: string; style: MapStyle; seed: number;
  players: { min: number; max: number }; victoryTarget: number;
  tiles: MapTile[];            // land and water, deterministic order: r asc, then q asc
  harbors: MapHarbor[];
  islands: IslandInfo[];
  startRestrictions?: Array<{ islandId: number; maxPlayers?: number }>;  // reserved
  features: Array<'gold' | 'fog' | 'seaTiles'>;  // reserved
  allowSeparateIslands: boolean;
  meta: { generatorVersion: number; attempts?: number; options?: Record<string, unknown> };
}
export type MapSelection =
  | { kind: 'base' }                                                    // legacy hardcoded 19 tile board
  | { kind: 'generated'; style: MapStyle; seed?: number; options?: Record<string, unknown> }  // seed defaults to game seed
  | { kind: 'preset'; id: string }                                      // named built-in map
  | { kind: 'custom'; definition: MapDefinition };                      // validated user map
```

Serialization: `JSON.stringify` with sorted tile order and no `undefined`. `serializeMap(def)` and `parseMap(json)`. A custom map embedded in `GameSettings` must be size-capped (for example at most 400 tiles, 64 KiB) by the protocol layer.

#### 5.2 Presets

`presets.ts`: export a registry `PRESETS: Record<string, MapDefinition | (seed) => MapDefinition>`: `base` (legacy shape via the new pipeline, as an alternative to the legacy path), `base-56` (30 tiles), `base-78` (44 tiles), `continent`, `archipelago`, `river`, `lakes`, `atoll`, plus one hand-drawn original map per style in ASCII format (see 5.5) stored under `packages/maps/presets/*.map`. Original designs only, never reproduce official layouts or names.

#### 5.3 Size table (record in `docs/DECISIONS.md` as `ASSUMPTION`s, `VERIFY` for 5 to 6)

| Players | `landTarget` (generated styles) | `standard` shape | Bank per resource | Dev deck | Max victory target default |
|---|---|---|---|---|---|
| 3 | 19 to 22 | radius 2 hex (19) | 19 | 25 | 10 |
| 4 | 19 to 24 | radius 2 hex (19) | 19 | 25 | 10 |
| 5 | 30 to 34 | official 30 tile extension | 24 | 34 | 10 |
| 6 | 30 to 36 | official 30 tile extension | 24 | 34 | 10 |
| 7 | 40 to 44 | 44 tile radius 3+ shape | 29 | 43 | 10 |
| 8 | 44 to 50 | 44 tile radius 3+ shape | 29 | 43 | 10 |

Seeded jitter picks the exact target inside each range. Resource bank and dev deck sizes for 5 to 6 come from the published extension (verify) and for 7 to 8 are linear extrapolations (`ASSUMPTION`).

#### 5.4 Fair start spots (`balanced` mode)

- Pips: `pip(n) = 6 - |7 - n|`, desert and water 0. A vertex's score is the sum of pips of adjacent land tiles, plus `+1` if it touches at least 3 distinct resources (diversity bonus).
- Legal start vertices: all vertices (the distance rule is applied during play, not here).
- Fairness metric: take the top `players * 2` vertices that can coexist under the distance rule (greedy by score, skipping neighbours), compute `spread = max - min` of their scores and require `spread <= 5` for `balanced` (tunable in `validate.ts` as `START_SPREAD_MAX`). Also require at least `players * 2 + 2` distinct coexisting vertices with score >= 8 (no starvation). In `random` mode skip these checks.

#### 5.5 Custom map input formats

- **JSON**: `parseMap(text)` validates against the schema by hand (return field path errors like `tiles[3].kind: unknown kind "x"`) and then runs `validateMap` in `custom` mode (relaxed counts, warnings instead of errors for adjacent reds).
- **ASCII**: `parseAsciiMap(text): MapDefinition`. Header lines `key: value` (`name`, `players: 3-4`, `victory: 10`, `seed`), then a blank line, then the grid. Rows are hex rows in odd-r offset layout with a leading space for odd rows for readability (indentation is cosmetic and ignored). Tokens separated by spaces: `~` water, `D` desert, `B` brick, `L` lumber, `W` wool, `G` grain, `O` ore, `?` random resource, `.` empty/outside. An optional number directly after a resource token (`L8`, `G11`) pins a token. A trailing `h:` section may list harbors as `h <q> <r> <side> <generic|brick|...>`; without it, harbors are generated. Fixed tiles and numbers are honoured by the generator (`fixedKind`, `fixedNumber`): `?` tiles and unpinned numbers are filled by the balancer. `renderAscii(def): string` produces the inverse, with a legend line.

### WP6. CLI (`scripts/map.ts`, root script `"map": "tsx scripts/map.ts"`)

```
pnpm map --style continent --seed 42 --players 4 [--balance balanced] [--format ascii|json|svg] [--out file]
pnpm map --list                      # styles and presets
pnpm map --file my.map --validate    # parse (.map ASCII or .json), validate, print errors/warnings, exit code 1 on error
pnpm map --stats --style river --players 6 --seeds 500   # success rate, avg attempts, start-spread histogram
```

- `--format svg` writes a standalone SVG (pointy-top hexes, resource colours, number tokens, harbor markers, island outlines) so the owner can eyeball maps without starting the web client. Reuse the web client's palette constants where possible, otherwise define neutral original colours.
- Parse args with `node:util` `parseArgs` (no new dependency). Print ASCII by default.

### WP7. Engine integration

1. `packages/engine/src/types.ts`: `GameSettings { playerCount: 3|4|5|6|7|8; victoryTarget: number; map?: MapSelection }`. Re-export the board types from `@dimat/maps` or keep them structurally identical (compile time assertion: `const _check: Board = {} as BoardData`).
2. `createBoardFor(settings, seed)` in `board.ts`: `map` missing or `{kind:'base'}` -> legacy `createBoard(seed)` (unchanged, guarded by the WP0 golden test). Otherwise resolve the selection to a `MapDefinition` (generate, preset lookup, or validate the custom one, throw a typed `InvalidMapError` on failure), `buildBoard`, and derive `desertTile` (first desert, or `-1`/`null` handling: if a map has no desert, put the robber on a designated tile: `MapDefinition.robberStart` optional, default the tile with the lowest pip count, record as `ASSUMPTION`). Make sure `rngState` handling stays deterministic: the map generation must not consume the game RNG stream in a way that changes the legacy path, so derive a fresh rng state for non-legacy maps as `hashSeed(seed, 'game')`.
3. `createGame(seed, settings)`: accept 3 to 8 players; scale bank (per 5.3), dev deck composition (scale the base 14/5/2/2/2 with largest remainder to the deck size), and keep piece limits per player (15 roads, 5 settlements, 4 cities, `ASSUMPTION`: unchanged). Start order for setup (snake order) generalises to N players. Hand limit and victory target unchanged.
4. Longest road and robber code must not assume 19 tiles, 54 vertices or `islandId === 0`. Grep for hardcoded `19`, `54`, `72`, `[0]`-style tile ids and fix them. Disconnected islands: players can only build roads/settlements connected to their network by land in this phase. Settlement placement during setup is allowed on any island unless `startRestrictions` forbid it (`ASSUMPTION`, see 9).
5. `viewFor` already sends `board`; make sure the larger boards and the water tiles needed for rendering are included (add `PlayerView.mapWater: Array<{q:number;r:number}>`, a public field, and `PlayerView.mapMeta`).
6. 5 to 6 player special building phase: do not implement here. Add to `OPEN_QUESTIONS.md` as `VERIFY`. For 5 to 8 players the active player's turn proceeds normally.
7. Tests: legacy replay golden test still green, `createGame` for every `players x style` combination across 50 seeds produces a valid state, `replayGame({seed, settings, actions})` with a generated map reproduces the final state exactly (add to the replay test), and the random bot completes a full game on every style (use the simulator, see WP10).

### WP8. Protocol and server

- `packages/protocol`: Zod schemas for `MapSelection` (discriminated union), `GameSettings` update (3 to 8 players, optional `map`), and `PlayerView` additions. Cap custom map size (400 tiles, 64 KiB serialized) and validate with `validateMap` server side before the room is created (reject with a structured error naming the failing check). Keep decoding of old logs lacking `map`.
- `apps/server`: room creation accepts `map` and `seed` (seed defaults to a random one stored in the room so the owner can reuse it; a stored game is still `{seed, settings, actions[]}`). Update seat rules: the README says base games have 3 or 4 seats. New rule: total seats must be within the selected map's `players.min..max`, and `humans + bots = total`. 4+ humans may now fill rooms up to 8 seats. Add a map preview endpoint `GET /api/maps/preview?style=...&seed=...&players=...` returning the `MapDefinition` JSON (read-only, no auth needed, rate-limited if the server already has a limiter) so the lobby can show the board before the host starts. Persist the resolved map selection in the SQLite room settings so restarts reproduce the same board.
- Tests: protocol round trips, invalid custom maps rejected, room with 8 seats, restart persistence.

### WP9. Web client

- Lobby/create-room UI (`apps/web`): map picker (Base, Generated styles, Presets, Upload custom `.json`/`.map`), seed input with a re-roll button, player count 3 to 8 (limited by the map), balance toggle (random/balanced), style options (island count, fords, lakes) shown only when relevant, and a live preview rendered as a small SVG calling the preview endpoint (debounced 250 ms). Show validator warnings from custom uploads.
- Board rendering: remove hardcoded board geometry assumptions, use `tile.q/r` and vertex coordinates, compute the viewBox from the board bounds, draw water tiles from `mapWater` (subtle original water style, lakes included), harbors on coast edges, island outlines optional. Keep existing tile art and the e2e selectors working. The board must scale to 8 player sizes on small screens (pan/zoom is out of scope, auto-fit only).
- Debug panel: show map id, style, seed, generator version, attempts.
- E2E (`e2e/`): create a room with `continent`, 5 players (3 bots), verify the board renders and a bot completes setup, and one test for uploading a tiny custom map.

### WP10. Simulator and invariants

- `scripts/sim.ts`: parametrize the invariants by `state.settings` (bank per resource from the settings table, dev deck counts scaled the same way as the engine). Add flags `--players 3..8` and `--map <style>` (default unchanged: base map, 4 players, so existing baselines stay comparable) and a `--matrix` mode that runs N games per `style x players` combination and prints a table (games, avg actions, stuck games, win rate by seat). The simulation must not hang on island maps: if a game exceeds `maxActions` on a given map, report it rather than crash, and list the seeds.
- Acceptance: `pnpm sim --matrix --games 20 --seed 1` completes without invariant violations for all 36 combinations.

### WP11. Documentation

- `docs/ARCHITECTURE.md`: map pipeline diagram (definition -> `buildBoard` -> engine `Board`), dependency direction, determinism and versioning rules.
- `docs/DECISIONS.md`: one dated entry per assumption: size table, 7 to 8 player scaling, desert scaling, robber start without desert, river and ford semantics, harbor placement rules, start fairness thresholds, seed sub-streams, `generatorVersion` policy, piece limits for 7 to 8 players, setup on separate islands.
- `docs/OPEN_QUESTIONS.md`: special building phase for 5 to 8 (`VERIFY`), official 5 to 6 layout and token counts (`VERIFY`), dev deck and bank sizes at 7 to 8, whether separate-island maps need ships before Phase 4 (see 9).
- `docs/RULES_MATRIX.md`: a row per new rule with its test name.
- `README.md`: a short "Maps" section with the CLI examples and the ASCII format example.
- `docs/PROJECT_LOG.md`: summary of the phase and the before/after sim numbers.

## 4. Test inventory (names to create)

`packages/maps/test/`: `hex.test.ts`, `rng.test.ts` (determinism and cross-check against the engine's `shuffle` output for the same seed to prove the algorithms are identical), `build-board.test.ts`, `validate.test.ts`, `balance.test.ts`, `generators.test.ts` (per style: 200 seeds x players 3 to 8: success, land count exact, determinism by generating twice and comparing `JSON.stringify`, no adjacent reds, island count within style expectations: `continent` 1, `lakes` 1 plus at least 1 interior water component, `atoll` 1 ring with an interior lagoon, `river` connected when `fordCount >= 1`, `archipelago` between `islandCount` min and max), `ascii.test.ts` (round trip, pinned tiles honoured, error messages), `custom-json.test.ts`, `presets.test.ts` (each preset valid for its declared player range), `golden-seeds.test.ts` (hash of a handful of generated maps per style, so accidental generator changes are caught and require a `generatorVersion` bump).
`packages/engine/test/`: `legacy-board-golden.test.ts`, `map-integration.test.ts`, replay test extended.
Property tests with `fast-check` are welcome in `engine` (already a dev dependency there). `packages/maps` may add it as a dev dependency if the lockfile update works (`pnpm add -D fast-check --filter @dimat/maps`), otherwise stay with seed loops.
`e2e/`: map picker flow, custom upload flow.

## 5. Acceptance criteria (the task is done when all hold)

1. `pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test` is green, and `pnpm e2e` passes locally if Playwright browsers are available (otherwise note it in `PROJECT_LOG.md`).
2. `pnpm sim --games 1000 --seed 1` gives the same result as the WP0 baseline (legacy path untouched), and `pnpm sim --matrix --games 20 --seed 1` is clean.
3. `pnpm map --style <each style> --seed 1..50 --players 3..8` always yields a valid map, with a generation success rate of 100% within 64 attempts (report the average number of attempts per style in `PROJECT_LOG.md`, and tune generators if any style averages above 8).
4. The same `(style, seed, players, options)` yields a byte identical definition across runs and platforms.
5. A game created with a generated or custom map replays exactly from `{seed, settings, actions}`.
6. The lobby shows a live preview, supports all six styles plus presets, 3 to 8 players and custom upload, and a mixed human/bot game can be played to the end on a non-base map.

## 6. Commit plan (small, reviewable)

1. `test(engine): pin legacy board hashes` (WP0)
2. `feat(maps): hex math, rng, schema types` (WP1)
3. `feat(maps): buildBoard and validators` (WP2)
4. `feat(maps): resource, number and harbor balancing` (WP3)
5. `feat(maps): standard and continent generators` (WP4a)
6. `feat(maps): archipelago, river, lakes, atoll generators` (WP4b)
7. `feat(maps): generateMap orchestration and presets` (WP5)
8. `feat(maps): ascii and json custom map import` (WP5.5)
9. `feat(scripts): pnpm map CLI with ascii/svg output` (WP6)
10. `feat(engine): map selection, 3 to 8 players` (WP7)
11. `feat(protocol,server): map settings, preview endpoint` (WP8)
12. `feat(web): map picker, preview, board auto-fit` (WP9)
13. `feat(sim): parametrized invariants, matrix mode` (WP10)
14. `docs: architecture, decisions, open questions, readme` (WP11)

## 7. Risks and mitigations

- **Legacy replay breakage:** the golden hash test (WP0) plus an untouched legacy path.
- **Generator failure on some seeds/sizes:** bounded retries with per attempt sub-seeds, a stats mode in the CLI, tuning before merge.
- **Disconnected islands in a base-rules game:** players cannot cross water yet. See 9 for the conservative default (generated styles keep land connected except for `archipelago` and a `river` with 0 fords, which are flagged separate-island maps and require an explicit opt-in in the lobby with a warning label "needs ships, Phase 4").
- **Larger boards stress UI and bots:** check bot decision time on 8 player boards, cap any exhaustive enumeration the heuristic bot does.
- **Scope creep:** gold, fog, ships, pirate, island VP are schema-reserved only.

## 8. Out of scope

Ships, pirate, gold and fog behaviour, island VP, scenarios, 5 to 6 player special building phase, Cities & Knights, pan/zoom. All reserved in the schema where listed in 5.1.

## 9. Conservative defaults for ambiguities (log them, do not ask)

- Separate-island maps (`archipelago`, `river` with 0 fords) before Phase 4: allowed only with an explicit lobby opt-in. Setup placement may use any island. Players whose network is on a small island simply cannot expand across water until ships exist. Alternative recorded in `DECISIONS.md`: forbid these styles until Phase 4, or generate them with a single "land bridge" tile.
- 7 to 8 players: scaling is extrapolated, there is no official ruleset, and the UI labels it "experimental".
- Maps without a desert: the robber starts on the lowest pip land tile.
- Harbors on inland water (lakes, lagoons): never.
- The `balanced` mode is the default for generated maps, `random` is an opt-in for chaos.
