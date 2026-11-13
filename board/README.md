# Wildfire board

Live board: https://miro.com/app/board/uXjVEOlHHxs=/ ("CIS 591 · Wildfire", team 3458764689606790786).
All item ids are in `board.json`.

## What is where (top-left x, y in canvas units, as in SPEC.md section 1)

| Item | Where | board.json |
|---|---|---|
| Locked light backdrop #f5f6f8 (sent to back, behind everything) | (-330, -440, 4410, 4320) | `static` (`restyle.added.backdrop`) |
| 1,224 squares A1..AJ34 (60x60, pitch 64, border in the area's team color width 4, set by the referee; label #0b1a10; `build/restyle_squares.mjs`) | 9 band frames (fill #ffffff), rows 1-4, 5-8, ..., 33-34; an empty 64 gap (`GAP`) between columns R|S and rows 17|18 separates the four team areas: square top-left x = col*64 (+64 from S), y = row*64 (+64 from row 18) | `frames`, `cells` |
| Light rim (#eef0f3) with column letters (top/bottom) and row numbers (left/right), team colored | around the grid, 72 wide | `static` |
| Team area labels "TEAM 1'S AREA" etc. (rotated, text in team color on #f5f6f8) + one 10 px team-colored edge per area (top for Teams 1-2, bottom for Teams 3-4) | left x -126..-74, right x 2438..2490; stripes y -84 and 2310 (after the gap migration) | `static` |
| Title "WILDFIRE" (Titan One 80) + subtitle | (0, -332) and (560, -295) | `static` |
| Wind rose (N/E/S/W) | left of the banner, centre (-100, -165), r 68 | `static` |
| Banner (fixture) | (0, -220, 1100, 110) | `fixtures.banner` |
| Scoreboard (fixture) | (1160, -220, 1140, 110) | `fixtures.scoreboard` |
| "HOW TO PLAY" panel: 4 color swatches (green/orange/blue/black) + 3 plain lines | (2504, -330, 760, 610) | `static` |
| Leaderboard panel: 4 ranked rows (slot 1 = first place; 720x118 pills filled with the team's color, white text; rows reorder as teams overtake), all fixtures | panel (3304, -330, 760, 610); rows at x 3324, y -252, -124, 4, 132 | `fixtures.rank_1` ... `rank_4` |
| Score badges: white rounded 130x80 boxes inside each row's right end (`87%`, `-` for a team not playing), fixtures | right end of each row | `fixtures.rank_1_score` ... `rank_4_score` |
| Leaderboard icons: a medal per slot (gold, silver, bronze, 4th) + each team's mascot (Team 1 owl, Team 2 fox, Team 3 lion, Team 4 wolf). Microsoft Fluent Emoji 3D images, MIT licence. Placed and guarded by the referee: a moved icon is put back, a deleted one placed again | on the rows | not in board.json (referee state) |
| ORDERS frames, 2x2 like the team areas: 64-high header ("ORDERS · TEAM N" in team color + one muted line, team-colored divider underneath), one EXAMPLE sticky each at slot (600, 726) | Team 1 / ridge (2504, 340), Team 2 / pine (3304, 340), Team 3 / cedar (2504, 1300), Team 4 / birch (3304, 1300), 760x900 | `orders`, `examples` |
| Inbox panel, heading "INBOX" + one hint line (cards start at y 2400) | (0, 2364, 4064, 1500) | `static` |

The Orders frames' own Miro titles are a single space: real titles rendered huge over the panels when zoomed out.
The header text inside each frame carries the name. Everything sticky-free sits above y 64 inside a frame, so it never
collides with the sticky slots (y 70+).

The example stickies start with `Example:` (never with "Spray water"), so no one mistakes one for a real question. They are listed in `static` (and `examples`) so the
referee never treats them as a real question.

## Palette (light)

Backdrop `#f5f6f8`; band frames `#ffffff`; square borders in the team color (width 4); rim bars `#eef0f3`; panels and Orders frames `#ffffff` with `#e2e5ea` borders, Orders header bars `#f5f6f8`; headings ember `#e8590c`; text `#1f2328`, muted `#6b7280`.
Team 1 violet `#7c3aed`, Team 2 pink `#db2777`, Team 3 gold `#ca8a04`, Team 4 slate `#334155`. Fixtures are white (banner ember border), except the leaderboard rows: filled with the team's color (grey for a team not playing), white text. The MCP update resets the area labels' rotation: re-apply 270 (left) / 90 (right) via REST after touching them.
The backdrop is locked: unlock it in Miro (Cmd+Shift+L) before restyling it, then lock it again.
Screenshots: `screenshots/light/` (older dark theme: `screenshots/palette/`).

## Gap between the team areas (one-time migration)

The grid used to be one solid block. `referee/src/layout.ts` now leaves an empty `GAP` (64) between
columns R|S and rows 17|18, and everything right of the grid sits 64 further right, the inbox 64 lower.
`build/add_gap.mjs` moves the live board in place (PATCH only, ids unchanged), throttled to 500
requests/min with 429 retries:

    node board/build/add_gap.mjs --dry-run --offline   # counts from board.json, no network
    node board/build/add_gap.mjs --dry-run             # reads the board, prints what would move
    node board/build/add_gap.mjs                       # stop the referee first, then run (~3-4 min)
    python3 board/build/sync_ids.py

It is safe to rerun: frames and squares have absolute targets; every other item it moved is listed in
`build/add_gap.progress.json` (keep that file until the board is checked) and skipped next time.

## Rebuild

There is no REST builder for this board: it was built through the Miro MCP canvas tools.
`build/gen.py` writes the square SVG per band (`band0.txt` ... `band8.txt`, frame-relative), `build/scaffold.py`
writes the panels, rim, headers and frames. To rebuild on a fresh board:

1. `canvas_create_from_svg` with `scaffold.svg` minus the 140 header texts (creates the 9 band frames and panels),
   then `canvas_update_from_svg` with the header texts.
2. For each band: `canvas_update_from_svg` with
   `<g data-miro-id="FRAME_ID" data-frame="" transform="translate(-2, b*256-2)"><rect data-type="frame" .../> + bandN.txt</g>`.
   The `data-frame=""` matters: without it the squares land on the canvas, not in the frame.
3. Read the frames back (`canvas_read_as_svg` with 3 frame ids at a time; more than 500 items truncates), save the
   JSON results as `rf1..3.json` and run `build/verify.py` (it needs `cells.json` from `gen.py` and an `ids_scaffold.json` with the new `frames` list) (checks every label, position, frame, fill, border and font)
   to get `cells_ids.json`, then rewrite `board.json`.
4. `python3 board/build/sync_ids.py` copies the new ids into `kit/board.json` and `referee/config/layout.json`.
