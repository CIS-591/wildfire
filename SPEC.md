# Wildfire · the spec every part follows

CIS 591, Module 4. One class, one Miro board, one forest fire. Each student's Claude Code agent plays
through Miro's MCP server. Claude agents do the fast work (reading the board, posting orders, painting
squares). Humans make the big calls (approving the plan, a backburn, sending help). A referee script on
the instructor's laptop is the game engine: it spreads the fire on a timer, checks every paint, keeps
the score. **The referee never plays**: it never paints water, firebreaks or backburns for anyone.

Parts (all in `~/dev/wildfire`):

| Folder | What | Who uses it |
|---|---|---|
| `board/` | The Miro board: built through the Miro MCP; `board/board.json` records its URL and item ids | Everyone (projector + agents) |
| `kit/` | Student kit: a Claude Code project with `/join`, `/play`, `/approve` | Students |
| `referee/` | Game engine, adapted from the Color Wars referee (`referee/REFLECTION.md` has last class's lessons) | Instructor |
| `prototype.html` | Earlier browser prototype, reference only | — |

## 1. The board (geometry is shared by board, referee and kit: do not change it)

All coordinates are Miro canvas units, TOP-LEFT of each box (the MCP SVG convention). REST uses centers.

- **Grid**: 36 columns × 34 rows, labels `A1`–`AJ34` (spreadsheet columns A..Z, AA..AJ; rows 1..34).
  Square 60, pitch 64, origin (0,0): square `col,row` (0-based) is at x = col·64, y = row·64, 60×60.
  Each square is a rectangle shape whose text is its label (font 20, bold not required).
  Squares live in 9 frames, one per band of 4 rows (rows 1–4, 5–8, …, 33–34), exactly like Color Wars,
  frame box x = −2, y = r0·64 − 2, w = 36·64, h = rows·64. Frame fill dark `#3d4250`, no title.
- **Sectors** (each team protects one):

  | Team | Id | Columns | Rows | Team color |
  |---|---|---|---|---|
  | Ridge | `ridge` | A–R | 1–17 | `#b384bb` |
  | Pine Valley | `pine` | S–AJ | 1–17 | `#ea94bb` |
  | Cedar Creek | `cedar` | A–R | 18–34 | `#7b92ff` |
  | Birch Hollow | `birch` | S–AJ | 18–34 | `#ffffff` |

  A square's border (stroke width 3) is its sector's team color, so the four sectors read at a glance.
- **Square colors** (fills; lowercase hex everywhere):

  | State | Fill | Who makes it |
  |---|---|---|
  | Forest | `#93d275` | start |
  | Cabin (worth 10) | `#f5d128` | start; 2 per sector |
  | River (never burns) | `#414bb2` | start |
  | Fire | `#ff9d48` | referee only |
  | Water (wears off after 90 s) | `#23bfe7` | players |
  | Firebreak (permanent) | `#8b5a2b` | players |
  | Burnt | `#1a1a1a` | referee (fire burns out) and players (approved backburn only) |

  These live in `referee/config/colors.json` (the referee's `verify` round-trips each one through REST; if
  Miro refuses brown, the fallback firebreak color is `#808080` and the kit reads colors from
  `kit/board.json`, so nothing else changes).
- **Map features** (fixed, symmetric so no team is favoured):
  - Rivers: a river runs along column `J` rows 4–12 and its mirror `AA` rows 4–12; and along rows
    23–31 in columns `J` and `AA` (i.e. mirror top/bottom). Each sector gets one 9-square river line.
  - Cabins: `E5`, `M13` (Ridge) and their mirrors: left/right mirror col c ↔ 35−c, top/bottom mirror
    row r ↔ 33−r (0-based). So Pine Valley `AF5`, `X13`; Cedar Creek `E30`, `M22`; Birch Hollow `AF30`, `X22`.
  - First fire: the four centre squares `R17`, `S17`, `R18`, `S18` (one in each sector: fair).
- **Panels** (top-left x, y, w, h):

  | Item | Box | Notes |
  |---|---|---|
  | Title text "WILDFIRE" | (0, −330, 1400, 90) | static |
  | Banner (fixture) | (0, −220, 1100, 110) | referee writes: phase, wind, next spread, water |
  | Scoreboard (fixture) | (1160, −220, 1140, 110) | referee writes: 4 teams' % forest left |
  | Rules panel | (2440, −330, 760, 610) | static: the rules + color legend |
  | Leaderboard panel (fixture inside) | (3240, −330, 760, 610) | referee writes |
  | Orders · Ridge | (2440, 340, 760, 900) | frame titled "ORDERS · RIDGE", team color accent |
  | Orders · Pine Valley | (3240, 340, 760, 900) | same, laid out 2×2 like the sectors |
  | Orders · Cedar Creek | (2440, 1300, 760, 900) | |
  | Orders · Birch Hollow | (3240, 1300, 760, 900) | |
  | Inbox panel | (0, 2300, 4000, 1500) | one card per player, 5+ columns |

  The board should look like a game, not a spreadsheet: a dark backdrop behind the grid with row/column
  headers, a bold title, team-colored headers, a clear color legend, compass/wind rose next to the banner.

## 2. How students play

1. **Join.** `/join Your Name` → the agent creates an inbox card "Inbox · Your Name" inside the Inbox panel.
   The referee assigns a team (4 balanced teams, or presets in `referee/config/teams.json`) and a role:
   the first player assigned to a team is its **boss**, the rest are **workers**. The referee writes
   team + role + a welcome on the card.
2. **Play.** `/play` → the agent reads its inbox card for team and role, then loops until the game ends.
   - **Boss loop** (one turn ≈ every 15–20 s): read its sector and the fire near it, read its team's
     Orders frame; keep exactly one `ORDER` sticky per worker (update it rather than piling new ones);
     when fire is 3–5 squares from trees it cannot hold, propose a `BACKBURN`; when its sector is losing
     badly, post a `HELP` request in a neighbouring team's Orders frame; watch for answers.
   - **Worker loop** (one paint every ≥5 s, realistically ~15 s): read its own `ORDER` sticky, paint one
     square, occasionally update a `STATUS` sticky. Workers never improvise outside their order except
     when no order exists (then: water the burning square nearest its team's trees).
   - **The human** (any student) answers approvals: in the Miro UI, or with `/approve`, where their Claude
     lists pending approvals for their team and asks them YES/NO in the terminal, then writes the answer.
3. **Approvals are sticky notes** inside a team's Orders frame. The first line starts with a keyword:

   | Sticky | Who posts | Format | Who approves | Effect once approved |
   |---|---|---|---|---|
   | `PLAN` | boss | `PLAN` + plain-language plan | a teammate who did not post it | Team may paint. **No team paint is accepted before its first approved PLAN.** |
   | `ORDER` | boss | `ORDER · <worker name>` + squares and color | — | Communication only |
   | `BACKBURN` | boss | `BACKBURN P6-P15` (a straight run in one column or row, or labels separated by spaces; ≤ 20 squares, all in the team's sector) | a teammate who did not post it | Team players may paint those forest squares **burnt** |
   | `HELP` | requesting team's boss, in the **helper** team's frame | `HELP <requesting team name>` | a member of the helper team | For 3 minutes, up to 2 helper-team players may paint in the requesting team's sector (the first 2 who paint there) |
   | `STATUS` | anyone | free text | — | Communication only |

   An answer is a line that is exactly `YES` or `NO` (case-insensitive) added to the sticky. Approved =
   the sticky contains a `YES` line, and the last editor is on the right team and is not the creator.
   The referee remembers an approval once seen. "Boss posts" is a class rule too: the referee accepts a
   PLAN/BACKBURN/HELP from any member of the right team, so a team whose boss drops out is not stuck.
   The referee cannot tell a person from their Claude, so "human" approval is a class rule; `/approve`
   always asks the human first.

## 3. Rules the referee enforces (numbers in `referee/config/rules.json`, tuned with `npm run sim`)

- **Fire**: every `spreadSeconds` (20) each burning square ignites each up/down/left/right forest or cabin
  neighbour with `pSide` (0.60), ×`downwindMult` (2.5) downwind, ×`upwindMult` (0.3) upwind; diagonal
  neighbours with `pDiag` (0.25) on the same multipliers. **Embers**: with `pEmber` (0.10) a burning
  square ignites the forest square 2 steps downwind (jumping a 1-wide firebreak). A square burns for
  `burnTicks` (6) spreads, then turns burnt. Water, firebreak, burnt, river never ignite.
- **Wind**: one of 8 directions; rotates 45° every `windMinutes` (5); shown on the banner with an arrow.
- **Lightning**: at minutes in `lightningAt` ([5, 10, 15, 20]) a random forest square ≥ 6 squares from fire
  ignites; announced on the banner.
- **Water** squares return to forest after `wetSeconds` (90). **Shared water**: one pool of
  `waterTotal` (300) for the whole class; each accepted water paint uses 1; at 0 water paints are refused.
- **A paint is accepted only if all hold**: the game is live; the painter has joined; ≥ `cooldownSeconds`
  (5) since their last accepted paint; their team has an approved PLAN; the square is in their sector
  (or a HELP grant covers it); and the color/transition is one of:
  water on fire|forest|cabin → water · firebreak on forest → firebreak · burnt on forest inside an
  approved BACKBURN of their team → burnt. Anything else is reverted, with the reason on the painter's
  inbox card. Moving/editing/deleting squares or fixtures is reverted (Color Wars tamper logic) and
  freezes the player for 5 s.
- **Score**: per team = forest + water squares in its sector + 10 per surviving cabin, shown as % of its
  start. The game ends at `gameMinutes` (30), or earlier when no square has burned for 2 spreads after
  the last lightning time. Highest % wins.
- **Tuning target**: with 28 players, ~15 s per agent move, the fire should still be burning at 20 min,
  and team scores should end spread out (roughly 40–90%), not all 100% or all 0%.

## 4. What students learn (for slides and the kit README)

1. Orchestrator and workers: one agent plans, the others execute.
2. Coordination through shared state: agents never talk directly; everything goes through the board.
3. Human-in-the-loop: agents do the fast, small work; risky moves wait for a human YES, and waiting costs time.
4. Shared resources: one water pool for everyone.
5. Cooperation and trust between teams.
6. Agents make mistakes; rules and a referee catch them.
