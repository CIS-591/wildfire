// One test per line of test/ATTACKS.md (the id in each test name). A last test checks that every id in
// ATTACKS.md has a test here.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { loadGame, saveGame, saveLiveIds } from "../src/config.js";
import { FIXTURES, GRID_BOX, ORDERS, PANELS, TEAMS, TEAM_INFO, RANK_SLOTS, center, rankKey, frameBoxes, inside, teamByName } from "../src/layout.js";
import { acquireLock, releaseLock } from "../src/lock.js";
import { FakeBoard } from "../src/fake-board.js";
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
    expect(g.ref.state.water.ridge).toBe(400);
  });
  it(T("A02", "blue on blue changes nothing and costs no water"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(6000);
    g.fake.playerPaint("r1", "C4", C.water);
    await g.tick(6000);
    expect(g.ref.state.water.ridge).toBe(399);
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
  it(T("A05", "blue in a neighbour's area is undone even with a YES; orange there counts only while the attack runs"), async () => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "ridge", "Start a fire in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    g.fake.playerPaint("r2", "Z4", C.water);
    await g.tick(6000);
    expect(g.fill("Z4")).toBe(C.forest);
    g.fake.playerPaint("r2", "Z5", C.fire);
    await g.tick(6000);
    expect(g.fill("Z5")).toBe(C.fire);
    await g.ticks(41); // 2 minutes later
    g.fake.playerPaint("r2", "Z6", C.fire);
    await g.tick();
    expect(g.fill("Z6")).toBe(C.forest);
    // Team 3 is not under attack: Team 1 can't light it.
    g.fake.playerPaint("r1", "C30", C.fire);
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
  it(T("A13", "with the team's water at 0 its blue paints are undone (other teams go on)"), async () => {
    const g = await setup({ live: true });
    g.ref.state.water.ridge = 0;
    g.fake.playerPaint("r2", "C4", C.water);
    g.fake.playerPaint("p1", "Z4", C.water);
    await g.tick();
    expect([g.fill("C4"), g.fill("Z4")]).toEqual([C.forest, C.water]);
    expect(g.card("r2")).toContain("Team 1's water is empty");
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
    expect(g.logs.join("\n")).toMatch(/D5 is locked \(403\)/);
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
    const q = g.fake.playerSticky("r1", "ridge", "Start a fire in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    const old = g.fake.ordersFrameIds.ridge;
    g.fake.deleteFrame(old);
    await g.ticks(3);
    const f = [...g.fake.frames.values()].find((x) => inside(ORDERS.ridge, x.x, x.y));
    expect(f && f.id !== old).toBe(true);
    expect(g.ref.state.attacks.some((o) => o.team === "ridge" && o.to === "pine")).toBe(true);
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
    for (const k of ["banner", "scoreboard", "rank_1"] as const) g.fake.playerDelete(g.game.fixtureIds[k]!);
    await g.ticks(3);
    expect(g.fx("banner")).toContain("LIVE");
    expect(g.fx("scoreboard")).toContain("TEAM 1");
    expect(g.fx("leaderboard")).toContain("TEAM 1 · Boss");
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
    g.fake.playerEdit("c1", g.game.fixtureIds.rank_1!, { rotation: 90 });
    await g.ticks(2);
    const after = g.fake.items.get(id)!;
    expect([after.x, after.w]).toEqual([before.x, before.w]);
    expect(g.fake.items.get(g.game.fixtureIds.rank_1!)!.rotation).toBe(0);
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
    expect(g.card("c1")).toMatch(/🚫 (image|item on the forest) removed — frozen/);
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
    const i0 = g.fake.calls.image;
    await g.ticks(40);
    // Icons replaced when the rank changes (a new image, the old one deleted) are not junk retries.
    expect(g.fake.calls.delete - d0 - (g.fake.calls.image - i0)).toBeLessThanOrEqual(8);
    g.fake.unlock(j.id);
    await g.ticks(20);
    expect(g.fake.items.has(j.id)).toBe(false);
  });
});

describe("the attack question", () => {
  const ask = async (text = "Start a fire in Team 2's area?") => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "ridge", text);
    await g.tick();
    return { g, q };
  };
  it(T("A60", "a YES on your own question does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r1", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks).toEqual([]);
    expect(g.card("r1")).toContain("did not post it");
  });
  it(T("A61", "a YES from another team does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("p1", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks).toEqual([]);
  });
  it(T("A62", "a YES from someone who never joined does nothing"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("guest", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks).toEqual([]);
  });
  it(T("A63", "editing a question after its YES keeps that grant and opens nothing new"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 3's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks.map((o) => o.to)).toEqual(["pine"]);
  });
  it(T("A64", "NO then a teammate's later YES: the latest answer counts"), async () => {
    const { g, q } = await ask();
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nNO");
    await g.tick();
    expect(g.ref.state.attacks).toEqual([]);
    g.fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nNO\nYES");
    await g.tick();
    expect(g.ref.state.attacks.map((o) => o.to)).toEqual(["pine"]);
  });
  it(T("A65", "a question about a non-neighbour, your own team or gibberish opens nothing and is removed"), async () => {
    for (const text of ["Start a fire in Team 4's area?", "Start a fire in Team 1's area?", "Start a fire in asdf qwer?", "Start a fire in ?"]) {
      const { g, q } = await ask(text);
      expect(g.fake.items.has(q.id)).toBe(false); // the creator is told on their card, then it goes
      expect(g.ref.state.attacks).toEqual([]);
      expect(g.card("r1")).toMatch(/ask about a neighbour/i);
      expect(g.fx("leaderboard")).not.toContain("Waiting for a YES");
    }
  });
  it(T("A66", "a question in another team's Orders frame opens nothing and is removed"), async () => {
    const g = await setup({ live: true });
    const q = g.fake.playerSticky("r1", "pine", "Start a fire in Team 2's area?");
    await g.tick();
    expect(g.fake.items.has(q.id)).toBe(false);
    expect(g.ref.state.attacks).toEqual([]);
    expect(g.card("r1")).toContain("your own team's Orders");
    expect(g.fx("leaderboard")).not.toContain("Waiting for a YES");
  });
  it(T("A67", "100 spam stickies: no crash, bounded writes, one note per sticky"), async () => {
    const g = await setup({ live: true });
    for (let i = 0; i < 100; i++) g.fake.playerSticky("r1", "ridge", i % 2 ? `Start a fire in Team ${i % 5}'s area?` : `spam ${i}`);
    await g.ticks(3);
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
    const notes = Object.keys(g.ref.state.noted).length;
    await g.ticks(3);
    expect(Object.keys(g.ref.state.noted).length).toBe(notes);
  });
  it(T("A68", "a giant sticky (100 KB, trailing spaces) is judged in milliseconds"), async () => {
    const g = await setup({ live: true });
    g.fake.playerSticky("r1", "ridge", "Start a fire in Team 2" + " ".repeat(100_000) + "x");
    g.fake.playerSticky("r1", "ridge", "x".repeat(200_000));
    const t0 = performance.now();
    await g.tick();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(questionTarget("Start a fire in " + " ".repeat(5000))).toBeNull();
  });
  it(T("A69", "Team 2 / team2 / T2 / old names all name the same team"), async () => {
    for (const s of ["Team 2", "team 2", "team2", "T2", "t2", "Pine Valley", "pine", "TEAM 2"]) expect(teamByName(s)).toBe("pine");
    for (const s of ["Start a fire in Team 2's area?", "start a fire in team2", "Start a fire in T2's area", "Start a fire in Pine Valley's area?"]) expect(questionTarget(s)).toBe("pine");
    const s = (await setup({ live: true })).ref.state;
    expect(judgeSticky(s, CALM, { id: "z", team: "ridge", text: "Start a fire in T2?\nYES", createdBy: "r1", modifiedBy: "r2" }).length).toBeGreaterThan(0);
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
    expect(g.card("r2")).toContain("Rob · TEAM 1 · WORKER · 1 squares");
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
    expect(g.fx("leaderboard")).toContain("not playing");
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
    g.fake.faults.rate429 = 1; // every read refused (the reads of a tick run in parallel)
    const el = g.ref.state.elapsed;
    for (let i = 0; i < 5; i++) expect((await g.tick()).skipped).toBe(true);
    g.fake.faults.rate429 = 0;
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
  it(T("A130", "junk posted while the referee is paused (a shape over the leaderboard, a meme in the Orders) is still removed after it restarts"), async () => {
    const g = await setup({ live: true, rules: RULES });
    await g.ticks(5);
    const saved = JSON.parse(JSON.stringify(g.game));
    g.advance(20_000);
    const fake = g.fake.vandalAdd("c1", "shape", { x: 3600, y: -50, w: 600, h: 400 }, "FAKE LEADERBOARD");
    const meme = g.fake.vandalAdd("c1", "image", { x: ORDERS.pine.x + 300, y: ORDERS.pine.y + 400, w: 200, h: 200 });
    const g2 = await setup({ fake: g.fake, game: saved, rules: RULES, t0: g.now() + 30_000 });
    await g2.ticks(4);
    expect(g2.fake.items.has(fake.id)).toBe(false);
    expect(g2.fake.items.has(meme.id)).toBe(false);
    expectConverged(g2);
  });
  it(T("A131", "a rotated area label (static text at 270°) is left alone, and put back rotated when a vandal moves or flattens it"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const label = fake.add({ type: "text", content: "<p>TEAM 1'S AREA</p>", x: -100, y: 540, w: 1168, h: 50, rotation: 270 }, "referee");
    fake.staticIds.push(label.id);
    const g = await setup({ fake, live: true, statics: true });
    const u0 = g.fake.calls.update;
    await g.ticks(5);
    expect(g.fake.items.get(label.id)!.rotation).toBe(270);
    const writesWhileQuiet = g.fake.calls.update - u0;
    g.fake.playerEdit("c1", label.id, { x: 400, rotation: 0 });
    await g.ticks(3);
    const it = g.fake.items.get(label.id)!;
    expect([it.x, it.rotation]).toEqual([-100, 270]);
    expect(writesWhileQuiet).toBeLessThan(40); // the untouched label is not rewritten every tick
  });
  it(T("A132", "a deleted leaderboard row is made again AND its badge, chips and icons are made again after it (on top, not hidden)"), async () => {
    const g = await setup({ live: true, fast: true });
    await g.ticks(3);
    const row = g.game.fixtureIds.rank_1!;
    const badge = g.game.fixtureIds.rank_1_score!;
    const medal = g.game.icons!.medal_1!.id;
    g.fake.playerDelete(row);
    await g.ticks(4);
    const ids = [...g.fake.items.keys()];
    const at = (id: string) => ids.indexOf(id); // creation order = z-order in Miro
    expect(g.game.fixtureIds.rank_1).not.toBe(row);
    expect(g.game.fixtureIds.rank_1_score).not.toBe(badge);
    expect(g.game.icons!.medal_1!.id).not.toBe(medal);
    for (const k of ["rank_1_score", "rank_1_water", "rank_1_attacks"] as const) expect(at(g.game.fixtureIds[k]!)).toBeGreaterThan(at(g.game.fixtureIds.rank_1!));
    expect(at(g.game.icons!.medal_1!.id)).toBeGreaterThan(at(g.game.fixtureIds.rank_1!));
    expectConverged(g);
  });
  it(T("A133", "--teams 2: in the lobby Teams 3 and 4 are grey 'not playing' rows with '-' chips, and their centre squares are green"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const labels = [1, 3].map((n) => fake.add({ type: "shape", content: `<p><b>TEAM ${n}’S AREA</b></p>`, fill: "#f5f6f8", x: -100, y: n === 1 ? 500 : 1672, w: 1168, h: 52, rotation: 270 }, "referee"));
    for (const l of labels) fake.staticIds.push(l.id);
    const g = await setup({ fake, statics: true, rules: { ...RULES, teams: 2 } });
    await g.ticks(3);
    expect(stripHtml(g.fake.items.get(labels[1]!.id)!.content)).toContain("TEAM 3’S AREA · NOT PLAYING");
    expect(stripHtml(g.fake.items.get(labels[0]!.id)!.content)).not.toContain("NOT PLAYING");
    expect(g.fake.items.get(labels[1]!.id)!.rotation).toBe(270);
    expect(g.fx("banner")).toContain("NOT PLAYING: TEAM 3, TEAM 4");
    expect(g.fx("scoreboard")).toContain("TEAM 3 not playing");
    const slot = (t: string) => g.ref.rankOrder().indexOf(t as never) + 1;
    for (const t of ["cedar", "birch"]) {
      const n = slot(t);
      expect(g.fx(`rank_${n}` as "rank_1")).toContain("not playing");
      expect(g.fx(`rank_${n}_water` as "rank_1_water").trim()).toBe("-");
      expect(g.fx(`rank_${n}_score` as "rank_1_score").trim()).toBe("-");
      expect(g.fake.items.get(g.game.fixtureIds[`rank_${n}` as "rank_1"]!)!.fill).toBe("#9ca3af");
    }
    expect(g.fx(`rank_${slot("ridge")}` as "rank_1")).not.toContain("not playing");
    expect([g.fill("R18"), g.fill("S18")]).toEqual([C.forest, C.forest]);
    expect([g.fill("R17"), g.fill("S17")]).toEqual([C.fire, C.fire]);
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

describe("rehearsal 2 on the real board: Miro-like fake (404 on deleted items, slow full listings)", () => {
  /** Like the live board: per-frame reads every poll, a full listing that lands ~10 polls (30 s) after it began. */
  const miro = (o: Parameters<typeof setup>[0] = {}) => setup({ live: true, fast: true, ...o }).then((g) => ((g.fake.fullListReads = 10), g));
  const noLockLog = (g: { logs: string[] }) => expect(g.logs.join("\n")).not.toMatch(/locked|refuses writes/);

  it(T("A105", "a deleted leaderboard (PATCH -> 404) is recreated at once, never taken as locked"), async () => {
    const g = await miro();
    await g.ticks(12); // a slow sweep in flight, like live
    const old = g.game.fixtureIds.rank_1!;
    g.fake.playerDelete(old);
    await g.tick(); // fixtures are read by id every poll: 404 -> rebuilt in this tick
    expect(g.game.fixtureIds.rank_1).not.toBe(old);
    expect(g.fx("leaderboard")).toContain("TEAM 1 · Boss");
    await g.ticks(25); // stale sweeps that still list the old id: no junk delete of it, no "locked"
    noLockLog(g);
    expect(g.logs.join("\n")).not.toMatch(new RegExp(`junk:${old}`));
    // Without GET-by-id the write's 404 alone is enough: the banner is rewritten every tick.
    const g2 = await miro();
    (g2.fake as { getItem?: unknown }).getItem = undefined;
    const b = g2.game.fixtureIds.banner!;
    g2.fake.playerDelete(b);
    await g2.tick();
    expect(g2.game.fixtureIds.banner).not.toBe(b);
    expect(g2.fx("banner")).toContain("LIVE");
    noLockLog(g2);
  });
  it(T("A106", "a deleted inbox card comes back within a few polls with the player's current text"), async () => {
    const g = await miro();
    g.fake.playerPaint("r2", "C4", C.water);
    await g.ticks(3);
    // Card write path: the next card write gets 404 -> recreated in the same tick.
    g.fake.playerDelete(g.ref.inboxCard.get("r2")!);
    g.fake.playerPaint("r2", "C5", C.water);
    await g.tick(6000);
    expect(g.card("r2")).toContain("Rob · TEAM 1 · WORKER · 2 squares");
    // Probe path: nobody writes to Pat's card, the round-robin GET finds it gone within ≤ 10 s.
    const pat = g.ref.inboxCard.get("p1")!;
    g.fake.playerDelete(pat);
    await g.ticks(3);
    expect(g.ref.inboxCard.get("p1")).not.toBe(pat);
    expect(g.card("p1")).toContain("Pat · TEAM 2");
    noLockLog(g);
  });
  it(T("A107", "a deleted square is back within 10 s; a square deleted under a fire write is rebuilt in that tick"), async () => {
    const g = await miro();
    await g.ticks(12);
    const old = g.sq("C24").id;
    g.fake.playerDelete(old);
    await g.ticks(3); // 9 s
    expect(g.sq("C24")?.id).toBeDefined();
    expect(g.sq("C24").id).not.toBe(old);
    // The engine wants D24 orange; the square is gone before the write lands: 404 -> rebuilt orange now.
    g.ref.state.cells.D24 = "fire";
    g.ref.state.burnLeft.D24 = 3;
    g.fake.vanishOnWrite.add(g.sq("D24").id);
    await g.tick();
    expect(g.fill("D24")).toBe(C.fire);
    noLockLog(g);
    expectConverged(g);
  });
  it(T("A108", "a fixture moved 400 units is back within one poll"), async () => {
    const g = await miro();
    await g.ticks(12);
    const id = g.game.fixtureIds.banner!;
    const before = { ...g.fake.items.get(id)! };
    g.fake.playerEdit("p1", id, { x: before.x + 400 });
    await g.tick();
    expect(g.fake.items.get(id)!.x).toBe(before.x);
    expect(g.card("p1")).toContain("the banner (moved)");
  });
  it(T("A109", "fresh blue paints are judged before the fire writes; rehearsal stand-ins don't collide on cooldown"), async () => {
    // A paint on a square the spread would take this tick: judged first, so it stays blue.
    const hot = { ...RULES, pSide: 1, pDiag: 0, spreadSeconds: 3, lightningAt: [99] };
    const g = await setup({ live: true, fast: true, rules: hot });
    for (const [lab, u] of [["Q17", "r1"], ["R16", "r2"], ["Q18", "c1"]] as const) g.fake.playerPaint(u, lab, C.water);
    await g.tick(3000);
    for (const lab of ["Q17", "R16", "Q18"]) expect(g.fill(lab)).toBe(C.water);
    // Rehearsal: one account, two paints by the same team in one poll both count (two stand-ins).
    const fake = FakeBoard.seeded(() => 0);
    const seats = ["Dev", "Gus", "Eli", "Chloe", "Hana", "Ben", "Ana", "Fay"].map((n) => ["acct", n] as [string, string]);
    const r = await setup({ fake, live: false, ref: { rehearsal: true }, players: seats });
    expect(Object.values(r.ref.state.players).filter((p) => p.team === "ridge")).toHaveLength(2);
    await r.ref.start();
    r.fake.playerPaint("acct", "C4", C.water);
    r.fake.playerPaint("acct", "D4", C.water);
    await r.tick(6000);
    expect([r.fill("C4"), r.fill("D4")]).toEqual([C.water, C.water]);
    expect(r.ref.state.stats.illegal.cooldown).toBe(0);
  });
  it(T("A111", "every accepted and refused paint is in the log with square, player and reason"), async () => {
    const g = await setup({ live: true });
    g.fake.playerPaint("r2", "C4", C.water);
    g.fake.playerPaint("p1", "C5", C.water);
    await g.tick(6000);
    const log = g.logs.join("\n");
    expect(log).toMatch(/paint C4 #3aa7ff by Rob \(Team 1\): accepted/);
    expect(log).toMatch(/paint C5 #3aa7ff by Pat \(Team 2\): refused \[area\] · C5 undone: it is Team 1's area/);
  });
  it(T("A112", "question spam: wrong-team, non-neighbour and over-the-cap questions are removed; the leaderboard lists only valid ones"), async () => {
    const g = await setup({ live: true });
    for (let i = 0; i < 30; i++) g.fake.playerSticky("r1", "pine", "Start a fire in Team 2's area?"); // not Team 2's player
    const mine = [0, 1, 2, 3, 4].map((i) => g.fake.playerSticky("r1", "ridge", "Start a fire in Team 2's area?", g.now() + i));
    const far = g.fake.playerSticky("r2", "ridge", "Start a fire in Team 4's area?");
    await g.ticks(2);
    const left = [...g.fake.items.values()].filter((i) => i.type === "sticky_note");
    expect(left.map((i) => i.id).sort()).toEqual([mine[0]!.id, mine[1]!.id].sort());
    expect(g.fake.items.has(far.id)).toBe(false);
    expect(g.card("r1")).toMatch(/at most 2 open questions|own team's Orders/);
    expect(g.card("r2")).toMatch(/ask about a neighbour/i);
    const lb = g.fx("leaderboard");
    expect(lb.match(/Waiting for a YES/g)).toHaveLength(1);
    expect(lb).toContain("Waiting for a YES: start a fire in Team 2's area");
    // Rehearsal never deletes (one account), but still lists only valid questions.
    const r = await setup({ live: true, ref: { rehearsal: true }, players: [["acct", "Dev"], ["acct", "Gus"], ["acct", "Eli"], ["acct", "Chloe"]] });
    r.fake.playerSticky("acct", "ridge", "Start a fire in Team 4's area?");
    r.fake.playerSticky("acct", "ridge", "Start a fire in Team 2's area?");
    r.fake.playerSticky("acct", "ridge", "Start a fire in Team 2's area?");
    await r.ticks(2);
    expect(r.fx("leaderboard").match(/Waiting for a YES[^·\n]*/g)).toEqual(["Waiting for a YES: start a fire in Team 2's area"]);
  });
  it(T("A113", "the card header's paint count equals the player's accepted paints, even after the card is rebuilt"), async () => {
    const g = await miro();
    const players = ["r1", "p1", "c1", "b1", "r2"];
    const cols = ["C", "Z", "C", "Z", "D"];
    const rows = [4, 4, 30, 30, 5];
    for (let k = 0; k < 4; k++) {
      players.forEach((u, i) => g.fake.playerPaint(u, `${cols[i]}${rows[i]! + k}`, C.water));
      if (k === 2) g.fake.playerDelete(g.ref.inboxCard.get("c1")!);
      await g.ticks(2, 3500);
    }
    await g.ticks(3);
    for (const u of players) {
      const n = Number(/· (\d+) squares/.exec(g.card(u))?.[1]);
      expect(n, u).toBe(g.ref.state.stats.byPlayer[u]!.water);
      expect(n, u).toBe(4);
    }
  });
});

describe("fire attack, per-team water, batches, the fire model", () => {
  const Q = "Start a fire in Team 2's area?";
  const approve = async (g: Awaited<ReturnType<typeof setup>>, text = Q) => {
    const q = g.fake.playerSticky("r1", "ridge", text);
    await g.tick();
    g.fake.playerEditSticky("r2", q.id, `${text}\nYES`);
    await g.tick();
  };
  const border = (g: Awaited<ReturnType<typeof setup>>, lab: string) => g.fake.borders.get(g.sq(lab).id) ?? {};

  it(T("A114", "attack: after a teammate's YES, orange on up to 3 green squares in the neighbour's area; the 4th is undone; team-colored borders"), async () => {
    const g = await setup({ live: true });
    await approve(g);
    for (const lab of ["Z4", "Z5", "Z6", "Z7"]) {
      g.fake.playerPaint("r2", lab, C.fire);
      await g.tick(6000);
    }
    expect(["Z4", "Z5", "Z6", "Z7"].map(g.fill)).toEqual([C.fire, C.fire, C.fire, C.forest]);
    expect(g.card("r2")).toContain("has lit its 3 squares");
    const violet = TEAM_INFO.ridge.color;
    expect(border(g, "Z4")).toEqual({ color: violet, width: 8 });
    expect(g.ref.state.stats.lit.ridge).toBe(3);
    expect(g.fx(`rank_${g.ref.rankOrder().indexOf("ridge") + 1}_attacks` as "rank_1_attacks")).toContain("1 left");
    await g.ticks(25); // 75 s: 3 spreads, Z4 burns out and keeps a thinner border in Team 1's color
    expect(g.fill("Z4")).toBe(C.burnt);
    expect(border(g, "Z4")).toEqual({ color: violet, width: 6 });
    expect(g.ref.state.stats.burnedOthers.ridge).toBe(3);
    expect(border(g, "R17").width ?? 2).not.toBe(6); // wild fire: normal border
    expect(g.ref.state.water.ridge).toBe(400); // orange costs no water
    expectConverged(g);
  });
  it(T("A115", "a team's fire passes its origin (and border) on as it spreads, into anyone's area: blowback"), async () => {
    const g = await setup({ live: true, rules: { ...CALM, pSide: 1 } });
    await approve(g);
    g.fake.playerPaint("r2", "S10", C.fire); // right at Team 1's border (R is Team 1's last column)
    await g.tick(6000);
    await g.ticks(7); // one spread
    expect([g.ref.state.cells.R10, g.ref.state.origin.R10]).toEqual(["fire", "ridge"]); // into Team 1's own area
    expect(border(g, "R10")).toEqual({ color: TEAM_INFO.ridge.color, width: 8 });
    expect(g.ref.state.origin.T10).toBe("ridge");
    await g.ticks(30);
    expect(g.ref.state.stats.blowback.ridge).toBeGreaterThan(0);
  });
  it(T("A116", "batches: 6 squares by one player in one poll: 5 count, the 6th is undone with a line on the card"), async () => {
    const g = await setup({ live: true, rules: { ...CALM, paintBatch: 5 } });
    for (const lab of ["C4", "C5", "C6", "C7", "C8", "C9"]) g.fake.playerPaint("r2", lab, C.water);
    await g.tick();
    expect(["C4", "C5", "C6", "C7", "C8", "C9"].map(g.fill)).toEqual([C.water, C.water, C.water, C.water, C.water, C.forest]);
    expect(g.card("r2")).toContain("at most 5 squares per paint");
    expect(g.ref.state.water.ridge).toBe(395);
    expect(g.card("r2")).toContain("5 squares");
  });
  it(T("A117", "start fires in every area (mirrored) and fair lightning: 4 strikes, 4 different areas"), async () => {
    const starts = ["F6", "F7", "AE6", "AE7", "F28", "F29", "AE28", "AE29"];
    const g = await setup({ live: true, rules: { ...CALM, burnTicks: 1000, startFires: starts, lightningAt: [1, 2, 3, 4] } });
    expect(starts.map(g.fill)).toEqual(Array(8).fill(C.fire));
    await g.ticks(85); // 4:15
    const hit = g.ref.state.stats.strikes.map((l) => g.ref.cellList.find((c) => c.label === l)!.sector);
    expect(new Set(hit).size).toBe(4);
    for (const l of g.ref.state.stats.strikes) expect(g.fill(l)).toBe(C.fire);
  });
  it(T("A118", "wind is off by default (no wind on the banner); switched on it shows and warns 30 s before it turns"), async () => {
    const g = await setup({ live: true });
    expect(g.fx("banner")).not.toMatch(/wind/i);
    const w = await setup({ live: true, rules: { ...CALM, wind: { enabled: true, pDown: 0.6, pUp: 0.1, turnAt: 1 } } });
    expect(w.fx("banner")).toMatch(/wind \S+ [NESW]{1,2}/);
    await w.ticks(4); // ~0:20
    expect(w.fx("banner")).not.toContain("Wind turning");
    await w.ticks(7); // ~0:40
    expect(w.fx("banner")).toMatch(/Wind turning in \d+ s/);
    await w.ticks(12);
    expect(w.ref.state.windTurned).toBe(true);
  });
  it(T("A119", "a paint landing between the referee's read and its fire write is never overwritten (squares re-read by id first)"), async () => {
    for (const recheck of [true, false]) {
      const g = await setup({ live: true, fast: true });
      if (!recheck) (g.fake as { getItem?: unknown }).getItem = undefined;
      g.ref.state.cells.D24 = "fire"; // the engine just set D24 on fire; the board still shows green
      g.ref.state.burnLeft.D24 = 3;
      g.fake.afterGridRead = () => g.fake.playerPaint("c1", "D24", C.water); // lands after the read, before the write
      await g.tick();
      if (!recheck) {
        expect(g.fill("D24")).toBe(C.fire); // without the re-read the paint is lost (the old race)
        continue;
      }
      expect(g.fill("D24")).toBe(C.water); // held: not overwritten
      expect(g.logs.join("\n")).toMatch(/D24 changed since this tick's read/);
      await g.tick(6000);
      expect(g.fill("D24")).toBe(C.water); // judged next tick: blue on fire in Team 3's area counts
      expect(g.ref.state.cells.D24).toBe("water");
      expect(g.results.at(-2)!.reads).toBeGreaterThan(0);
    }
  });
  it(T("A122", "a deleted fixture is recreated in exactly the same box (agents find it by a small read there)"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const box = { ...center(FIXTURES.rank_1), w: FIXTURES.rank_1.w - 20, h: FIXTURES.rank_1.h - 10 };
    fake.add({ type: "shape", content: "<p>LEADERBOARD</p>", fill: "#ffffff", x: box.x + 6, y: box.y + 4, w: box.w, h: box.h }, "referee"); // MCP-built, a few units off
    const g = await setup({ fake, live: true });
    const old = g.fake.items.get(g.game.fixtureIds.rank_1!)!;
    g.fake.playerDelete(old.id);
    await g.tick();
    const now = g.fake.items.get(g.game.fixtureIds.rank_1!)!;
    expect(now.id).not.toBe(old.id);
    expect([now.x, now.y, now.w, now.h]).toEqual([old.x, old.y, old.w, old.h]);
  });
  it(T("A129", "layout change: a tracked fixture of the old size (a too-tall leaderboard row) and its saved box are put back to the new FIXTURES box"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const oldBox = { x: 3260 + 360, y: -252 + 59, w: 720, h: 300 };
    const old = fake.add({ type: "shape", content: "<p>LEADERBOARD</p>", fill: "#ffffff", ...oldBox }, "referee");
    const game = emptyGame();
    game.fixtureIds.rank_1 = old.id;
    game.fixtureBoxes = { rank_1: oldBox };
    const g = await setup({ fake, game, live: true });
    await g.ticks(2);
    const it = g.fake.items.get(g.game.fixtureIds.rank_1!)!;
    expect([it.w, it.h]).toEqual([FIXTURES.rank_1.w, FIXTURES.rank_1.h]);
    g.fake.playerDelete(it.id);
    await g.tick();
    const again = g.fake.items.get(g.game.fixtureIds.rank_1!)!;
    expect([again.w, again.h]).toEqual([FIXTURES.rank_1.w, FIXTURES.rank_1.h]);
  });
  it(T("A123", "one water bucket per team: banner and leaderboard show each team's water; an empty bucket stops only that team"), async () => {
    const g = await setup({ live: true, rules: { ...CALM, waterPerTeam: 2 } });
    g.fake.playerPaint("r2", "C4", C.water);
    await g.tick(6000);
    g.fake.playerPaint("r2", "C5", C.water);
    await g.tick(6000);
    g.fake.playerPaint("r2", "C6", C.water);
    g.fake.playerPaint("p1", "Z4", C.water);
    await g.tick(6000);
    expect([g.fill("C6"), g.fill("Z4")]).toEqual([C.forest, C.water]);
    expect(g.card("r2")).toContain("Team 1's water is empty");
    expect(g.fx("banner")).toContain("WATER T1 0 · T2 1 · T3 2 · T4 2");
    expect(g.fx(`rank_${g.ref.rankOrder().indexOf("ridge") + 1}_water` as "rank_1_water")).toMatch(/^\s*0 \/ /);
  });
});

describe("memes and junk anywhere", () => {
  it(T("A120", "a meme image every 5 s anywhere for 10 minutes: at most 2 alive at any poll, the poster frozen longer each time, ticks stay fast"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const decoration = fake.add({ type: "image", content: "", x: -500, y: -500, w: 300, h: 300 }, "instructor"); // the board's own
    const g = await setup({ fake, live: true, fast: true, statics: true, rules: { ...CALM, burnTicks: 100_000, gameMinutes: 30, lightningAt: [] } });
    const rng = mulberry32(3);
    const spots = [
      () => ({ ...center(PANELS.rules) }),
      () => ({ ...center(ORDERS[TEAMS[Math.floor(rng() * 4)]!]) }),
      () => ({ x: PANELS.inbox.x + 200 + rng() * 3600, y: PANELS.inbox.y + 200 + rng() * 1100 }),
      () => ({ x: 9000 + rng() * 5000, y: -4000 + rng() * 3000 }), // empty canvas, far away
      () => ({ x: rng() * 2300, y: rng() * 2170 }), // the forest
      () => ({ ...center(FIXTURES.banner) }),
    ];
    const icons = () => new Set(Object.values(g.game.icons ?? {}).map((r) => r.id));
    const images = () => [...g.fake.items.values()].filter((i) => i.type === "image" && i.id !== decoration.id && !icons().has(i.id));
    let maxAlive = 0;
    let maxMs = 0;
    const frozen: number[] = [];
    for (let s = 0; s < 600; s++) {
      if (s % 5 === 0) g.fake.vandalAdd("c1", "image", { ...spots[s % spots.length]!(), w: 200, h: 200 });
      if (s % 3 === 0) {
        maxAlive = Math.max(maxAlive, images().length);
        const t0 = performance.now();
        await g.tick(0);
        maxMs = Math.max(maxMs, performance.now() - t0);
        if (frozen.length < 3 && g.ref.state.junk.c1 === frozen.length + 1) frozen.push(g.ref.state.timeoutUntil.c1! - g.now());
      }
      g.advance(1000);
    }
    expect(maxAlive).toBeLessThanOrEqual(2);
    expect(images()).toHaveLength(0);
    expect(g.fake.items.has(decoration.id)).toBe(true);
    expect(g.ref.state.junk.c1).toBe(120);
    // Escalation: 5 s, 30 s, then 2 min (measured right after each judgement, a few seconds later at most).
    expect(frozen[0]).toBeLessThanOrEqual(5000);
    expect(frozen[1]).toBeGreaterThan(20_000);
    expect(frozen[2]).toBeGreaterThan(100_000);
    expect(g.card("c1")).toContain("🚫 image removed — frozen 2 min");
    expect(g.fx("leaderboard")).toContain("Junk removed: Cy (120)");
    expect(maxMs).toBeLessThan(250);
    expect(Math.max(...g.results.map((r) => r.writes))).toBeLessThanOrEqual(g.ref.maxWritesPerTick);
  });
  it(T("A121", "images in the Orders and the Inbox go; shapes/texts dropped on panels or in Orders frames go; stickies in Orders and decoration stay"), async () => {
    const fake = FakeBoard.seeded(() => 0);
    const deco = fake.add({ type: "image", content: "", ...center(PANELS.rules), w: 100, h: 100 }, "referee");
    const g = await setup({ fake, live: true, fast: true, statics: true });
    const junk = [
      g.fake.vandalAdd("p1", "image", { ...center(ORDERS.pine), w: 150, h: 150 }),
      g.fake.vandalAdd("p1", "image", { x: PANELS.inbox.x + 900, y: PANELS.inbox.y + 700, w: 150, h: 150 }),
      g.fake.vandalAdd("b1", "embed", { x: 20_000, y: 20_000, w: 400, h: 300 }),
      g.fake.vandalAdd("c1", "shape", { ...center(PANELS.rules), w: 120, h: 80 }, "LOL"),
      g.fake.vandalAdd("c1", "text", { ...center(ORDERS.ridge), w: 300, h: 40 }, "ridge stinks"),
    ];
    const order = g.fake.playerSticky("r1", "ridge", "Rob: paint C4 C5");
    await g.ticks(2);
    for (const j of junk) expect(g.fake.items.has(j.id), j.type).toBe(false);
    expect(g.fake.items.has(order.id)).toBe(true);
    expect(g.fake.items.has(deco.id)).toBe(true);
    expect(g.card("p1")).toContain("🚫 image removed — frozen");
  });
});

describe("rehearsal 3 fixes", () => {
  it(T("A125", "the referee's live ids (fixtures, recreated squares) go to state/live-ids.json whenever they change"), async () => {
    const g = await setup({ live: true, fast: true });
    const file = path.join(mkdtempSync(path.join(tmpdir(), "wf-ids-")), "live-ids.json");
    expect(saveLiveIds(g.ref.liveIds(), "b1", file)).toBe(true);
    expect(saveLiveIds(g.ref.liveIds(), "b1", file)).toBe(false); // nothing changed: not rewritten
    const oldSquare = g.ref.cellId.get("E2")!;
    const oldBoard = g.game.fixtureIds.rank_1!;
    g.fake.playerDelete(oldSquare);
    g.fake.playerDelete(oldBoard);
    await g.ticks(3);
    expect(saveLiveIds(g.ref.liveIds(), "b1", file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { boardId: string; fixtures: Record<string, string>; cells: Record<string, string> };
    expect(saved.boardId).toBe("b1");
    expect(saved.cells.E2).toBe(g.ref.cellId.get("E2"));
    expect(saved.cells.E2).not.toBe(oldSquare);
    expect(saved.fixtures.rank_1).toBe(g.game.fixtureIds.rank_1);
    expect(saved.fixtures.rank_1).not.toBe(oldBoard);
    expect(Object.keys(saved.cells)).toHaveLength(1224);
    for (const [lab, id] of Object.entries(saved.cells)) expect(g.fake.items.has(id), lab).toBe(true);
  });
  it(T("A126", "a fake GAME OVER banner just before the end, at the end and after it is rewritten within a few polls (fixtures re-checked and rewritten in the post-game guard)"), async () => {
    const g = await setup({ live: true, fast: true, rules: { ...CALM, gameMinutes: 1, lightningAt: [] } });
    const fake = "GAME OVER - TEAM 1 WINS";
    await g.ticks(16); // 0:48
    g.fake.playerEdit("p1", g.game.fixtureIds.banner!, { content: fake });
    await g.tick();
    expect(g.fx("banner")).not.toContain(fake);
    expect(g.fx("banner")).toContain("LIVE");
    g.fake.playerEdit("p1", g.game.fixtureIds.banner!, { content: fake }); // the poll before the end
    await g.ticks(4);
    expect(g.ref.state.phase).toBe("over");
    expect(g.fx("banner")).toMatch(/GAME OVER · TEAM 1 WINS WITH \d+%\n.*time is up/);
    expect(g.fx("banner")).not.toContain(fake);
    // Post-game, even when the edit is missed (no read by id, the slow listing far away): rewritten within 5 polls.
    (g.fake as { getItem?: unknown }).getItem = undefined;
    g.fake.fullListReads = 100;
    for (const k of ["banner", "scoreboard", "rank_1"] as const) g.fake.playerEdit("p1", g.game.fixtureIds[k]!, { content: fake });
    await g.ticks(5);
    expect(g.fx("banner")).toMatch(/GAME OVER · TEAM 1 WINS WITH \d+%\n.*time is up/);
    expect(g.fx("scoreboard")).not.toContain(fake);
    expect(g.fx("leaderboard")).toContain("TEAM 1 · Boss");
  });
  it(T("A127", "the type-filtered image listing runs every poll, live and after the game: a meme posted after GAME OVER goes on the next poll"), async () => {
    const g = await setup({ live: true, fast: true, rules: { ...CALM, gameMinutes: 1, lightningAt: [] } });
    g.fake.fullListReads = 100; // only the typed listing can see it
    for (let i = 0; i < 25; i++) {
      const before = g.fake.calls.typed;
      await g.tick();
      expect(g.fake.calls.typed - before).toBe(8); // image, embed, document, app_card, card, code, mindmap_node, diagram: every poll
    }
    expect(g.ref.state.phase).toBe("over");
    const meme = g.fake.vandalAdd("c1", "image", { x: 9000, y: 9000, w: 300, h: 300 });
    await g.tick();
    expect(g.fake.items.has(meme.id)).toBe(false);
    const banner = g.fake.vandalAdd("c1", "image", { ...center(FIXTURES.banner), w: 900, h: 100 });
    await g.tick();
    expect(g.fake.items.has(banner.id)).toBe(false);
    expect(g.fake.calls.typed % 8).toBe(0);
  });
  it(T("A128", "rehearsal: a question belongs to the Orders frame it is in (Miro's parent), even when its center sits over the next frame"), async () => {
    const seats: [string, string][] = ["Gus", "Ana", "Dev", "Fay", "Ben", "Hana", "Eli", "Chloe"].map((n) => ["acct", n]);
    const g = await setup({ live: true, ref: { rehearsal: true }, players: seats });
    // Placed by its top-left corner (the MCP convention): the center lands over Team 4's frame / Team 2's frame.
    const q3 = g.fake.playerSticky("acct", "cedar", "Start a fire in Team 4's area?");
    Object.assign(q3, { x: ORDERS.birch.x + 30, y: ORDERS.birch.y + 300 });
    const q1 = g.fake.playerSticky("acct", "ridge", "Start a fire in Team 2's area?");
    Object.assign(q1, { x: ORDERS.pine.x + 30, y: ORDERS.pine.y + 300 });
    await g.ticks(2);
    const section = (n: number) => RANK_SLOTS.map((k) => g.fx(rankKey(k))).find((r) => r.trim().startsWith(`TEAM ${n}`)) ?? "";
    expect(section(3)).toContain("Waiting for a YES: start a fire in Team 4's area");
    expect(section(1)).toContain("Waiting for a YES: start a fire in Team 2's area");
    expect(section(2)).not.toContain("Waiting for a YES");
    expect(section(4)).not.toContain("Waiting for a YES");
    g.fake.playerEditSticky("acct", q3.id, "Start a fire in Team 4's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks).toMatchObject([{ team: "cedar", to: "birch" }]);
    const cedar = Object.values(g.ref.state.players).filter((p) => p.team === "cedar");
    expect(g.ref.state.approvals[q3.id]).toMatchObject({ creator: cedar.find((p) => p.role === "boss")!.userId });
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
