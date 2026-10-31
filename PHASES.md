# docs/PHASES.md

One task prompt per phase. Paste a phase prompt into Codex as the task; Codex reads `AGENTS.md` and `docs/RULES.md` automatically. Do not start a phase before the previous one is green and reviewed.

Shared footer for every prompt (already implied by AGENTS.md): follow the Definition of done, log assumptions in `docs/DECISIONS.md`, put questions in `docs/OPEN_QUESTIONS.md`, finish with a Dutch report.

---

## Phase 0: Study and plan (no game code)

> Task: Phase 0. Do not write game code yet.
> 1. Read `docs/RULES.md`. If the network is available, study Catanatron and JSettlers2 (rules, tests, bot structure, how JSettlers2 models scenarios via `_SC_` options). Respect the license notes in AGENTS.md.
> 2. Create `docs/RULES_MATRIX.md`: one row per rule (rule, source, planned test name). Cover base game, Seafarers, Cities & Knights.
> 3. Resolve `VERIFY` items from official sources where possible; otherwise record them in `docs/OPEN_QUESTIONS.md`.
> 4. Write `docs/ARCHITECTURE.md`: package layout, engine API (`apply`, `legalActions`, `viewFor`), board graph model including sea edges and islands, rule-module hooks, event-sourcing format, protocol outline, bot interface.
> 5. Create the empty monorepo skeleton (pnpm workspaces, tsconfig, lint, Vitest) with passing placeholder tests, and a `README.md` with Fedora commands.
>
> Done when: skeleton installs and `pnpm -r typecheck lint test` pass; the matrix and architecture docs exist.

## Phase 1: Base-game engine + simulator

> Task: Phase 1. Implement the base-game engine in `packages/engine` for 3 to 4 players, fully following `docs/RULES.md` sections 1 to 8.
> - Tests first for every edge case in section 8; keep `docs/RULES_MATRIX.md` current.
> - Implement `apply`, `legalActions`, `viewFor`, seedable PRNG, replay from `{ seed, settings, actions }`.
> - Implement a random bot and `pnpm sim --games N --seed S` that plays full games and checks invariants: total cards in circulation constant, bank never negative, piece limits, every game terminates, no state without a legal action.
> - Add fast-check property tests for those invariants and a replay test.
>
> Done when: all section 8 edge cases have passing tests, `pnpm sim --games 10000 --seed 1` finishes with zero errors, and replaying a saved game gives an identical final state.

## Phase 2: Playable online (server + web)

> Task: Phase 2. Build `apps/server`, `packages/protocol` and `apps/web` so one to four humans and bots can play the base game in the browser (three or four total seats).
> - Rooms with invite link, display name, secret seat token for reconnecting. No passwords.
> - Server is authoritative: validate every action against `legalActions`; send each player only `viewFor` data; send events/diffs rather than full state each move.
> - Persist `{ seed, settings, actions }` in SQLite; resume games after a server restart.
> - Bots: level 1 random, level 2 heuristic (settlement spot valuation by pip count, port and resource balance, build priorities). Run bots in worker threads with a time budget; they only see their own view.
> - Web UI: SVG hex board, highlights for legal placements, pip probability on hover, hand, build menu, trade panel (offer, counter-offer, ports), dice and production animations, event log, score panel, dark/light mode, responsive layout for phone and desktop, color-blind-safe resource icons.
> - Deployment: `compose.yaml` for Podman/Docker, a systemd unit example, firewalld command, and Tailscale access instructions in `README.md`.
>
> Done when: games with solo humans, 2–4 human seats and bot-filled seats complete; a refresh or reconnect restores the seat; typecheck, lint, tests and sim are green.

## Phase 3: Map system

> Task: Phase 3. Implement `packages/maps`: data-driven maps per `docs/RULES.md` section 12.
> - Move the base board into a map definition. Add the balanced generator (no adjacent 6/8, fair start spots) with validators and a seed.
> - Room settings: pick map, board setup mode, seed.
> - Prepare the schema for sea tiles, islands, special VP, gold and fog even if not yet used.
>
> Done when: several maps are selectable, validators have tests, same seed gives same board.

## Phase 4: Seafarers

> Task: Phase 4. Implement Seafarers as rule modules plus map data (`docs/RULES.md` section 9).
> - Core first: ships, pirate, gold fields, island VP, fog exploration, longest trade route, road-building card for ships.
> - Then scenarios in order: Heading for New Shores, The Four Islands, The Fog Island, Through the Desert; later Forgotten Tribe, Cloth for Catan, Pirate Islands, Wonders.
> - Bots: legal-move support is enough (random + simple heuristic).
> - Update matrix, tests, UI (ships, pirate, gold choice, fog reveal).
>
> Done when: the first two scenarios are fully playable with tests, and the base game still passes every previous test.

## Phase 5: Cities & Knights

> Task: Phase 5. Implement Cities & Knights as rule modules (`docs/RULES.md` section 10). Resolve every `VERIFY` item from the official rulebook/almanac first; list unresolved ones in `docs/OPEN_QUESTIONS.md` and use the most conservative reading.
> - Commodities, event die, barbarians, knights, city walls, city improvements, metropolises, Defender of Catan, merchant, all 54 progress cards (one test per card).
> - Tests: barbarian outcomes (win, loss, ties, metropolis skipping, wall removal), knight activation and actions, metropolis steal at level 5, hand limits.
> - UI for knights, improvement tracks, progress cards, barbarian track.
>
> Done when: a full game with all components completes in simulation (random bot) and in the browser, all previous tests stay green.

## Phase 6: Combination, polish, stronger bots

> Task: Phase 6. Combine Seafarers + Cities & Knights (`docs/RULES.md` section 11), add 5 to 6 players (verify the special building phase), add replays and spectators, and a stronger bot (search-based, e.g. alpha-beta with a value function or ISMCTS; study Catanatron's approach without copying code).
>
> Done when: a combined map is playable, spectators and replays work, the strong bot beats the heuristic bot in at least 60% of 200 simulated games, and all tests stay green.

---

## Tips for running these with Codex

- Make `AGENTS.md` live in the repo root and the other two files in `docs/`. Keep `AGENTS.md` small (Codex limits the combined size of project instruction files).
- Cloud tasks may have no internet. Either clone Catanatron and JSettlers2 into an ignored `reference/` folder beforehand, or accept that Phase 0 relies on `docs/RULES.md` and the official rules.
- Review each phase before starting the next. The simulation and replay tests are the safety net: do not accept a phase where they are red or skipped.
