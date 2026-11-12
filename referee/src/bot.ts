// Scripted players for the simulation. A bot sees only what a student's agent sees (square colors,
// banner, scoreboard, leaderboard, its own inbox card, the Orders frames) and plays like the kit:
// the boss reads the fire and keeps one ORDER sticky per worker, posts PLAN / BACKBURN / HELP;
// workers paint one square from their ORDER about every 15 s, from orders that may be stale, with mistakes.
import { STATE_COLOR, TEAMS, TEAM_INFO, WIND, label, type CellKind, type Team } from "./layout.js";
import type { Rng } from "./rules.js";

export interface CellView {
  id: string;
  label: string;
  col: number;
  row: number;
  kind: CellKind;
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
  blindRate?: number; // chance a worker paints its next ordered square without checking it still makes sense
}

const C = STATE_COLOR;
const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const TEAM_BY_CAPS: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [TEAM_INFO[t].name.toUpperCase(), t]));
const COLOR_WORD: Record<string, string> = { water: C.water, firebreak: C.firebreak, burnt: C.burnt };

interface Order {
  fill: string;
  label: string;
}

export class Bot {
  team: Team | null = null;
  role: "boss" | "worker" | null = null;
  planApproved = false;
  backburn = new Set<string>();
  help: { to: Team; until: number } | null = null;
  planPosted = false;
  lastBackburnAt = -Infinity;
  lastHelpAt = -Infinity;
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

  /** Read the inbox card: team, role, approvals (remembered once seen; the card keeps only 6 lines). */
  async readInbox(board: PlayerBoard, now: number): Promise<void> {
    const text = await board.inbox(this.userId);
    const m = /Team (RIDGE|PINE VALLEY|CEDAR CREEK|BIRCH HOLLOW)/.exec(text);
    if (m) this.team = TEAM_BY_CAPS[m[1]!]!;
    const r = /· (BOSS|WORKER) ·/.exec(text);
    if (r) this.role = r[1] === "BOSS" ? "boss" : "worker";
    for (const line of text.split("\n")) {
      if (this.seenLines.has(line)) continue;
      this.seenLines.add(line);
      if (/PLAN approved|already has an approved PLAN/.test(line)) this.planApproved = true;
      const bb = /BACKBURN approved.* on (.+)$/.exec(line);
      if (bb) for (const l of bb[1]!.split(/\s+/)) this.backburn.add(l);
      const h = /HELP approved: .*\((ridge|pine|cedar|birch)\) for (\d+) min/.exec(line);
      if (h) this.help = { to: h[1] as Team, until: now + Number(h[2]) * 60_000 };
    }
  }

  async act(board: PlayerBoard, now: number): Promise<number> {
    if (!this.team) return 0;
    this.turns++;
    return this.role === "boss" ? this.bossTurn(board, now) : this.workerTurn(board);
  }

