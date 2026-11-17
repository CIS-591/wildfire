// `npm run referee bots -- --dry-run`: the bot runner against a FakeBoard with BOTH referees in-process
// (game + guard, rehearsal attribution, the bot token's user not counted as either referee's own), on a
// virtual clock. Proves the whole path offline: /join cards -> guard join requests -> game teams/cards ->
// bot paints judged -> orders, questions, YES, attacks -> vandal junk removed by the guard -> GAME OVER.
import { BotRunner, FakeBotIO, type Profile, type RunnerStats } from "./bots.js";
import { FakeBoard, REFEREE_USER } from "./fake-board.js";
import { memoryLink } from "./guard-link.js";
import { TEAMS } from "./layout.js";
import { Referee, emptyGame, type GameFile } from "./referee.js";
import { mulberry32, scores, type RuleSet } from "./rules.js";

/** The second referee token's Miro user (the guard). */
export const GUARD_USER = "referee2";

export interface DryRunOptions {
  players: number;
  seed?: number;
  profile?: Profile;
  /** Which token the bots write with: 2 = the guard's (shared), 3 = a third account. */
  botsToken?: 2 | 3;
  readEveryMs?: number;
  writesPerMin?: number;
  /** Lobby: the fire starts this long after the last bot joined (the instructor's `start`). */
  startAfterSec?: number;
  log?: (s: string) => void;
}

export interface DryRunResult {
  minutes: number;
  winner: string;
  endReason: string;
  pct: Record<string, number>;
  players: number;
  stats: RunnerStats;
  judged: number;
  judgedByRule: Record<string, number>;
  accepted: number;
  botChanged: number;
  approvals: Record<string, number>;
  junkRemoved: number;
  /** Items of the game referee (squares, fixtures, cards, icons) the guard deleted or edited: must be none. */
  guardTouchedGame: string[];
  /** Static items the game referee wrote: must be none (they are the guard's). */
  gameTouchedStatics: string[];
  /** Squares whose board fill differs from the game's state at the end (a paint nobody judged). */
  unconverged: string[];
  over: boolean;
  game: GameFile;
}

