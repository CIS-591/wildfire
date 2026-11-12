---
description: Fight the wildfire with your team until the banner says GAME OVER
---

# Play

Play on your own until the banner says GAME OVER. Don't stop to ask the student anything, except the
one spray question (worker step 2). `CLAUDE.md` has the rules, colors, sticky texts and the only Miro
call patterns you may use.

**Every turn: at most 3 Miro calls, about 20–40 s, at most one paint.** Wait only with a separate
`sleep 15` (or less) command: never longer, never chained with anything.

## Setup (1 to 2 Miro calls)

1. Read `board.json` and `player.json`. No `inboxId`, `team` or `role` yet? Follow
   `.claude/commands/join.md` first. Let `T = board.json.teams[team]` (area box `sector`, `startScan`,
   `firstFire`, neighbours), `ordersId = board.json.orders[team].id` (save it in `player.json`) and
   `cells = board.json.cells` (label → square id).
2. **Peek** banner + your inbox card (one call, `widget_ids: [fixtures.banner.id, inboxId]`).
   - not started / PAUSED: `sleep 15` (its own command), peek again; at most 60 times (lobby peeks
     don't count toward the budget). Then tell the student "The game hasn't started yet; type /play
     when your instructor says go." and stop.
   - GAME OVER: say the result and stop.
   - LIVE: go. Note the **wind** (downwind direction) and **water left**.
3. Go to the BOSS loop or the WORKER loop for your `role`.

### What to paint (both roles)

- Good targets, best first: a **green square next to fire** on the downwind side (the edge: fire can't
  take it once it is blue); any green square next to fire; an **orange square that touches green**.
  Never paint black, blue, or orange boxed in by black/blue (it burns out by itself).
- A square can change every ~25 s. **Paint only a square whose fill you read in this same turn**
  (peek or scan immediately before the paint, nothing in between). If it is no longer green/orange,
  pick another from the same read; none left: no paint this turn.
- Distance between squares = max(|Δcol|, |Δrow|). Downwind step: wind toward E = col + 1,
  W = col − 1, S = row + 1, N = row − 1, NE = col + 1 & row − 1, etc.

### Finding the fire with small reads

- Never scan more than 6 × 6 squares (384 × 384). A whole-area scan breaks the MCP output limit.
- First look: scan `T.startScan` (the 6 × 6 box at your inner corner, where the fire starts).
- After that: keep `player.json` `fire` = the burning labels you saw last. Scan a 6 × 6 box around the
  burning square that is deepest into your area, or downwind-most (x = (colIndex − 2) × 64,
  y = (row − 3) × 64, w = h = 384, clipped to the grid). Rotate between a few such boxes so you follow
  the whole edge. To check a handful of known squares, **peek them by id** from `cells` instead.
- Lightning on the banner (`⚡ LIGHTNING struck K4`): if it is in your area or within 3 squares of it,
  scan the 6 × 6 box around it once.

## BOSS loop (one turn ≈ 20–40 s, ≤ 3 Miro calls: look, write if needed, paint)

You are the orchestrator: you fill in your workers' order stickies, and you **paint every turn too**.
Ids of questions you posted live in `player.json` `stickies.questions`.

1. **Look** (one call). Alternate:
   - Odd turns: **scan** one 6 × 6 box on the fire edge (see "Finding the fire").
   - Even turns: **peek** banner + inbox card + your Orders frame (`widget_ids: [bannerId, inboxId,
     ordersId]`) + the ids of 3–6 squares you plan to order or paint (from `cells`). The frame shows
     your workers' order stickies (`<name>: paint …`) and any answer on your question.
   Banner says GAME OVER → go to "When the game ends".
2. **Think** (no calls): the edge = green squares in your area touching fire, downwind side first.
3. **Fill in orders** (one call, only when something changed; all changed stickies in one
   `canvas_update_from_svg`).
   - Your workers = the names on the `<name>: paint …` stickies in your frame (each worker creates its
     own). Edit a worker's sticky to `Ana: paint N9 N10 N11 N12`: 3–6 edge labels in paint order.
     Never create order stickies yourself, never post a second one for a worker.
   - Give different workers different stretches of the edge (start at opposite ends).
   - An order whose labels are all blue/black now is stale: replace them with new edge labels.
4. **Paint** one square (one call) from what you read in step 1 of this turn: the best target not on
   any worker's order. (On a scan turn the scan is your fresh read; on a peek turn, the squares you
   peeked.)
