# Bug report: fire burns through water

Branch: `fix/fire-burns-through-water-mohsen`, based on commit `1f2242f` ("Wildfire: Miro board ids, student kit, game engine").

## What players saw

In the last round, squares that a team had just painted blue (water, `#23bfe7`) turned orange (fire), and sometimes black (burnt). Water is supposed to stop fire, so it looked as if the fire burned straight through it.

## Short answer

The rules themselves are fine: the fire never chooses to spread into water. The problem is **timing**. The referee looks at the board, spends a moment working out the next move of the fire, and then paints its results. If a player painted water **during that moment**, the referee did not know about it yet and painted fire straight over the water. The player's water was simply lost: it was never checked, never counted, and no message explained what happened.

## How the referee works (in plain English)

Every few seconds the referee runs one "tick" (`referee/src/referee.ts`, the `tick()` function starting at line 318). A tick does this, in order:

1. **Takes a photo of the board** (line 320, `readBoard()`).
2. Compares the photo with what it expects, to find new paints, moved squares, new players and so on.
3. **Judges each paint** (step 5): water on a burning square puts it out, an illegal colour is undone.
4. **Moves the fire on** (step 6, `advance()` in `referee/src/rules.ts`): fire spreads to neighbouring forest, old fires burn out to black, water dries back to forest after 90 seconds.
5. **Paints its results on the board** (step 7).

Steps 2 to 5 take real time, because each Miro request is a trip over the internet. During that time the players' Claude agents keep painting.

## Root cause

- The fire rule only spreads into forest and cabins: `burnable` in `referee/src/rules.ts:300` and the check at `referee/src/rules.ts:314`. Water, firebreaks, burnt squares and the river can never catch fire. So the **rules engine is not the problem**.
- The rules engine uses the referee's own memory of the board, and that memory comes from the photo taken at the start of the tick.
- Suppose a forest square sits next to the fire. The referee takes its photo: the square is green. A player then paints it blue. The referee, still working from its photo, decides "the fire spreads here" and in step 7 writes orange onto that square (`writeCell`, `referee/src/referee.ts:309`, called from the old line 472). Miro just accepts the last colour written, so **orange replaces the player's blue**.
- At the same moment the referee also notes "this square is orange now" as what it expects to see (`referee/src/referee.ts:314`). On the next tick the board shows orange, the referee expects orange, so it sees nothing to judge. The water paint vanished without any trace: no water was taken from the shared pool and the player got no message.
- The same thing happens when a burning square burns out to black, and when the referee undoes someone's illegal paint (old line 461): anything a player painted on that square in the meantime is wiped out.

This hits exactly the squares players care about most: agents paint water **right next to the fire**, and those are exactly the squares the fire is about to spread into.

## The fix

File: `referee/src/referee.ts`.

Just before writing, the referee now **takes a second, quick look** at the squares it is about to repaint (new function `keepNewerPaints`, lines 495-521, called at line 487).

- If a square still looks the way it did in the first photo, nothing changed, and the referee writes as before.
- If a player repainted the square in the meantime, the referee **does not overwrite it**. It leaves the player's paint on the board and judges it on the next tick, like any other paint. Water on a burning square is a legal move, so the water is accepted, puts the fire out and uses one unit from the shared pool, exactly as the rules say.
- An illegal paint made in the meantime is still caught and undone on the next tick, so nobody can sneak a colour past the referee this way.

To know which squares to re-check, the tick now keeps a short list (`syncs`, line 329) of the squares it is going to repaint from its own state: fire spread, burn-out, drying, lightning and undone paints (lines 451, 466, 480). A paint that the referee accepts is taken off that list (line 463), because the player's paint is already on the board.

The rules of the game do not change.

### What it costs

One extra read of the grid, only on ticks where the referee repaints squares (mainly when the fire spreads). On the fast read path that is the same per-frame read the referee already does every tick.

### What is left

The second look shrinks the danger window from "the whole tick" to "the instant between the second look and the write", which is a few milliseconds instead of seconds. Miro has no "only change this if nobody else has" option, so a perfect guarantee is not possible from the referee's side.

## A second thing players may have seen (by design, not changed)

Water is **meant** to wear off: after 90 seconds a blue square turns back into forest (`wetSeconds` in `referee/config/rules.json`, see SPEC.md section 3). If the water dries and the fire spreads into that square within the same tick, the referee writes only the final colour, so players see blue turn **directly** orange without ever seeing green. That also looks like "fire burned through water", but it is the intended rule. I did not change it; if the class wants, a follow-up could show dried squares as green for at least one tick, or tell teams in the banner when their water is about to dry.

## How it was tested

All tests were run locally in `referee/` (no Miro board or `.env` needed; the tests use the in-memory fake board).

1. **New test** in `referee/test/referee.test.ts` (line 106, "water painted while the referee is mid-tick is never overwritten by fire"). It sets the fire to spread with 100% certainty, then makes players paint water on every square around the fire **after** the referee has taken its photo but **before** it writes. It checks that:
   - after the spread, every one of those squares is still blue on the board;
   - on the next tick the referee has accepted the water: the squares are water in the referee's own state too, and the shared water pool went down by exactly that many.
2. **Before the fix** this test failed: square Q16 was painted blue and the referee turned it orange (`#ff9d48`). **After the fix** it passes.
3. The whole existing test suite still passes: `npm test` → 29 tests passed (28 old + 1 new).
4. `npm run typecheck` (TypeScript) passes, and `npx eslint .` reports no problems.
5. The offline game simulator (`npx tsx src/cli.ts sim`) plays a full 21-minute game with 28 bots without errors.

To run the checks yourself:

```bash
cd referee
npm ci
npm test
npm run typecheck
```
