# Decisions

## 2026-10-29 — Phase 0 baseline
- Use the stack and package boundaries in AGENTS.md.
- Treat RULES.md as the initial specification; unresolved ambiguity stays listed in OPEN_QUESTIONS.md.
- Implement no game rules in Phase 0.
- The project name remains a placeholder; decide product branding before UI/package naming. Do not use the protected game name or official art in product assets.

## Reference project study
- Catanatron's upstream README describes a simulator, valid-action-based Gym interface, random player example, and pytest suite. Its repository identifies GPL-3.0; do not copy code.
- JSettlers2 developer documentation describes internal game options and scenario options prefixed _SC_; its source models explicit setup/turn states. The repository identifies GPLv3; do not copy code.
- These references inform architecture and test scenarios only. The official publisher's game-rules page links the base and expansion rulebooks; VERIFY items remain open until checked against their exact edition.

## 2026-10-29 — Phase 1 base engine
- The phase-1 board uses the standard 19-hex graph, seed-shuffled resource/number layouts, and 3–4 players. Fixed beginner and balanced map modes remain for Phase 3.
- Domestic trade actions represent one resource type given for one distinct resource type, with a positive count for each side. The rules text does not explicitly state whether offers may bundle multiple resource types; retain this as an open question.
- Development cards moved out of hand are kept in a discard list so replay and component-count invariants can account for every card.
- Victory is checked against the actor who performed the transition, including hidden victory-point cards, so ending a turn cannot award another player's win early.
- Official base-game FAQ confirms the seven-card discard rule and robber move/steal, shortage handling, development-card timing, and Longest Road tie behavior; unresolved edition details remain open.

## 2026-10-29 — Phase 2.1 root-cause findings

- **Lobby actions / `GAME_NOT_STARTED`:** The server sent a full `PlayerView` (including legal actions) as soon as a seat joined, while the room remained in `lobby`. The client rendered the action picker before the host started the game and sent those actions without a `gameStarted` acknowledgement. The server returned an unstructured string error, which the client appended to the event list. The old sidebar also had a second, unguarded Start button. The lifecycle is now explicit (`lobby`, `started`, `finished`); the lobby receives no game view, the client gates actions on the `gameStarted` message, and rejected requests carry stable error codes.
- **Bot turn stalls:** Bot scheduling ran on host start and after human actions, but not after rooms were restored from SQLite. A worker error only escaped as a logged rejection; it did not choose a fallback action. The server now resumes bot scheduling for restored active rooms and chooses a deterministic random legal action after worker failure. Bot state and stall reasons are sent to the room UI.
- **Board interaction:** The prior SVG created clickable circles only for settlement actions. It drew no edge hit targets, so roads could only be selected in the generic action picker. The picker was the only general route for roads/cities/cards/trades. Geometry and interactive layers are addressed in Part B.
- **Missing status panels:** `PlayerView` exposed the player's hand and public totals but not bank/deck inventory, public piece counts, played knights, road lengths, or award-holder flags. The UI therefore had no data contract from which to render those panels; Part C extends the view without revealing opponents' card identities.
- **Board/event presentation:** The renderer used a tile-center transform that did not match `Board.vertices`; its polygons and vertex dots therefore diverged. Edge/harbor/tile layers and event localization were absent. Part B fixes graph geometry/interaction; Part D replaces the presentation with original SVG/CSS.
- **Debug visibility:** The room protocol and UI had no lifecycle, bot-worker, action-history, or structured-rejection diagnostics. Part E adds the debug-only inspection surface and bundle.

- **Lifecycle policy:** Rooms require both human seats before the host starts. Bot seats never submit client messages. A resumed room is considered started when its persisted lifecycle says `started`; legacy rows with actions but no lifecycle are migrated as started.
- **Bot recovery policy:** On worker timeout/error, take one deterministic random legal action from that bot's own view. If no legal action exists or the fallback fails, mark the bot stalled with a reason and log it instead of silently waiting.

## 2026-10-31 — Human and bot room sizes

- **ASSUMPTION — total seat limit:** Room setup selects one to four human seats and a bot count, but keeps the base engine's supported total at three or four players. Therefore a solo human needs two or three bots, two humans need one or two bots, three humans may choose zero or one bot, and four humans play without bots. Supporting two total players or four bots plus a human would require changing the base-game player-count rules and engine.

