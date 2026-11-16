// Last team standing (rules.lastTeamStanding): no clock; a team with no green square left is OUT; the last team
// with green wins. New fires keep coming in every surviving team's area every newFireEveryMinutes.
import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { FakeBoard } from "../src/fake-board.js";
import { buildCells, type Team } from "../src/layout.js";
import { Referee, emptyGame } from "../src/referee.js";
import {
  advance, aliveTeams, applyJoin, createState, decidePaint, judgeSticky, mulberry32, pendingStickies, rankTeams, scores, spread, startGame, stopGame, type GameState, type RuleSet,
} from "../src/rules.js";

const base: RuleSet = {
  spreadSeconds: 20, pSide: 0, pDiag: 0, burnTicks: 3, lightningAt: [5], lightningMinDistance: 6, startFires: [], paintBatch: 1,
  waterPerTeam: 400, cooldownSeconds: 5, timeoutSeconds: 5, attackMinutes: 2, attackSquares: 3, attacksPerTeam: 2, gameMinutes: 10,
  lastTeamStanding: true, newFireEveryMinutes: 2,
};
const list = buildCells();
const cells = new Map(list.map((c) => [c.label, c]));
const byPos = new Map(list.map((c) => [`${c.col},${c.row}`, c]));
const T0 = 1_000_000;
const SEATS = [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"], ["p2", "Pia"], ["c2", "Cal"], ["b2", "Ben"]] as const;

function live(rules = base, seed = 1) {
  const rng = mulberry32(seed);
  const s = createState(list, rules, rng);
  for (const [u, name] of SEATS) applyJoin(s, { userId: u, name, at: T0 }, undefined);
  startGame(s, rules, T0);
  return { s, rng, step: (ms: number) => advance(s, rules, list, byPos, rng, ms, T0 + s.elapsed + ms) };
}

/** Leave n green squares in a team's area (the rest burnt). */
function keepGreen(s: GameState, team: Team, n: number) {
  const green = list.filter((c) => c.sector === team && s.cells[c.label] === "forest");
  for (const c of green.slice(n)) s.cells[c.label] = "burnt";
}
const green = (s: GameState, t: Team) => scores(s, list)[t].points;
const texts = (s: GameState) => s.events.map((e) => e.text);

describe("last team standing: going out", () => {
  it("a team with no green left is OUT: event, its paints undone with no water used, it can't attack or be attacked", () => {
    const { s, step } = live();
    keepGreen(s, "pine", 0);
    step(1000);
    expect(s.outTeams?.map((o) => o.team)).toEqual(["pine"]);
    expect(texts(s)).toContain("TEAM 2 IS OUT!");
    expect(aliveTeams(s)).toEqual(["ridge", "cedar", "birch"]);
    expect(s.phase).toBe("live");
    // Its player's paint: undone, the bucket untouched.
    const w = s.water.pine;
    const d = decidePaint(s, base, cells, { label: "S17", fill: "#2563eb", userId: "p1", at: T0 + 60_000 });
    expect(d.accept).toBe(false);
    expect(d.feedback).toContain("your team is out");
    expect(s.water.pine).toBe(w);
    // Team 1 can't ask to attack the out Team 2; Team 2 can't ask at all; nothing listed as waiting.
    const ask = judgeSticky(s, base, { id: "q1", team: "ridge", text: "Start a fire in Team 2's area?\nYES", createdBy: "r1", modifiedBy: "r2" });
    expect(ask[0]?.line).toMatch(/neighbour that is playing/);
    expect(s.attacks).toEqual([]);
    const own = judgeSticky(s, base, { id: "q2", team: "pine", text: "Start a fire in Team 1's area?\nYES", createdBy: "p1", modifiedBy: "p2" });
    expect(own[0]?.line).toContain("out");
    expect(s.attacks).toEqual([]);
    const pend = pendingStickies(s, [
      { id: "q3", team: "ridge", text: "Start a fire in Team 2's area?", createdBy: "r1", modifiedBy: "r1" },
      { id: "q4", team: "pine", text: "Start a fire in Team 1's area?", createdBy: "p1", modifiedBy: "p1" },
    ]);
    expect(pend.ridge).toEqual([]);
    expect(pend.pine).toEqual([]);
  });

  it("a running attack on a team that goes out stops; orange on an out team's area is undone", () => {
    const { s, step } = live();
    s.attacks.push({ sticky: "x", team: "ridge", to: "pine", until: 120_000, left: 3, lit: 0 });
    keepGreen(s, "pine", 1);
    const last = list.find((c) => c.sector === "pine" && s.cells[c.label] === "forest")!.label;
    s.cells[last] = "burnt";
    step(1000);
    expect(s.attacks).toEqual([]);
    s.cells[last] = "forest"; // even a green square there (by hand) can't be attacked
    const d = decidePaint(s, base, cells, { label: last, fill: "#f97316", userId: "r1", at: T0 + 60_000 });
    expect(d.accept).toBe(false);
  });

  it("the game ends when one team is left: it wins, GAME OVER event, out order kept", () => {
    const { s, step } = live();
    keepGreen(s, "pine", 0);
    step(1000);
    keepGreen(s, "cedar", 0);
    step(20_000);
    expect(s.phase).toBe("live");
    keepGreen(s, "birch", 0);
    step(20_000);
    expect(s.phase).toBe("over");
    expect(s.endReason).toBe("last");
    expect(s.winner).toBe("ridge");
    expect(s.winners).toEqual(["ridge"]);
    expect(s.outTeams!.map((o) => o.team)).toEqual(["pine", "cedar", "birch"]);
    expect(texts(s).at(-1)).toMatch(/^GAME OVER · TEAM 1 IS THE LAST TEAM STANDING \(\d+%\)$/);
    expect(rankTeams(s, list)).toEqual(["ridge", "birch", "cedar", "pine"]);
  });

  it("the last teams going out in the same step: most green at the start of that step wins; equal = shared win", () => {
    const a = live();
    keepGreen(a.s, "ridge", 0);
    keepGreen(a.s, "pine", 0);
    a.step(1000);
    keepGreen(a.s, "cedar", 5);
    keepGreen(a.s, "birch", 3);
    a.step(1000); // the check at the end of this step remembers 5 and 3
    keepGreen(a.s, "cedar", 0);
    keepGreen(a.s, "birch", 0);
    a.step(1000);
    expect(a.s.phase).toBe("over");
    expect(a.s.winners).toEqual(["cedar"]);

    const b = live();
    keepGreen(b.s, "ridge", 0);
    keepGreen(b.s, "pine", 0);
    keepGreen(b.s, "cedar", 4);
    keepGreen(b.s, "birch", 4);
    b.step(1000);
    keepGreen(b.s, "cedar", 0);
    keepGreen(b.s, "birch", 0);
    b.step(1000);
    expect(b.s.phase).toBe("over");
    expect(b.s.winners).toEqual(["cedar", "birch"]);
    expect(texts(b.s).at(-1)).toBe("GAME OVER · TEAM 3 AND TEAM 4 SHARE THE WIN");
  });
});

describe("last team standing: no clock", () => {
  it("gameMinutes and a fire that is out don't end the game; new fires come every 2 minutes in every surviving area", () => {
    const { s, step } = live({ ...base, gameMinutes: 3 });
    for (const l of ["R17", "S17", "R18", "S18"]) s.cells[l] = "burnt"; // the fire is out
    keepGreen(s, "pine", 0);
    step(1000);
    step(119_000); // minute 2: the first round
    expect(s.phase).toBe("live");
    expect(s.stats.strikes).toHaveLength(3);
    const sectors = s.stats.strikes.map((l) => cells.get(l)!.sector).sort();
    expect(sectors).toEqual(["birch", "cedar", "ridge"]);
    expect(texts(s).some((t) => t.startsWith("NEW FIRE IN EVERY TEAM'S AREA!"))).toBe(true);
    for (const l of s.stats.strikes) s.cells[l] = "burnt"; // put out again
    step(5 * 60_000); // minutes 4 and 6, past gameMinutes
    expect(s.phase).toBe("live");
    expect(s.stats.strikes).toHaveLength(9);
  });

  it("stop: the surviving team with the most green wins (ties shared); an out team never does", () => {
    const { s, step } = live();
    keepGreen(s, "pine", 0);
    step(1000);
    keepGreen(s, "ridge", 50);
    keepGreen(s, "cedar", 50);
    keepGreen(s, "birch", 20);
    stopGame(s, list, T0 + 5000, base);
    expect(s.endReason).toBe("stopped");
    expect(s.winners).toEqual(["ridge", "cedar"]);
    expect(texts(s).at(-1)).toBe("GAME OVER · TEAM 1 AND TEAM 3 SHARE THE WIN");
  });

  it("rules.maxMinutes: a safety cap that ends the game like stop", () => {
    const { s, step } = live({ ...base, maxMinutes: 3 });
    keepGreen(s, "birch", 10);
    step(3 * 60_000);
    expect(s.phase).toBe("over");
    expect(s.endReason).toBe("cap");
    expect(s.winners).toHaveLength(3);
    expect(s.winners).not.toContain("birch");
  });

  it("equal spread counts only the surviving teams", () => {
    const rules = { ...base, pSide: 1, equalSpread: true, fireStaysInArea: true };
    const { s, rng, step } = live(rules);
    for (const l of ["R17", "S17", "R18", "S18"]) s.cells[l] = "burnt";
    keepGreen(s, "cedar", 0);
    keepGreen(s, "birch", 0);
    step(1000);
    expect(aliveTeams(s)).toEqual(["ridge", "pine"]);
    s.cells.E5 = "fire";
    s.cells.Y5 = "fire";
    const before = { ridge: green(s, "ridge"), pine: green(s, "pine") };
    spread(s, rules, list, byPos, rng);
    // Each fire lights its 4 sides; averaged over all four teams it would be cut to 2 each.
    expect(before.ridge - green(s, "ridge")).toBe(4);
    expect(before.pine - green(s, "pine")).toBe(4);
  });

  it("the timed mode is unchanged: no OUT, the game ends at gameMinutes", () => {
    const rules = { ...base, lastTeamStanding: false };
    const { s, step } = live(rules);
    keepGreen(s, "pine", 0);
    step(60_000);
    expect(s.outTeams ?? []).toEqual([]);
    step(10 * 60_000);
    expect(s.phase).toBe("over");
    expect(s.endReason).not.toBe("last");
  });
});

describe("last team standing: what the projector shows", () => {
  function game() {
    let t = 1_000_000;
    const ref = new Referee(FakeBoard.seeded(() => t), emptyGame(), base, { now: () => t, log: () => {}, rng: mulberry32(7) });
    const s = ref.state;
    for (const [u, name] of SEATS) applyJoin(s, { userId: u, name, at: t }, undefined);
    startGame(s, base, t);
    const step = (ms: number) => {
      t += ms;
      advance(s, base, list, byPos, mulberry32(3), ms, t);
    };
    return { ref, s, step, banner: () => stripHtml(ref.bannerHtml()).trim(), scoreboard: () => stripHtml(ref.scoreboardHtml()).trim() };
  }

  it("banner: time played, TEAMS LEFT, next new fires, water (OUT for an out team); no time left or FINAL MINUTE", () => {
    const g = game();
    g.step(30_000);
    expect(g.banner()).toMatch(/^LIVE · 0:30 played · TEAMS LEFT 4\/4 · NEW FIRES in 1:30 · next spread \d+s · WATER T1 400 · T2 400 · T3 400 · T4 400/);
    keepGreen(g.s, "pine", 0);
    g.step(1000);
    expect(g.banner()).toContain("TEAMS LEFT 3/4");
    expect(g.banner()).toContain("T2 OUT");
    g.s.elapsed = 9.5 * 60_000;
    expect(g.banner()).not.toMatch(/FINAL MINUTE|left ·|\d:\d\d left/);
    expect(g.scoreboard()).toContain("TEAM 2 OUT");
    // The out team is ranked last on the leaderboard, its row says OUT, its badge OUT.
    expect(g.ref.rankOrder().at(-1)).toBe("pine");
    expect(stripHtml(g.ref.rowHtml(4))).toMatch(/^TEAM 2 · OUT at 0:30/);
    expect(stripHtml(g.ref.badgeHtml(4))).toBe("OUT");
  });

  it("game over banner and results: the winner, the order teams went out with their times", () => {
    const g = game();
    // (a team emptied between steps is seen at the start of the next step: at the game time it was emptied)
    g.step(60_000);
    keepGreen(g.s, "pine", 0);
    g.step(60_000);
    keepGreen(g.s, "cedar", 0);
    g.step(60_000);
    keepGreen(g.s, "ridge", 0);
    g.step(1000);
    expect(g.s.phase).toBe("over");
    expect(g.banner()).toMatch(/^GAME OVER · TEAM 4 IS THE LAST TEAM STANDING \(\d+%\)/);
    expect(g.banner()).toContain("TEAM 2 OUT 1:00 · TEAM 3 OUT 2:00 · TEAM 1 OUT 3:00 · 3:00 played");
    const res = g.ref.resultsText();
    expect(res.split("\n")[0]).toMatch(/^🏆 TEAM 4 IS THE LAST TEAM STANDING/);
    expect(res).toContain("went out: 1. Team 2 at 1:00 · 2. Team 3 at 2:00 · 3. Team 1 at 3:00");
  });
});
