# Wildfire: slide outline (instructor, 10 slides)

1. **Wildfire.** One board, one fire, four teams, everyone's agent at once. Show the board on the
   projector: the green forest, the yellow cabins, the four orange squares in the middle. "In 30
   minutes, how much of your corner is still green?"

2. **The board.** 36 × 34 squares, four sectors (Ridge, Pine Valley, Cedar Creek, Birch Hollow), each
   with 2 cabins (worth 10) and a river. Banner: phase, wind arrow, next spread, water left. Scoreboard:
   % forest left per team. The color legend: forest, cabin, river, fire, water, firebreak, burnt.

3. **The fire (the referee's job).** Spreads every 20 s, 2.5× as likely downwind, embers jump one
   square, wind turns every 5 min, lightning at 5, 10, 15 and 20 min. The referee never fights the fire: it
   only spreads it, checks paints and keeps score.

4. **Roles: orchestrator and workers.** The boss agent reads the sector, decides, and writes one ORDER
   sticky per worker. Worker agents read their ORDER and paint one square every ~15 s. No agent talks
   to another: everything goes through the Orders frame. (Draw: boss → stickies → workers → squares →
   referee → inbox cards.)

5. **Your tools.** Water (90 s, shared class pool of 300), firebreak (permanent, brown), backburn (burn
   your own trees on purpose, only with approval). The rule that catches agents: no team paint counts
   before its first approved PLAN.

6. **The three human decisions.** PLAN (nobody paints until a teammate says YES), BACKBURN (sacrifice
   trees now to save more later), HELP (lend 2 painters to another team for 3 minutes). `/approve`
   explains each in one line and asks you; your agent never says YES for you. Waiting costs time.

7. **Setup and go.** Clone, join the Miro team, connect the Miro MCP, `/join Your Name`, `/play`.
   Second terminal for `/approve`. Then: start the referee, "go".

8. **What to watch during the game.** How fast the first PLAN gets approved per team (human latency).
   Whether boss orders run ahead of the fire or chase it. Gaps in firebreak lines; embers jumping them.
   Water draining from the shared pool. Who asks for HELP, who gives it, and whether it pays off.
   Reverted paints on inbox cards (agents misreading the board).

9. **Debrief: what happened.** Final scoreboard. Replay: when did each team's line hold or break?
   Which approvals came too late? Which team spent the most water, and did it help?

10. **Discussion: multi-agent systems.**
    - Orchestrator vs workers: what did the boss know that workers didn't? What happened when the boss
      was slow or wrong? Would you rather have one smart agent or six fast ones?
    - Shared state as the only channel: what broke when two agents read a stale board?
    - Human-in-the-loop: which decisions deserved a human, and which approvals were just friction?
      Where would you draw that line in a real company (refunds, deployments, contracts)?
    - Shared resources: was the water pool a tragedy of the commons? What rule would fix it?
    - Trust between teams: why help a rival? What would make HELP requests trustworthy?
    - Mistakes: what did the referee catch that the agents got wrong? What should a referee for your
      own agent system check?
