// Shared set-up for the attack and stress tests: a seeded fake board (frames, statics, every square),
// a referee on a virtual clock, five players, and checks that the board agrees with the engine.
import { expect } from "vitest";
import { stripHtml } from "../src/board.js";
import { FakeBoard } from "../src/fake-board.js";
import { FIXTURES, GRID, GRID_BOX, STATE_COLOR, RANK_SLOTS, rankKey, cellBox, center, type Team } from "../src/layout.js";
import { Referee, emptyGame, type GameFile, type RefereeOptions, type TickResult } from "../src/referee.js";
import { mulberry32, type RuleSet } from "../src/rules.js";

export const C = STATE_COLOR;
export const RULES: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, burnTicks: 3, lightningAt: [5], lightningMinDistance: 6, startFires: [], paintBatch: 1,
  waterPerTeam: 400, cooldownSeconds: 5, timeoutSeconds: 5, attackMinutes: 2, attackSquares: 3, attacksPerTeam: 2, gameMinutes: 10,
};
/** No spread: the board only changes when a test changes it. */
export const CALM: RuleSet = { ...RULES, pSide: 0, pDiag: 0 };

export const PLAYERS: [string, string][] = [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"]];

export interface SetupOptions {
  rules?: RuleSet;
  fast?: boolean;
  statics?: boolean;
  players?: [string, string][];
  ref?: Partial<RefereeOptions>;
  live?: boolean;
  game?: GameFile;
  fake?: FakeBoard;
  t0?: number;
}

export async function setup(o: SetupOptions = {}) {
  const clock = { t: o.t0 ?? 1_000_000 };
  const now = () => clock.t;
  const fake = o.fake ?? FakeBoard.seeded(now);
  fake.now = now;
  if (o.fast) fake.enableFastReads();
  const game = o.game ?? emptyGame();
  const logs: string[] = [];
  const ref = new Referee(fake, game, o.rules ?? CALM, {
    now,
    log: (s) => logs.push(s),
    rng: mulberry32(42),
    staticIds: o.statics ? new Set(fake.staticIds) : undefined,
    ...o.ref,
  });
  await ref.discover();
  await ref.rebuildMissing();
  const results: TickResult[] = [];
  const tick = async (ms = 3000) => {
    clock.t += ms;
    const r = await ref.tick();
    expect(r.error, `tick threw inside: ${r.error}`).toBeUndefined();
    results.push(r);
    return r;
  };
  const ticks = async (n: number, ms = 3000) => {
    let last: TickResult | undefined;
    for (let i = 0; i < n; i++) last = await tick(ms);
    return last!;
  };
  const cards: Record<string, string> = {};
  if (!o.game) {
    for (const [u, n] of o.players ?? PLAYERS) cards[u] = fake.playerJoin(u, n).card.id;
    await tick();
  }
  if (o.live) await ref.start();
  /** The square the referee tracks for a label. */
  const sq = (label: string) => fake.items.get(ref.cellId.get(label) ?? "")!;
  const fill = (label: string) => sq(label)?.fill;
  const card = (u: string) => stripHtml(fake.items.get(ref.inboxCard.get(u) ?? "")?.content ?? "");
  const one = (k: keyof GameFile["fixtureIds"]) => stripHtml(fake.items.get(game.fixtureIds[k] ?? "")?.content ?? "");
  /** A fixture's text; "leaderboard" = the four leaderboard rows. */
  const fx = (k: keyof GameFile["fixtureIds"] | "leaderboard") => (k === "leaderboard" ? RANK_SLOTS.map((n) => one(rankKey(n))).join("\n") : one(k));
  const writes = () => fake.calls.update + fake.calls.create + fake.calls.delete + fake.calls.frame;
  return { fake, ref, game, logs, tick, ticks, cards, sq, fill, card, fx, writes, results, clock, advance: (ms: number) => (clock.t += ms), now };
}

export type Game = Awaited<ReturnType<typeof setup>>;

/** The board agrees with the engine: every square once, right place/text/fill; fixtures there; nothing foreign on the forest. */
export function expectConverged(g: Game, opts: { allowStuck?: boolean } = {}) {
  const { fake, ref, game } = g;
  const bad: string[] = [];
  for (const c of ref.cellList) {
    const it = fake.items.get(ref.cellId.get(c.label) ?? "");
    if (!it) {
      bad.push(`${c.label} missing`);
      continue;
    }
    const want = center(cellBox(c));
    if (stripHtml(it.content) !== c.label) bad.push(`${c.label} text ${stripHtml(it.content)}`);
    if (Math.abs(it.x - want.x) > 1 || Math.abs(it.y - want.y) > 1 || it.w !== GRID.cell || it.h !== GRID.cell || it.rotation) bad.push(`${c.label} geometry`);
    if ((it.fill ?? "").toLowerCase() !== ref.fillOf(c.label)) bad.push(`${c.label} fill ${it.fill} != ${ref.fillOf(c.label)}`);
  }
  for (const k of ["banner", "scoreboard", ...RANK_SLOTS.map(rankKey)] as const) if (!fake.items.has(game.fixtureIds[k] ?? "")) bad.push(`${k} missing`);
  // Icons: every wanted one placed once, where it belongs.
  for (const w of ref.wantedIcons()) {
    const it = fake.items.get(game.icons?.[w.key]?.id ?? "");
    if (!it || Math.abs(it.x - w.x) > 2 || Math.abs(it.y - w.y) > 2) bad.push(`icon ${w.key} ${it ? "misplaced" : "missing"}`);
  }
  const tracked = new Set([...ref.cellId.values(), ...Object.values(game.fixtureIds), ...ref.inboxCard.values(), ...fake.staticIds, ...Object.values(game.icons ?? {}).map((r) => r.id)]);
  for (const it of fake.items.values()) {
    if (tracked.has(it.id)) continue;
    const onGrid = it.x + it.w / 2 >= GRID_BOX.x && it.x - it.w / 2 <= GRID_BOX.x + GRID_BOX.w && it.y + it.h / 2 >= GRID_BOX.y && it.y - it.h / 2 <= GRID_BOX.y + GRID_BOX.h;
    const onFx = Object.values(FIXTURES).some((b) => it.x >= b.x && it.x <= b.x + b.w && it.y >= b.y && it.y <= b.y + b.h);
    if ((onGrid || onFx) && !(opts.allowStuck && fake.locked.has(it.id))) bad.push(`junk ${it.type} ${it.id} "${stripHtml(it.content).slice(0, 20)}" at ${it.x},${it.y}`);
  }
  expect(bad.slice(0, 10)).toEqual([]);
}

export const teamOf = (label: string): Team => {
  const col = /^[A-Z]+/.exec(label)![0];
  const c = col.length === 1 ? col.charCodeAt(0) - 65 : 26 + col.charCodeAt(1) - 65;
  const r = Number(label.slice(col.length)) - 1;
  return r >= 17 ? (c >= 18 ? "birch" : "cedar") : c >= 18 ? "pine" : "ridge";
};
