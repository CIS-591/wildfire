// One test per line of test/ATTACKS.md (the id in each test name). A last test checks that every id in
// ATTACKS.md has a test here.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { loadGame, saveGame } from "../src/config.js";
import { FIXTURES, GRID_BOX, ORDERS, PANELS, center, frameBoxes, inside, teamByName } from "../src/layout.js";
import { acquireLock, releaseLock } from "../src/lock.js";
import { emptyGame } from "../src/referee.js";
import { judgeSticky, mulberry32, questionTarget } from "../src/rules.js";
import { C, CALM, RULES, expectConverged, setup } from "./harness.js";

const T = (id: string, name: string) => `${id} ${name}`;

describe("paints", () => {
  it(T("A01", "any non-blue color is undone with the reason"), async () => {
    const g = await setup({ live: true });
    const colors = [C.fire, C.burnt, "#ff0000", "#FFFFFF", "", "transparent", "#3AA7FF00", "red"];
    for (const [i, col] of colors.entries()) {
      g.fake.playerPaint("r2", `C${i + 2}`, col);
      g.advance(6000);
    }
    await g.ticks(2);
    for (let i = 0; i < colors.length; i++) expect(g.fill(`C${i + 2}`)).toBe(C.forest);
    expect(g.card("r2")).toContain("paint only blue");
    expect(g.ref.state.water).toBe(400);
  });
  it(T("A02", "blue on blue changes nothing and costs no water"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(6000);
    g.fake.playerPaint("r1", "C4", C.water);
    await g.tick(6000);
    expect(g.ref.state.water).toBe(399);
    expect(g.ref.state.stats.byPlayer.r1!.water).toBe(0);
  });
  it(T("A03", "blue on a burnt square is undone"), async () => {
    const g = await setup({ live: true });
    g.ref.state.cells.C4 = "burnt";
    await g.tick();
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick();
    expect(g.fill("C4")).toBe(C.burnt);
    expect(g.ref.state.stats.illegal.square).toBe(1);
  });
  it(T("A04", "blue in another team's area without a YES is undone"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "Z4", C.water);
    await g.tick();
    expect(g.fill("Z4")).toBe(C.forest);
    expect(g.card("r2")).toContain("it is Team 2's area");
  });
  it(T("A05", "blue in a neighbour's area counts only while a YES runs"), async () => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "ridge", "Spray water in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    g.fake.playerPaint("r2", "Z4", C.water);
    await g.tick();
    expect(g.fill("Z4")).toBe(C.water);
    await g.ticks(41); // 2 minutes later
    g.fake.playerPaint("r2", "Z5", C.water);
    await g.tick();
    expect(g.fill("Z5")).toBe(C.forest);
    // Team 3 is not Team 1's neighbour grant: Team 1 still can't paint there.
    g.fake.playerPaint("r1", "C30", C.water);
    await g.tick(6000);
    expect(g.fill("C30")).toBe(C.forest);
  });
  it(T("A06", "paints before LIVE are undone"), async () => {
    const g = await setup();
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick();
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.card("r2")).toContain("hasn't started");
  });
  it(T("A07", "paints after OVER are undone and the referee keeps guarding"), async () => {
    const g = await setup({ live: true });
    await g.ref.stop();
    g.fake.playerPaint("r2", "C4", C.water);
    const sq = g.sq("D4");
    g.fake.playerEdit("r1", sq.id, { x: sq.x + 100 });
    await g.ticks(2);
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.card("r2")).toContain("game is over");
    expectConverged(g);
  });
  it(T("A08", "a user who never joined can't paint"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("stranger", "C4", C.water);
    await g.tick();
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.ref.state.stats.illegal.unjoined).toBe(1);
  });
  it(T("A09", "faster than the cooldown is undone"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(3000);
    g.fake.playerPaint("r2", "C5", C.water);
    await g.tick(3000);
    expect(g.fill("C5")).toBe(C.forest);
    expect(g.card("r2")).toContain("wait 5 s");
  });
  it(T("A10", "many paints in one poll by one player: only the first counts"), async () => {
    const g = await setup({ live: true });
    for (let i = 1; i <= 30; i++) g.fake.playerPaint("r2", `D${i % 17 || 17}`, C.water, g.now() + i);
    g.fake.playerPaint("r2", "E1", C.water, g.now());
    await g.tick();
    expect(g.ref.state.stats.byPlayer.r2!.water).toBe(1);
    await g.ticks(2);
    expectConverged(g);
  });
  it(T("A11", "painting water back to green or orange is undone"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(6000);
    g.fake.playerPaint("r1", "C4", C.forest);
    await g.tick(6000);
    expect(g.fill("C4")).toBe(C.water);
    g.fake.playerPaint("r1", "C4", C.fire);
    await g.tick(6000);
    expect(g.fill("C4")).toBe(C.water);
  });
  it(T("A12", "painting fire green (not blue) is undone"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r1", "R17", C.forest);
    await g.tick();
    expect(g.fill("R17")).toBe(C.fire);
  });
  it(T("A13", "with the shared water at 0 every paint is undone"), async () => {
    const g = await setup({ live: true });
    g.ref.state.water = 0;
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick();
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.card("r2")).toContain("all used up");
  });
  it(T("A14", "a player of another team painting your area is undone"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("c1", "C4", C.water);
    await g.tick();
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.ref.state.stats.byPlayer.c1!.illegal.area).toBe(1);
  });
  it(T("A15", "a frozen player's paint is undone"), async () => {
    const g = await setup({ live: true });
    const sq = g.sq("D4");
    g.fake.playerEdit("r2", sq.id, { x: sq.x + 40 });
    await g.tick();
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(1000);
    expect(g.fill("C4")).toBe(C.forest);
    expect(g.card("r2")).toContain("frozen");
  });
  it(T("A16", "paints made while no referee watched are undone on restart"), async () => {
    const g = await setup({ live: true });
    const saved = JSON.parse(JSON.stringify(g.game));
    g.fake.playerPaint("r2", "C4", C.water);
    const g2 = await setup({ fake: g.fake, game: saved, t0: g.now() + 60_000 });
    await g2.tick();
    expect(g2.fill("C4")).toBe(C.forest);
    expect(g2.card("r2")).toContain("no referee was watching");
  });
});

