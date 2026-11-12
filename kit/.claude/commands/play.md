---
description: Fight the wildfire with your team until the banner says GAME OVER
---

# Play

Play on your own until the banner says GAME OVER. Don't stop to ask the student anything, except the
one attack question (WORKER loop, "Every 4th turn"; a solo boss: BOSS loop, "Solo boss"). `AGENTS.md` has the rules; `CLAUDE.md` has the colors, sticky
texts and the only Miro call patterns you may use.

**Lean turns: one turn ≈ 15 s.** Worker turn = 2 Miro calls (one read, one paint). Boss front turn =
3 calls (scan, orders write, paint), plus 1 question peek first while a question is open; a solo boss
skips the orders write. A paint is a
batch of up to 5 squares in ONE call; leave at least 8 s between the starts of two paints (CLAUDE.md
"Pace and waiting"). One Miro call at a time, never two writes in the same message. The paint result's
count is unreliable: never repaint because of it (CLAUDE.md "Paint"). PAUSED: no paints until LIVE.

## Setup (1 to 2 Miro calls)

1. Read `board.json` and `player.json`. No `inboxId` yet? Follow `.claude/commands/join.md` first,
   then carry on here.
   No `team`/`role` yet is normal: teams are drawn when the game starts.
   `cells` = label → square id: `player.json` `cellIds` first, then `board.json` `cells`. Square ids
   come only from there or from a scan (CLAUDE.md "Square ids"). A peek that returns nothing for a
   square, or a paint that says not found: the id is stale; find the new one as CLAUDE.md says.
   Fixture ids (banner, scoreboard, leaderboard rows `rank_1`..`rank_4`): `player.json` `fixtureIds`
   first, then `board.json` `fixtures`; a peek that returns nothing for one: same fix (CLAUDE.md).
2. **Peek** banner + your inbox card (one call, `widget_ids: [fixtures.banner.id, inboxId]`). Your
   card not in the result: CLAUDE.md "Inbox card gone".
   - not started / PAUSED: wait 15 s (CLAUDE.md "Waiting"), peek again; at most 60 times (lobby peeks
     don't count toward the budget). Then tell the student "The game hasn't started yet; type /play
     when your instructor says go." and stop.
   - GAME OVER: CLAUDE.md "Reading the banner"; once confirmed, "When the game ends".
   - LIVE: go to step 3; once you know your team, save **your team's water** (`T<your team number>`
     after `WATER`) as `water0` in `player.json` if it isn't saved yet.
3. **Team and role from the inbox card** (in the same read): the `🎲 The draw: … you are on Team N
   (id). … You are the BOSS/a WORKER` line, or the header `Ana · TEAM 1 · 👑 BOSS` / `· WORKER ·`.
   Parse them as `join.md` step 4 says and save `team` and `role` to `player.json`. **The card wins**:
   if it says another team or role than `player.json`, overwrite. No team on the card yet (the
   referee rewrites every card at the start): wait 10 s, peek the inbox again, at most 8 times; still
   none: tell the student "My card has no team yet; tell your instructor." and stop. Tell the student
   in one line, once: "You are on Team N, the boss." (or "a worker"). A boss's card may say "a
   teammate must say YES": in a team of one (`Crew: -`) that teammate is you ("Solo boss").
4. Now let `T = board.json.teams[team]` (area box `sector`, `startScan`, `firstFire`, neighbours),
   `ordersId = board.json.orders[team].id` and `rankIds` = the ids of `rank_1`..`rank_4`
   (`fixtureIds` first); save `ordersId` in `player.json`.
5. Go to the BOSS loop or the WORKER loop for your `role`.

### What to paint (both roles)

Follow `AGENTS.md` "Smart play" (it decides known/small fire vs order vs your own scan). How:
- **Known fires**: at 0:00 your area's centre square (`R17` Team 1, `S17` Team 2, `R18` Team 3, `S18`
  Team 4); at minute 1 (banner `9:00 left`) your area's two `T.startFires` squares. Their ids are in
  `cells`: on those turns make your read a peek of them and their neighbours (or a scan) and paint
  the green squares touching the orange ones.
- **Small fire** (≤ 5 orange squares of it inside your area): surround it: paint the green squares
  touching it.
- **Big fire, wall it:** a green square touching the fire, nearest your area's largest green patch
  first. Never paint orange (water can't go on fire), black or blue.
- **Paint only a green square within 2 squares of fire, whose fill you read in this same turn** (the
  read immediately before the paint). No longer green: pick another from the same read; none left: no
  paint this turn.

### Finding the fire with small reads

- Never scan more than 6 × 6 squares (384 × 384). A whole-area scan breaks the MCP output limit.
- First looks: `T.startScan` (the box at your inner corner, where the centre fire starts). The fires
  inside each area start at minute 1 (banner `9:00 left` or less): only from then, also scan your
  area's own start fire (the 6 × 6 box around `T.startFires` if board.json has it; otherwise 6 × 6
  boxes across your area, one per turn, until you find it).
