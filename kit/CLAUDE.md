# Wildfire: standing rules for the AI agent

Read and follow these rules first (the one source of truth for what you may do):

@AGENTS.md

You play **Wildfire** for one student in CIS 591 (Module 4, multi-agent systems). The whole class shares
one Miro board with one forest fire. Up to four teams each protect an area of the forest. You work through the
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
  `role` (`boss|worker`) (team and role come from the inbox card once the game starts: teams are drawn
  at random then; the card always wins over a saved team), `ordersId`,
  `stickies` = ids of stickies YOU created, always this shape: `{"order": "<id>", "questions": ["<id>", …]}`
  (`order`: a worker's own order sticky; `questions`: the boss's question stickies; start as `{}`),
  `fire` (labels you last saw burning), `water0` (your team's water at your first LIVE read),
  `attackYes` (boss: question sticky id → time you first saw its YES),
  `cellIds` (label → NEW square id, for squares whose `cells` id went stale; see "Square ids"),
  `fixtureIds` (`banner`/`scoreboard`/`rank_1`..`rank_4` → NEW id, same idea),
  `gameOverAt` (time of the first banner read that said GAME OVER), `calls`.
- `.claude/commands/join.md`, `play.md`: the two routines.

## The game

How the game works (goal, fire, water, roles, attacks, when to ask your student) is at the top of
`AGENTS.md`. Every square has a border in its area's team color; a fire or burnt square bordered in
ANOTHER team's color was lit by that team (its own area's color = wild fire).

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
  | Team 3 (bottom-left) | `cedar` | A–R, 18–34 | 0, 1088, 1152, 1088 | Team 1, Team 4 | gold `#ca8a04` |
  | Team 4 (bottom-right) | `birch` | S–AJ, 18–34 | 1152, 1088, 1152, 1088 | Team 2, Team 3 | slate `#334155` |

  Students only ever see "Team 1".."Team 4"; the ids are for `board.json` keys and `player.json`.
  Team colors appear on each area's edge, its label, its Orders header, its leaderboard row, as the border of
  every square in its area, and as a thicker border on fire/burnt squares from that team's attack.
  Never on square fills. Up to 4 teams play; a team that isn't playing has no `T<n>` in the LIVE
  banner's `WATER` list (its leaderboard row says `not playing`): never ask to start a fire in its area.

  When fires start: `AGENTS.md` "The fire". `board.json` `teams[team].startScan` is the 6 × 6 box at
  your inner corner (around the centre fire); `teams[team].startFires` lists your area's minute-1 fire.
- **Square fills: only four** (lowercase hex; compare case-insensitively when reading):

  | | Fill | Means | Who paints it |
  |---|---|---|---|
  | 🟩 green | `#3fa66b` | tree, protect these | start |
  | 🟧 orange | `#ff5a1f` | fire, spreads by itself | referee; **the boss** only in an attack |
  | 🟦 blue | `#3aa7ff` | water wall, fire can't cross it, it stays | **you**, only on green within 2 of fire, never on orange |
  | ⬛ black | `#2a2420` | burnt, gone | referee (fire burns out) |

- **Panels**: Banner (0, −220, 1100, 110): phase, time left, next spread, each team's water
  (`WATER T1 62 · T2 40 · T3 71 · T4 55`: yours is `T` + your team number). Scoreboard
  (1160, −220, 1140, 110): each team's score as % of its area. Leaderboard (3240, −330, 760, 610):
  4 ranked rows `fixtures.rank_1`..`rank_4` (slot 1 = first place; teams swap slots as they overtake).
  Each row's text, plain lines: `TEAM 2 · Boss Ana` / `Water 62 · Fires set 3 · Trees burned 23 · MVP Ben (23)` /
  `Crew: Ben, Cy` / optional status: `Waiting for a YES: start a fire in Team 4's area` or
  `ATTACK ON TEAM 4: 1 fire left (1:20)` (`0 fires left` once its square is lit). Lobby: `TEAM 2` / `Waiting for the draw`; a team not
  playing: `TEAM 3 · not playing`. Ignore the score badges (`rank_N_score`) and the icons. Orders frames (760 × 900): Team 1 (2440, 340),
  Team 2 (3240, 340), Team 3 (2440, 1300), Team 4 (3240, 1300). Inbox panel
  (0, 2300, 4000, 1500): one card per player.

