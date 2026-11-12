# Wildfire: standing rules for the AI agent

You play **Wildfire** for one student in CIS 591 (Module 4, multi-agent systems). The whole class shares
one Miro board with one forest fire. Four teams each protect an area of the forest. You work through the
Miro MCP server. A referee program spreads the fire, checks every paint, reverts illegal ones and writes
the reason on the player's **inbox card**. The referee never fights the fire: only players do.

The student barely codes and only ever types `/join Your Name` and `/play`. Keep replies to one short,
plain line. Never ask them to choose anything, except the one YES/NO question below. In anything the
student reads (your replies, stickies) say "your team's area", never "sector".

## Files

- `board.json`: board URL, grid geometry, the 4 colors, the four teams (area box `sector`, `startScan`
  box, neighbours), the Orders frames, sticky positions (`stickySlots`), fixture ids and `cells`
  (label → square id, e.g. `"N9": "3458…"`). Read it once per session.
- `player.json` (written by `/join`, gitignored): `name`, `inboxId`, `team` (internal id `ridge|pine|cedar|birch`; to students always say its
  display name `board.json` `teams[team].name`, "Team 1".."Team 4"),
  `role` (`boss|worker`), `ordersId`, `stickies` (ids of stickies YOU created), `myOrderId`, `fire`
  (labels you last saw burning), `sprayYes` (boss: question sticky id → time you first saw its YES),
  `calls`.
- `.claude/commands/join.md`, `play.md`: the two routines.

## The game in one paragraph

Fire (orange) spreads by itself every ~25 s to neighbouring green squares, faster downwind. Players
paint **only blue** (water) on green or orange squares; fire can't cross blue and blue stays. Score per
team = green + blue squares in its area as % of the start. The game lasts 10 minutes. The one human
decision: the boss asks `Spray water in Team 2's area?`; when a teammate's student answers YES,
the team may paint blue in that neighbour's area for 2 minutes.

## The board

- **Grid** 36 × 34, labels like a spreadsheet: `A1`…`Z1`, `AA1`…`AJ1`, down to `AJ34`.
  colIndex: `A`=0 … `Z`=25, `AA`=26 … `AJ`=35. **Square top-left x = colIndex × 64, y = (row − 1) × 64**,
  60 × 60. Inverse: colIndex = floor(x / 64), row = floor(y / 64) + 1. Examples: `A1` (0,0), `R17`
  (1088,1024), `AJ34` (2240,2112). Squares sit inside 9 dark band frames (4 rows each), so in an SVG read
  their x/y are relative to the band: **identify a square by its label text** (`data-content`) or by
  its id from `board.json` `cells`.
- **Team areas** (`sector` in board.json; boxes top-left x, y, w, h):

  | Team | id | Squares | Area box | Neighbours | Team color |
  |---|---|---|---|---|---|
  | Team 1 (top-left) | `ridge` | A–R, 1–17 | 0, 0, 1152, 1088 | Team 2, Team 3 | violet `#a78bfa` |
  | Team 2 (top-right) | `pine` | S–AJ, 1–17 | 1152, 0, 1152, 1088 | Team 1, Team 4 | rose `#f472b6` |
  | Team 3 (bottom-left) | `cedar` | A–R, 18–34 | 0, 1088, 1152, 1088 | Team 1, Team 4 | lemon `#fde047` |
  | Team 4 (bottom-right) | `birch` | S–AJ, 18–34 | 1152, 1088, 1152, 1088 | Team 2, Team 3 | frost `#e2e8f0` |

  Students only ever see "Team 1".."Team 4"; the ids are for `board.json` keys and `player.json`.
  Team colors appear only on each area's edge, its label and its Orders header, never on squares.

  The fire starts in the four centre squares `R17 S17 R18 S18`: every area's inner corner.
  `board.json` `teams[team].startScan` is the 6 × 6 box at your inner corner.
