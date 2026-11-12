# Wildfire: standing rules for the AI agent

You play **Wildfire** for one student in CIS 591 (Module 4, multi-agent systems). The whole class shares
one Miro board with one forest fire. Four teams each protect a sector of forest. You work through the
Miro MCP server. A referee program spreads the fire, checks every paint, reverts illegal ones and writes
the reason on the player's **inbox card**. The referee never fights the fire: only players do.

The student barely codes. Keep replies to one short line. Don't ask them to choose between options;
pick a sensible default and carry on. Only `/approve` asks the human a question (that is the point of it).

## Files

- `board.json`: board URL, grid geometry, colors, the four teams (sector box, watch box, cabins,
  neighbours), the Orders frames, sticky slots, fixture ids and `cells` (label → square id). Read it
  once per session. Ids may be `null` / empty: then find the item with a scope read of its box.
- `player.json` (written by `/join`, gitignored): `name`, `inboxId`, `team` (`ridge|pine|cedar|birch`),
  `role` (`boss|worker`), `ordersId`, `stickies` (ids of stickies YOU created), `myOrderId`, `calls`,
  `helpSeen` (boss: HELP sticky id → time you first saw its YES).
- `.claude/commands/join.md`, `play.md`, `approve.md`: the three routines.

## The board

- **Grid** 36 × 34, labels like a spreadsheet: `A1`…`Z1`, `AA1`…`AJ1`, down to `AJ34`.
  colIndex: `A`=0 … `Z`=25, `AA`=26 … `AJ`=35. **Square top-left x = colIndex × 64, y = (row − 1) × 64**,
  60 × 60. Inverse: colIndex = floor(x / 64), row = floor(y / 64) + 1. Examples: `A1` (0,0), `R17`
  (1088,1024), `AJ34` (2240,2112). Squares sit inside 9 dark band frames (4 rows each), so in an SVG read
  their x/y are relative to the band: **identify a square by its label text** (`data-content`).
- **Sectors** (all boxes top-left x, y, w, h):

  | Team | id | Squares | Sector box | Team color | Cabins | River |
  |---|---|---|---|---|---|---|
  | Ridge | `ridge` | A–R, 1–17 | 0, 0, 1152, 1088 | `#b384bb` | E5, M13 | J4–J12 |
  | Pine Valley | `pine` | S–AJ, 1–17 | 1152, 0, 1152, 1088 | `#ea94bb` | AF5, X13 | AA4–AA12 |
  | Cedar Creek | `cedar` | A–R, 18–34 | 0, 1088, 1152, 1088 | `#7b92ff` | E30, M22 | J23–J31 |
  | Birch Hollow | `birch` | S–AJ, 18–34 | 1152, 1088, 1152, 1088 | `#ffffff` | AF30, X22 | AA23–AA31 |

  The fire starts in the four centre squares `R17 S17 R18 S18`: every sector's inner corner.
  Neighbours (for HELP): Ridge ↔ Pine Valley, Ridge ↔ Cedar Creek, Pine Valley ↔ Birch Hollow,
  Cedar Creek ↔ Birch Hollow.
- **Square fills** (lowercase hex; compare case-insensitively when reading):

  | State | Fill | Who paints it |
  |---|---|---|
  | Forest | `#93d275` | start |
  | Cabin (worth 10) | `#f5d128` | start |
  | River (never burns) | `#414bb2` | start |
  | Fire | `#ff9d48` | referee only |
  | Water (wears off after 90 s) | `#23bfe7` | you |
  | Firebreak (permanent) | `#8b5a2b` | you (if `board.json` `colors.firebreak` says `#808080`, use that) |
  | Burnt | `#1a1a1a` | referee, or you inside an approved BACKBURN |

- **Panels**: Banner (0, −220, 1100, 110): phase, wind, next spread, water left. Scoreboard
  (1160, −220, 1140, 110): each team's % forest left. Orders frames (760 × 900): Ridge (2440, 340),
  Pine Valley (3240, 340), Cedar Creek (2440, 1300), Birch Hollow (3240, 1300). Inbox panel
  (0, 2300, 4000, 1500): one card per player.

## Rules the referee enforces

A paint sticks only if: the game is LIVE; you joined; ≥ 5 s since your last accepted paint; **your
team has an approved PLAN**; the square is in your sector (or covered by an approved HELP); and the
change is one of:

- **water** on fire, forest or cabin → water (uses 1 from the class's shared pool of 300; refused at 0)
- **firebreak** on forest → firebreak
- **burnt** on forest inside your team's approved BACKBURN → burnt

Fire spreads every 20 s to up/down/left/right neighbours (60%), ×2.5 downwind, ×0.3 upwind;
diagonals 25% (same multipliers). Embers (10%) jump 2 squares downwind (over a 1-wide break). A square
burns for 6 spreads (2 min), then turns burnt. Water, firebreak, burnt and river never ignite. Wind turns
45° every 5 min; lightning at minutes 5, 10, 15 and 20, at least 6 squares from the fire. Score = forest + water squares in your sector + 10 per surviving cabin, as % of
the start. The game ends at 30 min (or when the fire is out).

## The ONLY things you may change

1. A grid square's **fill**, in your own sector (or a sector your team was granted HELP for), with
   one of the three player colors above. One square per paint.
2. **Sticky notes inside your own team's Orders frame**: create them and edit their text.
3. A **`HELP` sticky inside a neighbouring team's Orders frame** (boss only), and the YES/NO answer
   line on stickies in your own frame (`/approve`, after the human says so).
4. During `/join`: one inbox card in the Inbox panel.

**Never move, resize or delete anything, and never change anything not listed above**: never touch frames, the banner, the scoreboard,
squares outside your sector, other players' inbox cards or stickies in other frames (except the HELP
sticky you posted). Never write `YES`/`NO` on a sticky unless the human said so in `/approve`. The
referee reverts tampering and freezes you for 5 s.

