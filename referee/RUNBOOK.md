# Wildfire run-day runbook (instructor only)

Two terminals in this folder: **A** runs the referee, **B** is for one-off commands. Board on the projector.
The game itself lasts **10 minutes**.

## The day before

- [ ] `.env` set (README), `npm run referee verify`: 1224/1224 squares, 10 fixtures (banner, scoreboard,
      4 leaderboard rows `rank_1`..`rank_4`, 4 score badges `rank_N_score`), 4 colors OK. A missing fixture is
      created on the spot: then run `python3 ../board/build/sync_ids.py` and push `kit/board.json` so agents
      get the row ids.
- [ ] Board ids: `config/layout.json` is copied from `../board/board.json` by `python3 ../board/build/sync_ids.py`.
- [ ] Board shared with the class team (students must be editors).
- [ ] Lock the static items in the Miro UI (backdrop, title, rules panel, compass, Orders header bars,
      Inbox panel). Do **not** lock squares, banner, scoreboard, leaderboard rows, score badges, leaderboard icons or the Orders frames.
- [ ] Decide the teams: they are drawn at random when `run` starts the game. Pick a size for the class,
      e.g. `--team-size 4` (14 players: 4, 4, 3, 3; 8 players: two teams of 4, Teams 3 and 4 not playing),
      or `--teams 3`. `--no-draw` = placed as they join. Optional preset teams: copy
      `config/teams.example.json` to `config/teams.json` (presets keep their team in the draw).
- [ ] Optional, for big classes (halves the Miro rate-limit use per token): a second referee token.
      Miro's limit (100,000 credits/min) is per user, so the token must come from a DIFFERENT Miro account:
      invite that account to the board with edit access, create a token for it the same way as the first
      (README), and add `MIRO_ACCESS_TOKEN_2=...` to `.env` (same `MIRO_BOARD_ID`). Then `supervise` runs two
      referees and restarts each on its own: the game referee (token 1: squares, fire, banner, leaderboard,
      inbox cards, `state/game.json`) and the guard (token 2: junk, moved/edited board panels and frames,
      stickies in the wrong Orders frame, spotting new inbox cards). They talk through `state/joins.jsonl` and
      `state/guard-feedback.jsonl`; the guard's log lines start with `[guard]`. Without `MIRO_ACCESS_TOKEN_2`
      one referee does everything, as before. By hand: `npm run referee serve -- --role guard`.
- [ ] Rehearsal with ONE Miro account and several Claude sessions: `npm run referee reset`, then
      `npm run referee lobby -- --rehearsal`, everyone `/join`, Ctrl-C, `npm run referee run -- --rehearsal`
      (add `--minutes 5` for a short one), try one "Start a fire in …'s area?" + YES, `stop`, `reset`.

## Bot rehearsal (30 scripted players, for a screen recording)

