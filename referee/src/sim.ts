// Offline game on the fake board with a virtual clock: N bots (one boss per team, the rest workers)
// and simulated humans who answer each "Spray water in X's area?" after 20-60 s. Bots play at the pace measured in the
// first live rehearsal (results/rehearsal-1.log; after kit fixes: a worker paints every 45-60 s, a boss
// at half that rate). Answers "is the fire still burning at minute 8, how spread out are the scores,
// how much water is used?" for tuning config/rules.json.
import { stripHtml } from "./board.js";
import { Bot, type CellView, type PlayerBoard, type StickyNote } from "./bot.js";
import { FakeBoard } from "./fake-board.js";
import { GRID_BOX, ORDERS, TEAMS, buildCells, inside, parseLabel, type Team } from "./layout.js";
import { Referee, emptyGame } from "./referee.js";
import { mulberry32, scores, stickyKind, type RuleSet } from "./rules.js";

export interface SimOptions {
  players?: number;
  seed?: number;
  paceSec?: number; // a worker paints every paceSec..paceSec*4/3 s (45-60 s); a boss every twice that
  mistakeRate?: number;
  lobbySec?: number; // time before the fire starts
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
  attempts: number; // paints the bots tried (accepted + undone)
  waterLeft: number;
  paints: number;
  refused: Record<string, number>;
  approvals: Record<string, number>;
  strikes: string[];
  timeline: { minute: number; fire: number; water: number; pct: Record<Team, number> }[];
  maxWritesPerTick: number;
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
    return { banner: text(ids.banner), scoreboard: text(ids.scoreboard), leaderboard: text(ids.leaderboard) };
  }
  async stickies(team: Team): Promise<StickyNote[]> {
    return [...this.fake.items.values()]
      .filter((i) => i.type === "sticky_note" && inside(ORDERS[team], i.x, i.y))
      .map((i) => ({ id: i.id, text: stripHtml(i.content), createdBy: i.createdBy, modifiedBy: i.modifiedBy }));
  }
  async paint(cellId: string, fill: string): Promise<void> {
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
  const pace = opts.paceSec ?? 45;
  // A Claude turn: read the board, think, paint. The paint lands on a board read 15-30 s earlier.
  const lagMs = (_b: Bot) => 15_000 + Math.floor(rng() * 15_000);
  let t = 1_700_000_000_000;
  const now = () => t;
  const fake = FakeBoard.seeded(now);
  const ref = new Referee(fake, emptyGame(), rules, { now, log: opts.log ?? (() => {}), rng: mulberry32(seed * 7919) });
  await ref.discover();
  const pb = new FakePlayerBoard(fake, ref, () => Math.floor(rng() * 1000));
  const bots = Array.from({ length: n }, (_, i) => new Bot(`u${i + 1}`, `Bot ${i + 1}`, mulberry32(seed * 1000 + i), { mistakeRate: opts.mistakeRate }));
  for (const b of bots) {
    pb.current = b.userId;
    await pb.join(b.userId, b.name);
  }
  t += 3000;
  await ref.tick();
  for (const b of bots) await b.readInbox(pb, t);
  const answerAt = new Map<string, { at: number; by: string; yes: boolean }>(); // sticky id -> the human's answer
  const step = async () => {
    // Bots: a worker turn (one paint) every 45-60 s; a boss turn (orders + one paint) every 90-120 s.
    for (const b of [...bots].sort(() => rng() - 0.5)) {
      if (t < b.nextTurnAt) continue;
      pb.current = b.userId;
      pb.lagMs = lagMs(b);
      await b.readInbox(pb, t);
      await b.act(pb, t);
      b.nextTurnAt = t + Math.round(pace * (b.role === "boss" ? 2 : 1) * (1 + rng() / 3) * 1000);
    }
    // Humans: a teammate who didn't post it answers each spray question after 20-60 s (15% NO).
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
      await ref.tick();
      maxWritesPerTick = Math.max(maxWritesPerTick, writes() - w0);
      lastTick = t;
    }
    t += 1000;
  };
  let lastTick = t;
  let maxWritesPerTick = 0;
  const writes = () => fake.calls.update + fake.calls.create + fake.calls.delete;
  // Lobby: everyone has joined. When the fire starts, each agent needs a first read of the board.
  const lobbyEnd = t + (opts.lobbySec ?? 30) * 1000;
  while (t < lobbyEnd) await step();
  await ref.start();
  // Agents notice the LIVE banner on their next loop, then need a full turn for their first paint.
  for (const b of bots) b.nextTurnAt = t + Math.round(pace * (b.role === "boss" ? 2 : 1) * (0.5 + rng()) * 1000);
  const timeline: SimResult["timeline"] = [];
  let burningAt8 = -1;
  while (ref.state.phase === "live") {
    await step();
    const el = ref.state.elapsed;
    if (el >= timeline.length * 60_000 && ref.state.phase === "live") {
      const sc = scores(ref.state, ref.cellList);
      const fire = Object.values(ref.state.cells).filter((c) => c === "fire").length;
      timeline.push({ minute: timeline.length, fire, water: ref.state.water, pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number> });
      if (timeline.length - 1 === 8) burningAt8 = fire;
    }
  }
  const s = ref.state;
  const sc = scores(s, ref.cellList);
  const approvals: Record<string, number> = {};
  for (const a of Object.values(s.approvals)) approvals[`spray ${a.status}`] = (approvals[`spray ${a.status}`] ?? 0) + 1;
  return {
    seed,
    winner: s.winner ?? "-",
    endReason: s.endReason ?? "-",
    minutes: Math.round(s.elapsed / 6000) / 10,
    pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number>,
    burningAt8: burningAt8 < 0 ? 0 : burningAt8,
    attempts: bots.reduce((a, b) => a + b.painted, 0),
    waterUsedPct: Math.round((100 * (rules.waterTotal - s.water)) / rules.waterTotal),
    waterLeft: s.water,
    paints: s.stats.accepted,
    refused: Object.fromEntries(Object.entries(s.stats.illegal).filter(([, v]) => v)),
    approvals,
    strikes: s.stats.strikes,
    timeline,
    maxWritesPerTick,
  };
}

export function formatSim(r: SimResult, full = true): string {
  const pct = (p: Record<Team, number>) => TEAMS.map((t) => String(p[t]).padStart(6)).join("");
  const lines = [
    `seed ${r.seed}: ${r.winner} wins (${r.endReason}) after ${r.minutes} min · burning at min 8: ${r.burningAt8} squares · final % ridge/pine/cedar/birch:${pct(r.pct)}`,
    `  paints ${r.paints} accepted of ${r.attempts} tried · water left ${r.waterLeft} (${r.waterUsedPct}% used) · lightning ${r.strikes.join(" ") || "-"} · max writes/tick ${r.maxWritesPerTick}`,
    `  approvals: ${Object.entries(r.approvals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} · refused: ${Object.entries(r.refused).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
  ];
  if (full) {
    lines.push("  min  fire water   ridge  pine cedar birch");
    for (const p of r.timeline) lines.push(`  ${String(p.minute).padStart(3)} ${String(p.fire).padStart(5)} ${String(p.water).padStart(5)} ${pct(p.pct)}`);
  }
  return lines.join("\n");
}
