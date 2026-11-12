import { describe, expect, it } from "vitest";
import { STATE_COLOR, buildCells, startFill, type CellState } from "../src/layout.js";
import {
  advance, applyJoin, createState, decidePaint, judgeSticky, mulberry32, pendingStickies, questionTarget, scores, spread, startGame, stickyKind, strike, type GameState, type RuleSet,
} from "../src/rules.js";

const base: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, downwindMult: 2, upwindMult: 0.3, burnTicks: 3, windMinutes: 5, lightningAt: [5], lightningMinDistance: 6,
  waterTotal: 400, cooldownSeconds: 5, timeoutSeconds: 5, outsideMinutes: 2, gameMinutes: 10,
};
const calm = { ...base, pSide: 0, pDiag: 0 };
const list = buildCells();
const cells = new Map(list.map((c) => [c.label, c]));
const byPos = new Map(list.map((c) => [`${c.col},${c.row}`, c]));
const C = STATE_COLOR;
const T0 = 1_000_000;

/** A live game with 2 players per team (first = boss). */
function live(rules = base, seed = 1) {
  const rng = mulberry32(seed);
  const s = createState(list, rules, rng);
  for (const [u, name] of [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"], ["p2", "Pia"], ["c2", "Cal"], ["b2", "Ben"]] as const) applyJoin(s, { userId: u, name, at: T0 }, undefined);
  startGame(s, rules, T0);
  return { s, rng };
}
const paint = (s: GameState, userId: string, label: string, fill: string, at = T0 + 60_000, rules = base) => decidePaint(s, rules, cells, { label, fill, userId, at });
const set = (s: GameState, label: string, st: CellState) => (s.cells[label] = st);
const sticky = (s: GameState, id: string, team: "ridge" | "pine" | "cedar" | "birch", text: string, createdBy: string, modifiedBy: string, rules = base) =>
  judgeSticky(s, rules, { id, team, text, createdBy, modifiedBy });

describe("start", () => {
  it("all green except the four centre squares on fire", () => {
    const fills = new Set(list.filter((c) => !["R17", "S17", "R18", "S18"].includes(c.label)).map(startFill));
    expect([...fills]).toEqual([C.forest]);
    expect(["R17", "S17", "R18", "S18"].map((l) => startFill(cells.get(l)!))).toEqual([C.fire, C.fire, C.fire, C.fire]);
    const { s } = live();
    expect(s.cells.R17).toBe("fire");
  });
  it("fills 4 balanced teams; the first player on a team is its boss", () => {
    const { s } = live();
    expect(s.players.r1).toMatchObject({ team: "ridge", role: "boss" });
    expect(s.players.r2).toMatchObject({ team: "ridge", role: "worker" });
    expect(s.players.b1).toMatchObject({ team: "birch", role: "boss" });
  });
});

describe("fire", () => {
  it("the same seed spreads the same fire; another seed doesn't", () => {
    const run = (seed: number) => {
      const { s, rng } = live(base, seed);
      for (let i = 0; i < 8; i++) spread(s, base, list, byPos, rng);
      return JSON.stringify(s.cells);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
  it("downwind always catches, upwind never (p = 1 and 0), and a square burns burnTicks spreads", () => {
    const rules = { ...base, pSide: 0.5, downwindMult: 2, upwindMult: 0, pDiag: 0 };
    const s = createState(list, rules, mulberry32(1));
    s.phase = "live";
    s.wind = 2; // blowing east
    s.cells.F10 = "fire";
    s.burnLeft.F10 = 3;
    spread(s, rules, list, byPos, mulberry32(3));
    expect(s.cells.G10).toBe("fire");
    expect(s.cells.E10).toBe("forest");
    spread(s, rules, list, byPos, mulberry32(4));
    expect(s.cells.F10).toBe("fire");
    spread(s, rules, list, byPos, mulberry32(5));
    expect(s.cells.F10).toBe("burnt");
  });
  it("blue and black never burn", () => {
    const rules = { ...base, pSide: 1, pDiag: 1, downwindMult: 1, upwindMult: 1 };
    const s = createState(list, rules, mulberry32(1));
    s.cells.C3 = "fire";
    s.burnLeft.C3 = 3;
    for (const l of ["B2", "C2", "D2", "B3", "D3"]) s.cells[l] = "water";
    for (const l of ["B4", "C4", "D4"]) s.cells[l] = "burnt";
    spread(s, rules, list, byPos, mulberry32(2));
    expect(["B2", "C2", "D2", "B3", "D3"].map((l) => s.cells[l])).toEqual(Array(5).fill("water"));
    expect(["B4", "C4", "D4"].map((l) => s.cells[l])).toEqual(Array(3).fill("burnt"));
  });
  it("advance: spreads every spreadSeconds; at minute 5 the wind turns 45° once and lightning strikes once", () => {
    const { s, rng } = live({ ...base, gameMinutes: 30 });
    const r = { ...base, gameMinutes: 30 };
    const wind = s.wind;
    advance(s, r, list, byPos, rng, 19_000);
    expect(s.spreads).toBe(0);
    advance(s, r, list, byPos, rng, 1_000);
    expect(s.spreads).toBe(1);
    for (let i = 0; i < 13; i++) advance(s, r, list, byPos, rng, 20_000); // to 4:40
    expect(s.wind).toBe(wind);
    expect(s.stats.strikes).toHaveLength(0);
    advance(s, r, list, byPos, rng, 20_000); // 5:00
    expect([1, 7]).toContain((s.wind - wind + 8) % 8);
    expect(s.stats.strikes).toHaveLength(1);
    const after = s.wind;
    for (let i = 0; i < 30; i++) advance(s, r, list, byPos, rng, 20_000); // to 15:00
    expect(s.wind).toBe(after);
    expect(s.stats.strikes).toHaveLength(1);
  });
  it("lightning picks a green square at least lightningMinDistance from every fire", () => {
    const { s } = live();
    for (let i = 0; i < 20; i++) {
      const hit = cells.get(strike(s, base, list, mulberry32(i))!)!;
      expect(Math.max(Math.abs(hit.col - 17.5), Math.abs(hit.row - 16.5))).toBeGreaterThanOrEqual(6);
      s.cells[hit.label] = "forest";
    }
  });
});

describe("end", () => {
  it("ends at gameMinutes: highest % wins", () => {
    const slow = { ...calm, burnTicks: 1000 }; // the fire never goes out by itself
    const { s, rng } = live(slow);
    for (const l of ["A1", "A2", "A3"]) set(s, l, "burnt");
    advance(s, slow, list, byPos, rng, 599_000);
    expect(s.phase).toBe("live");
    advance(s, slow, list, byPos, rng, 2_000);
    expect(s).toMatchObject({ phase: "over", endReason: "time" });
    expect(s.winner).not.toBe("ridge");
  });
  it("ends when no fire is left and the lightning has struck; not before the lightning", () => {
    const { s, rng } = live();
    for (const l of ["R17", "S17", "R18", "S18"]) set(s, l, "water");
    advance(s, calm, list, byPos, rng, 60_000);
    expect(s.phase).toBe("live"); // lightning still to come at minute 5
    const g = live({ ...base, lightningAt: [] }).s;
    for (const l of ["R17", "S17", "R18", "S18"]) set(g, l, "water");
    advance(g, { ...calm, lightningAt: [] }, list, byPos, mulberry32(1), 20_000);
    expect(g).toMatchObject({ phase: "over", endReason: "out" });
  });
});

describe("paints", () => {
  it("accepts blue on green or orange in your team's area; the square turns to water", () => {
    const { s } = live();
    set(s, "C3", "fire");
    expect(paint(s, "r1", "C3", C.water, T0 + 60_000)).toMatchObject({ accept: true, feedback: expect.stringContaining("C3 fire put out") });
    expect(paint(s, "r1", "C4", C.water, T0 + 66_000)).toMatchObject({ accept: true, feedback: expect.stringContaining("C4 is now water") });
    expect([s.cells.C3, s.cells.C4]).toEqual(["water", "water"]);
    expect(s.burnLeft.C3).toBeUndefined();
  });
  it("refuses other colors, blue on blue or black, and paints outside the team's area", () => {
    const { s } = live();
    let at = T0 + 60_000;
    const rule = (l: string, fill: string, u = "r1") => paint(s, u, l, fill, (at += 6000)).rule;
    expect(rule("C10", C.fire)).toBe("color");
    expect(rule("C10", C.forest)).toBe("color");
    expect(rule("C10", C.burnt)).toBe("color");
    expect(rule("C10", "#123456")).toBe("color");
    set(s, "C5", "burnt");
    expect(rule("C5", C.water)).toBe("square");
    set(s, "C6", "water");
    expect(rule("C6", C.water)).toBe("square");
    const d = paint(s, "r1", "Z4", C.water, (at += 6000));
    expect(d.rule).toBe("area");
    expect(d.feedback).toContain("Team 2's area");
    expect(d.feedback).not.toMatch(/sector/i);
  });
  it("lobby, over, unjoined, cooldown", () => {
    const s = createState(list, base, mulberry32(1));
    applyJoin(s, { userId: "r1", name: "Rita", at: T0 }, "ridge");
    expect(paint(s, "r1", "C4", C.water).rule).toBe("lobby");
    startGame(s, base, T0);
    expect(paint(s, "zed", "C4", C.water).rule).toBe("unjoined");
    expect(paint(s, "r1", "C4", C.water, T0 + 60_000).accept).toBe(true);
    expect(paint(s, "r1", "C5", C.water, T0 + 63_000).rule).toBe("cooldown");
    expect(paint(s, "r1", "C5", C.water, T0 + 65_000).accept).toBe(true);
    s.phase = "over";
    expect(paint(s, "r1", "C6", C.water, T0 + 99_000).rule).toBe("over");
  });
  it("one shared water pool: each blue paint uses 1; at 0 blue is refused", () => {
    const { s } = live({ ...base, waterTotal: 2 });
    expect(paint(s, "r1", "C4", C.water).accept).toBe(true);
    expect(paint(s, "p1", "Z4", C.water).accept).toBe(true);
    expect(s.water).toBe(0);
    expect(paint(s, "c1", "C30", C.water).rule).toBe("water");
    expect(s.cells.C30).toBe("forest");
  });
});

describe("spray water in a neighbour's area (the human decision)", () => {
  it("reads the question in plain words, with or without 's, area and ?", () => {
    for (const q of ["Spray water in Team 2's area?", "spray water in pine valley area", "SPRAY WATER IN PINE VALLEY", "Spray water in Pine’s area?", "Spray water in Team 2's area?\nTheir fire is crossing"]) {
      expect(stickyKind(q)).toBe("QUESTION");
      expect(questionTarget(q)).toBe("pine");
    }
    expect(questionTarget("Spray water in Team 3's area")).toBe("cedar");
    expect(stickyKind("Ana: paint N9 N10 N11")).toBe("ORDER");
    expect(stickyKind("hello")).toBeNull();
  });
  it("the asker's YES doesn't count; a teammate's YES opens the neighbour's area for outsideMinutes", () => {
    const { s, rng } = live();
    const q = "Spray water in Team 2's area?\nYES";
    expect(paint(s, "r2", "Z4", C.water, T0 + 10_000).rule).toBe("area");
    const own = sticky(s, "q1", "ridge", q, "r1", "r1");
    expect(own[0]?.line).toContain("did not post it");
    expect(s.outside).toHaveLength(0);
    sticky(s, "q1", "ridge", q, "r1", "p1"); // answered by another team: no
    expect(s.outside).toHaveLength(0);
    const ok = sticky(s, "q1", "ridge", q, "r1", "r2");
    expect(s.outside).toMatchObject([{ team: "ridge", to: "pine", until: 120_000 }]);
    expect(ok.find((n) => n.userId === "r1")?.line).toContain("you may paint blue in Team 2's area");
    expect(ok.find((n) => n.userId === "p1")?.line).toContain("Team 1 is spraying water in your area");
    expect(paint(s, "r2", "Z4", C.water, T0 + 20_000).accept).toBe(true);
    expect(s.stats.byPlayer.r2?.outside).toBe(1);
    expect(paint(s, "r2", "C30", C.water, T0 + 30_000).rule).toBe("area"); // Cedar is not opened
    expect(paint(s, "c1", "Z5", C.water, T0 + 30_000).rule).toBe("area"); // only Ridge may
    // Remembered once seen: a later NO doesn't take it back.
    sticky(s, "q1", "ridge", "Spray water in Team 2's area?\nNO", "r1", "r2");
    expect(s.approvals.q1?.status).toBe("approved");
    // Expiry after outsideMinutes.
    const adv = advance(s, calm, list, byPos, rng, 121_000);
    expect(adv.ended).toMatchObject([{ team: "ridge", to: "pine" }]);
    expect(s.outside).toHaveLength(0);
    expect(paint(s, "r2", "Z6", C.water, T0 + 200_000).rule).toBe("area");
  });
  it("only neighbours, only in the team's own Orders", () => {
    const { s } = live();
    expect(sticky(s, "q", "ridge", "Spray water in Team 4's area?\nYES", "r1", "r2")[0]?.line).toContain("Ask about a neighbour");
    expect(sticky(s, "q2", "pine", "Spray water in Team 3's area?\nYES", "r1", "p1")[0]?.line).toContain("your own team's Orders");
    expect(s.outside).toHaveLength(0);
  });
  it("NO refuses (and a later YES overturns it)", () => {
    const { s } = live();
    const notes = sticky(s, "q", "cedar", "Spray water in Team 4 area?\nNO", "c1", "c2");
    expect(s.approvals.q?.status).toBe("refused");
    expect(notes[0]?.line).toContain("Cal said NO");
    sticky(s, "q", "cedar", "Spray water in Team 4 area?\nNO\nYES", "c1", "c2");
    expect(s.outside).toMatchObject([{ team: "cedar", to: "birch" }]);
  });
  it("waiting list in plain words; skips non-players' examples; a refused question rewritten without NO waits again", () => {
    const { s } = live();
    const ex = { id: "ex", team: "ridge" as const, text: "Spray water in Team 2's area?", createdBy: "instructor", modifiedBy: "instructor" };
    sticky(s, "q", "ridge", "Spray water in Team 2's area?\nNO", "r1", "r2");
    expect(pendingStickies(s, [ex, { id: "q", team: "ridge", text: "Spray water in Team 2's area?\nNO", createdBy: "r1", modifiedBy: "r2" }]).ridge).toEqual([]);
    expect(pendingStickies(s, [{ id: "q", team: "ridge", text: "Spray water in Team 2's area?", createdBy: "r1", modifiedBy: "r1" }]).ridge).toEqual(["spray water in Team 2's area"]);
  });
});

describe("score", () => {
  it("green + blue squares in the team's area, as % of it", () => {
    const { s } = live();
    expect(s.startScore.ridge).toBe(306);
    expect(scores(s, list).ridge.points).toBe(305); // R17 is burning
    s.cells.C4 = "water";
    s.cells.C5 = "burnt";
    s.cells.C6 = "fire";
    const sc = scores(s, list);
    expect(sc.ridge.points).toBe(303);
    expect(sc.ridge.pct).toBe(Math.round((100 * 303) / 306));
    expect(sc.ridge.fire).toBe(2);
  });
});
