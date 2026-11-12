# Wildfire · the spec every part follows

> **Save your forest from the fire, or set fire to your neighbour's, and a human decides when to attack.**

CIS 591, Module 4. One class, one Miro board, one forest fire. Each student's Claude Code agent plays
through Miro's MCP server. Claude agents do the fast work (reading the board, posting orders, painting
squares). Humans make the one big call: whether to spray water outside their own area. A referee script on
the instructor's laptop is the game engine: it spreads the fire on a timer, checks every paint, keeps
the score. **The referee never plays**: it never paints water for anyone.

Parts (all in `~/dev/wildfire`):

| Folder | What | Who uses it |
|---|---|---|
| `board/` | The Miro board: built through the Miro MCP; `board/board.json` records its URL and item ids | Everyone (projector + agents) |
| `kit/` | Student kit: a Claude Code project with `/join` and `/play` | Students |
| `referee/` | Game engine, adapted from the Color Wars referee (`referee/REFLECTION.md` has last class's lessons) | Instructor |
| `prototype.html` | Earlier browser prototype, reference only | — |

## 1. The board (geometry is shared by board, referee and kit: do not change it)

All coordinates are Miro canvas units, TOP-LEFT of each box (the MCP SVG convention). REST uses centers.

- **Grid**: 36 columns × 34 rows, labels `A1`–`AJ34` (spreadsheet columns A..Z, AA..AJ; rows 1..34).
  Square 60, pitch 64, origin (0,0): square `col,row` (0-based) is at x = col·64, y = row·64, 60×60.
  Each square is a rectangle shape whose text is its label (font 20, bold not required).
  Squares live in 9 frames, one per band of 4 rows (rows 1–4, 5–8, …, 33–34), exactly like Color Wars,
  frame box x = −2, y = r0·64 − 2, w = 36·64, h = rows·64. Frame fill dark `#3d4250`, no title.
- **Teams** (each protects one quarter, its "area"; students only ever see "Team 1".."Team 4"):

  | Team | Id (internal) | Columns | Rows | Team color |
  |---|---|---|---|---|
  | Team 1 | `ridge` | A–R | 1–17 | violet `#7c3aed` |
  | Team 2 | `pine` | S–AJ | 1–17 | pink `#db2777` |
  | Team 3 | `cedar` | A–R | 18–34 | indigo `#4338ca` |
  | Team 4 | `birch` | S–AJ | 18–34 | slate `#334155` |

  The internal ids stay (state files, code); every student-facing text says "Team N". The question
  sticky parser accepts "Team 2", "team2", "T2" and the old names. Team colors appear only on each
  area's thick edge, its "TEAM N'S AREA" label and its Orders header, never on square fills.
- **Palette** (light theme: white board, the game colors pop):

  | Role | Hex |
  |---|---|
  | background / backdrop | `#f5f6f8` |
  | band frames (gaps between squares) and square borders | `#ffffff` (border width 2) |
  | panels / panel border | `#ffffff` / `#e2e5ea` |
  | titles, headings | ember `#e8590c` |
  | text / muted text | `#1f2328` / `#6b7280` |
  | label on tree, fire, water / label on burnt | `#0b1a10` / `#c9c2bb` |

- **Square colors** (fills; lowercase hex everywhere). **Only four. That is the whole game.**

  | Color | Means | Fill | Who makes it |
  |---|---|---|---|
  | 🟩 green | tree (protect these) | `#3fa66b` | start |
  | 🟧 orange | fire (spreads by itself) | `#ff5a1f` | referee only |
  | 🟦 blue | water (players paint it; fire can't cross it; it stays) | `#3aa7ff` | players |
  | ⬛ black | burnt (gone) | `#2a2420` | referee (fire burns out) |

  These live in `referee/config/colors.json`. No rivers, no cabins, no firebreaks, no backburns.
- **Map**: all squares start green except the first fire, the four centre squares `R17`, `S17`, `R18`,
  `S18` (one in each sector: fair).
- **Panels** (top-left x, y, w, h):

  | Item | Box | Notes |
  |---|---|---|
  | Title text "WILDFIRE" | (0, −330, 1400, 90) | static |
  | Banner (fixture) | (0, −220, 1100, 110) | referee writes: phase, time left, next spread, water |
  | Scoreboard (fixture) | (1160, −220, 1140, 110) | referee writes: 4 teams' % forest left |
  | Rules panel | (2440, −330, 760, 610) | static: the rules + color legend |
  | Leaderboard panel (fixture inside) | (3240, −330, 760, 610) | referee writes |
  | Orders · Team 1 | (2440, 340, 760, 900) | header "ORDERS · TEAM 1", team color accent |
  | Orders · Team 2 | (3240, 340, 760, 900) | same, laid out 2×2 like the areas |
  | Orders · Team 3 | (2440, 1300, 760, 900) | |
  | Orders · Team 4 | (3240, 1300, 760, 900) | |
  | Inbox panel | (0, 2300, 4000, 1500) | one card per player, 5+ columns |

  The board should look like a game, not a spreadsheet: a dark backdrop behind the grid with row/column
  headers, a bold title, team-colored headers, a clear color legend. No wind rose (there is no wind).

## 2. How students play (10-minute game)

1. **Join.** `/join Your Name` → the agent creates an inbox card "Inbox · Your Name" inside the Inbox panel.
   The referee assigns a team (4 balanced teams, or presets in `referee/config/teams.json`) and a role:
   the first player assigned to a team is its **boss**, the rest are **workers**. The referee writes
   team + role + a welcome on the card.
2. **Play.** `/play` → the agent reads its inbox card for team and role, then loops until the banner says
   the game is over.
   - **Boss**: watches the fire near its sector and keeps one `ORDER` sticky per worker saying which
     squares to paint blue ("ORDER · Ana / WATER N9 N10 N11"). Paints too whenever a worker is idle or slow.
     When a neighbour's fire is about to cross into its sector, asks its humans for the one big decision.
   - **Worker**: reads its ORDER, re-checks the exact square, paints it blue, repeats. No order: paint
     blue on the green square nearest the fire inside its sector.
3. **The one human decision: "Start a fire in <neighbour>'s area?"** (rules in 2b). The boss posts it in its
   own team's Orders frame; a worker's `/play` sees it, **stops and asks its student** (YES / NO), then
   writes `YES` or `NO` on the sticky. Only a teammate who did not post it counts.

   Stickies are plain sentences, no keywords:

   | Sticky | Who posts | Text |
   |---|---|---|
   | Order | boss | `Ana: paint N9 N10 N11` (worker name, colon, `paint`, labels) |
   | Question | boss | `Start a fire in Team 2's area?` / optional reason line |
   | Answer | a teammate (asked by their Claude) | a new line `YES` or `NO` on the question sticky |

   Students only ever type `/join Your Name` and `/play`. There is no `/approve` command.
   In everything students read, say "your team's area", never "sector".


## 2b. Attack: set fire to a neighbour's area (replaces "stealing")

- **The question** a boss posts in its own Orders frame: `Start a fire in Team 2's area?` (neighbours
  only; same approval rule: a YES line by a teammate who did not post it). Old "Grab squares …" /
  "Spray water in …" forms are no longer valid questions.
- **On YES** the team may, within `attackMinutes` (2), paint **orange** `#ff5a1f` on up to
  `attackSquares` (3) **green** squares in that neighbour's area. Max `attacksPerTeam` (2) approved
  attacks per team per game. Painting blue in a neighbour's area is no longer allowed at all.
- **Who lit it is always visible**: every fire square remembers its origin (`wild` for the centre fire
  and lightning, or the attacking team). When fire spreads, the new square inherits the origin of the
  square that lit it. Squares burning from a team's fire get a thick border (width 6) in that team's
  color; wild fire has the normal border. Burnt squares keep the color of the fire that burned them as
  a thinner border (width 3), so the damage stays readable. Banner announces "🔥 Team 1 set fire to Team
  2's area!"; leaderboard shows per team "🔥 lit 3 · burned 23 trees of others".
- **Blowback**: a team's fire spreads into anyone's area, including its own. That's the risk the human
  weighs: fire spreads every way, including back toward the attacker.
- **Score** = green squares left in your own area, as % of 306. Highest wins. (No ownership of blue.)
- Rehearsal (one shared account): attribution of who painted orange uses the stand-in rule.

## 3. Rules the referee enforces (numbers in `referee/config/rules.json`, tuned with `npm run sim`)

- **Fire moves as a front. No wind.** Every `spreadSeconds` (20) each burning square may ignite each
  green neighbour up/down/left/right with `pSide`, and diagonally with `pDiag` (small), the same in every
  direction. A square burns `burnTicks` (3 spreads ≈ 1 min) then turns black, so the fire is a moving
  ring with black behind it. Blue and black never burn. Target: unchecked, a front crosses an area
  (~17 squares) in ~8 min.
- **Start**: the centre fire (R17 S17 R18 S18) plus one 2-square fire inside each team's area, mirrored
  (`startFires`), lit at minute `startFiresAt` (1) so agents have read the board first; every team is busy from minute 1.
- **Lightning** at minutes `lightningAt` ([2, 4, 6, 8]): each strike hits a different team's area (each
  team once, shuffled order), on a green square at least `lightningMinDistance` (6) from any fire.
- **Water: one bucket per team.** Each team has its own `waterPerTeam` on the banner (e.g.
  "💧 T1 62 · T2 40 · T3 71 · T4 55"); each accepted blue square uses 1 from the painter's team bucket;
  at 0 that team's blue paints are refused. No sharing between teams.
- **Wind is switched OFF, not deleted** (`rules.json` `wind.enabled: false`). The wind code stays in the
  engine behind that flag so it can be turned back on later; with it off, fire spreads evenly.
- **Batches**: one paint = up to `paintBatch` (5) squares changed by the same player within the same
  poll; then `cooldownSeconds` (5). Squares beyond 5 in one batch are reverted.
- **A paint is accepted only if**: the game is live; the painter joined; ≥ `cooldownSeconds` (5) since their
  last accepted batch; and it is either **blue** on a green or orange square in their own area, or
  **orange** on a green square in a neighbour's area during their team's approved attack (max 3 per
  attack). Anything else is reverted, with
  the reason on the painter's inbox card. Moving/editing/deleting squares or fixtures is reverted
  (Color Wars tamper logic) and freezes the player for 5 s.
- **Score**: green squares left in your own area, as % of 306. The game ends at
  `gameMinutes` (10) or when no fire is left. Highest % wins.
- **Tuning target**: 28 players at the pace measured in the first live rehearsal (an agent manages about
  one paint per 45–60 s; bosses paint at half that rate). The fire should still be burning at minute 8,
  team scores should end spread out (roughly 30–90%), and the water should be at least half used.

## 4. What students learn (for slides and the kit README)

1. Orchestrator and workers: one agent plans, the others execute.
2. Coordination through shared state: agents never talk directly; everything goes through the board.
3. Human-in-the-loop: agents do the fast, small work; the risky move (spending shared water outside your area) waits for a human YES, and waiting costs time.
4. Shared resources: one water pool for everyone.
5. Cooperation between teams: spraying outside your area helps a neighbour and you, but spends everyone's water.
6. Agents make mistakes; rules and a referee catch them.
