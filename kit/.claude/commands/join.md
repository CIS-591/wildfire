---
description: Join Wildfire once (your inbox card), then wait for your team and role
argument-hint: Your first name and last initial
---

# Join Wildfire

Name: $ARGUMENTS (if empty or literally "$ARGUMENTS", ask the student for their first name and last
initial, then continue). Keep the name short; the boss will write it on your ORDER sticky.

1. Read `board.json` (and `CLAUDE.md` if not already in context). If `boardUrl` is empty, tell the
   student "The instructor hasn't published the board link yet; pull the kit again (`git pull`) in a
   minute." and stop. If `player.json` already has an `inboxId`, the student has joined: go to step 4.
2. Pick a spot: top-left x = 40 + a random number 0–3500, y = 2400 + a random number 0–1300
   (inside the Inbox panel `board.json` `panels.inbox`).
3. Create the card in ONE `canvas_update_from_svg` call (never `canvas_create_from_svg`), replacing
   NAME, X and Y:

   ```xml
   <svg xmlns="http://www.w3.org/2000/svg">
   <rect id="inbox" x="X" y="Y" width="380" height="150" fill="#ffffff" stroke="#1a1a1a" stroke-width="2" data-content="Inbox · NAME" data-font-size="16" data-text-align="left" data-text-align-vertical="top"/>
   </svg>
   ```

   Save `{"name": "NAME", "inboxId": "<card id from result_svg>", "stickies": {}, "calls": 1}` to
   `player.json`.
4. **Peek** at the card (`canvas_read_as_svg`, `widget_ids: [inboxId]`). The referee writes a welcome
   like "👋 Ana: team Ridge (ridge), sector A–R, rows 1–17, … You are the BOSS: …" or "… team Cedar Creek
   (cedar) … You are a WORKER: …".
   - Team: the id in brackets after `team` (`ridge`, `pine`, `cedar`, `birch`); if there is none, the
     first word of the team name (`Ridge`, `Pine`, `Cedar`, `Birch`, any case) → save `team`.
   - Role: `You are the BOSS` → `"role": "boss"`; `You are a WORKER` → `"role": "worker"`.
   - Save only when **both** team and role are there. Otherwise `sleep 15` and peek again, at most 8
     times. The referee moves the card into a neat slot; the id stays the same.
5. Tell the student in one line: their team, their role, and "Run /play when your instructor says go."
   Bosses also get: "Your teammates approve your PLAN with /approve (or YES on the sticky in Miro)."
   No team after 8 peeks: "The referee isn't running yet; run /join again when the instructor says
   go." Don't create a second card.
