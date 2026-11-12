# Wildfire run-day runbook (instructor only)

Two terminals in this folder: **A** runs the referee, **B** is for one-off commands. Board on the projector.

## The day before

- [ ] `.env` set (README), `npm run referee verify`: 1224/1224 squares, 3 fixtures, every color OK.
- [ ] Board ids: `config/layout.json` is copied from `../board/board.json` by `python3 ../board/build/sync_ids.py`
      (rerun it after any board rebuild; without layout.json the referee reads `../board/board.json` directly).
- [ ] Board shared with the class team (students must be editors: agents paint squares and post stickies).
- [ ] Lock the static items in the Miro UI: backdrop, title, rules panel, compass, Orders frames' header
      bars, Inbox panel. Do **not** lock squares, banner, scoreboard, leaderboard or the Orders frames.
- [ ] Optional preset teams: copy `config/teams.example.json` to `config/teams.json`.
- [ ] Rehearsal with 2–3 real Claude sessions: `reset`, `lobby`, everyone `/join`, one boss posts PLAN,
      a teammate `/approve`s it, Ctrl-C, `run` for 3 minutes, `stop`, `reset`.

## Run day (about 60 minutes)

| Time | Instructor | Students |
| --- | --- | --- |
| −15 | B: `npm run referee verify`, then `npm run referee reset` | |
| 0:00 | Slides: the forest, the four sectors, boss/worker, approvals, shared water | |
| 0:08 | A: `npm run referee lobby` | `/join Your Name`; bosses run `/play` and post PLAN; teammates `/approve` |
| 0:15 | All teams show "plan ✅" on the leaderboard: Ctrl-C A, then A: `npm run referee run` | Workers `/play`; humans watch for BACKBURN and HELP |
| 0:45 | The game ends by itself (30 min, or the fire is out after the last lightning) | |
| 0:47 | B: `npm run referee results`; debrief (SPEC.md section 4) | |

## If something goes wrong

| Problem | Fix |
| --- | --- |
| A team can't paint | Leaderboard shows "plan ⏳": a teammate who didn't post the PLAN adds a `YES` line |
| Need a break / referee crashed | Ctrl-C pauses (banner says PAUSED, the fire freezes); `npm run referee run` resumes |
| Out of time | B: `npm run referee stop` (highest % wins): the referee in A ends the game on its next poll |
| Someone moved or deleted a square / the banner | Restored within one poll; the player is frozen 5 s. Nothing to do |
| 429 rate limits | Only one referee runs (`state/referee.lock` refuses a second one). Add `--poll 5` |
| Brown firebreak refused by Miro | `verify` says so: set `firebreak` to `#808080` in `config/colors.json` and `kit/board.json` |
