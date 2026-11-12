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
  | Team 3 | `cedar` | A–R | 18–34 | gold `#ca8a04` |
  | Team 4 | `birch` | S–AJ | 18–34 | slate `#334155` |

  The internal ids stay (state files, code); every student-facing text says "Team N". The question
  sticky parser accepts "Team 2", "team2", "T2" and the old names. Team colors appear on each
  area's thick edge, its "TEAM N'S AREA" label, its Orders header, its leaderboard row and as the
  border of every square in the area (width 4, `square.teamBorderWidth`), so the areas stand apart.
  Never on square fills.
- **Palette** (light theme: white board, the game colors pop):

  | Role | Hex |
  |---|---|
  | background / backdrop | `#f5f6f8` |
  | band frames (gaps between squares) | `#ffffff` |
  | square borders | the area's team color, width 4 |
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
  | Banner (fixture) | (0, −220, 1100, 110) | referee writes, no emoji: `LIVE · 7:12 left · next spread 14s · WATER T1 62 · T2 40`; line 2 the news (`LIGHTNING! New fire at K4 (Team 2's area)`, `TEAM 1 SET FIRE TO TEAM 2'S AREA!`, `TEAM 3 TAKES THE LEAD!` (at most every 45 s), `TEAM 1 AND TEAM 2 ARE NECK AND NECK` (top two within 2%, from minute 3), `FINAL MINUTE! …` in the last 60 s); at the end `GAME OVER · TEAM 2 WINS WITH 87%` / `2ND TEAM 3 82% · 3RD TEAM 4 79% · time is up`. Presentation only: no rule reads these |
  | Scoreboard (fixture) | (1160, −220, 1140, 110) | referee writes: each team's % forest left (`TEAM 3 not playing`), `LEAD` after the leader, `ON FIRE 3`; no emoji |
  | Rules panel | (2440, −330, 760, 610) | static: the rules + color legend |
  | Leaderboard panel | (3240, −330, 760, 610) | static frame for the ranked rows |
  | Leaderboard rows (fixtures `rank_1`..`rank_4`, slot 1 = first place) | x 3260, y −252 + (N−1)×128 (−252, −124, 4, 132); each 720 × 118 pill | game-style ranked list: filled with the team's color, white text; rows swap slots as teams overtake. Plain text, no emoji: `TEAM 2 · Boss Ana` / `Water 62 · Fires set 3 · Trees burned 23 · MVP Ben (23)` / `Crew: Ben, Cy` / optional status `Waiting for a YES: start a fire in Team 4's area` or `ATTACK ON TEAM 4: 2 fires left (1:20)`. Lobby: rows in team order, `TEAM 2` / `Waiting for the draw`. Not playing: `TEAM 3 · not playing`, grey row |
  | Score badges (fixtures `rank_1_score`..`rank_4_score`) | 130 × 80, inside the right end of each row | white rounded box, the team's `87%` (`-` for a team not playing) |
  | Leaderboard icons (referee-placed images) | on each row | a medal per slot (gold, silver, bronze, 4th) and the team's mascot (Team 1 owl, Team 2 fox, Team 3 lion, Team 4 wolf); Microsoft Fluent Emoji 3D, MIT; agents ignore them |
  | Orders · Team 1 | (2440, 340, 760, 900) | header "ORDERS · TEAM 1", team color accent |
  | Orders · Team 2 | (3240, 340, 760, 900) | same, laid out 2×2 like the areas |
  | Orders · Team 3 | (2440, 1300, 760, 900) | |
  | Orders · Team 4 | (3240, 1300, 760, 900) | |
  | Inbox panel | (0, 2300, 4000, 1500) | one card per player, 5+ columns |

  The board should look like a game, not a spreadsheet: a dark backdrop behind the grid with row/column
  headers, a bold title, team-colored headers, a clear color legend. No wind rose (there is no wind).

## 2. How students play (10-minute game)

1. **Join.** `/join Your Name` → the agent creates an inbox card "Inbox · Your Name" inside the Inbox panel.
   The referee writes `👋 Ana: you're in! 🎲 Teams are drawn when the game starts…` (header
   `Ana · 🎲 waiting for the draw`).
   **The draw** (`drawTeams: true`, default): when the game starts, every player gets a random team
   (presets in `referee/config/teams.json` keep theirs); the first drawn into a team is its **boss**,
   the rest are **workers**. The instructor sets `--teams N` (1–4 teams, Team 1 first) and
   `--team-size N`: the draw uses only as many teams as that needs (8 players, size 3 → 3, 3, 2, Team 4
   not playing); more players than teams × size are spread evenly. The referee writes
   `🎲 The draw: Ana: you are on Team 1 (ridge). … You are the BOSS: …` and the header
   `Ana · TEAM 1 · 👑 BOSS · 0 squares` (worker: `· WORKER ·`). A player joining after the start gets
   that welcome at once, on a random smallest team in play. `--no-draw`: players are placed as they
   join (smallest open team, first on a team = boss).
2. **Play.** `/play` → the agent waits in the lobby, then reads its inbox card for team and role (the
   card wins over anything saved before the draw), then loops until the banner says
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
  a thinner border (width 3), so the damage stays readable. Banner announces "TEAM 1 SET FIRE TO TEAM
  2'S AREA!"; each team's leaderboard row shows "Fires set 3 · Trees burned 23".
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
- **Start**: the centre fire (R17 S17 R18 S18) plus one 2-square fire inside each playing team's area, mirrored
  (`startFires`), lit at minute `startFiresAt` (1) so agents have read the board first; every team is busy from minute 1.
- **Lightning** at minutes `lightningAt` ([2, 4, 6, 8]): each strike hits a different playing team's area
  (each once, shuffled order; with fewer teams than strikes, a second round), on a green square at least `lightningMinDistance` (6) from any fire.
- **Water: one bucket per team.** Each team has its own `waterPerTeam` on the banner (e.g.
  "WATER T1 62 · T2 40 · T3 71 · T4 55"); each accepted blue square uses 1 from the painter's team bucket;
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
- **Teams not playing** (no players after the draw, fixed at the start): their area gets no start fire,
  no lightning, and can't be attacked (a question naming it is refused); the scoreboard says
  `TEAM 3 not playing`, the banner's water list shows only teams in play, the leaderboard shows it as a grey `TEAM 3 · not playing` row (badge `-`), and the
  winner is picked among them. Fire can still spread into an empty area from the centre fire.
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
