# Wildfire referee (instructor only)

The game engine for **Wildfire**, CIS 591 Module 4 (contract: [`../SPEC.md`](../SPEC.md)). Four teams,
one Miro board, one 10-minute forest fire; each student's Claude agent paints through Miro's MCP server.
This program watches the board through the Miro REST API and is the only thing that moves the fire:
it spreads it, burns squares out, strikes lightning in each area once, undoes illegal paints and junk,
reads the "Start a fire in <neighbour>'s area?" stickies, and keeps the banner, scoreboard,
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
| `npm run sim [-- --players 28 --seed 1 \| --seeds 5 --slow --rules config/rules.8players.json]` | Offline game with bots (no token) |
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
Whenever a fixture or square gets a new id (and on `reset`), the referee writes the live ids to
`state/live-ids.json`; run `python3 ../board/build/sync_ids.py` to merge them into `board/board.json`,
`kit/board.json` and `config/layout.json`, so agents never peek at a replaced id.

## Rules (numbers in `config/rules.json`, colors in `config/colors.json`)

- 4 colors: green `#3fa66b` tree, orange `#ff5a1f` fire, blue `#3aa7ff` water, black `#2a2420` burnt, on a
  light board (backdrop `#f5f6f8`, white square borders and band frames, panels `#ffffff`, all in `config/colors.json`).
- Students only ever see "Team 1".."Team 4" (ids `ridge`, `pine`, `cedar`, `birch` stay internal).
- Fire: every `spreadSeconds` each burning square may ignite each green neighbour, `pSide` up/down/left/right
  and `pDiag` diagonally, the same in every direction. A square burns `burnTicks` spreads, then turns
  black. Blue and black never burn. It starts in the centre plus a 2-square fire in every area (`startFires`,
  mirrored); lightning at `lightningAt` hits each team's area once (shuffled), ≥ `lightningMinDistance` from fire.
- Wind is switched off (`wind.enabled: false`) but kept: switched on, `wind.pDown`/`wind.pUp` apply with
  and against it, it turns 45° once at `wind.turnAt` with a 30 s warning on the banner.
- Water: one bucket per team (`waterPerTeam`); each accepted blue square uses 1 from the painter's team.
- Paints come in batches: up to `paintBatch` squares by one player in one poll, then `cooldownSeconds`.
  Blue counts on a green or orange square in the painter's own area. Orange counts on a green square in a
  neighbour's area during the team's approved attack (at most `attackSquares` per attack). Anything else is undone.
- The human decision: a sticky in the team's own Orders frame whose first line is
  `Start a fire in <neighbour>'s area?` (any case; "'s", "area" and "?" optional; the old "Spray water" and
  "Grab squares" forms are not questions). Approved by a `YES` line when its last editor is on the team and
  is not its creator: for `attackMinutes` the team may light up to `attackSquares` squares there; at most
  `attacksPerTeam` approved attacks per game. A team's fire carries its origin as it spreads (a width-6
  border in its color; burnt squares keep it at width 3), into any area, its own included (blowback).
  Neighbours: Team 1–Team 2, Team 1–Team 3, Team 2–Team 4, Team 3–Team 4. Order stickies (`Ana: paint N9 N10`) are not parsed.
- Score: green squares left in the team's own area, as % of 306. Ends at `gameMinutes`, or when nothing
  burns and all the lightning has struck.
- Junk: images, embeds, documents and previews anywhere on the board are found every poll by a
  type-filtered listing and deleted; shapes/texts dropped on the forest, a panel, a fixture or an Orders
  frame too. The poster is frozen 5 s, then 30 s, then 2 min per item. This runs in every phase, the
  post-game guard included.
- Fixtures (banner, scoreboard, leaderboard) are read by id every poll; a deleted one is recreated in
  **exactly the same box** it had (saved in `state/game.json` as `fixtureBoxes`), with a new id. Agents
  that lose a fixture id should re-find it with a small read of that box (SPEC.md §1 panel boxes). All three
  are also rewritten for 2 polls when the game ends and every 5 polls (live and post-game), so a fake banner
  never stays up.
- Speed: a tick's reads run in parallel (paged per-frame grid read, fixtures + 2 cards by id, the typed junk
  listing), each fire write's re-read (A119) runs in the write's own task, 24 calls in flight. With
  150–300 ms per Miro call: ~1 s ticks, ~2 s on spread ticks (~70 reads + ~65 writes), 8 or 30 players
  (`test/stress.test.ts` A124). Rehearsal 3 had 11–12 s ticks.

## Tuning (`npm run sim -- --seeds 5`)

Bots are calibrated on live rehearsal 3 (`results/rehearsal-3.log`, 8 real Claude agents): a turn every
14–25 s (bosses spend about half their turns on orders only), batches of 2–5 squares on a board read
20–35 s old (the agent's read plus the referee's tick), 40% of picks one or two squares beside/behind the
front instead of on it, 5% mistakes; a simulated human answers each attack question after 20–60 s (15% NO).
`--slow` = half that pace (30–50 s turns, reads 25–40 s old). `--late 74` starts the agents 74 s after the
fire, as in rehearsal 3.

Calibration (rehearsal-3 rules: `startFiresAt` 0, `pSide` 0.35, `pDiag` 0.1, `burnTicks` 3, water 100; 8 bots, `--late 74`, 5 seeds):

| | Real (rehearsal 3) | Bots |
| --- | --- | --- |
| accepted squares | 258 | 241–287 |
| accepted / player / min | 4.6 | 3.9–5.0 |
| blue paints refused as already burnt/blue | 21% | 17–25% |
| final scores | 0 / 3 / 1 / 0% | 0–3% |
| fire out | 8.7 min | 8.7–9.3 min (one seed: time) |
| water used | 64% | 60–72% |

The tuning depends on players × pace, so there are three files. All light the in-area start fires at
minute 1 (`startFiresAt`), so agents are reading the board before their area burns:

| File | For | Rules | Result (5 seeds) |
| --- | --- | --- | --- |
| `config/rules.json` | 28 players | pSide 0.35, pDiag 0.05, burnTicks 3, water 180 | scores 18–79% (17/20 in 30–80), fire to minute 8.7–10, water 60–84% used, 5–7 attacks |
| `config/rules.8players.json` | 8 players | pSide 0.2, pDiag 0.03, burnTicks 3, water 90 | scores 34–85% (18/20 in 30–80), fire to minute 9.7–10, water 65–86% used, 5–7 attacks |
| `config/rules.slow.json` | 28 slow agents | pSide 0.2, pDiag 0.03, burnTicks 3, water 120 | scores 22–83% (18/20 in 30–80), fire to minute 9–10, water 59–76% used, 4–7 attacks |

The fire is sensitive: +0.05 on `pSide` roughly halves the scores. Pick the file that matches the class
(`--rules config/rules.8players.json` on any command); with fewer players than the file assumes, teams lose everything.

## Code

- `src/layout.ts`: geometry, sectors, colors, panels, Orders boxes, fixtures, neighbours/wind directions.
- `src/rules.ts`: pure engine (spread, origins, lightning, batches, paints, attack questions, junk freezes, score, end), RNG injected.
- `src/referee.ts`: the loop (diff against a shadow copy → engine → board writes). `src/miro-rest.ts`:
  REST adapter with 429 back-off. `src/fake-board.ts`, `src/bot.ts`, `src/sim.ts`: offline testing.
