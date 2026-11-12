---
description: Join Wildfire once (your inbox card); your team is drawn when the game starts
argument-hint: Your first name and last initial
---

# Join Wildfire

Name: $ARGUMENTS (if empty or literally "$ARGUMENTS", ask the student for their first name and last
initial, then continue). Keep the name short; it goes on your order sticky (`Ana: paint …`).

1. Read `board.json` (and `CLAUDE.md` if not already in context). If `boardUrl` is empty, tell the
   student "The instructor hasn't published the board link yet; pull the kit again (`git pull`) in a
   minute." and stop. `player.json` does not exist before the first `/join`: that is normal, go to
   step 2 (step 3 creates it). If `player.json` already has an `inboxId`, the student has joined: go
   to step 4.
2. Pick a spot: top-left x = 40 + a random number 0–3500, y = 2400 + a random number 0–1200
   (so the 380 × 150 card stays inside the Inbox panel 0, 2300, 4000, 1500: x ≤ 3620, y ≤ 3650).
3. Create the card in ONE `canvas_update_from_svg` call (never `canvas_create_from_svg`), replacing
   NAME, X and Y:

   ```xml
   <svg xmlns="http://www.w3.org/2000/svg">
   <rect id="inbox" x="X" y="Y" width="380" height="150" fill="#ffffff" stroke="#e2e5ea" stroke-width="2" data-content="Inbox · NAME" data-text-color="#1f2328" data-font-size="16" data-text-align="left" data-text-align-vertical="top"/>
   </svg>
   ```

   Save `{"name": "NAME", "inboxId": "<card id from result_svg>", "stickies": {}, "calls": 1}` to
   `player.json`.
4. **Peek** at the card (`canvas_read_as_svg`, `widget_ids: [inboxId]`). The peek returns no item
   with that id (the card was deleted, e.g. a new game): go to step 2 and make a new card. The name
   on the card wins (a second "Ana K" becomes `Ana K 2`): save it as `name`. Two good answers (if the card shows both, the team one wins):
   - `👋 Ana: you're in! 🎲 Teams are drawn when the game starts…`: joined. Teams are drawn at random
     when the game starts, so there is no team or role yet. Don't save any; go to step 5.
   - A welcome with a team (late join, or no draw this game), like "👋 Ana: you are on Team 1 (ridge).
     … You are the BOSS: …" or "👋 Ben: you are on Team 3 (cedar). … You are a WORKER: …":
     - Team: the internal id in parentheses or brackets (`ridge`, `pine`, `cedar`, `birch`) → save
       `team` (the id, never the display name). No id there: map the team number instead (Team 1 →
       `ridge`, Team 2 → `pine`, Team 3 → `cedar`, Team 4 → `birch`).
     - Role: `You are the BOSS` → `"role": "boss"`; `You are a WORKER` → `"role": "worker"`.
   Neither yet: wait 15 s (CLAUDE.md "Waiting") and peek again, at most 8 times. The referee moves the card into a neat slot; the id stays the same.
5. Tell the student in one line:
   - `you're in`: "You're in! Teams are drawn when the game starts; run /play when your instructor says go."
   - a team: "You are on Team N" (the display name, `board.json` `teams[team].name`, never the id),
     their role, and "Run /play when your instructor says go."
   Everyone also gets: "I may ask you a YES/NO question during the game (whether to start a fire in a
   neighbour's area): answer it."
   Nothing after 8 peeks: "The referee isn't running yet; run /join again when the instructor says
   go." Don't create a second card.
