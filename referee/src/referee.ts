// The referee loop: reads the board, diffs it against what it expects (the shadow), asks the rules
// engine, and writes back: fire spread and burn-out, drying water, reverted paints, inbox cards,
// banner, scoreboard and leaderboard. It never paints water, firebreaks or backburns for anyone.
// Works on any BoardAdapter.
import type { BoardAdapter, BoardItem, NewShape } from "./board.js";
import { pool, stripHtml } from "./board.js";
import {
  CELL_FONT, FIXTURES, GRID, GRID_BOX, PANELS, STATE_COLOR, TEAMS, TEAM_INFO, WIND, buildCells, cellBox, cellStroke, center, frameOfRow, inboxSlot, inside,
  ordersTeamAt, ordersTitle, parseLabel, sectorText, startFill, textColorFor, type CellDef, type Team,
} from "./layout.js";
import {
  advance, applyJoin, createState, decidePaint, decideTamper, judgeSticky, mulberry32, pendingStickies, scores, startGame, stopGame, teamName, type GameState, type PaintEvent,
  type Rng, type RuleSet, type StickyView, type TamperEvent,
} from "./rules.js";

export type FixtureKey = keyof typeof FIXTURES;
const FIXTURE_KEYS = Object.keys(FIXTURES) as FixtureKey[];

export interface GameFile {
  fixtureIds: Partial<Record<FixtureKey, string>>;
  /** The whole game, saved every tick so a restarted referee carries on where it stopped. */
  state?: GameState;
}

export function emptyGame(): GameFile {
  return { fixtureIds: {} };
}

