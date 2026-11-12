// Offline game on the fake board with a virtual clock: N bots (one boss per team, the rest workers)
// and simulated humans who answer each "Start a fire in X's area?" after 20-60 s. Bot pace is calibrated
// on rehearsal-3.log (8 real Claude agents): a turn every 14-25 s, batches of 2-5 squares on a board read
// 20-35 s old (~4.6 accepted squares per player per minute, ~20% refused as already burnt/blue). `slow` =
// half that pace (30-50 s turns, reads 25-40 s old). Answers "is the fire still burning at minute 8, how
// spread out are the scores, how much water is used, do attacks happen?" for tuning config/rules*.json.
import { stripHtml } from "./board.js";
import { Bot, type CellView, type PlayerBoard, type StickyNote } from "./bot.js";
import { FakeBoard } from "./fake-board.js";
import { GRID_BOX, ORDERS, RANK_SLOTS, TEAMS, buildCells, inside, rankKey, parseLabel, type Team } from "./layout.js";
import { Referee, emptyGame } from "./referee.js";
import { mulberry32, scores, stickyKind, type RuleSet } from "./rules.js";

export interface SimOptions {
  players?: number;
  seed?: number;
  workerSec?: [number, number]; // a worker turn every this many seconds (default 14-25)
  bossSec?: [number, number]; // a boss turn (default 14-25; about half of them write orders only)
  lagSec?: [number, number]; // how old the board a turn acts on is (default 20-35)
  slow?: boolean; // half the rehearsal-3 pace: turns 30-50 s, reads 25-40 s old
  mistakeRate?: number;
  lobbySec?: number; // time before the fire starts
  lateSec?: number; // agents start playing this long after the fire starts (rehearsal 3: joined at 1:14)
  log?: (s: string) => void;
}

export interface SimResult {
  seed: number;
  winner: string;
  endReason: string;
  minutes: number;
  pct: Record<Team, number>;
  burningAt8: number;
  waterUsedPct: number;
  waterUsedByTeam: Record<Team, number>;
  attempts: number; // paints the bots tried (accepted + undone)
  waterLeft: number;
  paints: number;
  refused: Record<string, number>;
  approvals: Record<string, number>;
  strikes: string[];
  timeline: { minute: number; fire: number; water: number; pct: Record<Team, number> }[];
  maxWritesPerTick: number;
  hits?: Record<string, number>;
  maxReadsPerTick: number; // extra by-id reads (fixtures, card probes, fire-write rechecks)
  avgReadsPerTick: number;
  wastedPct: number; // squares tried that were refused (or changed nothing)
  attacks: number; // approved
  lit: Record<Team, number>;
  burnedOthers: Record<Team, number>;
  blowback: Record<Team, number>;
  fireOutAt: number | null; // game minute the fire went out, if it did
  perPlayerMin: number; // accepted blue squares per player per minute of play
  squareWastePct: number; // blue paints refused as "square" (already burnt/blue), % of accepted + those
}