describe("squares", () => {
  it(T("A20", "a deleted square is rebuilt on the second read, in its frame, with the engine's color"), async () => {
    const g = await setup({ live: true });
    g.ref.state.cells.C4 = "water";
    await g.tick();
    const old = g.sq("C4").id;
    g.fake.playerDelete(old);
    await g.tick();
    expect(g.ref.cellId.has("C4")).toBe(true); // one read: maybe a partial page
    await g.tick();
    expect(g.sq("C4").id).not.toBe(old);
    expect(g.sq("C4").parentId).toBe(g.fake.gridFrameIds[0]);
    expectConverged(g);
  });
  it(T("A21", "whole rows deleted are rebuilt in batches within the write cap"), async () => {
    const g = await setup({ live: true });
    for (const c of g.ref.cellList.filter((c) => c.row >= 4 && c.row < 7)) g.fake.playerDelete(g.ref.cellId.get(c.label)!);
    await g.ticks(4);
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
    expectConverged(g);
  });
  it(T("A22", "a moved square is replaced and the mover frozen"), async () => {
    const g = await setup({ live: true });
    const sq = g.sq("D5");
    g.fake.playerEdit("r1", sq.id, { x: sq.x + 20 });
    await g.ticks(2);
    expect(g.fake.items.has(sq.id)).toBe(false);
    expect(g.card("r1")).toContain("frozen for 5 s");
    expectConverged(g);
  });
  it(T("A23", "a square dragged out of its frame is replaced and the stray copy removed"), async () => {
    const g = await setup({ live: true, fast: true });
    const sq = g.sq("D5");
    g.fake.playerEdit("r1", sq.id, { x: 3000, y: -2000 });
    await g.ticks(8);
    expect(g.fake.items.has(sq.id)).toBe(false);
    expectConverged(g);
  });
  it(T("A24", "a resized square is replaced"), async () => {
    const g = await setup({ live: true });
    const sq = g.sq("D5");
    g.fake.playerEdit("r1", sq.id, { w: 300, h: 300 });
    await g.ticks(2);
    expect(g.card("r1")).toContain("resized");
    expectConverged(g);
  });
  it(T("A25", "a rotated square is replaced"), async () => {
    const g = await setup({ live: true });
    g.fake.playerEdit("r1", g.sq("D5").id, { rotation: 45 });
    await g.ticks(2);
    expect(g.card("r1")).toContain("rotated");
    expectConverged(g);
  });
  it(T("A26", "a square whose label was typed over is replaced"), async () => {
    const g = await setup({ live: true });
    g.fake.playerEdit("r1", g.sq("D5").id, { content: "LOL" });
    g.fake.playerEdit("p1", g.sq("Z5").id, { content: "Z6" });
    await g.ticks(2);
    expect(g.card("r1")).toContain("edited");
    expectConverged(g);
  });
  it(T("A27", "a fake copy of a square dropped on the grid is removed"), async () => {
    const g = await setup({ live: true });
    const real = g.sq("D5");
    g.fake.vandalAdd("r1", "shape", { x: real.x, y: real.y, w: 60, h: 60 }, "D5", C.water);
    await g.ticks(2);
    expect(g.sq("D5").id).toBe(real.id);
    expectConverged(g);
  });
  it(T("A28", "a locked square: after 3 refused writes a new square goes on top; the old one goes once unlocked"), async () => {
    const g = await setup({ live: true });
    const sq = g.sq("D5");
    g.fake.playerPaint("r1", "D5", "#ff0000");
    g.fake.lock(sq.id);
    await g.ticks(6);
    expect(g.sq("D5").id).not.toBe(sq.id);
    expect(g.fake.cell("D5").fill).toBe(C.forest); // the one on top
    expect(g.logs.join("\n")).toMatch(/D5 refuses writes/);
    expectConverged(g, { allowStuck: true });
    g.fake.unlock(sq.id);
    await g.ticks(20);
    expect(g.fake.items.has(sq.id)).toBe(false);
    expectConverged(g);
  });
});

