// Two referees on one board (two Miro tokens = two users = two rate-limit budgets): the GAME referee
// (squares, fire, fixtures, cards, game.json) and the GUARD referee (junk, statics, foreign stickies, joins).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { FakeBoard, REFEREE_USER } from "../src/fake-board.js";
import { JOINS_FILE, NOTES_FILE, gameFileLink, guardFileLink, memoryLink, type GuardLink } from "../src/guard-link.js";
import { GRID_BOX, ORDERS, PANELS, STATE_COLOR, cellBox, center } from "../src/layout.js";
import { Referee, emptyGame, type GameFile } from "../src/referee.js";
import { mulberry32 } from "../src/rules.js";
import { CALM, PLAYERS, expectConverged, setup as setupSolo } from "./harness.js";

const GUARD_USER = "referee2";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setupSplit(o: { files?: boolean; live?: boolean } = {}) {
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const fake = FakeBoard.seeded(now);
  fake.enableFastReads();
  const game: GameFile = emptyGame();
  const logs: string[] = [];
  let gameLink: GuardLink;
  let guardLink: GuardLink;
  let dir = "";
  if (o.files) {
    dir = mkdtempSync(path.join(tmpdir(), "wildfire-split-"));
    dirs.push(dir);
    gameLink = gameFileLink(dir, game);
    guardLink = guardFileLink(dir, () => structuredClone(game));
  } else {
    const m = memoryLink(() => game);
    gameLink = m.game;
    guardLink = m.guard;
  }
  const statics = new Set(fake.staticIds);
  const ref = new Referee(fake, game, CALM, { now, log: (s) => logs.push(`[game] ${s}`), rng: mulberry32(42), staticIds: statics, role: "game", selfId: REFEREE_USER, selfIds: [GUARD_USER], link: gameLink });
  const guardBoard = fake.as(GUARD_USER);
  const guard = new Referee(guardBoard, emptyGame(), CALM, { now, log: (s) => logs.push(`[guard] ${s}`), rng: mulberry32(7), staticIds: statics, role: "guard", selfId: GUARD_USER, selfIds: [REFEREE_USER], link: guardLink });
  await ref.discover();
  await ref.rebuildMissing();
  await guard.discoverGuard();
  const tickGame = async (ms = 1500) => {
    clock.t += ms;
    const r = await ref.tick();
    expect(r.error, `game tick threw: ${r.error}`).toBeUndefined();
    return r;
  };
  const tickGuard = async (ms = 1500) => {
    clock.t += ms;
    const r = await guard.tick();
    expect(r.error, `guard tick threw: ${r.error}`).toBeUndefined();
    return r;
  };
  /** One round: the game, then the guard (as the two processes interleave). */
  const round = async () => {
    await tickGame();
    await tickGuard();
  };
  const rounds = async (n: number) => {
    for (let i = 0; i < n; i++) await round();
  };
  const card = (u: string) => stripHtml(fake.items.get(ref.inboxCard.get(u) ?? "")?.content ?? "");
  const joinAll = async () => {
    for (const [u, n] of PLAYERS) fake.playerJoin(u, n);
    await tickGame(); // the game alone never notices a new card: no sweep
    expect(Object.keys(ref.state.players)).toEqual([]);
    await tickGuard(); // the guard sees the cards
    await rounds(2);
  };
  await rounds(1);
  if (o.live) {
    await joinAll();
    await ref.start();
  }
  return { fake, ref, guard, game, logs, dir, tickGame, tickGuard, round, rounds, card, joinAll, clock };
}

