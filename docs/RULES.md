# docs/RULES.md

Game rules reference. `VERIFY` = not confirmed from an official source here; confirm in the official rulebook/almanac or record an ASSUMPTION in `DECISIONS.md` and add to `OPEN_QUESTIONS.md`.

## 1. Base game: components

| Item | Count |
|---|---|
| Land tiles | 19: 4 forest (lumber), 4 pasture (wool), 4 fields (grain), 3 hills (brick), 3 mountains (ore), 1 desert |
| Number tokens | 18: 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12 (no 7, none on desert) |
| Harbors | 9: 4 x 3:1 generic, 5 x 2:1 (one per resource) |
| Bank | 19 cards per resource |
| Development cards | 25: 14 knight, 5 victory point, 2 road building, 2 year of plenty, 2 monopoly |
| Pieces per player | 5 settlements, 4 cities, 15 roads |
| Special cards | Longest Road (2 VP), Largest Army (2 VP) |

Board setup options: fixed beginner layout; random; **balanced** (no adjacent 6/8, preferably no adjacent equal numbers or 2/12, fair start spots).

## 2. Setup phase

1. Robber starts on the desert.
2. Players place 1 settlement + 1 adjacent road in turn order 1..n, then again in order n..1.
3. Each initial road must touch the settlement just placed.
4. Distance rule: no settlement or city on a vertex adjacent to another settlement or city (anyone's).
5. For the second settlement, the player immediately receives 1 card per adjacent producing tile.

## 3. Turn

1. Before rolling: may play one development card (e.g. knight).
2. Roll two dice. No building or trading before rolling.
3. Production (not on 7): settlement = 1 card, city = 2 cards per tile with the rolled number. The tile under the robber produces nothing.
4. Bank shortage: if the bank cannot cover a resource and more than one player is owed it, nobody gets it; if only one player is owed it, that player gets what is left.
5. On a 7: every player with more than 7 cards discards half (rounded down). Then the active player must move the robber to a different tile (desert allowed) and steals 1 random card from a player with a building on that tile.
6. Trade and build in any order.
7. End turn.

## 4. Building

| Item | Cost | Rules |
|---|---|---|
| Road | 1 brick, 1 lumber | Connect to own road/settlement/city. Cannot continue through an opponent's building. |
| Settlement | 1 brick, 1 lumber, 1 wool, 1 grain | Connect to own road. Distance rule. 1 VP. |
| City | 2 grain, 3 ore | Replaces own settlement (settlement piece returns to supply). 2 VP. |
| Development card | 1 wool, 1 grain, 1 ore | Drawn from shuffled deck, hidden. None left means cannot buy. |

A player without pieces of a kind cannot build it.

## 5. Trading

- Domestic: only the active player trades with others; counter-offers allowed; non-active players cannot trade with each other. A trade must give at least 1 and receive at least 1 card, never the same resource type on both sides.
- Maritime: 4:1 default, 3:1 with a generic harbor, 2:1 with the matching specific harbor (best available applies). Harbor access needs a settlement/city on the harbor vertex.
- Card counts are public; card types are hidden.

## 6. Development cards

- A card bought this turn cannot be played this turn (VP cards may be revealed when they give the win).
- Max 1 development card played per turn (VP cards excluded).
- Knight: move robber and steal; counts for Largest Army; may be played before rolling.
- Road building: 2 free roads (fewer if pieces run out).
- Year of plenty: 2 resources of choice from the bank (limited by bank stock).
- Monopoly: name a resource; all other players give you all their cards of that type.

## 7. Special cards and winning

- Longest Road: at least 5 segments; longest simple path (no repeated edge; loops allowed; branches count only the longest). An opponent's settlement/city on a vertex interrupts the path; own buildings do not. Recompute on every change.
  - Tie: current holder keeps it.
  - If the holder no longer has the longest and several others tie: nobody holds it until one player has a unique longest (min 5).
- Largest Army: at least 3 played knights and strictly more than the holder.
- VP: settlement 1, city 2, VP card 1 each, Longest Road 2, Largest Army 2.
- Win: reaching the target (default 10) is checked on the player's own turn, including hidden VP cards. Target is configurable per map/expansion.

## 8. Edge cases that need explicit tests

- Longest road: loop of 6 counts 6; branch counts longest branch; opponent settlement splits a road; exactly 5 awards, 4 does not; tie keeps holder; multiple new ties with no holder.
- Seven: 9 cards means discard 4; exactly 7 keeps; robber must move; no adjacent player means no steal; steal is random and hidden.
- Bank: shortage with multiple recipients gives nothing; with one recipient gives the remainder; year of plenty on a nearly empty bank.
- Dev cards: same-turn play rejected; second card in a turn rejected; knight before roll; empty deck; hidden VP wins.
- Setup: distance rule; second settlement pays out; reverse order; initial road attaches.
- Trade: same-type rejected; harbor ratios; best ratio wins; non-active players cannot trade each other.
- Pieces: city returns settlement; piece limits.
- State machine: no build/trade before roll; cannot end turn while a discard or robber move is pending.
- Win: only on own turn; immediately on reaching the target during own turn.

## 9. Seafarers (Seafarers of Catan expansion)

Reference: JSettlers2 (ships, pirate, gold, scenario options; scenario keys start with `_SC_`). Scenarios are data + rule modules.

- Ships: cost 1 lumber + 1 wool. Ships go on sea/coast edges, roads on land edges. A chain of ships must start at a settlement. The open-end ship of a chain may move once per turn, not in the turn it was built, and only if the chain is not anchored at both ends. Max ships per player: `VERIFY`.
- Longest trade route: roads + ships count together; a settlement/city is needed between a road segment and a ship segment for them to be contiguous.
- Road building card: 2 roads, 2 ships, or one of each.
- Pirate: acts like a robber at sea. On a 7 or knight, move the robber OR the pirate. The pirate steals from a player with a ship next to its tile and blocks building/moving ships next to it; it does not block harbors or settlements.
- Gold fields: each adjacent settlement gets 1 free resource of choice, each city 2 (resources only, never commodities).
- New islands: in many scenarios the first settlement on a new island gives +1 VP.
- Fog/exploration: some tiles start face down; building next to one reveals it and gives 1 matching resource if it produces.
- Initial placement restrictions ("home islands") per scenario.
- Scenarios: Heading for New Shores, The Four Islands, The Fog Island, Through the Desert, The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan. VP targets per scenario: `VERIFY`.
- Implementation order: core (ships, pirate, gold, island VP, fog), then scenarios with extra mechanics.

## 10. Cities & Knights

No open-source reference here (neither Catanatron nor JSettlers2 is known to implement it; `VERIFY`). Use the official rulebook and almanac (progress cards, roughly pages 14-18).

- Win target: 13 VP (`VERIFY`). No development cards and no Largest Army; Longest Road stays.
- Commodities (36 cards, 12 each): paper (forest), cloth (pasture), coin (mountains).
  - City on grain or hills: 2 cards as usual. City on forest/pasture/mountains: 1 resource + 1 commodity (lumber+paper, wool+cloth, ore+coin). Settlements produce 1 resource.
  - Grain activates knights; brick builds city walls.
- Setup: second initial settlement is a city (`VERIFY`).
- Dice: red + yellow production dice plus an event die (3 ships, 3 city gates in three colors). Resolution order: `VERIFY`.
- Barbarians: track of 7 steps, one step per ship; on arrival they attack, then return to the start (`VERIFY`).
  - Attack strength = total cities + metropolises of all players.
  - Defense = total strength of all **active** knights (basic 1, strong 2, mighty 3).
  - Defense >= attack: highest contributor gets a "Defender of Catan" VP card (6 exist); ties each draw a progress card (`VERIFY`).
  - Defense < attack: player(s) with the lowest active knight strength lose a city (becomes settlement, its wall is removed). Metropolises cannot be destroyed; skip to the next player in line.
  - After every attack all knights become inactive.
  - The robber is inactive until the first barbarian attack (`VERIFY`); before that a 7 still forces discards.
- Knights: 3 levels, max 2 per level. Mighty needs Politics level 3 (`VERIFY`). Build/promote cost 1 wool + 1 ore (`VERIFY` exact per step). New knights are inactive; activation costs 1 grain. An active knight does one action per turn (move along own roads, displace a weaker enemy knight, chase the robber) and becomes inactive afterwards (`VERIFY` limits).
- City walls: 2 brick, only under a city, max 3 per player, each raises the hand limit by 2 (`VERIFY`).
- City improvements: three tracks of 5 levels: Trade (cloth), Politics (coin), Science (paper). Level n costs n commodities of that track. Level-3 perks (Science: aqueduct, Politics: fortress, Trade: `VERIFY`).
- Metropolis: first player to reach level 4 in a track places a metropolis on one of their cities (+2 VP, immune to barbarians); a player reaching level 5 in the same track can take it (`VERIFY`).
- Progress cards: 54, 18 per color (Science green, Politics blue, Trade yellow). Yellow breakdown from the component list: 6 Merchant, 4 Resource Monopoly, 2 each of Commercial Harbor, Master Merchant, Merchant Fleet, Trade Monopoly. Implement all 54 from the almanac. Draw condition on a gate result: `VERIFY`. Hand limit 4: `VERIFY`. Constitution and Printer are VP cards.
- Merchant: placed on a tile next to own settlement/city; 1 VP and 2:1 trade for that resource while held (`VERIFY`).
- VP summary: settlement 1, city 2, metropolis +2, Defender of Catan 1 each, Longest Road 2, Merchant 1, Constitution/Printer 1 each.

## 11. Seafarers + Cities & Knights

- Gold fields give resources only, no commodities.
- Barbarian attacks in multi-island scenarios use the normal Cities & Knights rules.
- Anything that applies to roads (knight movement, road building) must also work for ships (`VERIFY`).
- Exploration scenarios (e.g. Fog Island) are not recommended with Cities & Knights: show a warning in room settings, do not block.

## 12. Maps (data, not code)

A map file defines: tile coordinates (axial/cube) with type (resource, desert, sea, gold, fog), number tokens (fixed or randomized with constraints), harbors, island ids and special VP per island, start restrictions per player, supported player counts and expansions, VP target. Generators take a seed and are checked by validators (fair start spots by pip totals, no adjacent 6/8, harbors reachable).

Target map kinds (indicative, from a colonist.io overview): base, 5-6 players base, Seafarers, 5-6 Seafarers, Cities & Knights, 5-6 Cities & Knights, Seafarers + Cities & Knights, plus original variants in the spirit of "Gold Rush", "Volcano", "Black Forest". Exact colonist.io layouts are unknown: design original maps.

## 13. Room options

Player count and seat types (human/bot + bot strength), map, board setup (fixed/random/balanced) and seed, VP target, hand limit on 7, friendly robber (optional), balanced dice (shuffled stack of the 36 outcomes, optional), turn timer (optional), expansions on/off. Later: 5-6 players with special building phase (`VERIFY`), 1v1 variant (`VERIFY`).