## 2026-10-29 — Phase 2.1 Part B: board geometry and direct placement

- Preserve the established vertex and edge IDs while reprojecting coordinates to a regular pointy-top lattice. Room action logs store these IDs, so changing graph enumeration would break replays.
- Use only the server's `legalActions` to construct highlighted vertex, edge, and tile targets. Keep a broad SVG stroke/circle as the hit target and show a pending indicator until the correlated server update arrives.
- In automated browser checks, SVG road target clicks are made through Playwright's standard click path. The legal road edge has a separate visible dashed cue and a wider, almost transparent interaction stroke.
- Unknown visual or game-state behavior should be captured in the remaining Part C–E work; detailed view fields and debug instrumentation are not added in this part.

## 2026-10-29 — Phase 2.1 Part C: public inventory and player view

- `PlayerView` exposes bank resource counts, remaining deck size, seed/settings, turn state, and public player metrics. It exposes only each opponent's resource/development-card totals, never card identities or resource distribution.
- A player's public VP omits unrevealed victory-point cards; own card details remain in `ownDevelopmentCards`.
- The base engine models domestic trade as an already-accepted transfer. The UI must not present that as a consent-based offer until the server has an offer/accept protocol; bank/port trades remain immediate legal actions.

## 2026-10-29 — Phase 2.1 Part D: visual surface and collaboration

- Keep the board renderer as original SVG/CSS. Legal target layers remain above all pieces and use area-based road hit polygons; pointer drag starts only on non-target board space so it cannot swallow a placement click.
- Board navigation supports wheel and pinch zoom, drag panning and recentering. Browser coverage currently exercises button zoom/recenter; touch pinch still needs device-level verification.
- Room chat is ephemeral, rate-limited and broadcast only to currently connected seats. It is not persisted in the game action log.
- Event names are translated in the client from typed engine events; unresolved/unexpected events use a safe generic Dutch label instead of leaking internal event identifiers.

## 2026-10-29 — Phase 2.1 Part E: diagnostics

- The debug route is registered only under `DEBUG=1`; that mode defaults to `HOST=127.0.0.1` and refuses non-loopback/non-Tailscale bind addresses. The web proxy exposes the same read-only data below `/api/debug/rooms/:id`.
- A debug bundle intentionally includes the full action log and the requesting seat's view. It can reveal hidden information and should be shared only with trusted collaborators.
- State hashes use a stable FNV-1a hash over canonical JSON for both server and client views. This is intended to spot accidental view mismatches, not to provide cryptographic integrity.
- Debug-only dice/resource/setup mutation helpers are deferred: directly mutating game state without replayable actions would invalidate the persisted deterministic replay.

## 2026-10-30 — Phase 2b: consent-based domestic trade

- **ASSUMPTION — bundled terms:** An offer may give and request multiple resource types. Each side must contain at least one card, counts must be positive integers, and a resource type cannot appear on both sides. The proposer must hold the offered cards when proposing; both hands are checked again at acceptance. Alternative: retain the Phase 1 one-type-per-side restriction.
- **ASSUMPTION — consent and response:** A domestic transfer occurs only after an eligible target accepts. A decline is recorded publicly but does not close an offer, allowing other targets to respond. The proposer may cancel or replace the offer. Alternative: close the offer after the first decline or after every target declines.
- **ASSUMPTION — counter-offers:** One counter-offer level is allowed; it replaces the original offer and is addressed only to its original proposer. A counter cannot be countered again. Alternative: permit an unbounded negotiation chain or disallow counters.
- **Offer lifetime:** A pending offer is cancelled by explicit cancellation, replacement, successful acceptance, construction of a road/settlement/city, or end of turn. Buying a development card is not construction and does not itself cancel the offer.
- **Action validation:** Do not enumerate proposed bundle combinations in `legalActions`; this would grow combinatorially with bundle size. The engine's `validateTradeAction` validates proposal/counter terms, while legal actions enumerate concrete responses. The server calls the same validator. Alternative: enumerate a bounded set of offers, which would impose an arbitrary cap.
- **Legacy logs:** The engine and protocol continue to decode/replay immediate `domesticTrade` actions from old logs. The live server rejects them so current games always use consent.
- Trade offers and response state are public in every `PlayerView`; resource hands remain private. Offer IDs are deterministic state, so replay reconstructs them.
