# Wildfire referee (instructor only)

The game engine for **Wildfire**, CIS 591 Module 4 (contract: [`../SPEC.md`](../SPEC.md)). The class
defends one forest on one Miro board: four teams, each protecting a sector, each student's Claude
agent painting through Miro's MCP server. This program watches the board through the Miro REST API
and is the only thing that moves the fire: it spreads it every 20 s (wind, embers, lightning), burns
squares out, dries water, reverts illegal paints, reads the PLAN / BACKBURN / HELP approvals on the
sticky notes in the Orders frames, and keeps the banner, scoreboard, leaderboard and inbox cards live.
**It never paints water, firebreaks or backburns for anyone.**

Started as a copy of the Color Wars referee; [REFLECTION.md](REFLECTION.md) has last class's lessons.
Run day: [RUNBOOK.md](RUNBOOK.md).

## Setup (once)

1. Node 24, then `npm ci`.
2. A Miro app token with `boards:read` + `boards:write`, installed into the team that owns the board
   (apps live in a free Developer team: https://miro.com/app/dashboard/?createDevTeam=1; untick
   "Expire user authorization token").
3. `.env` in this folder: `MIRO_ACCESS_TOKEN=...` and `MIRO_BOARD_ID=...`.
4. `npm run referee verify`: token, all 1,224 squares, fixtures, and every square color round-tripped
   through REST. If brown (`#8b5a2b`) comes back wrong, set `firebreak` to `#808080` in
   `config/colors.json` and in `kit/board.json`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sim [-- --players 28 --seed 1 \| --seeds 3]` | Offline game with bots (no token): per-minute fire, water and team % |
| `npm run referee build` | WIPES the board and builds it with the SPEC geometry; writes `config/layout.json` |
| `npm run referee verify` | Token + board + color check |
| `npm run referee reset` | New game: starting colors, empty Inbox and Orders frames, no players |
| `npm run referee lobby` | Students `/join`, bosses post PLANs, teammates approve. Ctrl-C when all are in |
| `npm run referee run` | Lights the fire and referees it. Ctrl-C pauses (the fire freezes); `run` resumes |
| `npm run referee stop` | End now: highest % wins |
| `npm run referee results` | Winner, % per team, paints, approvals, refusals |
| `npm test` · `npm run typecheck` · `npm run lint` | Checks |

Options: `--poll 3` (seconds between board reads), `--seed N` (repeatable fire). The game is saved
to `state/game.json` after every poll, so a crashed or paused referee resumes where it was.

## The board

Either board works, they are interchangeable: the one built through the Miro MCP (`../board/`) or
`npm run referee build`. The referee finds squares by their label, fixtures (banner, scoreboard,
leaderboard) and Orders frames by position, and the 9 grid frames by their boxes. Item ids come from
`config/layout.json` (REST build) or `../board/board.json` (MCP build) when present.

## Rules (numbers in `config/rules.json`, colors in `config/colors.json`)

- Fire spreads every `spreadSeconds` to forest/cabin neighbours: `pSide` up/down/left/right, `pDiag`
  diagonal, ×`downwindMult` downwind, ×`upwindMult` upwind. Embers (`pEmber`) jump 2 squares
  downwind. A square burns `burnTicks` spreads, then turns burnt.
- Wind: 8 directions, turns 45° every `windMinutes`. Lightning at each minute in `lightningAt`, on a
  forest square ≥ `lightningMinDistance` from any fire.
- Water dries after `wetSeconds`; one shared pool of `waterTotal`.
- A paint counts only if: the game is live, the painter joined, ≥ `cooldownSeconds` since their last
  paint, their team has an approved PLAN, the square is in their sector (or a HELP grant covers it),
  and it is water on fire/forest/cabin, firebreak on forest, or burnt on forest in an approved BACKBURN.
- Approvals: a sticky in a team's Orders frame whose first line is `PLAN`, `BACKBURN <squares>` or
  `HELP <team>` is approved by a `YES` line when its last editor is on that team and is not its creator.
- Score: forest + water + 10 per standing cabin in the sector, as % of its start. Ends at
  `gameMinutes`, or when nothing has burned for `quietSpreads` spreads after the last lightning.

## Tuning (28 bots, ~15 s per move, `npm run sim -- --seeds 3`)

Bots play like the kit: one boss per team keeps an ORDER sticky per worker and posts PLAN / BACKBURN /
HELP; workers paint from their (possibly stale) orders every ~15 s with 10% mistakes; a simulated
human answers each approval after 10–40 s. With the shipped `rules.json`:

| Seed | Ends | Burning at 20 min | Ridge | Pine | Cedar | Birch | Water left |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 22.7 min (fire out) | 11 squares | 79% | 82% | 85% | 37% | 49 |
| 2 | 28 min (fire out) | 4 squares | 78% | 54% | 54% | 91% | 19 |
| 3 | 22 min (fire out) | 22 squares | 61% | 85% | 95% | 49% | 64 |

Over 10 seeds: burning at 20 min in 10/10, 28 of 40 team scores between 40% and 90%. The 4 starting
fires are usually put out in the first two minutes; lightning every 5 minutes starts the real fronts.

## Code

- `src/layout.ts`: geometry, sectors, map features, panels, Orders boxes, fixtures, wind.
- `src/rules.ts`: pure engine (spread, embers, lightning, drying, paints, approvals, score, end), RNG injected.
- `src/referee.ts`: the loop (diff against a shadow copy → engine → board writes). `src/miro-rest.ts`:
  REST adapter with 429 back-off. `src/fake-board.ts`, `src/bot.ts`, `src/sim.ts`: offline testing.