describe("frames", () => {
  it(T("A30", "a deleted grid band (and its 144 squares) is recreated and refilled"), async () => {
    for (const fast of [false, true]) {
      const g = await setup({ live: true, fast });
      const old = g.fake.gridFrameIds[2]!;
      g.fake.deleteFrame(old);
      await g.ticks(6);
      expect(g.ref.frameIds[2]).not.toBe(old);
      expect(g.sq("A9").parentId).toBe(g.ref.frameIds[2]);
      expectConverged(g);
      expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
    }
  });
  it(T("A31", "a moved grid band is moved back with its squares; no square is replaced"), async () => {
    const g = await setup({ live: true });
    const creates = g.fake.calls.create;
    g.fake.moveFrame("r1", g.fake.gridFrameIds[1]!, 500, 300);
    await g.ticks(2);
    expect(g.fake.calls.create).toBe(creates);
    expect(g.card("r1")).toContain("a row of the forest");
    expectConverged(g);
  });
  it(T("A32", "a resized grid band is resized back"), async () => {
    const g = await setup({ live: true });
    const id = g.fake.gridFrameIds[1]!;
    g.fake.resizeFrame("r1", id, 100, 100);
    await g.ticks(2);
    expect(g.fake.frames.get(id)!.w).toBe(frameBoxes()[1]!.w);
  });
  it(T("A33", "a deleted Orders frame is recreated; approvals already given stay"), async () => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "ridge", "Spray water in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    const old = g.fake.ordersFrameIds.ridge;
    g.fake.deleteFrame(old);
    await g.ticks(3);
    const f = [...g.fake.frames.values()].find((x) => inside(ORDERS.ridge, x.x, x.y));
    expect(f && f.id !== old).toBe(true);
    expect(g.ref.state.outside.some((o) => o.team === "ridge" && o.to === "pine")).toBe(true);
  });
  it(T("A34", "a moved Orders frame is moved back"), async () => {
    const g = await setup({ live: true });
    const id = g.fake.ordersFrameIds.pine;
    g.fake.moveFrame("p1", id, 900, 0);
    await g.ticks(2);
    expect(g.fake.frames.get(id)!.x).toBe(center(ORDERS.pine).x);
  });
  it(T("A35", "a new frame drawn over the forest is removed"), async () => {
    const g = await setup({ live: true });
    const id = g.fake.addFrame({ x: 100, y: 100, w: 500, h: 500 }, "#ff0000", "MINE", "r1");
    await g.ticks(2);
    expect(g.fake.frames.has(id)).toBe(false);
  });
});

