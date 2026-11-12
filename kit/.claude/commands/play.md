---
description: Fight the wildfire as your team's boss or worker until the game is over
---

# Play

Play on your own until the banner says the game is over. Don't stop to ask the student anything.
`CLAUDE.md` has the rules, colors, sticky formats and the only Miro call patterns you may use.

## Setup (2 to 4 Miro calls)

1. Read `board.json` and `player.json`. No `inboxId`, `team` or `role` yet? Follow
   `.claude/commands/join.md` first. Let `T = board.json.teams[team]` (sector box, watch box,
   cabins, neighbours) and `O = board.json.orders[team]` (your Orders frame box).
2. **Peek** banner + your inbox card (one call, `widget_ids: [banner id, inboxId]`; banner id unknown:
   scan the banner box 0, −220, 1100, 110 once and save its id in `player.json` `bannerId`).
   - not started / PAUSED: **boss**: if you have no PLAN sticky yet, post it now (see "PLAN" below;
     the referee judges stickies in the lobby too). Then `sleep 20`, peek again (at most 45 times;
     lobby peeks don't count toward the call budget), then tell the student the game hasn't started
     and stop.
   - over (GAME OVER, WINS, FINAL, OVER): say the result and stop.
   - LIVE: go. Note the **wind** (downwind direction) and **water left**.
3. **Orders frame id**: `O.id`, or `player.json` `ordersId`, or scan the box `O` once and save the
   frame's `data-miro-id` as `ordersId`.
4. Go to the BOSS loop or the WORKER loop for your `role`.

### Geometry you need (also in `CLAUDE.md`)

- colIndex `A`=0 … `Z`=25, `AA`=26 … `AJ`=35. Square top-left **x = colIndex × 64, y = (row − 1) × 64**.
- A scan box around a square `L` with radius `k` squares: x = (colIndex − k) × 64, y = (row − 1 − k) × 64,
  w = h = (2k + 1) × 64, clipped to the grid (0, 0, 2304, 2176).
- Distance between squares = max(|Δcol|, |Δrow|) (fire also creeps diagonally).
- **Downwind** step: wind toward E = col + 1, W = col − 1, S = row + 1, N = row − 1, NE = col + 1 & row − 1, etc.
- **Finding fire near your sector**: scan your **watch box** `T.watch` (your sector plus the 3 squares
  of the neighbouring sectors that face it; the first fire starts in your inner corner) and collect
  every square with fill `#ff9d48`. The banner announces lightning (`⚡ LIGHTNING struck K4`): scan a
  radius-4 box around that square if it is in your watch box.
- Scans return each square's `data-miro-id`: keep the latest ids for peeks and paints (or use
  `board.json` `cells` when it is filled).

## BOSS loop (one turn about every 20 s, 3 to 5 Miro calls)

You are the orchestrator: you think, your workers paint. Your sticky ids live in `player.json`
`stickies` (`plan`, `backburn: [ids]`, `help: [ids]`, `orders: {name: id}`).

### PLAN: post it as early as you can (lobby or turn 1)

No team paint counts until a teammate approves the PLAN, and humans are slow. Create it in the `plan`
slot of your frame (one call), concrete and short, e.g.

`PLAN&lt;br&gt;1. Ring cabins E5 and M13 with firebreak.&lt;br&gt;2. Firebreak line 3 squares downwind of the fire, anchored on the river J.&lt;br&gt;3. Water only fire that touches trees. Backburn early if the wind turns.`

Tell the student in one line: "PLAN posted: ask a teammate to run /approve (or type YES on it in Miro)."

**PLAN got a NO** (its last answer line is `NO`): rewrite the same sticky (it is still open) with new
wording and no `YES`/`NO` lines, e.g. a smaller, safer plan, and tell the student: "PLAN revised after
a NO: ask a teammate to /approve again." Do this on the turn you see the NO.

### Every turn

1. **Look** (2 to 3 calls).
   - Peek: banner, your inbox card, scoreboard (one call).
   - Scan: your watch box on turn 1, every 6th turn and the turn after lightning; on other turns a
     radius-5 box (11 × 11) around the fire square closest to one of your cabins or your thickest
     stand of forest. From the big scan keep only a short list of fire labels in your notes.
   - Read your Orders frame (`widget_ids: [ordersId]`): PLAN/BACKBURN/HELP answers (a `NO` on the
     PLAN: revise it, see above), STATUS stickies (your crew), the ORDER stickies you own, and any
     HELP another team posted to you.
2. **Threat picture** (think, no calls). From the scan: the fire squares, the **front** (fire squares
   touching forest or a cabin in your sector), each cabin's distance to the nearest fire, the downwind
   direction, the squares the fire will reach in the next 2 spreads (40 s).
