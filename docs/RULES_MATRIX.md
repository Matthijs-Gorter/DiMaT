# Rules matrix

The base-game implementation is covered by the named Vitest cases below. Official base-game references: [rulebook index](https://www.catan.com/understand-catan/game-rules) and [base-game FAQ](https://www.catan.com/faq/basegame). Expansion rows remain planned for their later phases.

| Rule | Source | Test coverage / planned test |
|---|---|---|
| Base components, board graph, resource/development inventory | RULES §1; official base rules | `uses the standard 19 tile, 54 vertex, 72 edge and development-card set`; seeded inventory property |
| Setup snake order, initial road attachment and distance rule | RULES §2; official base rules | `uses forward then reverse order for three players`; `requires each setup road to attach to the settlement just placed`; `enforces setup distance rule` |
| Starting resources from second settlement | RULES §2; official base rules | `pays one resource per adjacent producing tile for the second settlement` |
| Roll/turn phases and pre-roll Knight | RULES §3, §6; official FAQ | `does not permit building or trading before the roll`; `allows a knight before rolling and only one development card each turn` |
| Settlement/city production and robber-blocked tile | RULES §3; official FAQ | `pays one resource per settlement and two per city, and blocks robber production` |
| Bank shortage, multiple recipients and sole recipient | RULES §3, §8; official FAQ | `blocks production when multiple players are owed a resource the bank cannot cover`; `gives the remainder to a sole recipient during bank shortage` |
| Seven discard threshold/rounding and mandatory robber move | RULES §3, §8; official FAQ | `nine cards discard four, while exactly seven cards keep all cards`; `requires a new robber tile and permits no victim when none is adjacent` |
| Robber steal is random and hidden | RULES §3, §8; official FAQ | `moves a stolen card without revealing its resource in the public event` |
| Build costs, connectivity and piece supply | RULES §4, §8; official base rules | `does not offer road or settlement construction when the matching supply is exhausted`; city upgrade returns settlement piece |
| Domestic trade validation and inactive players | RULES §5, §8; official FAQ | `rejects same-resource trades and non-active-player trades`; multi-card trade case |
| 4:1 default, 3:1 generic, matching 2:1 harbor; best ratio | RULES §5, §8; official base rules | `uses 4:1 default maritime trade`; `uses 3:1 with an accessible generic harbor`; `uses 2:1 with the matching specific harbor`; `uses the best accessible harbor ratio` |
| Development-card timing, once-per-turn, exhausted deck | RULES §6, §8; official FAQ | `cannot play a development card on the turn it was bought`; `allows a knight before rolling and only one development card each turn`; `cannot buy from an empty development deck` |
| Knight, road building, Year of Plenty and Monopoly | RULES §6; official base rules | Knight timing and `places two connected free roads and consumes the card once`; limited-bank Year of Plenty; Monopoly in random-game coverage |
| Longest Road loop, branch, interruption, threshold and ties | RULES §7, §8; official FAQ | `counts a six-edge loop without repeating edges`; `counts only the longest branch rather than summing branches`; interruption, 4/5 threshold and both tie cases |
| Largest Army threshold and ties | RULES §7; official FAQ | `awards Largest Army at three knights and keeps its holder on a tie`; multiple-new-player tie |
| Hidden VP, own-turn check and immediate win | RULES §7, §8; official base rules | `reveals a hidden VP card and wins immediately on the player turn`; own-turn-only and immediate-build win |
| Pure transitions, deterministic PRNG and event replay | AGENTS.md engine rules 1, 7 | `does not mutate the source state and accepts equivalent object-key ordering`; `replays an action log to the identical final state`; fast-check seed properties |
| Hidden player information and legal-action view | AGENTS.md engine rules 2, 3 | `does not expose another player hand or development-card identities`; simulator checks an available action after every transition |
| Full-game invariants and termination | PHASES.md Phase 1 | fast-check random-game property; `pnpm sim --games 10000 --seed 1` |
| Seafarers ships, movement, route, pirate, gold, islands and fog | RULES §9; official Seafarers rules | Planned Phase 4 tests |
| Cities & Knights commodities, dice, barbarians, knights, progress cards | RULES §10; official Cities & Knights rules/almanac | Planned Phase 5 tests |
| Expansion combinations | RULES §11; official expansion rules | Planned Phase 6 tests |
| Seeded maps, validation and room settings | RULES §12–13; project specification | Planned Phases 2–3 tests |