export async function runBotsDryRun(rules: RuleSet, o: DryRunOptions): Promise<DryRunResult> {
  const clock = { t: 1_700_000_000_000 };
  const now = () => clock.t;
  const fake = FakeBoard.seeded(now);
  fake.enableFastReads();
  const botUser = o.botsToken === 3 ? "bots3" : GUARD_USER;
  const game: GameFile = emptyGame();
  const link = memoryLink(() => game);
  const statics = new Set(fake.staticIds);
  const log = o.log ?? (() => {});
  const judgedByRule: Record<string, number> = {};
  let judged = 0;
  // Who is "self" (cli.ts makeReferee with --bots-token): both referee users, minus the bots' user.
  const gameOthers = [GUARD_USER].filter((u) => u !== botUser);
  const ref = new Referee(fake, game, rules, {
    now,
    log: (s) => log(`[game] ${s.trim()}`),
    rng: mulberry32((o.seed ?? 1) * 31),
    staticIds: statics,
    role: "game",
    rehearsal: true,
    selfId: REFEREE_USER,
    selfIds: gameOthers,
    link: link.game,
    onPaint: (_ev, d) => {
      judged++;
      const k = d.accept ? "accepted" : (d.rule ?? "?");
      judgedByRule[k] = (judgedByRule[k] ?? 0) + 1;
    },
  });
  const guardBoard = fake.as(GUARD_USER);
  const guardTouched: string[] = [];
  const gameIds = () => new Set([...ref.cellId.values(), ...Object.values(game.fixtureIds), ...ref.inboxCard.values(), ...Object.values(game.icons ?? {}).map((r) => r.id)]);
  const gDel = guardBoard.deleteItem.bind(guardBoard);
  const gUpd = guardBoard.updateShape.bind(guardBoard);
  let junkRemoved = 0;
  guardBoard.deleteItem = async (id: string) => {
    if (gameIds().has(id)) guardTouched.push(`delete ${id}`);
    else junkRemoved++;
    return gDel(id);
  };
  guardBoard.updateShape = async (id, p) => {
    if (gameIds().has(id)) guardTouched.push(`update ${id}`);
    return gUpd(id, p);
  };
  const gameTouchedStatics: string[] = [];
  const fUpd = fake.updateShape.bind(fake);
  fake.updateShape = async (id, p) => {
    if (statics.has(id)) gameTouchedStatics.push(id);
    return fUpd(id, p);
  };
  const guard = new Referee(guardBoard, emptyGame(), rules, {
    now,
    log: (s) => log(`[guard] ${s.trim()}`),
    rng: mulberry32(7),
    staticIds: statics,
    role: "guard",
    rehearsal: true,
    selfId: botUser === GUARD_USER ? undefined : GUARD_USER,
    selfIds: [REFEREE_USER],
    link: link.guard,
  });
  await ref.discover();
  await ref.rebuildMissing();
  await guard.discoverGuard();

  const io = new FakeBotIO(fake, botUser, () => game.fixtureIds);
  const runner = new BotRunner(io, { players: o.players, seed: o.seed, profile: o.profile, teamVote: !!rules.teamVote, readEveryMs: o.readEveryMs, writesPerMin: o.writesPerMin, log: (s) => log(`[bots] ${s}`) });
  let lastGame = clock.t;
  let lastGuard = clock.t;
  let startAt: number | null = null;
  let started = false;
  const endBy = clock.t + 40 * 60_000;
  while (clock.t < endBy) {
    await runner.step(clock.t);
    if (runner.over) break;
    if (clock.t - lastGame >= 3000) {
      await ref.tick();
      lastGame = clock.t;
    }
    if (clock.t - lastGuard >= 6000) {
      await guard.tick();
      lastGuard = clock.t;
    }
    // The instructor's `start`: once every bot has a team.
    if (!started) {
      if (startAt === null && runner.seats.every((s) => s.team)) startAt = clock.t + (o.startAfterSec ?? 10) * 1000;
      if (startAt !== null && clock.t >= startAt) {
        await ref.start();
        started = true;
        log(`[dry-run] start: ${Object.keys(ref.state.players).length} players`);
      }
    }
    clock.t += 1000;
  }
  // A few more ticks after the end: late paints judged, junk gone, everything settled.
  for (let i = 0; i < 4; i++) {
    clock.t += 3000;
    await ref.tick();
    await guard.tick();
  }
  const s = ref.state;
  const sc = scores(s, ref.cellList);
  const approvals: Record<string, number> = {};
  for (const a of Object.values(s.approvals)) approvals[a.status] = (approvals[a.status] ?? 0) + 1;
  const unconverged = ref.cellList.filter((c) => (fake.items.get(ref.cellId.get(c.label) ?? "")?.fill ?? "").toLowerCase() !== ref.fillOf(c.label)).map((c) => c.label);
  return {
    minutes: Math.round(s.elapsed / 6000) / 10,
    winner: s.winner ?? "-",
    endReason: s.endReason ?? "-",
    pct: Object.fromEntries(TEAMS.map((t) => [t, sc[t].pct])),
    players: Object.keys(s.players).length,
    stats: runner.stats,
    judged,
    judgedByRule,
    accepted: s.stats.accepted,
    botChanged: io.changed,
    approvals,
    junkRemoved,
    guardTouchedGame: guardTouched,
    gameTouchedStatics,
    unconverged,
    over: runner.over,
    game,
  };
}

export function formatDryRun(r: DryRunResult): string {
  const st = r.stats;
  return [
    `dry run: ${r.players} players · ${r.winner} wins (${r.endReason}) after ${r.minutes} min · final % ${Object.entries(r.pct).map(([t, p]) => `${t} ${p}`).join(" ")} · bots saw GAME OVER: ${r.over ? "yes" : "NO"}`,
    `  bot writes ${st.writes} (paints ${st.paints}: blue ${st.blue} [wrong hex ${st.wrongHex}], orange ${st.orange} [no YES ${st.orangeNoYes}]; over-5 batches ${st.overBatch}; orders ${st.orders}; questions ${st.questions}; answers ${st.answers} (${st.yes} YES); cards ${st.cards}; vandal items ${st.vandal}) · reads ${st.reads} · deferred ${st.deferred}`,
    `  referee: ${r.judged} paints judged for ${r.botChanged} bot paints that changed a square · ${Object.entries(r.judgedByRule).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `  attacks: ${Object.entries(r.approvals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} · junk removed by the guard ${r.junkRemoved}`,
    `  checks: guard touched game items ${r.guardTouchedGame.length} · game wrote statics ${r.gameTouchedStatics.length} · squares not converged ${r.unconverged.length}`,
  ].join("\n");
}
