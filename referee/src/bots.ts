// `npm run referee bots`: ~30 scripted players on the REAL board (or on a FakeBoard with --dry-run), so the
// instructor can watch a full game with both referees. Each bot joins through the normal /join path (a card
// in the Inbox panel), reads its team and role off that card, and plays like src/bot.ts under the current
// rules (blue only on green within 2 of the fire, ≤5 squares per paint, orange only during an approved
// attack, the boss writes "Name: paint ..." orders and asks "Start a fire in Team N's area?", a teammate
// answers YES).
//
// Cost control (one Miro token for every bot): ONE shared reader refreshes the board at most every
// `readEveryMs` (grid by frame, the 4 Orders frames, the 6 fixtures) and every bot acts on that snapshot;
// cards are read by id every `cardEveryMs`. Writes go through one token bucket (`writesPerMin`): a turn
// that can't get its whole batch waits a second and tries again.
//
// Identity: every bot write comes from the bot token's Miro user. The referees must run in rehearsal
// (each inbox card is a player) and must NOT count that user as their own: `--bots-token N` on the
// referees (RUNBOOK "Bot rehearsal").
//
// Profiles: "agent" = the calibrated Claude-agent pace (rehearsal-3: turns 14-25 s, batches 2-5, few
// mistakes). "class" (--class) = what 23 students' agents did in class (results/serve-4teams.log, rounds 2
// and 3): joins over ~2.5 min, a third start 1-3 min after GO, turns ~12-40 s with long pauses, ~half of
// the blue paints refused (on fire / already burnt / no fire within 2), a few wrong-hex blues, a few
// batches over 5, a few orange paints without a YES, bosses who rarely paint, ~2-3 approved attacks per
// team, and vandal seats that drop an image and a stray sticky (the guard's work).
import { pool, stripHtml } from "./board.js";
import { attackTargets, crewOf, parseOrder, rowOf, type CellView, type StickyNote } from "./bot.js";
import type { FakeBoard } from "./fake-board.js";
import { GRID_BOX, ICON_URL, NEIGHBOURS, ORDERS, PANELS, RANK_SLOTS, STATE_COLOR, TEAMS, TEAM_INFO, buildCells, inside, parseLabel, rankKey, type Team } from "./layout.js";
import type { FixtureKey } from "./referee.js";
import { mulberry32, type Rng } from "./rules.js";

const C = STATE_COLOR;
/** The wrong blue some agents typed in class (refused [color]). */
export const WRONG_BLUE = "#659df2";
const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const TEAM_BY_CAPS: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [TEAM_INFO[t].name.toUpperCase(), t]));

export interface Fixtures {
  banner: string;
  scoreboard: string;
  leaderboard: string;
}

/** What the runner needs from a board: a few cheap shared reads and the writes a student's agent makes. */
export interface BotIO {
  readGrid(): Promise<CellView[]>;
  readOrders(): Promise<Record<Team, StickyNote[]>>;
  readFixtures(): Promise<Fixtures>;
  /** A card's text (null: gone). */
  readCard(id: string): Promise<string | null>;
  /** The /join card (380 x 150 at top-left x, y inside the Inbox panel). Returns its id. */
  createCard(name: string, x: number, y: number): Promise<string>;
  paint(cellId: string, fill: string): Promise<void>;
  postSticky(team: Team, text: string, slot: number): Promise<string>;
  editSticky(id: string, text: string): Promise<void>;
  /** Vandals: an image and a stray sticky (center x, y). */
  dropImage(x: number, y: number): Promise<string>;
  dropSticky(x: number, y: number, text: string): Promise<string>;
}

