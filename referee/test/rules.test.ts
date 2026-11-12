import { describe, expect, it } from "vitest";
import { STATE_COLOR, buildCells, startFill, type CellState, type Team } from "../src/layout.js";
import {
  advance, applyJoin, createState, decidePaint, judgeSticky, mulberry32, pendingStickies, questionTarget, scores, spread, startGame, stickyKind, strike, type GameState, type RuleSet,
} from "../src/rules.js";

const base: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, burnTicks: 3, lightningAt: [5], lightningMinDistance: 6, startFires: [], paintBatch: 1,
  waterPerTeam: 400, cooldownSeconds: 5, timeoutSeconds: 5, attackMinutes: 2, attackSquares: 3, attacksPerTeam: 2, gameMinutes: 10,
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
  it("no wind: p = 1 catches every side, p = 0 none; a square burns burnTicks spreads", () => {
    const rules = { ...base, pSide: 1, pDiag: 0 };
    const s = createState(list, rules, mulberry32(1));
    s.phase = "live";
    s.cells.F10 = "fire";
    s.burnLeft.F10 = 3;
    spread(s, rules, list, byPos, mulberry32(3));
    expect(["E10", "G10", "F9", "F11"].map((l) => s.cells[l])).toEqual(Array(4).fill("fire"));
    expect(["E9", "G11"].map((l) => s.cells[l])).toEqual(["forest", "forest"]);
    spread(s, rules, list, byPos, mulberry32(4));
    expect(s.cells.F10).toBe("fire");
    spread(s, rules, list, byPos, mulberry32(5));
    expect(s.cells.F10).toBe("burnt");
  });
  it("same chance every direction (no wind): over many spreads each side catches about pSide", () => {
    const rules = { ...base, pSide: 0.5, pDiag: 0 };
    const n: Record<string, number> = { E10: 0, G10: 0, F9: 0, F11: 0 };
    for (let i = 0; i < 400; i++) {
      const s = createState(list, rules, mulberry32(i));
      s.cells.F10 = "fire";
      s.burnLeft.F10 = 3;
      spread(s, rules, list, byPos, mulberry32(1000 + i));
      for (const l of Object.keys(n)) if (s.cells[l] === "fire") n[l]!++;
    }
    for (const v of Object.values(n)) expect(v).toBeGreaterThan(160);
    for (const v of Object.values(n)) expect(v).toBeLessThan(240);
  });
  it("start fires: the centre plus 2 squares inside each team's area (mirrored)", () => {
    const rules = { ...base, startFires: ["F6", "F7", "AE6", "AE7", "F28", "F29", "AE28", "AE29"] };
    const s = createState(list, rules, mulberry32(1));
    const lit = startGame(s, rules, T0);
    expect(lit.sort()).toEqual(["AE28", "AE29", "AE6", "AE7", "F28", "F29", "F6", "F7", "R17", "R18", "S17", "S18"].sort());
    const per: Record<string, number> = {};
    for (const l of lit) if (!["R17", "S17", "R18", "S18"].includes(l)) per[cells.get(l)!.sector] = (per[cells.get(l)!.sector] ?? 0) + 1;
    expect(per).toEqual({ ridge: 2, pine: 2, cedar: 2, birch: 2 });
  });
  it("startFiresAt: the in-area start fires are lit at that minute (skipping squares already blue), and the game can't end 'out' before", () => {
    const rules = { ...calm, startFires: ["F6", "F7", "AE6", "AE7"], startFiresAt: 1, lightningAt: [] };
    const s = createState(list, rules, mulberry32(1));
    expect(startGame(s, rules, T0).sort()).toEqual(["R17", "R18", "S17", "S18"]);
    expect(s.cells.F6).toBe("forest");
    s.cells.F7 = "water";
    for (const l of ["R17", "R18", "S17", "S18"]) s.cells[l] = "water"; // centre put out: no fire anywhere
    advance(s, rules, list, byPos, mulberry32(2), 59_000);
    expect(s.phase).toBe("live");
    expect(s.cells.F6).toBe("forest");
    const r = advance(s, rules, list, byPos, mulberry32(2), 1_000);
    expect(r.changed.sort()).toEqual(["AE6", "AE7", "F6"]);
    expect(s.cells.F6).toBe("fire");
    expect(s.cells.F7).toBe("water");
    expect(s.phase).toBe("live");
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
  it("advance: spreads every spreadSeconds; lightning at each lightningAt minute, once", () => {
    const r = { ...base, gameMinutes: 30, lightningAt: [2, 4, 6, 8] };
    const { s, rng } = live(r);
    advance(s, r, list, byPos, rng, 19_000);
    expect(s.spreads).toBe(0);
    advance(s, r, list, byPos, rng, 1_000);
    expect(s.spreads).toBe(1);
    for (let i = 0; i < 5; i++) advance(s, r, list, byPos, rng, 20_000); // to 2:00
    expect(s.stats.strikes).toHaveLength(1);
    for (let i = 0; i < 60; i++) advance(s, r, list, byPos, rng, 20_000);
    expect(s.stats.strikes).toHaveLength(4);
  });
  it("lightning is fair: 4 strikes hit 4 different teams' areas (shuffled), each on green ≥ lightningMinDistance from fire", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { s } = live(base, seed);
      const hit: Team[] = [];
      for (let i = 0; i < 4; i++) {
        const c = cells.get(strike(s, base, list, mulberry32(seed * 10 + i))!)!;
        hit.push(c.sector);
        // Distance from every OTHER fire (the centre and earlier strikes).
        const others = list.filter((f) => s.cells[f.label] === "fire" && f.label !== c.label);
        for (const f of others) expect(Math.max(Math.abs(f.col - c.col), Math.abs(f.row - c.row))).toBeGreaterThanOrEqual(6);
      }
      expect(new Set(hit).size).toBe(4);
      orders.add(hit.join(","));
    }
    expect(orders.size).toBeGreaterThan(3); // not always the same order
  });
});