export class FakePlayerBoard implements PlayerBoard {
  private kinds = new Map(buildCells().map((c) => [c.label, c]));
  current = "";
  /** How old the board a bot acts on is (an agent reads, thinks, then paints): set per turn. */
  lagMs = 0;
  private snaps: { at: number; cells: CellView[] }[] = [];
  constructor(
    private fake: FakeBoard,
    private ref: Referee,
    private jitter: () => number = () => 0,
  ) {}
  /** Remember the board every few seconds so bots can act on a stale read. */
  snapshot(at: number): void {
    this.snaps.push({ at, cells: this.read() });
    while (this.snaps.length > 20) this.snaps.shift();
  }
  async cells(): Promise<CellView[]> {
    const want = this.fake.now() - this.lagMs;
    const old = this.snaps.filter((s) => s.at <= want).at(-1);
    return old ? old.cells : this.read();
  }
  private read(): CellView[] {
    const out: CellView[] = [];
    for (const it of this.fake.items.values()) {
      if (it.type !== "shape" || it.w > 100 || !inside(GRID_BOX, it.x, it.y)) continue;
      const lab = stripHtml(it.content);
      const def = parseLabel(lab) && this.kinds.get(lab);
      if (def) out.push({ id: it.id, label: lab, col: def.col, row: def.row, sector: def.sector, fill: (it.fill ?? "").toLowerCase() });
    }
    return out;
  }
  async inbox(userId: string): Promise<string> {
    return stripHtml(this.fake.inboxText(userId));
  }
  async fixtures() {
    const text = (id?: string) => stripHtml(this.fake.items.get(id ?? "")?.content ?? "");
    const ids = this.ref.game.fixtureIds;
    // The bots read the four leaderboard rows as one text.
    return { banner: text(ids.banner), scoreboard: text(ids.scoreboard), leaderboard: RANK_SLOTS.map((n) => text(ids[rankKey(n)])).join("\n") };
  }
  async stickies(team: Team): Promise<StickyNote[]> {
    return [...this.fake.items.values()]
      .filter((i) => i.type === "sticky_note" && inside(ORDERS[team], i.x, i.y))
      .map((i) => ({ id: i.id, text: stripHtml(i.content), createdBy: i.createdBy, modifiedBy: i.modifiedBy }));
  }
  /** What the squares bots painted were at the moment of the paint (waste analysis). */
  hits: Record<string, number> = {};
  async paint(cellId: string, fill: string): Promise<void> {
    const before = (this.fake.items.get(cellId)?.fill ?? "gone").toLowerCase();
    const k = `${fill}<-${before}`;
    this.hits[k] = (this.hits[k] ?? 0) + 1;
    if (this.fake.items.has(cellId)) this.fake.playerEdit(this.current, cellId, { fill }, this.fake.now() + this.jitter());
  }
  async join(userId: string, name: string): Promise<void> {
    this.fake.playerJoin(userId, name);
  }
  async postSticky(team: Team, text: string): Promise<void> {
    this.fake.playerSticky(this.current, team, text);
  }
  async editSticky(id: string, text: string): Promise<void> {
    if (this.fake.items.has(id)) this.fake.playerEditSticky(this.current, id, text);
  }
}

