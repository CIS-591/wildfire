// Offline game on the fake board with a virtual clock: N bots (one boss per team, the rest workers)
// and a simulated human per team who answers approvals after 10-40 s. Answers "is the fire still
// burning at 20 min, and how spread out do the scores end?" for tuning config/rules.json.
import { stripHtml } from "./board.js";
import { Bot, type CellView, type PlayerBoard, type StickyNote } from "./bot.js";
import { FakeBoard } from "./fake-board.js";
import { GRID_BOX, ORDERS, TEAMS, buildCells, inside, parseLabel, type Team } from "./layout.js";
import { Referee, emptyGame } from "./referee.js";
import { mulberry32, scores, stickyKind, type RuleSet } from "./rules.js";

export interface SimOptions {
  players?: number;
  seed?: number;
  turnSec?: number; // how long one agent move takes, ~15 s with Claude
  mistakeRate?: number;
  lobbySec?: number; // time before the fire starts (PLANs get approved)
  log?: (s: string) => void;
}

export interface SimResult {
  seed: number;
  winner: string;
  endReason: string;
  minutes: number;
  pct: Record<Team, number>;
  burningAt20: number;
  waterLeft: number;
  paints: number;
  refused: Record<string, number>;
  approvals: Record<string, number>;
  strikes: string[];
  embers: number;
  cabinsLost: string[];
  timeline: { minute: number; fire: number; water: number; pct: Record<Team, number> }[];
  maxWritesPerTick: number;
}

class FakePlayerBoard implements PlayerBoard {
  private kinds = new Map(buildCells().map((c) => [c.label, c]));
  current = "";
  constructor(
    private fake: FakeBoard,
    private ref: Referee,
    private jitter: () => number = () => 0,
  ) {}
  async cells(): Promise<CellView[]> {
    const out: CellView[] = [];
    for (const it of this.fake.items.values()) {
      if (it.type !== "shape" || it.w > 100 || !inside(GRID_BOX, it.x, it.y)) continue;
      const lab = stripHtml(it.content);
      const def = parseLabel(lab) && this.kinds.get(lab);
      if (def) out.push({ id: it.id, label: lab, col: def.col, row: def.row, kind: def.kind, sector: def.sector, fill: (it.fill ?? "").toLowerCase() });
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
  const turnSec = opts.turnSec ?? 15;
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
    // Bots: one turn every ~turnSec; a boss turn (read + several stickies) takes about twice as long.
    for (const b of [...bots].sort(() => rng() - 0.5)) {
      if (t < b.nextTurnAt) continue;
      pb.current = b.userId;
      await b.readInbox(pb, t);
      await b.act(pb, t);
      b.nextTurnAt = t + Math.round(turnSec * (b.role === "boss" ? 2 : 1) * (0.7 + rng() * 0.6) * 1000);
    }
    // Humans: answer each PLAN / BACKBURN / HELP after 10-40 s (a teammate who didn't post it; 10% NO on backburns).
    for (const team of TEAMS) {
      for (const s of await pb.stickies(team)) {
        const kind = stickyKind(s.text);
        if (kind !== "PLAN" && kind !== "BACKBURN" && kind !== "HELP") continue;
        if (/\n(YES|NO)$/i.test(s.text)) continue;
        const a = answerAt.get(s.id);
        if (!a) {
          const mates = bots.filter((b) => b.team === team && b.userId !== s.createdBy);
          if (mates.length) answerAt.set(s.id, { at: t + 10_000 + Math.floor(rng() * 30_000), by: mates[Math.floor(rng() * mates.length)]!.userId, yes: kind !== "BACKBURN" || rng() > 0.1 });
        } else if (t >= a.at) fake.playerEditSticky(a.by, s.id, `${s.text}\n${a.yes ? "YES" : "NO"}`);
      }
    }
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
  // Lobby: everyone has joined; bosses post PLANs and teammates approve them before the fire starts.
  for (const b of bots) b.nextTurnAt = t + Math.floor(rng() * turnSec * 1000);
  const lobbyEnd = t + (opts.lobbySec ?? 90) * 1000;
  while (t < lobbyEnd) await step();
  await ref.start();
  const timeline: SimResult["timeline"] = [];
  let burningAt20 = -1;
  while (ref.state.phase === "live") {
    await step();
    const el = ref.state.elapsed;
    if (el >= timeline.length * 60_000 && ref.state.phase === "live") {
      const sc = scores(ref.state, ref.cellList);
      const fire = Object.values(ref.state.cells).filter((c) => c === "fire").length;
      timeline.push({ minute: timeline.length, fire, water: ref.state.water, pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number> });
      if (timeline.length - 1 === 20) burningAt20 = fire;
    }
  }
  const s = ref.state;
  const sc = scores(s, ref.cellList);
  const approvals: Record<string, number> = {};
  for (const a of Object.values(s.approvals)) approvals[`${a.kind} ${a.status}`] = (approvals[`${a.kind} ${a.status}`] ?? 0) + 1;
  return {
    seed,
    winner: s.winner ?? "-",
    endReason: s.endReason ?? "-",
    minutes: Math.round(s.elapsed / 6000) / 10,
    pct: Object.fromEntries(TEAMS.map((x) => [x, sc[x].pct])) as Record<Team, number>,
    burningAt20: burningAt20 < 0 ? 0 : burningAt20,
    waterLeft: s.water,
    paints: s.stats.accepted,
    refused: Object.fromEntries(Object.entries(s.stats.illegal).filter(([, v]) => v)),
    approvals,
    strikes: s.stats.strikes,
    embers: s.stats.embers,
    cabinsLost: s.stats.cabinsLost,
    timeline,
    maxWritesPerTick,
  };
}

export function formatSim(r: SimResult, full = true): string {
  const pct = (p: Record<Team, number>) => TEAMS.map((t) => String(p[t]).padStart(6)).join("");
  const lines = [
    `seed ${r.seed}: ${r.winner} wins (${r.endReason}) after ${r.minutes} min · burning at 20 min: ${r.burningAt20} squares · final % ridge/pine/cedar/birch:${pct(r.pct)}`,
    `  paints ${r.paints} · water left ${r.waterLeft} · lightning ${r.strikes.join(" ") || "-"} · embers ${r.embers} · cabins lost ${r.cabinsLost.join(" ") || "none"} · max writes/tick ${r.maxWritesPerTick}`,
    `  approvals: ${Object.entries(r.approvals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} · refused: ${Object.entries(r.refused).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
  ];
  if (full) {
    lines.push("  min  fire water   ridge  pine cedar birch");
    for (const p of r.timeline) if (p.minute % 2 === 0) lines.push(`  ${String(p.minute).padStart(3)} ${String(p.fire).padStart(5)} ${String(p.water).padStart(5)} ${pct(p.pct)}`);
  }
  return lines.join("\n");
}
