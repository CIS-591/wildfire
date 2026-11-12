// The referee loop: reads the board, diffs it against what it expects (the shadow), asks the rules
// engine, and writes back: fire spread and burn-out, reverted paints, inbox cards, banner,
// scoreboard and leaderboard. It never paints water for anyone.
//
// Every board operation is fallible (REFLECTION.md §2): a read that fails skips the tick, a write that
// fails is retried on a later tick (with backoff), an item that refuses writes three times (locked) is
// replaced, and tick() never throws. Writes are planned, prioritised and capped per tick (no write
// storms): the fire first, then reverts, then repairs; what doesn't fit is done on the next tick, because
// every plan is re-derived from "board vs engine" each tick (reconciliation, not a queue of events).
// Works on any BoardAdapter.
import type { BoardAdapter, BoardItem, NewShape } from "./board.js";
import { isGone, isLocked, pool, stripHtml } from "./board.js";
import {
  CELL_FONT, COLORS, FIXTURES, GRID, GRID_BOX, ORDERS, PANELS, STATE_COLOR, TEAMS, TEAM_INFO, WIND, buildCells, cellBox, cellStroke, center, frameBoxes, frameOfRow, inboxSlot,
  inside, ordersTeamAt, ordersTitle, parseLabel, sectorText, startFill, startState, textColorFor, type Box, type CellDef, type CellState, type Team,
} from "./layout.js";
import {
  MAX_OPEN_QUESTIONS, advance, decideJunk, windOn, paintsOf, applyJoin, createState, decidePaint, decideTamper, judgeSticky, mulberry32, pendingStickies, questionAnswered, questionTarget, questionText, scores, startGame,
  stickyKind, stopGame, teamName, type Decision, type GameState,
  type PaintEvent, type Rng, type RuleSet, type StickyView, type TamperEvent,
} from "./rules.js";

export type FixtureKey = keyof typeof FIXTURES;
const FIXTURE_KEYS = Object.keys(FIXTURES) as FixtureKey[];

export interface GameFile {
  fixtureIds: Partial<Record<FixtureKey, string>>;
  /** The whole game, saved every tick so a restarted referee carries on where it stopped. */
  state?: GameState;
  /** userId -> inbox card id (a card the referee had to recreate is not the player's own). */
  cards?: Record<string, string>;
  /** userId -> inbox slot index (stable even when cards are deleted). */
  slots?: Record<string, number>;
  /** Grid band frame ids (top band first) and Orders frame ids, as last repaired. */
  frames?: string[];
  orders?: Partial<Record<Team, string>>;
  /** Where each fixture sits (center-based), so a recreated one lands in exactly the same box. */
  fixtureBoxes?: Partial<Record<FixtureKey, { x: number; y: number; w: number; h: number }>>;
  /** Items that refused every write (locked): never adopted again, deleted when Miro lets us. */
  stuck?: string[];
}

export function emptyGame(): GameFile {
  return { fixtureIds: {} };
}

interface Shadow {
  content: string; // normalized text
  fill?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StaticSnap extends Shadow {
  raw: string;
  type: string;
}

/** One planned board write. */
interface Op {
  key: string; // one op per key per tick; failures back off per key
  prio: number; // lower runs first
  calls?: number; // API calls it costs (default 1)
  run: () => Promise<unknown>;
  ok?: () => void;
  /** Called only when Miro refuses the write as locked (403), with how many times in a row. */
  fail?: (e: Error, lockedTimes: number) => void;
  /** A fire/burnt fill write to this square label: re-read the square by id right before writing. */
  recheck?: string;
  /** The item this op writes: a 404 on it means it was deleted (never "locked"). */
  id?: string;
  /** Miro answered 404: forget the item so it is rebuilt at once (this tick). */
  gone?: () => void;
}

export interface TickResult {
  paints: number;
  tampers: number;
  joins: number;
  fire: number;
  changed: number;
  /** Board write calls this tick, and writes left for a later tick (the cap). */
  writes: number;
  /** Extra by-id reads this tick (fixtures, card probes, fire-write rechecks). */
  reads?: number;
  deferred: number;
  /** The board could not be read: nothing was judged and game time did not move. */
  skipped?: boolean;
  /** Something unexpected was caught; the game goes on. */
  error?: string;
}

const FEEDBACK_LINES = 6;
const TOL = 1.5;
/** Game time never jumps more than this per tick (a paused or crashed referee doesn't fast-forward the fire). */
const MAX_STEP_MS = 15_000;
/** A tracked item must be missing from this many reads in a row before it is rebuilt (a partial page is not a delete). */
const MISSING_READS = 2;
/** A write refused as locked (403) this many times in a row: the item is replaced. Only 403 means locked; 404 means deleted. */
const STUCK_AFTER = 3;
/** Inbox cards checked by id per tick (round robin), so a deleted card comes back within a few polls. */
const CARD_PROBES_PER_TICK = 4;
/** Item types that never belong to the game wherever they are (memes): listed by type every poll. */
const JUNK_TYPES = ["image", "embed", "document", "preview", "app_card"];
/** Junk deletions per tick at most (newest first); the rest go next tick. */
const JUNK_DELETES_PER_TICK = 20;
/** Fire/burnt fill writes re-read by id right before writing, per tick (the rest wait a tick). */
const RECHECK_MAX = 60;
const STICKY_TEXT_MAX = 2000;
const FIXTURE_STYLE: Record<FixtureKey, Partial<NewShape>> = {
  banner: { fill: COLORS.panel, fontSize: 28, textColor: COLORS.text },
  scoreboard: { fill: COLORS.panel, fontSize: 30, textColor: COLORS.text },
  leaderboard: { fill: COLORS.panel, fontSize: 16, textColor: COLORS.text, textAlign: "left", textAlignVertical: "top" },
};
const CARD_FILL = COLORS.panel;

/** Plain text, whitespace collapsed: how two versions of an item's text are compared. */
export const norm = (s: string | undefined) => stripHtml(String(s ?? "").slice(0, 50_000)).replace(/\s+/g, " ").trim();
/** Names and other student text going into HTML. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 200);
const intersects = (a: { x: number; y: number; w: number; h: number }, b: Box) =>
  a.x + a.w / 2 >= b.x && a.x - a.w / 2 <= b.x + b.w && a.y + a.h / 2 >= b.y && a.y - a.h / 2 <= b.y + b.h;

export interface RefereeOptions {
  now?: () => number;
  log?: (s: string) => void;
  /** Panels, titles, headers and the backdrop (config/layout.json): never inbox cards, never deleted. */
  staticIds?: Set<string>;
  /** Board writes in flight at once. */
  concurrency?: number;
  /** Preset teams: lowercased /join name or Miro display name -> team (config/teams.json). */
  presets?: Record<string, Team>;
  /** Grid frame ids, one per band of rows, so recreated squares go back in. Enables the fast read path. */
  frameIds?: string[];
  /** Orders frame ids (found by position when absent). */
  ordersIds?: Partial<Record<Team, string>>;
  /** Fire randomness. Seed it for a repeatable game. */
  rng?: Rng;
  /**
   * Rehearsal with one Miro account: each inbox card is its own player (keyed "card:<id>"), a paint
   * counts for the least-recently-painting player of the square's team, and a sticky's creator/answerer
   * are stand-ins from the right teams. Never use it in class: it trusts everyone.
   */
  rehearsal?: boolean;
  /** The referee token's Miro user id: its own writes echoed back are never judged as moves. Learnt from items it creates when absent. */
  selfId?: string;
  /** Hard cap on board write calls per tick (fire + reverts + repairs + cards + fixtures). */
  maxWritesPerTick?: number;
  /** Every judged paint, for logs and audits. */
  onPaint?: (ev: PaintEvent, d: Decision) => void;
}

export class Referee {
  cellList: CellDef[] = buildCells();
  cells = new Map<string, CellDef>(this.cellList.map((c) => [c.label, c]));
  byPos = new Map<string, CellDef>(this.cellList.map((c) => [`${c.col},${c.row}`, c]));
  cellId = new Map<string, string>();
  idCell = new Map<string, string>();
  shadow = new Map<string, Shadow>();
  inboxCard = new Map<string, string>(); // userId -> card id
  feedback = new Map<string, string[]>();
  seen = new Set<string>();
  stickies: StickyView[] = [];
  rules: RuleSet;
  rng: Rng;
  now: () => number;
  log: (s: string) => void;
  staticIds: Set<string>;
  rehearsal: boolean;
  /** Writes per tick, for the stress test and the CLI status line. */
  lastWrites = 0;
  maxWritesPerTick: number;
  private concurrency: number;
  private presets: Record<string, Team>;
  private memberNames: Record<string, string> | null = null;
  private written: Partial<Record<FixtureKey, string>> = {};
  private lastAdvanceAt: number | null = null;
  frameIds: string[];
  private ordersIds: Partial<Record<Team, string>>;
  private sweep: Promise<unknown> | null = null;
  private sweepResult: BoardItem[] | null = null;
  private sweepStartedAt = 0;
  // Non-square items, for the fast read path (a sweep can be older than our last write):
  private lastWriteAt = new Map<string, number>(); // when this referee last wrote their content
  private geomWriteAt = new Map<string, number>(); // ... their position or size
  private knownAt = new Map<string, number>(); // ... created them or first saw them
  // Robustness bookkeeping:
  private tickNo = 0;
  private writesThisTick = 0;
  private missing = new Map<string, number>(); // id or "frame:key" -> reads in a row it was missing
  private failures = new Map<string, { n: number; locked: number; next: number }>(); // op key -> consecutive failures (and 403s)
  private penalized = new Set<string>(); // "id@modifiedAt": one penalty per change, however long the repair takes
  private stale = new Map<string, number>(); // square id -> modifiedAt of a paint made while no referee watched
  private stuck = new Set<string>();
  private replaceCells = new Set<string>(); // labels whose square refuses writes
  private replacedCards = new Set<string>(); // owners whose card the referee recreated
  private createdIds = new Set<string>();
  private selfId?: string;
  private baseline = new Set<string>(); // items (and frames) on the board when this referee started
  private staticSnap = new Map<string, StaticSnap>();
  private reported = new Set<string>(); // one log line per lasting problem
  private fastOff = false;
  private placing = new Set<string>(); // cards placed this tick (their text goes with the placing write)
  private onPaint?: (ev: PaintEvent, d: Decision) => void;
  /** Ids Miro answered 404 for (or that we deleted): a slow full listing that began earlier may still show them. */
  private gone = new Set<string>();
  private goneThisTick = 0;
  /** Extra by-id reads this tick (fixtures, card probes, fire-write rechecks), for the status line and the sim. */
  readsThisTick = 0;
  lastReads = 0;
  /** Square label -> border we last wrote ("color/width"); the REST listing doesn't return borders. */
  private borderWritten = new Map<string, string>();
  /** Items read by id this tick (fixtures, probed cards): as fresh as the squares. */
  private freshIds = new Set<string>();
  private probeAt = 0;
  /** Question stickies the referee removed (spam, wrong frame, non-neighbour, over the cap). */
  private removedStickies = new Set<string>();