3. **Decide, in this order** (smart beats busy):
   1. **Cabins first** (10 points each). A cabin **on fire**: order `WATER <cabin>` at once (top
      priority: water turns a burning cabin back into a cabin, worth 10 while wet). Fire next to a
      cabin and its ring not done: water the cabin itself (wet squares can't ignite for 90 s). Any
      cabin within 4 squares of fire: order firebreak on the forest squares around it on the
      fire-facing and downwind sides (its 8 neighbours, nearest the fire first). Don't water a cabin
      that is not under threat.
   2. **Firebreak 2–3 squares ahead, downwind.** Draw a straight line across the fire's downwind path,
      perpendicular to the wind, 2–3 squares in front of the front. Anchor both ends on something that
      can't burn (river, firebreak, burnt, the sector edge) so the fire can't walk around it. Check you
      can finish in time: a worker paints about one square per 15 s and the fire moves about one square
      per 20–40 s downwind, so a line of L squares with W workers needs L × 15 / W seconds; if that is
      more than the fire's travel time, move the line one square further out or split it. If the
      wind is strong toward it, make the middle of the line 2 thick (embers jump a 1-wide break).
   3. **Water only fire that touches trees**, and only where it buys time: a gap in your line, the end
      of a line still being built, next to a cabin ring. Water lasts 90 s, then it is forest again; it
      delays, it doesn't stop. Never water fire boxed in by burnt, river or firebreak: it burns out on
      its own. The pool is shared by the whole class (banner shows what's left): below 100, water only
      next to cabins.
   4. **Ask for a BACKBURN early.** When fire is 3–5 squares from a stand your line can't cover in time,
      post a `BACKBURN` for a straight forest run between the fire and the stand (≤ 20 squares, all in
      your sector), now, because the human YES takes a minute or more. Each run is a **new** sticky
      in the next free `backburn` slot (4 per game; the referee never re-reads an approved one, so
      never edit an answered BACKBURN). One unanswered BACKBURN at a time; one that got `NO` you may
      rewrite in place (drop the NO line) if the run still makes sense. Once it shows a YES, order
      those squares as `BURNT …`, starting from the anchor end.
   5. **Ask for HELP when losing.** Your score below 60% and falling, or more front squares than you
      have workers: post `HELP <your team name>` in a **neighbouring** team's Orders frame (pick the
      neighbour with the best score on the scoreboard), in its first free `help` slot, with one line on
      where the fire is. One HELP at a time; it lasts 3 minutes once approved. To re-ask after that,
      post a **new** HELP sticky (an approved one is never read again); no free slot: skip HELP.
      Add each id to `stickies.help`.
   6. **Answer HELP you received.** A `HELP …` sticky in your frame with a YES line: the first time you
      see the YES, save `helpSeen[id] = now` in `player.json`. While now − `helpSeen[id]` < 150 s, give
      your 2 least busy workers ORDERs in the requesting team's sector (squares on their front, same
      formats). After that, switch them back and ignore that sticky.
4. **Write ORDERs** (one call: all changed stickies in one `canvas_update_from_svg`).
   - Your crew = names from `STATUS · <name>` stickies in your frame (and any roster on your card).
     Every worker gets **exactly one** `ORDER · <name>` sticky: edit it, never post a second.
     New worker: create theirs in the next free `order` slot.
   - Each ORDER: one color and 3–6 labels in the exact paint order, plus a `why:` line, e.g.
     `ORDER · Ana&lt;br&gt;FIREBREAK N9 N10 N11 N12&lt;br&gt;why: line ahead of fire, anchored on river J`.
     Drop labels already done; add the next ones. Split long lines between workers from both ends.
   - Before the PLAN is approved, still write ORDERs so workers start the moment it is.
   - Only update a sticky whose text actually changes.
5. **Paint** only if you have no workers yet **and** the PLAN has a YES line: one square, highest
   priority, like a worker.
6. `sleep` so each turn lasts about 20 s. One status line every 10 turns. Stop at **500 Miro calls**
   or a daily-limit error, and say so in one line.

## WORKER loop (one paint about every 15 s, 2 Miro calls per turn)

You are a worker: you follow your ORDER, you don't improvise. `myOrderId` and `stickies.status` live
in `player.json`.

### First turn only

1. Read your Orders frame (`widget_ids: [ordersId]`). Create your STATUS sticky in a `status` slot:
   start at index (number of letters in your name) mod 7 (count them yourself, no tools) and take the first free one
   from there, wrapping around. So teammates starting at the same moment don't pick the same slot:
   `STATUS · <your name>&lt;br&gt;ready`. This is how your boss learns you exist.
2. Find the sticky whose first line is `ORDER · <your name>` (match the first name, any case) and save
   its id as `myOrderId`. Note whether a `PLAN` sticky with a `YES` line exists.

### Every turn

1. **Peek** (one call): banner, your inbox card, `myOrderId`, and the squares on your order (their ids
   from your last scan or `board.json` `cells`). No ids for them yet: scan the smallest box that covers
   the order's labels instead, and keep those ids.
   - Game over → leave the loop. PAUSED → `sleep 20`, peek again.
   - New lines on your inbox card: read them. A reverted paint says why; never repeat the same
     mistake (no approved PLAN → wait; cooldown → wait longer; wrong sector → skip that label).
   - No approved PLAN yet (re-read the frame every 2nd turn until there is one): don't paint,
     `sleep 15`, next turn.
   - No `myOrderId` yet: re-read the frame every 2nd turn to find it.
2. **Choose one square**: the first label on your ORDER whose current fill still allows the change:
   `FIREBREAK` and `BURNT` need forest `#93d275`; `WATER` needs fire `#ff9d48` (or forest/cabin if the
   order says so). Skip labels already done or no longer valid.
   **No order, or all done**: water the burning square in your sector that touches forest and is
   closest to one of your cabins (scan a radius-5 box around the fire you last saw; on turn 1 around
   your team's `firstFire` square).
3. **Paint** it (one `canvas_update_from_svg`, id + fill only). One paint per turn.
4. Every 8 turns, edit your STATUS sticky: `STATUS · <name>&lt;br&gt;painted N9 N10 N11&lt;br&gt;fire at O12, line holding`
   (or what blocks you, e.g. "order done, need more").
5. `sleep` so each turn lasts about 15 s (never less than 6 s between paints). One status line every
   10 turns. Stop at **400 Miro calls** or a daily-limit error, and say so in one line.

## When the game ends

Leave the loop as soon as the banner says it is over. Read the scoreboard once and tell the student in
two lines: your team's final % (and the winner), and how many of your paints stuck. Then "GG!".
