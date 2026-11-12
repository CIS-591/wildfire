// Scripted players for the simulation. A bot sees only what a student's agent sees (square colors,
// banner, scoreboard, leaderboard, its own inbox card, the Orders frames) and plays like the kit:
// the boss keeps one order sticky per worker ("Ana: paint N9 N10"), paints at half a worker's rate, and asks
// "Start a fire in <neighbour>'s area?" when its own area is under control (and lights deep in their area,
// far from its own border); workers paint one square from their (maybe stale) order per turn, and during an
// approved attack the team paints orange on green squares in the neighbour's area.
// Turn pace is set by the simulation (calibrated on rehearsal-3.log: 8 Claude agents, ~4.6 accepted
// squares per player per minute, ~20% of blue paints on squares already burnt or blue).
import { NEIGHBOURS, STATE_COLOR, TEAMS, TEAM_INFO, type Team } from "./layout.js";
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
  waterPerTeam?: number; // a team's bucket at the start (bosses attack only while theirs is above 30% of it)
  batch?: [number, number]; // squares painted per turn (min, max): an agent paints a batch per move
  attacks?: boolean; // bosses ask to attack (default true)
  /** Share of picks that are not on the front line but one or two squares from the fire (rehearsal 3: agents often paint just beside it). */
  offFront?: number;
  /** Share of a boss's turns spent only on orders and questions (no paint). */
  bossOrderTurns?: number;
}

const C = STATE_COLOR;
const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const TEAM_BY_CAPS: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [TEAM_INFO[t].name.toUpperCase(), t]));
const live = (c: CellView | undefined) => !!c && (c.fill === C.forest || c.fill === C.fire);

