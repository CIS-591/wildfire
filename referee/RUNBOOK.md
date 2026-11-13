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