describe("wind (off by default, kept behind rules.wind.enabled)", () => {
  const windy = { ...base, pSide: 0.5, pDiag: 0, wind: { enabled: true, pDown: 1, pUp: 0, turnAt: 5 } };
  it("on: downwind always catches, upwind never; off: the same rules spread evenly", () => {
    const s = createState(list, windy, mulberry32(1));
    s.phase = "live";
    s.wind = 2; // blowing east
    s.cells.F10 = "fire";
    s.burnLeft.F10 = 3;
    spread(s, windy, list, byPos, mulberry32(3));
    expect([s.cells.G10, s.cells.E10]).toEqual(["fire", "forest"]);
    const off = { ...windy, wind: { ...windy.wind, enabled: false }, pSide: 1 };
    const t = createState(list, off, mulberry32(1));
    t.wind = 2;
    t.cells.F10 = "fire";
    t.burnLeft.F10 = 3;
    spread(t, off, list, byPos, mulberry32(3));
    expect([t.cells.G10, t.cells.E10]).toEqual(["fire", "fire"]);
  });
  it("on: turns 45° once at turnAt; off: never turns", () => {
    const r = { ...windy, gameMinutes: 30, lightningAt: [] };
    const { s, rng } = live(r);
    const w0 = s.wind;
    advance(s, r, list, byPos, rng, 4 * 60_000 + 50_000);
    expect(s.wind).toBe(w0);
    advance(s, r, list, byPos, rng, 20_000);
    expect([1, 7]).toContain((s.wind - w0 + 8) % 8);
    const off = { ...r, wind: { ...r.wind, enabled: false } };
    const g = live(off);
    const g0 = g.s.wind;
    advance(g.s, off, list, byPos, g.rng, 10 * 60_000);
    expect([g.s.wind, g.s.windTurned]).toEqual([g0, false]);
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
    expect(s.phase).toBe("live"); // lightning still to come
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
    expect(rule("C10", C.fire)).toBe("color"); // orange in your own area
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
  it("one bucket per team: each blue square uses 1 from the painter's team; at 0 only that team is refused", () => {
    const { s } = live({ ...base, waterPerTeam: 1 });
    expect(paint(s, "r1", "C4", C.water).accept).toBe(true);
    expect(s.water).toEqual({ ridge: 0, pine: 1, cedar: 1, birch: 1 });
    const d = paint(s, "r2", "C5", C.water, T0 + 61_000);
    expect(d).toMatchObject({ rule: "water", feedback: expect.stringContaining("Team 1's water is empty") });
    expect(s.cells.C5).toBe("forest");
    expect(paint(s, "p1", "Z4", C.water).accept).toBe(true); // Team 2 still has its own
  });
});

describe("batches", () => {
  it("up to paintBatch squares in one go, then the cooldown; the 6th square of a batch is undone", () => {
    const r = { ...base, paintBatch: 5 };
    const { s } = live(r);
    const at = T0 + 60_000;
    const res = ["C4", "C5", "C6", "C7", "C8", "C9"].map((l, i) => paint(s, "r1", l, C.water, at + i * 300, r));
    expect(res.slice(0, 5).every((d) => d.accept)).toBe(true);
    expect(res[5]).toMatchObject({ accept: false, rule: "batch" });
    expect(s.cells.C9).toBe("forest");
    expect(paint(s, "r1", "D4", C.water, at + 4_000, r).rule).toBe("cooldown"); // a new batch too soon
    expect(paint(s, "r1", "D6", C.water, at + 5_000, r).accept).toBe(true); // a new batch, 5 s after the last began
    expect(s.water.ridge).toBe(400 - 6);
    // One poll (same batchId) is one batch even if its squares are more than 3 s apart.
    const b = (l: string, ms: number) => decidePaint(s, r, cells, { label: l, fill: C.water, userId: "r2", at: at + ms, batchId: 9 });
    expect([b("E4", 10_000).accept, b("E5", 13_500).accept]).toEqual([true, true]);
  });
  it("a new batch inside the cooldown is undone", () => {
    const r = { ...base, paintBatch: 5 };
    const { s } = live(r);
    expect(paint(s, "r1", "C4", C.water, T0 + 60_000, r).accept).toBe(true);
    expect(paint(s, "r1", "C5", C.water, T0 + 63_500, r).rule).toBe("cooldown"); // 3.5 s later: not the same batch, too soon
  });
});

describe("attack: start a fire in a neighbour's area (the human decision)", () => {
  const Q = "Start a fire in Team 2's area?";
  it("reads the question in plain words; old Spray/Grab forms are not questions", () => {
    for (const q of [Q, "start a fire in pine valley area", "START A FIRE IN PINE VALLEY", "Start a fire in Pine’s area?", "Start a fire in T2's area", `${Q}\nThe wind is right`]) {
      expect(stickyKind(q)).toBe("QUESTION");
      expect(questionTarget(q)).toBe("pine");
    }
    expect(questionTarget("Start a fire in Team 3's area")).toBe("cedar");
    for (const old of ["Spray water in Team 2's area?", "Grab squares in Team 2's area?"]) expect(stickyKind(old)).toBeNull();
    expect(stickyKind("Ana: paint N9 N10 N11")).toBe("ORDER");
  });
  it("needs a teammate's YES; then orange on up to attackSquares green squares in that neighbour's area, for attackMinutes", () => {
    const { s, rng } = live();
    expect(paint(s, "r2", "Z4", C.fire, T0 + 10_000).rule).toBe("area");
    expect(sticky(s, "q1", "ridge", `${Q}\nYES`, "r1", "r1")[0]?.line).toContain("did not post it");
    sticky(s, "q1", "ridge", `${Q}\nYES`, "r1", "p1"); // answered by another team: no
    expect(s.attacks).toHaveLength(0);
    const ok = sticky(s, "q1", "ridge", `${Q}\nYES`, "r1", "r2");
    expect(s.attacks).toMatchObject([{ team: "ridge", to: "pine", until: 120_000, left: 3 }]);
    expect(ok.find((n) => n.userId === "r1")?.line).toContain("paint orange #ff5a1f on up to 3 green squares in Team 2's area");
    expect(ok.find((n) => n.userId === "p1")?.line).toContain("Team 1 may set fire to your area");
    let at = T0 + 20_000;
    expect(paint(s, "r2", "Z4", C.water, (at += 6000)).rule).toBe("area"); // blue never outside
    s.cells.Z9 = "water";
    expect(paint(s, "r2", "Z9", C.fire, (at += 6000)).rule).toBe("square"); // only green
    for (const l of ["Z4", "Z5", "Z6"]) expect(paint(s, l === "Z5" ? "r1" : "r2", l, C.fire, (at += 6000)).accept).toBe(true);
    expect(s.water.ridge).toBe(400); // orange costs no water
    expect(paint(s, "r1", "Z7", C.fire, (at += 6000)).rule).toBe("attack"); // the 3-square cap
    expect(["Z4", "Z5", "Z6"].map((l) => [s.cells[l], s.origin[l]])).toEqual(Array(3).fill(["fire", "ridge"]));
    expect(s.stats.lit.ridge).toBe(3);
    expect(s.events.some((e) => e.text === "🔥 Team 1 set fire to Team 2's area!")).toBe(true);
    expect(paint(s, "r2", "C30", C.fire, (at += 6000)).rule).toBe("area"); // Team 3 is not under attack
    expect(paint(s, "c1", "Z8", C.fire, (at += 6000)).rule).toBe("area"); // only Team 1 may
    // Remembered once seen: a later NO doesn't take it back. Ends after attackMinutes.
    sticky(s, "q1", "ridge", `${Q}\nNO`, "r1", "r2");
    expect(s.approvals.q1?.status).toBe("approved");
    const adv = advance(s, calm, list, byPos, rng, 121_000);
    expect(adv.ended).toMatchObject([{ team: "ridge", to: "pine" }]);
    expect(s.attacks).toHaveLength(0);
  });
  it("at most attacksPerTeam approved attacks per team per game", () => {
    const { s } = live();
    expect(sticky(s, "a", "ridge", `${Q}\nYES`, "r1", "r2")).not.toHaveLength(0);
    sticky(s, "b", "ridge", "Start a fire in Team 3's area?\nYES", "r1", "r2");
    expect(s.attacksUsed.ridge).toBe(2);
    const third = sticky(s, "c", "ridge", `${Q}\nYES`, "r1", "r2");
    expect(third[0]?.line).toContain("used its 2 attacks");
    expect(s.attacks).toHaveLength(2);
    expect(pendingStickies(s, [{ id: "d", team: "ridge", text: Q, createdBy: "r1", modifiedBy: "r1" }], base).ridge).toEqual([]); // nothing left to ask
  });
  it("only neighbours, only in the team's own Orders", () => {
    const { s } = live();
    expect(sticky(s, "q", "ridge", "Start a fire in Team 4's area?\nYES", "r1", "r2")[0]?.line).toContain("Ask about a neighbour");
    expect(sticky(s, "q2", "pine", "Start a fire in Team 3's area?\nYES", "r1", "p1")[0]?.line).toContain("your own team's Orders");
    expect(s.attacks).toHaveLength(0);
  });
  it("NO refuses (and a later YES overturns it)", () => {
    const { s } = live();
    const notes = sticky(s, "q", "cedar", "Start a fire in Team 4 area?\nNO", "c1", "c2");
    expect(s.approvals.q?.status).toBe("refused");
    expect(notes[0]?.line).toContain("Cal said NO");
    sticky(s, "q", "cedar", "Start a fire in Team 4 area?\nNO\nYES", "c1", "c2");
    expect(s.attacks).toMatchObject([{ team: "cedar", to: "birch" }]);
  });
  it("waiting list in plain words; skips non-players' examples; a refused question rewritten without NO waits again", () => {
    const { s } = live();
    const ex = { id: "ex", team: "ridge" as const, text: Q, createdBy: "instructor", modifiedBy: "instructor" };
    sticky(s, "q", "ridge", `${Q}\nNO`, "r1", "r2");
    expect(pendingStickies(s, [ex, { id: "q", team: "ridge", text: `${Q}\nNO`, createdBy: "r1", modifiedBy: "r2" }]).ridge).toEqual([]);
    expect(pendingStickies(s, [{ id: "q", team: "ridge", text: Q, createdBy: "r1", modifiedBy: "r1" }]).ridge).toEqual(["start a fire in Team 2's area"]);
  });
  it("origin: a team's fire passes its origin on when it spreads, keeps it when it burns out; burned trees and blowback are counted", () => {
    const rules = { ...base, pSide: 1, pDiag: 0, burnTicks: 1 };
    const { s } = live(rules);
    s.cells.R5 = "fire"; // Team 1's area, at the border with Team 2 (S)
    s.burnLeft.R5 = 1;
    s.origin.R5 = "pine"; // lit by Team 2
    spread(s, rules, list, byPos, mulberry32(1));
    expect(["Q5", "S5", "R4", "R6"].map((l) => s.origin[l])).toEqual(["pine", "pine", "pine", "pine"]);
    expect([s.cells.R5, s.origin.R5]).toEqual(["burnt", "pine"]);
    expect(s.stats.burnedOthers.pine).toBe(1); // R5 is Team 1's tree
    spread(s, rules, list, byPos, mulberry32(2));
    expect(s.stats.blowback.pine).toBeGreaterThanOrEqual(1); // S5 is Team 2's own tree: blowback
    // Wild fire stays wild.
    expect(s.origin.R17).toBeUndefined();
  });
});

describe("score", () => {
  it("green squares left in the team's own area, as % of 306 (blue doesn't score)", () => {
    const { s } = live();
    expect(s.startScore.ridge).toBe(306);
    expect(scores(s, list).ridge.points).toBe(305); // R17 is burning
    s.cells.C4 = "water";
    s.cells.C5 = "burnt";
    s.cells.C6 = "fire";
    const sc = scores(s, list);
    expect(sc.ridge.points).toBe(302);
    expect(sc.ridge.pct).toBe(Math.round((100 * 302) / 306));
    expect(sc.ridge.fire).toBe(2);
  });
});