  constructor(
    public board: BoardAdapter,
    public game: GameFile,
    rules: RuleSet,
    opts: RefereeOptions = {},
  ) {
    this.rules = rules;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? console.log;
    this.staticIds = opts.staticIds ?? new Set();
    this.concurrency = opts.concurrency ?? 10;
    this.presets = opts.presets ?? {};
    this.frameIds = [...(game.frames?.length === 9 ? game.frames : (opts.frameIds ?? []))];
    this.ordersIds = { ...(opts.ordersIds ?? {}), ...(game.orders ?? {}) };
    this.rng = opts.rng ?? mulberry32(Date.now() % 2 ** 31);
    this.rehearsal = opts.rehearsal ?? false;
    this.selfId = this.rehearsal ? undefined : opts.selfId;
    this.maxWritesPerTick = opts.maxWritesPerTick ?? 120;
    this.onPaint = opts.onPaint;
    for (const id of game.stuck ?? []) this.stuck.add(id);
  }

  /** Who owns an inbox card: its creator, or in rehearsal the card itself. */
  private cardOwner(it: BoardItem): string {
    return this.rehearsal ? `card:${it.id}` : it.createdBy;
  }

  private isSelf(userId: string | undefined): boolean {
    return !!userId && !!this.selfId && userId === this.selfId;
  }

  private teamPlayers(team: Team): string[] {
    return Object.values(this.state.players).filter((p) => p.team === team).map((p) => p.userId);
  }

  /**
   * Rehearsal: a paint belongs to a member of the square's team, the one who painted least recently and is
   * off cooldown, not already used for another paint this tick (one shared account can't be told apart).
   */
  private painterOf(label: string, realUser: string, at = this.now(), used = new Set<string>(), fill = ""): string {
    if (!this.rehearsal) return realUser;
    const sector = this.cells.get(label)?.sector;
    // Orange in a neighbour's area: a member of a team attacking that area right now (the stand-in rule).
    const attackers = fill === STATE_COLOR.fire && sector ? [...new Set(this.state.attacks.filter((g) => g.to === sector && g.left > 0 && g.until > this.state.elapsed).map((g) => g.team))] : [];
    const ids = attackers.length ? attackers.flatMap((t) => this.teamPlayers(t)) : sector ? this.teamPlayers(sector) : [];
    if (!ids.length) return realUser;
    const last = this.state.lastPaintAt;
    const cool = this.rules.cooldownSeconds * 1000;
    const sorted = ids.sort((a, b) => (last[a] ?? -Infinity) - (last[b] ?? -Infinity));
    const ready = (u: string) => !used.has(u) && (last[u] === undefined || at - last[u]! >= cool) && !((this.state.timeoutUntil[u] ?? 0) > at);
    const pick = sorted.find(ready) ?? sorted.find((u) => !used.has(u)) ?? sorted[0]!;
    used.add(pick);
    return pick;
  }

  /** Every judged paint goes to the log: square, color, player, team, verdict and reason. */
  private logPaint(ev: PaintEvent, d: Decision) {
    const p = this.state.players[ev.userId];
    const who = p ? `${p.name} (${TEAM_INFO[p.team].name})` : `unjoined ${ev.userId || "?"}`;
    const reason = d.feedback.replace(/^\S+\s+/, "");
    this.log(`\npaint ${ev.label} ${ev.fill || "(no fill)"} by ${who}: ${d.accept ? "accepted" : `refused [${d.rule ?? "?"}]`} · ${reason}`);
  }

  get state(): GameState {
    return (this.game.state ??= createState(this.cellList, this.rules, this.rng));
  }

  fillOf(label: string): string {
    return STATE_COLOR[this.state.cells[label]!];
  }

  /**
   * A Miro timestamp we can trust: never missing, never in the future. A stamp from the future (Miro's
   * clock ahead of ours) is taken as "just after our previous read", the earliest it can have happened.
   */
  private when(ms: number, now: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return now;
    return ms > now ? Math.min(now, this.prevReadAt ?? now) : ms;
  }
  private prevReadAt: number | null = null;

  private learnSelf(items: BoardItem[]) {
    if (this.selfId || this.rehearsal || !this.createdIds.size) return;
    for (const it of items) {
      if (this.createdIds.has(it.id) && it.createdBy) {
        this.selfId = it.createdBy;
        return;
      }
    }
  }

  private persistIds() {
    this.game.cards = Object.fromEntries(this.inboxCard);
    if (this.frameIds.length === 9 && this.frameIds.every(Boolean)) this.game.frames = [...this.frameIds];
    this.game.orders = { ...this.ordersIds };
    this.game.stuck = [...this.stuck].slice(-500);
  }

  // ---------- discovery ----------
  private isFixtureShape(it: BoardItem, key: FixtureKey): boolean {
    const b = FIXTURES[key];
    return it.type === "shape" && inside(b, it.x, it.y) && it.w <= b.w * 1.15 && it.h <= b.h * 1.15 && it.w >= b.w * 0.5 && it.h >= b.h * 0.5;
  }

  private cellGeomOk(it: BoardItem, lab: string): boolean {
    const c = center(cellBox(this.cells.get(lab)!));
    return Math.abs(it.x - c.x) <= TOL && Math.abs(it.y - c.y) <= TOL && Math.abs(it.w - GRID.cell) <= TOL && Math.abs(it.h - GRID.cell) <= TOL && !it.rotation;
  }

  /** Map squares, fixtures, frames and inbox cards on the board. Creates any missing fixture. */
  async discover(): Promise<{ cells: number; missing: string[]; fixtures: string[] }> {
    const items = await this.board.listItems();
    this.cellId.clear();
    this.idCell.clear();
    this.stale.clear();
    this.baseline = new Set(items.map((i) => i.id));
    const fx = this.game.fixtureIds;
    const present = new Set(items.map((i) => i.id));
    for (const key of FIXTURE_KEYS) if (fx[key] && (!present.has(fx[key]!) || this.stuck.has(fx[key]!))) delete fx[key]; // stale (board rebuilt) or locked
    const state = this.state;
    await this.discoverFrames();
    // Squares: when a label appears twice (a vandal's copy, a locked old square), keep the one in the right
    // place that is not stuck, oldest first (copies come later).
    const candidates = new Map<string, BoardItem[]>();
    for (const it of items) {
      const pendingJoin = this.isInboxCard(it) && !state.players[this.cardOwner(it)] && !Object.values(this.game.cards ?? {}).includes(it.id);
      if (!pendingJoin) this.seen.add(it.id);
      if (it.type !== "shape" || this.staticIds.has(it.id) || this.stuck.has(it.id)) continue;
      const text = norm(it.content);
      if (parseLabel(text) && inside(GRID_BOX, it.x, it.y) && it.w < GRID.pitch * 2) {
        const lab = text.toUpperCase();
        if (!this.cells.has(lab)) continue;
        candidates.set(lab, [...(candidates.get(lab) ?? []), it]);
      }
    }
    for (const [lab, list] of candidates) {
      const best = list.sort((a, b) => Number(this.cellGeomOk(b, lab)) - Number(this.cellGeomOk(a, lab)) || a.createdAt - b.createdAt)[0]!;
      this.cellId.set(lab, best.id);
      this.idCell.set(best.id, lab);
      this.setCellShadow(lab, this.fillOf(lab));
      // Borders aren't in the listing: assume the normal one is there, rewrite a team-colored one once.
      const o = this.state.origin?.[lab];
      if (!o || o === "wild") this.borderWritten.set(lab, `${this.strokeFor(lab).color}/${this.strokeFor(lab).width}`);
      // A square whose fill differs from the engine was painted (or vandalised) while no referee watched.
      if ((best.fill ?? "").toLowerCase() !== this.fillOf(lab)) this.stale.set(best.id, best.modifiedAt);
    }
    for (const it of items) {
      if (this.idCell.has(it.id) || this.staticIds.has(it.id)) continue;
      for (const key of FIXTURE_KEYS) {
        if (!fx[key] && !this.stuck.has(it.id) && this.isFixtureShape(it, key) && !Object.values(fx).includes(it.id)) fx[key] = it.id;
      }
    }
    const created: FixtureKey[] = [];
    for (const key of FIXTURE_KEYS) {
      if (fx[key]) continue;
      try {
        const [id] = await this.board.createShapes([this.fixtureShape(key, "")]);
        fx[key] = id!;
        this.createdIds.add(id!);
        this.seen.add(id!);
        this.knownAt.set(id!, this.now());
        created.push(key);
      } catch (e) {
        this.log(`creating the ${key} failed (${errMsg(e)}); the next tick tries again`);
      }
    }
    for (const key of FIXTURE_KEYS) {
      if (!fx[key]) continue;
      const it = items.find((i) => i.id === fx[key]);
      // An existing fixture keeps its own geometry (the MCP-built board places the leaderboard a few units
      // off FIXTURES.leaderboard); only a fixture the referee just created uses the FIXTURES box.
      const box = it && intersects(it, FIXTURES[key]) ? { x: it.x, y: it.y, w: it.w, h: it.h } : { ...center(FIXTURES[key]), w: FIXTURES[key].w, h: FIXTURES[key].h };
      this.shadow.set(fx[key]!, { content: it ? norm(it.content) : "", fill: FIXTURE_STYLE[key].fill, ...box });
      (this.game.fixtureBoxes ??= {})[key] = { ...box };
      if (it && it.fill?.toLowerCase() !== FIXTURE_STYLE[key].fill) this.shadow.get(fx[key]!)!.fill = it.fill ?? FIXTURE_STYLE[key].fill; // keep the board's own style
    }
    if (created.length) this.log(`created missing fixtures: ${created.join(", ")}`);
    // Inbox cards: the saved map first (it knows cards the referee recreated), then each player's own card.
    const savedCards = this.game.cards ?? {};
    for (const [owner, id] of Object.entries(savedCards)) {
      const it = items.find((i) => i.id === id);
      if (it && state.players[owner]) this.trackCard(owner, it);
    }
    for (const it of items) {
      const owner = this.cardOwner(it);
      if (this.isInboxCard(it) && state.players[owner] && !this.inboxCard.has(owner)) this.trackCard(owner, it);
    }
    for (const id of this.staticIds) {
      const it = items.find((i) => i.id === id);
      if (it) this.staticSnap.set(id, { content: norm(it.content), raw: it.content, type: it.type, fill: it.fill, x: it.x, y: it.y, w: it.w, h: it.h });
    }
    this.stickies = this.readStickies(items);
    this.learnSelf(items);
    this.persistIds();
    const missing = [...this.cells.keys()].filter((l) => !this.cellId.has(l));
    return { cells: this.cellId.size, missing, fixtures: FIXTURE_KEYS.filter((k) => fx[k]) };
  }

