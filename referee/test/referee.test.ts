import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { FakeBoard } from "../src/fake-board.js";
import { FIXTURES, PANELS, STATE_COLOR, center, inboxSlot, inside } from "../src/layout.js";
import { Referee, emptyGame, type GameFile } from "../src/referee.js";
import { mulberry32, type RuleSet } from "../src/rules.js";

const rules: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, downwindMult: 2, upwindMult: 0.3, pEmber: 0.03, burnTicks: 3, windMinutes: 5, lightningAt: [10, 18], lightningMinDistance: 6,
  wetSeconds: 90, waterTotal: 400, cooldownSeconds: 5, timeoutSeconds: 5, backburnMax: 20, helpMinutes: 3, helpPlayers: 2, gameMinutes: 30, quietSpreads: 2,
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
  const fx = (k: keyof GameFile["fixtureIds"]) => text(game.fixtureIds[k]!);
  return { fake, ref, game, d, cards, tick, text, fx, advance: (ms: number) => (t += ms) };
}

describe("discovery and joining", () => {
  it("finds every square and the fixtures, creating the missing leaderboard", async () => {
    const { d, game, fake } = await setup();
    expect(d.cells).toBe(1224);
    expect(d.missing).toEqual([]);
    expect(d.fixtures.sort()).toEqual(["banner", "leaderboard", "scoreboard"]);
    const lb = fake.items.get(game.fixtureIds.leaderboard!)!;
    expect(inside(FIXTURES.leaderboard, lb.x, lb.y)).toBe(true);
  });
  it("an inbox card is a join: 4 teams, boss first, card slotted and welcomed", async () => {
    const { fake, ref, cards, text, fx } = await setup();
    expect(ref.state.players.r1).toMatchObject({ team: "ridge", role: "boss" });
    expect(ref.state.players.r2).toMatchObject({ team: "ridge", role: "worker" });
    expect(ref.state.players.b1?.team).toBe("birch");
    expect(text(cards.r1!)).toContain("Rita · Team RIDGE · BOSS · 0 paints");
    expect(text(cards.r2!)).toContain("You are a WORKER");
    const card = fake.items.get(cards.r1!)!;
    expect([card.x, card.y]).toEqual(Object.values(center(inboxSlot(0))));
    expect(fx("leaderboard")).toContain("crew: Rob");
    expect(fx("banner")).toContain("/join now");
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
  it("the PLAN sticky gates paints: refused and reverted before a teammate's YES, kept after", async () => {
    const { fake, ref, cards, tick, text, fx } = await setup();
    await ref.start();
    const plan = fake.playerSticky("r1", "ridge", "PLAN\nhold the line");
    fake.playerPaint("r2", "C4", C.water);
    await tick();
    expect(fake.cell("C4").fill).toBe(C.forest);
    expect(text(cards.r2!)).toContain("no approved PLAN");
    expect(fx("leaderboard")).toContain("PLAN by Rita waits for a YES");
    fake.playerEditSticky("r1", plan.id, "PLAN\nhold the line\nYES");
    await tick();
    expect(ref.state.plan.ridge).toBeUndefined();
    expect(text(cards.r1!)).toContain("did not post it");
    fake.playerEditSticky("r2", plan.id, "PLAN\nhold the line\nYES");
    await tick();
    expect(ref.state.plan.ridge).toBe(plan.id);
    expect(text(cards.r1!)).toContain("PLAN approved by Rob");
    fake.playerPaint("r2", "C4", C.water);
    await tick();
    expect(fake.cell("C4").fill).toBe(C.water);
    expect(ref.state.water).toBe(399);
    expect(text(cards.r2!)).toContain("C4 soaked");
  });
  it("the referee spreads and burns out the fire, and never paints water, firebreak or backburn", async () => {
    const { fake, ref, tick, fx } = await setup();
    await ref.start();
    expect(fake.cell("R17").fill).toBe(C.fire);
    for (let i = 0; i < 60; i++) await tick(); // 3 minutes
    const fills = new Set([...fake.items.values()].filter((i) => /^<p>[A-Z]{1,2}\d{1,2}<\/p>$/.test(i.content)).map((i) => i.fill));
    expect([...fills].every((f) => [C.forest, C.cabin, C.river, C.fire, C.burnt].includes(f!))).toBe(true);
    expect(fake.cell("R17").fill).toBe(C.burnt);
    expect(ref.state.spreads).toBe(9);
    expect(fx("banner")).toMatch(/LIVE · \d+:\d\d left · WIND \S+ [NESW]{1,2} · next spread \d+s · 💧 400\/400/);
    expect(fx("scoreboard")).toMatch(/RIDGE \d+%.*PINE VALLEY \d+%.*\n.*CEDAR CREEK \d+%.*BIRCH HOLLOW \d+%/);
  });
  it("illegal colors are reverted with the reason on the card", async () => {
    const { fake, ref, cards, tick, text } = await setup();
    await ref.start();
    ref.state.plan.pine = "x";
    fake.playerPaint("p1", "Z4", C.fire);
    await tick();
    expect(fake.cell("Z4").fill).toBe(C.forest);
    expect(text(cards.p1!)).toContain("paint only water");
    fake.playerPaint("p1", "C4", C.water, 1_000_000 + 60_000);
    await tick();
    expect(fake.cell("C4").fill).toBe(C.forest);
    expect(text(cards.p1!)).toContain("it's in Ridge");
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
    expect(text(cards.r1!)).toContain("frozen for 5s");
  });
  it("stop ends the game: the banner names the winner", async () => {
    const { ref, fx } = await setup();
    await ref.start();
    await ref.stop();
    expect(fx("banner")).toMatch(/GAME OVER \(stopped\) · 🏆 \S+/);
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