export interface Profile {
  /** Joins spread over this many seconds from the runner's start. */
  joinSpreadSec: number;
  /** After GO (LIVE banner) each bot starts after [lo, hi] s; a `lateShare` of them after lateSec instead. */
  startSec: [number, number];
  lateShare: number;
  lateSec: [number, number];
  /** Seconds between a bot's turns; a `pauseShare` of the gaps are a long pause (pauseSec). */
  turnSec: [number, number];
  pauseShare: number;
  pauseSec: [number, number];
  /** Squares per paint turn (min, max). */
  batch: [number, number];
  /** Per blue square: on a burning square, on a burnt square, on green with no fire within 2, the wrong hex. */
  mistakes: { onFire: number; burnt: number; far: number; wrongHex: number };
  /** Per turn: a batch of 6-9 squares (over the 5 limit). */
  overBatch: number;
  /** Per turn: one orange square in a neighbour's area without an approved attack. */
  orangeNoYes: number;
  /** Share of a boss's turns that also paint (the rest only write orders/questions). */
  bossPaint: number;
  /** Bosses ask "Start a fire in ...?" this often (s) while no attack is running or waiting. */
  askGapSec: [number, number];
  /** A teammate answers after [lo, hi] s; YES with this chance. */
  yesDelaySec: [number, number];
  yesRate: number;
  /** Seats that also vandalize (one image + one stray sticky each, once, during the game). */
  vandals: number;
  attacks: boolean;
}

export const AGENT_PROFILE: Profile = {
  joinSpreadSec: 20,
  startSec: [5, 20],
  lateShare: 0,
  lateSec: [0, 0],
  turnSec: [14, 25],
  pauseShare: 0,
  pauseSec: [0, 0],
  batch: [2, 5],
  mistakes: { onFire: 0.05, burnt: 0.03, far: 0.03, wrongHex: 0 },
  overBatch: 0,
  orangeNoYes: 0,
  bossPaint: 0.5,
  askGapSec: [90, 150],
  yesDelaySec: [20, 60],
  yesRate: 0.85,
  vandals: 0,
  attacks: true,
};

/**
 * Class (serve-4teams.log rounds 2-3, 23 students): first paints 17-55 s after GO for two thirds, 70-175 s
 * for the rest; 4-6 squares tried per player per minute while there is fire to fight (minutes 1-3: 90-140
 * paints/min for 23 players), little once it is out; gaps between turns mostly 10-40 s, ~10% over a
 * minute; 1-5 squares per turn; of the blue paints ~33% on fire ("water can't go on fire"), ~8% already burnt, ~10% "no fire
 * within 2"; 3 wrong-hex blues and 9 over-batch squares in ~500; 8 orange paints without a YES in two
 * rounds; bosses painted 0-2 squares (one 18); 8 and 11 approved attacks.
 */
export const CLASS_PROFILE: Profile = {
  joinSpreadSec: 150,
  startSec: [15, 55],
  lateShare: 0.3,
  lateSec: [60, 150],
  turnSec: [12, 40],
  pauseShare: 0.1,
  pauseSec: [60, 120],
  batch: [1, 5],
  mistakes: { onFire: 0.25, burnt: 0.08, far: 0.1, wrongHex: 0.01 },
  overBatch: 0.03,
  orangeNoYes: 0.012,
  bossPaint: 0.2,
  askGapSec: [60, 120],
  yesDelaySec: [15, 45],
  yesRate: 0.9,
  vandals: 2,
  attacks: true,
};

export interface RunnerOptions {
  players: number;
  seed?: number;
  profile?: Profile;
  /** Shared whole-grid read at most this often (default 5 s). */
  readEveryMs?: number;
  /** Card reads (team, role) at most this often per card (default 15 s). */
  cardEveryMs?: number;
  /** Token bucket for the bot token's writes (default 400/min). */
  writesPerMin?: number;
  /** Names: Bot01 ... (prefix). */
  prefix?: string;
  /** rules.teamVote: every teammate who didn't ask votes "<name>: YES/NO" (else one plain YES/NO line). */
  teamVote?: boolean;
  log?: (s: string) => void;
}

interface Seat {
  name: string;
  rng: Rng;
  joinAt: number;
  cardId?: string;
  cardReadAt: number;
  team: Team | null;
  role: "boss" | "worker" | null;
  startDelay: number;
  nextTurnAt: number;
  orderText: string;
  orderDone: number;
  asked: number;
  nextAskAt: number;
  vandalAt: number | null;
  stickySlots: number;
}

interface Snapshot {
  at: number;
  cells: CellView[];
  byLabel: Map<string, CellView>;
  orders: Record<Team, StickyNote[]>;
  fx: Fixtures;
}

