# Wildfire · the spec every part follows

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
  | Team 1 | `ridge` | A–R | 1–17 | violet `#a78bfa` |
  | Team 2 | `pine` | S–AJ | 1–17 | rose `#f472b6` |
  | Team 3 | `cedar` | A–R | 18–34 | lemon `#fde047` |
  | Team 4 | `birch` | S–AJ | 18–34 | frost `#e2e8f0` |

  The internal ids stay (state files, code); every student-facing text says "Team N". The question
  sticky parser accepts "Team 2", "team2", "T2" and the old names. Team colors appear only on each
  area's thick edge, its "TEAM N'S AREA" label and its Orders header, never on square fills.
- **Palette** ("night map": dark surround, only the game colors glow):

  | Role | Hex |
  |---|---|
  | background, band frames (gaps between squares), square borders | `#0e1311` |
  | panels / panel border | `#161d19` / `#25302a` |
  | titles, headings | ember `#ff7a3d` |
  | text / muted text | `#f1efe9` / `#9aa39c` |
  | label on tree, fire, water / label on burnt | `#0b1a10` / `#7d736a` |

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
  | Banner (fixture) | (0, −220, 1100, 110) | referee writes: phase, wind, next spread, water |
  | Scoreboard (fixture) | (1160, −220, 1140, 110) | referee writes: 4 teams' % forest left |
  | Rules panel | (2440, −330, 760, 610) | static: the rules + color legend |
  | Leaderboard panel (fixture inside) | (3240, −330, 760, 610) | referee writes |
  | Orders · Team 1 | (2440, 340, 760, 900) | header "ORDERS · TEAM 1", team color accent |
  | Orders · Team 2 | (3240, 340, 760, 900) | same, laid out 2×2 like the areas |
  | Orders · Team 3 | (2440, 1300, 760, 900) | |
  | Orders · Team 4 | (3240, 1300, 760, 900) | |
  | Inbox panel | (0, 2300, 4000, 1500) | one card per player, 5+ columns |

  The board should look like a game, not a spreadsheet: a dark backdrop behind the grid with row/column
  headers, a bold title, team-colored headers, a clear color legend, compass/wind rose next to the banner.

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
3. **The one human decision: "Spray water in <neighbour>'s area?"** The boss posts, in its own team's
   Orders frame, a sticky whose first line is `Spray water in Team 2's area?` (any neighbour team
   name; a second line may say why). A worker's `/play` sees it, **stops and asks its student** in the
   terminal (AskUserQuestion: YES / NO), then writes a line `YES` or `NO` on the sticky. Only a teammate
   who did not post it counts. On YES the team may paint blue in that neighbour's area for
   `outsideMinutes` (2). It helps both teams but spends the shared water. Remembered once seen.

   Stickies are plain sentences, no keywords:

   | Sticky | Who posts | Text |
   |---|---|---|
   | Order | boss | `Ana: paint N9 N10 N11` (worker name, colon, `paint`, labels) |
   | Question | boss | `Spray water in Team 2's area?` / optional reason line |
   | Answer | a teammate (asked by their Claude) | a new line `YES` or `NO` on the question sticky |

   Students only ever type `/join Your Name` and `/play`. There is no `/approve` command.
   In everything students read, say "your team's area", never "sector".

## 3. Rules the referee enforces (numbers in `referee/config/rules.json`, tuned with `npm run sim`)

- **Fire** spreads every `spreadSeconds` to up/down/left/right green neighbours (`pSide`) and diagonals
  (`pDiag`), faster downwind (`downwindMult`), slower upwind (`upwindMult`). A square burns for
  `burnTicks` spreads, then turns black. Blue and black never burn.
- **Wind**: shown on the banner with an arrow; turns 45° once, at minute 5.
- **Lightning**: once, at minute `lightningAt` (5): a new fire far from the old one, announced on the banner.
- **Shared water**: one pool of `waterTotal` for the whole class, shown on the banner; each accepted blue
  paint uses 1; at 0, blue paints are refused.
- **A blue paint is accepted only if**: the game is live; the painter joined; ≥ `cooldownSeconds` (5)
  since their last accepted paint; the square was green or orange; it is in their sector, or in a
  neighbour's area their team has an approved "Spray water" question for right now. Anything else is reverted, with
  the reason on the painter's inbox card. Moving/editing/deleting squares or fixtures is reverted
  (Color Wars tamper logic) and freezes the player for 5 s.
- **Score**: per team = green + blue squares in its sector, as % of its start. The game ends at
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
