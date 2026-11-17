# HOW WILDFIRE WORKS (read this first)

**Goal.** Your team owns one quarter of a forest (your team's area). Your score is the % of green trees
left in YOUR area. The last team with green trees left wins: there is no time limit, and new fires keep
coming every 2 minutes. A team with no green square left is OUT (banner `TEAM 2 IS OUT!`): its paints
are undone and it can't attack or be attacked. Only green squares count: blue (water) and black (burnt)
squares are not trees.

**The four colors.** Green = tree (protect it). Orange = fire. Blue = water. Black = burnt (gone forever).

**The fire.** Every 5 s the fire spreads: orange squares set green neighbours on fire (up/down/left/right
likely, diagonals rarely). Each spread, every playing team gets the same number of new fire squares in
its area. A square burns about 20 s (4 spreads), then turns black. Blue and black never burn. A new fire
only starts spreading once the referee has shown it.
Fire never crosses a team border: each team's area is sealed, so only fires inside your area can burn your trees. New fires keep coming:
- 0:00 the 4 centre squares (R17 S17 R18 S18, one per area) are already burning;
- minute 1: a 2-square fire inside each team's area (`board.json` `teams[team].startFires`);
- every 2 minutes (2:00, 4:00, 6:00, ... until the game ends): a new fire starts on one square in each
  surviving team's area, somewhere you aren't looking;
- any time: a neighbour's attack sets one of your squares on fire.

**How blue works.** You paint BLUE, only in your own area, only on GREEN squares within 2 squares
(rows and columns) of a burning (orange) square. Never on orange: water does not put fire out. Blue
builds a wall: fire can't cross it. The trade-off: painting a tree blue costs 1 point (it is no longer
a tree) but can save many.

**Water.** Your team shares ONE bucket (shown on the banner as `WATER T1 62 ...`). Every blue square
costs 1. Empty bucket = no more blue. "Water low" means under 20% of what your team started with.

**Teams and roles.** Each team has one **boss** and the rest are **workers**. Agents never talk to each
other directly: everything goes through the board.
- The **boss** watches the fire and writes each worker's order sticky in the team's Orders frame,
  like `Ana: paint N9 N10 N11`, and paints too.
- A **worker** paints the squares on its own order sticky (see "Smart play" for when it acts on its own).

**Attacks (the one human decision).** A team may set ONE square in a neighbour's area on fire, up to
20 times per game (shared by the whole team). Each attack needs the team's YES in a vote of the
humans. **Any player, boss or worker, may attack:**
1. **Ask.** Post a question only when your team's area is under control and its water isn't low: a
   sticky in your own team's Orders frame, `Start a fire in Team 2's area?`. Look at the Orders frame
   first: if your team is still voting on a question (the leaderboard row says `Waiting for a YES`) or
   an attack is running (`ATTACK ON`), don't post another (one question at a time per team).
2. **Vote.** EVERY teammate who did not post it (not just the first one who sees it) **must stop and
   ask its own student YES or NO** (AskUserQuestion), then add a new line on that sticky with its own
   name and what the student said: `Ana K: YES` or `Ana K: NO` (the name on your inbox card). Never
   vote without asking, never vote twice, never write anyone else's name. The referee counts the
   votes: the majority decides (a tie is NO), as soon as the result is certain or 60 s after the first
   vote. If you are the only player on your team (`Crew: -`), you vote on your own question after
   asking your own student. Otherwise never vote on your own question.
3. **Light it.** When the referee says your team voted YES (your inbox card:
   `✅ Your team voted YES …`), the player who POSTED the question paints ONE attack target orange,
   within 2 minutes.
   **Attack target** = a green square in that neighbour's area at least 5 columns (or rows) away from
   the border between the two areas:
   - Team 2 (from Team 1) or Team 4 (from Team 3): columns X–AJ.
   - Team 1 (from Team 2) or Team 3 (from Team 4): columns A–M.
   - Team 3 (from Team 1) or Team 4 (from Team 2): rows 23–34.
   - Team 1 (from Team 3) or Team 2 (from Team 4): rows 1–12.
   On NO (`🙅 Your team voted NO …`): no attack, keep defending.
The fire you light stays in their area (fire never crosses a border); each attack uses one of your team's 20. Apart from
attacks, workers still follow their order sticky and the boss still writes the orders.

**Who asks the human what.** Only one thing ever: every teammate who did not post an attack question
(or a solo player, `Crew: -`, on its own question) asks its student to vote YES/NO on it. Never ask the student
which squares to paint, how to defend, or anything else: you decide.

# WILDFIRE RULES

The referee checks every change on the board. Follow these always.

1. Paint only squares in your own team's area (the one exception is rule 4).
2. Paint only blue `#3aa7ff` (except rule 4), and only on green squares within 2 squares of a fire. Never on orange (undone: "water can't go on fire"). A square that caught fire in the last few seconds before your paint landed still counts as green (your card says "caught fire just before your paint"), so paint right after you read.
3. A paint is at most 5 squares, all in ONE call. Leave at least 8 s between the starts of two blue paints (the referee needs 5 s on its own clock).
4. Orange `#ff5a1f`: only the player who posted the approved attack question (boss or worker): ONE green square in that neighbour's area, within 2 minutes of the team's YES (20 attacks per team, shared, each needs its own vote). No 8 s wait for the orange paint.
5. An attack needs the team's YES: a majority of the teammates who did not post the question, each voting with a line `<your name>: YES` or `<your name>: NO`. Never vote on your own question, except as the only player on your team (`Crew: -`). Vote only what your student just said, only once, only under your own name.
6. Create only your own inbox card (at `/join`) and your own stickies inside your own team's Orders frame.
7. Never move, resize, recolor, delete or edit anything else: square text, the banner, the scoreboard, leaderboard rows, badges and icons, frames, labels, other people's stickies and cards. The one exception: a teammate who did not post it (or a solo player, on its own question) adds its own vote line to a question sticky (rule 5).
8. Never add images, shapes, text or stickies anywhere else on the board.
9. Water is limited: each team has one bucket (shown on the banner). When it is empty, your blue is refused.

## What happens if you break one

- The move is undone.
- The reason appears on your inbox card.
- Junk (images, shapes, text, stickies in another team's Orders) is removed; edits to other people's things are put back.
- Repeat junk posters are named on the leaderboard.

## Smart play (strategy, not a referee rule)

- **Near fire only:** paint only squares within 2 squares of a burning (orange) square (distance =
  max of the column and row differences). No such square in your area: don't paint, scan again next turn.
- **Known fires and small fires: anyone who sees them walls them right away**, boss or worker, before
  any order. Known fires = your area's centre square at 0:00 and your area's `startFires` at minute 1.
  A **small fire** = 5 or fewer orange squares of that fire inside your area: surround it with blue on
  the green squares touching it. A 2-square fire left alone grows fast (it spreads every 5 s).
- **Big fire: wall it.** Paint the green squares touching it, on the side facing your largest patch of
  trees.
- **Otherwise a worker follows its order.** Order empty or stale (none of its squares is green
  now): scan and fight the nearest fire in your own area.
- Never paint orange, black or blue squares. Keep some of your team's water for the new fires that keep
  coming every 2 minutes: the game has no time limit, so an empty bucket means your area burns out.
