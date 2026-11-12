// In-memory board with the same contract as the REST adapter, plus helpers that act AS A PLAYER (or a
// vandal), and switches that make Miro misbehave the way it did in class: 429s, 5xx, timeouts, partial
// pages, locked items, items that vanish between a read and a write, writes that land but still throw.
import type { BoardAdapter, BoardItem, FrameBox, NewShape, ShapePatch } from "./board.js";
import { BACKDROP, FIXTURES, ORDERS, PANELS, TEAMS, buildCells, cellBox, center, frameBoxes, frameOfRow, ordersTitle, startFill, type Box, type Team } from "./layout.js";
import { mulberry32, type Rng } from "./rules.js";

export const REFEREE_USER = "referee";
export const STICKY = { w: 160, h: 184 };

/** Miro's REST API returns item text with apostrophes and emoji as numeric HTML entities. */
export function miroEncode(s: string): string {
  return s.replace(/'/g, "&#39;").replace(/[\u{10000}-\u{10FFFF}]/gu, (c) => `&#x${c.codePointAt(0)!.toString(16)};`);
}

const toHtml = (text: string) => (text.startsWith("<p>") ? text : text.split("\n").map((l) => `<p>${l}</p>`).join(""));

/** How Miro misbehaves. Every rate is a probability per API call; counters fail the next N calls. */
export interface Faults {
  rate429: number;
  rate5xx: number;
  rateTimeout: number;
  /** A write that reaches Miro and is applied, but the response is lost (the caller sees an error). */
  rateGhost: number;
  failNextWrites: number;
  failNextReads: number;
  /** The next N full listings silently drop one page (50 items), like a cursor that skipped. */
  partialNextLists: number;
}

export class MiroError extends Error {
  constructor(
    public status: number,
    what: string,
  ) {
    super(`Miro ${what} -> ${status}`);
  }
}

export class FakeBoard implements BoardAdapter {
  items = new Map<string, BoardItem>();
  frames = new Map<string, BoardItem>();
  private seq = 1000;
  now: () => number;
  names: Record<string, string> = {};
  calls = { list: 0, grid: 0, update: 0, delete: 0, create: 0, frame: 0, failed: 0 };
  /** Set (or call enableFastReads) to exercise the referee's fast (per-frame) read path. */
  listGridItems?: () => Promise<BoardItem[]>;
  private byLabel = new Map<string, string>();
  /** Grid band frames, top band first, and where each was built (the REST adapter's configured boxes). */
  gridFrameIds: string[] = [];
  ordersFrameIds = {} as Record<Team, string>;
  private builtBox = new Map<string, Box>();
  staticIds: string[] = [];
  /** Locked items refuse every write and delete from the referee (players can still have changed them first). */
  locked = new Set<string>();
  /** These items disappear right before the referee's next write to them reaches Miro. */
  vanishOnWrite = new Set<string>();
  faults: Faults = { rate429: 0, rate5xx: 0, rateTimeout: 0, rateGhost: 0, failNextWrites: 0, failNextReads: 0, partialNextLists: 0 };
  rng: Rng = mulberry32(99);

  constructor(now: () => number) {
    this.now = now;
  }

  /** The starting board as the MCP build makes it: backdrop, panels, 9 grid frames with every square, Orders frames, banner, scoreboard. */
  static seeded(now: () => number): FakeBoard {
    const b = new FakeBoard(now);
    const box = (bx: Box) => ({ ...center(bx), w: bx.w, h: bx.h });
    b.staticIds.push(b.add({ type: "shape", content: "", fill: "#0e1311", ...box(BACKDROP) }, REFEREE_USER).id);
    b.staticIds.push(b.add({ type: "text", content: "<p><b>🔥 WILDFIRE</b></p>", ...box(PANELS.title) }, REFEREE_USER).id);
    b.staticIds.push(b.add({ type: "shape", content: "<p>HOW WILDFIRE WORKS</p>", fill: "#161d19", ...box(PANELS.rules) }, REFEREE_USER).id);
    b.gridFrameIds = frameBoxes().map((fb) => b.addFrame(fb, "#0e1311", ""));
    for (const t of TEAMS) b.ordersFrameIds[t] = b.addFrame(ORDERS[t], "#161d19", ordersTitle(t));
    for (const cell of buildCells()) {
      const c = center(cellBox(cell));
      const it = b.add({ type: "shape", content: `<p>${cell.label}</p>`, fill: startFill(cell), x: c.x, y: c.y, w: 60, h: 60, parentId: b.gridFrameIds[frameOfRow(cell.row)] }, REFEREE_USER);
      b.byLabel.set(cell.label, it.id);
    }
    for (const key of ["banner", "scoreboard"] as const) {
      const fb = FIXTURES[key];
      b.add({ type: "shape", content: "<p>WILDFIRE</p>", fill: "#161d19", ...center(fb), w: fb.w, h: fb.h }, REFEREE_USER);
    }
    return b;
  }

  add(partial: Omit<BoardItem, "id" | "createdBy" | "modifiedBy" | "createdAt" | "modifiedAt">, user: string, at = this.now()): BoardItem {
    const item: BoardItem = { ...partial, content: miroEncode(partial.content), id: String(this.seq++), createdBy: user, modifiedBy: user, createdAt: at, modifiedAt: at };
    this.items.set(item.id, item);
    return item;
  }

  /** A frame (box TOP-LEFT). */
  addFrame(bx: Box, fill: string, title: string, user = REFEREE_USER): string {
    const id = String(this.seq++);
    const at = this.now();
    this.frames.set(id, { id, type: "frame", content: title, fill, ...center(bx), w: bx.w, h: bx.h, createdBy: user, modifiedBy: user, createdAt: at, modifiedAt: at });
    this.builtBox.set(id, bx);
    return id;
  }

  find(pred: (i: BoardItem) => boolean): BoardItem | undefined {
    for (const i of this.items.values()) if (pred(i)) return i;
    return undefined;
  }

  /** The square a player sees for this label: the one on top (newest) wins, like on the canvas. */
  cell(label: string): BoardItem {
    const cached = this.items.get(this.byLabel.get(label) ?? "");
    const all = [...this.items.values()].filter((i) => i.type === "shape" && i.content === `<p>${label}</p>`);
    const top = all.sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (cached && top?.id === cached.id) return cached;
    if (!top) throw new Error(`no cell ${label}`);
    this.byLabel.set(label, top.id);
    return top;
  }

  // ---- faults ----
  private roll(p: number): boolean {
    return p > 0 && this.rng() < p;
  }

  private readFault(what: string) {
    if (this.faults.failNextReads > 0) {
      this.faults.failNextReads--;
      this.calls.failed++;
      throw new MiroError(503, `GET ${what}`);
    }
    if (this.roll(this.faults.rate429)) throw (this.calls.failed++, new MiroError(429, `GET ${what}`));
    if (this.roll(this.faults.rate5xx)) throw (this.calls.failed++, new MiroError(502, `GET ${what}`));
    if (this.roll(this.faults.rateTimeout)) throw (this.calls.failed++, new Error(`GET ${what}: The operation was aborted due to timeout`));
  }

  /** Before a referee write: may throw like Miro does. Returns true when the write should land but still throw (ghost). */
  private writeFault(what: string, id?: string): boolean {
    if (id && this.vanishOnWrite.has(id)) {
      this.vanishOnWrite.delete(id);
      this.items.delete(id);
    }
    if (id && !this.items.has(id) && !this.frames.has(id)) throw (this.calls.failed++, new MiroError(404, `${what} ${id}`));
    if (id && this.locked.has(id)) throw (this.calls.failed++, new MiroError(403, `${what} ${id} (locked)`));
    if (this.faults.failNextWrites > 0) {
      this.faults.failNextWrites--;
      this.calls.failed++;
      throw new MiroError(500, what);
    }
    if (this.roll(this.faults.rate429)) throw (this.calls.failed++, new MiroError(429, what));
    if (this.roll(this.faults.rate5xx)) throw (this.calls.failed++, new MiroError(503, what));
    if (this.roll(this.faults.rateTimeout)) throw (this.calls.failed++, new Error(`${what}: The operation was aborted due to timeout`));
    return this.roll(this.faults.rateGhost);
  }

  // ---- adapter (acts as the referee) ----
  async listItems(): Promise<BoardItem[]> {
    this.calls.list++;
    this.readFault("items");
    let all = [...this.items.values()].map((i) => ({ ...i }));
    if (this.faults.partialNextLists > 0) {
      this.faults.partialNextLists--;
      const start = Math.floor(this.rng() * Math.max(1, all.length - 50));
      all = [...all.slice(0, start), ...all.slice(start + 50)];
    }
    return all;
  }

  /** Per-frame reads, like MiroRest: positions come back relative to each frame, placed on its BUILT box. */
  enableFastReads(): void {
    this.listGridItems = async () => {
      this.calls.grid++;
      this.readFault("grid");
      const out: BoardItem[] = [];
      for (const fid of this.gridFrameIds) {
        const f = this.frames.get(fid);
        if (!f) throw new MiroError(404, `GET items?parent_item_id=${fid}`);
        const built = this.builtBox.get(fid)!;
        const dx = f.x - f.w / 2 - built.x;
        const dy = f.y - f.h / 2 - built.y;
        for (const i of this.items.values()) if (i.parentId === fid) out.push({ ...i, x: i.x - dx, y: i.y - dy });
      }
      return out;
    };
  }

  async listFrames(): Promise<BoardItem[]> {
    return [...this.frames.values()].map((f) => ({ ...f }));
  }

  async createFrame(box: FrameBox, fill: string, title: string): Promise<string> {
    this.calls.frame++;
    if (this.writeFault("POST frames")) {
      this.addFrame(box, fill, title);
      throw new MiroError(504, "POST frames");
    }
    return this.addFrame(box, fill, title);
  }

  async updateFrame(id: string, box: FrameBox): Promise<void> {
    this.calls.frame++;
    this.writeFault("PATCH frames", id);
    this.moveFrameTo(id, box, REFEREE_USER);
  }

  setGridFrames(ids: string[]): void {
    this.gridFrameIds = [...ids];
  }

  async updateShape(id: string, patch: ShapePatch): Promise<void> {
    this.calls.update++;
    const ghost = this.writeFault("PATCH shapes", id);
    const it = this.items.get(id)!;
    this.apply(it, patch, REFEREE_USER);
    if (ghost) throw new MiroError(504, `PATCH shapes ${id}`);
  }

  async deleteItem(id: string): Promise<void> {
    this.calls.delete++;
    if (this.frames.has(id)) {
      this.writeFault("DELETE items", id);
      this.deleteFrame(id);
      return;
    }
    if (!this.items.has(id)) throw (this.calls.failed++, new MiroError(404, `DELETE items ${id}`));
    const ghost = this.writeFault("DELETE items", id);
    this.items.delete(id);
    if (ghost) throw new MiroError(504, `DELETE items ${id}`);
  }

  async createShapes(shapes: NewShape[]): Promise<string[]> {
    this.calls.create++;
    for (const s of shapes) if (s.parentId && !this.frames.has(s.parentId)) throw (this.calls.failed++, new MiroError(404, `POST items/bulk (parent ${s.parentId})`));
    const ghost = this.writeFault("POST items/bulk");
    const ids = shapes.map((s) => this.add({ type: "shape", content: `<p>${s.content}</p>`, fill: s.fill, x: s.x, y: s.y, w: s.w, h: s.h, parentId: s.parentId }, REFEREE_USER).id);
    if (ghost) throw new MiroError(504, "POST items/bulk");
    return ids;
  }

  async members(): Promise<Record<string, string>> {
    return { ...this.names };
  }

  private apply(it: BoardItem, patch: ShapePatch, user: string, at = this.now()) {
    if (patch.fill !== undefined) it.fill = patch.fill;
    if (patch.content !== undefined) it.content = miroEncode(toHtml(patch.content));
    if (patch.x !== undefined) it.x = patch.x;
    if (patch.y !== undefined) it.y = patch.y;
    if (patch.w !== undefined) it.w = patch.w;
    if (patch.h !== undefined) it.h = patch.h;
    if (patch.rotation !== undefined) it.rotation = patch.rotation;
    it.modifiedBy = user;
    it.modifiedAt = at;
  }

  private moveFrameTo(id: string, box: FrameBox, user: string, at = this.now()) {
    const f = this.frames.get(id)!;
    const dx = box.x - f.x;
    const dy = box.y - f.y;
    Object.assign(f, { x: box.x, y: box.y, w: box.w, h: box.h, modifiedBy: user, modifiedAt: at });
    // Children move with their frame (Miro keeps their position relative to it).
    for (const i of this.items.values()) {
      if (i.parentId !== id) continue;
      i.x += dx;
      i.y += dy;
    }
  }

  // ---- helpers that act as a PLAYER (what an agent does through MCP) ----
  playerPaint(user: string, label: string, fill: string, at = this.now()): void {
    this.apply(this.cell(label), { fill }, user, at);
  }

  playerEdit(user: string, id: string, patch: ShapePatch, at = this.now()): void {
    const it = this.items.get(id);
    if (!it) throw new Error(`playerEdit: ${id} not found`);
    // Dragging a square out of its frame takes it out of the frame.
    if (it.parentId && (patch.x !== undefined || patch.y !== undefined)) {
      const f = this.frames.get(it.parentId);
      const x = patch.x ?? it.x;
      const y = patch.y ?? it.y;
      if (f && (Math.abs(x - f.x) > f.w / 2 || Math.abs(y - f.y) > f.h / 2)) it.parentId = undefined;
    }
    this.apply(it, patch, user, at);
  }

  /** Deletes can't be attributed in Miro: nothing records who did it. */
  playerDelete(id: string): void {
    this.items.delete(id);
  }

  /** A player (or their agent) locks an item: the referee's token can no longer change or delete it. */
  lock(id: string): void {
    this.locked.add(id);
  }

  unlock(id: string): void {
    this.locked.delete(id);
  }

  /** Deleting a frame in Miro deletes everything in it. */
  deleteFrame(id: string): void {
    this.frames.delete(id);
    for (const [iid, i] of [...this.items]) if (i.parentId === id) this.items.delete(iid);
  }

  moveFrame(user: string, id: string, dx: number, dy: number): void {
    const f = this.frames.get(id)!;
    this.moveFrameTo(id, { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h }, user);
  }

  resizeFrame(user: string, id: string, w: number, h: number): void {
    const f = this.frames.get(id)!;
    Object.assign(f, { w, h, modifiedBy: user, modifiedAt: this.now() });
  }

  /** Drop anything anywhere (an image, a shape, a sticky, a text, a giant cover). Center-based box. */
  vandalAdd(user: string, type: string, box: { x: number; y: number; w: number; h: number }, content = "", fill?: string): BoardItem {
    return this.add({ type, content: content ? toHtml(content) : "", fill, ...box }, user);
  }

  playerJoin(user: string, name: string, at = this.now()): { card: BoardItem } {
    const inbox = PANELS.inbox;
    const card = this.add({ type: "shape", content: `<p>Inbox · ${name}</p>`, fill: "#161d19", x: inbox.x + 300, y: inbox.y + 200, w: 380, h: 150 }, user, at);
    return { card };
  }

  /** Post a sticky note inside a team's Orders frame (one line per \n). */
  playerSticky(user: string, team: Team, text: string, at = this.now()): BoardItem {
    const box = ORDERS[team];
    const n = [...this.items.values()].filter((i) => i.type === "sticky_note").length;
    const x = box.x + 104 + (n % 4) * 184;
    const y = box.y + 162 + (Math.floor(n / 4) % 4) * 204;
    return this.add({ type: "sticky_note", content: toHtml(text), fill: "light_yellow", x, y, w: STICKY.w, h: STICKY.h, parentId: this.ordersFrameIds[team] }, user, at);
  }

  /** Edit a sticky's text (e.g. add a YES line) as `user`. */
  playerEditSticky(user: string, id: string, text: string, at = this.now()): void {
    this.playerEdit(user, id, { content: text }, at);
  }

  inboxText(user: string): string {
    const card = this.find((i) => (i.type === "shape" || i.type === "sticky_note") && i.createdBy === user && i.y > PANELS.inbox.y);
    return card ? card.content : "";
  }
}