describe("fixtures and panels", () => {
  it(T("A40", "deleted banner, scoreboard and leaderboard are recreated with live text"), async () => {
    const g = await setup({ live: true });
    for (const k of ["banner", "scoreboard", "leaderboard"] as const) g.fake.playerDelete(g.game.fixtureIds[k]!);
    await g.ticks(3);
    expect(g.fx("banner")).toContain("LIVE");
    expect(g.fx("scoreboard")).toContain("TEAM 1");
    expect(g.fx("leaderboard")).toContain("LEADERBOARD");
    expectConverged(g);
  });
  it(T("A41", "an edited banner is rewritten and the editor frozen"), async () => {
    const g = await setup({ live: true });
    g.fake.playerEdit("p1", g.game.fixtureIds.banner!, { content: "TEAM 2 WINS LOL" });
    await g.tick();
    expect(g.fx("banner")).toContain("LIVE");
    expect(g.card("p1")).toContain("the banner (edited)");
  });
  it(T("A42", "moved, resized or rotated fixtures are put back"), async () => {
    const g = await setup({ live: true });
    const id = g.game.fixtureIds.scoreboard!;
    const before = { ...g.fake.items.get(id)! };
    g.fake.playerEdit("p1", id, { x: before.x + 400, w: 10 });
    g.fake.playerEdit("c1", g.game.fixtureIds.leaderboard!, { rotation: 90 });
    await g.ticks(2);
    const after = g.fake.items.get(id)!;
    expect([after.x, after.w]).toEqual([before.x, before.w]);
    expect(g.fake.items.get(g.game.fixtureIds.leaderboard!)!.rotation).toBe(0);
  });
  it(T("A43", "a locked banner gets a new banner on top and a log line to unlock it"), async () => {
    const g = await setup({ live: true });
    const old = g.game.fixtureIds.banner!;
    g.fake.lock(old);
    await g.ticks(6);
    expect(g.game.fixtureIds.banner).not.toBe(old);
    expect(g.fx("banner")).toContain("LIVE");
    expect(g.logs.join("\n")).toMatch(/Unlock/);
  });
  it(T("A44", "static panels: edits and moves put back, deletes logged (never rebuilt over the forest)"), async () => {
    const g = await setup({ live: true, statics: true });
    const [backdrop, title, rules] = g.fake.staticIds as [string, string, string];
    const tx = g.fake.items.get(title)!.x;
    g.fake.playerEdit("r1", title, { content: "HACKED", x: tx + 300 });
    g.fake.playerDelete(rules);
    await g.ticks(2);
    expect(stripHtml(g.fake.items.get(title)!.content)).toContain("WILDFIRE");
    expect(g.fake.items.get(title)!.x).toBe(tx);
    expect(g.fake.items.has(backdrop)).toBe(true);
    expect(g.logs.join("\n")).toMatch(/was deleted; it can't be rebuilt/);
  });
});

describe("covering the board", () => {
  it(T("A50", "a giant shape or image over the forest is removed; the board's own backdrop stays"), async () => {
    const g = await setup({ live: true });
    const cover = g.fake.vandalAdd("r1", "image", { x: 1150, y: 1090, w: 3000, h: 3000 });
    const cover2 = g.fake.vandalAdd("r2", "shape", { x: 5000, y: 1000, w: 6000, h: 400 }, "", "#000000"); // centred off the grid, still over it
    await g.ticks(2);
    expect(g.fake.items.has(cover.id) || g.fake.items.has(cover2.id)).toBe(false);
    expect(g.fake.items.has(g.fake.staticIds[0]!)).toBe(true);
    expectConverged(g);
  });
  it(T("A51", "stickies, texts and images dropped on the forest are removed and the dropper frozen"), async () => {
    const g = await setup({ live: true });
    for (const type of ["sticky_note", "text", "image", "shape", "connector"]) g.fake.vandalAdd("c1", type, { x: 600, y: 600, w: 100, h: 100 }, "hi");
    await g.ticks(2);
    expect(g.card("c1")).toContain("Removed an item on the forest");
    expectConverged(g);
  });
  it(T("A52", "junk dropped over the banner is removed"), async () => {
    const g = await setup({ live: true });
    const b = center(FIXTURES.banner);
    const j = g.fake.vandalAdd("p1", "sticky_note", { ...b, w: 200, h: 200 }, "LOL");
    await g.tick();
    expect(g.fake.items.has(j.id)).toBe(false);
  });
  it(T("A53", "locked junk: deletion retried with backoff, not every poll"), async () => {
    const g = await setup({ live: true });
    const j = g.fake.vandalAdd("p1", "image", { x: 600, y: 600, w: 100, h: 100 });
    g.fake.lock(j.id);
    const d0 = g.fake.calls.delete;
    await g.ticks(40);
    expect(g.fake.calls.delete - d0).toBeLessThanOrEqual(8);
    g.fake.unlock(j.id);
    await g.ticks(20);
    expect(g.fake.items.has(j.id)).toBe(false);
  });
});

describe("the spray question", () => {
  const ask = async (text = "Spray water in Team 2's area?") => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "ridge", text);
    await g.tick();
    return { g, q };
  };
  it(T("A60", "a YES on your own question does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r1", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.outside).toEqual([]);
    expect(g.card("r1")).toContain("did not post it");
  });
  it(T("A61", "a YES from another team does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("p1", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.outside).toEqual([]);
  });
  it(T("A62", "a YES from someone who never joined does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("guest", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.outside).toEqual([]);
  });
  it(T("A63", "editing a question after its YES keeps that grant and opens nothing new"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 3's area?\nYES");
    await g.tick();
    expect(g.ref.state.outside.map((o) => o.to)).toEqual(["pine"]);
  });
  it(T("A64", "NO then a teammate's later YES: the latest answer counts"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nNO");
    await g.tick();
    expect(g.ref.state.outside).toEqual([]);
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nNO\nYES");
    await g.tick();
    expect(g.ref.state.outside.map((o) => o.to)).toEqual(["pine"]);
  });
  it(T("A65", "a question about a non-neighbour, your own team or gibberish opens nothing"), async () => {
    for (const text of ["Spray water in Team 4's area?", "Spray water in Team 1's area?", "Spray water in asdf qwer?", "Spray water in ?"]) {
      const { g, q } = await ask(text);
      g.fake.playerEditSticky("r2", q.id, `${text}\nYES`);
      await g.tick();
      expect(g.ref.state.outside).toEqual([]);
      expect(g.card("r1")).toContain("Ask about a neighbour");
    }
  });
  it(T("A66", "a question in another team's Orders frame opens nothing"), async () => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "pine", "Spray water in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Spray water in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.outside).toEqual([]);
    expect(g.card("r1")).toContain("your own team's Orders");
  });
  it(T("A67", "100 spam stickies: no crash, bounded writes, one note per sticky"), async () => {
    const g = await setup({ live: true });
    for (let i = 0; i < 100; i++) g.fake.playerSticky("r1", "ridge", i % 2 ? `Spray water in Team ${i % 5}'s area?` : `spam ${i}`);
    await g.ticks(3);
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
    const notes = Object.keys(g.ref.state.noted).length;
    await g.ticks(3);
    expect(Object.keys(g.ref.state.noted).length).toBe(notes);
  });
  it(T("A68", "a giant sticky (100 KB, trailing spaces) is judged in milliseconds"), async () => {
    const g = await setup({ live: true });
    g.fake.playerSticky("r1", "ridge", "Spray water in Team 2" + " ".repeat(100_000) + "x");
    g.fake.playerSticky("r1", "ridge", "x".repeat(200_000));
    const t0 = performance.now();
    await g.tick();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(questionTarget("Spray water in " + " ".repeat(5000))).toBeNull();
  });
  it(T("A69", "Team 2 / team2 / T2 / old names all name the same team"), async () => {
    for (const s of ["Team 2", "team 2", "team2", "T2", "t2", "Pine Valley", "pine", "TEAM 2"]) expect(teamByName(s)).toBe("pine");
    for (const s of ["Spray water in Team 2's area?", "spray water in team2", "Spray water in T2's area", "Spray water in Pine Valley's area?"]) expect(questionTarget(s)).toBe("pine");
    const s = (await setup({ live: true })).ref.state;
    expect(judgeSticky(s, CALM, { id: "z", team: "ridge", text: "Spray water in T2?\nYES", createdBy: "r1", modifiedBy: "r2" }).length).toBeGreaterThan(0);
  });
});

