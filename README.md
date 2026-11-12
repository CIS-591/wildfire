# Wildfire

A class game for CIS 591 (Module 4) played on one Miro board. Four teams of students run Claude Code agents
through Miro's MCP server to hold a forest fire back: a boss agent plans, worker agents paint water, firebreaks
and backburns, and humans approve the risky moves with a YES. A referee script on the instructor's laptop
spreads the fire, checks every paint and keeps the score.

Board: https://miro.com/app/board/uXjVEOlHHxs=/

## Folders

| Folder | What |
|---|---|
| [`SPEC.md`](SPEC.md) | The contract: geometry, colors, sticky formats, rules. Every part follows it. |
| [`board/`](board/README.md) | The Miro board, built through the Miro MCP. `board/board.json` holds its URL and every item id. `board/build/sync_ids.py` copies those ids into the kit and the referee. |
| [`kit/`](kit/README.md) | Student kit: a Claude Code project with `/join`, `/play`, `/approve`. |
| [`referee/`](referee/RUNBOOK.md) | Game engine (TypeScript, Miro REST). Adapted from the Color Wars referee. |
| `prototype.html` | Early browser prototype, for reference only. |

## Class day

```
 INSTRUCTOR (referee/)                       STUDENTS (kit/, one Claude Code each)
 ---------------------                       -------------------------------------
 npm run referee verify   (once, token)
          |
 npm run referee reset    (fresh forest)
          |
 npm run referee lobby  ---------------->   /join Your Name   -> inbox card: team + BOSS/WORKER
          |                                        |
          |                                 boss posts PLAN  -> a teammate: /approve -> YES
          |                                        |
 npm run referee run    ---------------->   /play  (loops until the banner says GAME OVER)
   fire spreads every 20 s                    boss:    ORDER stickies, BACKBURN, HELP
   checks every paint                         workers: one paint every ~15 s
   writes banner, scores, inbox cards         humans:  /approve  (YES / NO in the terminal)
          |                                        |
 npm run referee stop   ---------------->   banner shows GAME OVER -> agents report the score
```

## Links

- Student setup and commands: [kit/README.md](kit/README.md)
- Instructor runbook (commands, problems, fixes): [referee/RUNBOOK.md](referee/RUNBOOK.md)
- Board layout and ids: [board/README.md](board/README.md)
- Live board: https://miro.com/app/board/uXjVEOlHHxs=/

After rebuilding the board, run `python3 board/build/sync_ids.py` so the kit (`kit/board.json`) and the
referee (`referee/config/layout.json`) get the new ids.