export interface RunnerStats {
  reads: number;
  writes: number;
  paints: number;
  blue: number;
  orange: number;
  wrongHex: number;
  overBatch: number;
  orangeNoYes: number;
  questions: number;
  answers: number;
  yes: number;
  orders: number;
  cards: number;
  vandal: number;
  deferred: number;
}

/** A write budget: `perMin` tokens a minute, at most `burst` saved up. Never waits: `take` says yes or no. */
export class Bucket {
  private tokens: number;
  private at: number | null = null;
  constructor(
    private perMin: number,
    private burst = Math.max(10, Math.ceil(perMin / 30)),
  ) {
    this.tokens = this.burst;
  }
  take(n: number, now: number): boolean {
    if (this.at !== null) this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.perMin) / 60_000);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const uni = (rng: Rng, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);

export class BotRunner {
  seats: Seat[];
  snap: Snapshot | null = null;
  phase: "lobby" | "live" | "over" | "paused" | "unknown" = "unknown";
  liveSince: number | null = null;
  stats: RunnerStats = { reads: 0, writes: 0, paints: 0, blue: 0, orange: 0, wrongHex: 0, overBatch: 0, orangeNoYes: 0, questions: 0, answers: 0, yes: 0, orders: 0, cards: 0, vandal: 0, deferred: 0 };
  /** Over: the banner said GAME OVER after the game was seen live (or at once if it never was). */
  over = false;
  private p: Profile;
  private rng: Rng;
  private bucket: Bucket;
  private readEvery: number;
  private cardEvery: number;
  private startedAt: number | null = null;
  /** A lobby or a live game was seen (a GAME OVER before that is the previous game's). */
  private seenGame = false;
  private answers = new Map<string, { at: number; yes: boolean }>();
  /** rules.teamVote: question id -> voter name -> when it votes, what, and whether it was written. */
  private votes = new Map<string, Map<string, { at: number; yes: boolean; done: boolean }>>();
  private teamVote: boolean;
  private log: (s: string) => void;

  constructor(
    private io: BotIO,
    o: RunnerOptions,
  ) {
    this.p = o.profile ?? AGENT_PROFILE;
    const seed = o.seed ?? 1;
    this.rng = mulberry32(seed * 7717 + 3);
    this.bucket = new Bucket(o.writesPerMin ?? 400);
    this.readEvery = o.readEveryMs ?? 5000;
    this.cardEvery = o.cardEveryMs ?? 15_000;
    this.teamVote = !!o.teamVote;
    this.log = o.log ?? (() => {});
    const prefix = o.prefix ?? "Bot";
    const vandals = new Set<number>();
    while (vandals.size < Math.min(this.p.vandals, o.players)) vandals.add(Math.floor(this.rng() * o.players));
    this.seats = Array.from({ length: o.players }, (_, i) => {
      const rng = mulberry32(seed * 1000 + i + 1);
      const late = rng() < this.p.lateShare;
      return {
        name: `${prefix}${String(i + 1).padStart(2, "0")}`,
        rng,
        joinAt: Math.round(rng() * this.p.joinSpreadSec * 1000),
        cardReadAt: -Infinity,
        team: null,
        role: null,
        startDelay: Math.round(uni(rng, late ? this.p.lateSec : this.p.startSec) * 1000),
        nextTurnAt: 0,
        orderText: "",
        orderDone: 0,
        asked: 0,
        nextAskAt: 0,
        vandalAt: vandals.has(i) ? Math.round((60 + rng() * 300) * 1000) : null,
        stickySlots: 0,
      };
    });
  }

  /** Everything due at `now`: the shared read, joins, card reads, turns, answers, vandals. */
  async step(now: number): Promise<void> {
    if (!this.snap || now - this.snap.at >= this.readEvery) await this.refresh(now);
    if (!this.snap) return;
    if (!this.seenGame && /GAME OVER/i.test(this.snap.fx.banner)) {
      this.phase = "over"; // the last game's: joins are timed from the new game's lobby
      return;
    }
    this.startedAt ??= now;
    const banner = this.snap.fx.banner;
    const wasLive = this.liveSince !== null;
    if (/GAME OVER/i.test(banner)) {
      // The last game's GAME OVER (the board not reset yet): wait for the new lobby; never join into it.
      this.phase = "over";
      if (this.seenGame) this.over = true;
      return;
    }
    this.seenGame = true;
    if (/^LIVE\b/i.test(banner)) {
      this.phase = "live";
      this.liveSince ??= now;
      if (!wasLive) for (const s of this.seats) s.nextTurnAt = now + s.startDelay;
    } else if (/PAUSED/i.test(banner)) this.phase = "paused";
    else this.phase = "lobby";
    await this.joins(now);
    await this.readCards(now);
    if (this.phase !== "live") return;
    const due = this.seats.filter((s) => s.team && s.role && now >= s.nextTurnAt).sort(() => this.rng() - 0.5);
    for (const s of due) await this.turn(s, now);
    await this.answer(now);
    await this.vandalize(now);
  }

