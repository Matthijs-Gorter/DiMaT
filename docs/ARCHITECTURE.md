# Architecture

## Workspace
- packages/engine: deterministic rules and state transitions; no I/O or DOM.
- packages/maps: immutable map definitions, seeded generation, validation.
- packages/protocol: shared wire types and Zod validation.
- packages/bots: policies that receive only a player's view.
- apps/server: Fastify rooms, WebSocket transport, action validation, SQLite event log.
- apps/web: Vite/React client; SVG board and presentation only.

## Engine contract
The engine owns serializable GameState including seed/PRNG state, settings, board graph, players, bank, deck, phase, and pending decisions. legalActions(state, playerId) returns the complete legal action set. apply(state, action) is a pure transition returning new state and ordered events; it rejects actions outside the legal set. viewFor(state, playerId) masks all other players' resource and development-card identities. The engine never reads wall-clock time or ambient randomness.

Replay input is { seed, settings, actions[] }. Replaying it from the same rules version must reproduce the same final state and events. Persistence is append-only; snapshots may accelerate replay but are not authoritative.

## Board model
Tiles, vertices, and edges have stable integer IDs and precomputed adjacency. Edges are land, coast, or sea. Every tile has an island ID. Maps contain coordinates, numbers, harbors, start restrictions, supported modes, and victory target. The graph supports roads and ships without changing base topology.

## Rule modules
The base engine calls typed hooks at setup, pre-roll, dice resolution, production, robber resolution, build/trade, and end turn. Expansion modules register data and hook handlers. Hook ordering is explicit in a versioned ruleset.

## Protocol and server
Client commands carry room/seat identity, a monotonically increasing client sequence, and a validated action. The server resolves a seat token, checks turn ownership and legalActions, applies one transition, stores the action before broadcasting, and derives a separate viewFor result per player. WebSocket messages use Zod discriminated unions. Event payloads distinguish public from seat-private information.

SQLite stores room settings, seed, ordered actions, and optional checkpoints. Reconnect resumes from the durable log and reissues only the reconnecting seat's view.

## Bots and web
A bot worker receives its own PlayerView, legal actions, and deterministic per-decision seed/budget; it cannot inspect engine state or other hands. The web app renders server-provided views and legal affordances; it contains no rules authority. SVG IDs correspond to graph IDs.