  // ---------- boss: stickies only ----------
  private async bossTurn(board: PlayerBoard, now: number): Promise<number> {
    const team = this.team!;
    if (!this.planPosted) {
      await board.postSticky(team, "PLAN\nWater the fire edge nearest our trees, firebreaks downwind, protect both cabins.");
      this.planPosted = true;
      return 0;
    }
    const cells = await board.cells();
    const { banner, scoreboard, leaderboard } = await board.fixtures();
    const wind = windOf(banner);
    const water = waterOf(banner);
    const crew = crewOf(leaderboard, team);
    const stickies = await board.stickies(team);

    // One ORDER per worker, updated in place. Two go help another team while a HELP grant runs.
    const helping = this.help && now < this.help.until ? this.help.to : null;
    const home = crew.slice(helping ? 2 : 0);
    const away = helping ? crew.slice(0, 2) : [];
    const plans: [string[], Team][] = [[home, team]];
    if (helping) plans.push([away, helping]);
    for (const [names, sector] of plans) {
      const targets = targetsFor(cells, sector, wind, water, sector === team ? this.backburn : new Set(), this.rng);
      for (let i = 0; i < names.length; i++) {
        const mine = targets.filter((_, k) => k % names.length === i).slice(0, 3);
        const byColor = new Map<string, string[]>();
        for (const o of mine) {
          const word = Object.keys(COLOR_WORD).find((w) => COLOR_WORD[w] === o.fill)!;
          byColor.set(word, [...(byColor.get(word) ?? []), o.label]);
        }
        const body = byColor.size ? [...byColor].map(([w, ls]) => `${w} ${ls.join(" ")}`).join("\n") : "stand by: watch the fire";
        const text = `ORDER · ${names[i]}\n${body}`;
        const old = stickies.find((s) => s.text.split("\n")[0]!.trim() === `ORDER · ${names[i]}`);
        if (!old) await board.postSticky(team, text);
        else if (old.text !== text) await board.editSticky(old.id, text);
      }
    }
    if (!this.planApproved) return 0;
    if (now - this.lastBackburnAt > 240_000) {
      const run = backburnRun(cells, team, wind, this.rng);
      if (run) {
        await board.postSticky(team, `BACKBURN ${run}\nto stop the front before it reaches our trees`);
        this.lastBackburnAt = now;
        return 0;
      }
    }
    if (now - this.lastHelpAt > 240_000) {
      const pct = percents(scoreboard);
      const own = pct[team];
      const best = TEAM_INFO[team].neighbours.slice().sort((a, b) => (pct[b] ?? 0) - (pct[a] ?? 0))[0]!;
      if (own !== undefined && own < 75 && (pct[best] ?? 0) >= own + 10) {
        await board.postSticky(best, `HELP ${TEAM_INFO[team].name}\nfire is eating our sector, 2 painters please`);
        this.lastHelpAt = now;
      }
    }
    return 0;
  }

  // ---------- worker: one paint from its ORDER ----------
  private async workerTurn(board: PlayerBoard): Promise<number> {
    if (!this.planApproved && this.rng() > 0.1) return 0; // agents sometimes jump the gun
    const cells = await board.cells();
    const byLabel = new Map(cells.map((c) => [c.label, c]));
    const stickies = await board.stickies(this.team!);
    const order = stickies.find((s) => s.text.split("\n")[0]!.trim() === `ORDER · ${this.name}`);
    let target: CellView | undefined;
    let fill = C.water;
    if (this.rng() < (this.opts.mistakeRate ?? 0.1)) {
      // A mistake: a random square near the fire, a color it thinks is right.
      const fires = cells.filter((c) => c.fill === C.fire);
      const near = cells.filter((c) => fires.some((f) => cheb(c, f) <= 2));
      target = near[Math.floor(this.rng() * near.length)];
      fill = [C.water, C.firebreak, C.burnt][Math.floor(this.rng() * 3)]!;
    } else if (order) {
      if (order.text !== this.orderText) {
        this.orderText = order.text;
        this.orderDone = 0;
      }
      const list = parseOrder(order.text);
      while (this.orderDone < list.length && !target) {
        const o = list[this.orderDone++]!;
        const c = byLabel.get(o.label);
        if (!c) continue;
        const fits = o.fill === C.water ? [C.fire, C.forest, C.cabin].includes(c.fill) : c.fill === C.forest;
        if (fits || this.rng() < (this.opts.blindRate ?? 0.3)) {
          target = c;
          fill = o.fill;
        }
      }
    } else {
      // No order yet: water the burning square nearest the team's trees.
      const fires = cells.filter((c) => c.fill === C.fire && c.sector === this.team);
      const trees = cells.filter((c) => c.sector === this.team && (c.fill === C.forest || c.fill === C.cabin));
      target = fires.sort((a, b) => nearest(a, trees) - nearest(b, trees))[0];
    }
    if (!target) return 0;
    await board.paint(target.id, fill);
    this.painted++;
    return 1;
  }
}

