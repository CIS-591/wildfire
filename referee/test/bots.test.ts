// The bot runner (`npm run referee bots`) on a FakeBoard with BOTH referees in-process, in bot rehearsal:
// the bots write with the guard's token user (MIRO_ACCESS_TOKEN_2, the hardest case: a referee's own
// account), the referees count only the other referee's user as their own.
import { describe, expect, it } from "vitest";
import { Bucket, CLASS_PROFILE, blueTargets } from "../src/bots.js";
import { runBotsDryRun } from "../src/bots-dry.js";
import { loadRules } from "../src/config.js";
import { mulberry32 } from "../src/rules.js";
import type { CellView } from "../src/bot.js";
import { STATE_COLOR } from "../src/layout.js";

describe("bot runner", () => {
  it("6 bots + game + guard finish a game: paints accepted, an attack approved, no bot write ignored as self, no referee undoing the other", async () => {
    const rules = { ...loadRules(), gameMinutes: 6, lightningAt: [2, 4] };
    const r = await runBotsDryRun(rules, { players: 6, seed: 3, profile: { ...CLASS_PROFILE, joinSpreadSec: 30, vandals: 1, askGapSec: [30, 60] }, botsToken: 2 });
    expect(r.players).toBe(6);
    expect(r.over).toBe(true); // the bots saw GAME OVER and stopped
    expect(r.game.state?.phase).toBe("over");
    expect(r.accepted).toBeGreaterThan(0);
    expect(r.approvals.approved ?? 0).toBeGreaterThan(0);
    // Every bot paint that changed a square was judged by the game referee (none skipped as its "own" write).
    expect(r.botChanged).toBeGreaterThan(20);
    expect(r.judged).toBeGreaterThanOrEqual(r.botChanged);
    expect(r.unconverged).toEqual([]);
    // The guard never deleted or edited the game's squares, fixtures, cards or icons; the game never wrote statics.
    expect(r.guardTouchedGame).toEqual([]);
    expect(r.gameTouchedStatics).toEqual([]);
    // The vandal's image and stray sticky were removed by the guard.
    expect(r.stats.vandal).toBe(2);
    expect(r.junkRemoved).toBeGreaterThanOrEqual(2);
  });

  it("bots on a third token work the same", async () => {
    const r = await runBotsDryRun({ ...loadRules(), gameMinutes: 4, lightningAt: [2] }, { players: 6, seed: 5, botsToken: 3 });
    expect(r.over).toBe(true);
    expect(r.accepted).toBeGreaterThan(0);
    expect(r.judged).toBeGreaterThanOrEqual(r.botChanged);
    expect(r.guardTouchedGame).toEqual([]);
  });

  it("the write bucket never lets more than its rate through", () => {
    const b = new Bucket(600, 10);
    let n = 0;
    for (let t = 0; t < 60_000; t += 100) while (b.take(1, t)) n++;
    expect(n).toBeLessThanOrEqual(610);
    expect(n).toBeGreaterThan(550);
  });

  it("blue targets are green squares within 2 of the fire, next to it first", () => {
    const cell = (col: number, row: number, fill: string): CellView => ({ id: `${col},${row}`, label: `${col},${row}`, col, row, sector: "ridge", fill });
    const cells = [cell(5, 5, STATE_COLOR.fire), cell(6, 5, STATE_COLOR.forest), cell(7, 5, STATE_COLOR.forest), cell(8, 5, STATE_COLOR.forest), cell(5, 6, STATE_COLOR.burnt)];
    const t = blueTargets(cells, "ridge", mulberry32(1)).map((c) => c.id);
    expect(t).toEqual(["6,5", "7,5"]);
  });
});
