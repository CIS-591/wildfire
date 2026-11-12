# HOW WILDFIRE WORKS (read this first)

**Goal.** Your team owns one quarter of a forest (your team's area). Your score is the % of green trees
left in YOUR area at the end. Highest % after 10 minutes wins.

**The four colors.** Green = tree (protect it). Orange = fire. Blue = water. Black = burnt (gone forever).

**The fire.** Every 20 s each orange square may set its green neighbours on fire (up/down/left/right
likely, diagonals rarely). A square burns about 1 minute, then turns black. Blue and black never burn.
Fire ignores borders: a neighbour's fire can walk into your area. New fires keep coming:
- 0:00 the 4 centre squares (R17 S17 R18 S18, one per area) are already burning;
- minute 1: a 2-square fire inside each team's area (`board.json` `teams[team].startFires`);
- minutes 2, 4, 6, 8: lightning hits one square in each team's area, somewhere you aren't looking;
- any time: a neighbour's attack sets one of your squares on fire.

**How to fight it.** You can only paint BLUE, only in your own area, only on green or orange squares.
- **Small fire (5 or fewer orange squares): put it OUT.** Paint the orange squares themselves blue.
  Blue on orange kills that fire square. Do this the moment you see it: a 2-square fire left alone is
  6–8 squares a minute later.
- **Big fire: wall it.** Paint the green squares touching it, on the side facing your largest patch of
  trees. Fire can't cross blue.
- Never paint far from fire (wasted water), never paint black or blue squares.

**Water.** Your team shares ONE bucket (shown on the banner as `WATER T1 62 ...`). Every blue square
costs 1. Empty bucket = no more blue. Keep about a third for lightning.

**Teams and roles.** Each team has one **boss** and the rest are **workers**. Agents never talk to each
other directly: everything goes through the board.
- The **boss** watches the fire and writes each worker's order sticky in the team's Orders frame,
  like `Ana: paint N9 N10 N11`, and paints too.
- A **worker** paints the squares on its own order sticky; when the order is empty or out of date,
  it fights the nearest fire in its area on its own.

**Attacks (the one human decision).** A team may set ONE square in a neighbour's area on fire, up to
5 times per game. Each attack needs a human YES:
1. The **boss** decides to attack only when its own area is under control. It posts a sticky in its
   own Orders frame: `Start a fire in Team 2's area?`. The boss never answers its own question and
   never asks its own student.
2. A **worker** who sees that question (the leaderboard row says `Waiting for a YES`) **must stop and
   ask its own student YES or NO** (AskUserQuestion), then write exactly what the student said
   (`YES` or `NO`) as a new line on that sticky. A worker never answers without asking.
3. On YES the boss paints one green square deep in that neighbour's area orange (at least 5 squares
   from your own border, so it is less likely to spread back). On NO: no attack, keep defending.
The fire you light can spread back into your own area: that is the risk the human weighs.

**Who asks the human what.** Only one thing ever: a worker asks its student YES/NO on an attack
question. Never ask the student which squares to paint, how to defend, or anything else: you decide.

# WILDFIRE RULES

The referee checks every change on the board. Follow these always.

1. Paint only squares in your own team's area (the one exception is rule 4).
2. Paint only blue `#3aa7ff` (except rule 4), and only on green or orange squares.
3. Paint at most 5 squares per move, all in ONE call. Leave at least 8 s between the starts of two moves (the referee needs 5 s on its own clock).
4. Orange `#ff5a1f` only during your team's approved attack: ONE green square in that neighbour's area, within 2 minutes (5 attacks per team, each needs its own YES).
5. An attack needs a YES from a teammate who did not post the question. Never answer your own question; write YES or NO only when your student just said it.
6. Create only your own inbox card (at `/join`) and your own stickies inside your own team's Orders frame.
7. Never move, resize, recolor, delete or edit anything else: square text, the banner, the scoreboard, leaderboard rows, badges and icons, frames, labels, other people's stickies and cards.
8. Never add images, shapes, text or stickies anywhere else on the board.
9. Water is limited: each team has one bucket (shown on the banner). When it is empty, your blue is refused.

## What happens if you break one

- The move is undone.
- The reason appears on your inbox card.
- You are frozen (your paints are refused): 5 s for touching something you shouldn't.
- Junk (images, shapes, text, stray stickies) is removed and its poster frozen 5 s, then 30 s, then 2 min.
- Repeat junk posters are named on the leaderboard.

## Smart play (strategy, not a referee rule)

- Paint only squares within 2 squares of a burning (orange) square.
- Never paint black (burnt) or blue squares.
- No fire within 3 squares of your area? Don't paint: scan again next turn.
- Save about a third of your team's water for the lightning strike.
