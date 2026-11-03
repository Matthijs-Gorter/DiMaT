# AGENTS.md

Instructions for coding agents (Codex) working in this repository. Keep this file short; details live in `docs/RULES.md` (game rules) and `docs/PHASES.md` (task prompts per phase).

## Project

A modern, fast, browser-based settlers-style board game (Catan-like), self-hosted on Fedora Linux, played by one to four humans and bots in three- or four-player base games. Build order: base game, then Seafarers, then Cities & Knights, then combinations and multiple maps (colonist.io-style variety).

- Working name: `PROJECT_NAME` (placeholder). **Never** use the name "Catan" or official artwork in UI, package names or assets. Use original graphics.
- The owner reads Dutch. **Reply to the user in Dutch. Write code, comments, identifiers, commit messages and docs in English.**

## Stack (decided, do not re-debate)

- Node 22 LTS, TypeScript (strict), pnpm workspaces.
- Tests: Vitest + fast-check (property tests).
- Web: Vite + React, board rendered as SVG.
- Server: Fastify + `ws` (WebSockets), SQLite for the action log, Zod for message validation.
- Deploy: Docker/Podman Compose on Fedora; remote access via Tailscale.

## Layout

```
packages/engine    pure game rules, deterministic, no I/O, no DOM, no Date.now/Math.random
packages/maps      map definitions (data), generators, validators
packages/protocol  message types + Zod schemas shared by server and web
packages/bots      bot players (run in worker threads), only see their own player view
apps/server        rooms, seats, WebSocket, persistence (event log)
apps/web           Vite client; current implementation is DOM/SVG TypeScript (React was the original target)
docs/              RULES.md, PHASES.md, DECISIONS.md, OPEN_QUESTIONS.md
```

## Current repository state (2026-11-03)

- Phase 0, the base-game engine (Phase 1), online-play foundation, and the map-system work recorded in `docs/PROJECT_LOG.md` are implemented. Phase 2 has substantial follow-up work (2.1 A–E plus consent-based domestic trading); acceptance criteria should still be checked against current verification. Do not infer completion from code presence alone.
- The base rules engine and map-backed games currently support 3–4 players. `packages/maps` now contains deterministic generators, balancing, schemas, board construction, validation, and custom-map handling. The type schema reserves a `preset` selection kind, but there is no preset library or picker yet. The generated terrain styles are `standard`, `continent`, `archipelago`, `river`, `lakes`, `atoll`, `irregular`, and `random`; `base` and `custom` are additional map selection kinds. Maps with separated islands require ships that are deferred to Seafarers. 5–8 player map generation described in planning/code does not mean the game engine supports those player counts.
- River features are edge-based and crossable with bridges. Bridge cost and per-player supply are house-rule assumptions; preserve the recorded choices in `docs/DECISIONS.md` unless explicitly changed.
- The server persists shared custom maps in SQLite under share codes and stores the full map definition in room replay settings. The lobby has map preview/selection, and the web client includes a map generator/editor with validation and save. Relevant files include `apps/web/src/map-editor.ts`, `e2e/map-workflow.spec.ts`, and `packages/protocol/src/index.ts`.
- The web app currently uses TypeScript, Vite, DOM APIs, and hand-built SVG/CSS (`apps/web/src/main.ts`); it does not use React despite the original stack plan and the older `docs/ARCHITECTURE.md` wording. The server uses Node's built-in `node:sqlite` and `worker_threads`; account for the Node 22 runtime requirement.
- Consent-based domestic trade offers, multi-resource bundles, decline/cancel, and one-level counters are implemented as project assumptions. See `docs/DECISIONS.md`; do not silently reinterpret them. Old immediate `domesticTrade` actions remain replay-compatible, while the live server rejects them.
- Latest project-log verification reports a passing `pnpm sim --games 1000 --seed 1` (1,000 games, 718,355 actions), passing workspace typecheck/lint/tests, map style bot matrix (one game per style), and map workflow E2E. Treat these as historical reports, not current-task checks. The Phase 1 10,000-game run remains incomplete; the 20-games-per-style/player map matrix and 3–8 player engine support are not reported as completed.
- `docs/PROJECT_LOG.md` is the dated implementation/verification record, `docs/DECISIONS.md` is the rule and architecture assumption record, `docs/OPEN_QUESTIONS.md` is the unresolved list, and `docs/RULES_MATRIX.md` maps rules to named tests. `docs/MAPS_PLAN.md` is the current map plan and amends the older `docs/MAP_GENERATOR_PLAN.md`. Keep these consistent when work changes status; append a dated log entry for substantive work and correct stale known-gap notes when resolved.

## Source-of-truth reading order

