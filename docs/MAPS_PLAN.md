# Maps: owner decisions of 2026-11-03 and delivery plan

This file **amends** `docs/MAP_GENERATOR_PLAN.md`. Where the two disagree, this file wins. Everything else in the older plan (hex math, RNG sub-streams, validators, balancing, replay compatibility, golden tests) still applies. The owner reads Dutch; code, comments and docs stay English.

## 2026-11-03 progress

- Steps A through C are implemented: legacy board hashes remain fixed; the baseline 1,000-game simulation is recorded; `packages/maps` provides deterministic geometry, board graph, river-aware schemas, validators, scaled inventories, balancing, and harbor placement.
- Steps D and E are implemented: all eight terrain styles generate complete `MapDefinition` values, including a main river with a deterministic tributary; the engine supports connected bridges, shared road pieces, Longest Road, bot choices, and river rendering. The bridge cost and three-piece cap are assumptions recorded in `docs/DECISIONS.md`.
- Steps F through I are implemented for the current 3–4-player base game: stored map definitions and scaled banks in engine settings; persistent map records with six-character share codes and room replay copies; lobby picker/preview; generation and editing UI with live validation and save.
- Step J is implemented: 200-seed generation matrices, bridge/map tests, map-settings replay coverage, an end-to-end editor/share/room flow, and an eight-style random-bot matrix are green. Workspace typecheck, lint, tests, and the 1,000-game baseline simulation are green.

## 2026-11-03 editor and generation follow-up

- The browser editor and lobby preview now share the in-game terrain image renderer. The editor has independent number/label visibility toggles, blank-map creation, add/remove/change tile tools, coast-aware harbor editing, connected river-edge editing, validation, and a live quality panel.
- The eight shapes have separate implementations: compact standard, continent growth, separated island growth centers, edge-river carving, lake insertion, atoll ring growth, erosion, and seeded random polyhex growth. This algorithm change is generator version 2.
- Random mode varies resource counts while retaining all resource types and the scaled desert count. The 6/8 adjacency preference is configurable. The built-in `BEGINR` map is fixed hand-authored data.
- Quality is advisory and based on legal two-settlement pairs, pip-weighted expected production, balance between each pair's two settlements, diversity, resource counts, and outlier warnings. Its equal-weight composite is an explicit heuristic assumption in `DECISIONS.md`.
- Re-run verification after generator version 2; previous green claims above describe the earlier implementation and are not evidence for this follow-up.

## 1. Owner decisions (from the Q&A on 2026-11-03)

1. **Map kinds** the generator must produce: islands with a river, a very large map with irregular shapes, the classic compact map, and a fully random (seeded) map.
2. **Custom maps:** players get both generator settings (type, size, islands, rivers, seed) and a manual editor on top of the generated result.
3. **Storage and sharing:** custom maps are stored on the server and shared with a short code. A room copies the full map into its settings, so replays stay valid.
4. **Rivers have bridges.** This replaces the "strip of water tiles with fords" semantics of `MAP_GENERATOR_PLAN.md` section 0, item 3.
5. Open water between islands still needs ships. Ships stay out of scope until Seafarers (Phase 4).
6. Custom maps are capped at 150 land tiles.

## 2. River model (replaces the ford model)

- A river is a set of **tile edges** (`MapDefinition.rivers`, each entry `{ tile: {q, r}, side }`, same addressing as harbors). It runs through the gap between two land tiles, so it is visible in the one-road-wide gap between rendered tiles.
- A river edge always lies between **two land tiles**. Rivers never touch sea edges.
- `buildBoard` marks such edges `kind: 'river'`. Normal road actions are illegal on river edges. Settlements may be built on river vertices as usual.
- `tile.islandId` identifies a **region**: land tiles connected through adjacency **without crossing a river edge**. A river can therefore split one landmass into several regions, and open water splits landmasses into separate islands. Land connectivity for validation ignores rivers (bridges make them crossable).
- The `river` generator style carves one main river (optionally a tributary) over a continent and splits the land into at least two regions of meaningful size.

## 3. Bridge rule (engine, later phase)

- New action `buildBridge { edge }`, legal only on a river edge, for a player whose network reaches one endpoint.
- A bridge is a road for connectivity, longest road and the road piece limit. It additionally needs bridge pieces.
- **ASSUMPTION (cost):** 2 lumber + 2 brick. **ASSUMPTION (limit):** 3 bridge pieces per player, drawn from the 15 road pieces. Both are logged in `docs/DECISIONS.md`; this is a house rule with no official source.
- Bots only see `legalActions`, so they need only a simple heuristic for bridges.

## 4. Delivery plan

| Step | Content | Maps to |
|------|---------|---------|
| A | Pin the legacy board with golden hashes; record the sim baseline | WP0 |
| B | `packages/maps`: RNG, hex math, schema (incl. `rivers`), `buildBoard`, validators | WP1, WP2 |
| C | Resource, number and harbor balancing | WP3 |
| D | Generators: `standard`, `continent`, `archipelago`, `river` (edge rivers), `lakes`, `atoll`, `irregular` (large, 50 to 80 tiles), `random` | WP4, WP5 |
| E | `buildBridge` in the engine, piece limit, longest road, bot heuristic | new |
| F | Engine integration: `settings.map`, bank scaling per map | WP7 |
| G | Server: map storage (`maps` table, 6 character share code), `POST/GET /api/maps`, same validators, size caps; protocol schemas | WP8 + new |
| H | Web: lobby map picker with preview, board rendering for rivers and large boards | WP9 |
| I | Web: map editor (brushes for land, water, desert, river edges, harbors, numbers; generator panel; live validation; save and share code) | new |
| J | Simulator matrix, property tests, e2e, docs | WP10, WP11 |

Steps A and B come first because everything else depends on them.

## 5. Acceptance (map system complete)

- Same seed and options give a byte-identical `MapDefinition`.
- Legacy replays still reproduce (golden hashes unchanged).
- Every generator style produces valid maps for 200 seeds per supported player count.
- A full random-bot game completes on every style, including bridges.
- Custom maps survive save, share code, load, room creation and replay.
