// Scripted players for the simulation. A bot sees only what a student's agent sees (square colors,
// banner, scoreboard, leaderboard, its own inbox card, the Orders frames) and plays like the kit:
// the boss keeps one order sticky per worker ("Ana: paint N9 N10"), paints at half a worker's rate, and asks
// "Spray water in <neighbour>'s area?" when a neighbour's fire is about to cross in; workers paint one
// square from their (maybe stale) order per turn.
// Turn pace is set by the simulation (real agents: one paint per 45-60 s, rehearsal-1.log).
import { STATE_COLOR, TEAMS, TEAM_INFO, WIND, type Team } from "./layout.js";
import type { Rng } from "./rules.js";

export interface CellView {
  id: string;
  label: string;
  col: number;
  row: number;
  sector: Team;
  fill: string;
}

export interface StickyNote {
  id: string;
  text: string;
  createdBy: string;
  modifiedBy: string;
}

export interface PlayerBoard {
  cells(): Promise<CellView[]>;
  inbox(userId: string): Promise<string>;
  fixtures(): Promise<{ banner: string; scoreboard: string; leaderboard: string }>;
  stickies(team: Team): Promise<StickyNote[]>;
  paint(cellId: string, fill: string): Promise<void>;
  join(userId: string, name: string): Promise<void>;
  postSticky(team: Team, text: string): Promise<void>;
  editSticky(id: string, text: string): Promise<void>;
}

export interface BotOptions {
  mistakeRate?: number; // chance a paint is wrong (agents misread the board)
}

const C = STATE_COLOR;
const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const TEAM_BY_CAPS: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [TEAM_INFO[t].name.toUpperCase(), t]));
const live = (c: CellView | undefined) => !!c && (c.fill === C.forest || c.fill === C.fire);

export class Bot {
  team: Team | null = null;
  role: "boss" | "worker" | null = null;
  /** A running spray-outside grant this bot's team got (from the inbox card). */
  outside: { to: Team; until: number } | null = null;
  lastOutsideAt = -Infinity;
  nextTurnAt = 0;
  painted = 0;
  turns = 0;
  private seenLines = new Set<string>();
  private orderText = "";
  private orderDone = 0;

  constructor(
    public userId: string,
    public name: string,
    public rng: Rng,
    public opts: BotOptions = {},
  ) {}

  /** Read the inbox card: team, role, answers to the spray question (remembered once seen; the card keeps only 6 lines). */
  async readInbox(board: PlayerBoard, now: number): Promise<void> {
    const text = await board.inbox(this.userId);
    const m = /\b(TEAM [1-4])\b/.exec(text);
    if (m) this.team = TEAM_BY_CAPS[m[1]!]!;
    const r = /· (BOSS|WORKER) ·/.exec(text);
    if (r) this.role = r[1] === "BOSS" ? "boss" : "worker";
    for (const line of text.split("\n")) {
      if (this.seenLines.has(line)) continue;
      this.seenLines.add(line);
      const yes = /said YES: you may paint blue in .*\((ridge|pine|cedar|birch)\) for (\d+) min/.exec(line);
      if (yes) this.outside = { to: yes[1] as Team, until: now + Number(yes[2]) * 60_000 };
      if (/^⌛ Time is up in /.test(line)) this.outside = null;
    }
  }

  async act(board: PlayerBoard, now: number): Promise<number> {
    if (!this.team) return 0;
    this.turns++;
    return this.role === "boss" ? this.bossTurn(board, now) : this.workerTurn(board, now);
  }

  private grantTo(now: number): Team | null {
    return this.outside && now < this.outside.until ? this.outside.to : null;
  }

  // ---------- boss: orders, OUTSIDE, and one paint ----------
  private async bossTurn(board: PlayerBoard, now: number): Promise<number> {
    const team = this.team!;
    const cells = await board.cells();
    const { banner, leaderboard } = await board.fixtures();
    if (/GAME OVER|\/join now/.test(banner)) return 0;
    const wind = windOf(banner);
    const crew = crewOf(leaderboard, team);
    const stickies = await board.stickies(team);

    // One order per worker, updated in place. Half the crew goes outside while a spray-outside grant runs.
    const away = this.grantTo(now);
    const outCrew = away ? crew.slice(0, Math.ceil(crew.length / 2)) : [];
    const plans: [string[], Team][] = [[crew.filter((n) => !outCrew.includes(n)), team]];
    if (away) plans.push([outCrew, away]);
    const own = targetsFor(cells, team, wind, this.rng);
    for (const [names, sector] of plans) {
      const targets = sector === team ? own : targetsFor(cells, sector, wind, this.rng, team);
      for (let i = 0; i < names.length; i++) {
        const mine = targets.filter((_, k) => k % names.length === i).slice(0, 3);
        const text = mine.length ? `${names[i]}: paint ${mine.map((c) => c.label).join(" ")}` : `${names[i]}: paint nothing yet, watch the fire`;
        const old = stickies.find((s) => s.text.startsWith(`${names[i]}: paint`));
        if (!old) await board.postSticky(team, text);
        else if (old.text !== text) await board.editSticky(old.id, text);
      }
    }

    // The one human decision: a neighbour's fire is about to cross into us.
    if (!away && now - this.lastOutsideAt > 150_000) {
      const threat = TEAM_INFO[team].neighbours
        .map((n) => ({ n, k: cells.filter((c) => c.sector === n && c.fill === C.fire && cells.some((g) => g.sector === team && g.fill === C.forest && cheb(g, c) <= 2)).length }))
        .sort((a, b) => b.k - a.k)[0]!;
      if (threat.k >= 3) {
        await board.postSticky(team, `Spray water in ${TEAM_INFO[threat.n].name}'s area?\nTheir fire is about to cross into ours.`);
        this.lastOutsideAt = now;
      }
    }

    // The boss paints too (half a worker's rate: one paint per boss turn).
    const pick = own[0];
    if (!pick) return 0;
    await board.paint(pick.id, C.water);
    this.painted++;
    return 1;
  }

