---
description: Ask the human YES or NO on your team's pending PLAN / BACKBURN / HELP stickies
---

# Approve

The human decides; you only explain and write down the answer. Never write YES or NO without asking.
Run this in a second terminal while `/play` runs in the first.

1. Read `board.json` and `player.json` (no `team` yet → tell the student to `/join` first and stop).
   Orders frame id: `board.json` `orders[team].id`, else `player.json` `ordersId`, else scan the box
   `board.json` `orders[team]` once and save the frame's `data-miro-id` as `ordersId`.
2. **Read your Orders frame** in one call (`canvas_read_as_svg`, `widget_ids: [ordersId]`) plus the
   banner (same call) for the fire and wind.
3. **Pending** = stickies in your frame whose first line starts with `PLAN`, `BACKBURN` or `HELP`, that
   have no line that is exactly `YES` or `NO`, and whose id is **not** anywhere in `player.json` `stickies` (you
   can't approve your own; if the student posted it, say so and skip it). None pending: say "Nothing
   to approve for <team>." and stop.
4. For each pending sticky, oldest slot first (PLAN, then BACKBURN, then HELP):
   - Explain it in **one line** with what it costs and what waiting costs. Examples:
     - `PLAN`: "Your boss's plan: ring both cabins with firebreak, then a line on row 14. Until someone
       says YES, nobody on Ridge can paint."
     - `BACKBURN K9-P9`: "Burn 6 forest squares on row 9 to starve the fire 3 squares south of them.
       You lose 6 trees for sure to save the ~40 behind them."
     - `HELP Cedar Creek`: "Cedar Creek is losing and asks for 2 of your painters for 3 minutes. Your
       sector is at 82%: you can afford it, and they may return the favour."
   - Ask the human with **AskUserQuestion**: question "Approve <first line>?", options
     `YES` (approve) and `NO` (reject). Ask about one sticky at a time.
   - **Re-read that one sticky** (`widget_ids: [its id]`): teammates run /approve at the same time
     and the boss may have edited it. Now has a `YES`/`NO` line: say "Already answered by a teammate."
     and skip it. Text changed: show the new first lines and ask once more.
   - Write the answer at once (one `canvas_update_from_svg`): copy the sticky's `data-content`
     exactly as you just **re-read** it and append `&lt;br&gt;YES` or `&lt;br&gt;NO`:
     `<svg xmlns="http://www.w3.org/2000/svg"><rect data-miro-id="ID" data-type="sticky" data-content="…current text…&lt;br&gt;YES"/></svg>`
     Change nothing else on the sticky.
5. Finish with one line: what was approved and rejected, e.g. "Approved PLAN; rejected BACKBURN K9-P9."
   Then: "Run /approve again when your boss posts something new."