describe("two referees (MIRO_ACCESS_TOKEN_2)", () => {
  it("a join seen by the guard (state/joins.jsonl) gets its team and card from the game referee", async () => {
    const g = await setupSplit({ files: true });
    await g.joinAll();
    const joins = readFileSync(path.join(g.dir, JOINS_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { cardId: string; createdBy: string });
    expect(joins.map((j) => j.createdBy).sort()).toEqual(PLAYERS.map(([u]) => u).sort());
    for (const [u, n] of PLAYERS) {
      const p = g.ref.state.players[u];
      expect(p, n).toBeDefined();
      expect(g.card(u)).toContain(n);
      expect(g.card(u)).toMatch(/TEAM \d/i);
    }
    // The game keeps how far it read with the game: a restart neither loses nor repeats a join.
    expect(g.game.guardRead!.joins).toBe(readFileSync(path.join(g.dir, JOINS_FILE)).length);
    // The card was placed by the game's token, never the guard's.
    for (const [u] of PLAYERS) expect(g.fake.items.get(g.ref.inboxCard.get(u)!)!.modifiedBy).toBe(REFEREE_USER);
    // A second card from the same player: the game removes it (it owns inbox cards), once.
    const extra = g.fake.playerJoin("r1", "Rita again").card.id;
    await g.rounds(3);
    expect(g.fake.items.has(extra)).toBe(false);
    expect(g.card("r1")).toContain("already have an inbox card");
  });

  it("the guard deletes junk, the game doesn't; the penalty lands on the player's card (state/guard-feedback.jsonl)", async () => {
    const g = await setupSplit({ files: true, live: true });
    const c = center(cellBox(g.ref.cells.get("J9")!));
    const meme = g.fake.vandalAdd("p1", "image", { x: c.x, y: c.y, w: 200, h: 200 }, "https://example.com/meme.png");
    const label = g.fake.vandalAdd("c1", "shape", { x: GRID_BOX.x + 400, y: GRID_BOX.y + 400, w: 300, h: 100 }, "LOL", "#ff0000");
    const deletedByGame: string[] = [];
    const del = g.fake.deleteItem.bind(g.fake);
    g.fake.deleteItem = (id: string) => (deletedByGame.push(id), del(id)); // the guard's view inherits this too: checked before its tick
    await g.tickGame();
    await g.tickGame();
    expect(g.fake.items.has(meme.id)).toBe(true);
    expect(g.fake.items.has(label.id)).toBe(true);
    expect(deletedByGame).not.toContain(meme.id); // the game removed no junk (only its own replaced icons, if any)
    expect(deletedByGame).not.toContain(label.id);
    await g.tickGuard();
    expect(g.fake.items.has(meme.id)).toBe(false);
    expect(g.fake.items.has(label.id)).toBe(false);
    const notes = readFileSync(path.join(g.dir, NOTES_FILE), "utf8");
    expect(notes).toContain('"userId":"p1"');
    await g.tickGame();
    expect(g.card("p1")).toMatch(/image/i);
    expect(g.card("c1")).toMatch(/forest/i);
    expect(g.ref.state.junk?.p1).toBe(1); // the game applied the penalty (counted in game.json)
    expectConverged({ fake: g.fake, ref: g.ref, game: g.game } as Parameters<typeof expectConverged>[0]);
  });

  it("the guard puts back a moved board label; the game never writes statics", async () => {
    const g = await setupSplit({ live: true });
    const rulesPanel = g.fake.staticIds[2]!;
    const before = { ...g.fake.items.get(rulesPanel)! };
    g.fake.playerEdit("b1", rulesPanel, { x: before.x + 500, y: before.y - 200 });
    await g.tickGame();
    await g.tickGame();
    expect(g.fake.items.get(rulesPanel)!.x).toBe(before.x + 500);
    await g.tickGuard();
    const after = g.fake.items.get(rulesPanel)!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(after.modifiedBy).toBe(GUARD_USER);
    await g.rounds(3);
    expect(g.card("b1")).toMatch(/Put back a board panel/i);
    // The guard's own put-back is never judged as a move (by either referee).
    const penalties = g.ref.state.timeoutUntil;
    expect(Object.keys(penalties)).not.toContain(GUARD_USER);
    expect(g.logs.join("\n")).not.toContain(GUARD_USER);
  });

  it("neither referee undoes or penalises the other's writes (two self ids)", async () => {
    const g = await setupSplit({ live: true });
    // The game paints the fire and rebuilds a square a player deleted; the guard leaves all of it alone.
    g.fake.playerPaint("r1", "B2", STATE_COLOR.water);
    const old = g.ref.cellId.get("C3")!;
    g.fake.playerDelete(old);
    await g.rounds(6);
    const fresh = g.ref.cellId.get("C3")!;
    expect(fresh).not.toBe(old);
    expect(g.fake.items.has(fresh)).toBe(true);
    expect(g.fake.items.get(fresh)!.createdBy).toBe(REFEREE_USER);
    // A square moved off its place: the game replaces it, the guard removes the old one (the game's stuck list).
    const moved = g.ref.cellId.get("D4")!;
    const d4 = g.fake.items.get(moved)!;
    g.fake.playerEdit("p1", moved, { x: d4.x + 7 });
    await g.rounds(4);
    expect(g.fake.items.has(moved)).toBe(false);
    expect(g.ref.cellId.get("D4")).not.toBe(moved);
    // The guard moves a board panel back (its write), the game writes cards and fixtures (its writes).
    const rulesPanel = g.fake.staticIds[2]!;
    const p = g.fake.items.get(rulesPanel)!;
    g.fake.playerEdit("c1", rulesPanel, { x: p.x + 300 });
    await g.rounds(6);
    // Nothing the two referees made was deleted or reverted as junk: the board converged.
    expectConverged({ fake: g.fake, ref: g.ref, game: g.game } as Parameters<typeof expectConverged>[0]);
    // No penalty, line or freeze ever names either referee.
    for (const u of [REFEREE_USER, GUARD_USER]) {
      expect(g.ref.state.players[u]).toBeUndefined();
      expect(g.ref.state.timeoutUntil[u]).toBeUndefined();
      expect(g.ref.state.junk?.[u]).toBeUndefined();
    }
    // The player who moved D4 is penalised once (the game's penalty and the guard's carry the same key).
    expect(g.card("p1").match(/D4/g)?.length ?? 0).toBe(1);
    // The guard never wrote a square, fixture or card.
    const gameItems = new Set([...g.ref.cellId.values(), ...Object.values(g.game.fixtureIds), ...g.ref.inboxCard.values()]);
    for (const id of gameItems) expect(g.fake.items.get(id)!.modifiedBy, id).not.toBe(GUARD_USER);
  });

  it("the game reads the Orders frames on its own: questions and YES are judged without a sweep", async () => {
    const g = await setupSplit({ live: true });
    const boss = Object.values(g.ref.state.players).find((p) => p.team === "ridge")!;
    const mate = Object.values(g.ref.state.players).find((p) => p.team === "ridge" && p.userId !== boss.userId)!;
    const q = g.fake.playerSticky(boss.userId, "ridge", "Start a fire in Team 2's area?");
    await g.tickGame();
    g.fake.playerEditSticky(mate.userId, q.id, "Start a fire in Team 2's area?\nYES");
    await g.tickGame();
    expect(g.ref.state.approvals[q.id]?.status).toBe("approved");
    expect(g.fake.calls.orders).toBeGreaterThan(0);
    // A sticky in another team's Orders: left to the guard, which removes it and tells the player.
    const foreign = g.fake.playerSticky("p1", "ridge", "Start a fire in Team 3's area?");
    await g.tickGame();
    expect(g.fake.items.has(foreign.id)).toBe(true);
    await g.tickGuard();
    expect(g.fake.items.has(foreign.id)).toBe(false);
    await g.tickGame();
    expect(g.card("p1")).toMatch(/Removed your sticky/);
    expect(ORDERS.ridge).toBeDefined();
  });

  it("the game reads fixtures by id every 3rd tick when asked; writes still follow the engine", async () => {
    const clock = { t: 1_000_000 };
    const fake = FakeBoard.seeded(() => clock.t);
    fake.enableFastReads();
    const ref = new Referee(fake, emptyGame(), CALM, { now: () => clock.t, log: () => {}, rng: mulberry32(1), fixtureReadEvery: 3 });
    await ref.discover();
    const gets: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = fake.calls.get;
      clock.t += 1500;
      await ref.tick();
      gets.push(fake.calls.get - before);
    }
    expect(gets.filter((n) => n >= 20).length).toBe(2); // ticks 1 and 4 read the 22 fixtures
    fake.playerJoin("r1", "Rita");
    for (let i = 0; i < 4; i++) {
      clock.t += 1500;
      await ref.tick();
    }
    expect(stripHtml(fake.items.get(ref.game.fixtureIds.team_ridge!)!.content)).toContain("Rita");
  });
});

describe("one token (no MIRO_ACCESS_TOKEN_2): exactly as before", () => {
  it("the solo referee removes junk and joins players itself, and writes no split-only state", async () => {
    const g = await setupSolo({ live: true, statics: true });
    expect(g.ref.role).toBe("solo");
    const c = center(cellBox(g.ref.cells.get("J9")!));
    const meme = g.fake.vandalAdd("p1", "image", { x: c.x, y: c.y, w: 200, h: 200 }, "https://example.com/meme.png");
    await g.ticks(2);
    expect(g.fake.items.has(meme.id)).toBe(false);
    for (const [u] of PLAYERS) expect(g.ref.state.players[u]).toBeDefined();
    expect(g.game.cells).toBeUndefined();
    expect(g.game.guardRead).toBeUndefined();
    expect(g.fake.calls.orders).toBe(0);
    expect(PANELS.inbox).toBeDefined();
  });
});
