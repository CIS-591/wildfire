# Color Wars: what happened in the 2026-11-10 class, and what to change

Four games on one shared Miro board (results, logs and final-board pictures in `results/`):

| Game | Players | Winner | How | Length |
| --- | --- | --- | --- | --- |
| TA test | 2 | Blue 46–3 | stopped by hand | 14 min |
| Class 1 | 10 | Red 127–0 | wipeout | 7 min |
| Class 2 | 12 | Blue 154–0 | wipeout | 6 min |
| Class 3 | 26 | Red 174–0 | wipeout | 8 min |

The game itself worked: students joined with one prompt, agents fought live, bombs and cut-offs fired,
name tags and the leaderboard moved. Everything that went wrong falls into five groups.

## 1. Vandalism (the big one)

**What happened.** Every student was a Miro *editor*, because their agent has to paint squares. An
editor can do anything on the board, so people and agents deleted squares (whole rows and both
bases in game 3), moved squares out of their frames, dropped images and notes, typed over the row
labels, moved panels, and locked items (which then blocked the referee). One agent alone caused 152
refusals in game 2. The referee repaired most of it, but the repairs were themselves the source of
the crashes in group 2, and a deleted base square can decide a game.

**Why patching can't make it 100%.** Any fix that keeps students as editors is a race: the
vandal acts first and the referee repairs after, seconds later, and deletes can't even be
attributed. Locking items in Miro doesn't help either: any editor can unlock them.

**The 100% fix: students never write to the board.** Make the referee the only writer.

- Students get **view-only** access to the board (or watch it on the projector). Nobody but the
  instructor's token can change anything, so vandalism becomes impossible, not just repaired.
- Agents play through a small **Color Wars MCP server** we host (a few tools: `join`, `look`
  around a square, `paint`, `status`). The server checks the rules and writes the move to Miro
  itself, instantly, with the instructor's token.
- Each student signs in to the game server, not to Miro, so attribution is exact and the
  Miro team/plan/daily-call problems for students disappear.

This one change also fixes most of groups 2–4: no polling (moves arrive as calls), no diffing, no
shadow copy, no tamper logic, far fewer Miro API calls, sub-second feedback.

## 2. Referee crashes and stalls (all fixed during class, but the design invited them)

| Symptom | Cause | Fix now in the code |
| --- | --- | --- |
| Rejoined players got no team | A restart marked everything already on the board as seen | Unjoined players' inbox cards stay "new" at startup |
| Fake penalties every poll | Miro returns `&#39;` and emoji as entities; text compare failed | `stripHtml` decodes entities; the fake board encodes like Miro |
| Referee stuck for minutes (twice) | One refused write (square moved out of its frame; a locked item) failed the whole poll | Every write is caught and logged; moved squares are replaced, not moved |
| Referee crashed on every poll; 57 squares lost | A deleted square was referenced after its record was gone | Lost squares are skipped; missing squares are rebuilt at every start |
| Reset failed | A locked leaderboard box refused writes | Reset and fixture writes never abort |
| Network timeout killed the referee | No retry | Retries with backoff, 20 s timeout |
| Paints after a win stayed on the board | `run` exited at game over | The referee keeps guarding after a win |

Lesson: a live referee must treat every single board operation as fallible. With the MCP-server
design most of this code goes away.

## 3. Speed and Miro's rate limit

- Reading 1,224 squares takes 2–4 s even in 9 parallel frames; everything else needs a full
  listing (~18 s, 26 pages, one at a time). Feedback lagged 5–10 s.
- Game 3 hit Miro's **100,000 credits/minute** limit: two referees (the lobby didn't close in time
  and a second one started), the watcher and the auto-restore all read the full board at once, with
  26 players. Everything stalled for a minute.
- Prevention without the redesign: one process only (lobby and run in the same process, and a
  lock file so a second copy refuses to start), a credit budget counter, and the watcher and
  restore folded into the referee instead of running beside it.
- With the MCP server: no polling at all; Miro calls drop to the writes themselves.

## 4. Game balance

- Every game ended in **6–8 minutes by a base rush**: one thin line straight across the middle to
  the enemy base, then four quick captures. That's too fast and too one-note.
- Ideas, in order of effort: bases in **diagonal corners** (twice the distance); bases need
  **2 neighbours** to capture (attacks elsewhere stay at 1); a **base shield** for the first
  5 minutes; more bombs near the middle; a capture-the-flag variant where the base must be held for
  30 s. Re-run `npm run sim` with 30 players for each idea; aim for 20–30 minutes.
- The 1-per-second limit barely matters: agents take ~15 s per move anyway.

## 5. Setup and running the class

- Students needed `/reload-plugins` and the `/mcp` sign-in (Claude can't do either itself). With
  the MCP server, setup becomes one prompt plus one sign-in to our server.
- Teams: preset teams worked; removing a player needed hand-editing the saved game (add a
  `kick` command).
- Board-edit watching and auto-restore were improvised scripts (now in `tools/`); make them part
  of the referee or, better, unnecessary.
- Before class: a 10-bot rehearsal at full class size against the real board (the one-bot
  rehearsal never showed the rate-limit or vandalism problems).

## Next steps, in order

1. Build the Color Wars MCP server (join / look / paint / status), students view-only. Removes
   vandalism, polling, tamper logic and the student Miro setup.
2. Rebalance: diagonal bases + 2-neighbour base capture; tune with the simulator to 20–30 min.
3. Single-process referee with a lock file and a credit budget; `kick` command.
4. Full-size rehearsal with 20–30 bots before the next class.