`npm run referee bots` plays N scripted players on the real board: each makes a `/join` card
(`Inbox · Bot01` … `Bot30`), reads its team and role off the card, and plays (boss orders, blue from
the orders and the front, attack question + a teammate's YES, orange during the attack). `--class` plays
like the real class (results/serve-4teams.log rounds 2-3): joins over ~2.5 min, a third start 1-3 min
after GO, ~half of the blue refused (on fire / burnt / no fire within 2), a few wrong-hex blues, a few
over-5 batches, a few orange paints without a YES, bosses who rarely paint, ~10 approved attacks, and 2
vandal seats that drop an image and a stray sticky on the forest (the guard removes them). It stops at
GAME OVER or Ctrl-C and removes nothing (the next `reset` clears the cards and stickies).

**Identity.** Every bot write comes from ONE Miro user (the bot token's). The referees ignore their own
users' writes, so they run with `--bots-token N`: rehearsal attribution (each inbox card is a player; a
paint counts for a member of the square's team; a sticky's poster/answerer are stand-ins from that team)
and every referee token's user is "self" EXCEPT the bots' one. The Claude agents' MCP account is the same
user as `MIRO_ACCESS_TOKEN`, so never put the bots on token 1 while a game referee and a guard both run.

| Setup | `.env` | Game referee | Guard | Bots | Referee flag |
| --- | --- | --- | --- | --- | --- |
| **Best: a third Miro account** | `MIRO_ACCESS_TOKEN_3` (invite it to the board as editor) | token 1 | token 2 | token 3 | `--bots-token 3` |
| **Two accounts (no third)** | tokens 1 and 2 | token 1 | token 2 (shared with the bots) | token 2 | `--bots-token 2` |
| One account (last resort) | `MIRO_ACCESS_TOKEN_2=` blank | token 1 (solo: guard work too) | – | token 1 | `--bots-token 1` (= plain `--rehearsal`) |

`bots` picks token 3 if set, else 2, else 1 (`--token N` to force) and prints the referee flag to use.
With bots on token 2 the guard has no "self" of its own: it tells its own put-backs apart by what it last
wrote, exactly as a plain rehearsal does; the game referee's user is still its partner's self.

**Commands, in order** (terminal A = referees, B = bots):

1. Stop the running referee: Ctrl-C in A (wait for `[supervise] ... not restarting`).
2. `.env`: the tokens for the setup you chose (restore `MIRO_ACCESS_TOKEN_2` if it was blanked).
3. B: `npm run referee reset` (fresh board: starting colors, empty Inbox and Orders).
4. A: `npm run referee supervise -- --bots-token 2` (or `3`; add `--minutes 5` for a short one).
5. B: `npm run referee bots -- --players 30 --class --seed 1`. Wait until its status line says
   `30/30 joined, 30 on a team` (~2.5 min with `--class`, ~20 s without).
6. Terminal C: `npm run referee start`. Record. The bots stop by themselves at GAME OVER.
7. After: Ctrl-C A, then `npm run referee reset` for the next run.

Prove it offline first (FakeBoard, both referees in-process, bots on the guard's user):
`npm run referee bots -- --players 30 --class --dry-run` (prints `dry run OK`; `--token 3` = a third account).

**Miro credits** (limit 100,000/min per user; a page of a listing = 100, a read by id = 50, a write = 100):

| Process (token) | Reads | Writes | ≈ credits/min |
| --- | --- | --- | --- |
| Bots, shared reader every 5 s (token 3 default) | grid 27 pages + Orders 4 + fixtures 6 = 3,400 per read → 41k; cards ~2k (15k while waiting for teams in the lobby) | `--class` 60-150/min (agent pace 100-300), capped at 450/min | **~50-60k** (`--class`), ≤ 90k worst case |
| Bots on token 2 (default every 6 s, cap 300 writes/min) | ~34k + cards | ≤ 30k | ≤ 65k, + the guard's ~15k (one full listing per ~15 s tick) = **≤ 80k on token 2** |
| Bots on token 1 (default every 10 s, cap 200/min) | ~20k | ≤ 20k | ≤ 40k + the solo referee's own (~60k at `--poll 3`): run the referee with `--poll 4` |
| Game referee (token 1) | ~29 reads per 3 s tick | fire, cards, fixtures | unchanged by the bots |

Tune with `--read-every S` and `--writes-per-min N`; a 429 is waited out (the bots just slow down).
In rehearsal the referee can't tell which bot painted, so the paint batch/cooldown limits and the
"stickies in another team's Orders" check don't bite (that is why the vandals' stray sticky goes on
the forest).

## Run day (about 40 minutes)

| Time | Instructor | Students |
| --- | --- | --- |
| −15 | B: `npm run referee verify`, then `npm run referee reset` | |
| 0:00 | Slides: the forest, the 4 areas, boss/worker, blue in your area, the one human question (attack a neighbour), one water bucket per team | |
| 0:08 | A: `npm run referee lobby` | `/join Your Name` (card: "you're in! 🎲"), then `/play` |
| 0:12 | Everyone has a card: Ctrl-C A, then A: `npm run referee supervise -- --team-size 4` (not `run`: a watchdog restarts the referee if it crashes or hangs; the draw: each card gets its team and role) | Agents paint; humans answer the attack question when their Claude asks |
| 0:22 | The game ends by itself (10 min, or the fire is out after the lightning) | |
| 0:24 | B: `npm run referee results`; debrief (SPEC.md section 4) | |

## If something goes wrong

| Problem | Fix |
| --- | --- |
| A team's paints outside its area are undone | Blue only counts in your own area; orange in a neighbour's area needs a YES on "Start a fire in …'s area?" from a teammate who didn't post it (3 squares, 2 min, 2 attacks per game) |
| Need a break / referee crashed | Under `supervise` a crash or hang is restarted by itself (2 s, longer if it keeps crashing; see `results/supervise.log`). Ctrl-C pauses (banner says PAUSED, the fire freezes); `npm run referee supervise -- --team-size 4` resumes |
| Supervisor says "not restarting" | Read the reason on the last `[supervise]` line: game over, `stop` used, `.env` error, or another referee holds the lock |
| A student joins late | Just `/join`: they get a team at once (a smallest team in play) |
| Out of time | B: `npm run referee stop` (highest % wins): the referee in A ends the game on its next poll |
| Someone moved or deleted a square / the banner | Put back within one poll; the player is frozen 5 s |
| 429 rate limits | Only one referee runs (`state/referee.lock`; the guard: `state/guard.lock`). Add `MIRO_ACCESS_TOKEN_2` (see "The day before"), or `--poll 5` |
| Junk stays on the board (with `MIRO_ACCESS_TOKEN_2`) | The guard removes it: check `[supervise]` lines for the guard; a `.env` without a valid `MIRO_ACCESS_TOKEN_2` stops it |
| `state/game.json` from an older version | Ignored automatically: `reset` starts a fresh game |