  private async refresh(now: number) {
    try {
      const [cells, orders, fx] = await Promise.all([this.io.readGrid(), this.io.readOrders(), this.io.readFixtures()]);
      this.stats.reads += 3;
      this.snap = { at: now, cells, byLabel: new Map(cells.map((c) => [c.label, c])), orders, fx };
    } catch (e) {
      this.log(`board read failed (${(e as Error).message.split("\n")[0]}); next read in ${this.readEvery / 1000}s`);
      if (this.snap) this.snap.at = now; // don't hammer a failing board
    }
  }

  private async write(n: number, now: number, run: () => Promise<unknown>): Promise<boolean> {
    if (!this.bucket.take(n, now)) {
      this.stats.deferred++;
      return false;
    }
    this.stats.writes += n;
    try {
      await run();
    } catch (e) {
      this.log(`write failed: ${(e as Error).message.split("\n")[0]}`);
    }
    return true;
  }

  private async joins(now: number) {
    const t0 = this.startedAt!;
    for (const s of this.seats) {
      if (s.cardId || now - t0 < s.joinAt) continue;
      const x = PANELS.inbox.x + 40 + Math.floor(s.rng() * 3500);
      const y = PANELS.inbox.y + 100 + Math.floor(s.rng() * 1200);
      await this.write(1, now, async () => {
        s.cardId = await this.io.createCard(s.name, x, y);
        this.stats.cards++;
        this.log(`${s.name} joined (card ${s.cardId})`);
      });
    }
  }

  private async readCards(now: number) {
    const due = this.seats.filter((s) => {
      if (!s.cardId) return false;
      // Until the card shows a team: every few seconds; after, only now and then (the role can't change).
      const every = s.team ? this.cardEvery * 4 : Math.min(this.cardEvery, 6000);
      return now - s.cardReadAt >= every;
    });
    await pool(
      due.map((s) => async () => {
        s.cardReadAt = now;
        this.stats.reads++;
        let text: string | null;
        try {
          text = await this.io.readCard(s.cardId!);
        } catch {
          return;
        }
        if (text === null) return;
        const m = /\b(TEAM [1-4])\b/.exec(text);
        if (m) s.team = TEAM_BY_CAPS[m[1]!]!;
        const r = /· (?:👑 )?(BOSS|WORKER) ·/.exec(text);
        if (r) s.role = r[1] === "BOSS" ? "boss" : "worker";
      }),
      8,
    );
  }

  private schedule(s: Seat, now: number) {
    const long = s.rng() < this.p.pauseShare;
    s.nextTurnAt = now + Math.round(uni(s.rng, long ? this.p.pauseSec : this.p.turnSec) * 1000);
  }

  /** Our running attack (from our leaderboard row): the area and how many fires are left. */
  private attackOf(team: Team): { to: Team; left: number } | null {
    const m = /ATTACK ON (TEAM [1-4]): (\d+) fires? left/i.exec(rowOf(this.snap!.fx.leaderboard, team));
    return m ? { to: TEAM_BY_CAPS[m[1]!.toUpperCase()]!, left: Number(m[2]) } : null;
  }

