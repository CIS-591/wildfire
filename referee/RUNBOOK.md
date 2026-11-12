# Wildfire run-day runbook (instructor only)

Two terminals in this folder: **A** runs the referee, **B** is for one-off commands. Board on the projector.
The game itself lasts **10 minutes**.

## The day before

- [ ] `.env` set (README), `npm run referee verify`: 1224/1224 squares, 3 fixtures, 4 colors OK.
- [ ] Board ids: `config/layout.json` is copied from `../board/board.json` by `python3 ../board/build/sync_ids.py`.
- [ ] Board shared with the class team (students must be editors).
- [ ] Lock the static items in the Miro UI (backdrop, title, rules panel, compass, Orders header bars,
      Inbox panel). Do **not** lock squares, banner, scoreboard, leaderboard or the Orders frames.
- [ ] Optional preset teams: copy `config/teams.example.json` to `config/teams.json`.
- [ ] Rehearsal with ONE Miro account and several Claude sessions: `npm run referee reset`, then
      `npm run referee lobby -- --rehearsal`, everyone `/join`, Ctrl-C, `npm run referee run -- --rehearsal`
      (add `--minutes 5` for a short one), try one "Start a fire in …'s area?" + YES, `stop`, `reset`.

## Run day (about 40 minutes)

| Time | Instructor | Students |
| --- | --- | --- |
| −15 | B: `npm run referee verify`, then `npm run referee reset` | |
| 0:00 | Slides: the forest, the 4 areas, boss/worker, blue in your area, the one human question (attack a neighbour), one water bucket per team | |
| 0:08 | A: `npm run referee lobby` | `/join Your Name`, then `/play` |
| 0:12 | Everyone has a card: Ctrl-C A, then A: `npm run referee run` | Agents paint; humans answer the attack question when their Claude asks |
| 0:22 | The game ends by itself (10 min, or the fire is out after the lightning) | |
| 0:24 | B: `npm run referee results`; debrief (SPEC.md section 4) | |

## If something goes wrong

| Problem | Fix |
| --- | --- |
| A team's paints outside its area are undone | Blue only counts in your own area; orange in a neighbour's area needs a YES on "Start a fire in …'s area?" from a teammate who didn't post it (3 squares, 2 min, 2 attacks per game) |
| Need a break / referee crashed | Ctrl-C pauses (banner says PAUSED, the fire freezes); `npm run referee run` resumes |
| Out of time | B: `npm run referee stop` (highest % wins): the referee in A ends the game on its next poll |
| Someone moved or deleted a square / the banner | Put back within one poll; the player is frozen 5 s |
| 429 rate limits | Only one referee runs (`state/referee.lock`). Add `--poll 5` |
| `state/game.json` from an older version | Ignored automatically: `reset` starts a fresh game |
