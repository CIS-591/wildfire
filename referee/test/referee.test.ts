import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { FakeBoard } from "../src/fake-board.js";
import { FIXTURES, PANELS, STATE_COLOR, RANK_SLOTS, rankKey, center, inboxSlot, inside } from "../src/layout.js";
import { Referee, emptyGame, type GameFile } from "../src/referee.js";
import { mulberry32, type RuleSet } from "../src/rules.js";

const rules: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, burnTicks: 3, lightningAt: [5], lightningMinDistance: 6, startFires: [], paintBatch: 1,
  waterPerTeam: 400, cooldownSeconds: 5, timeoutSeconds: 5, attackMinutes: 2, attackSquares: 3, attacksPerTeam: 2, gameMinutes: 10,
};
const C = STATE_COLOR;

async function setup(opts: { presets?: Record<string, "ridge" | "pine" | "cedar" | "birch"> } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const fake = FakeBoard.seeded(now);
  const game = emptyGame();
  const ref = new Referee(fake, game, rules, { now, log: () => {}, presets: opts.presets, rng: mulberry32(42) });
  const d = await ref.discover();
  t += 1000;
  const cards: Record<string, string> = {};
  for (const [u, n] of [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"]] as const) cards[u] = fake.playerJoin(u, n).card.id;
  const tick = async (ms = 3000) => {
    t += ms;
    return ref.tick();
  };
  await tick();
  const text = (id: string) => stripHtml(fake.items.get(id)!.content);
  const fx = (k: keyof GameFile["fixtureIds"] | "leaderboard") => (k === "leaderboard" ? RANK_SLOTS.map((n) => text(game.fixtureIds[rankKey(n)]!)).join("\n") : text(game.fixtureIds[k]!));
  return { fake, ref, game, d, cards, tick, text, fx, advance: (ms: number) => (t += ms) };
}

describe("discovery and joining", () => {
  it("finds every square and the fixtures, creating the missing leaderboard", async () => {
    const { d, game, fake } = await setup();
    expect(d.cells).toBe(1224);
    expect(d.missing).toEqual([]);
    expect(d.fixtures.sort()).toEqual(["banner", "rank_1", "rank_1_score", "rank_2", "rank_2_score", "rank_3", "rank_3_score", "rank_4", "rank_4_score", "scoreboard"]);
    const lb = fake.items.get(game.fixtureIds.rank_1!)!;
    expect(inside(FIXTURES.rank_1, lb.x, lb.y)).toBe(true);
  });
  it("an inbox card is a join: 4 teams, boss first, card slotted and welcomed", async () => {
    const { fake, ref, cards, text, fx } = await setup();
    expect(ref.state.players.r1).toMatchObject({ team: "ridge", role: "boss" });
    expect(ref.state.players.r2).toMatchObject({ team: "ridge", role: "worker" });
    expect(ref.state.players.b1?.team).toBe("birch");
    expect(text(cards.r1!)).toContain("Rita · TEAM 1 · 👑 BOSS · 0 squares");
    expect(text(cards.r2!)).toContain("You are a WORKER");
    const card = fake.items.get(cards.r1!)!;
    expect([card.x, card.y]).toEqual(Object.values(center(inboxSlot(0))));
    expect(fx("leaderboard")).toContain("Crew: Rob");
    expect(fx("banner")).toContain("/join now");
    expect(text(cards.r1!)).toContain("Your area: A–R, rows 1–17");
    for (const k of ["banner", "leaderboard", "scoreboard"] as const) expect(fx(k)).not.toMatch(/sector/i);
    expect(text(cards.r1!)).not.toMatch(/sector/i);
  });
  it("preset teams win over balancing", async () => {
    const { fake, ref, tick } = await setup({ presets: { dana: "birch" } });
    fake.playerJoin("d", "Dana");
    await tick();
    expect(ref.state.players.d?.team).toBe("birch");
  });
  it("a second inbox card from the same player is removed", async () => {
    const { fake, ref, tick } = await setup();
    const extra = fake.add({ type: "shape", content: "<p>Inbox · Rita Again</p>", x: PANELS.inbox.x + 900, y: PANELS.inbox.y + 600, w: 380, h: 150 }, "r1");
    await tick();
    expect(fake.items.has(extra.id)).toBe(false);
    expect(ref.state.players.r1?.name).toBe("Rita");
  });
});

describe("the game", () => {
  it("blue in your team's area is kept, outside it undone; after a teammate's YES orange in that neighbour's area counts", async () => {
    const { fake, ref, cards, tick, text, fx, advance } = await setup();
    await ref.start();
    fake.playerPaint("r2", "C4", C.water);
    await tick();
    expect(fake.cell("C4").fill).toBe(C.water);
    expect(ref.state.water.ridge).toBe(399);
    expect(text(cards.r2!)).toContain("C4 is now water. 399 water left for Team 1.");
    advance(30_000);
    fake.playerPaint("r2", "Z4", C.water);
    await tick();
    expect(fake.cell("Z4").fill).toBe(C.forest);
    expect(text(cards.r2!)).toContain("Z4 undone: it is Team 2's area");
    const q = fake.playerSticky("r1", "ridge", "Start a fire in Team 2's area?\nOur area is under control");
    await tick();
    expect(fx("leaderboard")).toContain("Waiting for a YES: start a fire in Team 2's area");
    fake.playerEditSticky("r1", q.id, "Start a fire in Team 2's area?\nOur area is under control\nYES");
    await tick();
    expect(ref.state.attacks).toHaveLength(0);
    expect(text(cards.r1!)).toContain("did not post it");
    fake.playerEditSticky("r2", q.id, "Start a fire in Team 2's area?\nOur area is under control\nYES");
    await tick();
    expect(text(cards.r2!)).toContain("Rob said YES: you may paint orange #ff5a1f on up to 3 green squares in Team 2's area");
    expect(text(cards.p1!)).toContain("Team 1 may set fire to your area");
    expect(fx("leaderboard")).toMatch(/ATTACK ON TEAM 2: 3 fires left \(\d:\d\d\)/);
    fake.playerPaint("r2", "Z4", C.fire);
    await tick();
    expect(fake.cell("Z4").fill).toBe(C.fire);
    expect(fx("banner")).toContain("TEAM 1 SET FIRE TO TEAM 2'S AREA!");
    expect(fx("leaderboard")).toContain("Fires set 1 · Trees burned 0");
    expect(fx("leaderboard")).toContain("ATTACK ON TEAM 2: 2 fires left");
    for (let i = 0; i < 41; i++) await tick(); // 2 min later
    expect(text(cards.r2!)).toContain("Your attack on Team 2's area is over");
    fake.playerPaint("r2", "Z9", C.fire);
    await tick();
    expect(fake.cell("Z9").fill).toBe(C.forest);
  });
  it("rehearsal (one Miro account): the question's creator is the team's boss, its answerer another member", async () => {
    let t = 1_000_000;
    const now = () => t;
    const fake = FakeBoard.seeded(now);
    const ref = new Referee(fake, emptyGame(), rules, { now, log: () => {}, rng: mulberry32(1), rehearsal: true });
    await ref.discover();
    for (const n of ["Fay", "Ana", "Ben", "Eli", "Hana"]) fake.playerJoin("me", n);
    await ((t += 3000), ref.tick());
    expect(Object.keys(ref.state.players)).toHaveLength(5);
    await ref.start();
    const q = fake.playerSticky("me", "ridge", "Start a fire in Team 2's area?");
    await ((t += 3000), ref.tick());
    fake.playerEditSticky("me", q.id, "Start a fire in Team 2's area?\nYES");
    await ((t += 3000), ref.tick());
    expect(ref.state.attacks).toMatchObject([{ team: "ridge", to: "pine" }]);
    const ridge = Object.values(ref.state.players).filter((p) => p.team === "ridge");
    expect(ref.state.approvals[q.id]).toMatchObject({ creator: ridge.find((p) => p.role === "boss")!.userId, by: ridge.find((p) => p.role === "worker")!.userId });
  });
  it("the referee spreads and burns out the fire, and never paints water", async () => {
    const { fake, ref, tick, fx } = await setup();
    expect(fake.cell("R17").fill).toBe(C.fire); // the reset board: four centre squares on fire
    await ref.start();
    for (let i = 0; i < 60; i++) await tick(); // 3 minutes
    const fills = new Set([...fake.items.values()].filter((i) => /^<p>[A-Z]{1,2}\d{1,2}<\/p>$/.test(i.content)).map((i) => i.fill));
    expect([...fills].every((f) => [C.forest, C.fire, C.burnt].includes(f!))).toBe(true);
    expect(fake.cell("R17").fill).toBe(C.burnt);
    expect(ref.state.spreads).toBe(9);
    expect(fx("banner")).toMatch(/LIVE · \d+:\d\d left · next spread \d+s · WATER T1 400 · T2 400 · T3 400 · T4 400/);
    expect(fx("banner")).not.toMatch(/wind/i);
    expect(fx("scoreboard")).toMatch(/TEAM 1 \d+%.*TEAM 2 \d+%.*\n.*TEAM 3 \d+%.*TEAM 4 \d+%/);
  });
  it("other colors are undone with the reason on the card", async () => {
    const { fake, ref, cards, tick, text } = await setup();
    await ref.start();
    fake.playerPaint("p1", "Z4", C.fire);
    await tick();
    expect(fake.cell("Z4").fill).toBe(C.forest);
    expect(text(cards.p1!)).toContain(`paint only blue ${C.water}`);
  });
  it("the game ends after gameMinutes", async () => {
    const { ref, tick, fx } = await setup();
    await ref.start();
    for (let i = 0; i < 205; i++) await tick();
    expect(ref.state.phase).toBe("over");
    expect(fx("banner")).toMatch(/GAME OVER/);
  });
  it("a moved square is replaced and the mover frozen; junk on the forest is removed", async () => {
    const { fake, ref, tick, cards, text } = await setup();
    await ref.start();
    const sq = fake.cell("D5");
    fake.playerEdit("r1", sq.id, { x: sq.x + 50 });
    const junk = fake.add({ type: "sticky_note", content: "<p>hi</p>", x: 300, y: 300, w: 160, h: 160 }, "r2");
    await tick();
    await tick();
    expect(fake.items.has(sq.id)).toBe(false);
    expect(fake.cell("D5").x).toBe(3 * 64 + 30);
    expect(fake.items.has(junk.id)).toBe(false);
    expect(text(cards.r1!)).toContain("frozen for 5 s");
  });
  it("stop ends the game: the banner names the winner", async () => {
    const { ref, fx } = await setup();
    await ref.start();
    await ref.stop();
    expect(fx("banner")).toMatch(/GAME OVER · TEAM \d WINS WITH \d+%\n.*stopped/);
  });
  it("fast reads: a deleted or moved banner is repaired even though a sweep is older than its last write", async () => {
    let t = 1_000_000;
    const now = () => t;
    const fake = FakeBoard.seeded(now);
    const game = emptyGame();
    const ref = new Referee(fake, game, rules, { now, log: () => {}, rng: mulberry32(7), frameIds: Array.from({ length: 9 }, (_, i) => `f${i}`) });
    await ref.discover();
    // A sweep (full listItems) answers 3 grid reads after it was asked, like a real 18 s sweep.
    const list = fake.listItems.bind(fake);
    const waiting: (() => void)[] = [];
    fake.listItems = () => list().then((snap) => new Promise((res) => waiting.push(() => res(snap))));
    let reads = 0;
    fake.listGridItems = async () => {
      if (++reads % 3 === 0) {
        waiting.splice(0).forEach((f) => f());
        await Promise.resolve();
      }
      return [...fake.items.values()].filter((i) => ref.idCell.has(i.id)).map((i) => ({ ...i }));
    };
    const tick = async () => ((t += 3000), ref.tick());
    fake.playerJoin("r1", "Rita");
    for (let i = 0; i < 6; i++) await tick();
    await ref.start();
    const old = game.fixtureIds.banner!;
    fake.playerDelete(old);
    for (let i = 0; i < 12; i++) await tick();
    expect(game.fixtureIds.banner).not.toBe(old);
    expect(fake.items.has(game.fixtureIds.banner!)).toBe(true);
    const sb = fake.items.get(game.fixtureIds.scoreboard!)!;
    const x = sb.x;
    fake.playerEdit("r1", sb.id, { x: x + 300 });
    for (let i = 0; i < 12; i++) await tick();
    expect(fake.items.get(sb.id)!.x).toBe(x);
  });
});