  private async turn(s: Seat, now: number) {
    const snap = this.snap!;
    const team = s.team!;
    const p = this.p;
    let done = true;
    if (s.role === "boss") done = await this.bossTurn(s, now);
    if (done && (s.role === "worker" || s.rng() < p.bossPaint)) done = await this.paintTurn(s, now, snap);
    if (!done) {
      s.nextTurnAt = now + 1000; // no write budget: try again in a second
      return;
    }
    // A few agents paint orange without a YES (refused [color]/[attack]).
    if (s.rng() < p.orangeNoYes && !this.attackOf(team)) {
      const n = TEAM_INFO[team].neighbours[Math.floor(s.rng() * 2)]!;
      const pick = attackTargets(snap.cells, n, team, s.rng)[0];
      if (pick && (await this.write(1, now, () => this.io.paint(pick.id, C.fire)))) {
        this.stats.paints++;
        this.stats.orange++;
        this.stats.orangeNoYes++;
      }
    }
    this.schedule(s, now);
  }

  /** Orders (one sticky per worker, edited in place) and the attack question. False: no write budget. */
  private async bossTurn(s: Seat, now: number): Promise<boolean> {
    const snap = this.snap!;
    const team = s.team!;
    const crew = crewOf(snap.fx.leaderboard, team);
    const stickies = snap.orders[team] ?? [];
    const own = blueTargets(snap.cells, team, s.rng);
    const jobs: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < crew.length; i++) {
      const mine = own.filter((_, k) => k % crew.length === i).slice(0, 5);
      const text = mine.length ? `${crew[i]}: paint ${mine.map((c) => c.label).join(" ")}` : `${crew[i]}: paint nothing yet, watch the fire`;
      const old = stickies.find((x) => x.text.startsWith(`${crew[i]}: paint`));
      if (!old) jobs.push(() => this.io.postSticky(team, text, s.stickySlots++));
      else if (old.text !== text) jobs.push(() => this.io.editSticky(old.id, text));
    }
    // At most 3 order writes per turn (an agent edits a few stickies, not all of them, each move).
    const orderJobs = jobs.sort(() => s.rng() - 0.5).slice(0, 3);
    if (orderJobs.length && !(await this.write(orderJobs.length, now, () => Promise.all(orderJobs.map((j) => j()))))) return false;
    this.stats.orders += orderJobs.length;
    // The attack question.
    const row = rowOf(snap.fx.leaderboard, team);
    // With teamVote the votes are "<name>: YES" lines and only the row tells an undecided question apart.
    const open = !this.teamVote && stickies.some((x) => /^Start a fire in /i.test(x.text) && !/\n\s*(YES|NO)\s*$/i.test(x.text));
    if (this.p.attacks && now >= s.nextAskAt && !open && !this.attackOf(team) && !/waiting for a YES/i.test(row)) {
      const green = (n: Team) => snap.cells.filter((c) => c.sector === n && c.fill === C.forest).length;
      const playing = (n: Team) => !!rowOf(snap.fx.leaderboard, n) && !/not playing/i.test(rowOf(snap.fx.leaderboard, n).split("\n")[0] ?? "");
      const target = TEAM_INFO[team].neighbours.filter((n) => playing(n) && green(n) > 0).sort((a, b) => green(b) - green(a))[0];
      if (target) {
        const text = `Start a fire in ${TEAM_INFO[target].name}'s area?\nOur area is under control.`;
        if (await this.write(1, now, () => this.io.postSticky(team, text, s.stickySlots++))) {
          this.stats.questions++;
          s.asked++;
          s.nextAskAt = now + Math.round(uni(s.rng, this.p.askGapSec) * 1000);
          this.log(`${s.name} (${TEAM_INFO[team].name} boss) asks: ${text.split("\n")[0]}`);
        }
      }
    }
    return true;
  }

  /** One paint batch: attack fires during an approved attack, else blue from the order or the front. */
  private async paintTurn(s: Seat, now: number, snap: Snapshot): Promise<boolean> {
    const team = s.team!;
    const p = this.p;
    const over = s.rng() < p.overBatch;
    const k = over ? 6 + Math.floor(s.rng() * 4) : p.batch[0] + Math.floor(s.rng() * (p.batch[1] - p.batch[0] + 1));
    const attack = this.attackOf(team);
    if (attack && attack.left > 0 && s.rng() < 0.6) {
      const picks = attackTargets(snap.cells, attack.to, team, s.rng).slice(0, Math.min(attack.left, k));
      if (!picks.length) return true;
      if (!(await this.write(picks.length, now, () => Promise.all(picks.map((c) => this.io.paint(c.id, C.fire)))))) return false;
      this.stats.paints += picks.length;
      this.stats.orange += picks.length;
      this.log(`${s.name} lights ${picks.map((c) => c.label).join(" ")} (attack on ${TEAM_INFO[attack.to].name})`);
      return true;
    }
    const picks: CellView[] = [];
    const order = (snap.orders[team] ?? []).find((x) => x.text.startsWith(`${s.name}: paint`));
    if (order) {
      if (order.text !== s.orderText) {
        s.orderText = order.text;
        s.orderDone = 0;
      }
      const list = parseOrder(order.text);
      while (s.orderDone < list.length && picks.length < k) {
        const c = snap.byLabel.get(list[s.orderDone++]!);
        if (c && c.fill === C.forest) picks.push(c);
      }
    }
    if (picks.length < k) {
      const ordered = new Set((snap.orders[team] ?? []).filter((x) => x !== order).flatMap((x) => parseOrder(x.text)));
      const more = blueTargets(snap.cells, team, s.rng).filter((c) => !picks.includes(c) && !ordered.has(c.label));
      picks.push(...more.slice(0, Math.max(3 * k, 10)).sort(() => s.rng() - 0.5).slice(0, k - picks.length));
    }
    // Nothing left to save near the fire: agents still paint the fire itself (refused "water can't go on
    // fire"), most of the "square" refusals in class came from that.
    if (picks.length < k && s.rng() < p.mistakes.onFire * 2) {
      const fires = snap.cells.filter((x) => x.sector === team && x.fill === C.fire && !picks.includes(x));
      picks.push(...fires.sort(() => s.rng() - 0.5).slice(0, k - picks.length));
    }
    // Mistakes, square by square (what the agents in class did).
    const out: { c: CellView; fill: string }[] = [];
    const used = new Set<string>();
    for (let c of picks) {
      const r = s.rng();
      const m = p.mistakes;
      let alt: CellView | undefined;
      if (r < m.onFire) alt = pickOne(snap.cells.filter((x) => x.sector === team && x.fill === C.fire), s.rng);
      else if (r < m.onFire + m.burnt) alt = pickOne(snap.cells.filter((x) => x.sector === team && x.fill === C.burnt && nearFire(snap.cells, x, 2)), s.rng);
      else if (r < m.onFire + m.burnt + m.far) alt = pickOne(snap.cells.filter((x) => x.sector === team && x.fill === C.forest && !nearFire(snap.cells, x, 2)), s.rng);
      if (alt) c = alt;
      if (used.has(c.id)) continue;
      used.add(c.id);
      out.push({ c, fill: s.rng() < m.wrongHex ? WRONG_BLUE : C.water });
    }
    if (!out.length) return true;
    if (!(await this.write(out.length, now, () => Promise.all(out.map((x) => this.io.paint(x.c.id, x.fill)))))) return false;
    this.stats.paints += out.length;
    this.stats.blue += out.length;
    this.stats.wrongHex += out.filter((x) => x.fill === WRONG_BLUE).length;
    if (over) this.stats.overBatch++;
    return true;
  }

  /** A teammate who didn't ask answers each open question after a while (YES or NO line). */
  private async answer(now: number) {
    for (const team of TEAMS) {
      for (const q of this.snap!.orders[team] ?? []) {
        if (!/^Start a fire in /i.test(q.text) || /\n\s*(YES|NO)\s*$/i.test(q.text)) continue;
        if (this.teamVote) {
          await this.vote(team, q, now);
          continue;
        }
        const a = this.answers.get(q.id);
        if (!a) {
          this.answers.set(q.id, { at: now + Math.round(uni(this.rng, this.p.yesDelaySec) * 1000), yes: this.rng() < this.p.yesRate });
          continue;
        }
        if (now < a.at || a.at < 0) continue;
        const mates = this.seats.filter((s) => s.team === team && s.role === "worker");
        if (!mates.length) continue;
        if (await this.write(1, now, () => this.io.editSticky(q.id, `${q.text}\n${a.yes ? "YES" : "NO"}`))) {
          a.at = -1; // answered once (the next read shows it)
          this.stats.answers++;
          if (a.yes) this.stats.yes++;
          this.log(`${mates[Math.floor(this.rng() * mates.length)]!.name} answers ${a.yes ? "YES" : "NO"}: ${q.text.split("\n")[0]}`);
        }
      }
    }
  }

  /**
   * rules.teamVote: every worker of the team (the boss asked; a boss alone votes on its own) votes once,
   * after its own delay, with a "<name>: YES/NO" line. Due votes go in one edit, re-adding our earlier
   * lines a stale read doesn't show yet so they aren't overwritten.
   */
  private async vote(team: Team, q: StickyNote, now: number) {
    const workers = this.seats.filter((s) => s.team === team && s.role === "worker");
    const voters = workers.length ? workers : this.seats.filter((s) => s.team === team && s.role === "boss");
    let plan = this.votes.get(q.id);
    if (!plan) this.votes.set(q.id, (plan = new Map()));
    for (const s of voters)
      if (!plan.has(s.name)) plan.set(s.name, { at: now + Math.round(uni(this.rng, this.p.yesDelaySec) * 1000), yes: this.rng() < this.p.yesRate, done: false });
    const due = [...plan].filter(([, v]) => !v.done && now >= v.at);
    if (!due.length) return;
    const line = ([n, v]: [string, { yes: boolean }]) => `${n}: ${v.yes ? "YES" : "NO"}`;
    const shown = new Set(q.text.split("\n").map((l) => l.trim()));
    const add = [...[...plan].filter(([, v]) => v.done).map(line).filter((l) => !shown.has(l)), ...due.map(line)];
    if (await this.write(1, now, () => this.io.editSticky(q.id, `${q.text}\n${add.join("\n")}`))) {
      for (const [n, v] of due) {
        v.done = true;
        this.stats.answers++;
        if (v.yes) this.stats.yes++;
        this.log(`${n} votes ${v.yes ? "YES" : "NO"}: ${q.text.split("\n")[0]}`);
      }
    }
  }

  /** Vandal seats: an image on the forest and a stray sticky on the forest, once each, during the game. */
  private async vandalize(now: number) {
    for (const s of this.seats) {
      if (s.vandalAt === null || now - this.liveSince! < s.vandalAt) continue;
      s.vandalAt = null;
      // The sticky goes 300 to the right of the image (160 wide): keep it on the forest, off the Orders frames.
      const x = GRID_BOX.x + 200 + Math.floor(s.rng() * (GRID_BOX.w - 400 - 460));
      const y = GRID_BOX.y + 200 + Math.floor(s.rng() * (GRID_BOX.h - 400));
      await this.write(2, now, async () => {
        await this.io.dropImage(x, y);
        await this.io.dropSticky(x + 300, y + 100, "lol 🔥");
      });
      this.stats.vandal += 2;
      this.log(`${s.name} vandalizes: an image and a sticky on the forest near ${Math.round(x)},${Math.round(y)}`);
    }
  }

  /** One line for the terminal. */
  status(now: number): string {
    const joined = this.seats.filter((s) => s.cardId).length;
    const placed = this.seats.filter((s) => s.team).length;
    const mins = Math.max(1 / 60, (now - (this.startedAt ?? now)) / 60_000);
    const st = this.stats;
    if (!this.seenGame) return `bots waiting: the banner still shows the last game (${this.phase}); reset the board for a new lobby`;
    return `bots ${this.phase.toUpperCase()} · ${joined}/${this.seats.length} joined, ${placed} on a team · paints ${st.paints} (blue ${st.blue}, orange ${st.orange}) · orders ${st.orders} · questions ${st.questions} answers ${st.answers} · writes ${Math.round(st.writes / mins)}/min reads ${Math.round(st.reads / mins)}/min · deferred ${st.deferred}`;
  }
}