5. **The spray question: the one human decision** (only when it matters; it takes the place of
   step 3's write that turn):
   - Ask it when you see fire **in a neighbour's area within 2 squares of your border** that will reach
     you (downwind points at you, or it touches your border squares). Create
     `Spray water in Team 2's area?&lt;br&gt;Their fire at S10 is about to reach us.` (the
     neighbour's display name from `board.json` `teams[id].name`, e.g. Team 1's neighbours are
     Team 2 and Team 3) in the first free `question` position, color `red`, add the id to
     `stickies.questions`, and tell your student: "I asked my team whether we can spray water in Team 2's
     area."
   - One unanswered question at a time. **Never edit it after posting and never answer it yourself.**
     A `NO` is final for that sticky; ask again later with a NEW sticky only if the fire got closer.
   - When your frame read shows a `YES` line on it for the first time: save `sprayYes[id] = now`.
     For the next 100 s, give 1–2 workers orders on green squares next to the fire in that
     neighbour's area, right along your border, and paint there yourself. After 100 s, switch back.
6. `sleep 15` only if the turn took under 20 s. One status line every ~10 turns. Stop at **400 Miro
   calls** or a daily-limit error, and say so in one line.

## WORKER loop (one turn ≈ 20–40 s, 2 Miro calls: peek, paint)

You follow your order. `myOrderId` lives in `player.json`.

### First turn only (1 extra call)

Read your Orders frame (`widget_ids: [ordersId]`). Find the sticky whose first line starts with
`<your name>:` (first name, any case) and save its id as `myOrderId`. None: create it, `<your name>:
paint` (color `yellow`), in an `order` position: start at index (number of letters in your name) mod
20 (count them yourself, no tools) and take the first free one from there, wrapping around. That
sticky is how your boss learns you exist; the boss adds the squares to it.

### Every turn

1. **Peek** (one call): banner, your inbox card, your Orders frame (`ordersId`: it shows your order
   and any question), **and the squares on your order** (ids from `cells`). This peek is your fresh
   read: paint right after it.
   - GAME OVER → leave the loop. PAUSED → `sleep 15`, next turn.
   - New lines on your inbox card: a reverted paint says why; don't repeat it (cooldown → wait;
     wrong area → skip that label; square changed → that's normal, pick another).
2. **A question for your student?** A sticky in your frame whose first line is
   `Spray water in <team>'s area?` (any case; `<team>` may be `Team 2`, `team2`, `T2`, or an old name
   like `Pine Valley`; it names a neighbour: Team 1↔2, 1↔3, 2↔4, 3↔4), that has no line `YES` or `NO`,
   and that you did not post: **stop
   and ask your student** with AskUserQuestion, one plain sentence, e.g. "Your boss wants to spray
   water in Team 2's area to stop their fire reaching you. It uses shared water. Allow it?"
   (use its reason line if it has one), options `YES` and `NO`. Then re-read that one sticky
   (`widget_ids: [its id]`): already has a `YES`/`NO` line → a teammate answered first, skip.
   Otherwise write the answer (one `canvas_update_from_svg`): its text exactly as just re-read, every
   `&lt;br /&gt;` turned into `&lt;br&gt;`, plus `&lt;br&gt;YES` or `&lt;br&gt;NO`. Change nothing else.
   Tell the student in one line what you wrote, then carry on (skip this turn's paint: your peek is old).
3. **Choose one square**: the first label after `paint` on your order whose fill is green or orange
   **right now** (in this peek). Skip blue and black.
   **No squares on your order yet, or every one is already blue/black (stale)**: paint blue on the
   **green square nearest the fire in your area**. To find it, use this turn's look as a **scan**
   instead of the peek: the 6 × 6 box around the fire you last saw (`player.json` `fire`), or
   `T.startScan` if you have seen none; save the burning labels to `fire`, and pick from that scan.
   (Read the frame again on the next turn's peek, so you see questions and new orders.)
4. **Paint** it (one `canvas_update_from_svg`, id + fill `#3aa7ff` only). One paint per turn.
5. `sleep 15` only if the turn took under 20 s. One status line every ~10 turns. Stop at **400 Miro
   calls** or a daily-limit error, and say so in one line.

## When the game ends

Leave the loop as soon as the banner says GAME OVER. Read the scoreboard once and tell the student in
two lines: your team's final % (and the winner), and how many of your paints stuck. Then "GG!".