  private trackCard(owner: string, it: BoardItem) {
    this.inboxCard.set(owner, it.id);
    this.seen.add(it.id);
    this.shadow.set(it.id, { content: norm(it.content), fill: it.type === "sticky_note" ? undefined : it.fill, x: it.x, y: it.y, w: it.w, h: it.h });
  }

  /** Grid band and Orders frames: by saved id, else by where they sit. */
  private async discoverFrames() {
    if (!this.board.listFrames) return;
    let frames: BoardItem[];
    try {
      frames = await this.board.listFrames();
    } catch {
      return;
    }
    for (const f of frames) this.baseline.add(f.id);
    const ids = new Set(frames.map((f) => f.id));
    const near = (f: BoardItem, b: Box) => Math.abs(f.x - (b.x + b.w / 2)) < 8 && Math.abs(f.y - (b.y + b.h / 2)) < 8 && Math.abs(f.w - b.w) < 16;
    frameBoxes().forEach((b, i) => {
      if (this.frameIds[i] && ids.has(this.frameIds[i]!)) return;
      const m = frames.find((f) => near(f, b));
      if (m) this.frameIds[i] = m.id;
    });
    for (const t of TEAMS) {
      if (this.ordersIds[t] && ids.has(this.ordersIds[t]!)) continue;
      const m = frames.find((f) => near(f, ORDERS[t]));
      if (m) this.ordersIds[t] = m.id;
    }
    this.board.setGridFrames?.(this.frameIds);
  }

  /** Recreate every grid square that is missing from the board, in batches (startup: not capped). */
  async rebuildMissing(): Promise<number> {
    const ops = this.rebuildOps();
    const before = this.cellId.size;
    for (const op of ops) {
      try {
        await op.run();
        op.ok?.();
      } catch (e) {
        this.log(`rebuild failed (${errMsg(e)}); the referee tries again every tick`);
      }
    }
    const n = this.cellId.size - before;
    if (n) this.log(`rebuilt ${n} missing squares`);
    return n;
  }

  private setCellShadow(label: string, fill: string) {
    const cell = this.cells.get(label)!;
    const id = this.cellId.get(label)!;
    const c = center(cellBox(cell));
    this.shadow.set(id, { content: label, fill, x: c.x, y: c.y, w: GRID.cell, h: GRID.cell });
  }

  // ---------- setup commands ----------
  /** A new game: starting colors, empty Inbox and Orders frames, no players. */
  async reset(): Promise<{ repainted: number; deleted: number }> {
    if (!this.cellId.size) await this.discover();
    this.game.state = createState(this.cellList, this.rules, this.rng);
    this.game.cards = {};
    this.game.slots = {};
    const items = await this.board.listItems();
    const fixtureIds = new Set(Object.values(this.game.fixtureIds));
    const writes: (() => Promise<unknown>)[] = [];
    let repainted = 0;
    let deleted = 0;
    for (const it of items) {
      const lab = this.idCell.get(it.id);
      if (lab) {
        const cell = this.cells.get(lab)!;
        const fill = startFill(cell);
        const c = center(cellBox(cell));
        if ((it.fill ?? "").toLowerCase() !== fill || !this.cellGeomOk(it, lab) || norm(it.content) !== lab) {
          const st = cellStroke(cell);
          writes.push(() => this.board.updateShape(it.id, { fill, textColor: textColorFor(startState(cell)), borderColor: st.color, borderWidth: st.width, content: lab, ...c, w: GRID.cell, h: GRID.cell, rotation: 0 }));
          repainted++;
        } else if (this.borderWritten.get(lab) !== `${cellStroke(cell).color}/${cellStroke(cell).width}`) {
          const st = cellStroke(cell);
          writes.push(() => this.board.updateShape(it.id, { borderColor: st.color, borderWidth: st.width }));
        }
        this.borderWritten.set(lab, `${cellStroke(cell).color}/${cellStroke(cell).width}`);
        this.setCellShadow(lab, fill);
        continue;
      }
      if (fixtureIds.has(it.id) || this.staticIds.has(it.id)) continue;
      const junk = this.isInboxCard(it) || (it.type === "sticky_note" && ordersTeamAt(it.x, it.y)) || this.isJunk(it);
      if (junk) {
        writes.push(() => this.board.deleteItem(it.id));
        this.shadow.delete(it.id);
        deleted++;
      }
    }
    await pool(writes.map((w) => () => w().catch((e: Error) => this.log(`reset write failed: ${errMsg(e)}`))), this.concurrency);
    for (const id of [...this.shadow.keys()]) if (!this.idCell.has(id) && !fixtureIds.has(id)) this.shadow.delete(id);
    this.inboxCard.clear();
    this.feedback.clear();
    this.stickies = [];
    this.written = {};
    this.replacedCards.clear();
    this.persistIds();
    await this.updateBoards("🔥 WILDFIRE · waiting for the referee");
    this.seen = new Set((await this.board.listItems()).map((i) => i.id));
    return { repainted, deleted };
  }

  /** Start the fire spreading (from the lobby). A game already live or over is left as it is. */
  async start(): Promise<void> {
    const lit = startGame(this.state, this.rules, this.now());
    this.lastAdvanceAt = this.now();
    if (!lit.length) return;
    this.log("the fire is loose");
    this.writesThisTick = 0;
    await this.execute(this.cellOps(new Set(lit)), Infinity);
    await this.updateBoards();
  }

  /** The instructor ends the game now: highest % wins. */
  async stop(): Promise<void> {
    stopGame(this.state, this.cellList, this.now());
    await this.updateBoards();
  }

  /** Shown while no referee is running, so agents wait instead of painting into the void. */
  async pause(): Promise<void> {
    if (this.state.phase !== "over") await this.writeFixture("banner", "<p>⏸ PAUSED · the fire is frozen</p><p>wait for the referee</p>");
  }

  // ---------- the loop ----------
  private fastPath(): boolean {
    return !!this.board.listGridItems && !this.fastOff && this.frameIds.length === 9 && this.frameIds.every(Boolean);
  }

  /** Squares are always fresh; `full` says whether the rest of the board is in `items` too. */
  private async readBoard(): Promise<{ items: BoardItem[]; full: boolean; since: number }> {
    const r = await this.readBoardRaw();
    if (this.gone.size) r.items = r.items.filter((i) => !this.gone.has(i?.id));
    return r;
  }

  private async readBoardRaw(): Promise<{ items: BoardItem[]; full: boolean; since: number }> {
    if (!this.fastPath()) return { items: await this.board.listItems(), full: true, since: Infinity };
    if (!this.sweep) {
      this.sweepStartedAt = this.now();
      this.sweep = this.board
        .listItems()
        .then((r) => (this.sweepResult = r))
        .catch((e: Error) => {
          this.log(`sweep failed: ${errMsg(e)}`);
          this.sweep = null;
        });
    }
    let cells: BoardItem[];
    try {
      cells = await this.board.listGridItems!();
    } catch (e) {
      // A grid frame was deleted (404) or Miro hiccuped: one slow full read instead, which also repairs frames.
      this.log(`fast read failed (${errMsg(e)}); reading the whole board`);
      return { items: await this.board.listItems(), full: true, since: Infinity };
    }
    if (!this.sweepResult) return { items: cells, full: false, since: 0 };
    const gridIds = new Set(cells.map((c) => c.id));
    const rest = this.sweepResult.filter((i) => !gridIds.has(i.id) && !this.idCell.has(i.id) && !this.frameIds.includes(i.parentId ?? ""));
    const since = this.sweepStartedAt;
    this.sweepResult = null;
    this.sweep = null;
    return { items: [...cells, ...rest], full: true, since };
  }

  private touch(id: string, geometry = false) {
    this.lastWriteAt.set(id, this.now());
    if (geometry) this.geomWriteAt.set(id, this.now());
  }

  private readStickies(items: BoardItem[]): StickyView[] {
    const out: StickyView[] = [];
    for (const it of items) {
      if (it.type !== "sticky_note") continue;
      const team = ordersTeamAt(it.x, it.y);
      if (!team || this.staticIds.has(it.id) || this.removedStickies.has(it.id)) continue;
      // A giant sticky costs nothing: only its start is read.
      const text = stripHtml(String(it.content ?? "").slice(0, STICKY_TEXT_MAX * 4)).slice(0, STICKY_TEXT_MAX).split("\n").map((l) => l.slice(0, 200)).slice(0, 20).join("\n");
      out.push({ id: it.id, team, text, createdAt: it.createdAt, ...this.stickyPeople(team, text, it) });
    }
    return out;
  }

  /**
   * Rehearsal: the creator is the boss of the frame's team (who asks the question), and once the sticky
   * carries a YES/NO line the answerer is another member of that team.
   */
  private stickyPeople(team: Team, text: string, it: BoardItem): { createdBy: string; modifiedBy: string } {
    if (!this.rehearsal) return { createdBy: it.createdBy, modifiedBy: it.modifiedBy };
    const posters = this.teamPlayers(team);
    const createdBy = posters.find((u) => this.state.players[u]?.role === "boss") ?? posters[0] ?? it.createdBy;
    const answered = text.split("\n").slice(1).some((l) => /^(YES|NO)$/i.test(l.trim()));
    const answerer = this.teamPlayers(team).find((u) => u !== createdBy);
    return { createdBy, modifiedBy: answered && answerer ? answerer : createdBy };
  }

  /** One penalty per change (id + modification time), however many ticks its repair takes. */
  private penalize(tampers: TamperEvent[], userId: string, what: TamperEvent["what"], target: string, key: string, at: number) {
    if (!userId || this.isSelf(userId)) return;
    const k = `${key}@${at}`;
    if (this.penalized.has(k)) return;
    this.penalized.add(k);
    tampers.push({ userId, what, target, at });
  }

  async tick(): Promise<TickResult> {
    this.tickNo++;
    this.writesThisTick = 0;
    this.readsThisTick = 0;
    this.placing.clear();
    try {
      return await this.tickInner();
    } catch (e) {
      // Last line of defence: a bug or a board shape nobody foresaw must not stop the game.
      this.log(`tick error (the game goes on): ${errMsg(e)}`);
      return { paints: 0, tampers: 0, joins: 0, fire: this.burning(), changed: 0, writes: this.writesThisTick, deferred: 0, error: errMsg(e) };
    } finally {
      this.lastWrites = this.writesThisTick;
      this.lastReads = this.readsThisTick;
      this.persistIds();
    }
  }

  private burning(): number {
    return Object.values(this.state.cells).filter((s) => s === "fire").length;
  }

