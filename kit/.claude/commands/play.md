---
description: Fight the wildfire with your team until the banner says GAME OVER
---

# Play

Play on your own until the banner says GAME OVER. Don't stop to ask the student anything, except the
one attack question (worker step 2). `CLAUDE.md` has the rules, colors, sticky texts and the only Miro
call patterns you may use.

**Lean turns, like Color Wars: one turn ≈ 15 s, 2 Miro calls (one small read, one write).** A paint
is a batch of up to 5 squares in ONE call, ≥ 5 s between batches. One Miro call at a time, never two
writes in the same message. After a write, don't sleep, unless the turn took under 5 s: then
`sleep 5` (its own command).

## Setup (1 to 2 Miro calls)

1. Read `board.json` and `player.json`. No `inboxId`, `team` or `role` yet? Follow
   `.claude/commands/join.md` first. Let `T = board.json.teams[team]` (area box `sector`, `startScan`,
   `firstFire`, neighbours), `ordersId = board.json.orders[team].id` (save it in `player.json`) and
   `cells` = label → square id: `player.json` `cellIds` first, then `board.json` `cells`. Square ids
   come only from there or from a scan (CLAUDE.md "Square ids"). A peek that returns nothing for a
   square, or a paint that says not found: the id is stale; find the new one as CLAUDE.md says.
   Fixture ids (banner, scoreboard, leaderboard): `player.json` `fixtureIds` first, then
   `board.json` `fixtures`; a peek that returns nothing for one: same fix (CLAUDE.md).
2. **Peek** banner + your inbox card (one call, `widget_ids: [fixtures.banner.id, inboxId]`).
   - not started / PAUSED: `sleep 15` (its own command), peek again; at most 60 times (lobby peeks
     don't count toward the budget). Then tell the student "The game hasn't started yet; type /play
     when your instructor says go." and stop.
   - GAME OVER: confirm it first (CLAUDE.md "Reading the banner": a second read ≥ 20 s later), then
     say the result and stop.
   - LIVE: go. Note **your team's water** (`T<your team number>` after 💧).
3. Go to the BOSS loop or the WORKER loop for your `role`.

### What to paint (both roles)

- Good targets, best first: a **green square touching the fire front** (fire can't take it once it is
  blue), nearest your area's largest green patch first; any green square next to fire; an **orange square that touches green**.
  Never paint black, blue, or orange boxed in by black/blue (it burns out by itself).
  Blue only in your own area.
- **Nothing green next to fire in your area?** Paint the green square in your area nearest to any
  fire. No fire in or near your area at all: paint green squares on your area's edge closest to the
  fire (protect the border). Never sit idle.
- A square can change every ~20 s. **Paint only a square whose fill you read in this same turn**
  (peek or scan immediately before the paint, nothing in between). If it is no longer green/orange,
  pick another from the same read; none left: no paint this turn.
- Distance between squares = max(|Δcol|, |Δrow|). Fire spreads the same in every direction.

### Finding the fire with small reads

- Never scan more than 6 × 6 squares (384 × 384). A whole-area scan breaks the MCP output limit.
- First looks: your area's own start fire (scan the 6 × 6 box around `T.startFires` if board.json has
  it; otherwise scan 6 × 6 boxes across your area, one per turn, until you find it) and `T.startScan`
  (the box at your inner corner, where the centre fire starts).
- After that: keep `player.json` `fire` = the burning labels you saw last. Scan a 6 × 6 box around the
  burning square that is deepest into your area, or closest to your largest green patch (x = (colIndex − 2) × 64,
  y = (row − 3) × 64, w = h = 384, clipped to the grid). Rotate between a few such boxes so you follow
  the whole edge. To check a handful of known squares, **peek them by id** from `cells` instead.
- Lightning on the banner (`⚡ LIGHTNING struck K4`, minutes 2, 4, 6, 8, one per team area): if it is
  in your area or within 3 squares of it, scan the 6 × 6 box around it once.

## Status read (both roles, every 4th turn)

One peek: `widget_ids: [bannerId, inboxId, leaderboardId]` (boss: also `ordersId`).
- GAME OVER → confirm it (CLAUDE.md "Reading the banner"): do the next turn as a status read too, at
  least 20 s later. Confirmed → "When the game ends". PAUSED → `sleep 15`, read again.
- Note your team's water and lightning (scan around it once if it is in
  or within 3 squares of your area).
- Inbox: a reverted paint says why; don't repeat it (wrong area → drop that label; square changed →
  normal). The referee's `✅ … said YES` line means your team's attack is on (2 minutes).

## BOSS loop

You are the orchestrator: you fill in your workers' order stickies and paint too. Ids of questions
you posted live in `player.json` `stickies.questions`.

