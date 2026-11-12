# 🔥 Wildfire (CIS 591, Module 4)

One class, one Miro board, one forest fire. Four teams each protect a corner of the forest. Your
Claude agent does the fast work: it reads the board, posts orders and paints squares. **You** make the
big calls. A referee program spreads the fire every 20 s, checks every paint and keeps the score.

```
          A ............ R | S ............ AJ
       1 +-----------------+-----------------+
         | RIDGE           | PINE VALLEY     |
         | cabins E5  M13  | cabins X13 AF5  |
         | river  J4-J12   | river AA4-AA12  |
      17 |             R17 * S17             |
         +---------------- * ----------------+   * = first fire
      18 |             R18 * S18             |
         | CEDAR CREEK     | BIRCH HOLLOW    |
         | cabins E30 M22  | cabins X22 AF30 |
         | river  J23-J31  | river AA23-AA31 |
      34 +-----------------+-----------------+
```

The fire starts in the middle, touching all four sectors. Wind pushes it; it turns every 5 minutes;
lightning strikes four times (minutes 5, 10, 15, 20). Highest % of forest (and cabins) left after 30 minutes wins.

| Square | Color | |
|---|---|---|
| 🌲 Forest | green `#93d275` | what you protect |
| 🏠 Cabin | yellow `#f5d128` | worth 10 squares |
| 🌊 River | dark blue `#414bb2` | never burns |
| 🔥 Fire | orange `#ff9d48` | the referee paints it |
| 💧 Water | cyan `#23bfe7` | you: stops a square for 90 s, uses the class's shared pool |
| 🪓 Firebreak | brown `#8b5a2b` | you: permanent, fire can't cross (embers can jump one) |
| ⬛ Burnt | black `#1a1a1a` | gone; you may burn only an approved BACKBURN |

## Setup (5 steps, about 5 minutes)

```
 clone kit ──▶ join Miro team ──▶ connect Miro MCP ──▶ /join Your Name ──▶ /play
                                                                 │
                                   second terminal: /approve ◀───┘  (when your boss asks)
```

1. **Get the kit**

   ```bash
   git clone --branch module-4 https://github.com/CIS-591/class-examples.git wildfire
   cd wildfire
   ```

2. **Join the Miro team.** Accept the invite from your instructor (check your ASU email), then open
   the board (link in `board.json` → `boardUrl`, also on the class page). You must be able to **edit**.
3. **Connect the Miro MCP in Claude Code.** Start `claude` in the `wildfire` folder and type:

   ```text
   /plugin install miro@claude-plugins-official
   /reload-plugins
   /mcp
   ```

   In `/mcp` pick **miro** → **Authenticate**, log in, and choose the **CIS 591** team. (If the
   install fails: `/plugin marketplace add miroapp/miro-ai`, then `/plugin install miro@miro-ai`.)
   When Claude asks to use a Miro tool, choose "Yes, and don't ask again".
4. **Join**: `/join Ana K` (first name + last initial). Your inbox card appears in the Inbox area; within
   a minute the referee writes your **team** and your **role** on it.
5. **Play** when your instructor says go: `/play`. Watch the board, not the terminal.

## Roles

- **Boss** (first player on each team): the orchestrator. Posts the team PLAN, gives each worker one
  ORDER sticky ("FIREBREAK N9 N10 N11"), asks for BACKBURNs and HELP.
- **Workers** (everyone else): read their own ORDER, paint one square about every 15 s, post a STATUS.

Everything goes through the **Orders frame** of your team on the board. Agents never talk directly.

## The three human decisions

Your agent never says YES for you. In a second terminal run `/approve` (or type `YES` / `NO` as a new
line on the sticky in Miro). You can't approve a sticky you posted yourself.

1. **PLAN**: until a teammate approves the boss's plan, **no paint from your team counts**. Be quick.
2. **BACKBURN**: burn a strip of your own forest on purpose so the fire has nothing to eat. You lose
   those trees for sure; you may save many more.
3. **HELP**: another team is losing and asks your team for 2 painters for 3 minutes. Your sector gets
   less attention; theirs may survive. Water is one pool for the whole class, so helping is real.

## What you will learn

1. **Orchestrator and workers**: one agent plans, the others execute.
2. **Coordination through shared state**: agents never talk directly; everything goes through the board.
3. **Human-in-the-loop**: agents do the fast, small work; risky moves wait for a human YES, and waiting
   costs time.
4. **Shared resources**: one water pool for everyone.
5. **Cooperation and trust between teams.**
6. **Agents make mistakes**; rules and a referee catch them.

## If something goes wrong

| You see | Do this |
|---|---|
| "not authorized" / board not found | `/mcp` → miro → clear authentication, sign in again, pick **CIS 591** |
| "rate limit" or "daily limit" from Miro | Tell your instructor; pair up with a teammate |
| Your agent stopped | Type `/play` again; it picks up where it left off |
| No team on your card after a minute | Tell your instructor, then `/join` again (it won't make a second card) |
| Paints keep getting reverted | Read your inbox card; usually the PLAN isn't approved yet: run `/approve` |
| Your agent wants to move or delete something | Say no. Only square colors and your team's stickies may change |

Fair play: let your agent paint, don't edit squares by hand, don't read other players' inbox cards.

(Instructor check: `node scripts/check-board.mjs` verifies `board.json` geometry offline.)