## Before every paint

The rules are in `AGENTS.md` (above). Paints also need the game to be LIVE and you to have joined.
The fire spreads every 5 s, so a square you saw 10 s ago may be orange or black now:
**always read a square right before painting it**.

## Stickies: plain sentences, no keywords

| Sticky | Posted by | Text | Color |
|---|---|---|---|
| Order | the worker creates its own (`Ana: paint`), the boss fills it in | `Ana: paint N9 N10 N11` (name, colon, `paint`, 3–6 labels in paint order) | `yellow` |
| Question | boss | `Start a fire in Team 2's area?` (a neighbour's team; when reading, also accept `team2`, `T2` or an old name like `Pine Valley`) / optional reason line, e.g. `Our area is under control.` | `red` |
| Answer | a teammate who did not post the question (their student said so); in a team of one (`Crew: -`), the boss itself after asking its student | a new line `YES` or `NO` on the question | — |

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
  only the id and the fill (`#3aa7ff`; the boss's attack square: `#ff5a1f`):
  `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID1" fill="#3aa7ff"/><rect data-miro-id="ID2" fill="#3aa7ff"/></svg>`
  All squares of one batch go in this ONE call, never one call per square. More than 5 in one batch:
  the extras are reverted. **The update result's count is unreliable** ("Applied diff: 0 updated" or a
  low count even when the squares changed): your inbox card and a later peek are the truth. Never
  repaint just because the count looks low.
  Never change the label text, never send x/y/width/height for a square.
- **Create a sticky in your frame**: `canvas_update_from_svg` (not `canvas_create_from_svg`, which nudges
  new items away from existing ones) with the sticky nested in a sparse wrapper of the frame. The
  wrapper has **no `transform`, no `rect data-type="frame"`** (those would move or resize the frame);
  the sticky's x/y are the position, relative to the frame's top-left:
  `<svg xmlns="http://www.w3.org/2000/svg"><g data-miro-id="FRAME_ID" data-frame=""><rect data-type="sticky" x="600" y="234" width="128" height="147" data-color="yellow" data-content="Ana: paint"/></g></svg>`
  Save the new `data-miro-id` from `result_svg` in `player.json` `stickies` (`order` or `questions`). If the result shows the
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
  frames, `fixtures` are the banner/scoreboard/leaderboard rows. In a read, squares come wrapped in their
  band frame (`<g data-miro-id="…" data-frame="">`): that wrapper id is a frame, never paint or peek it.
  Never peek ids from `frames` or `orders`, except your own Orders frame as the routines say (peeking
  a band frame returns 144 squares and breaks the output limit).
- **Stale ids**: the referee recreates a moved or deleted square with a NEW id. If a peek by id
  returns nothing for a square, or a paint says not found: scan the 1-square box at its label
  (x = colIndex × 64, y = (row − 1) × 64, w = h = 64), take the `rect` whose text is that label, save
  `cellIds[label] = its id` in `player.json` and use it from now on.
- **Stale fixture ids** (the instructor keeps `board.json` in sync, but just in case): the referee may also recreate the banner, scoreboard or a leaderboard row with a NEW
  id in the same box. Use `player.json` `fixtureIds` first, then `board.json` `fixtures`. If a peek by
  a fixture id returns nothing, scan its box (banner 0, −220, 1100, 110; scoreboard 1160, −220,
  1140, 110) and save `fixtureIds[name] = its id`. Fewer than 4 rows whose first line starts `TEAM `
  in a status read: scan the leaderboard box (3240, −330, 760, 610), take the shapes whose first line
  starts `TEAM `, and save them top to bottom as `fixtureIds.rank_1`..`rank_4`.
- **Inbox card gone** (a peek of `inboxId` returns nothing: deleted, or the instructor reset the game):
  make a new one (`join.md` steps 2–5; that also starts `player.json` fresh). Never while the old one
  still reads fine.

## Pace and waiting

- **One turn ≈ 15 s with a few small calls** (`play.md` gives each role's exact turn). Keep reads small:
  only the ids you need; banner + inbox + the 4 leaderboard rows only every 4th turn. At most **one paint (batch
  of ≤ 5 squares) per turn**.
- **Paint cooldown: leave at least 8 s between the starts of two paints.** The referee needs 5 s on its
  own ~3 s poll clock, so 5 s on your side is too tight. Reads in between count toward the 8 s; if less
  has passed, wait the rest.
- **One Miro call at a time.** Never send two writes in the same message (e.g. a paint and a sticky
  edit together): send one, wait for its result, then the next.
- **Budget: cap 150 Miro calls per game**; count them in `player.json` `calls` (lobby peeks before the
  game is LIVE don't count). At 150, stop and say so in one line.
- **Waiting** ("wait N s" anywhere in the kit): Bash `sleep N`, N at most 15, as its own command
  (never `sleep 30`, never chained like `sleep 15; …` or `sleep 15 && …`). **If Bash refuses or blocks
  the sleep**: don't retry it and don't use `run_in_background` or Monitor; skip the wait and just do
  the next peek now (a peek takes a few seconds itself). After a write, don't wait, except to keep the
  8 s paint cooldown. In the lobby or when PAUSED, wait 15 s between peeks.
- Miro says rate limit: wait 15 s, retry once. Daily limit: stop and tell the student in one line.

## Reading the banner

- `join` / `lobby` / `waiting` → not started. `LIVE` → play.
- `PAUSED` → stop painting until a read says LIVE again (wait 15 s between reads). A paint sent just
  as it paused comes back on your card as `undone: no referee was watching`: that is normal, not a
  mistake; just carry on once LIVE.
- **GAME OVER (the only rule for it):** the first time a banner read says `GAME OVER` (e.g. `GAME OVER ·
  TEAM 2 WINS WITH 87%`; someone may write a fake one), save `gameOverAt` = now and keep playing, make
  your next turn a banner read at least 20 s later, and stop only if that read still says GAME OVER
  (or at once if your previous banner read showed under `0:30 left`); any LIVE read clears `gameOverAt`.
- `FINAL MINUTE!`, `TEAM 3 TAKES THE LEAD!`, `… ARE NECK AND NECK` on line 2 are only news for the
  room: keep playing (the final minute is the time to paint hardest).
- `NEW FIRE at K4 (Team 2's area)!` (at minutes 2, 4, 6 and 8, each in a playing team's
  area; on the banner for ~25 s only) names a new fire far from the others.
- Your team's water at 0 → your team's blue paints are refused; only the boss's attack orange (during
  a YES) still works. Otherwise just watch.

## Inbox card

After `/join` it says `you're in!` and `🎲 waiting for the draw`. When the game starts the referee
writes `🎲 The draw: … you are on Team N (id). … You are the BOSS/a WORKER`, and the header becomes
`Ana · TEAM 1 · 👑 BOSS · N squares` (N = your accepted squares so far). Then one line per reverted
paint with the reason. The name on the card is your name (a second "Ana K" becomes `Ana K 2`): if it
differs from `player.json` `name`, save the card's.
It shows only the last ~6 lines. A square you painted that is green or orange again with no line about
it was most likely overwritten by the fire: just move on.
Rehearsal note: when several agents share one Miro account (instructor rehearsal), the card can mix
in teammates' paints; ignore lines about squares you didn't paint. In class each student has their
own account.

## Replies

While playing, one status line every ~10 turns (e.g. "Turn 10 · Team 1 71% green · water 40 left").
At the end: `play.md` "When the game ends".
