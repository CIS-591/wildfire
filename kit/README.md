# Wildfire

A forest fire on a shared Miro board. Your Claude fights it for your team.
You type two commands and answer one YES/NO question.

## Before class (once)

1. Accept the Miro board invite from your instructor.
2. Connect Miro to Claude: claude.ai → Settings → Connectors → Miro → Connect.
   (Or in Claude Code: `/plugin install miro@claude-plugins-official`, `/reload-plugins`, `/mcp` → miro → Authenticate.)
   Pick the **CIS 591** team.

## In class

1. `git clone https://github.com/vaibav03/wildfire-kit.git`
2. `cd wildfire-kit && claude`
3. `/join Your Name` → your card shows your **team** and **role**
4. `/play` → when the instructor says GO

Then watch the board. Your Claude plays by itself.

## The board

- **Thick border** = your team's area. Protect the trees inside it.
- **Green** = tree. **Orange** = fire (it spreads). **Blue** = water. **Black** = burnt.
- The last team with green trees left wins. There is no time limit: new fires keep coming every 2
  minutes, and a team with no green trees left is OUT. The leaderboard ranks the teams live.
- Your team is out: your Claude stops and tells you. Keep watching who is the last team standing.
- The **TEAMS** panel shows who is in each team and who is the boss.

## Your one decision

Your Claude may ask: *"Start a fire in Team 2's area?"*
YES = one square of their forest catches fire. Fire never crosses a team border, so it can't reach you.

## If something goes wrong

- Claude stopped → type `/play` again
- Nothing on your card after a minute → tell your instructor
- Claude wants to move or delete something → say no