/** What a boss wants painted in `sector`, most urgent first. */
export function targetsFor(cells: CellView[], sector: Team, wind: number, water: number, backburn: Set<string>, rng: Rng): Order[] {
  const fires = cells.filter((c) => c.fill === C.fire);
  const byPos = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const living = (c: CellView | undefined) => !!c && c.sector === sector && (c.fill === C.forest || c.fill === C.cabin);
  const threat = (c: CellView) => {
    let v = 0;
    WIND.forEach((w, i) => {
      const n = byPos.get(`${c.col + w.dc},${c.row + w.dr}`);
      if (living(n)) v += (n!.fill === C.cabin ? 6 : 1) * (i === wind ? 2 : 1);
    });
    return v + rng();
  };
  const out: Order[] = [];
  for (const c of cells) if (backburn.has(c.label) && c.fill === C.forest) out.push({ label: c.label, fill: C.burnt });
  const mine = cells.filter((c) => c.sector === sector);
  const burning = mine.filter((c) => c.fill === C.fire).sort((a, b) => threat(b) - threat(a));
  const front = mine
    .filter((c) => c.fill === C.forest || c.fill === C.cabin)
    .map((c) => ({ c, d: nearest(c, fires), down: downwind(c, fires, wind) + (c.fill === C.cabin ? 4 : 0) + rng() }))
    .filter((x) => x.d >= 1 && x.d <= 2)
    .sort((a, b) => b.down - a.down)
    .map((x) => x.c);
  if (water > 0) {
    // Mostly water on the flames, a firebreak line just downwind, cabins soaked.
    const n = Math.max(burning.length, front.length);
    for (let i = 0; i < n; i++) {
      if (burning[i]) out.push({ label: burning[i]!.label, fill: C.water });
      if (front[i] && (i % 2 === 1 || front[i]!.fill === C.cabin)) out.push({ label: front[i]!.label, fill: front[i]!.fill === C.cabin ? C.water : C.firebreak });
    }
  } else {
    for (const c of front) if (c.fill === C.forest) out.push({ label: c.label, fill: C.firebreak });
  }
  return out;
}

export function parseOrder(text: string): Order[] {
  const out: Order[] = [];
  for (const line of text.split("\n").slice(1)) {
    const m = /^(water|firebreak|burnt)\s+(.+)$/i.exec(line.trim());
    if (!m) continue;
    for (const l of m[2]!.split(/[\s,]+/).filter(Boolean)) out.push({ label: l.toUpperCase(), fill: COLOR_WORD[m[1]!.toLowerCase()]! });
  }
  return out;
}

// ---------- reading the projector ----------

export function windOf(banner: string): number {
  const m = /WIND \S+ (NE|NW|SE|SW|N|E|S|W)\b/.exec(banner) ?? /blowing (north-east|north-west|south-east|south-west|north|east|south|west)/.exec(banner);
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

function nearest(c: CellView, others: CellView[]): number {
  let d = Infinity;
  for (const f of others) d = Math.min(d, cheb(c, f));
  return d;
}

/** How much `c` lies downwind of the nearest fire (positive = the fire is coming). */
function downwind(c: CellView, fires: CellView[], wind: number): number {
  let best: CellView | null = null;
  let d = Infinity;
  for (const f of fires) {
    const k = cheb(c, f);
    if (k < d) {
      d = k;
      best = f;
    }
  }
  if (!best) return 0;
  const w = WIND[wind]!;
  return (c.col - best.col) * w.dc + (c.row - best.row) * w.dr;
}

/** A straight run of forest 3-5 squares downwind of the fire, inside the sector, across the wind. */
export function backburnRun(cells: CellView[], team: Team, wind: number, rng: Rng): string | null {
  const fires = cells.filter((c) => c.fill === C.fire);
  const near = fires.filter((f) => cells.some((c) => c.sector === team && cheb(c, f) <= 6));
  if (near.length < 6) return null;
  const w = WIND[wind]!;
  const vertical = w.dc !== 0; // wind has an east/west part: a column blocks it
  const cand = cells.filter((c) => c.sector === team && c.fill === C.forest && nearest(c, fires) >= 3 && nearest(c, fires) <= 5 && downwind(c, fires, wind) > 0);
  const groups = new Map<number, CellView[]>();
  for (const c of cand) {
    const k = vertical ? c.col : c.row;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  let bestRun: CellView[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => (vertical ? a.row - b.row : a.col - b.col));
    let run: CellView[] = [];
    for (const c of g) {
      const prev = run.at(-1);
      if (prev && (vertical ? c.row - prev.row : c.col - prev.col) === 1) run.push(c);
      else run = [c];
      if (run.length > bestRun.length || (run.length === bestRun.length && rng() < 0.3)) bestRun = run.slice(0, 10);
    }
  }
  if (bestRun.length < 4) return null;
  const a = bestRun[0]!;
  const b = bestRun.at(-1)!;
  return `${label(a.col, a.row)}-${label(b.col, b.row)}`;
}
