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

In the build phase, the active player can use **Ruilen** to offer resource bundles to selected players. Recipients can accept, decline, or make one counter-offer; bots respond to offers directed to them. Bank and harbor trades remain immediate. Domestic-trade bundle, consent, and counter-offer details are project assumptions documented in `docs/DECISIONS.md`.

### Local debug mode

Run the server with diagnostics enabled and bound to localhost:

    HOST=127.0.0.1 DEBUG=1 pnpm --filter @dimat/server dev

Run the web client as usual, then enable the **Debug** button, add `?debug=1` to a room URL, or press the backtick key. The panel shows the client view hash and compares it with the server's view hash, legal-action counts, recent server actions/events, bot status, and the last structured error. It can copy a debug bundle and download a replay JSON. The raw read-only snapshot endpoint is `http://127.0.0.1:3000/debug/rooms/<room-id>`; the web proxy also exposes `/api/debug/rooms/<room-id>`.

Server logs are structured JSON through Fastify/Pino and include room/seat/action/outcome fields for room creation, accepted and rejected actions, bot failures and lifecycle changes. `DEBUG=1` defaults the server to `127.0.0.1`; setting `HOST` to a non-local address is accepted only for a Tailscale IPv4/IPv6 address. Never expose the debug endpoint on a public interface. Debug-only server actions such as forcing dice, granting resources, or skipping setup are not implemented yet.

## Project structure

See docs/ARCHITECTURE.md, docs/RULES.md, and docs/PHASES.md. Read AGENTS.md before coding. Phase 1 implements the deterministic 3–4 player base-game engine, private player views, replay, random bot, and simulator.