describe("players and inbox cards", () => {
  it(T("A70", "emoji, HTML, entities and script in a name: cleaned, card stable"), async () => {
    const g = await setup({ live: true });
    const evil = `<script>alert(1)</script>Ana &amp; &lt;b&gt; 😀 O'Neil\u200b\u0007`;
    g.fake.playerJoin("e1", evil);
    await g.ticks(2);
    const p = g.ref.state.players.e1!;
    expect(p.name).not.toMatch(/[<>\u200b]/);
    expect(p.name.includes(String.fromCharCode(7))).toBe(false);
    expect(p.name).toContain("😀");
    expect(g.card("e1")).toContain(p.name);
    const u0 = g.fake.calls.update;
    await g.ticks(3);
    expect(g.fake.calls.update - u0).toBeLessThanOrEqual(3 * 3); // fixtures only: the card is not rewritten in a loop
    expect(g.card("e1")).not.toContain("inbox card (edited)");
  });
  it(T("A71", "an empty name becomes Player N"), async () => {
    const g = await setup({ live: true });
    g.fake.playerJoin("e2", "   ");
    await g.tick();
    expect(g.ref.state.players.e2!.name).toMatch(/^Player \d+$/);
  });
  it(T("A72", "a very long name is cut to 24 characters"), async () => {
    const g = await setup({ live: true });
    g.fake.playerJoin("e3", "A".repeat(10_000) + "😀");
    await g.tick();
    expect(Array.from(g.ref.state.players.e3!.name).length).toBeLessThanOrEqual(24);
  });
  it(T("A73", "a second inbox card from one player is removed"), async () => {
    const g = await setup({ live: true });
    const extra = g.fake.add({ type: "sticky_note", content: "<p>Inbox · Rita 2</p>", x: PANELS.inbox.x + 900, y: PANELS.inbox.y + 600, w: 160, h: 160 }, "r1");
    await g.ticks(2);
    expect(g.fake.items.has(extra.id)).toBe(false);
    expect(Object.keys(g.ref.state.players)).toHaveLength(5);
  });
  it(T("A74", "editing someone else's inbox card is undone and the editor frozen"), async () => {
    const g = await setup({ live: true });
    g.fake.playerEdit("p1", g.cards.r1!, { content: "you are on Team 2 now" });
    await g.tick();
    expect(g.card("r1")).toContain("Rita · TEAM 1");
    expect(g.card("p1")).toContain("someone else's inbox card");
  });
  it(T("A75", "a deleted inbox card is recreated; the player keeps team and paints; their own new card wins"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick();
    g.fake.playerDelete(g.cards.r2!);
    await g.ticks(3);
    const copy = g.ref.inboxCard.get("r2")!;
    expect(copy).not.toBe(g.cards.r2);
    expect(g.card("r2")).toContain("Rob · TEAM 1 · WORKER · 1 paints");
    const own = g.fake.playerJoin("r2", "Rob").card;
    await g.ticks(2);
    expect(g.ref.inboxCard.get("r2")).toBe(own.id);
    expect(g.fake.items.has(copy)).toBe(false);
    expect(g.ref.state.players.r2!.team).toBe("ridge");
  });
  it(T("A76", "joining after LIVE: placed on the smallest team"), async () => {
    const g = await setup({ live: true });
    g.fake.playerJoin("late", "Late");
    await g.tick();
    expect(g.ref.state.players.late!.team).not.toBe("ridge");
    expect(g.card("late")).toContain("You are a WORKER");
  });
  it(T("A77", "joining after OVER: not added, told the game is over"), async () => {
    const g = await setup({ live: true });
    await g.ref.stop();
    g.fake.playerJoin("late", "Late");
    await g.tick();
    expect(g.ref.state.players.late).toBeUndefined();
    expect(g.card("late")).toContain("game is over");
  });
  it(T("A78", "the same name twice gets a number"), async () => {
    const g = await setup({ live: true });
    g.fake.playerJoin("x1", "Rita");
    g.fake.playerJoin("x2", "rita");
    await g.tick();
    expect([g.ref.state.players.x1!.name, g.ref.state.players.x2!.name]).toEqual(["Rita 2", "rita 3"]);
  });
  it(T("A79", "a moved inbox card goes back to its slot"), async () => {
    const g = await setup({ live: true });
    const c = g.fake.items.get(g.cards.c1!)!;
    const x = c.x;
    g.fake.playerEdit("c1", c.id, { x: 100, y: 100 });
    await g.ticks(2);
    expect(g.fake.items.get(c.id)!.x).toBe(x);
  });
  it(T("A80", "a team with no players: the game still runs"), async () => {
    const g = await setup({ live: true, players: [["r1", "Rita"], ["r2", "Rob"]], rules: RULES });
    await g.ticks(30);
    expect(g.fx("leaderboard")).toContain("boss -");
    expectConverged(g);
  });
  it(T("A81", "100 players: all join, cards stay inside the Inbox panel, writes stay capped"), async () => {
    const players = Array.from({ length: 100 }, (_, i) => [`u${i}`, `Player${i}`] as [string, string]);
    const g = await setup({ live: true, players });
    await g.ticks(3);
    expect(Object.keys(g.ref.state.players)).toHaveLength(100);
    for (const id of g.ref.inboxCard.values()) {
      const c = g.fake.items.get(id)!;
      expect(inside(PANELS.inbox, c.x, c.y)).toBe(true);
    }
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
  });
});