export class Bot {
  team: Team | null = null;
  role: "boss" | "worker" | null = null;
  /** A running attack this bot's team got (from the inbox card). */
  attack: { to: Team; until: number } | null = null;
  lastAskAt = -Infinity;
  asked = 0;
  lit = 0;
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
      const yes = /said YES: you may paint orange .*\((ridge|pine|cedar|birch)\) for (\d+) min/.exec(line);
      if (yes) this.attack = { to: yes[1] as Team, until: now + Number(yes[2]) * 60_000 };
      if (/^⌛ Your attack on /.test(line)) this.attack = null;
    }
  }

  async act(board: PlayerBoard, now: number): Promise<number> {
    if (!this.team) return 0;
    this.turns++;
    return this.role === "boss" ? this.bossTurn(board, now) : this.workerTurn(board, now);
  }

  /** The neighbour our running attack may still light squares in (leaderboard: "may light N more fires"). */
  private attackTo(now: number, leaderboard: string): Team | null {
    if (!this.attack || now >= this.attack.until) return null;
    const left = new RegExp(`🔥 ${TEAM_INFO[this.team!].name} may light (\\d+) more fires? in ${TEAM_INFO[this.attack.to].name}'s area`).exec(leaderboard);
    return left && Number(left[1]) > 0 ? this.attack.to : null;
  }

  /** Light up to `n` squares in the neighbour's area (orange): one batch. */
  private async light(board: PlayerBoard, cells: CellView[], to: Team, n: number): Promise<number> {
    const picks = attackTargets(cells, to, this.team!, this.rng).slice(0, n);
    for (const pick of picks) {
      await board.paint(pick.id, C.fire);
      this.painted++;
      this.lit++;
    }
    return picks.length;
  }

  /** How many squares this turn's batch has (1-4 by default: rehearsal 3, after the turns that paint nothing). */
  private batchSize(): number {
    const [lo, hi] = this.opts.batch ?? [2, 5];
    return lo + Math.floor(this.rng() * (hi - lo + 1));
  }

  /** How many squares our running attack may still light (from the leaderboard). */
  private attackLeft(leaderboard: string): number {
    const m = new RegExp(`🔥 ${TEAM_INFO[this.team!].name} may light (\\d+) more`).exec(leaderboard);
    return m ? Number(m[1]) : 0;
  }

  /** A mistake: a random square near the fire, wherever it is (other areas, already blue or burnt). */
  private mistake(cells: CellView[]): CellView | undefined {
    const fires = cells.filter((c) => c.fill === C.fire);
    const near = cells.filter((c) => fires.some((f) => cheb(c, f) <= 2));
    return near[Math.floor(this.rng() * near.length)];
  }

  /**
   * `n` picks from `best` (most urgent first), each replaced with chance offFront by a green square of our
   * area one or two squares beside/behind the front (2 from the fire), as real agents often pick.
   */
  private sloppy(cells: CellView[], best: CellView[], n: number): CellView[] {
    const share = this.opts.offFront ?? 0.4;
    const fires = cells.filter((c) => c.fill === C.fire);
    let near: CellView[] | null = null;
    const out: CellView[] = [];
    for (const c of best) {
      if (out.length >= n) break;
      if (this.rng() < share) {
        near ??= cells.filter((g) => g.sector === this.team && g.fill === C.forest && fires.some((f) => cheb(g, f) === 2));
        const alt = near[Math.floor(this.rng() * near.length)];
        if (alt && !out.includes(alt)) {
          out.push(alt);
          continue;
        }
      }
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  /** Paint a batch blue (each square may be a mistake). */
  private async paintBatch(board: PlayerBoard, cells: CellView[], picks: CellView[]): Promise<number> {
    const done = new Set<string>();
    for (let pick of picks) {
      if (this.rng() < (this.opts.mistakeRate ?? 0.1)) pick = this.mistake(cells) ?? pick;
      if (done.has(pick.id)) continue;
      done.add(pick.id);
      await board.paint(pick.id, C.water);
      this.painted++;
    }
    return done.size;
  }

  // ---------- boss: orders, OUTSIDE, and one paint ----------
  private async bossTurn(board: PlayerBoard, now: number): Promise<number> {
    const team = this.team!;
    const cells = await board.cells();
    const { banner, leaderboard } = await board.fixtures();
    if (/GAME OVER|\/join now/.test(banner)) return 0;
    const crew = crewOf(leaderboard, team);
    const stickies = await board.stickies(team);

    // One order per worker, updated in place.
    const own = targetsFor(cells, team, this.rng);
    for (let i = 0; i < crew.length; i++) {
      const mine = own.filter((_, k) => k % crew.length === i).slice(0, 5);
      const text = mine.length ? `${crew[i]}: paint ${mine.map((c) => c.label).join(" ")}` : `${crew[i]}: paint nothing yet, watch the fire`;
      const old = stickies.find((s) => s.text.startsWith(`${crew[i]}: paint`));
      if (!old) await board.postSticky(team, text);
      else if (old.text !== text) await board.editSticky(old.id, text);
    }

    // The one human decision: attack a neighbour when our own area is under control (little fire at our
    // trees, water above 30%): the neighbour with the most green left.
    const away = this.attackTo(now, leaderboard);
    if (away) return this.light(board, cells, away, Math.min(this.batchSize(), this.attackLeft(leaderboard)));
    const total = this.opts.waterPerTeam ?? 150;
    const waiting = new RegExp(`waiting for a YES: start a fire`).test(leaderboard.split("\n").slice(leaderboard.split("\n").findIndex((l) => l.includes(`${TEAM_INFO[team].name.toUpperCase()} `)), undefined).slice(0, 5).join("\n"));
    if ((this.opts.attacks ?? true) && !this.attack && !waiting && this.asked < 2 && now - this.lastAskAt > 120_000 && waterOf(banner, team) > 0.3 * total) {
      const myFire = cells.filter((c) => c.sector === team && c.fill === C.fire && cells.some((g) => g.sector === team && g.fill === C.forest && cheb(g, c) <= 1)).length;
      const green = (n: Team) => cells.filter((c) => c.sector === n && c.fill === C.forest).length;
      const target = TEAM_INFO[team].neighbours.slice().sort((a, b) => green(b) - green(a))[0];
      if (target && myFire <= 2) {
        await board.postSticky(team, `Start a fire in ${TEAM_INFO[target].name}'s area?\nOur area is under control.`);
        this.lastAskAt = now;
        this.asked++;
      }
    }

    // Some boss turns go entirely to orders and questions; the others paint a batch too.
    if (this.rng() < (this.opts.bossOrderTurns ?? 0.5)) return 0;
    const k = this.batchSize();
    // Not the squares just given to the crew (5 each): the next most urgent ones.
    const spare = own.slice(crew.length * 5);
    return this.paintBatch(board, cells, this.sloppy(cells, (spare.length ? spare : own).slice(0, 2 * k).sort(() => this.rng() - 0.5), k));
  }

  // ---------- worker: one paint from its order ----------
  private async workerTurn(board: PlayerBoard, now: number): Promise<number> {
    const { banner } = await board.fixtures();
    if (/GAME OVER|\/join now/.test(banner)) return 0;
    const cells = await board.cells();
    const byLabel = new Map(cells.map((c) => [c.label, c]));
    const stickies = await board.stickies(this.team!);
    const order = stickies.find((s) => s.text.startsWith(`${this.name}: paint`));
    const k = this.batchSize();
    // During an approved attack, most of the crew lights squares in the neighbour's area.
    if (this.rng() < 0.6) {
      const { leaderboard } = await board.fixtures();
      const away = this.attackTo(now, leaderboard);
      if (away) return this.light(board, cells, away, Math.min(k, this.attackLeft(leaderboard)));
    }
    const picks: CellView[] = [];
    if (order) {
      if (order.text !== this.orderText) {
        this.orderText = order.text;
        this.orderDone = 0;
      }
      const list = parseOrder(order.text);
      while (this.orderDone < list.length && picks.length < k) {
        const c = byLabel.get(list[this.orderDone++]!);
        if (c && live(c)) picks.push(c); // re-check the exact square
      }
    }
    if (picks.length < k) {
      // Not enough from the order: some of the burning squares (or green next to the fire) nearest our
      // trees; each agent picks its own among the most urgent, so teammates rarely paint the same square.
      // Squares on a teammate's order are theirs.
      const ordered = new Set(stickies.filter((s) => s !== order).flatMap((s) => parseOrder(s.text)));
      const more = targetsFor(cells, this.team!, this.rng).filter((c) => !picks.includes(c) && !ordered.has(c.label));
      const pool = more.slice(0, Math.max(3 * k, 10)).sort(() => this.rng() - 0.5);
      picks.push(...this.sloppy(cells, pool, Math.min(k - picks.length, Math.ceil(k / 2))));
    }
    return this.paintBatch(board, cells, picks);
  }
}

/**
 * Squares a team wants blue in `sector`, most urgent first: burning squares next to the most green trees
 * (close to `protect`'s area first), then green squares right next to the fire.
 */
export function targetsFor(cells: CellView[], sector: Team, rng: Rng, protect: Team = sector): CellView[] {
  const byPos = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const home = cells.filter((c) => c.sector === protect && c.fill === C.forest);
  const near = (c: CellView) => {
    if (protect === sector) return 0;
    let d = Infinity;
    for (const g of home) d = Math.min(d, cheb(c, g));
    return d;
  };
  const greenAround = (c: CellView) => NEIGHBOURS.filter((w) => byPos.get(`${c.col + w.dc},${c.row + w.dr}`)?.fill === C.forest).length;
  const mine = cells.filter((c) => c.sector === sector);
  const fires = mine
    .filter((c) => c.fill === C.fire && greenAround(c) > 0)
    .map((c) => ({ c, v: greenAround(c) - 2 * near(c) + rng() }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.c);
  const front = mine.filter((c) => c.fill === C.forest && NEIGHBOURS.some((w) => !(w.dc && w.dr) && byPos.get(`${c.col + w.dc},${c.row + w.dr}`)?.fill === C.fire));
  return [...fires, ...front];
}

/**
 * Where to light a fire in `to`'s area: green squares deep in it (at least 6 squares from `from`'s area,
 * so the fire is less likely to spread back), with the most green around them, away from blue.
 */
export function attackTargets(cells: CellView[], to: Team, from: Team, rng: Rng): CellView[] {
  const byPos = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const ours = cells.filter((c) => c.sector === from);
  const dist = (c: CellView) => {
    let d = Infinity;
    for (const o of ours) d = Math.min(d, cheb(c, o));
    return d;
  };
  return cells
    .filter((c) => c.sector === to && c.fill === C.forest)
    .map((c) => {
      const green = NEIGHBOURS.filter((w) => byPos.get(`${c.col + w.dc},${c.row + w.dr}`)?.fill === C.forest).length;
      const wet = cells.some((o) => o.fill === C.water && cheb(o, c) <= 2);
      const d = dist(c);
      return { c, v: d >= 6 ? green + Math.min(d, 12) / 4 - (wet ? 5 : 0) + rng() : -Infinity };
    })
    .filter((x) => x.v > -Infinity)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.c);
}

/** Square labels on an order sticky ("Ana: paint N9 N10 N11"). */
export function parseOrder(text: string): string[] {
  const m = /:\s*paint\s+(.+)$/i.exec(text.split("\n")[0]!.trim());
  return m ? m[1]!.split(/[\s,]+/).filter((l) => /^[A-Z]{1,2}\d{1,2}$/i.test(l)).map((l) => l.toUpperCase()) : [];
}

// ---------- reading the projector ----------

/** A team's water from the banner ("💧 T1 62 · T2 40 · T3 71 · T4 55"). */
export function waterOf(banner: string, team: Team): number {
  const m = new RegExp(`T${TEAM_INFO[team].num} (\\d+)`).exec(banner.slice(banner.indexOf("💧")));
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