export async function runSimulation(rules: RuleSet, opts: SimOptions = {}): Promise<SimResult> {
  const n = opts.players ?? 28;
  const seed = opts.seed ?? 1;
  const rng = mulberry32(seed);
  const workerSec = opts.workerSec ?? (opts.slow ? [30, 50] : [14, 25]);
  const bossSec = opts.bossSec ?? (opts.slow ? [30, 50] : [14, 25]);
  const lagSec = opts.lagSec ?? (opts.slow ? [25, 40] : [20, 35]);
  const turnMs = (b: Bot) => {
    const [lo, hi] = b.role === "boss" ? bossSec : workerSec;
    return Math.round((lo + rng() * (hi - lo)) * 1000);
  };
  // A Claude turn: read the board, think, paint. The paint lands on a board read some seconds earlier.
  const lagMs = (_b: Bot) => Math.round((lagSec[0] + rng() * (lagSec[1] - lagSec[0])) * 1000);
  let t = 1_700_000_000_000;
  const now = () => t;
  const fake = FakeBoard.seeded(now);
  const ref = new Referee(fake, emptyGame(), rules, { now, log: opts.log ?? (() => {}), rng: mulberry32(seed * 7919) });
  await ref.discover();
  const pb = new FakePlayerBoard(fake, ref, () => Math.floor(rng() * 1000));
  const bots = Array.from({ length: n }, (_, i) => new Bot(`u${i + 1}`, `Bot ${i + 1}`, mulberry32(seed * 1000 + i), { mistakeRate: opts.mistakeRate ?? 0.05, waterPerTeam: rules.waterPerTeam }));
  for (const b of bots) {
    pb.current = b.userId;
    await pb.join(b.userId, b.name);
  }
  t += 3000;
  await ref.tick();
  for (const b of bots) await b.readInbox(pb, t);
  const answerAt = new Map<string, { at: number; by: string; yes: boolean }>(); // sticky id -> the human's answer
  const step = async () => {
    // Bots whose turn has come: read the (stale) board, write orders, paint a batch.
    for (const b of [...bots].sort(() => rng() - 0.5)) {
      if (t < b.nextTurnAt) continue;
      pb.current = b.userId;
      pb.lagMs = lagMs(b);
      await b.readInbox(pb, t);
      await b.act(pb, t);
      b.nextTurnAt = t + turnMs(b);
    }
    // Humans: a teammate who didn't post it answers each attack question after 20-60 s (15% NO).
    for (const team of TEAMS) {
      for (const s of await pb.stickies(team)) {
        if (stickyKind(s.text) !== "QUESTION") continue;
        if (/\n(YES|NO)$/i.test(s.text)) continue;
        const a = answerAt.get(s.id);
        if (!a) {
          const mates = bots.filter((b) => b.team === team && b.userId !== s.createdBy);
          if (mates.length) answerAt.set(s.id, { at: t + 20_000 + Math.floor(rng() * 40_000), by: mates[Math.floor(rng() * mates.length)]!.userId, yes: rng() > 0.15 });
        } else if (t >= a.at) fake.playerEditSticky(a.by, s.id, `${s.text}\n${a.yes ? "YES" : "NO"}`);
      }
    }
    if ((t / 1000) % 5 === 0) pb.snapshot(t);
    if (t - lastTick >= 3000) {
      const w0 = writes();
      const r = await ref.tick();
      maxWritesPerTick = Math.max(maxWritesPerTick, writes() - w0);
      maxReads = Math.max(maxReads, r.reads ?? 0);
      sumReads += r.reads ?? 0;
      ticks++;
      lastTick = t;
    }
    t += 1000;
  };
  let lastTick = t;
  let maxWritesPerTick = 0;
  let maxReads = 0;
  let sumReads = 0;
  let ticks = 0;
  const writes = () => fake.calls.update + fake.calls.create + fake.calls.delete;
  // Lobby: everyone has joined. When the fire starts, each agent needs a first read of the board.
  const lobbyEnd = t + (opts.lobbySec ?? 30) * 1000;
  while (t < lobbyEnd) await step();
  await ref.start();
  // Agents notice the LIVE banner on their next loop, then need a full turn for their first paint.
  for (const b of bots) b.nextTurnAt = t + (opts.lateSec ?? 0) * 1000 + Math.round(turnMs(b) * (0.5 + rng()));
  const timeline: SimResult["timeline"] = [];
  let burningAt8 = -1;
  let firstPaintAt: number | null = null;
  while (ref.state.phase === "live") {
    await step();
    if (firstPaintAt === null && ref.state.stats.accepted > 0) firstPaintAt = ref.state.elapsed;
    const el = ref.state.elapsed;
    if (el >= timeline.length * 60_000 && ref.state.phase === "live") {
      const sc = scores(ref.state, ref.cellList);
      const fire = Object.values(ref.state.cells).filter((c) => c === "fire").length;
      timeline.push({ minute: timeline.length, fire, water: TEAMS.reduce((a, x) => a + ref.state.water[x], 0), pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number> });
      if (timeline.length - 1 === 8) burningAt8 = fire;
    }
  }
  const s = ref.state;
  const sc = scores(s, ref.cellList);
  const approvals: Record<string, number> = {};
  for (const a of Object.values(s.approvals)) approvals[`attack ${a.status}`] = (approvals[`attack ${a.status}`] ?? 0) + 1;
  const attempts = bots.reduce((a, b) => a + b.painted, 0);
  const good = s.stats.accepted + TEAMS.reduce((a, x) => a + s.stats.lit[x], 0);
  const out = s.events.find((e) => e.text.startsWith("🌧️"));
  // Accepted blue squares per player per minute of play (from the first accepted paint to the end).
  const playMin = Math.max(0.5, (s.elapsed - (firstPaintAt ?? s.elapsed)) / 60_000);
  return {
    seed,
    winner: s.winner ?? "-",
    endReason: s.endReason ?? "-",
    minutes: Math.round(s.elapsed / 6000) / 10,
    pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number>,
    burningAt8: burningAt8 < 0 ? 0 : burningAt8,
    attempts,
    waterUsedPct: Math.round((100 * (4 * rules.waterPerTeam - TEAMS.reduce((a, x) => a + s.water[x], 0))) / (4 * rules.waterPerTeam)),
    waterLeft: TEAMS.reduce((a, x) => a + s.water[x], 0),
    waterUsedByTeam: Object.fromEntries(TEAMS.map((x) => [x, Math.round((100 * (rules.waterPerTeam - s.water[x])) / rules.waterPerTeam)])) as Record<Team, number>,
    paints: s.stats.accepted,
    refused: Object.fromEntries(Object.entries(s.stats.illegal).filter(([, v]) => v)),
    approvals,
    strikes: s.stats.strikes,
    timeline,
    maxWritesPerTick,
    maxReadsPerTick: maxReads,
    hits: pb.hits,
    avgReadsPerTick: ticks ? Math.round((10 * sumReads) / ticks) / 10 : 0,
    wastedPct: attempts ? Math.round((100 * (attempts - good)) / attempts) : 0,
    attacks: Object.values(s.approvals).filter((a) => a.status === "approved").length,
    lit: { ...s.stats.lit },
    burnedOthers: { ...s.stats.burnedOthers },
    blowback: { ...s.stats.blowback },
    fireOutAt: s.endReason === "out" && out ? Math.round(out.at / 6000) / 10 : null,
    perPlayerMin: Math.round((10 * s.stats.accepted) / n / playMin) / 10,
    squareWastePct: Math.round((100 * s.stats.illegal.square) / Math.max(1, s.stats.accepted + s.stats.illegal.square)),
  };
}