describe("Miro misbehaving, restarts, clocks", () => {
  it(T("A90", "429s on reads: ticks skipped, game time catches up only a little"), async () => {
    const g = await setup({ live: true });
    g.fake.faults.failNextReads = 5;
    const el = g.ref.state.elapsed;
    for (let i = 0; i < 5; i++) expect((await g.tick()).skipped).toBe(true);
    await g.tick();
    expect(g.ref.state.elapsed - el).toBeLessThanOrEqual(15_000);
  });
  it(T("A91", "5xx and timeouts on writes: retried until the board agrees"), async () => {
    const g = await setup({ live: true, rules: RULES });
    g.fake.faults.rate5xx = 0.4;
    g.fake.faults.rateTimeout = 0.1;
    for (let i = 0; i < 20; i++) {
      g.fake.playerPaint("r2", `C${(i % 17) + 1}`, "#ff0000");
      await g.tick(6000);
    }
    g.fake.faults.rate5xx = g.fake.faults.rateTimeout = 0;
    await g.ticks(10);
    expectConverged(g);
  });
  it(T("A92", "a partial page is not a delete: nothing rebuilt, nothing duplicated"), async () => {
    const g = await setup({ live: true });
    const c0 = g.fake.calls.create;
    g.fake.faults.partialNextLists = 1;
    await g.ticks(3);
    expect(g.fake.calls.create).toBe(c0);
    expectConverged(g);
  });
  it(T("A93", "writes that land but report an error: no double effect"), async () => {
    const g = await setup({ live: true, rules: RULES });
    g.fake.faults.rateGhost = 0.5;
    g.fake.playerDelete(g.sq("C4").id);
    g.fake.playerPaint("r2", "D4", C.fire);
    await g.ticks(10);
    g.fake.faults.rateGhost = 0;
    await g.ticks(5);
    expectConverged(g);
  });
  it(T("A94", "an item that vanishes between read and write is rebuilt"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", "#ff0000");
    g.fake.vanishOnWrite.add(g.sq("C4").id);
    await g.ticks(4);
    expectConverged(g);
  });
  it(T("A95", "30% of all calls failing for a whole game: never throws, converges after"), async () => {
    const g = await setup({ live: true, rules: RULES, fast: true });
    Object.assign(g.fake.faults, { rate429: 0.1, rate5xx: 0.1, rateTimeout: 0.05, rateGhost: 0.05 });
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const lab = g.ref.cellList[Math.floor(rng() * 1224)]!.label;
      if (g.ref.cellId.has(lab)) g.fake.playerPaint(["r1", "p1", "c1", "b1", "r2"][i % 5]!, lab, rng() < 0.5 ? C.water : "#123456");
      if (i % 10 === 0 && g.ref.cellId.has(lab)) g.fake.playerDelete(g.ref.cellId.get(lab)!);
      await g.tick();
    }
    Object.assign(g.fake.faults, { rate429: 0, rate5xx: 0, rateTimeout: 0, rateGhost: 0 });
    await g.ticks(15);
    expectConverged(g);
  });
  it(T("A96", "killed mid-game and restarted from game.json: carries on, nothing rebuilt"), async () => {
    const g = await setup({ live: true, rules: RULES });
    await g.ticks(10);
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(6000);
    const saved = JSON.parse(JSON.stringify(g.game));
    const c0 = g.fake.calls.create;
    const g2 = await setup({ fake: g.fake, game: saved, rules: RULES, t0: g.now() + 30_000 });
    await g2.ticks(5);
    expect(g.fake.calls.create).toBe(c0);
    expect(g2.ref.state.phase).toBe("live");
    expect(g2.ref.state.stats.byPlayer.r2!.water).toBe(1);
    expect(g2.card("r2")).toContain("Rob · TEAM 1");
    expectConverged(g2);
  });
  it(T("A97", "game.json cut short by a kill: the previous save is loaded"), () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-"));
    const file = path.join(dir, "game.json");
    const g = emptyGame();
    g.fixtureIds.banner = "b1";
    saveGame(g, file);
    saveGame({ ...g, fixtureIds: { banner: "b2" } }, file);
    writeFileSync(file, readFileSync(file, "utf8").slice(0, 10));
    expect(loadGame(file, () => {}).fixtureIds.banner).toBe("b1");
    writeFileSync(`${file}.bak`, "{");
    expect(loadGame(file, () => {})).toEqual(emptyGame());
  });
  it(T("A98", "two referees at once: the second is refused; a dead referee's lock is taken over"), () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-"));
    const file = path.join(dir, "referee.lock");
    expect(acquireLock(file, process.pid).ok).toBe(true);
    const second = acquireLock(file, 999_998);
    expect(second).toEqual({ ok: false, owner: process.pid });
    releaseLock(file, process.pid);
    writeFileSync(file, "999999"); // crashed without cleaning up
    expect(acquireLock(file, process.pid).ok).toBe(true);
  });
  it(T("A99", "clock skew: a future timestamp doesn't lock a player out; an old one is still judged"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water, g.now() + 3_600_000);
    await g.tick(6000);
    g.fake.playerPaint("r2", "C5", C.water);
    await g.tick(6000);
    expect([g.fill("C4"), g.fill("C5")]).toEqual([C.water, C.water]);
    g.fake.playerPaint("r1", "C6", C.water, 5);
    await g.tick();
    expect(g.fill("C6")).toBe(C.water);
  });
  it(T("A100", "all fire out before the lightning: the game waits for it, then ends when that fire is out"), async () => {
    const g = await setup({ live: true, rules: { ...CALM, burnTicks: 1 } });
    await g.ticks(10, 15_000);
    expect(Object.values(g.ref.state.cells).includes("fire")).toBe(false);
    expect(g.ref.state.phase).toBe("live");
    await g.ticks(30, 15_000);
    expect(g.ref.state.stats.strikes).toHaveLength(1);
    expect(g.ref.state.phase).toBe("over");
    expect(g.ref.state.endReason).toBe("out");
  });
  it(T("A101", "the fast read of a deleted frame fails: one full read instead, frame repaired"), async () => {
    const g = await setup({ live: true, fast: true });
    g.fake.deleteFrame(g.fake.gridFrameIds[0]!);
    await g.ticks(5);
    expect(g.logs.join("\n")).toMatch(/fast read failed/);
    expectConverged(g);
  });
  it(T("A102", "a script repaints 600 squares at once: writes capped per tick, all undone within a few ticks"), async () => {
    const g = await setup({ live: true });
    for (const c of g.ref.cellList.slice(0, 600)) g.fake.playerPaint("r1", c.label, "#ff00ff");
    await g.ticks(8);
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
    expect(g.results.some((r) => r.deferred > 0)).toBe(true);
    expectConverged(g);
  });
  it(T("A103", "malformed items from Miro (no text, NaN coordinates, odd types) don't break a tick"), async () => {
    const g = await setup({ live: true });
    const it0 = g.fake.vandalAdd("r1", "shape", { x: NaN, y: NaN, w: NaN, h: NaN });
    (it0 as { content: unknown }).content = undefined;
    g.fake.vandalAdd("r1", "embed", { x: 100, y: 100, w: 0, h: 0 });
    g.fake.vandalAdd("r1", "sticky_note", { ...center(ORDERS.ridge), w: 100, h: 100 });
    (g.fake.items.get(g.sq("A1").id)! as { modifiedAt: number }).modifiedAt = NaN;
    g.fake.playerPaint("r1", "A2", C.water, NaN);
    await g.ticks(3);
    expect(GRID_BOX.w).toBeGreaterThan(0);
  });
  it(T("A104", "presets lookup failing (members API down) still joins the player"), async () => {
    const g = await setup({ live: true, ref: { presets: { zed: "birch" } } });
    g.fake.members = async () => {
      throw new Error("Miro GET members -> 500");
    };
    g.fake.playerJoin("q1", "Quinn");
    await g.tick();
    expect(g.ref.state.players.q1).toBeDefined();
  });
});

it("every attack in ATTACKS.md has a test here", () => {
  const md = readFileSync(path.join(import.meta.dirname, "ATTACKS.md"), "utf8");
  const ids = [...md.matchAll(/^\|\s*(A\d+)\s*\|/gm)].map((m) => m[1]!);
  const src = readFileSync(path.join(import.meta.dirname, "attacks.test.ts"), "utf8") + readFileSync(path.join(import.meta.dirname, "stress.test.ts"), "utf8");
  const missing = ids.filter((id) => !src.includes(`"${id}"`));
  expect(ids.length).toBeGreaterThan(60);
  expect(missing).toEqual([]);
});