function pickOne<T>(xs: T[], rng: Rng): T | undefined {
  return xs.length ? xs[Math.floor(rng() * xs.length)] : undefined;
}

function nearFire(cells: CellView[], c: CellView, d: number): boolean {
  return cells.some((f) => f.fill === C.fire && cheb(f, c) <= d);
}

/**
 * Green squares of `team` worth blue under waterNearFire: next to the fire first (most fire around them),
 * then two away. Blue on a burning square is refused under the current rules.
 */
export function blueTargets(cells: CellView[], team: Team, rng: Rng): CellView[] {
  const fires = cells.filter((c) => c.fill === C.fire);
  const byPos = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const out: { c: CellView; v: number }[] = [];
  for (const c of cells) {
    if (c.sector !== team || c.fill !== C.forest) continue;
    let d = Infinity;
    for (const f of fires) d = Math.min(d, cheb(f, c));
    if (d > 2) continue;
    const hot = NEIGHBOURS.filter((w) => byPos.get(`${c.col + w.dc},${c.row + w.dr}`)?.fill === C.fire).length;
    out.push({ c, v: (d === 1 ? 10 : 0) + hot + rng() });
  }
  return out.sort((a, b) => b.v - a.v).map((x) => x.c);
}

// ---------- the FakeBoard IO (dry runs, tests) ----------

