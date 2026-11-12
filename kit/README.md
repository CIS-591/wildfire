# 🔥 Wildfire (CIS 591, Module 4)

Save your forest from the fire, or set fire to your neighbour's — and a human decides when to attack.

A forest is on fire. There are four teams, Team 1 to Team 4. Your team protects one corner of
it: your team's area. Your Claude paints water.

- 🟩 **green** = tree, protect these
- 🟧 **orange** = fire, spreads by itself
- 🟦 **blue** = water, you paint it in your team's area, fire can't cross it. Each team has its own
  bucket of water
- ⬛ **black** = burnt, gone

1. Type `/join Your Name`, then `/play`.
2. Your Claude may ask you one YES/NO question. Answer it.
3. Most green left in your team's area after 10 minutes wins.

That's it. Watch the board, not the terminal.

---

## Setup (once, about 5 minutes)

1. **Get the kit**: `git clone --branch module-4 https://github.com/CIS-591/class-examples.git wildfire`,
   then `cd wildfire`.
2. **Join the Miro team**: accept the invite in your ASU email, then open the board (link in
   `board.json` → `boardUrl`). You must be able to **edit**.
3. **Connect Miro**: start `claude` in the `wildfire` folder and type
   `/plugin install miro@claude-plugins-official`, then `/reload-plugins`, then `/mcp` → **miro** →
   **Authenticate** → pick the **CIS 591** team. When Claude asks to use a Miro tool, choose
   "Yes, and don't ask again".
4. `/join Ana K` (first name + last initial). Within a minute your card on the board shows your
   team ("Team 1".."Team 4") and role.
5. `/play` when your instructor says go.

## What happens during the game

- One player per team is the **boss**: their Claude finds the fire and writes notes like
  `Ana: paint N9 N10 N11` for the others. Everyone's Claude paints blue.
- The YES/NO question is like: "Start a fire in Team 2's area?" (always a neighbour: Team 1 borders
  Teams 2 and 3, Team 4 borders Teams 2 and 3). YES lets your team light up to 3 squares there
  within 2 minutes (2 attacks per game). Careful: the fire can spread back to you.
- A thick team-colored border on a fire or burnt square shows which team lit that fire.

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
| No team on your card after a minute | Tell your instructor, then `/join` again |
| Your Claude wants to move or delete something | Say no |

Fair play: let your Claude paint, don't edit squares by hand.

(Instructor check: `node scripts/check-board.mjs` verifies `board.json` offline.)
