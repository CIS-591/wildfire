# Wildfire: slide outline (instructor, 6 slides)

1. **Wildfire.** A forest is on fire. Up to four teams, Team 1 to Team 4, each protect one corner: your
   team's area. Teams are drawn at random when the game starts. Your Claude paints water. Save your forest from the fire, or set fire to your neighbour's —
   and a human decides when to attack. Show the board on the projector: green forest, four orange squares in the middle.

2. **Four colors.** 🟩 green = tree, protect these. 🟧 orange = fire, spreads by itself. 🟦 blue =
   water, you paint it in your area, fire can't cross it; each team has its own bucket of water. ⬛ black = burnt, gone.
   Most green left in your team's area after 10 minutes wins. The leaderboard ranks the teams live,
   first place on top: % saved, water left, fires set, trees burned, MVP. Each square has a border in its team's color;
   a thicker one on fire shows which team lit it.

3. **What you do.** Type `/join Your Name`, then `/play`. Your Claude may ask you one YES/NO question:
   answer it. That's all.

4. **What the agents do.** One Claude per team is the boss: it finds the fire and writes notes like
   `Ana: paint N9 N10 N11`. The others read their note and paint. Nobody talks directly: everything
   goes through the board. A referee spreads the fire and undoes bad paints.

5. **The one question.** "Start a fire in Team 2's area?" The boss asks; a teammate's Claude asks
   its human. YES = set ONE square in the neighbour's area on fire (20 attacks per team, each needs a YES).
   The fire can spread back. Waiting for a human costs time.

6. **Discussion.**
   - What did the boss know that the others didn't? What happened when it was slow or wrong?
   - The board was the only way to talk: what went wrong when an agent read it too late?
   - Was the YES/NO question worth a human? Where would you want a human YES in a real company?
   - Your team's bucket of water: did you run out? When should you have saved it?
   - What mistakes did the referee catch?
