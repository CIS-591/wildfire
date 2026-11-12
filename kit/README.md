# 🔥 Wildfire

A forest on a shared Miro board is on fire. Up to four teams each protect one corner, and every
player's Claude paints water to save it (or, with a human YES, sets fire to a neighbour's corner).

## What you need

- **Claude Code** installed (`claude` in your terminal).
- **Edit access to the Miro board**: your instructor invites you. Accept the invite in your email,
  then open the board (link in `board.json` → `boardUrl`). You must be able to **edit**.
- **Miro connected to Claude**, either way works:
  - the **Miro connector**: claude.ai → Settings → Connectors → Miro → Connect (it then shows up in
    Claude Code too), or
  - the **Miro plugin**: in Claude Code type `/plugin install miro@claude-plugins-official`, then
    `/reload-plugins`, then `/mcp` → **miro** → **Authenticate**.
  Pick the **CIS 591** team when asked. When Claude asks to use a Miro tool, choose "Yes, and don't ask again".

## Play in 3 steps

1. Clone this repo: `git clone https://github.com/vaibav03/wildfire-kit.git && cd wildfire-kit`
2. Open Claude Code inside it: `claude` (the `/join` and `/play` commands only work when Claude Code
   is started inside this folder).
3. Type `/join Your Name` (first name + last initial, e.g. `/join Ana K`). Within a minute your card
   on the board says "you're in!". Then type `/play` when the instructor says go.

## The game

- 🟩 **green** = tree, protect these
- 🟧 **orange** = fire, spreads by itself
- 🟦 **blue** = water, you paint it in your team's area, fire can't cross it. Each team has its own
  bucket of water
- ⬛ **black** = burnt, gone

Teams (Team 1 to Team 4) are given at random the moment you /join; your card shows your team
and role. Your Claude may ask you one YES/NO question: answer it. Most green left in your team's
area after 10 minutes wins. Watch the board, not the terminal.

## What happens during the game

- One player per team is the **boss**: their Claude finds the fire and writes notes like
  `Ana: paint N9 N10 N11` for the others. Everyone's Claude paints blue.
- The YES/NO question is like: "Start a fire in Team 2's area?" (always a neighbour: Team 1 borders
  Teams 2 and 3, Team 4 borders Teams 2 and 3). YES lets your team set ONE square there on fire
  (within 2 minutes; 5 attacks per game, each needs its own YES). Careful: the fire can spread back to you.
- Every square has a border in its team's color, so you can see where each area is. A thicker
  team-colored border on a fire or burnt square shows which team lit that fire.
- The leaderboard next to the board ranks the teams, first place on top: each row shows its % saved,
  boss, crew, water left, fires set, trees burned and its MVP. Rows swap places as teams overtake.

## 1 vs 1 (2 players)

The instructor can run a game with two players, one per team. Then you are the boss: your Claude
finds the fire and paints (no orders to write). When your Claude asks "Start a fire in Team N's
area?", it asks you, and your YES or NO is the answer (in bigger teams a teammate answers).

## What you will learn

1. One agent plans, the others do the work.
2. Agents never talk directly: they only read and write the board.
3. Agents do the fast work; the risky move waits for a human YES, and waiting costs time.
4. Each team has its own bucket of water: spend it wisely.
5. Attacking a neighbour can backfire: when to defend and when to attack.
6. Agents make mistakes; a referee catches them.

## If something goes wrong

| You see | Do this |
|---|---|
| "not authorized" / board not found | `/mcp` → miro → clear authentication, sign in again, pick **CIS 591** |
| "rate limit" or "daily limit" from Miro | Tell your instructor |
| Your Claude stopped | Type `/play` again |
| Nothing on your card after a minute | Tell your instructor, then `/join` again |
| No team on your card | Wait a few seconds after /join: the referee writes it on your card |
| Your Claude wants to move or delete something | Say no |

Fair play: let your Claude paint, don't edit squares by hand. The rules your Claude follows (and the
referee enforces) are in `AGENTS.md`.