/** Bots on a FakeBoard, writing as `user` (the bot token's Miro user). */
export class FakeBotIO implements BotIO {
  private kinds = new Map(buildCells().map((c) => [c.label, c]));
  /** Bot paints that changed a square's fill (each must be judged by the game referee). */
  changed = 0;
  constructor(
    private fake: FakeBoard,
    private user: string,
    private fixtureIds: () => Partial<Record<FixtureKey, string>>,
  ) {}
  async readGrid(): Promise<CellView[]> {
    const out: CellView[] = [];
    for (const it of this.fake.items.values()) {
      if (it.type !== "shape" || it.w > 100 || !inside(GRID_BOX, it.x, it.y)) continue;
      const lab = stripHtml(it.content);
      const def = parseLabel(lab) && this.kinds.get(lab);
      if (def) out.push({ id: it.id, label: lab, col: def.col, row: def.row, sector: def.sector, fill: (it.fill ?? "").toLowerCase() });
    }
    return out;
  }
  async readOrders(): Promise<Record<Team, StickyNote[]>> {
    const out = Object.fromEntries(TEAMS.map((t) => [t, [] as StickyNote[]])) as Record<Team, StickyNote[]>;
    for (const i of this.fake.items.values()) {
      if (i.type !== "sticky_note") continue;
      const t = TEAMS.find((x) => inside(ORDERS[x], i.x, i.y));
      if (t) out[t].push({ id: i.id, text: stripHtml(i.content), createdBy: i.createdBy, modifiedBy: i.modifiedBy });
    }
    return out;
  }
  async readFixtures(): Promise<Fixtures> {
    const ids = this.fixtureIds();
    const text = (id?: string) => stripHtml(this.fake.items.get(id ?? "")?.content ?? "");
    return { banner: text(ids.banner), scoreboard: text(ids.scoreboard), leaderboard: RANK_SLOTS.map((n) => text(ids[rankKey(n)])).join("\n") };
  }
  async readCard(id: string): Promise<string | null> {
    const it = this.fake.items.get(id);
    return it ? stripHtml(it.content) : null;
  }
  async createCard(name: string, x: number, y: number): Promise<string> {
    return this.fake.vandalAdd(this.user, "shape", { x: x + 190, y: y + 75, w: 380, h: 150 }, `Inbox · ${name}`, "#ffffff").id;
  }
  async paint(cellId: string, fill: string): Promise<void> {
    const it = this.fake.items.get(cellId);
    if (!it) return;
    if ((it.fill ?? "").toLowerCase() !== fill.toLowerCase()) this.changed++;
    this.fake.playerEdit(this.user, cellId, { fill });
  }
  async postSticky(team: Team, text: string): Promise<string> {
    return this.fake.playerSticky(this.user, team, text).id;
  }
  async editSticky(id: string, text: string): Promise<void> {
    if (this.fake.items.has(id)) this.fake.playerEditSticky(this.user, id, text);
  }
  async dropImage(x: number, y: number): Promise<string> {
    return this.fake.vandalAdd(this.user, "image", { x, y, w: 200, h: 200 }, ICON_URL.fire).id;
  }
  async dropSticky(x: number, y: number, text: string): Promise<string> {
    return this.fake.vandalAdd(this.user, "sticky_note", { x, y, w: 160, h: 184 }, text).id;
  }
}
