---
description: Join Wildfire once (your inbox card), then wait for your team and role
argument-hint: Your first name and last initial
---

# Join Wildfire

Name: $ARGUMENTS (if empty or literally "$ARGUMENTS", ask the student for their first name and last
initial, then continue). Keep the name short; it goes on your order sticky (`Ana: paint …`).

1. Read `board.json` (and `CLAUDE.md` if not already in context). If `boardUrl` is empty, tell the
   student "The instructor hasn't published the board link yet; pull the kit again (`git pull`) in a
   minute." and stop. If `player.json` already has an `inboxId`, the student has joined: go to step 4.
2. Pick a spot: top-left x = 40 + a random number 0–3500, y = 2400 + a random number 0–1300
   (inside the Inbox panel `board.json` `panels.inbox`).
3. Create the card in ONE `canvas_update_from_svg` call (never `canvas_create_from_svg`), replacing
   NAME, X and Y:

   ```xml
   <svg xmlns="http://www.w3.org/2000/svg">
   <rect id="inbox" x="X" y="Y" width="380" height="150" fill="#161d19" stroke="#25302a" stroke-width="2" data-content="Inbox · NAME" data-text-color="#f1efe9" data-font-size="16" data-text-align="left" data-text-align-vertical="top"/>
   </svg>
   ```

   Save `{"name": "NAME", "inboxId": "<card id from result_svg>", "stickies": {}, "calls": 1}` to
   `player.json`.
4. **Peek** at the card (`canvas_read_as_svg`, `widget_ids: [inboxId]`). The referee writes a welcome
   like "👋 Ana: you are on Team 1 (ridge). … You are the BOSS: …" or "👋 Ben: you are on Team 3
   (cedar). … You are a WORKER: …".
   - Team: the internal id in parentheses or brackets (`ridge`, `pine`, `cedar`, `birch`) → save
     `team` (the id, never the display name). No id there: map the team number instead (Team 1 →
     `ridge`, Team 2 → `pine`, Team 3 → `cedar`, Team 4 → `birch`).
   - Role: `You are the BOSS` → `"role": "boss"`; `You are a WORKER` → `"role": "worker"`.
   - Save only when **both** team and role are there. Otherwise run `sleep 15` (its own command, never
     longer, never chained) and peek again, at most 8 times. The referee moves the card into a neat
     slot; the id stays the same.
5. Tell the student in one line: "You are on Team N" (the display name, `board.json`
   `teams[team].name`, never the id), their role, and "Run /play when your instructor says go."
   Workers also get: "I may ask you one YES/NO question during the game: answer it."
   No team after 8 peeks: "The referee isn't running yet; run /join again when the instructor says
   go." Don't create a second card.