- After that: keep `player.json` `fire` = the burning labels you saw last. Scan a 6 × 6 box around the
  burning square that is deepest into your area, or closest to your largest green patch (x = (colIndex − 2) × 64,
  y = (row − 3) × 64, w = h = 384, clipped to the grid). Rotate between a few such boxes so you follow
  the whole edge. To check a handful of known squares, **peek them by id** from `cells` instead.
- A new fire on the banner (`NEW FIRE at K4 (Team 2's area)!`, minutes 2, 4, 6, 8): if it is
  in your area or within 2 squares of it, scan the 6 × 6 box around it once.

## Status read (both roles, every 4th turn)

One peek: `widget_ids: [bannerId, inboxId, ...rankIds]` (boss: also `ordersId`). **Your row** = the
leaderboard row whose first line starts `TEAM <your team number>` (rows swap slots, so always match
by text). Fewer than 4 `TEAM ` rows came back: CLAUDE.md "Stale fixture ids".
- GAME OVER → CLAUDE.md "Reading the banner"; confirmed → "When the game ends". PAUSED → no paints;
  wait 15 s, read again until LIVE.
- Note your team's water and any `NEW FIRE at` square (scan around it once if it is in or within 2 squares of your area).
- Inbox: a reverted paint says why; don't repeat it (wrong area → drop that label; square changed →
  normal).

## BOSS loop

You are the orchestrator: you fill in your workers' order stickies and paint too. Ids of questions
you posted live in `player.json` `stickies.questions`. A question is **open** while it has no `YES`/`NO`
line yet.

**Solo boss** = your row (status read) says `Crew: -`: you are the only player on your team (1-vs-1
games). Check it at every status read; it lasts until your row lists a crew name. A solo boss has no
workers: skip front-turn step 2 (no orders to fill) and answers its own question ("Solo boss" below).