## Sticky formats (first line starts with the keyword; one fact per line)

| Sticky | Posted by | Text | Color |
|---|---|---|---|
| `PLAN` | boss | `PLAN` / one to three plain-language lines | `light_green` |
| `ORDER` | boss | `ORDER · <worker name>` / `FIREBREAK N9 N10 N11` or `WATER Q16 R16` or `BURNT P6 P7` / `why: <short reason>` | `yellow` |
| `BACKBURN` | boss | `BACKBURN P6-P15` (one column or one row run, or labels separated by spaces; ≤ 20 squares, all forest, all in your sector) / `why: …` | `orange` |
| `HELP` | boss, in the **helper** team's frame | `HELP <your team name>` e.g. `HELP Cedar Creek` / `fire at <labels>, need 2 painters` | `red` |
| `STATUS` | anyone | `STATUS · <name>` / free text | `light_blue` |

An **answer** is a separate line that is exactly `YES` or `NO`. Approved = the sticky has a `YES` line
written by a teammate who did not create it. Stickies are 128 × 147; put each in the first free slot
of its kind from `board.json` `stickySlots` (positions relative to the frame's top-left).

- `ORDER` and `STATUS`: one per person; **edit its text instead of posting another.**
- `PLAN`, `BACKBURN`, `HELP`: the referee stops reading a sticky once it is approved, so editing an
  approved one does nothing. **A new run or a new request = a NEW sticky** in the next free slot; leave
  answered ones alone. A sticky that got `NO` is still open: rewrite its text without the answer
  lines to ask again.

## How to talk to Miro (cheap calls only)

Every call counts against a per-user rate limit and a daily limit. Use only these patterns. Always pass
`miro_url` = `board.json` `boardUrl`.

- **Peek**: `canvas_read_as_svg` with `widget_ids` only (banner, your inbox card, your sticky, the
  squares you care about from `cells`), all in ONE call. Never combine `widget_ids` with a scope:
  that returns only the overlap.
- **Scan**: `canvas_read_as_svg` with `scope_x/scope_y/scope_width/scope_height` only. A scan of a
  box returns every square in it with its `data-miro-id`, `fill` and label: keep those ids for peeks
  and paints. Keep scans small (≤ 10 × 10 squares, about 640 × 640) except the boss's sector scan.
- **Read your Orders frame**: `canvas_read_as_svg` with `widget_ids: [ordersId]` (a frame pulls in all
  its stickies). No id yet: scan its box once and save the frame's `data-miro-id` as `ordersId`.
- **Paint** one square: `canvas_update_from_svg` with only the id and the fill:
  `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID" fill="#23bfe7"/></svg>`
  For firebreak and burnt also make the label white so it stays readable:
  `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID" fill="#8b5a2b" data-text-color="#ffffff"/></svg>`
  (If Miro refuses `data-text-color`, paint with the fill alone. Never change the label text.)
- **Create a sticky in a frame**: `canvas_update_from_svg` (not `canvas_create_from_svg`, which nudges
  new items away from existing ones) with the sticky nested in a sparse wrapper of the frame. The
  wrapper has **no `transform`, no `rect data-type="frame"`** (those would move or resize the frame);
  the sticky's x/y are the slot, relative to the frame's top-left:
  `<svg xmlns="http://www.w3.org/2000/svg"><g data-miro-id="FRAME_ID" data-frame=""><rect data-type="sticky" x="600" y="234" width="128" height="147" data-color="yellow" data-content="ORDER · Ana&lt;br&gt;FIREBREAK N9 N10 N11&lt;br&gt;why: line ahead of the fire"/></g></svg>`
  Save the new `data-miro-id` from `result_svg` in `player.json` `stickies`. If the result shows the
  sticky outside the frame, update it once with absolute x/y inside the frame box and carry on.
- **Edit a sticky's text**: `canvas_update_from_svg` with
  `<rect data-miro-id="ID" data-type="sticky" data-content="…full new text…"/>` (keep `data-type`).
  To add an answer line, copy the current `data-content` exactly as read and append `&lt;br&gt;YES`.
- Escape `&`, `<`, `>` in attribute values (`&amp;` `&lt;` `&gt;`). Use `&lt;br&gt;` for line breaks.
- Don't read the whole board, don't loop `canvas_search`, and fetch the canvas skill at most once.

**Politeness**: at most **one paint per turn**, one turn about every 15 s (`sleep` between turns if a
turn was fast). Never fire several writes in parallel. Budget about **400 Miro calls per session**
(boss: 500); count them in `player.json` `calls`, but not the lobby peeks before the game is LIVE. If Miro says rate limit: `sleep 30` and retry once; daily limit:
stop and tell the student in one line.

## Reading the banner

- `join` / `lobby` / `waiting` → not started. `PAUSED` → wait. `LIVE` → play.
- `GAME OVER`, `WINS`, `FINAL` or `OVER` → **stop**.
- The banner shows e.g. `WIND ➡ E`: the arrow **and** the letters both name the direction the wind
  blows **toward**, which is where the fire runs (**downwind**). `WIND ⬅ W` means the fire runs west.
- `⚡ LIGHTNING struck K4` names a new fire far from the old one.

## Replies

While playing, one status line every ~10 turns (e.g. "Turn 40 · Ridge 71% · line N9–N14 holding · water
212 left"). At the end, two lines: the final score for your team and one thing that worked.
