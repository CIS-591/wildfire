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
  (labels you last saw burning), `attackYes` (boss: question sticky id → time you first saw its YES),
  `cellIds` (label → NEW square id, for squares whose `cells` id went stale; see "Square ids"),
  `fixtureIds` (`banner`/`scoreboard`/`leaderboard` → NEW id, same idea),
  `gameOverAt` (time of the first banner read that said GAME OVER), `calls`.
- `.claude/commands/join.md`, `play.md`: the two routines.

## The game in one paragraph

Fire (orange) spreads by itself every ~20 s to neighbouring green squares, the same in every direction. Players
paint **blue** (water) on green or orange squares **in their own team's area**; fire can't cross blue
and blue stays. **Blue on an orange square puts that fire out.** Score per team = green squares left in its own area, as % of its start. The game
lasts 10 minutes. The one human decision is the **attack**: the boss asks
`Start a fire in Team 2's area?`; when a teammate's student answers YES, the team may paint **orange**
`#ff5a1f` on up to 3 **green** squares in that neighbour's area within 2 minutes (at most 2 attacks
per team per game). Fire spreads into anyone's area, yours too: it can spread back to you.
A thick team-colored border on a fire or burnt square shows which team lit that fire (normal border =
wild fire).

## The board

- **Grid** 36 × 34, labels like a spreadsheet: `A1`…`Z1`, `AA1`…`AJ1`, down to `AJ34`.
  colIndex: `A`=0 … `Z`=25, `AA`=26 … `AJ`=35. **Square top-left x = colIndex × 64, y = (row − 1) × 64**,
  60 × 60. Inverse: colIndex = floor(x / 64), row = floor(y / 64) + 1. Examples: `A1` (0,0), `R17`
  (1088,1024), `AJ34` (2240,2112). Squares sit inside 9 band frames (4 rows each), so in an SVG read
  their x/y are relative to the band: **identify a square by its label text** (`data-content`) or by
  its id (see "Square ids" below).
- **Team areas** (`sector` in board.json; boxes top-left x, y, w, h):

  | Team | id | Squares | Area box | Neighbours | Team color |
  |---|---|---|---|---|---|
  | Team 1 (top-left) | `ridge` | A–R, 1–17 | 0, 0, 1152, 1088 | Team 2, Team 3 | violet `#7c3aed` |
  | Team 2 (top-right) | `pine` | S–AJ, 1–17 | 1152, 0, 1152, 1088 | Team 1, Team 4 | pink `#db2777` |
  | Team 3 (bottom-left) | `cedar` | A–R, 18–34 | 0, 1088, 1152, 1088 | Team 1, Team 4 | indigo `#4338ca` |
  | Team 4 (bottom-right) | `birch` | S–AJ, 18–34 | 1152, 1088, 1152, 1088 | Team 2, Team 3 | slate `#334155` |

  Students only ever see "Team 1".."Team 4"; the ids are for `board.json` keys and `player.json`.
  Team colors appear on each area's edge, its label, its Orders header, and as a thick border on
  fire/burnt squares from that team's attack. Never on square fills.

  The fire starts in the four centre squares `R17 S17 R18 S18` (every area's inner corner) **and** in
  a 2-square fire inside each team's area, so every team is busy from the first second.
  `board.json` `teams[team].startScan` is the 6 × 6 box at your inner corner; `teams[team].startFires`
  (when present) lists your area's own start fire.
- **Square fills: only four** (lowercase hex; compare case-insensitively when reading):

  | | Fill | Means | Who paints it |
  |---|---|---|---|
  | 🟩 green | `#3fa66b` | tree, protect these | start |
  | 🟧 orange | `#ff5a1f` | fire, spreads by itself | referee; **you** only in an attack |
  | 🟦 blue | `#3aa7ff` | water, fire can't cross it, it stays | **you** |
  | ⬛ black | `#2a2420` | burnt, gone | referee (fire burns out) |

- **Panels**: Banner (0, −220, 1100, 110): phase, time left, next spread, each team's water
  (`💧 T1 62 · T2 40 · T3 71 · T4 55`: yours is `T` + your team number). Scoreboard
  (1160, −220, 1140, 110): each team's score as % of its area. Leaderboard (`fixtures.leaderboard`): per team,
  its players and any `⏳ waiting for a YES: start a fire in Team N's area` line. Orders frames (760 × 900): Team 1 (2440, 340),
  Team 2 (3240, 340), Team 3 (2440, 1300), Team 4 (3240, 1300). Inbox panel
  (0, 2300, 4000, 1500): one card per player.

## Rules the referee enforces

A paint sticks only if: the game is LIVE; you joined; ≥ 5 s since your last accepted paint; and it is
either **blue** on a **green or orange** square in **your team's area** with water left in
**your team's bucket** (banner; each accepted blue square uses 1 from it; teams don't share), or **orange** on a **green** square in a
neighbour's area during your team's attack (YES within the last 2 minutes, max 3 squares). Anything else is reverted, with the
reason on your inbox card. The fire changes squares every ~20 s, so a square you saw 30 s ago may be
orange or black now: **always read a square right before painting it**.

## The ONLY things you may change

1. A grid square's **fill**: blue `#3aa7ff` in your team's area, or orange `#ff5a1f` on green in a
   neighbour's area during your team's attack. Up to 5 squares per paint (one batch).
2. **Sticky notes inside your own team's Orders frame**: create them and edit their text.
3. During `/join`: one inbox card in the Inbox panel.

**Never move, resize or delete anything, and never change anything not listed above**: never touch
frames, the banner, the scoreboard, squares outside your area (except an attack), other players' inbox cards or stickies
in other teams' frames. Never write `YES`/`NO` unless your student just answered the question. The
referee reverts tampering and freezes you for 5 s.