interface Shadow {
  content: string; // stripped
  fill?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FEEDBACK_LINES = 6;
const TOL = 1.5;
/** Game time never jumps more than this per tick (a paused or crashed referee doesn't fast-forward the fire). */
const MAX_STEP_MS = 15_000;
const FIXTURE_STYLE: Record<FixtureKey, Partial<NewShape>> = {
  banner: { fill: "#2b2f3a", fontSize: 28, textColor: "#ffffff" },
  scoreboard: { fill: "#fff6e0", fontSize: 30 },
  leaderboard: { fill: "#ffffff", fontSize: 16, textAlign: "left", textAlignVertical: "top" },
};

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
  /** Fire randomness. Seed it for a repeatable game. */
  rng?: Rng;
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
  private concurrency: number;
  private presets: Record<string, Team>;
  private memberNames: Record<string, string> | null = null;
  private written: Partial<Record<FixtureKey, string>> = {};
  private dirty = new Set<string>();
  /** When this process started watching. Paints made before it (no referee running) are undone. */
  private watchingSince = Infinity;
  private lastAdvanceAt: number | null = null;
  private frameIds: string[];
  private sweep: Promise<unknown> | null = null;
  private sweepResult: BoardItem[] | null = null;
  private sweepStartedAt = 0;
  // Non-square items, for the fast read path (a sweep can be older than our last write):
  private lastWriteAt = new Map<string, number>(); // when this referee last wrote their content
  private geomWriteAt = new Map<string, number>(); // ... their position or size
  private knownAt = new Map<string, number>(); // ... created them or first saw them

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
    this.frameIds = opts.frameIds ?? [];
    this.rng = opts.rng ?? mulberry32(Date.now() % 2 ** 31);
  }

  get state(): GameState {
    return (this.game.state ??= createState(this.cellList, this.rules, this.rng));
  }

  fillOf(label: string): string {
    return STATE_COLOR[this.state.cells[label]!];
  }

  // ---------- discovery ----------
  private isFixtureShape(it: BoardItem, key: FixtureKey): boolean {
    const b = FIXTURES[key];
    return it.type === "shape" && inside(b, it.x, it.y) && it.w <= b.w * 1.15 && it.h <= b.h * 1.15 && it.w >= b.w * 0.5 && it.h >= b.h * 0.5;
  }

  /** Map squares, fixtures and inbox cards on the board. Creates any missing fixture. */
  async discover(): Promise<{ cells: number; missing: string[]; fixtures: string[] }> {
    const items = await this.board.listItems();
    this.watchingSince = this.now();
    this.cellId.clear();
    this.idCell.clear();
    const fx = this.game.fixtureIds;
    const present = new Set(items.map((i) => i.id));
    for (const key of FIXTURE_KEYS) if (fx[key] && !present.has(fx[key]!)) delete fx[key]; // stale (board rebuilt)
    const state = this.state;
    for (const it of items) {
      // An inbox card from someone not yet on a team was made while no referee ran: a join, for the first tick.
      const pendingJoin = this.isInboxCard(it) && !state.players[it.createdBy];
      if (!pendingJoin) this.seen.add(it.id);
      if (it.type !== "shape" || this.staticIds.has(it.id)) continue;
      const text = stripHtml(it.content);
      if (parseLabel(text) && inside(GRID_BOX, it.x, it.y) && it.w < GRID.pitch * 2) {
        const lab = text.trim().toUpperCase();
        if (!this.cellId.has(lab)) {
          this.cellId.set(lab, it.id);
          this.idCell.set(it.id, lab);
          this.setCellShadow(lab, this.fillOf(lab));
        }
        continue;
      }
      for (const key of FIXTURE_KEYS) {
        if (!fx[key] && this.isFixtureShape(it, key) && !Object.values(fx).includes(it.id)) fx[key] = it.id;
      }
    }
    const created: FixtureKey[] = [];
    for (const key of FIXTURE_KEYS) {
      if (fx[key]) continue;
      const [id] = await this.board.createShapes([this.fixtureShape(key, "")]);
      fx[key] = id!;
      this.seen.add(id!);
      this.knownAt.set(id!, this.now());
      created.push(key);
    }
    for (const key of FIXTURE_KEYS) {
      const it = items.find((i) => i.id === fx[key]);
      // An existing fixture keeps its own geometry (the MCP-built board places the leaderboard a few units
      // off FIXTURES.leaderboard); only a fixture the referee just created uses the FIXTURES box.
      const box = it ? { x: it.x, y: it.y, w: it.w, h: it.h } : { ...center(FIXTURES[key]), w: FIXTURES[key].w, h: FIXTURES[key].h };
      this.shadow.set(fx[key]!, { content: it ? stripHtml(it.content) : "", fill: it?.fill ?? FIXTURE_STYLE[key].fill, ...box });
    }
    if (created.length) this.log(`created missing fixtures: ${created.join(", ")}`);
    for (const it of items) {
      if (this.isInboxCard(it) && state.players[it.createdBy] && !this.inboxCard.has(it.createdBy)) {
        this.inboxCard.set(it.createdBy, it.id);
        this.shadow.set(it.id, { content: stripHtml(it.content), fill: it.fill, x: it.x, y: it.y, w: it.w, h: it.h });
      }
    }
    this.stickies = this.readStickies(items);
    const missing = [...this.cells.keys()].filter((l) => !this.cellId.has(l));
    return { cells: this.cellId.size, missing, fixtures: FIXTURE_KEYS.filter((k) => fx[k]) };
  }

  /** Recreate every grid square that is missing from the board, in batches. */
  async rebuildMissing(): Promise<number> {
    const missing = this.cellList.filter((c) => !this.cellId.has(c.label));
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
      const ids = await this.board.createShapes(batch.map((c) => this.cellShape(c, this.fillOf(c.label))));
      batch.forEach((c, k) => {
        this.cellId.set(c.label, ids[k]!);
        this.idCell.set(ids[k]!, c.label);
        this.setCellShadow(c.label, this.fillOf(c.label));
        this.seen.add(ids[k]!);
      });
    }
    if (missing.length) this.log(`rebuilt ${missing.length} missing squares`);
    return missing.length;
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
        const geomOff = Math.abs(it.x - c.x) > TOL || Math.abs(it.y - c.y) > TOL || Math.abs(it.w - GRID.cell) > TOL || Math.abs(it.h - GRID.cell) > TOL;
        if ((it.fill ?? "").toLowerCase() !== fill || geomOff || stripHtml(it.content) !== lab) {
          writes.push(() => this.board.updateShape(it.id, { fill, textColor: textColorFor(cell.kind), content: lab, ...c, w: GRID.cell, h: GRID.cell }));
          repainted++;
        }
        this.setCellShadow(lab, fill);
        continue;
      }
      if (fixtureIds.has(it.id) || this.staticIds.has(it.id)) continue;
      const junk = this.isInboxCard(it) || (it.type === "sticky_note" && ordersTeamAt(it.x, it.y)) || (inside(GRID_BOX, it.x, it.y) && it.w <= 400 && it.h <= 400);
      if (junk) {
        writes.push(() => this.board.deleteItem(it.id));
        this.shadow.delete(it.id);
        deleted++;
      }
    }
    await pool(writes.map((w) => () => w().catch((e: Error) => this.log(`reset write failed: ${e.message.split("\n")[0]}`))), this.concurrency);
    this.inboxCard.clear();
    this.feedback.clear();
    this.stickies = [];
    this.written = {};
    await this.updateBoards("🔥 WILDFIRE · waiting for the referee");
    this.seen = new Set((await this.board.listItems()).map((i) => i.id));
    return { repainted, deleted };
  }

  /** Light the fire (from the lobby). A game already live or over is left as it is. */
  async start(): Promise<void> {
    const lit = startGame(this.state, this.rules, this.now());
    this.lastAdvanceAt = this.now();
    if (!lit.length) return;
    this.log("the fire is loose");
    await pool(lit.map((l) => () => this.writeCell(l)), this.concurrency);
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
  /** Squares are always fresh; `full` says whether the rest of the board is in `items` too. */
  private async readBoard(): Promise<{ items: BoardItem[]; full: boolean; since: number }> {
    if (!this.board.listGridItems || !this.frameIds.length) return { items: await this.board.listItems(), full: true, since: Infinity };
    if (!this.sweep) {
      this.sweepStartedAt = this.now();
      this.sweep = this.board
        .listItems()
        .then((r) => (this.sweepResult = r))
        .catch((e: Error) => {
          this.log(`sweep failed: ${e.message}`);
          this.sweep = null;
        });
    }
    const cells = await this.board.listGridItems();
    if (!this.sweepResult) return { items: cells, full: false, since: 0 };
    const rest = this.sweepResult.filter((i) => !this.idCell.has(i.id) && !this.frameIds.includes(i.parentId ?? ""));
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
      if (team && !this.staticIds.has(it.id)) out.push({ id: it.id, team, text: stripHtml(it.content), createdBy: it.createdBy, modifiedBy: it.modifiedBy });
    }
    return out;
  }

  /** Bring one square on the board in line with the engine (fill + readable label color). */
  private async writeCell(label: string): Promise<void> {
    const id = this.cellId.get(label);
    const sh = id && this.shadow.get(id);
    if (!id || !sh) return;
    const st = this.state.cells[label]!;
    sh.fill = STATE_COLOR[st];
    await this.board.updateShape(id, { fill: sh.fill, textColor: textColorFor(st) });
  }

  async tick(): Promise<{ paints: number; tampers: number; joins: number; fire: number; changed: number }> {
    const state = this.state;
    const { items, full, since } = await this.readBoard();
    // Squares are always fresh. Anything else only when the sweep began after we last touched that aspect of it.
    const fresh = (m: Map<string, number>, id: string) => this.idCell.has(id) || (full && (m.get(id) ?? -Infinity) < since);
    const byId = new Map(items.map((i) => [i.id, i]));
    const paints: PaintEvent[] = [];
    const tampers: TamperEvent[] = [];
    const now = this.now();
    let joins = 0;
    const writes = new Map<string, () => Promise<unknown>>(); // one write per item, last one wins
    const fixtureKeyOf = (id: string) => FIXTURE_KEYS.find((k) => this.game.fixtureIds[k] === id);

    // 1. deleted tracked items
    for (const [id, sh] of [...this.shadow]) {
      if (byId.has(id) || !fresh(this.knownAt, id)) continue;
      const lab = this.idCell.get(id);
      if (lab) {
        const cell = this.cells.get(lab)!;
        await this.board.deleteItem(id).catch(() => {}); // it may still exist outside its frame
        let newId: string | undefined;
        try {
          [newId] = await this.board.createShapes([this.cellShape(cell, this.fillOf(lab))]);
        } catch (e) {
          this.log(`rebuild ${lab} failed: ${(e as Error).message.split("\n")[0]}`);
          continue;
        }
        this.cellId.set(lab, newId!);
        this.idCell.delete(id);
        this.idCell.set(newId!, lab);
        this.shadow.delete(id);
        this.setCellShadow(lab, this.fillOf(lab));
        this.seen.add(newId!);
        tampers.push({ userId: "unknown", what: "deleted", target: lab, at: now });
        continue;
      }
      const fxKey = fixtureKeyOf(id);
      if (fxKey) {
        let newId: string | undefined;
        try {
          [newId] = await this.board.createShapes([this.fixtureShape(fxKey, sh.content)]);
        } catch (e) {
          this.log(`rebuild ${fxKey} failed: ${(e as Error).message.split("\n")[0]}`);
          continue;
        }
        this.game.fixtureIds[fxKey] = newId!;
        this.shadow.delete(id);
        this.shadow.set(newId!, sh);
        this.touch(newId!, true);
        this.knownAt.set(newId!, now);
        this.seen.add(newId!);
        this.written[fxKey] = undefined;
        tampers.push({ userId: "unknown", what: "deleted", target: `the ${fxKey}`, at: now });
        continue;
      }
      for (const [u, cid] of this.inboxCard) if (cid === id) this.inboxCard.delete(u);
      this.shadow.delete(id);
    }

    // 2. squares + fixtures + inbox cards: diff against the shadow
    for (const [id, sh] of this.shadow) {
      const it = byId.get(id);
      if (!it) continue;
      const lab = this.idCell.get(id);
      // The banner is rewritten every tick, so its text is rarely judgeable; its position always is.
      const geomOff = fresh(this.geomWriteAt, id) && (Math.abs(it.x - sh.x) > TOL || Math.abs(it.y - sh.y) > TOL || Math.abs(it.w - sh.w) > TOL || Math.abs(it.h - sh.h) > TOL);
      const textFresh = fresh(this.lastWriteAt, id);
      const contentOff = textFresh && stripHtml(it.content) !== sh.content;
      const fillOff = textFresh && sh.fill !== undefined && (it.fill ?? "").toLowerCase() !== sh.fill.toLowerCase();
      if (lab) {
        if (geomOff || contentOff) {
          tampers.push({ userId: it.modifiedBy, what: contentOff ? "edited" : Math.abs(it.w - sh.w) > TOL || Math.abs(it.h - sh.h) > TOL ? "resized" : "moved", target: lab, at: it.modifiedAt });
          // Replace a moved/edited square rather than moving it back (Miro refuses moves out of a frame).
          writes.set(id, () => this.board.deleteItem(id));
        } else if (fillOff) {
          paints.push({ label: lab, fill: (it.fill ?? "").toLowerCase(), userId: it.modifiedBy, at: it.modifiedAt });
        }
        continue;
      }
      if (geomOff || contentOff || fillOff) {
        const fxKey = fixtureKeyOf(id);
        tampers.push({ userId: it.modifiedBy, what: contentOff ? "edited" : geomOff ? "moved" : "edited", target: fxKey ? `the ${fxKey}` : "an inbox card", at: it.modifiedAt });
        writes.set(id, () => this.board.updateShape(id, { content: sh.content, fill: sh.fill, x: sh.x, y: sh.y, w: sh.w, h: sh.h }));
        this.touch(id, true);
      }
    }

    // 3. new items: inbox cards (= joins), junk on the arena (full reads only)
    for (const it of full ? items : []) {
      if (this.seen.has(it.id)) continue;
      this.seen.add(it.id);
      if (this.isInboxCard(it)) {
        if (this.inboxCard.has(it.createdBy)) {
          writes.set(it.id, () => this.board.deleteItem(it.id));
          this.pushFeedback(it.createdBy, "ℹ️ You already have an inbox card; the extra one was removed.");
          continue;
        }
        this.inboxCard.set(it.createdBy, it.id);
        const slot = inboxSlot(this.inboxCard.size - 1);
        const c = center(slot);
        if (!state.players[it.createdBy]) {
          joins++;
          await this.join(it);
        }
        const content = this.cardContent(it.createdBy);
        const sticky = it.type === "sticky_note";
        writes.set(it.id, () => this.board.updateShape(it.id, sticky ? { content, x: c.x, y: c.y } : { content, x: c.x, y: c.y, w: slot.w, h: slot.h, fill: "#ffffff" }));
        this.touch(it.id, true);
        this.knownAt.set(it.id, now);
        this.shadow.set(it.id, sticky ? { content: stripHtml(content), x: c.x, y: c.y, w: it.w, h: it.h } : { content: stripHtml(content), fill: "#ffffff", x: c.x, y: c.y, w: slot.w, h: slot.h });
        this.dirty.delete(it.createdBy);
        continue;
      }
      if ((inside(GRID_BOX, it.x, it.y) && it.w <= 400 && it.h <= 400) || FIXTURE_KEYS.some((k) => inside(FIXTURES[k], it.x, it.y))) {
        tampers.push({ userId: it.createdBy, what: "added", target: "an item on the forest", at: it.createdAt });
        writes.set(it.id, () => this.board.deleteItem(it.id));
      }
    }

    // 4. approvals: sticky notes in the Orders frames (full reads only)
    if (full) {
      this.stickies = this.readStickies(items);
      for (const s of this.stickies) for (const n of judgeSticky(state, this.rules, this.cells, s)) this.pushFeedback(n.userId, n.line);
    }

    // 5. paints
    paints.sort((a, b) => a.at - b.at);
    for (const ev of paints) {
      const id = this.cellId.get(ev.label)!;
      if (!this.shadow.get(id)) continue;
      if (ev.at < this.watchingSince) {
        writes.set(id, () => this.writeCell(ev.label));
        this.pushFeedback(ev.userId, `⏸ ${ev.label} reverted: no referee was watching.`);
        continue;
      }
      const before = state.cells[ev.label]!;
      const d = decidePaint(state, this.rules, this.cells, ev);
      if (d.accept) {
        this.shadow.get(id)!.fill = this.fillOf(ev.label);
        // The player's paint is already on the board; only fix the label color if it would vanish.
        const after = state.cells[ev.label]!;
        if (textColorFor(after) !== textColorFor(before)) writes.set(id, () => this.board.updateShape(id, { textColor: textColorFor(after) }));
        else writes.delete(id);
      } else writes.set(id, () => this.writeCell(ev.label));
      if (d.feedback) this.pushFeedback(ev.userId, d.feedback);
    }
    for (const t of tampers) this.pushFeedback(t.userId, decideTamper(state, this.rules, t).feedback);

    // 6. the fire: game time moves on (spread, burn-out, drying, wind, lightning, the end)
    const dt = this.lastAdvanceAt === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - this.lastAdvanceAt));
    this.lastAdvanceAt = now;
    const adv = advance(state, this.rules, this.cellList, this.byPos, this.rng, dt, now);
    for (const lab of adv.changed) {
      const id = this.cellId.get(lab);
      if (id && this.shadow.get(id)?.fill !== this.fillOf(lab)) writes.set(id, () => this.writeCell(lab));
    }
    for (const e of adv.events) this.log(`\n${e}`);

    // 7. write everything back, in parallel; one refused write must never stall the game
    await pool([...writes.values()].map((w) => () => w().catch((e: Error) => this.log(`write failed: ${e.message.split("\n")[0]}`))), this.concurrency);
    await this.flushFeedback();
    await this.updateBoards();
    const fire = Object.values(state.cells).filter((s) => s === "fire").length;
    return { paints: paints.length, tampers: tampers.length, joins, fire, changed: adv.changed.length };
  }

  private welcome(name: string, team: Team, role: "boss" | "worker"): string {
    const t = TEAM_INFO[team];
    const frame = ordersTitle(team);
    const job =
      role === "boss"
        ? `You are the BOSS: post a PLAN sticky in ${frame} (a teammate answers YES), then one ORDER per worker.`
        : `You are a WORKER: follow your ORDER sticky in ${frame}. Nothing counts until your team's PLAN is approved.`;
    return `👋 ${name}: team ${t.name} (${team}), sector ${sectorText(team)}, border ${t.color}. ${job}`;
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

  /** A new inbox card is a join: its text is "Inbox · NAME". */
  private async join(it: BoardItem) {
    const name = stripHtml(it.content).replace(/^inbox\s*[·:-]?\s*/i, "");
    const { player } = applyJoin(this.state, { userId: it.createdBy, name, at: it.createdAt }, await this.presetFor(it.createdBy, name));
    this.log(`\njoin: ${player.name} -> ${player.team} ${player.role} (${it.createdBy})`);
    this.pushFeedback(it.createdBy, this.welcome(player.name, player.team, player.role));
    if (this.state.plan[player.team]) this.pushFeedback(it.createdBy, `✅ ${teamName(player.team)} already has an approved PLAN: you may paint.`);
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
    const arr = this.feedback.get(userId) ?? [];
    arr.push(line);
    while (arr.length > FEEDBACK_LINES) arr.shift();
    this.feedback.set(userId, arr);
    this.dirty.add(userId);
  }

  private cardContent(userId: string): string {
    const p = this.state.players[userId];
    const ps = this.state.stats.byPlayer[userId];
    const paints = ps ? ps.water + ps.firebreak + ps.burnt : 0;
    const head = p ? `<b>${p.name} · Team ${TEAM_INFO[p.team].name.toUpperCase()} · ${p.role.toUpperCase()} · ${paints} paints</b>` : "<b>Inbox</b>";
    const lines = this.feedback.get(userId) ?? [];
    return [head, ...lines].map((l) => `<p>${l}</p>`).join("");
  }

  private async flushFeedback() {
    const writes: (() => Promise<unknown>)[] = [];
    for (const userId of this.dirty) {
      const id = this.inboxCard.get(userId);
      if (!id) continue;
      const content = this.cardContent(userId);
      const sh = this.shadow.get(id);
      if (sh && sh.content === stripHtml(content)) continue;
      if (sh) sh.content = stripHtml(content);
      this.touch(id);
      writes.push(() => this.board.updateShape(id, { content }).catch((e: Error) => this.log(`card write failed: ${e.message.split("\n")[0]}`)));
    }
    this.dirty.clear();
    await pool(writes, this.concurrency);
  }

  private async writeFixture(key: FixtureKey, html: string) {
    const id = this.game.fixtureIds[key];
    if (!id || this.written[key] === html) return;
    this.touch(id);
    try {
      await this.board.updateShape(id, { content: html });
    } catch (e) {
      this.log(`${key} write failed: ${(e as Error).message.split("\n")[0]}`);
      return;
    }
    this.written[key] = html;
    const sh = this.shadow.get(id);
    if (sh) sh.content = stripHtml(html);
  }

  private async updateBoards(banner?: string) {
    await pool(
      [
        () => this.writeFixture("banner", banner ? `<p>${banner}</p>` : this.bannerHtml()),
        () => this.writeFixture("scoreboard", this.scoreboardHtml()),
        () => this.writeFixture("leaderboard", this.leaderboardHtml()),
      ],
      3,
    );
  }

  // ---------- what the projector shows ----------
  bannerHtml(): string {
    const s = this.state;
    const r = this.rules;
    const mmss = (ms: number) => `${Math.floor(Math.max(0, ms) / 60_000)}:${String(Math.floor((Math.max(0, ms) % 60_000) / 1000)).padStart(2, "0")}`;
    const w = WIND[s.wind]!;
    const p = (a: string, b: string) => `<p><b>${a}</b></p><p>${b}</p>`;
    if (s.phase === "lobby") return p("🔥 WILDFIRE · /join now · the fire starts soon", `WIND ${w.arrow} blowing ${w.word} · 💧 ${s.water} water for everyone · teams: post your PLAN`);
    if (s.phase === "over") {
      const sc = scores(s, this.cellList);
      const why = s.endReason === "out" ? "the fire is out" : s.endReason === "time" ? "time is up" : "stopped";
      return p(`🏁 GAME OVER (${why}) · 🏆 ${TEAM_INFO[s.winner!].name.toUpperCase()} saved ${sc[s.winner!].pct}%`, TEAMS.map((t) => `${TEAM_INFO[t].name} ${sc[t].pct}%`).join(" · "));
    }
    const left = r.gameMinutes * 60_000 - s.elapsed;
    const spreadIn = Math.ceil((s.nextSpreadAt - s.elapsed) / 1000);
    const burning = Object.values(s.cells).filter((c) => c === "fire").length;
    const line1 = `🔥 LIVE · ${mmss(left)} left · WIND ${w.arrow} ${w.name} · next spread ${spreadIn}s · 💧 ${s.water}/${r.waterTotal}`;
    const nextBolt = s.lightningDone < r.lightningAt.length ? r.lightningAt[s.lightningDone]! * 60_000 - s.elapsed : Infinity;
    const recent = s.events.filter((e) => s.elapsed - e.at < 25_000).at(-1);
    let line2: string;
    if (nextBolt <= 90_000) line2 = `⚡ LIGHTNING WARNING · a strike in ${mmss(nextBolt)}, far from the fire`;
    else if (recent) line2 = recent.text;
    else line2 = `🌬️ wind turns in ${mmss(s.nextWindAt - s.elapsed)} · ${burning} squares burning${s.water <= 40 ? ` · 🚱 water running low!` : ""}`;
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
    const pending = pendingStickies(s, this.stickies);
    const lines: string[] = [`<b>🏆 LEADERBOARD · forest saved</b>`];
    const order = TEAMS.slice().sort((a, b) => sc[b].pct - sc[a].pct);
    for (const t of order) {
      const players = Object.entries(s.stats.byPlayer).filter(([, p]) => p.team === t);
      const tot = players.reduce((a, [, p]) => ({ w: a.w + p.water, f: a.f + p.firebreak, b: a.b + p.burnt }), { w: 0, f: 0, b: 0 });
      const boss = players.find(([, p]) => p.role === "boss")?.[1].name ?? "-";
      const top = players.map(([, p]) => p).sort((a, b) => b.water + b.firebreak + b.burnt - (a.water + a.firebreak + a.burnt)).slice(0, 3);
      const help = s.grants.filter((g) => g.helper === t).map((g) => `🤝 helping ${TEAM_INFO[g.to].name}`);
      lines.push("");
      lines.push(`<b>${TEAM_INFO[t].emoji} ${TEAM_INFO[t].name.toUpperCase()} ${sc[t].pct}% · ${players.length} players · plan ${s.plan[t] ? "✅" : "⏳"}</b>`);
      lines.push(`boss ${boss} · 💧${tot.w} 🪓${tot.f} ⬛${tot.b}${top.length ? ` · top: ${top.map((p) => `${p.name} ${p.water + p.firebreak + p.burnt}`).join(", ")}` : ""}`);
      const crew = players.filter(([, p]) => p.role === "worker").map(([, p]) => p.name);
      if (crew.length) lines.push(`crew: ${crew.join(", ")}`);
      const waiting = pending[t].map((x) => `⏳ ${x} waits for a YES`);
      if (waiting.length || help.length) lines.push([...help, ...waiting].slice(0, 2).join(" · "));
    }
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  private fixtureShape(key: FixtureKey, content: string): NewShape {
    const box = FIXTURES[key];
    const st = FIXTURE_STYLE[key];
    return { content, fill: st.fill!, ...center(box), w: box.w, h: box.h, fontSize: st.fontSize, textAlign: st.textAlign, textAlignVertical: st.textAlignVertical, textColor: st.textColor, borderColor: "#1a1a1a", borderWidth: 2 };
  }

  cellShape(cell: CellDef, fill: string): NewShape {
    const c = center(cellBox(cell));
    const st = cellStroke(cell);
    const state = this.state.cells[cell.label] ?? cell.kind;
    return { content: cell.label, fill, ...c, w: GRID.cell, h: GRID.cell, borderColor: st.color, borderWidth: st.width, textColor: textColorFor(state), fontSize: CELL_FONT, parentId: this.frameIds[frameOfRow(cell.row)] };
  }

  // ---------- results ----------
  resultsText(): string {
    const s = this.state;
    const sc = scores(s, this.cellList);
    const mins = Math.round(s.elapsed / 6000) / 10;
    const out: string[] = [
      s.phase === "over" ? `🏆 ${TEAM_INFO[s.winner!].name.toUpperCase()} WINS (${s.endReason === "out" ? "the fire went out" : s.endReason === "time" ? "time is up" : "stopped"})` : `phase: ${s.phase}`,
      `forest saved: ${TEAMS.map((t) => `${TEAM_INFO[t].name} ${sc[t].pct}%`).join(" · ")} · ${mins} min of fire`,
      `paints ${s.stats.accepted} · water left ${s.water} · ignitions ${s.stats.ignitions} (embers ${s.stats.embers}) · burnt out ${s.stats.burntOut} · lightning ${s.stats.strikes.join(" ") || "-"} · cabins lost ${s.stats.cabinsLost.join(" ") || "none"}`,
      `approvals: ${Object.values(s.approvals).filter((a) => a.status === "approved").map((a) => a.kind).join(" ") || "none"}`,
      `refused: ${Object.entries(s.stats.illegal).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
      "",
    ];
    for (const t of TEAMS) {
      const ps = Object.values(s.stats.byPlayer).filter((p) => p.team === t).sort((a, b) => b.water + b.firebreak + b.burnt - (a.water + a.firebreak + a.burnt));
      out.push(`${TEAM_INFO[t].name}: ${ps.map((p) => `${p.name}${p.role === "boss" ? " (boss)" : ""} 💧${p.water} 🪓${p.firebreak} ⬛${p.burnt}`).join(", ") || "no players"}`);
    }
    return out.join("\n");
  }
}
