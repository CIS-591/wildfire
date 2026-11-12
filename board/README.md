# Wildfire board

Live board: https://miro.com/app/board/uXjVEOlHHxs=/ ("CIS 591 · Wildfire", team 3458764689606790786).
All item ids are in `board.json`.

## What is where (top-left x, y in canvas units, as in SPEC.md section 1)

| Item | Where | board.json |
|---|---|---|
| Locked dark backdrop (sent to back, behind everything) | (-330, -440, 4410, 4320) | `static` (`restyle.added.backdrop`) |
| 1,224 squares A1..AJ34 (60x60, pitch 64, border #0e1311 width 2, label #0b1a10; `build/restyle_squares.mjs`) | 9 band frames (fill #0e1311), rows 1-4, 5-8, ..., 33-34 | `frames`, `cells` |
| Dark rim with column letters (top/bottom) and row numbers (left/right), team colored | around the grid, 72 wide | `static` |
| Team area labels "TEAM 1'S AREA" etc. (rotated, text in team color on #0e1311) + one 10 px team-colored edge per area (top for Teams 1-2, bottom for Teams 3-4) | left x -126..-74, right x 2374..2426; stripes y -84 and 2246 | `static` |
| Title "WILDFIRE" (Titan One 80) + subtitle | (0, -332) and (560, -295) | `static` |
| Wind rose (N/E/S/W) | left of the banner, centre (-100, -165), r 68 | `static` |
| Banner (fixture) | (0, -220, 1100, 110) | `fixtures.banner` |
| Scoreboard (fixture) | (1160, -220, 1140, 110) | `fixtures.scoreboard` |
| "HOW TO PLAY" panel: 4 color swatches (green/orange/blue/black) + 3 plain lines | (2440, -330, 760, 610) | `static` |
| Leaderboard panel, fixture inside | (3240, -330, 760, 610); fixture (3272, -254, 696, 502) | `fixtures.leaderboard` |
| ORDERS frames, 2x2 like the team areas: 64-high header ("ORDERS · TEAM N" in team color + one muted line, team-colored divider underneath), one EXAMPLE sticky each at slot (600, 726) | Team 1 / ridge (2440, 340), Team 2 / pine (3240, 340), Team 3 / cedar (2440, 1300), Team 4 / birch (3240, 1300), 760x900 | `orders`, `examples` |
| Inbox panel, heading "INBOX" + one hint line (cards start at y 2400) | (0, 2300, 4000, 1500) | `static` |

The Orders frames' own Miro titles are a single space: real titles rendered huge over the panels when zoomed out.
The header text inside each frame carries the name. Everything sticky-free sits above y 64 inside a frame, so it never
collides with the sticky slots (y 70+).

The example stickies start with `Example:` (never with "Spray water"), so no one mistakes one for a real question. They are listed in `static` (and `examples`) so the
referee never treats them as a real question.

## Palette ("night map")

Backdrop, band frames, square borders `#0e1311`; panels `#161d19` with `#25302a` borders; headings ember `#ff7a3d`; text `#f1efe9`, muted `#9aa39c`.
Team 1 violet `#a78bfa`, Team 2 rose `#f472b6`, Team 3 lemon `#fde047`, Team 4 frost `#e2e8f0`.
The backdrop is locked: unlock it in Miro (Cmd+Shift+L) before restyling it, then lock it again.
Screenshots: `screenshots/palette/`.

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
