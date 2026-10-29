# DiMaT

A self-hosted, browser-based settlers-style board game for humans and bots. The working name is a placeholder. All rules and artwork will be implemented originally; do not use the official game's name or art in product UI, package names, or assets.

## Fedora development setup

Install Node.js 22 LTS and pnpm 11. Then from the repository root:

    pnpm install
    pnpm -r typecheck
    pnpm -r lint
    pnpm -r test

Phase 1 provides the random-bot simulator: `pnpm sim --games 10000 --seed 1`.

## Online play (Phase 2)

Install dependencies, then run the server and web client in separate terminals:

    pnpm install
    pnpm --filter @dimat/server dev
    pnpm --filter @dimat/web dev

Open the Vite URL (normally `http://localhost:5173`). Create a room and share its invite URL; the other human joins before the host starts. The game server listens on port 3000 and keeps SQLite action logs in `dimat.sqlite` (override with `DIMAT_DB`). Seat tokens are stored by the browser for reconnect. For a container deployment, review `compose.yaml`, then run `docker compose up --build`; the web entry point is port 8080. The example systemd unit and Tailscale/firewall notes are in `deploy/README.md`.

## Project structure

See docs/ARCHITECTURE.md, docs/RULES.md, and docs/PHASES.md. Read AGENTS.md before coding. Phase 1 implements the deterministic 3–4 player base-game engine, private player views, replay, random bot, and simulator.
