# DiMaT project log

Detailed, app-specific record of requests, implementation work, tests, simulator runs, and known gaps. Keep entries factual and add a new dated section for each substantive DiMaT task. Test summaries describe executed checks; the named test cases live in `docs/RULES_MATRIX.md` and `packages/*/test/`.

## 2026-10-29 — Phase 0: workspace initialized

- **Request:** Initialize `~/Developer/DiMaT`.
- **Work:** Set up the pnpm TypeScript monorepo for `engine`, `maps`, `protocol`, `bots`, `server`, and `web`. Added architecture, rules, phase plan, decisions, open questions, README, lint/typecheck/test configuration, and initial placeholder suites. Reviewed Catanatron and JSettlers2 as behavioral references; recorded license boundaries and unresolved rulebook details.
- **Verification:** `pnpm install`, `pnpm -r typecheck`, `pnpm -r lint`, and `pnpm -r test` passed. Six placeholder tests passed. No game rules or simulator existed yet; simulation was not run.
- **Limitations at completion:** Placeholder tests only; base-game implementation remained for Phase 1.

## 2026-10-29 — Phase 1: base-game engine and random-bot simulation

- **Request:** Continue to the next phase; later pause, resume, and skip the remainder of the 10,000-game run.
- **Work:** Implemented a deterministic base-game engine for 3–4 players, seeded board and PRNG, legal action generation and validation, turn state machine, production, robber, trades, builds, development cards, awards, victory checks, hidden player views, replay, random bot, and full-game simulator. Documented rules and assumptions in `docs/RULES_MATRIX.md`, `docs/DECISIONS.md`, and `docs/OPEN_QUESTIONS.md`.
- **Test coverage:** 49 engine tests and 2 bot tests passed. The engine tests cover setup order and placement constraints, starting resources, turn phases, 7/discard/robber handling, production and bank shortage, hidden robber steals, resource conservation, domestic and maritime trade ratios, piece supply, longest road, Largest Army, development-card timing/effects, victory timing, deterministic board generation, replay equivalence, hidden information, and random-game invariants. The bot tests verify legal-action selection and deterministic choice for a fixed view/decision seed. Four additional workspace scaffold tests passed (maps, protocol, server, web).
- **Workspace verification:** `pnpm -r typecheck`, `pnpm -r lint`, and `pnpm -r test` passed on resume. This includes the 49 engine, 2 bot, and 4 scaffold tests (55 total).
- **Simulation:** A 100-game run passed earlier in Phase 1. A later 10,000-game run was started from seed 1 and stopped at 1,000/10,000 when requested; it was not checkpointed. After resume, a fresh run from seed 1 completed 2,000 games without invariant errors, then was stopped at the user's request. The 10,000-game acceptance run remains incomplete by choice. The simulation checks that games finish, have a winner, and that the winner meets the victory target; it reports aggregate game/action totals, not per-game records.
- **Known gaps:** No detailed Vitest transcript was saved at the time. The simulator does not persist progress or game records, so completed runs can only be cited from their terminal summary/log. The full 10,000-game run was intentionally not completed.

## 2026-10-29 — Phase 2: online-play foundation

- **Request:** Continue with Phase 2 (browser client, authoritative server, rooms, bots, persistence, and deployment notes).
- **Work:** Added Zod room/client-message schemas; Fastify room endpoints and WebSocket transport; invite URLs, display names, private seat tokens and reconnect; server-side legal-action validation; per-player `viewFor` delivery; changed-field view patches with filtered game events; SQLite `{seed, settings, actions}` persistence and deterministic replay on server startup. Added level-1 random and level-2 heuristic bot policies, executed in worker threads with a 500 ms decision budget. Added a Vite browser UI with an SVG board matching the engine graph coordinates, legal settlement highlights, tile pip tooltips, resource hand, player score/status, action picker and event list. Added Compose/Docker/Caddy deployment files, a systemd example and Fedora firewall/Tailscale notes. Updated package manifests, lockfile and README. Follow-up fixes added the protocol package export required by web, replaced SVG `onclick` with an event listener, removed an unused type import, and split join-message narrowing for TypeScript.
- **Dependency operation:** `pnpm install --lockfile-only` completed successfully, followed by `pnpm install --frozen-lockfile`; the new workspace dependencies were resolved and installed.
- **Verification:** The user ran `pnpm -r test`; all 55 tests passed (49 engine, 2 bot, and 4 package/app scaffold tests), before the follow-up fixes. After those fixes, `pnpm -r typecheck` and `pnpm -r lint` both passed. No browser session, two-browser game, restart/reconnect exercise, simulator, or container build was run.
- **Known gaps:** Phase 2 is not yet acceptance-complete. The bot heuristic is intentionally small and does not fully score resource balance, harbors or build priorities. The browser client exposes trades in the legal-action picker but has no dedicated offer/counter-offer panel; production animation and trade acceptance flow remain unfinished. Deployment examples are unbuilt and unaudited. The implementation needs code checks and an end-to-end game with two browsers plus bots before it can be called done.

## 2026-10-29 — Improve room layout and invitation copying

- **Request:** Improve the game-room layout and fix the copy-invitation button.
- **Changes:** Zoomed the SVG viewBox to fit the board graph; rendered resource names and counts as separate DOM nodes (instead of literal `<b>` markup); removed the duplicate sidebar Start button that allowed premature start attempts; made the room header responsive. Invitation copying now uses the Clipboard API when available, falls back to `execCommand` on non-secure origins, and exposes a selectable URL with status text if copying is blocked.
- **Verification:** `pnpm -r typecheck` and `pnpm -r lint` passed. No browser visual check or clipboard interaction was run.

## 2026-10-29 — Phase 2.1 Part A: lifecycle, error handling, bot recovery

- **Request:** Reproduce board/lifecycle failures in two browser contexts before changing behavior, then make room lifecycle and bot scheduling explicit.
- **Reproduction:** Added Playwright setup with two independent Chrome contexts (two human seats) and one bot seat. Before the fixes, all three lifecycle/interaction assertions failed: the lobby exposed the action picker, setup roads had no clickable SVG targets, and the client had no `gameStarted` lifecycle marker.
- **Root causes and changes:** The joined-room response exposed `PlayerView` before start and the client had no action-send gate; a second Start button bypassed the disabled lobby control. The server now has `lobby/started/finished` state, sends `gameStarted` only after the host starts, returns structured error codes, validates seat/turn/action ownership, and logs rejected actions. Restored active rooms resume their bot scheduler; bot worker errors/timeouts fall back to a random legal action, with visible thinking/recovering/stalled status and a logged reason. Added a visible Dutch error toast for structured server errors.
- **Verification:** The baseline Playwright run reproduced the failures (3 expected-failing assertions). After Part A, the lobby/action-gate and two-context lifecycle Playwright tests passed (2 tests). `pnpm -r typecheck` and `pnpm -r lint` passed. The direct-road interaction test remains expected to fail until Part B. No 10,000-game sim was run.
- **Files:** Server/protocol/client lifecycle code; Playwright config and `e2e/board-and-lifecycle.spec.ts`; package scripts/dependency; `docs/DECISIONS.md`.