- **Square fills: only four** (lowercase hex; compare case-insensitively when reading):

  | | Fill | Means | Who paints it |
  |---|---|---|---|
  | 🟩 green | `#3fa66b` | tree, protect these | start |
  | 🟧 orange | `#ff5a1f` | fire, spreads by itself | referee only |
  | 🟦 blue | `#3aa7ff` | water, fire can't cross it, it stays | **you** |
  | ⬛ black | `#2a2420` | burnt, gone | referee (fire burns out) |

- **Panels**: Banner (0, −220, 1100, 110): phase, wind, next spread, water left. Scoreboard
  (1160, −220, 1140, 110): each team's % forest left. Orders frames (760 × 900): Team 1 (2440, 340),
  Team 2 (3240, 340), Team 3 (2440, 1300), Team 4 (3240, 1300). Inbox panel
  (0, 2300, 4000, 1500): one card per player.

## Rules the referee enforces

A blue paint sticks only if: the game is LIVE; you joined; ≥ 5 s since your last accepted paint; the
square was **green or orange** at that moment; it is in **your team's area**, or in a neighbour's area
your team got a YES to spray in, within the last 2 minutes; and there is shared water left (banner;
each accepted paint uses 1 from one pool for the whole class). Anything else is reverted, with the
reason on your inbox card. The fire changes squares every ~25 s, so a square you saw 30 s ago may be
orange or black now: **always read a square right before painting it**.

## The ONLY things you may change