export function formatSim(r: SimResult, full = true): string {
  const pct = (p: Record<Team, number>) => TEAMS.map((t) => String(p[t]).padStart(6)).join("");
  const lines = [
    `seed ${r.seed}: ${r.winner} wins (${r.endReason}${r.fireOutAt !== null ? ` at ${r.fireOutAt} min` : ""}) after ${r.minutes} min · burning at min 8: ${r.burningAt8} squares · final % ridge/pine/cedar/birch:${pct(r.pct)}`,
    `  squares ${r.paints} blue accepted of ${r.attempts} tried (${r.wastedPct}% wasted; ${r.squareWastePct}% refused as already burnt/blue) · ${r.perPlayerMin}/min/player`,
    `  water used ${r.waterUsedPct}% (per team ${TEAMS.map((t) => r.waterUsedByTeam[t]).join("/")}) · lightning ${r.strikes.join(" ") || "-"} · max writes/tick ${r.maxWritesPerTick} · by-id reads/tick avg ${r.avgReadsPerTick} max ${r.maxReadsPerTick}`,
    `  attacks ${r.attacks} · lit ${TEAMS.map((t) => r.lit[t]).join("/")} · burned others' trees ${TEAMS.map((t) => r.burnedOthers[t]).join("/")} · blowback ${TEAMS.map((t) => r.blowback[t]).join("/")}`,
    `  approvals: ${Object.entries(r.approvals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} · refused: ${Object.entries(r.refused).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
  ];
  if (full) {
    lines.push("  min  fire water   ridge  pine cedar birch");
    for (const p of r.timeline) lines.push(`  ${String(p.minute).padStart(3)} ${String(p.fire).padStart(5)} ${String(p.water).padStart(5)} ${pct(p.pct)}`);
  }
  return lines.join("\n");
}
