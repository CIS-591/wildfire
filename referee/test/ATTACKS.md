# Attacks on the referee, and what it does

Every way a student, their Claude agent, or Miro itself can break or cheat Wildfire, and the referee's
answer. Each id has a test in `attacks.test.ts` (A110 in `stress.test.ts`); a test checks that no id
here is left without one. Run them with `npm test`.

**How the referee defends**: each tick it reads the board, compares it with its shadow copy, and
judges what changed (paints, tampering, joins, answers). Then it plans every write by comparing the
board with the engine and runs them by priority (fire, then reverts, then repairs, cards, junk) up to
`maxWritesPerTick` (120). Work that doesn't fit is planned again on the next tick. A failed write
is retried on the next tick, then backed off (2, 4 … 16 ticks). Three failures in a row mean the item is
locked: a new one goes on top. A tracked item has to be missing from two reads in a row before it is
rebuilt. `tick()` catches everything and never throws.

| Id | Attack | Expected referee behaviour |
| --- | --- | --- |
| A01 | Paint a square any non-blue color (orange, green, black, red, white, empty, alpha hex, a color name) | Undone (rule `color`), reason on the painter's card, no water used |
| A02 | Paint blue on a square that is already blue | No change seen, nothing charged, not counted |
| A03 | Paint blue on a burnt (black) square | Undone (rule `square`) |
| A04 | Paint blue in another team's area without a YES | Undone (rule `area`); card says whose area it is ("Team 2's area") |
| A05 | Paint blue in a neighbour's area with a YES that has expired, or in a team the YES didn't name | Counts only while the grant runs (2 min); afterwards, or in a team the YES didn't name, it is undone |
| A06 | Paint before LIVE (lobby) | Undone (rule `lobby`) |
| A07 | Paint (or tamper) after OVER | Undone (rule `over`); the referee keeps guarding after the game |
| A08 | Paint without having joined (no inbox card, a guest editor) | Undone (rule `unjoined`) |
| A09 | Paint faster than the 5 s cooldown | Undone (rule `cooldown`) |
| A10 | Many paints in one poll by one player (a script) | Judged in time order: the first counts, the rest are undone (cooldown) |
| A11 | Paint a blue square back to green or orange | Undone: it goes back to blue |
| A12 | "Put out" fire by painting it green | Undone (only blue counts) |
| A13 | Paint with the shared water at 0 | Undone (rule `water`) |
| A14 | A player of another team paints your area | Undone (rule `area`) for that player |
| A15 | Paint while frozen (after tampering) | Undone (rule `timeout`) |
| A16 | Paint while no referee is running (between a crash and the restart) | On the first look after the restart: undone, "no referee was watching" |
| A20 | Delete a square | Rebuilt on the second read (a partial page is not a delete), in its band frame, with the engine's color |
| A21 | Delete whole rows of squares | Rebuilt 20 per call, within the per-tick write cap |
| A22 | Move a square | Replaced (Miro refuses moves out of a frame); the mover is frozen 5 s |
| A23 | Drag a square out of its frame (anywhere on the canvas) | Replaced; the stray copy is deleted wherever it is |
| A24 | Resize a square | Replaced; resizer frozen |
| A25 | Rotate a square | Replaced; rotator frozen |
| A26 | Type over a square's label (other text, another label) | Replaced; editor frozen |
| A27 | Drop a fake copy of a square (same label) on the grid | The copy is deleted; the real square stays tracked |
| A28 | Paint a square, then lock it (the token can't write it) | After 3 refused writes a new square goes on top with the engine's color; the old one is deleted once unlocked (retried with backoff); logged. **Can't be prevented in Miro** |
| A30 | Delete a grid band frame (Miro deletes its 144 squares too) | Frame recreated, squares rebuilt into it over the next ticks within the write cap; the fast read path falls back to a full read meanwhile |
| A31 | Move a grid band frame | Moved back (its squares come with it); no square is replaced; mover frozen |
| A32 | Resize a grid band frame | Resized back |
| A33 | Delete an Orders frame | Recreated with its title; stickies in it are gone (Miro deletes them) but approvals already given are remembered |
| A34 | Move an Orders frame | Moved back |
| A35 | Draw a new frame over the forest (it can swallow squares) | The frame is deleted; any square it took is rebuilt |
| A40 | Delete the banner, scoreboard or leaderboard | Recreated with the live text on the second read |
| A41 | Edit the banner (or scoreboard/leaderboard) text | Rewritten; editor frozen |
| A42 | Move, resize or rotate a fixture | Put back |
| A43 | Lock a fixture | After 3 refused writes a new fixture goes on top; log asks the instructor to unlock the old one. Agents that read the banner by its saved id in `kit/board.json` keep reading the old one. **Can't be prevented in Miro** |
| A44 | Edit, move or delete a static panel (title, rules, headers, backdrop) | Edits and moves put back from the snapshot taken at start. A deleted static item is only logged: rebuilding it mid-game would put it on top and could cover the forest. Rebuild the board between games |
| A50 | Cover the grid with a giant shape or image (even one centred off the grid) | Deleted (anything new that overlaps the grid). Big items that were already there when the referee started are left alone, because they may be the board's own decoration |
| A51 | Drop stickies, texts, images, shapes, connectors on the grid | Deleted; the dropper frozen |
| A52 | Drop junk over the banner/scoreboard/leaderboard | Deleted |
| A53 | Lock the junk | Delete retried with backoff (at most ~1 call per 16 ticks), deleted once unlocked; the game goes on |
| A60 | Answer YES on your own question | No grant; creator told it needs a teammate |
| A61 | YES from another team | No grant |
| A62 | YES from someone who never joined | No grant |
| A63 | Edit a question after its YES (e.g. name another team) | The original grant runs out normally; the edit opens nothing new (answers are remembered per sticky) |
| A64 | NO, then a teammate adds YES | The latest teammate answer counts: approved. NO alone opens nothing |
| A65 | A question naming a non-neighbour, your own team, or gibberish | No grant; creator told to ask about a neighbour (told once per sticky) |
| A66 | Question sticky posted in another team's Orders frame | No grant; creator told to use their own Orders |
| A67 | 100 spam stickies | No crash; writes stay capped; each sticky gets at most one note |
| A68 | A giant sticky (100 KB, trailing spaces that would make a regex backtrack) | Only the first 2,000 characters / 20 lines are read: judged in milliseconds |
| A69 | Name the neighbour as "Team 2", "team2", "T2" or the old name | All parse to the same team |
| A70 | Emoji, HTML, entities, `<script>`, zero-width or control characters in a /join name | Tags, `<>`, control and zero-width characters stripped; emoji kept; escaped when written into cards and the leaderboard; the card is not rewritten in a loop |
| A71 | Empty name | "Player N" |
| A72 | Very long name | Cut to 24 characters (whole emoji, never half) |
| A73 | Two inbox cards from one user | The extra one deleted, with a note |
| A74 | Edit someone else's inbox card | Text rewritten; the editor frozen |
| A75 | Delete your own (or anyone's) inbox card mid-game | The player keeps team, role and paints. The referee recreates the card in the same slot; if the player makes a new card later, theirs replaces the copy. Agents that read the card by the id in `player.json` lose it until they /join again. **Deletes can't be attributed** |
| A76 | Join after LIVE | Joins the smallest team (as a worker unless that team is empty) |
| A77 | Join after OVER | Not added; card says the game is over |
| A78 | Two players with the same name | The later one gets a number ("Rita 2") so orders aren't ambiguous |
| A79 | Move your inbox card | Moved back to its slot |
| A80 | A team with 0 players | The game runs; leaderboard shows "boss -" |
| A81 | 40–100 players | All join; 72 cards fit the Inbox panel, more overlap a little but stay inside; writes stay capped |
| A90 | Miro 429s / outage on reads | Tick skipped (nothing judged or written); game time catches up at most 15 s per tick. The REST adapter retries 429s and never sleeps more than 20 s |
| A91 | Miro 5xx / timeouts on writes | Retried on later ticks until the board agrees with the engine |
| A92 | A listing that silently drops a page | Not treated as deletes (two missing reads needed): nothing rebuilt, nothing duplicated |
| A93 | A write that lands but reports an error | No double effect: the next read shows it landed and the plan drops it |
| A94 | An item deleted between our read and our write (404) | Write fails quietly; rebuilt after two missing reads |
| A95 | 30% of all calls failing for a whole game | Never throws; converges once Miro recovers |
| A96 | The referee killed and restarted mid-game | Resumes from `state/game.json`: same squares and cards (no rebuild), same scores, players and grants |
| A97 | `game.json` cut short by a kill mid-write | Saves are atomic (temp file + rename). A bad file falls back to `game.json.bak`, then to a fresh game; the referee never crashes on its own save |
| A98 | Two referees started at once | The lock file is created atomically: the second refuses to start. A dead referee's lock is taken over |
| A99 | Clock skew: `modifiedAt` in the future or far past | A future timestamp counts as "just after the previous read", so it never locks a player out of the cooldown; old ones are judged in order. Missing or NaN timestamps count as now |
| A100 | All fire out before the lightning | The game keeps going until the lightning strikes, then ends "fire out" when that fire is gone (or at 10 min) |
| A101 | The fast per-frame read hits a deleted frame (404) | That tick reads the whole board instead, which also repairs the frame |
| A102 | A script repaints 600 squares at once | Writes capped per tick (fire changes first); all undone within a few ticks |
| A103 | Malformed items from Miro (no text, NaN coordinates, unknown types) | Ignored or removed; the tick goes on |
| A104 | The members API is down while a preset team is looked up | The player still joins (balanced team) |
| A110 | Stress: 10-minute game, 30 bots, 6 vandals attacking every 4–12 s, a flaky Miro (≈6% of calls fail) | Never throws; every accepted paint is legal (blue, honest player, live, own area or granted, cooldown kept); vandals score nothing; water used = accepted paints; at most 120 writes per tick; after the game the board matches the engine exactly |

## What Miro cannot prevent (the referee survives it instead)

- **Every student is a Miro editor**, so any of the above can happen. The referee repairs; it can't
  forbid. A repair lands one or two polls (3–6 s) after the damage. The real fix is in REFLECTION.md
  (students view-only, moves through a game server).
- **Locks** (A28, A43, A53): the token can't change or delete a locked item. The referee puts a new item
  on top, logs which id to unlock, and keeps trying to delete the old one with backoff.
- **Deletes can't be attributed** (A20, A40, A75, A30, A33): Miro doesn't record who deleted an item,
  so nobody is frozen for a delete; the item is rebuilt.
- **New ids**: a rebuilt square, fixture or card gets a new Miro id. Agents that cached ids (the
  banner in `kit/board.json`, a card in `player.json`) need to find it again by position.
- **Stickies inside a deleted Orders frame are gone.** Approvals already given stay remembered.
- **Race with a player's paint**: if a player paints a square in the second between the referee's read
  and its write to that square (fire spread), the referee's write wins and the paint is lost without a
  note. The agent sees the new color and tries again.
- **Square border and label colors** aren't part of what the REST listing gives back, so restyling
  them is not detected. It's cosmetic only; fills, positions, sizes and labels are what count.
- **"Adopting" a YES**: if the asker writes YES on their own question and a teammate later edits the
  sticky for any reason, the last editor is that teammate, so it counts as their YES (A64 semantics).
