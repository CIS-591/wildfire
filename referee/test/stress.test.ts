// A110: a 10-minute game with 30 bots, 6 of them vandals doing a random attack every few seconds, on a
// Miro that drops a few calls. The referee must never throw, undo every illegal change, count only legal
// paints, end with the board equal to the engine, and never storm Miro with writes.
import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.js";
import { FIXTURES, ORDERS, PANELS, TEAMS, TEAM_INFO, center, type Team } from "../src/layout.js";
import { mulberry32, stickyKind, type PaintEvent } from "../src/rules.js";
import { FakePlayerBoard } from "../src/sim.js";
import { C, RULES, expectConverged, setup, teamOf } from "./harness.js";

const OPPOSITE: Record<Team, Team> = { ridge: "birch", birch: "ridge", pine: "cedar", cedar: "pine" };

describe("stress", () => {
  it('"A110" 10-minute game, 30 bots, 20% vandals, a flaky Miro: no throw, all undone, only legal paints count, no write storm', { timeout: 120_000 }, async () => {
    const rules = { ...RULES, waterTotal: 150, spreadSeconds: 25, pSide: 0.35, pDiag: 0.05, downwindMult: 2.5, upwindMult: 0.4 };
    const audit: { ev: PaintEvent; ok: boolean; team?: Team; grant: boolean; phase: string }[] = [];
    const g = await setup({ rules, players: [], fast: true, statics: true, ref: { onPaint: (ev, d) => audit.push({ ev, ok: d.accept, team: g.ref.state.players[ev.userId]?.team, grant: g.ref.state.outside.some((o) => o.team === g.ref.state.players[ev.userId]?.team && o.to === teamOf(ev.label)), phase: g.ref.state.phase }) } });
    const { fake, ref } = g;
    const rng = mulberry32(Number(process.env.STRESS_SEED ?? 2026));
    const pb = new FakePlayerBoard(fake, ref, () => Math.floor(rng() * 1000));
    const bots = Array.from({ length: 30 }, (_, i) => new Bot(`u${i + 1}`, `Bot ${i + 1}`, mulberry32(1000 + i), { mistakeRate: 0.1 }));
    const vandals = new Set(bots.filter((_, i) => i % 5 === 4).map((b) => b.userId)); // 6 of 30
    for (const b of bots) {
      pb.current = b.userId;
      await pb.join(b.userId, b.name);
    }
    await g.tick();
    for (const b of bots) await b.readInbox(pb, g.now());
    Object.assign(fake.faults, { rate429: 0.02, rate5xx: 0.02, rateTimeout: 0.01, rateGhost: 0.01 });

    const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;
    const squares = () => [...ref.cellId.values()].map((id) => fake.items.get(id)).filter((x) => !!x);
    const lockedByVandals: string[] = [];
    const edit = (u: string, id: string, patch: Parameters<typeof fake.playerEdit>[2], at?: number) => {
      if (fake.items.has(id)) fake.playerEdit(u, id, patch, at);
    };
    const attack = (u: string, team: Team) => {
      const sq = pick(squares());
      const roll = rng();
      if (roll < 0.15) edit(u, sq.id, { fill: pick([C.fire, C.forest, C.burnt, "#ff00ff", ""]) });
      else if (roll < 0.25) {
        const away = pick(ref.cellList.filter((c) => c.sector === OPPOSITE[team]));
        const id = ref.cellId.get(away.label);
        if (id && fake.items.has(id)) edit(u, id, { fill: C.water }); // never a neighbour: never legal
      } else if (roll < 0.3) fake.playerDelete(sq.id);
      else if (roll < 0.35) edit(u, sq.id, { x: sq.x + 70, y: sq.y + 70 });
      else if (roll < 0.38) edit(u, sq.id, { w: 200, h: 20 });
      else if (roll < 0.41) edit(u, sq.id, { rotation: 30 });
      else if (roll < 0.45) edit(u, sq.id, { content: pick(["LOL", "A1", "", "<b>x</b>"]) });
      else if (roll < 0.52) fake.vandalAdd(u, pick(["sticky_note", "image", "text", "shape"]), { x: sq.x, y: sq.y, w: 120, h: 120 }, "hi");
      else if (roll < 0.54) fake.vandalAdd(u, "image", { x: 1150, y: 1090, w: 2600, h: 2600 });
      else if (roll < 0.58) edit(u, g.game.fixtureIds.banner ?? sq.id, { content: "GAME OVER" });
      else if (roll < 0.6) {
        const k = pick(["banner", "scoreboard", "leaderboard"] as const);
        if (g.game.fixtureIds[k]) fake.playerDelete(g.game.fixtureIds[k]!);
      } else if (roll < 0.62) fake.moveFrame(u, pick(fake.gridFrameIds), 200, 100);
      else if (roll < 0.63) fake.deleteFrame(pick(fake.gridFrameIds));
      else if (roll < 0.66) {
        const other = pick([...ref.inboxCard.values()]);
        if (fake.items.has(other)) edit(u, other, { content: "you are frozen forever", x: 50, y: 50 });
      } else if (roll < 0.68) {
        const mine = ref.inboxCard.get(u);
        if (mine && fake.items.has(mine)) fake.playerDelete(mine);
      } else if (roll < 0.72) {
        const q = fake.playerSticky(u, team, `Spray water in ${TEAM_INFO[pick(TEAM_INFO[team].neighbours)].name}'s area?`);
        fake.playerEditSticky(u, q.id, `${stripText(q.content)}\nYES`); // a YES on its own question
      } else if (roll < 0.76) for (let i = 0; i < 5; i++) fake.playerSticky(u, pick(TEAMS), "spam ".repeat(1 + Math.floor(rng() * 500)));
      else if (roll < 0.8) {
        edit(u, sq.id, { fill: "#000001" });
        fake.lock(sq.id);
        lockedByVandals.push(sq.id);
      } else if (roll < 0.84) fake.vandalAdd(u, "sticky_note", { ...center(FIXTURES.banner), w: 300, h: 300 }, "covered");
      else if (roll < 0.88) edit(u, pick(fake.staticIds), { x: 4000, content: "pwned" });
      else if (roll < 0.92) {
        // a burst of blue paints on squares that can't take water
        const dead = [...ref.cellId].filter(([lab]) => ref.state.cells[lab] === "burnt" || ref.state.cells[lab] === "water").slice(0, 10);
        for (const [, id] of dead) edit(u, id, { fill: C.water }, g.now() + Math.floor(rng() * 100));
        const blue = squares().find((s) => s.fill === C.water);
        if (blue) edit(u, blue.id, { fill: C.forest });
      } else if (roll < 0.96) fake.add({ type: "shape", content: `<p>Inbox · ${u} again</p>`, x: PANELS.inbox.x + 600, y: PANELS.inbox.y + 900, w: 380, h: 150 }, u);
      else fake.moveFrame(u, fake.ordersFrameIds[pick(TEAMS)], 500, 0);
    };
    const stripText = (s: string) => s.replace(/<\/p>/g, "\n").replace(/<[^>]*>/g, "").trim();

    // Lobby, then the 10-minute fire. One loop step = 1 s; the referee polls every 3 s.
    let t = 0;
    const answerAt = new Map<string, { at: number; by: string; yes: boolean }>();
    const vandalNext = new Map<string, number>();
    const step = async () => {
      for (const b of bots) {
        pb.current = b.userId;
        if (vandals.has(b.userId)) {
          if (ref.state.phase !== "live" || (vandalNext.get(b.userId) ?? 0) > g.now()) continue;
          await b.readInbox(pb, g.now());
          if (b.team) attack(b.userId, b.team);
          vandalNext.set(b.userId, g.now() + 4000 + Math.floor(rng() * 8000));
          continue;
        }
        if (g.now() < b.nextTurnAt) continue;
        pb.lagMs = 15_000 + Math.floor(rng() * 15_000);
        await b.readInbox(pb, g.now());
        await b.act(pb, g.now());
        b.nextTurnAt = g.now() + Math.round(45 * (b.role === "boss" ? 2 : 1) * (1 + rng() / 3) * 1000);
      }
      for (const team of TEAMS) {
        for (const s of await pb.stickies(team)) {
          if (stickyKind(s.text) !== "QUESTION" || /\n(YES|NO)$/i.test(s.text) || vandals.has(s.createdBy)) continue;
          const a = answerAt.get(s.id);
          if (!a) {
            const mates = bots.filter((b) => b.team === team && b.userId !== s.createdBy && !vandals.has(b.userId));
            if (mates.length) answerAt.set(s.id, { at: g.now() + 20_000 + Math.floor(rng() * 40_000), by: pick(mates).userId, yes: rng() > 0.15 });
          } else if (g.now() >= a.at && fake.items.has(s.id)) fake.playerEditSticky(a.by, s.id, `${s.text}\n${a.yes ? "YES" : "NO"}`);
        }
      }
      if (t % 5 === 0) pb.snapshot(g.now());
      if (t % 3 === 0) {
        const w0 = g.writes();
        g.clock.t += 0;
        await g.tick(0);
        perTick.push(g.writes() - w0);
      }
      g.advance(1000);
      t++;
    };
    const perTick: number[] = [];
    for (let i = 0; i < 30; i++) await step();
    await ref.start();
    for (const b of bots) b.nextTurnAt = g.now() + Math.round(45 * (b.role === "boss" ? 2 : 1) * (0.5 + rng()) * 1000);
    let guard = 0;
    while (ref.state.phase === "live" && guard++ < 1000) await step();
    expect(ref.state.phase).toBe("over");
    expect(ref.state.elapsed).toBeGreaterThanOrEqual(9.9 * 60_000);

    if (process.env.STRESS_LOG) console.log(JSON.stringify({ maxWrites: Math.max(...perTick), ticks: perTick.length, illegal: ref.state.stats.illegal, accepted: ref.state.stats.accepted, failed: fake.calls.failed, calls: fake.calls, logs: g.logs.length, sample: g.logs.filter((l) => /refuses|failed|error/.test(l)).slice(0, 8) }));
    // No write storm: every tick within the cap (the frame repairs included).
    expect(Math.max(...perTick)).toBeLessThanOrEqual(ref.maxWritesPerTick);
    // The vandals really did their worst, and were really undone.
    const illegal = ref.state.stats.illegal;
    expect(illegal.tamper + illegal.color + illegal.area).toBeGreaterThan(50);

    // Only legal paints count: every accepted paint was blue, by an honest joined player, live, in their
    // own area or one their team had a YES for, and ≥ cooldown after their previous accepted paint.
    const accepted = audit.filter((a) => a.ok);
    expect(accepted.length).toBeGreaterThan(20);
    const lastAt = new Map<string, number>();
    for (const a of accepted.sort((x, y) => x.ev.at - y.ev.at)) {
      expect(vandals.has(a.ev.userId)).toBe(false);
      expect(a.ev.fill).toBe(C.water);
      expect(a.phase).toBe("live");
      expect(a.team === teamOf(a.ev.label) || a.grant).toBe(true);
      const prev = lastAt.get(a.ev.userId);
      if (prev !== undefined) expect(a.ev.at - prev).toBeGreaterThanOrEqual(rules.cooldownSeconds * 1000);
      lastAt.set(a.ev.userId, a.ev.at);
    }
    for (const u of vandals) expect(ref.state.stats.byPlayer[u]?.water ?? 0).toBe(0);
    const waterCells = Object.values(ref.state.cells).filter((s) => s === "water").length;
    expect(waterCells).toBe(ref.state.stats.accepted);
    expect(ref.state.stats.accepted).toBe(accepted.length);
    expect(ref.state.water).toBe(rules.waterTotal - accepted.length);

    // After the game (the referee keeps guarding), Miro calms down and the vandals unlock: the board matches the engine.
    Object.assign(fake.faults, { rate429: 0, rate5xx: 0, rateTimeout: 0, rateGhost: 0 });
    for (const id of lockedByVandals) fake.unlock(id);
    await g.ticks(40);
    expectConverged(g);
    for (const t of TEAMS) {
      const st = fake.frames.get(ref.frameIds[0]!);
      expect(st).toBeDefined();
      expect([...fake.frames.values()].some((f) => Math.abs(f.x - center(ORDERS[t]).x) < 2 && Math.abs(f.y - center(ORDERS[t]).y) < 2)).toBe(true);
    }
    // And the scores the projector shows are the board's, not anything a vandal painted.
    const boardScore = (team: Team) => ref.cellList.filter((c) => c.sector === team && [C.forest, C.water].includes(fake.items.get(ref.cellId.get(c.label)!)!.fill!)).length;
    for (const t of TEAMS) expect(boardScore(t)).toBe(ref.cellList.filter((c) => c.sector === t && ["forest", "water"].includes(ref.state.cells[c.label]!)).length);
  });
});