1. A grid square's **fill**, to blue `#3aa7ff`, in your team's area (or a neighbour's area after a YES).
   One square per paint.
2. **Sticky notes inside your own team's Orders frame**: create them and edit their text.
3. During `/join`: one inbox card in the Inbox panel.

**Never move, resize or delete anything, and never change anything not listed above**: never touch
frames, the banner, the scoreboard, squares outside your area, other players' inbox cards or stickies
in other teams' frames. Never write `YES`/`NO` unless your student just answered the question. The
referee reverts tampering and freezes you for 5 s.

## Stickies: plain sentences, no keywords

| Sticky | Posted by | Text | Color |
|---|---|---|---|
| Order | the worker creates its own (`Ana: paint`), the boss fills it in | `Ana: paint N9 N10 N11` (name, colon, `paint`, 3–6 labels in paint order) | `yellow` |
| Question | boss | `Spray water in Team 2's area?` (a neighbour's team; when reading, also accept `team2`, `T2` or an old name like `Pine Valley`) / optional reason line, e.g. `Their fire at S10 is about to reach us.` | `red` |
| Answer | a teammate who did not post the question (their student said so) | a new line `YES` or `NO` on the question | — |

- One order sticky per worker: **edit its text, never post a second.** The squares come after `paint`;
  `Ana: paint` with nothing after it means "no order yet".
- A question is never edited after posting, except to add the answer line. A new question = a NEW
  sticky in the next free `question` position.
- Positions: `board.json` `stickySlots` (x/y relative to the frame's top-left). Stickies are 128 × 147.
  Position (600, 726) holds the instructor's EXAMPLE sticky: never use it.

**Line breaks**: Miro reads sticky text back with `<br />` (in the SVG: `&lt;br /&gt;`), but you write
it with `&lt;br&gt;`. Both are the same line break. Always write `&lt;br&gt;`; when you copy text you
read, turn every `&lt;br /&gt;` into `&lt;br&gt;`.

## How to talk to Miro (cheap calls only)

Every call counts against a per-user rate limit and a daily limit. Use only these patterns. Always pass
`miro_url` = `board.json` `boardUrl`.

- **Peek**: `canvas_read_as_svg` with `widget_ids` only: banner id, your inbox card, your Orders frame
  (a frame pulls in all its stickies), and the squares you care about (ids from `board.json` `cells`),
  all in ONE call (up to about 20 ids). Never combine `widget_ids` with a scope: that returns only the
  overlap.
- **Scan**: `canvas_read_as_svg` with `scope_x/scope_y/scope_width/scope_height` only.
  **Never scan more than 6 × 6 squares (384 × 384) in one call.** A bigger box (a whole area) returns
  over 100k characters and breaks the MCP output limit. Find the fire with small scans: your
  `startScan` box first, then 6 × 6 boxes around squares you already know are burning. A scan box
  around square `L`: x = (colIndex − 2) × 64, y = (row − 3) × 64, w = h = 384, clipped to the grid
  (0, 0, 2304, 2176).
- **Paint** one square: `canvas_update_from_svg` with only the id and the fill:
  `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID" fill="#3aa7ff"/></svg>`
  Never change the label text, never send x/y/width/height for a square.
- **Create a sticky in your frame**: `canvas_update_from_svg` (not `canvas_create_from_svg`, which nudges
  new items away from existing ones) with the sticky nested in a sparse wrapper of the frame. The
  wrapper has **no `transform`, no `rect data-type="frame"`** (those would move or resize the frame);
  the sticky's x/y are the position, relative to the frame's top-left:
  `<svg xmlns="http://www.w3.org/2000/svg"><g data-miro-id="FRAME_ID" data-frame=""><rect data-type="sticky" x="600" y="234" width="128" height="147" data-color="yellow" data-content="Ana: paint"/></g></svg>`
  Save the new `data-miro-id` from `result_svg` in `player.json` `stickies`. If the result shows the
  sticky outside the frame, update it once with absolute x/y inside the frame box and carry on.
- **Edit a sticky's text**: `canvas_update_from_svg` with
  `<rect data-miro-id="ID" data-type="sticky" data-content="…full new text…"/>` (keep `data-type`).
- In attribute values escape `&`, `<`, `>`, `"` (`&amp;` `&lt;` `&gt;` `&quot;`). The apostrophe in
  `Team 2's` needs no escaping.
- Don't read the whole board, don't loop `canvas_search`, and fetch the canvas skill at most once.

## Pace and waiting

- **One turn ≈ 20–40 s with at most 3 Miro calls** (look, paint, an occasional sticky write). At most
  **one paint per turn**. Never fire several writes in parallel.
- **Budget about 400 Miro calls per session**; count them in `player.json` `calls` (lobby peeks before
  the game is LIVE don't count). At 400, stop and say so in one line.
- **Waiting**: run `sleep 15` (or less) as its own Bash command. Never longer than 15, never chained
  (`sleep 30`, `sleep 40`, `sleep 15; …`, `sleep 15 && …` are all blocked). Need more time? Run
  `sleep 15` again as a new command. If a turn already took 20 s or more, don't sleep at all.
- Miro says rate limit: `sleep 15`, retry once. Daily limit: stop and tell the student in one line.

## Reading the banner

- `join` / `lobby` / `waiting` → not started. `PAUSED` → wait. `LIVE` → play.
- `GAME OVER` → **stop** (also `WINS`, `FINAL`, `OVER`).
- The banner shows e.g. `wind → E` (read it case-insensitively): the arrow **and** the letters name the
  direction the wind blows **toward**, which is where the fire runs (**downwind**). `wind ← W` means the fire runs west.
  The wind turns once, at minute 5.
- `⚡ LIGHTNING struck K4` (once, at minute 5) names a new fire far from the old one.
- `WATER 0` → no blue paint will stick; stop painting and just watch.

## Inbox card

The referee writes your team, role and welcome on it, and one line per reverted paint with the reason.
Rehearsal note: when several agents share one Miro account (instructor rehearsal), the card can mix
in teammates' paints; ignore lines about squares you didn't paint. In class each student has their
own account.

## Replies

While playing, one status line every ~10 turns (e.g. "Turn 10 · Team 1 71% green · water 212 left").
At the end, two lines: your team's final score and one thing that worked.