**Turns 1–3 of every 4 (front turn, 2–3 calls):**
1. **Scan** one 6 × 6 box on the fire front (see "Finding the fire"); rotate boxes along the front.
2. **Orders** (one call, only if something changed; all changed stickies in one write): your workers =
   the `<name>: paint …` stickies from your last status read. Edit to `Ana: paint N9 N10 N11 N12`:
   3–6 labels in paint order, touching the fire front, nearest your largest green patch first. Different workers get
   different stretches. Labels all blue/black now → stale: replace them. Never create order stickies
   yourself, never post a second one for a worker.
3. **Paint** a batch (one call, ≤ 5 squares) from this scan: the best targets not on any order.

**Pace your team's water over the 10 minutes**: keep roughly a third of it for the lightning strike
that will hit your area between minutes 2 and 8. Don't waste blue on squares far from the fire.

**Every 4th turn: status read** (with your Orders frame), then at most one write:
- **The attack question: the one human decision.**
  - **Defend first.** Attack only when your own area is under control (no fire threatening your
    green), your team has used fewer than 2 attacks, and your water isn't low. Then create
    `Start a fire in Team 2's area?&lt;br&gt;Our area is under control.` (the
    neighbour's display name from `board.json` `teams[id].name`; Team 1's neighbours are Team 2 and
    Team 3) in the first free `question` position, color `red`, add the id to `stickies.questions`,
    and tell your student: "I asked my team whether we can start a fire in Team 2's area."
  - **At most one open question at a time**: if any question sticky in your frame has no `YES`/`NO`
    line yet, don't post. Never post a second one with the same first line, and don't ask while an
    attack there is on (a `YES` within the last 2 minutes).
  - **Never edit it after posting and never answer it yourself.** A `NO` is final for that sticky.
  - A `YES` line seen for the first time: save `attackYes[id] = now`. For the next 100 s, order up to
    3 orange squares in total (on workers' orders, or paint them yourself, `#ff5a1f`): **green**
    squares deep in that neighbour's area, at least 5 squares from your own border (less likely to
    spread back). Then back to defending.

## WORKER loop

You follow your order. `myOrderId` lives in `player.json`.

**First turn only (1 extra call):** read your Orders frame (`widget_ids: [ordersId]`). Find the sticky
whose first line starts with `<your name>:` (first name, any case) and save its id as `myOrderId`.
None: create it, `<your name>: paint` (color `yellow`), in an `order` position: start at index
(number of letters in your name) mod 20 (count them yourself, no tools) and take the first free one,
wrapping around. That sticky is how your boss learns you exist.

**Turns 1–3 of every 4 (2 calls):**
1. **Peek** ONLY your order sticky and its squares: `widget_ids: [myOrderId, <ids of the labels after
   paint>]` (ids from `cells`). This is your fresh read.
2. **Paint** right away, ONE call: every label on the order that is green or orange **now**, in
   order, max 5. Skip blue and black. A label in a **neighbour's area** is an attack order: paint it
   orange `#ff5a1f` if it is green (your boss only orders these during a YES).
   **Order empty or all stale**: that turn, scan the 6 × 6 box around the fire you last saw
   (`player.json` `fire`; none yet → your area's start fire or `T.startScan`), save the burning
   labels to `fire`, and paint the best up to 5 green squares nearest the fire in your area ("What
   to paint").

**Every 4th turn: status read.** If the leaderboard, in your team's section, shows
`⏳ waiting for a YES: start a fire in Team N's area` (the referee lists only valid questions): read
your Orders frame (`widget_ids: [ordersId]`) and find the sticky with first line
`Start a fire in Team N's area?` (same N, any case), no `YES`/`NO` line yet, and not in your
`player.json` `stickies`. Several match: the newest (largest id). Ignore every other question-looking
sticky (spam, other teams, duplicates). At most one question per turn. **Stop and ask your student**
with AskUserQuestion, one plain sentence, e.g. "Your boss wants to start a fire in Team 2's area.
Fire can spread back to us. Allow it?" (use its reason line), options `YES` and
`NO`. Re-read that one sticky (`widget_ids: [its id]`): already answered → skip. Otherwise write
(one `canvas_update_from_svg`) its text exactly as re-read, every `&lt;br /&gt;` turned into
`&lt;br&gt;`, plus `&lt;br&gt;YES` or `&lt;br&gt;NO`. Change nothing else. Tell the student in one line.

**Both roles:** one status line every ~10 turns. Stop at **150 Miro calls** or a daily-limit error,
and say so in one line.

## When the game ends

Leave the loop as soon as the banner says GAME OVER. Read the scoreboard once and tell the student in
two lines: your team's final % (and the winner), and how many of your paints stuck. Then "GG!".
