// In-memory board with the same contract as the REST adapter, plus helpers that act AS A PLAYER.
import type { BoardAdapter, BoardItem, NewShape, ShapePatch } from "./board.js";
import { FIXTURES, ORDERS, PANELS, buildCells, cellBox, center, startFill, type Team } from "./layout.js";

export const REFEREE_USER = "referee";
export const STICKY = { w: 160, h: 184 };

/** Miro's REST API returns item text with apostrophes and emoji as numeric HTML entities. */
export function miroEncode(s: string): string {
  return s.replace(/'/g, "&#39;").replace(/[\u{10000}-\u{10FFFF}]/gu, (c) => `&#x${c.codePointAt(0)!.toString(16)};`);
}

const toHtml = (text: string) => (text.startsWith("<p>") ? text : text.split("\n").map((l) => `<p>${l}</p>`).join(""));

export class FakeBoard implements BoardAdapter {
  items = new Map<string, BoardItem>();
  private seq = 1000;
  now: () => number;
  names: Record<string, string> = {};
  calls = { list: 0, update: 0, delete: 0, create: 0 };
  /** Set in a test to exercise the referee's fast (per-frame) read path. */
  listGridItems?: () => Promise<BoardItem[]>;
  private byLabel = new Map<string, string>();

  constructor(now: () => number) {
    this.now = now;
  }

  /** The starting board: every square + banner + scoreboard, as the MCP build makes it. */
  static seeded(now: () => number): FakeBoard {
    const b = new FakeBoard(now);
    for (const cell of buildCells()) {
      const c = center(cellBox(cell));
      const it = b.add({ type: "shape", content: `<p>${cell.label}</p>`, fill: startFill(cell), x: c.x, y: c.y, w: 60, h: 60 }, REFEREE_USER);
      b.byLabel.set(cell.label, it.id);
    }
    for (const key of ["banner", "scoreboard"] as const) {
      const box = FIXTURES[key];
      b.add({ type: "shape", content: "<p>WILDFIRE</p>", fill: "#ffffff", ...center(box), w: box.w, h: box.h }, REFEREE_USER);
    }
    return b;
  }

  add(partial: Omit<BoardItem, "id" | "createdBy" | "modifiedBy" | "createdAt" | "modifiedAt">, user: string, at = this.now()): BoardItem {
    const item: BoardItem = { ...partial, content: miroEncode(partial.content), id: String(this.seq++), createdBy: user, modifiedBy: user, createdAt: at, modifiedAt: at };
    this.items.set(item.id, item);
    return item;
  }

  find(pred: (i: BoardItem) => boolean): BoardItem | undefined {
    for (const i of this.items.values()) if (pred(i)) return i;
    return undefined;
  }

  cell(label: string): BoardItem {
    const cached = this.items.get(this.byLabel.get(label) ?? "");
    if (cached && cached.content === `<p>${label}</p>`) return cached;
    const it = this.find((i) => i.type === "shape" && i.content === `<p>${label}</p>`);
    if (!it) throw new Error(`no cell ${label}`);
    this.byLabel.set(label, it.id);
    return it;
  }

  // ---- adapter (acts as the referee) ----
  async listItems(): Promise<BoardItem[]> {
    this.calls.list++;
    return [...this.items.values()].map((i) => ({ ...i }));
  }

  async updateShape(id: string, patch: ShapePatch): Promise<void> {
    this.calls.update++;
    const it = this.items.get(id);
    if (!it) throw new Error(`updateShape: ${id} not found`);
    this.apply(it, patch, REFEREE_USER);
  }

  async deleteItem(id: string): Promise<void> {
    this.calls.delete++;
    this.items.delete(id);
  }

  async createShapes(shapes: NewShape[]): Promise<string[]> {
    this.calls.create++;
    return shapes.map((s) => this.add({ type: "shape", content: `<p>${s.content}</p>`, fill: s.fill, x: s.x, y: s.y, w: s.w, h: s.h }, REFEREE_USER).id);
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
    it.modifiedBy = user;
    it.modifiedAt = at;
  }

  // ---- helpers that act as a PLAYER (what an agent does through MCP) ----
  playerPaint(user: string, label: string, fill: string, at = this.now()): void {
    this.apply(this.cell(label), { fill }, user, at);
  }

  playerEdit(user: string, id: string, patch: ShapePatch, at = this.now()): void {
    const it = this.items.get(id);
    if (!it) throw new Error(`playerEdit: ${id} not found`);
    this.apply(it, patch, user, at);
  }

  playerDelete(id: string): void {
    this.items.delete(id);
  }

  playerJoin(user: string, name: string, at = this.now()): { card: BoardItem } {
    const inbox = PANELS.inbox;
    const card = this.add({ type: "shape", content: `<p>Inbox · ${name}</p>`, fill: "#ffffff", x: inbox.x + 300, y: inbox.y + 200, w: 380, h: 150 }, user, at);
    return { card };
  }

  /** Post a sticky note inside a team's Orders frame (one line per \n). */
  playerSticky(user: string, team: Team, text: string, at = this.now()): BoardItem {
    const box = ORDERS[team];
    const n = [...this.items.values()].filter((i) => i.type === "sticky_note").length;
    const x = box.x + 104 + (n % 4) * 184;
    const y = box.y + 162 + (Math.floor(n / 4) % 4) * 204;
    return this.add({ type: "sticky_note", content: toHtml(text), fill: "light_yellow", x, y, w: STICKY.w, h: STICKY.h }, user, at);
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
