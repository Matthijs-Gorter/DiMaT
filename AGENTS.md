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
apps/web           React client
docs/              RULES.md, PHASES.md, DECISIONS.md, OPEN_QUESTIONS.md
```

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
