import { describe, expect, it } from "vitest";
import { STATE_COLOR, buildCells, type CellState } from "../src/layout.js";
import {
  advance, applyJoin, createState, decidePaint, judgeSticky, mulberry32, parseBackburn, pendingStickies, scores, spread, startGame, strike, type GameState, type RuleSet,
} from "../src/rules.js";

const base: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, downwindMult: 2, upwindMult: 0.3, pEmber: 0.03, burnTicks: 3, windMinutes: 5, lightningAt: [10, 18], lightningMinDistance: 6,
  wetSeconds: 90, waterTotal: 400, cooldownSeconds: 5, timeoutSeconds: 5, backburnMax: 20, helpMinutes: 3, helpPlayers: 2, gameMinutes: 30, quietSpreads: 2,
};
const list = buildCells();
const cells = new Map(list.map((c) => [c.label, c]));
const byPos = new Map(list.map((c) => [`${c.col},${c.row}`, c]));
const C = STATE_COLOR;
const T0 = 1_000_000;

/** A live game with 2 players per team (first = boss) and every team's PLAN approved. */
function live(rules = base, seed = 1) {
  const rng = mulberry32(seed);
  const s = createState(list, rules, rng);
  for (const [u, name] of [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"], ["p2", "Pia"], ["c2", "Cal"], ["b2", "Ben"]] as const) applyJoin(s, { userId: u, name, at: T0 }, undefined);
  startGame(s, rules, T0);
  for (const t of ["ridge", "pine", "cedar", "birch"] as const) s.plan[t] = `plan-${t}`;
  return { s, rng };
}
const paint = (s: GameState, userId: string, label: string, fill: string, at = T0 + 60_000, rules = base) => decidePaint(s, rules, cells, { label, fill, userId, at });
const set = (s: GameState, label: string, st: CellState) => (s.cells[label] = st);
const sticky = (s: GameState, id: string, team: "ridge" | "pine" | "cedar" | "birch", text: string, createdBy: string, modifiedBy: string, rules = base) =>
  judgeSticky(s, rules, cells, { id, team, text, createdBy, modifiedBy });

describe("joining", () => {
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
  it("downwind always catches, upwind never (with p = 1 and 0), and a square burns burnTicks spreads", () => {
    const rules = { ...base, pSide: 0.5, downwindMult: 2, upwindMult: 0, pDiag: 0, pEmber: 0 };
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
  it("embers jump a 1-wide firebreak 2 squares downwind; water, firebreak, river never ignite", () => {
    const rules = { ...base, pSide: 1, pDiag: 1, downwindMult: 1, upwindMult: 1, pEmber: 1 };
    const s = createState(list, rules, mulberry32(1));
    s.wind = 2;
    s.cells.C3 = "fire";
    s.burnLeft.C3 = 3;
    for (const l of ["D2", "D3", "D4"]) s.cells[l] = "firebreak";
    s.cells.B3 = "water";
    s.cells.C2 = "river";
    spread(s, rules, list, byPos, mulberry32(2));
    expect(s.cells.E3).toBe("fire");
    expect([s.cells.D3, s.cells.B3, s.cells.C2]).toEqual(["firebreak", "water", "river"]);
    expect(s.cells.C4).toBe("fire");
  });
  it("advance: spreads every spreadSeconds, the wind turns 45°, lightning strikes far from the fire", () => {
    const { s, rng } = live();
    const wind = s.wind;
    advance(s, base, list, byPos, rng, 19_000);
    expect(s.spreads).toBe(0);
    advance(s, base, list, byPos, rng, 1_000);
    expect(s.spreads).toBe(1);
    for (let i = 0; i < 17; i++) advance(s, base, list, byPos, rng, 20_000); // to 6:00
    expect([1, 7]).toContain((s.wind - wind + 8) % 8);
    expect(s.stats.strikes).toHaveLength(0);
    for (let i = 0; i < 13; i++) advance(s, base, list, byPos, rng, 20_000); // to 10:20
    expect(s.stats.strikes).toHaveLength(1);
  });
  it("lightning picks a forest square at least 6 squares from every fire", () => {
    const { s } = live();
    for (let i = 0; i < 20; i++) {
      const hit = cells.get(strike(s, base, list, mulberry32(i))!)!;
      expect(Math.max(Math.abs(hit.col - 17.5), Math.abs(hit.row - 16.5))).toBeGreaterThanOrEqual(6);
      s.cells[hit.label] = "forest";
    }
  });
  it("water dries back to what it was after wetSeconds", () => {
    const { s, rng } = live();
    set(s, "E5", "cabin");
    expect(paint(s, "r1", "E5", C.water).accept).toBe(true);
    expect(paint(s, "r2", "B2", C.water).accept).toBe(true);
    advance(s, { ...base, pSide: 0, pDiag: 0, pEmber: 0 }, list, byPos, rng, 89_000);
    expect(s.cells.E5).toBe("water");
    advance(s, { ...base, pSide: 0, pDiag: 0, pEmber: 0 }, list, byPos, rng, 2_000);
    expect([s.cells.E5, s.cells.B2]).toEqual(["cabin", "forest"]);
  });
  it("the game ends at gameMinutes, or when nothing burns for 2 spreads after the last lightning", () => {
    const { s, rng } = live({ ...base, gameMinutes: 1 });
    advance(s, { ...base, gameMinutes: 1 }, list, byPos, rng, 61_000);
    expect(s).toMatchObject({ phase: "over", endReason: "time" });
    const g = live().s;
    for (const l of Object.keys(g.cells)) if (g.cells[l] === "fire") g.cells[l] = "burnt";
    advance(g, { ...base, lightningAt: [] }, list, byPos, mulberry32(1), 40_000);
    expect(g).toMatchObject({ phase: "over", endReason: "out" });
  });
});

describe("paints", () => {
  it("accepts exactly the SPEC transitions", () => {
    const { s } = live();
    let at = T0 + 60_000;
    const ok = (u: string, l: string, fill: string) => paint(s, u, l, fill, (at += 6000)).accept;
    set(s, "C3", "fire");
    expect(ok("r1", "C3", C.water)).toBe(true); // water on fire
    expect(ok("r1", "C4", C.water)).toBe(true); // water on forest
    expect(ok("r1", "E5", C.water)).toBe(true); // water on cabin
    expect(ok("r1", "C6", C.firebreak)).toBe(true); // firebreak on forest
    s.backburn.ridge = ["C8"];
    expect(ok("r1", "C8", C.burnt)).toBe(true); // burnt in an approved backburn
    expect(s.cells).toMatchObject({ C3: "water", C4: "water", E5: "water", C6: "firebreak", C8: "burnt" });
  });
  it("refuses every other transition", () => {
    const { s } = live();
    let at = T0 + 60_000;
    const rule = (l: string, fill: string) => paint(s, "r1", l, fill, (at += 6000)).rule;
    set(s, "C3", "fire");
    expect(rule("J5", C.water)).toBe("color"); // river
    set(s, "C5", "burnt");
    expect(rule("C5", C.water)).toBe("color");
    expect(rule("C3", C.firebreak)).toBe("color"); // firebreak on fire
    expect(rule("C9", C.burnt)).toBe("backburn"); // no backburn
    expect(rule("C3", C.burnt)).toBe("color");
    expect(rule("C10", C.fire)).toBe("color"); // players never paint fire
    expect(rule("C10", C.forest)).toBe("color");
    expect(rule("C10", "#123456")).toBe("color");
  });
  it("PLAN gate, sector, cooldown, unjoined", () => {
    const { s } = live();
    delete s.plan.ridge;
    expect(paint(s, "r1", "C4", C.water).rule).toBe("plan");
    s.plan.ridge = "x";
    expect(paint(s, "r1", "Z4", C.water).rule).toBe("sector");
    expect(paint(s, "r1", "C4", C.water, T0 + 60_000).accept).toBe(true);
    expect(paint(s, "r1", "C5", C.water, T0 + 63_000).rule).toBe("cooldown");
    expect(paint(s, "zed", "C5", C.water).rule).toBe("unjoined");
  });
  it("one shared water pool: each water paint uses 1, at 0 water is refused (firebreaks still work)", () => {
    const { s } = live({ ...base, waterTotal: 2 });
    expect(paint(s, "r1", "C4", C.water).accept).toBe(true);
    expect(paint(s, "p1", "Z4", C.water).accept).toBe(true);
    expect(s.water).toBe(0);
    expect(paint(s, "c1", "C30", C.water).rule).toBe("water");
    expect(paint(s, "c1", "C30", C.firebreak).accept).toBe(true);
  });
});

describe("approvals", () => {
  it("PLAN: a YES from the creator doesn't count; a teammate's YES does, and is remembered", () => {
    const { s } = live();
    delete s.plan.ridge;
    const notes = sticky(s, "st1", "ridge", "PLAN\nhold the river\nYES", "r1", "r1");
    expect(s.plan.ridge).toBeUndefined();
    expect(notes[0]?.line).toContain("did not post it");
    sticky(s, "st1", "ridge", "PLAN\nhold the river\nYES", "r1", "p1"); // wrong team
    expect(s.plan.ridge).toBeUndefined();
    const ok = sticky(s, "st1", "ridge", "PLAN\nhold the river\nYES", "r1", "r2");
    expect(s.plan.ridge).toBe("st1");
    expect(ok.map((n) => n.userId).sort()).toEqual(["r1", "r2"]);
    sticky(s, "st1", "ridge", "PLAN\nhold the river\nNO", "r1", "r2");
    expect(s.approvals.st1?.status).toBe("approved");
  });
  it("BACKBURN: parses runs and lists, refuses outside the sector or over the limit; approved squares may go burnt", () => {
    expect(parseBackburn("P6-P15", "ridge", cells, 20)).toEqual({ labels: ["P6", "P7", "P8", "P9", "P10", "P11", "P12", "P13", "P14", "P15"] });
    expect(parseBackburn("C3 D3, E3", "ridge", cells, 20)).toEqual({ labels: ["C3", "D3", "E3"] });
    expect(parseBackburn("A1-C3", "ridge", cells, 20)).toHaveProperty("error");
    expect(parseBackburn("R5-T5", "ridge", cells, 20)).toHaveProperty("error");
    expect(parseBackburn("A1-A17 B1-B4", "ridge", cells, 20)).toHaveProperty("error");
    const { s } = live();
    sticky(s, "bb", "ridge", "BACKBURN P6-P8\nYES", "r1", "r1");
    expect(s.backburn.ridge).toEqual([]);
    sticky(s, "bb", "ridge", "BACKBURN P6-P8\nYES", "r1", "r2");
    expect(s.backburn.ridge).toEqual(["P6", "P7", "P8"]);
    expect(paint(s, "r2", "P7", C.burnt).accept).toBe(true);
    expect(paint(s, "p1", "P8", C.burnt).rule).toBe("sector");
  });
  it("NO refuses (and can be overturned by a later YES)", () => {
    const { s } = live();
    sticky(s, "bb", "ridge", "BACKBURN P6-P8\nNO", "r1", "r2");
    expect(s.approvals.bb?.status).toBe("refused");
    sticky(s, "bb", "ridge", "BACKBURN P6-P8\nNO\nYES", "r1", "r2");
    expect(s.backburn.ridge).toHaveLength(3);
  });
  it("waiting list: skips non-players' examples; a refused sticky rewritten without NO waits again", () => {
    const { s } = live();
    const ex = { id: "ex", team: "ridge" as const, text: "PLAN · example: hold the river", createdBy: "instructor", modifiedBy: "instructor" };
    sticky(s, "bb", "ridge", "BACKBURN P6-P8\nNO", "r1", "r2");
    expect(pendingStickies(s, [ex, { id: "bb", team: "ridge", text: "BACKBURN P6-P8\nNO", createdBy: "r1", modifiedBy: "r2" }]).ridge).toEqual([]);
    expect(pendingStickies(s, [{ id: "bb", team: "ridge", text: "BACKBURN P6-P9", createdBy: "r1", modifiedBy: "r1" }]).ridge).toEqual(["BACKBURN by Rita"]);
  });
  it("HELP: approved by the helper team; the first 2 helpers may paint in the asker's sector for 3 minutes", () => {
    const rules = { ...base, waterTotal: 100 };
    const { s, rng } = live(rules);
    applyJoin(s, { userId: "p3", name: "Pax", at: T0 }, "pine");
    sticky(s, "h", "pine", "HELP Ridge\nYES", "r1", "r2"); // answered by the asker's own team: no
    expect(s.grants).toHaveLength(0);
    sticky(s, "h", "pine", "HELP Ridge\nYES", "r1", "p2");
    expect(s.grants).toMatchObject([{ helper: "pine", to: "ridge", players: [] }]);
    expect(paint(s, "p1", "C4", C.water, T0 + 60_000).accept).toBe(true);
    expect(paint(s, "p2", "C5", C.water, T0 + 60_000).accept).toBe(true);
    expect(paint(s, "p3", "C6", C.water, T0 + 60_000).rule).toBe("sector"); // third helper
    expect(paint(s, "c1", "C7", C.water, T0 + 60_000).rule).toBe("sector"); // not the helper team
    advance(s, { ...rules, pSide: 0, pDiag: 0, pEmber: 0 }, list, byPos, rng, 181_000);
    expect(paint(s, "p1", "C8", C.water, T0 + 400_000).rule).toBe("sector");
  });
});

describe("score", () => {
  it("forest + water + 10 per standing cabin, as % of the start", () => {
    const { s } = live();
    const start = scores(s, list);
    expect(s.startScore.ridge).toBe(295 + 20);
    expect(start.ridge.points).toBe(314); // R17 is burning
    s.cells.C4 = "water";
    s.cells.C5 = "firebreak";
    s.cells.E5 = "burnt"; // a cabin
    const sc = scores(s, list);
    expect(sc.ridge.points).toBe(314 - 1 - 10);
    expect(sc.ridge.pct).toBe(Math.round((100 * 303) / 315));
    expect(sc.ridge.fire).toBe(1);
  });
});