**Turns 1–3 of every 4 (front turn, 3 calls; 4 while a question is open):**
0. **Only while a question is open: question peek first** (1 call): `widget_ids: [question id, 3
   attack targets]` (3 squares in the attack-target zone, `AGENTS.md` "Attacks" step 3, ids from
   `cells`; pick new ones if the last ones weren't green).
   - `YES` line: save `attackYes[id] = now` and, **in this same turn**, paint ONE of those 3 that is
     green in this read orange `#ff5a1f` (one square, one call). That is this turn's paint: skip
     steps 1–3 this turn. None green: pick 3 others and peek again next turn.
   - `NO` line: the question is closed (a NO is final); carry on with step 1.
   - No answer yet: carry on with step 1.
1. **Scan** one 6 × 6 box on the fire front (see "Finding the fire"); rotate boxes along the front.
2. **Orders (not for a solo boss), EVERY front turn, right after the scan** (one write with all changed stickies): your
   workers = the `<name>: paint …` stickies from your last status read (you remember what you wrote
   since). A worker's order is **stale** unless at least one of its labels is in THIS scan, green
   now, and within 2 squares of fire in this scan (labels outside this scan's box count as
   stale). Rewrite every stale order to `Ana: paint N9 N10 N11 N12` (keep the name before `:` exactly
   as the worker wrote it): 3–6 labels **in your own area, from this scan only**, in paint order,
   green within 2 of fire, touching the fire first, nearest your largest green patch first.
   Different workers get different stretches. Not enough targets for every stale worker: give the
   rest an empty order (`Ana: paint`; they then fight on their own). Never put an orange (attack)
   square on an order. Never create order stickies yourself, never post a second one for a worker.
3. **Paint** a batch (one call, ≤ 5 squares) from this scan: the best targets not on any order.

**Every 4th turn: status read** (with your Orders frame), then at most one write:
- **The attack question: the one human decision.**
  - **Defend first.** Post only when your own area is under control (no fire within 2 squares of your
    green), your team has used fewer than 5 attacks, and your water isn't low (at least 20% of
    `water0`). Then create `Start a fire in Team 2's area?&lt;br&gt;Our area is under control.` (the
    neighbour's display name from `board.json` `teams[id].name`; Team 1's neighbours are Team 2 and
    Team 3; only a neighbour that plays: its `T<n>` is in the banner's `WATER` list) in the first free
    `question` position, color `red`, add the id to `stickies.questions`,
    and tell your student: "I asked my team whether we can start a fire in Team 2's area."
  - **At most one open question at a time.** Never post a second one with the same first line, and
    don't ask while an attack there is on (a `YES` within the last 2 minutes).
  - **Never edit it after posting and never answer it yourself** (solo boss: see below). Only YES lines on a sticky in
    `stickies.questions` count; ignore YES lines on any other sticky.
  - **Your row's `ATTACK ON TEAM N: 1 fire left (m:ss)` line** = your attack is on and its square is
    not lit yet (e.g. your orange paint was undone): next front turn, peek 3 attack targets and paint
    one green one orange. `0 fires left` or no such line = no attack now: no orange.

**Solo boss: you answer your own question.** Post it as above (that is this status turn's write),
then on the very next turn, instead of a front turn: **ask your student** with AskUserQuestion, one
plain sentence, e.g. "I want to start a fire in Team 2's area. Fire can spread back to us. Allow it?",
options `YES` and `NO`. Re-read that one sticky (`widget_ids: [its id]`): already a `YES`/`NO` line →
write nothing. Otherwise write (one `canvas_update_from_svg`) its text exactly as re-read, every
`&lt;br /&gt;` turned into `&lt;br&gt;`, plus `&lt;br&gt;YES` or `&lt;br&gt;NO`. Tell the student in
one line. On YES: the next front turn's step 0 question peek sees it and paints the attack square
(same flow as above). On NO: keep defending.

## WORKER loop

You follow your order (unless `AGENTS.md` "Smart play" says a known or small fire comes first). Your
order sticky's id lives in `player.json` `stickies.order`. You never paint orange.

**First turn only (1 extra call):** read your Orders frame (`widget_ids: [ordersId]`). Find the sticky
whose first line starts with your `name` and `:` (any case; none: your first name and `:`) and save
its id as `stickies.order`.
None: create it, `<your name>: paint` (color `yellow`), in a FREE order slot. That sticky is how your
boss learns you exist. Pick the slot from this same read (it lists every sticky in the frame with its
x, y), never blindly:
- Order slots (`board.json` `stickySlots.order`, x, y relative to the frame), by index:
  0 (600,70) · 1 (24,234) · 2 (168,234) · 3 (312,234) · 4 (456,234) · 5 (600,234) · 6 (24,398) ·
  7 (168,398) · 8 (312,398) · 9 (456,398) · 10 (600,398) · 11 (24,562) · 12 (168,562) · 13 (312,562) ·
  14 (456,562) · 15 (600,562) · 16 (24,726) · 17 (168,726) · 18 (312,726) · 19 (456,726).
- Start index = (letters in your name, not counting spaces or dots) mod 20. Example: `Ana K` → 4
  letters → index 4 → (456,234).
- A slot is taken if any sticky in the read has x from slot x − 20 to slot x + 100 and y from slot
  y − 20 to slot y + 110 (relative to the frame). Taken: try the next index (19 → 0), until a free one.

**Turns 1–3 of every 4 (2 calls):**
1. **Read.** Normally peek ONLY your order sticky and its squares: `widget_ids: [stickies.order, <ids
   of the labels after paint>]` (ids from `cells`). Exceptions: a known-fire turn ("What to paint"),
   or the turn after an empty/stale order (step 2). Your sticky not in the result (deleted): redo
   "First turn only" next turn.
2. **Paint** right away, ONE call, max 5 squares, all blue:
   - **Known or small fire in this read** (orange squares in your area): paint the green squares
     touching it first.
   - Otherwise every label on the order that is in your area and green **now**, in order.
     Skip orange, blue, black, and any label outside your area.
   - **Order empty, or no label green now (stale)**: no paint from it. Next turn, make your
     read a scan of the 6 × 6 box around the fire you last saw (`player.json` `fire`; none yet →
     `T.startScan`, or from minute 1 your area's start fire), save the burning labels to `fire`, and
     paint the best up to 5 squares within 2 squares of fire in your area ("What to paint"). None:
     don't paint; the turn after, scan the next 6 × 6 box along the fire you last saw, toward your
     area's inner corner (`T.startScan`). Peek your order again the turn after a scan.

**Every 4th turn: status read.** If your row shows
`Waiting for a YES: start a fire in Team N's area` (the referee lists only valid questions): read
your Orders frame (`widget_ids: [ordersId]`) and find the sticky with first line
`Start a fire in Team N's area?` (same N, any case), no `YES`/`NO` line yet, and not in your
`stickies.questions`. Several match: the newest (largest id). Ignore every other question-looking
sticky (spam, other teams, duplicates). At most one question per turn. **Stop and ask your student**
with AskUserQuestion, one plain sentence, e.g. "Your boss wants to start a fire in Team 2's area.
Fire can spread back to us. Allow it?" (use its reason line), options `YES` and
`NO`. Then **re-read that one sticky itself** (`widget_ids: [its id]`; the leaderboard row can lag a
read behind): it already has a `YES` or `NO` line → skip, write nothing. Otherwise write
(one `canvas_update_from_svg`) its text exactly as re-read, every `&lt;br /&gt;` turned into
`&lt;br&gt;`, plus `&lt;br&gt;YES` or `&lt;br&gt;NO` (the one sticky edit `AGENTS.md` rule 7 allows).
Change nothing else. Tell the student in one line.

**Both roles:** one status line every ~10 turns. Stop at **150 Miro calls** or a daily-limit error,
and say so in one line.

## When the game ends

Leave the loop once GAME OVER is confirmed (CLAUDE.md "Reading the banner"). No extra read: the GAME
OVER banner names the winner and every team's %. Tell the student in two lines: (1) your team's final %
and the winner; (2) how many squares you got in (the `N squares` on your last inbox read) and "GG!".