  // ---------- worker: one paint from its order ----------
  private async workerTurn(board: PlayerBoard, now: number): Promise<number> {
    const { banner } = await board.fixtures();
    if (/GAME OVER|\/join now/.test(banner)) return 0;
    const cells = await board.cells();
    const byLabel = new Map(cells.map((c) => [c.label, c]));
    const stickies = await board.stickies(this.team!);
    const order = stickies.find((s) => s.text.startsWith(`${this.name}: paint`));
    let target: CellView | undefined;
    if (this.rng() < (this.opts.mistakeRate ?? 0.1)) {
      // A mistake: a random square near the fire, wherever it is (other areas, already blue or burnt).
      const fires = cells.filter((c) => c.fill === C.fire);
      const near = cells.filter((c) => fires.some((f) => cheb(c, f) <= 2));
      target = near[Math.floor(this.rng() * near.length)];
    } else if (order) {
      if (order.text !== this.orderText) {
        this.orderText = order.text;
        this.orderDone = 0;
      }
      const list = parseOrder(order.text);
      while (this.orderDone < list.length && !target) {
        const c = byLabel.get(list[this.orderDone++]!);
        if (c && live(c)) target = c; // re-check the exact square
      }
    }
    if (!target) {
      // No usable order: the burning square (or green next to the fire) nearest our trees.
      const where = this.grantTo(now) ?? this.team!;
      target = targetsFor(cells, where, windOf(banner), this.rng, this.team!)[0] ?? targetsFor(cells, this.team!, windOf(banner), this.rng)[0];
    }
    if (!target) return 0;
    await board.paint(target.id, C.water);
    this.painted++;
    return 1;
  }
}

/**
 * Squares a team wants blue in `sector`, most urgent first: burning squares next to green trees
 * (more green around, downwind of them, and close to `protect`'s area first), then green squares
 * right downwind of the fire.
 */
export function targetsFor(cells: CellView[], sector: Team, wind: number, rng: Rng, protect: Team = sector): CellView[] {
  const byPos = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const home = cells.filter((c) => c.sector === protect && c.fill === C.forest);
  const near = (c: CellView) => {
    if (protect === sector) return 0;
    let d = Infinity;
    for (const g of home) d = Math.min(d, cheb(c, g));
    return d;
  };
  const threat = (c: CellView) => {
    let v = 0;
    WIND.forEach((w, i) => {
      const n = byPos.get(`${c.col + w.dc},${c.row + w.dr}`);
      if (n && n.fill === C.forest) v += i === wind ? 3 : 1;
    });
    return v;
  };
  const mine = cells.filter((c) => c.sector === sector);
  const fires = mine
    .filter((c) => c.fill === C.fire)
    .map((c) => ({ c, v: threat(c) - 2 * near(c) + rng() }))
    .filter((x) => threat(x.c) > 0)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.c);
  const w = WIND[wind]!;
  const front = mine.filter((c) => {
    if (c.fill !== C.forest) return false;
    const up = byPos.get(`${c.col - w.dc},${c.row - w.dr}`);
    return up?.fill === C.fire;
  });
  return [...fires, ...front];
}

/** Square labels on an order sticky ("Ana: paint N9 N10 N11"). */
export function parseOrder(text: string): string[] {
  const m = /:\s*paint\s+(.+)$/i.exec(text.split("\n")[0]!.trim());
  return m ? m[1]!.split(/[\s,]+/).filter((l) => /^[A-Z]{1,2}\d{1,2}$/i.test(l)).map((l) => l.toUpperCase()) : [];
}

// ---------- reading the projector ----------

export function windOf(banner: string): number {
  const m = /wind \S+ (NE|NW|SE|SW|N|E|S|W)\b/i.exec(banner) ?? /blowing \S+ (north-east|north-west|south-east|south-west|north|east|south|west)/.exec(banner);
  if (!m) return 0;
  const i = WIND.findIndex((w) => w.name === m[1] || w.word === m[1]);
  return Math.max(0, i);
}

export function waterOf(banner: string): number {
  const m = /💧 (\d+)/.exec(banner);
  return m ? Number(m[1]) : 0;
}

export function percents(scoreboard: string): Partial<Record<Team, number>> {
  const out: Partial<Record<Team, number>> = {};
  for (const [caps, t] of Object.entries(TEAM_BY_CAPS)) {
    const m = new RegExp(`${caps} (\\d+)%`).exec(scoreboard);
    if (m) out[t] = Number(m[1]);
  }
  return out;
}

/** Worker names of a team, from the leaderboard ("crew: A, B, C" under the team's line). */
export function crewOf(leaderboard: string, team: Team): string[] {
  const lines = leaderboard.split("\n");
  const i = lines.findIndex((l) => l.includes(`${TEAM_INFO[team].name.toUpperCase()} `) && l.includes("players"));
  if (i < 0) return [];
  const crew = lines.slice(i + 1, i + 4).find((l) => l.startsWith("crew: "));
  return crew ? crew.slice(6).split(", ").filter(Boolean) : [];
}