## Stickies: plain sentences, no keywords

| Sticky | Posted by | Text | Color |
|---|---|---|---|
| Order | the worker creates its own (`Ana: paint`), the boss fills it in | `Ana: paint N9 N10 N11` (name, colon, `paint`, 3–6 labels in paint order) | `yellow` |
| Question | boss | `Start a fire in Team 2's area?` (a neighbour's team; when reading, also accept `team2`, `T2` or an old name like `Pine Valley`) / optional reason line, e.g. `Our area is under control.` | `red` |
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
  over 100k characters and breaks the MCP output limit. Scan only when you need to find the front. Find the fire with small scans: your
  `startScan` box first, then 6 × 6 boxes around squares you already know are burning. A scan box
  around square `L`: x = (colIndex − 2) × 64, y = (row − 3) × 64, w = h = 384, clipped to the grid
  (0, 0, 2304, 2176).
- **Paint** = a batch of up to **5 squares in ONE `canvas_update_from_svg`**, one `rect` per square,
  only the id and the fill (`#ff5a1f` for an attack):
  `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID1" fill="#3aa7ff"/><rect data-miro-id="ID2" fill="#3aa7ff"/></svg>`
  More than 5 in one batch: the extras are reverted. The result may say "0 updated" when a square
  already had that fill: that's fine, don't retry.
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
- Don't read the whole board and don't loop `canvas_search`.
- **Never call `canvas_get_canvas_composer_skill`**: its output is ~77k characters and breaks the MCP
  output limit. The SVG patterns above are all you need.
- Miro tool arguments: leave `invocation_source` unset and pass `is_repository: false`.

## Square ids (frame id vs square id)

- A **square id** comes only from: your `player.json` `cellIds` (check it first), `board.json` `cells`,
  or a scan result (a `rect` whose text is a label like `N9`).
- Every other id is NOT a square: `board.json` `frames` are the 9 band frames, `orders` are the Orders
  frames, `fixtures` are the banner/scoreboard/leaderboard. In a read, squares come wrapped in their
  band frame (`<g data-miro-id="…" data-frame="">`): that wrapper id is a frame, never paint or peek it.
  Never peek ids from `frames` or `orders`, except your own Orders frame as the routines say (peeking
  a band frame returns 144 squares and breaks the output limit).
- **Stale ids**: the referee recreates a moved or deleted square with a NEW id. If a peek by id
  returns nothing for a square, or a paint says not found: scan the 1-square box at its label
  (x = colIndex × 64, y = (row − 1) × 64, w = h = 64), take the `rect` whose text is that label, save
  `cellIds[label] = its id` in `player.json` and use it from now on.
- **Stale fixture ids** (the instructor keeps `board.json` in sync, but just in case): the referee may also recreate the banner, scoreboard or leaderboard with a NEW
  id in the same box. Use `player.json` `fixtureIds` first, then `board.json` `fixtures`. If a peek by
  a fixture id returns nothing, scan its box (banner 0, −220, 1100, 110; scoreboard 1160, −220,
  1140, 110; leaderboard: the large text item inside 3240, −330, 760, 610), and save
  `fixtureIds[name] = its id`.

## Pace and waiting

- **One turn ≈ 15 s with 2 Miro calls**: one small read, one write (like Color Wars). Keep reads small:
  only the ids you need; banner + inbox + leaderboard only every 4th turn. At most **one paint (batch
  of ≤ 5 squares) per turn**, ≥ 5 s between batches (the referee reverts a quicker one).
- **One Miro call at a time.** Never send two writes in the same message (e.g. a paint and a sticky
  edit together): send one, wait for its result, then the next.
- **Budget: cap 150 Miro calls per game**; count them in `player.json` `calls` (lobby peeks before the
  game is LIVE don't count). At 150, stop and say so in one line.
- **Waiting**: after a write, don't sleep unless the turn took under 5 s (then `sleep 5`). In the lobby
  or when PAUSED, `sleep 15`. Always its own Bash command: never longer than 15, never chained
  (`sleep 30`, `sleep 15; …`, `sleep 15 && …` are blocked).
- Miro says rate limit: `sleep 15`, retry once. Daily limit: stop and tell the student in one line.

## Reading the banner

- `join` / `lobby` / `waiting` → not started. `PAUSED` → wait. `LIVE` → play.
- `GAME OVER` (also `WINS`, `FINAL`, `OVER`) → **stop, but only once it is confirmed**: someone may
  write a fake one. The first time you read it, save `gameOverAt` = now and keep playing. Stop when a
  read at least 20 s after `gameOverAt` still says GAME OVER, or right away if your previous banner read
  showed under `0:30 left`. A LIVE read in between clears `gameOverAt`.
- `⚡ LIGHTNING struck K4` (at minutes 2, 4, 6 and 8, one strike in each team's area) names a new fire
  far from the others.
- Your team's water at 0 → your team's blue paints are refused; only attack orange (during a YES) still
  works. Otherwise just watch.

## Inbox card

The referee writes your team, role and welcome on it, a header with `N squares` (your accepted
squares so far), and one line per reverted paint with the reason.
It shows only the last ~6 lines. A square you painted that is green or orange again with no line about
it was most likely overwritten by the fire: just move on.
Rehearsal note: when several agents share one Miro account (instructor rehearsal), the card can mix
in teammates' paints; ignore lines about squares you didn't paint. In class each student has their
own account.

## Replies

While playing, one status line every ~10 turns (e.g. "Turn 10 · Team 1 71% green · water 40 left").
At the end, two lines: your team's final score and one thing that worked.
