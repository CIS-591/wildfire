# Wildfire referee (instructor only)

The game engine for **Wildfire**, CIS 591 Module 4 (contract: [`../SPEC.md`](../SPEC.md)). Four teams,
one Miro board, one 10-minute forest fire; each student's Claude agent paints through Miro's MCP server.
This program watches the board through the Miro REST API and is the only thing that moves the fire:
it spreads it, burns squares out, turns the wind and strikes lightning once (minute 5), undoes illegal
paints, reads the "Spray water in <neighbour>'s area?" stickies, and keeps the banner, scoreboard,
leaderboard and inbox cards live. **It never paints water for anyone.**

Started as a copy of the Color Wars referee; [REFLECTION.md](REFLECTION.md) has last class's lessons.
Run day: [RUNBOOK.md](RUNBOOK.md).

## Setup (once)

1. Node 24, then `npm ci`.
2. A Miro app token with `boards:read` + `boards:write`, installed into the team that owns the board.
3. `.env` in this folder: `MIRO_ACCESS_TOKEN=...` and `MIRO_BOARD_ID=...`.
4. `npm run referee verify`: token, all 1,224 squares, fixtures, and the 4 colors round-tripped.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sim [-- --players 28 --seed 1 \| --seeds 3 --pace 45]` | Offline game with bots (no token) |
| `npm run referee build` | WIPES the board and builds it with the SPEC geometry; writes `config/layout.json` |
| `npm run referee verify` | Token + board + color check |
| `npm run referee reset` | New game: all green, the 4 centre squares orange, empty Inbox and Orders |
| `npm run referee lobby` | Students `/join`. Ctrl-C when all are in |
| `npm run referee run` | Starts the 10-minute fire and referees it. Ctrl-C pauses; `run` resumes |
| `npm run referee stop` | End now: highest % wins |
| `npm run referee results` | Winner, % per team, paints, approvals, refusals |
| `npm test` · `npm run typecheck` · `npm run lint` | Checks (incl. every attack in `test/ATTACKS.md` and a 30-bot vandal stress game) |

Options: `--poll 3` (seconds between reads), `--seed N` (repeatable fire), `--minutes N` (shorter game),
`--rehearsal` (test with ONE Miro account: every inbox card is its own player, a paint counts for the
square's team member who painted least recently, a question sticky's creator is the team's boss and its
YES/NO comes from another member; never in class). The game is saved to `state/game.json` every
poll, so a crashed or paused referee resumes; only one referee runs at a time (`state/referee.lock`).

## Rules (numbers in `config/rules.json`, colors in `config/colors.json`)

- 4 colors: green `#3fa66b` tree, orange `#ff5a1f` fire, blue `#3aa7ff` water, black `#2a2420` burnt
  (plus the board palette: square border `#0e1311`, panels `#161d19`, text `#f1efe9`, all in `config/colors.json`).
- Students only ever see "Team 1".."Team 4" (ids `ridge`, `pine`, `cedar`, `birch` stay internal).
- Fire spreads every `spreadSeconds` to green neighbours: `pSide` up/down/left/right, `pDiag` diagonal,
  ×`downwindMult` downwind, ×`upwindMult` upwind. A square burns `burnTicks` spreads, then turns black.
  Blue and black never burn. The wind turns 45° once at `windMinutes`; lightning at `lightningAt`
  (minutes), on a green square ≥ `lightningMinDistance` from any fire.
- A blue paint counts if: the game is live, the painter joined, ≥ `cooldownSeconds` since their last
  accepted paint, the square is green or orange, it is in their team's area (or in a neighbour's area
  their team has a YES for right now), and water is left (one pool of `waterTotal`). Anything else is undone.
- The human decision: a sticky in the team's own Orders frame whose first line is
  `Spray water in <neighbour>'s area?` (any case; "'s", "area" and "?" optional). Approved by a `YES`
  line when its last editor is on the team and is not its creator; the team may then paint blue in that
  neighbour's area for `outsideMinutes`. The team may be written `Team 2`, `team2`, `T2` or by its old name.
  Neighbours: Team 1–Team 2, Team 1–Team 3, Team 2–Team 4, Team 3–Team 4. Order stickies (`Ana: paint N9 N10`) are not parsed.
- Score: green + blue squares in the team's area, as % of its 306 squares. Ends at `gameMinutes`, or
  when nothing burns and the lightning has struck.

## Tuning (`npm run sim -- --seeds 3`)

Bots play at the pace of the first live rehearsal after the kit fixes (`results/rehearsal-1.log`: 8 agents
managed ~46 paints in 12 min; we assume a worker paints every 45–60 s, a boss every 90–120 s while also
keeping one order sticky per worker). Each paint lands on a board read 15–30 s old, 10% are mistakes,
and a simulated human answers each spray question after 20–60 s (15% NO). About half the tries are
wasted (square already blue/burnt, two bots on one square, wrong area), as in the rehearsal.

28 players:

| Seed | Burning at min 8 | Ridge | Pine | Cedar | Birch | Paints (tried) | Water used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 119 | 57% | 85% | 39% | 82% | 118 (233) | 79% |
| 2 | 129 | 21% | 63% | 54% | 89% | 117 (271) | 78% |
| 3 | 83 | 36% | 99% | 82% | 70% | 80 (181) | 53% |

8 players (2 per team, the rehearsal size): fewer hands, so the fire wins more:

| Seed | Burning at min 8 | Ridge | Pine | Cedar | Birch | Paints (tried) | Water used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 121 | 24% | 97% | 10% | 74% | 36 (58) | 24% |
| 2 | 177 | 15% | 83% | 25% | 43% | 40 (59) | 27% |
| 3 | 156 | 16% | 47% | 53% | 78% | 33 (60) | 22% |

Seeds 4–6 (28 players) ended 42/61/100/75, 100/78/100/75 and 100/53/99/76: when the first fire is put
out in the first minutes, the lightning at minute 5 is the whole game.

## Code

- `src/layout.ts`: geometry, sectors, colors, panels, Orders boxes, fixtures, wind.
- `src/rules.ts`: pure engine (spread, lightning, paints, spray questions, score, end), RNG injected.
- `src/referee.ts`: the loop (diff against a shadow copy → engine → board writes). `src/miro-rest.ts`:
  REST adapter with 429 back-off. `src/fake-board.ts`, `src/bot.ts`, `src/sim.ts`: offline testing.