Before implementation, read this file, `docs/RULES.md`, and the relevant prompt in `docs/PHASES.md` or `docs/MAPS_PLAN.md`. Then check `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`, `docs/RULES_MATRIX.md`, and the latest relevant entries in `docs/PROJECT_LOG.md`. The plans are intended scope; inspect current code and tests to establish actual behavior. Do not infer that planned features are implemented. Where older plans/docs conflict with `MAPS_PLAN.md` or current code, read the dated decision and project log before changing behavior.

Useful entry points:

- Engine API and state transitions: `packages/engine/src/index.ts`, `game.ts`, `types.ts`, `board.ts`.
- Map schemas, deterministic generators, balancing and validators: `packages/maps/src/`; map-system decisions and delivery plan: `docs/MAPS_PLAN.md`.
- Bot policies and worker entry: `packages/bots/src/`.
- Wire schemas and server message types: `packages/protocol/src/index.ts`.
- Rooms, WebSockets, SQLite replay persistence, and bot scheduling: `apps/server/src/index.ts`.
- Browser UI and SVG interaction: `apps/web/src/main.ts`; map editor: `apps/web/src/map-editor.ts`; visual styles are in `apps/web/src/*.css`.
- Full-game simulator: `scripts/sim.ts` (`pnpm sim --games N --seed S`; map-style matrix options are documented in `README.md`); browser checks: `e2e/`.

## Commands (all must pass before you finish a task)

```
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm sim --games 1000 --seed 1     # random-bot simulation, from phase 1 on
```

If a command does not exist yet, create it as part of the task rather than skipping it.

## Engine rules (non-negotiable)

1. **Pure and deterministic.** `apply(state, action) -> { state, events }`. Randomness only through a seedable PRNG whose state is part of the game state. Same seed + same actions must give the identical game.
2. **Server-authoritative, hidden information.** The engine exposes `viewFor(state, playerId)`; other players' resource and development cards are hidden (counts only). Bots and clients only ever receive their own view.
3. **Legal actions.** `legalActions(state, playerId)` lists every allowed action. The server rejects anything not in that list.
4. **Board as integer-id graph** (tiles, vertices, edges) with precomputed adjacency tables. Edges have a type (land, coast, sea) and tiles belong to islands from day one, so Seafarers needs no redesign.
5. **Rules as modules.** Expansions hook into turn phases (production, robber, build, end of turn) as rule modules plus data. No expansion-specific `if` chains in the base rules.
6. **Resource types are extensible** (commodities arrive with Cities & Knights).
7. **Event sourcing.** A saved game is `{ seed, settings, actions[] }`. Replaying must reproduce the final state exactly; keep a replay test.

## How to work

- Read `docs/RULES.md` and the relevant phase in `docs/PHASES.md` before coding. Work on **one phase at a time**.
- **Tests first** for tricky rules (longest road, robber/7, bank shortage, trading, development cards, barbarians). Every rule in `docs/RULES.md` maps to a named test; keep `docs/RULES_MATRIX.md` (rule, source, test name) up to date.
- **Never invent rules.** Cite a source (official rulebook section, or a reference project file) or mark it `ASSUMPTION` in `docs/DECISIONS.md`.
- **Do not stop to ask** when something is ambiguous (you may be running unattended). Pick the most conservative reading, record it in `docs/DECISIONS.md` with the alternatives, add the question to `docs/OPEN_QUESTIONS.md`, and continue. Items marked `VERIFY` in `docs/RULES.md` always go to `OPEN_QUESTIONS.md` unless you can confirm them from an official source.
- Small, reviewable commits. Do not rewrite unrelated files. Do not change an agreed rule silently; log it in `DECISIONS.md`.
- No placeholders, no TODO stubs in finished work. If something is out of scope, say so in the final report.
- When a new request is underspecified, inspect the repository and continue with the narrowest reasonable interpretation; update docs if an assumption or status changes. Keep user-facing replies in Dutch and repository text/code in English.

## References and licenses

- Reference projects (study behavior and test cases): Catanatron (`github.com/bcollazo/catanatron`) and JSettlers2 (`github.com/jdmonin/JSettlers2`). If the network is unavailable, rely on `docs/RULES.md` and the official rules, and note that you could not consult them.
- **JSettlers2 is GPLv3. Do not copy its code.** Check Catanatron's license before reusing anything. Re-implement from the rules; at most port test *scenarios*, not code.
- colonist.io is proprietary: take feature ideas only, never code, text or assets.
- Priority when sources disagree: official rules > JSettlers2 > Catanatron > colonist.io behavior.

## Definition of done (every task)

- typecheck, lint, tests and (when applicable) the simulation are green.
- New rules have tests and a row in `docs/RULES_MATRIX.md`.
- Run instructions for Fedora are current in `README.md`.
- Final message (in Dutch): what works, what is tested, what is incomplete, assumptions made, open questions. No long recap of the steps.

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, and the simulator are required for implementation tasks by project policy. Do not claim they passed unless run in the current task; report unavailable or incomplete checks explicitly. `pnpm e2e` is available for browser checks when the change affects online play or the UI.
