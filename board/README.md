# Wildfire board

Live board: https://miro.com/app/board/uXjVEOlHHxs=/ ("CIS 591 · Wildfire", team 3458764689606790786).
All item ids are in `board.json`.

## What is where (top-left x, y in canvas units, as in SPEC.md section 1)

| Item | Where | board.json |
|---|---|---|
| 1,224 squares A1..AJ34 (60x60, pitch 64, border = sector color, width 3) | 9 dark band frames, rows 1-4, 5-8, ..., 33-34 | `frames`, `cells` |
| Dark rim with column letters (top/bottom) and row numbers (left/right), team colored | around the grid, 72 wide | `static` |
| Title "WILDFIRE" + subtitle | (0, -330) | `static` |
| Wind rose (N/E/S/W) | left of the banner, centre (-90, -165) | `static` |
| Banner (fixture) | (0, -220, 1100, 110) | `fixtures.banner` |
| Scoreboard (fixture) | (1160, -220, 1140, 110) | `fixtures.scoreboard` |
| Rules + color legend + sector mini-map | (2440, -330, 760, 610) | `static` |
| Leaderboard panel, fixture inside | (3240, -330, 760, 610); fixture (3272, -254, 696, 502) | `fixtures.leaderboard` |
| ORDERS frames, 2x2 like the sectors, team-colored header band, one EXAMPLE sticky each | Ridge (2440, 340), Pine (3240, 340), Cedar (2440, 1300), Birch (3240, 1300), 760x900 | `orders`, `examples` |
| Inbox panel "INBOX · one card per player · read only your own" | (0, 2300, 4000, 1500) | `static` |

The example stickies start with `EXAMPLE ·` (never with a keyword), so no one can approve one as a PLAN. They are listed in `static` (and `examples`) so the
referee never treats them as a real PLAN.

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
