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