  private async tickInner(): Promise<TickResult> {
    const state = this.state;
    let read: { items: BoardItem[]; full: boolean; since: number };
    try {
      read = await this.readBoard();
    } catch (e) {
      // Miro is down or rate limiting: judge nothing, write nothing; game time waits (capped catch-up next tick).
      this.log(`board read failed (${errMsg(e)}); trying again next tick`);
      return { paints: 0, tampers: 0, joins: 0, fire: this.burning(), changed: 0, writes: 0, deferred: 0, skipped: true };
    }
    const { items, full, since } = read;
    const now = this.now();
    this.goneThisTick = 0;
    this.learnSelf(items);
    const byId = new Map<string, BoardItem>();
    for (const i of items) if (i && typeof i.id === "string") byId.set(i.id, i);
    // The fixtures (and a few cards) read by id now: a slow full listing may be many seconds old.
    await this.readById(byId);
    // Squares and items read by id are always fresh. Anything else only when the sweep began after we last touched that aspect of it.
    const fresh = (m: Map<string, number>, id: string) => this.idCell.has(id) || this.freshIds.has(id) || (full && (m.get(id) ?? -Infinity) < since);
    const paints: (PaintEvent & { stale?: boolean })[] = [];
    const tampers: TamperEvent[] = [];
    const ops: Op[] = [];
    let joins = 0;
    // Memes: images (and embeds, documents...) anywhere on the board, by a cheap type-filtered listing every poll.
    const junk = new Map<string, { at: number; it: BoardItem }>();
    await this.scanTypedJunk(junk, tampers, now);

    const fixtureKeyOf = (id: string) => FIXTURE_KEYS.find((k) => this.game.fixtureIds[k] === id);
    const cardOwnerOf = (id: string) => [...this.inboxCard].find(([, cid]) => cid === id)?.[0];

    // 0. frames (full reads): grid bands and Orders frames moved, resized or deleted
    const framesOff = full ? await this.guardFrames(tampers, since) : new Set<string>();

    // 1. tracked items that vanished (confirmed on a second read: a partial page is not a delete)
    for (const [id] of [...this.shadow]) {
      if (byId.has(id)) {
        this.missing.delete(id);
        continue;
      }
      if (!fresh(this.knownAt, id)) continue;
      const n = (this.missing.get(id) ?? 0) + 1;
      this.missing.set(id, n);
      if (n < MISSING_READS) continue;
      this.missing.delete(id);
      this.shadow.delete(id);
      const lab = this.idCell.get(id);
      if (lab) {
        this.idCell.delete(id);
        this.cellId.delete(lab); // rebuilt below, in batches
        tampers.push({ userId: "unknown", what: "deleted", target: lab, at: now });
        continue;
      }
      const fxKey = fixtureKeyOf(id);
      if (fxKey) {
        delete this.game.fixtureIds[fxKey]; // recreated below
        this.written[fxKey] = undefined;
        tampers.push({ userId: "unknown", what: "deleted", target: `the ${fxKey}`, at: now });
        continue;
      }
      const owner = cardOwnerOf(id);
      if (owner) {
        this.inboxCard.delete(owner);
        // A player's card is recreated so the reasons keep showing; their own next card replaces it.
        if (state.players[owner]) this.replacedCards.add(owner);
      }
    }

    // 2. squares + fixtures + inbox cards: diff against the shadow
    const readFill = new Map<string, string>(); // label -> fill in this tick's read
    const preFill = new Map<string, string>(); // label -> what the engine last wrote/saw there
    const judged = new Set<string>(); // labels whose change this tick is judged (a paint) or our own echo
    for (const [id, sh] of [...this.shadow]) {
      const it = byId.get(id);
      if (!it) continue;
      const lab = this.idCell.get(id);
      if (lab) {
        readFill.set(lab, (it.fill ?? "").toLowerCase());
        preFill.set(lab, (sh.fill ?? "").toLowerCase());
        const cell = this.cells.get(lab)!;
        const bandOff = it.parentId ? framesOff.has(it.parentId) : framesOff.has(this.frameIds[frameOfRow(cell.row)] ?? "");
        const sizeOff = Math.abs(it.w - sh.w) > TOL || Math.abs(it.h - sh.h) > TOL;
        const moved = !bandOff && (Math.abs(it.x - sh.x) > TOL || Math.abs(it.y - sh.y) > TOL);
        const rotated = !!it.rotation && Math.abs(it.rotation % 360) > 0.5;
        const contentOff = norm(it.content) !== lab;
        if (moved || sizeOff || rotated || contentOff) {
          // Replace rather than move back (Miro refuses moves out of a frame); the old one is deleted.
          const what = contentOff ? "edited" : sizeOff ? "resized" : rotated ? "rotated" : "moved";
          this.penalize(tampers, it.modifiedBy, what, lab, id, this.when(it.modifiedAt, now));
          this.retireCell(lab, id, ops);
          continue;
        }
        const bf = (it.fill ?? "").toLowerCase();
        if (bf === (sh.fill ?? "").toLowerCase()) continue;
        sh.fill = bf; // what the board shows now; reconciliation below brings it back to the engine
        judged.add(lab);
        if (bf === this.fillOf(lab) || this.isSelf(it.modifiedBy)) continue; // already right, or our own write echoed back
        const staleAt = this.stale.get(id);
        paints.push({ label: lab, fill: bf, userId: it.modifiedBy, at: this.when(it.modifiedAt, now), batchId: this.tickNo, stale: staleAt !== undefined && staleAt === it.modifiedAt });
        continue;
      }
      const fxKey = fixtureKeyOf(id);
      const owner = fxKey ? undefined : cardOwnerOf(id);
      if (!fxKey && !owner) continue;
      const geomOff =
        fresh(this.geomWriteAt, id) && (Math.abs(it.x - sh.x) > TOL || Math.abs(it.y - sh.y) > TOL || Math.abs(it.w - sh.w) > TOL || Math.abs(it.h - sh.h) > TOL || !!it.rotation);
      const textFresh = fresh(this.lastWriteAt, id);
      const contentOff = textFresh && norm(it.content) !== sh.content;
      const fillOff = textFresh && sh.fill !== undefined && (it.fill ?? "").toLowerCase() !== sh.fill.toLowerCase();
      if (!geomOff && !contentOff && !fillOff) continue;
      if (contentOff) {
        sh.content = norm(it.content); // what is there now; the refresh below writes the right text back
        if (fxKey) this.written[fxKey] = undefined;
      }
      if (this.isSelf(it.modifiedBy) && !geomOff && !fillOff) continue; // Miro reformatted our own text: the refresh settles it
      const target = fxKey ? `the ${fxKey}` : owner && owner !== it.modifiedBy ? "someone else's inbox card" : "your inbox card";
      this.penalize(tampers, it.modifiedBy, contentOff ? "edited" : geomOff ? (it.rotation ? "rotated" : "moved") : "edited", target, id, this.when(it.modifiedAt, now));
      if (geomOff || fillOff) {
        ops.push({
          key: `restore:${id}`,
          id,
          prio: 1,
          run: () => this.board.updateShape(id, { fill: sh.fill, x: sh.x, y: sh.y, w: sh.w, h: sh.h, ...(it.rotation ? { rotation: 0 } : {}) }),
          ok: () => this.touch(id, true),
          fail: (_e, n) => fxKey && n >= STUCK_AFTER && this.retireFixture(fxKey, id),
        });
      }
    }

    // 3. everything else on a full read: new inbox cards (= joins), junk on the forest, static items
    if (full) {
      for (const it of items) {
        if (this.idCell.has(it.id) || this.shadow.has(it.id)) continue;
        const firstSight = !this.seen.has(it.id);
        this.seen.add(it.id);
        if (this.staticIds.has(it.id)) continue;
        if (firstSight && this.isInboxCard(it) && !this.stuck.has(it.id)) {
          joins += await this.newCard(it, ops);
          continue;
        }
        if (!this.isJunk(it)) continue;
        // Junk on the forest, the fixtures, a panel or an Orders frame: removed (retried with backoff while it is locked).
        if (!this.stuck.has(it.id) && !this.createdIds.has(it.id)) {
          const who = parseLabel(norm(it.content)) && it.w < 2 * GRID.pitch ? it.modifiedBy : it.createdBy;
          this.penalize(tampers, who, "added", this.junkWhat(it), it.id, this.when(it.createdAt, now));
        }
        junk.set(it.id, { at: it.createdAt || 0, it });
      }
      this.guardStatics(byId, fresh, tampers, ops, now);
    }

    // Junk deletions: newest first, at most JUNK_DELETES_PER_TICK per tick (the rest next tick).
    const doomed = [...junk.values()].sort((a, b) => b.at - a.at);
    for (const { it } of doomed.slice(0, JUNK_DELETES_PER_TICK)) ops.push({ key: `junk:${it.id}`, prio: 4, run: () => this.board.deleteItem(it.id), ok: () => this.stuck.delete(it.id) });

    // 4. approvals: sticky notes in the Orders frames (full reads only)
    if (full) {
      this.stickies = this.readStickies(items);
      if (!this.rehearsal) this.policeQuestions(ops);
      for (const s of this.stickies) {
        try {
          for (const n of judgeSticky(state, this.rules, s)) this.pushFeedback(n.userId, n.line);
        } catch (e) {
          this.log(`sticky ${s.id} skipped: ${errMsg(e)}`);
        }
      }
    }

    // 5. paints, in time order (many paints by one player in one poll: the first counts, the rest wait the cooldown)
    paints.sort((a, b) => a.at - b.at);
    const usedStandIns = new Set<string>();
    for (const ev of paints) {
      // Rehearsal: the stand-in painter is picked now, after the earlier paints of this tick were judged.
      ev.userId = this.painterOf(ev.label, ev.userId, ev.at, usedStandIns, ev.fill);
      if (ev.stale) {
        this.stale.delete(this.cellId.get(ev.label) ?? "");
        this.pushFeedback(ev.userId, `⏸ ${ev.label} undone: no referee was watching.`);
        this.logPaint(ev, { accept: false, feedback: "undone: no referee was watching (painted while the referee was off)" });
        continue;
      }
      const d = decidePaint(state, this.rules, this.cells, ev);
      if (d.accept) {
        const sh = this.shadow.get(this.cellId.get(ev.label) ?? "");
        if (sh) sh.fill = ev.fill; // the player's paint is already on the board
      }
      this.logPaint(ev, d);
      this.onPaint?.(ev, d);
      if (d.feedback) this.pushFeedback(ev.userId, d.feedback);
    }
    this.stale.clear(); // only the first look after a restart can tell an unwatched paint
    for (const t of tampers) {
      if (t.userId === "unknown") {
        this.log(`\nput back: ${t.target} (${t.what})`);
        continue;
      }
      this.pushFeedback(t.userId, (t.what === "added" ? decideJunk(state, { userId: t.userId, what: t.target, at: t.at }) : decideTamper(state, this.rules, t)).feedback);
    }

    // 6. the fire: game time moves on (spread, burn-out, lightning, attacks running out, the end)
    const dt = this.lastAdvanceAt === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - this.lastAdvanceAt));
    this.lastAdvanceAt = now;
    const adv = advance(state, this.rules, this.cellList, this.byPos, this.rng, dt, now);
    for (const e of adv.events) this.log(`\n${e}`);
    for (const g of adv.ended) {
      for (const u of this.teamPlayers(g.team)) this.pushFeedback(u, `⌛ Your attack on ${teamName(g.to)}'s area is over: paint blue in your team's area again.`);
    }

    // 7. plan every write (board vs engine) and run what fits in this tick; one refused write never stalls the game.
    // A square is written only when this tick's read showed it as the engine last wrote/saw it, or its change
    // was judged above: a player's newer blue is never overwritten by a fire change planned on an older look.
    const writable = (lab: string) => readFill.has(lab) && (judged.has(lab) || readFill.get(lab) === preFill.get(lab));
    ops.push(...(await this.recheckFireWrites(this.cellOps(new Set(adv.changed), writable), readFill)), ...this.rebuildOps(), ...this.fixtureOps(), ...this.cardOps());
    let { deferred } = await this.execute(ops);
    // Miro said 404 (deleted) for something: rebuild it now, not on a later tick.
    if (this.goneThisTick) deferred += (await this.execute([...this.rebuildOps(), ...this.fixtureOps(), ...this.cardOps()])).deferred;
    this.prevReadAt = now;
    return { paints: paints.length, tampers: tampers.length, joins, fire: this.burning(), changed: adv.changed.length, writes: this.writesThisTick, reads: this.readsThisTick, deferred };
  }

  /** Something that does not belong where it is: on the forest or over a fixture. */
  private isJunk(it: BoardItem): boolean {
    if (this.idCell.has(it.id) || this.staticIds.has(it.id) || Object.values(this.game.fixtureIds).includes(it.id)) return false;
    if ([...this.inboxCard.values()].includes(it.id)) return false;
    if (it.type === "sticky_note" && ordersTeamAt(it.x, it.y)) return false;
    const w = Math.max(0, it.w || 0);
    const h = Math.max(0, it.h || 0);
    const onGrid = intersects({ x: it.x, y: it.y, w, h }, GRID_BOX);
    const onFixture = FIXTURE_KEYS.some((k) => intersects({ x: it.x, y: it.y, w, h }, FIXTURES[k]));
    if (this.stuck.has(it.id)) return true;
    if (JUNK_TYPES.includes(it.type) && this.isMeme(it)) return true;
    // New items on a panel (title, rules, leaderboard) or in an Orders frame (anything but a sticky): junk.
    const onPanel = [PANELS.title, PANELS.rules, PANELS.leaderboard].some((b) => inside(b, it.x, it.y));
    const inOrders = !!ordersTeamAt(it.x, it.y) && it.type !== "sticky_note";
    if ((onPanel || inOrders) && !this.baseline.has(it.id) && !this.createdIds.has(it.id) && !this.isSelf(it.createdBy)) return true;
    // An untracked copy of a square (dragged out of its frame, a vandal's fake) goes wherever it is.
    if (it.type === "shape" && parseLabel(norm(it.content)) && w < 2 * GRID.pitch && h < 2 * GRID.pitch) return true;
    if (!onGrid && !onFixture) return false;
    // A big item that was already there when the referee started may be the board's own decoration (a
    // backdrop, an area band); anything small, anything new, or any untracked copy of a square goes.
    const small = w <= 400 && h <= 400;
    return small || !this.baseline.has(it.id);
  }

  /** An image/embed/document that isn't the board's own: anything not static, not ours, not there at the start (unless a player put it there). */
  private isMeme(it: BoardItem): boolean {
    if (this.staticIds.has(it.id) || this.createdIds.has(it.id) || this.isSelf(it.createdBy) || this.gone.has(it.id)) return false;
    if (this.baseline.has(it.id) && !this.state.players[it.createdBy]) return false; // decoration from the board build
    return true;
  }

  /** What a junk item is, for the inbox line ("image", "item on the forest"). */
  private junkWhat(it: BoardItem): string {
    if (JUNK_TYPES.includes(it.type)) return it.type === "image" ? "image" : it.type.replace("_", " ");
    const box = { x: it.x, y: it.y, w: Math.max(0, it.w || 0), h: Math.max(0, it.h || 0) };
    if (intersects(box, GRID_BOX)) return "item on the forest";
    if (FIXTURE_KEYS.some((k) => intersects(box, FIXTURES[k]))) return "item on the banner";
    if (ordersTeamAt(it.x, it.y)) return "item in the Orders";
    return "item on a panel";
  }

  /** Every poll: images, embeds, documents, previews anywhere on the board (one cheap listing per type). */
  private async scanTypedJunk(junk: Map<string, { at: number; it: BoardItem }>, tampers: TamperEvent[], now: number) {
    if (!this.board.listByType) return;
    let items: BoardItem[];
    this.readsThisTick += JUNK_TYPES.length;
    try {
      items = await this.board.listByType(JUNK_TYPES);
    } catch {
      return; // next poll
    }
    for (const it of items) {
      if (!it || !this.isMeme(it)) continue;
      this.seen.add(it.id);
      if (!this.stuck.has(it.id)) this.penalize(tampers, it.createdBy, "added", this.junkWhat(it), it.id, this.when(it.createdAt, now));
      junk.set(it.id, { at: it.createdAt || 0, it });
    }
  }

  /** Static items (panels, title, rules, headers): edits and moves are put back; deletes are logged (rebuild between games). */
  private guardStatics(byId: Map<string, BoardItem>, fresh: (m: Map<string, number>, id: string) => boolean, tampers: TamperEvent[], ops: Op[], now: number) {
    for (const [id, snap] of this.staticSnap) {
      const it = byId.get(id);
      if (!it) {
        if (!this.reported.has(`static:${id}`)) {
          this.reported.add(`static:${id}`);
          this.log(`\nstatic ${snap.type} ${id} ("${snap.content.slice(0, 30)}") was deleted; it can't be rebuilt mid-game without covering the forest. Rebuild the board between games.`);
        }
        continue;
      }
      const geomOff = fresh(this.geomWriteAt, id) && (Math.abs(it.x - snap.x) > TOL || Math.abs(it.y - snap.y) > TOL || Math.abs(it.w - snap.w) > TOL || (snap.type !== "text" && Math.abs(it.h - snap.h) > TOL) || !!it.rotation);
      const textOff = fresh(this.lastWriteAt, id) && (norm(it.content) !== snap.content || (snap.type === "shape" && (it.fill ?? "") !== (snap.fill ?? "")));
      if (!geomOff && !textOff) continue;
      if (this.isSelf(it.modifiedBy)) continue;
      this.penalize(tampers, it.modifiedBy, textOff ? "edited" : "moved", "a board panel", id, this.when(it.modifiedAt, now));
      ops.push({
        key: `static:${id}`,
        id,
        gone: () => {
          this.gone.add(id);
          this.log(`\nstatic ${snap.type} ${id} ("${snap.content.slice(0, 30)}") was deleted; it can't be rebuilt mid-game without covering the forest. Rebuild the board between games.`);
          this.reported.add(`static:${id}`);
          this.staticSnap.delete(id);
        },
        prio: 4,
        run: () =>
          this.board.updateShape(id, {
            ...(textOff ? { content: snap.raw, ...(snap.type === "shape" && snap.fill ? { fill: snap.fill } : {}) } : {}),
            x: snap.x,
            y: snap.y,
            ...(snap.type === "text" ? {} : { w: snap.w, h: snap.h }),
            ...(it.rotation ? { rotation: 0 } : {}),
          }),
        ok: () => this.touch(id, true),
      });
    }
  }

  /** Grid bands and Orders frames: moved/resized are put back (their squares move with them), deleted are recreated. */
  private async guardFrames(tampers: TamperEvent[], since: number): Promise<Set<string>> {
    const off = new Set<string>();
    if (!this.board.listFrames) return off;
    let frames: BoardItem[];
    try {
      frames = await this.board.listFrames();
    } catch {
      return off;
    }
    const byId = new Map(frames.map((f) => [f.id, f]));
    const guarded: { key: string; box: Box; fill: string; title: string; get: () => string | undefined; set: (id: string) => void }[] = [
      ...frameBoxes().map((box, i) => ({ key: `band${i}`, box, fill: COLORS.frame, title: "", get: () => this.frameIds[i], set: (id: string) => (this.frameIds[i] = id) })),
      ...TEAMS.map((t) => ({ key: `orders:${t}`, box: ORDERS[t], fill: COLORS.panel, title: ordersTitle(t), get: () => this.ordersIds[t], set: (id: string) => (this.ordersIds[t] = id) })),
    ];
    if (!guarded.some((g) => g.get())) return off; // a board without guarded frames (tests, an old board)
    const ops: Op[] = [];
    let gridChanged = false;
    for (const g of guarded) {
      const id = g.get();
      const f = id ? byId.get(id) : undefined;
      const c = center(g.box);
      if (!f) {
        if (!id) continue;
        const n = (this.missing.get(`frame:${g.key}`) ?? 0) + 1;
        this.missing.set(`frame:${g.key}`, n);
        if (n < MISSING_READS) continue;
        if (!this.board.createFrame) {
          if (!this.reported.has(`frame:${g.key}`)) this.log(`\nframe ${g.key} was deleted and this board adapter can't recreate frames: reading the whole board from now on`);
          this.reported.add(`frame:${g.key}`);
          this.fastOff = true;
          continue;
        }
        ops.push({
          key: `frame:${g.key}`,
          prio: -1,
          run: async () => {
            const nid = await this.board.createFrame!(g.box, g.fill, g.title);
            g.set(nid);
            this.createdIds.add(nid);
            this.baseline.add(nid);
            this.missing.delete(`frame:${g.key}`);
            if (g.key.startsWith("band")) gridChanged = true;
          },
        });
        if (n === MISSING_READS) tampers.push({ userId: "unknown", what: "deleted", target: g.key.startsWith("band") ? "a row of the forest" : "an Orders frame", at: this.now() });
        continue;
      }
      this.missing.delete(`frame:${g.key}`);
      const bad = Math.abs(f.x - c.x) > 4 || Math.abs(f.y - c.y) > 4 || Math.abs(f.w - g.box.w) > 4 || Math.abs(f.h - g.box.h) > 4;
      // Not judged on a sweep older than our own last move of it (fast reads).
      if (!bad || (this.geomWriteAt.get(f.id) ?? -Infinity) >= since) continue;
      off.add(f.id);
      if (!this.board.updateFrame) continue;
      this.penalize(tampers, f.modifiedBy, "moved", g.key.startsWith("band") ? "a row of the forest" : "an Orders frame", f.id, f.modifiedAt);
      ops.push({
        key: `frame:${g.key}`,
        id: f.id,
        gone: () => this.missing.set(`frame:${g.key}`, MISSING_READS - 1), // deleted after that listing: recreated on the next full read
        prio: -1,
        run: () => this.board.updateFrame!(f.id, { x: c.x, y: c.y, w: g.box.w, h: g.box.h }),
        ok: () => this.touch(f.id, true),
      });
    }
    // A frame a vandal drew over the forest or a fixture (it can swallow squares): removed.
    const mine = new Set(guarded.map((g) => g.get()).filter(Boolean));
    for (const f of frames) {
      if (mine.has(f.id) || this.staticIds.has(f.id) || this.baseline.has(f.id)) continue;
      if (!intersects(f, GRID_BOX) && !FIXTURE_KEYS.some((k) => intersects(f, FIXTURES[k]))) continue;
      this.penalize(tampers, f.createdBy, "added", "frame on the forest", f.id, f.createdAt);
      ops.push({ key: `junk:${f.id}`, prio: 4, run: () => this.board.deleteItem(f.id) });
    }
    if (ops.length) await this.execute(ops);
    if (gridChanged) this.board.setGridFrames?.(this.frameIds);
    return off;
  }

  /** The 3 fixtures every tick (cheap: 3 GETs) and a few inbox cards round robin, read by id. A 404 rebuilds now. */
  private async readById(byId: Map<string, BoardItem>) {
    this.freshIds.clear();
    if (!this.board.getItem) return;
    const fixtures = FIXTURE_KEYS.map((k) => this.game.fixtureIds[k]).filter((x): x is string => !!x && !this.stuck.has(x));
    const cards = [...this.inboxCard.values()].filter((id) => !this.placing.has(id));
    const probes = cards.length <= CARD_PROBES_PER_TICK ? cards : Array.from({ length: CARD_PROBES_PER_TICK }, (_, i) => cards[(this.probeAt + i) % cards.length]!);
    this.probeAt = cards.length ? (this.probeAt + CARD_PROBES_PER_TICK) % cards.length : 0;
    const got = new Map<string, BoardItem | null>();
    await pool(
      [...fixtures, ...probes].map((id) => async () => {
        this.readsThisTick++;
        try {
          got.set(id, await this.board.getItem!(id));
        } catch {
          // unknown this tick (429, 5xx): the listing decides
        }
      }),
      10,
    );
    for (const [id, it] of got) {
      if (!it) {
        this.itemGone(id);
        byId.delete(id);
        continue;
      }
      // Fixtures: judged on this read (geometry and text). Cards: only proven present here.
      if (fixtures.includes(id)) {
        byId.set(id, it);
        this.freshIds.add(id);
      }
    }
  }

  /** Miro says this item is gone (404): forget it; squares, fixtures and cards are rebuilt this tick. */
  private itemGone(id: string) {
    this.gone.add(id);
    this.missing.delete(id);
    this.stuck.delete(id);
    this.goneThisTick++;
    const lab = this.idCell.get(id);
    if (lab) {
      this.idCell.delete(id);
      this.cellId.delete(lab);
      this.shadow.delete(id);
      this.log(`\nput back: ${lab} (deleted)`);
      return;
    }
    const key = FIXTURE_KEYS.find((k) => this.game.fixtureIds[k] === id);
    if (key) {
      delete this.game.fixtureIds[key];
      this.written[key] = undefined;
      this.shadow.delete(id);
      this.log(`\nput back: the ${key} (deleted)`);
      return;
    }
    const owner = [...this.inboxCard].find(([, cid]) => cid === id)?.[0];
    if (owner) {
      this.inboxCard.delete(owner);
      this.shadow.delete(id);
      if (this.state.players[owner]) this.replacedCards.add(owner);
      this.log(`\nput back: ${this.state.players[owner]?.name ?? owner}'s inbox card (deleted)`);
      return;
    }
    this.shadow.delete(id);
  }

  /**
   * Class only: question stickies that can never be valid are removed, after telling their creator:
   * posted in another team's Orders (or by someone not on the team), naming a non-neighbour, or more
   * than 2 open (unanswered) questions by one player.
   */
  private policeQuestions(ops: Op[]) {
    const state = this.state;
    const remove = (s: StickyView, line?: string) => {
      this.removedStickies.add(s.id);
      if (line && state.players[s.createdBy] && state.noted[s.id] !== line) {
        state.noted[s.id] = line;
        this.pushFeedback(s.createdBy, line);
      }
      ops.push({ key: `junk:${s.id}`, prio: 3, run: () => this.board.deleteItem(s.id) });
    };
    const open = new Map<string, StickyView[]>();
    for (const s of this.stickies) {
      if (stickyKind(s.text) !== "QUESTION" || this.isSelf(s.createdBy) || state.approvals[s.id]) continue;
      const creator = state.players[s.createdBy];
      if (!creator || creator.team !== s.team) {
        remove(s, `🗑️ Removed your question in ${teamName(s.team)}'s Orders: put it in your own team's Orders.`);
        continue;
      }
      const to = questionTarget(s.text);
      const near = TEAM_INFO[s.team].neighbours;
      if (!to || !near.includes(to)) {
        remove(s, `🗑️ Removed your question: ask about a neighbour, like: ${questionText(near[0]!)}? (or ${teamName(near[1]!)}'s).`);
        continue;
      }
      if (questionAnswered(s.text)) continue;
      open.set(s.createdBy, [...(open.get(s.createdBy) ?? []), s]);
    }
    for (const list of open.values()) {
      list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || Number(a.id) - Number(b.id));
      for (const s of list.slice(MAX_OPEN_QUESTIONS)) remove(s, `🗑️ Removed an extra question: at most ${MAX_OPEN_QUESTIONS} open questions each. Wait for a YES or NO.`);
    }
    this.stickies = this.stickies.filter((s) => !this.removedStickies.has(s.id));
  }

  /** A square moved/edited/locked: forget it (deleted when Miro lets us) and build a fresh one. */
  private retireCell(lab: string, id: string, ops: Op[]) {
    this.idCell.delete(id);
    this.cellId.delete(lab);
    this.shadow.delete(id);
    this.missing.delete(id);
    this.stuck.add(id); // until the delete succeeds
    ops.push({ key: `junk:${id}`, prio: 2, run: () => this.board.deleteItem(id), ok: () => this.stuck.delete(id) });
  }

  private retireFixture(key: FixtureKey, id: string) {
    if (this.game.fixtureIds[key] !== id) return;
    this.log(`\nthe ${key} is locked (403): putting a new one on top. Unlock ${id} in Miro.`);
    this.stuck.add(id);
    this.shadow.delete(id);
    delete this.game.fixtureIds[key];
    this.written[key] = undefined;
  }

  /** Squares whose board fill differs from the engine: one write each, the fire's changes first. */
  private cellOps(fireChanged: Set<string>, writable?: (lab: string) => boolean): Op[] {
    const ops: Op[] = [];
    for (const [lab, id] of this.cellId) {
      const sh = this.shadow.get(id);
      if (!sh) continue;
      const want = this.fillOf(lab);
      const stroke = this.strokeFor(lab);
      const bkey = `${stroke.color}/${stroke.width}`;
      const fillOff = (sh.fill ?? "").toLowerCase() !== want;
      const borderOff = this.borderWritten.get(lab) !== bkey;
      if (!fillOff && !borderOff) continue;
      // A fill write could overwrite a player's newer paint: only on a square this read showed as expected.
      // A border-only write leaves the fill alone (the REST listing doesn't return borders: we track what we wrote).
      if (fillOff && writable && !writable(lab)) continue; // looked at again next tick
      const st = this.state.cells[lab]!;
      ops.push({
        key: `cell:${lab}`,
        id,
        prio: fireChanged.has(lab) ? 0 : 1,
        recheck: fillOff && (st === "fire" || st === "burnt") ? lab : undefined,
        run: () =>
          this.board.updateShape(id, {
            ...(fillOff ? { fill: want, textColor: textColorFor(st) } : {}),
            ...(borderOff ? { borderColor: stroke.color, borderWidth: stroke.width } : {}),
          }),
        ok: () => {
          const s = this.shadow.get(id);
          if (s) s.fill = want;
          this.borderWritten.set(lab, bkey);
        },
        fail: (_e, n) => {
          if (n < STUCK_AFTER || this.cellId.get(lab) !== id) return;
          this.log(`\n${lab} is locked (403): putting a new square on top`);
          this.idCell.delete(id);
          this.cellId.delete(lab);
          this.shadow.delete(id);
          this.stuck.add(id);
        },
      });
    }
    return ops;
  }

  /** A square's border: a team's fire gets its team color (6), a square burned by a team's fire keeps it (3); else normal. */
  strokeFor(lab: string): { color: string; width: number } {
    const st = this.state.cells[lab];
    const o = this.state.origin?.[lab];
    if (o && o !== "wild" && (st === "fire" || st === "burnt")) return { color: TEAM_INFO[o].color, width: st === "fire" ? 6 : 3 };
    return cellStroke(this.cells.get(lab)!);
  }

  /**
   * Right before writing a fire/burnt fill, read those squares by id (pooled, at most RECHECK_MAX per tick):
   * a square whose fill changed since this tick's read (a player's fresh paint) is not written now; its
   * change is judged on the next tick. Ops over the cap wait for the next tick. A 404 rebuilds the square.
   */
  private async recheckFireWrites(ops: Op[], readFill: Map<string, string>): Promise<Op[]> {
    if (!this.board.getItem) return ops;
    const todo = ops.filter((o) => o.recheck).sort((a, b) => a.prio - b.prio);
    const checked = new Set(todo.slice(0, RECHECK_MAX));
    const drop = new Set<Op>(todo.slice(RECHECK_MAX));
    await pool(
      [...checked].map((op) => async () => {
        this.readsThisTick++;
        try {
          const it = await this.board.getItem!(op.id!);
          if (!it) {
            drop.add(op);
            this.itemGone(op.id!);
            return;
          }
          if ((it.fill ?? "").toLowerCase() !== readFill.get(op.recheck!)) {
            drop.add(op);
            this.log(`\n${op.recheck} changed since this tick's read: fire write held, judged next tick`);
          }
        } catch {
          drop.add(op); // unknown: don't risk overwriting a paint; next tick
        }
      }),
      20,
    );
    return ops.filter((o) => !drop.has(o));
  }

  /** Missing squares, recreated 20 per call, into their band frame when it exists. */
  private rebuildOps(): Op[] {
    const lost = this.cellList.filter((c) => !this.cellId.has(c.label));
    const ops: Op[] = [];
    for (let i = 0; i < lost.length; i += 20) {
      const batch = lost.slice(i, i + 20);
      const shapes = batch.map((c) => this.cellShape(c, this.fillOf(c.label)));
      ops.push({
        key: `build:${batch[0]!.label}`,
        prio: 2,
        run: async () => {
          const ids = await this.board.createShapes(shapes);
          batch.forEach((c, k) => {
            const id = ids[k];
            if (!id || this.cellId.has(c.label)) return;
            this.cellId.set(c.label, id);
            this.idCell.set(id, c.label);
            this.setCellShadow(c.label, shapes[k]!.fill);
            this.borderWritten.set(c.label, `${shapes[k]!.borderColor}/${shapes[k]!.borderWidth}`);
            this.seen.add(id);
            this.createdIds.add(id);
          });
        },
      });
    }
    return ops;
  }

  /** Fixtures: recreate a missing one, rewrite the text that changed. */
  private fixtureOps(): Op[] {
    const ops: Op[] = [];
    for (const key of FIXTURE_KEYS) {
      const html = this.fixtureHtml(key);
      const id = this.game.fixtureIds[key];
      if (!id) {
        ops.push({
          key: `mkfx:${key}`,
          prio: 1,
          run: async () => {
            const shape = this.fixtureShape(key, html);
            const [nid] = await this.board.createShapes([shape]);
            this.game.fixtureIds[key] = nid!;
            this.shadow.set(nid!, { content: norm(html), fill: FIXTURE_STYLE[key].fill, x: shape.x, y: shape.y, w: shape.w, h: shape.h });
            this.written[key] = html;
            this.touch(nid!, true);
            this.knownAt.set(nid!, this.now());
            this.seen.add(nid!);
            this.createdIds.add(nid!);
          },
        });
        continue;
      }
      const sh = this.shadow.get(id);
      if (this.written[key] === html && sh?.content === norm(html)) continue;
      ops.push({
        key: `fx:${key}`,
        id,
        prio: 1,
        run: () => this.board.updateShape(id, { content: html }),
        ok: () => {
          this.written[key] = html;
          this.touch(id);
          const s = this.shadow.get(id);
          if (s) s.content = norm(html);
        },
        fail: (_e, n) => n >= STUCK_AFTER && this.retireFixture(key, id),
      });
    }
    return ops;
  }

  /** Inbox cards: recreate a deleted player's card, rewrite cards whose text changed. */
  private cardOps(): Op[] {
    const ops: Op[] = [];
    for (const owner of this.replacedCards) {
      if (this.inboxCard.has(owner) || !this.state.players[owner]) continue;
      const slot = this.cardBox(owner);
      const html = this.cardContent(owner);
      ops.push({
        key: `mkcard:${owner}`,
        prio: 3,
        run: async () => {
          const [id] = await this.board.createShapes([{ content: html, fill: CARD_FILL, ...center(slot), w: slot.w, h: slot.h, textColor: COLORS.text, fontSize: 14, textAlign: "left", textAlignVertical: "top" }]);
          this.inboxCard.set(owner, id!);
          this.shadow.set(id!, { content: norm(html), fill: CARD_FILL, ...center(slot), w: slot.w, h: slot.h });
          this.touch(id!, true);
          this.knownAt.set(id!, this.now());
          this.seen.add(id!);
          this.createdIds.add(id!);
        },
      });
    }
    for (const [owner, id] of this.inboxCard) {
      const sh = this.shadow.get(id);
      if (!sh || this.placing.has(id)) continue;
      const html = this.cardContent(owner);
      if (sh.content === norm(html)) continue;
      ops.push({
        key: `card:${id}`,
        id,
        prio: 3,
        run: () => this.board.updateShape(id, { content: html }),
        ok: () => {
          this.touch(id);
          const s = this.shadow.get(id);
          if (s) s.content = norm(html);
        },
      });
    }
    return ops;
  }

  /** Run planned writes: one per key, by priority, within this tick's budget; failures back off per key. */
  private async execute(ops: Op[], budget = this.maxWritesPerTick): Promise<{ deferred: number }> {
    const byKey = new Map<string, Op>();
    for (const op of ops) byKey.set(op.key, op);
    const ready = [...byKey.values()].filter((op) => (this.failures.get(op.key)?.next ?? 0) <= this.tickNo).sort((a, b) => a.prio - b.prio);
    const run: Op[] = [];
    let deferred = 0;
    for (const op of ready) {
      const c = op.calls ?? 1;
      if (this.writesThisTick + c > budget) {
        deferred++;
        continue;
      }
      this.writesThisTick += c;
      run.push(op);
    }
    await pool(
      run.map((op) => async () => {
        try {
          await op.run();
          this.failures.delete(op.key);
          if (op.key.startsWith("junk:")) this.gone.add(op.key.slice(5)); // deleted: an older listing may still show it
          op.ok?.();
        } catch (e) {
          try {
            if (isGone(e) && (op.id || op.key.startsWith("junk:"))) {
              // 404: the item was deleted. Never "locked": forget it and rebuild it this tick.
              this.failures.delete(op.key);
              if (op.key.startsWith("junk:")) {
                this.gone.add(op.key.slice(5));
                this.stuck.delete(op.key.slice(5));
              } else if (op.gone) op.gone();
              else this.itemGone(op.id!);
              return;
            }
            const prev = this.failures.get(op.key);
            const n = (prev?.n ?? 0) + 1;
            const locked = isLocked(e) ? (prev?.locked ?? 0) + 1 : 0;
            // Retry next tick, then back off (2, 4, ... 16 ticks): a locked item must not cost a write every poll.
            this.failures.set(op.key, { n, locked, next: this.tickNo + (n < STUCK_AFTER ? 1 : Math.min(16, 2 ** (n - STUCK_AFTER + 1))) });
            if (n === 1 || n === STUCK_AFTER) this.log(`write ${op.key} failed (${errMsg(e)})${n >= STUCK_AFTER ? `; ${n} times in a row` : ""}`);
            if (locked) op.fail?.(e as Error, locked);
          } catch (e2) {
            this.log(`repair of ${op.key} failed: ${errMsg(e2)}`);
          }
        }
      }),
      this.concurrency,
    );
    return { deferred };
  }

  private welcome(name: string, team: Team, role: "boss" | "worker"): string {
    const t = TEAM_INFO[team];
    const frame = ordersTitle(team);
    const job =
      role === "boss"
        ? `You are the BOSS: in ${frame}, keep one sticky per worker like "Ana: paint N9 N10", and paint too. When your area is under control you may ask "Start a fire in Team N's area?" (a neighbour; a teammate must say YES).`
        : `You are a WORKER: paint the squares on your sticky in ${frame} (your name: paint ...).`;
    return `👋 ${esc(name)}: you are on ${t.name} (${team}). Your area: ${sectorText(team)} (edge ${t.color}). Paint blue ${STATE_COLOR.water} on green or orange squares there. ${job}`;
  }

  private isInboxCard(it: BoardItem): boolean {
    return (
      (it.type === "shape" || it.type === "sticky_note") &&
      inside(PANELS.inbox, it.x, it.y) &&
      it.w <= 1000 &&
      it.h <= 600 &&
      !this.idCell.has(it.id) &&
      !this.staticIds.has(it.id) &&
      !Object.values(this.game.fixtureIds).includes(it.id)
    );
  }

  /** A new card in the Inbox: a join, an extra card (removed), or a player's own card replacing the referee's copy. */
  private async newCard(it: BoardItem, ops: Op[]): Promise<number> {
    const owner = this.cardOwner(it);
    const current = this.inboxCard.get(owner);
    if (current && !this.replacedCards.has(owner)) {
      ops.push({ key: `junk:${it.id}`, prio: 3, run: () => this.board.deleteItem(it.id) });
      this.pushFeedback(owner, "ℹ️ You already have an inbox card; the extra one was removed.");
      return 0;
    }
    if (current) {
      // The player made a new card after theirs was deleted: theirs wins, the referee's copy goes.
      ops.push({ key: `junk:${current}`, prio: 3, run: () => this.board.deleteItem(current) });
      this.shadow.delete(current);
    }
    this.replacedCards.delete(owner);
    this.inboxCard.set(owner, it.id);
    let joined = 0;
    if (!this.state.players[owner]) {
      if (this.state.phase === "over") {
        this.pushFeedback(owner, "🏁 The game is over: wait for the next one.");
      } else {
        await this.join(it);
        joined = 1;
      }
    }
    const slot = this.cardBox(owner);
    const c = center(slot);
    const content = this.cardContent(owner);
    const sticky = it.type === "sticky_note";
    const sh: Shadow = sticky ? { content: norm(it.content), x: c.x, y: c.y, w: it.w, h: it.h } : { content: norm(it.content), fill: CARD_FILL, x: c.x, y: c.y, w: slot.w, h: slot.h };
    this.shadow.set(it.id, sh);
    this.knownAt.set(it.id, this.now());
    this.placing.add(it.id);
    ops.push({
      key: `place:${it.id}`,
      id: it.id,
      prio: 3,
      run: () => this.board.updateShape(it.id, sticky ? { content, x: c.x, y: c.y } : { content, x: c.x, y: c.y, w: slot.w, h: slot.h, fill: CARD_FILL, textColor: COLORS.text }),
      ok: () => {
        this.touch(it.id, true);
        sh.content = norm(content);
      },
    });
    return joined;
  }

  /** A stable place in the Inbox panel per player (72 fit; more overlap slightly, never leave the panel). */
  private cardBox(owner: string): Box {
    const slots = (this.game.slots ??= {});
    if (slots[owner] === undefined) slots[owner] = Object.keys(slots).length;
    const i = slots[owner]!;
    const per = 72;
    const b = inboxSlot(i % per);
    const k = Math.floor(i / per) % 5;
    return { ...b, x: b.x + k * 16, y: b.y + k * 16 };
  }

  /** A new inbox card is a join: its text is "Inbox · NAME". */
  private async join(it: BoardItem) {
    const name = norm(it.content).replace(/^inbox\s*[·:-]?\s*/i, "");
    const owner = this.cardOwner(it);
    const { player } = applyJoin(this.state, { userId: owner, name, at: this.when(it.createdAt, this.now()) }, await this.presetFor(it.createdBy, name));
    this.log(`\njoin: ${player.name} -> ${player.team} ${player.role} (${owner})`);
    this.pushFeedback(owner, this.welcome(player.name, player.team, player.role));
  }

  private async presetFor(userId: string, name: string): Promise<Team | undefined> {
    if (!Object.keys(this.presets).length) return undefined;
    const byName = this.presets[name.trim().toLowerCase()];
    if (byName) return byName;
    if (!this.memberNames?.[userId]) this.memberNames = await this.board.members().catch(() => this.memberNames ?? {});
    const miroName = this.memberNames?.[userId];
    return miroName ? this.presets[miroName.trim().toLowerCase()] : undefined;
  }

  private pushFeedback(userId: string, line: string) {
    if (!userId) return;
    const arr = this.feedback.get(userId) ?? [];
    arr.push(line);
    while (arr.length > FEEDBACK_LINES) arr.shift();
    this.feedback.set(userId, arr);
  }

  private cardContent(userId: string): string {
    const p = this.state.players[userId];
    const ps = this.state.stats.byPlayer[userId];
    const paints = paintsOf(ps);
    const head = p ? `<b>${esc(p.name)} · ${TEAM_INFO[p.team].name.toUpperCase()} · ${p.role.toUpperCase()} · ${paints} paints</b>` : "<b>Inbox</b>";
    const lines = this.feedback.get(userId) ?? [];
    return [head, ...lines].map((l) => `<p>${l}</p>`).join("");
  }

  private async writeFixture(key: FixtureKey, html: string) {
    const id = this.game.fixtureIds[key];
    if (!id || this.written[key] === html) return;
    this.touch(id);
    try {
      await this.board.updateShape(id, { content: html });
    } catch (e) {
      this.log(`${key} write failed: ${errMsg(e)}`);
      return;
    }
    this.written[key] = html;
    const sh = this.shadow.get(id);
    if (sh) sh.content = norm(html);
  }

  private bannerOverride?: string;
  private fixtureHtml(key: FixtureKey): string {
    if (key === "banner") return this.bannerOverride ? `<p>${this.bannerOverride}</p>` : this.bannerHtml();
    return key === "scoreboard" ? this.scoreboardHtml() : this.leaderboardHtml();
  }

  private async updateBoards(banner?: string) {
    this.bannerOverride = banner;
    try {
      await pool(FIXTURE_KEYS.map((k) => () => this.writeFixture(k, this.fixtureHtml(k))), 3);
    } finally {
      this.bannerOverride = undefined;
    }
  }

  // ---------- what the projector shows ----------
  bannerHtml(): string {
    const s = this.state;
    const r = this.rules;
    const p = (a: string, b: string) => `<p><b>${a}</b></p><p>${b}</p>`;
    const water = `💧 ${TEAMS.map((t) => `T${TEAM_INFO[t].num} ${s.water[t]}`).join(" · ")}`;
    const w = windOn(r) ? WIND[s.wind]! : null;
    const windTxt = w ? ` · wind ${w.arrow} ${w.name}` : "";
    if (s.phase === "lobby") return p(`🔥 WILDFIRE · /join now · the fire starts soon${windTxt} · ${water}`, `paint blue ${STATE_COLOR.water} on green or orange squares in your team's area`);
    if (s.phase === "over") {
      const sc = scores(s, this.cellList);
      const why = s.endReason === "out" ? "the fire is out" : s.endReason === "time" ? "time is up" : "stopped";
      return p(`🏁 GAME OVER (${why}) · 🏆 ${TEAM_INFO[s.winner!].name.toUpperCase()} saved ${sc[s.winner!].pct}%`, TEAMS.map((t) => `${TEAM_INFO[t].name} ${sc[t].pct}%`).join(" · "));
    }
    const left = r.gameMinutes * 60_000 - s.elapsed;
    const spreadIn = Math.max(0, Math.ceil((s.nextSpreadAt - s.elapsed) / 1000));
    const line1 = `🔥 LIVE · ${mmss(left)} left${windTxt} · next spread ${spreadIn}s · ${water}`;
    const windIn = w && !s.windTurned ? r.wind!.turnAt * 60_000 - s.elapsed : Infinity;
    const nextBolt = s.lightningDone < r.lightningAt.length ? r.lightningAt[s.lightningDone]! * 60_000 - s.elapsed : Infinity;
    const recent = s.events.filter((e) => s.elapsed - e.at < 25_000).at(-1);
    const burning = Object.values(s.cells).filter((c) => c === "fire").length;
    let line2: string;
    if (windIn <= 30_000) line2 = `🌬️ Wind turning in ${Math.ceil(windIn / 1000)} s!`;
    else if (recent) line2 = recent.text;
    else if (nextBolt <= 60_000) line2 = `⚡ Lightning in ${mmss(nextBolt)}: a new fire in a team's area`;
    else {
      const low = TEAMS.filter((t) => s.water[t] <= r.waterPerTeam / 5).map((t) => `T${TEAM_INFO[t].num}`);
      line2 = `${burning} squares on fire${low.length ? ` · 🚱 water running low: ${low.join(" ")}` : ""}`;
    }
    return p(line1, line2);
  }

  scoreboardHtml(): string {
    const s = this.state;
    const sc = scores(s, this.cellList);
    const best = TEAMS.slice().sort((a, b) => sc[b].pct - sc[a].pct)[0]!;
    const cell = (t: Team) => `${s.phase !== "lobby" && t === best ? "👑 " : TEAM_INFO[t].emoji + " "}${TEAM_INFO[t].name.toUpperCase()} ${sc[t].pct}%${sc[t].fire ? ` 🔥${sc[t].fire}` : ""}`;
    return `<p><b>${cell("ridge")}  ·  ${cell("pine")}</b></p><p><b>${cell("cedar")}  ·  ${cell("birch")}</b></p>`;
  }

  leaderboardHtml(): string {
    const s = this.state;
    const sc = scores(s, this.cellList);
    const pending = pendingStickies(s, this.stickies, this.rules);
    const lines: string[] = [`<b>🏆 LEADERBOARD · forest saved</b>`];
    const order = TEAMS.slice().sort((a, b) => sc[b].pct - sc[a].pct);
    for (const t of order) {
      const players = Object.values(s.stats.byPlayer).filter((p) => p.team === t);
      const water = players.reduce((a, p) => a + p.water, 0);
      const boss = players.find((p) => p.role === "boss")?.name ?? "-";
      lines.push("");
      lines.push(`<b>${TEAM_INFO[t].emoji} ${TEAM_INFO[t].name.toUpperCase()} ${sc[t].pct}% · ${players.length} players · 💧 ${s.water[t]} water left · ${water} blue paints</b>`);
      lines.push(`boss ${esc(boss)}`);
      const crew = players.filter((p) => p.role === "worker").map((p) => esc(p.name));
      if (crew.length) lines.push(`crew: ${crew.join(", ")}`);
      lines.push(`🔥 lit ${s.stats.lit?.[t] ?? 0} · burned ${s.stats.burnedOthers?.[t] ?? 0} trees of others`);
      const out = s.attacks
        .filter((g) => g.team === t && g.left > 0 && s.phase === "live")
        .map((g) => `🔥 ${TEAM_INFO[t].name} may light ${g.left} more fire${g.left === 1 ? "" : "s"} in ${TEAM_INFO[g.to].name}'s area (${mmss(g.until - s.elapsed)} left)`);
      const waiting = pending[t].map((x) => `⏳ waiting for a YES: ${x}`);
      if (out.length || waiting.length) lines.push([...out, ...waiting].slice(0, 2).join(" · "));
      for (const p of Object.values(s.players).filter((q) => q.team === t)) {
        const n = s.junk?.[p.userId] ?? 0;
        if (n >= 3) lines.push(`🚫 ${esc(p.name)}: ${n} junk items removed`);
      }
    }
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  private fixtureShape(key: FixtureKey, content: string): NewShape {
    // Exactly where the fixture was (agents find a recreated one by a small read of that box).
    const box = this.game.fixtureBoxes?.[key] ?? { ...center(FIXTURES[key]), w: FIXTURES[key].w, h: FIXTURES[key].h };
    const st = FIXTURE_STYLE[key];
    return { content, fill: st.fill!, x: box.x, y: box.y, w: box.w, h: box.h, fontSize: st.fontSize, textAlign: st.textAlign, textAlignVertical: st.textAlignVertical, textColor: st.textColor, borderColor: COLORS.panelBorder, borderWidth: 2 };
  }

  cellShape(cell: CellDef, fill: string): NewShape {
    const c = center(cellBox(cell));
    const st = this.strokeFor(cell.label);
    const state: CellState = this.state.cells[cell.label] ?? startState(cell);
    // Into its band frame when that frame is known; otherwise on the canvas (and reads stop using the fast path).
    const parentId = this.fastPath() || (this.frameIds.length === 9 && this.frameIds.every(Boolean)) ? this.frameIds[frameOfRow(cell.row)] : undefined;
    return { content: cell.label, fill, ...c, w: GRID.cell, h: GRID.cell, borderColor: st.color, borderWidth: st.width, textColor: textColorFor(state), fontSize: CELL_FONT, parentId };
  }

  // ---------- results ----------
  resultsText(): string {
    const s = this.state;
    const sc = scores(s, this.cellList);
    const mins = Math.round(s.elapsed / 6000) / 10;
    const approved = Object.values(s.approvals).filter((a) => a.status === "approved");
    const out: string[] = [
      s.phase === "over" ? `🏆 ${TEAM_INFO[s.winner!].name.toUpperCase()} WINS (${s.endReason === "out" ? "the fire went out" : s.endReason === "time" ? "time is up" : "stopped"})` : `phase: ${s.phase}`,
      `forest saved: ${TEAMS.map((t) => `${TEAM_INFO[t].name} ${sc[t].pct}%`).join(" · ")} · ${mins} min of fire`,
      `paints ${s.stats.accepted} · water left ${TEAMS.map((t) => `${t} ${s.water[t]}`).join(" ")} (of ${this.rules.waterPerTeam} each) · ignitions ${s.stats.ignitions} · burnt out ${s.stats.burntOut} · lightning ${s.stats.strikes.join(" ") || "-"}`,
      `attacks approved: ${approved.map((a) => `${a.team}→${a.to}`).join(" ") || "none"} · lit ${TEAMS.map((t) => `${t} ${s.stats.lit[t]}`).join(" ")} · burned others' trees ${TEAMS.map((t) => `${t} ${s.stats.burnedOthers[t]}`).join(" ")} · blowback ${TEAMS.map((t) => `${t} ${s.stats.blowback[t]}`).join(" ")} · refused by a human: ${Object.values(s.approvals).filter((a) => a.status === "refused").length}`,
      `paints undone: ${Object.entries(s.stats.illegal).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
      "",
    ];
    for (const t of TEAMS) {
      const ps = Object.values(s.stats.byPlayer).filter((p) => p.team === t).sort((a, b) => b.water - a.water);
      out.push(`${TEAM_INFO[t].name}: ${ps.map((p) => `${p.name}${p.role === "boss" ? " (boss)" : ""} 💧${p.water}${p.lit ? ` 🔥${p.lit}` : ""}`).join(", ") || "no players"}`);
    }
    return out.join("\n");
  }
}

const mmss = (ms: number) => `${Math.floor(Math.max(0, ms) / 60_000)}:${String(Math.floor((Math.max(0, ms) % 60_000) / 1000)).padStart(2, "0")}`;
