// Miro REST API v2 adapter (native fetch). Endpoints verified against developers.miro.com on 2026-11-10:
//   GET    /v2/boards/{board_id}/items?limit=50&cursor=      (Level 2, cursor-paginated)
//   GET    /v2/boards/{board_id}/items?parent_item_id=FRAME  (children of a frame; positions relative to its top-left)
//   POST   /v2/boards/{board_id}/frames                      (Level 2)
//   PATCH  /v2/boards/{board_id}/shapes/{item_id}            (Level 2)
//   PATCH  /v2/boards/{board_id}/sticky_notes/{item_id}      (Level 2)
//   DELETE /v2/boards/{board_id}/items/{item_id}             (Level 3)
//   POST   /v2/boards/{board_id}/items/bulk                  (Level 2, max 20 items)
//   GET    /v2/boards/{board_id}/members?limit=50&cursor=    (Level 1)
//   GET    /v1/oauth-token                                   (token context: user id, team, scopes)
// Global limit: 100,000 credits/min per user per app; 429 carries X-RateLimit-Reset.
import { pool, type BoardAdapter, type BoardItem, type FrameBox, type NewShape, type ShapePatch } from "./board.js";
import { frameBoxes, type Box } from "./layout.js";

const API = "https://api.miro.com";

interface RawItem {
  id: string;
  type: string;
  data?: { content?: string; title?: string };
  style?: { fillColor?: string };
  position?: { x: number; y: number; relativeTo?: string };
  geometry?: { width?: number; height?: number; rotation?: number };
  parent?: { id?: string };
  createdBy?: { id: string };
  modifiedBy?: { id: string };
  createdAt?: string;
  modifiedAt?: string;
}

export class MiroRest implements BoardAdapter {
  /** Grid frames: id -> top-left box. Set from config/layout.json; enables listGridItems. */
  frames = new Map<string, Box>();
  private parentOf = new Map<string, string>(); // item id -> frame id
  private typeOf = new Map<string, string>(); // item id -> type (sticky notes patch at another endpoint)
  /** Every frame seen in the last full listing: id -> box + title. */
  seenFrames = new Map<string, Box & { title: string }>();
  private rawFrames: RawItem[] = [];
  constructor(
    private token: string,
    private boardId: string,
    private log: (s: string) => void = () => {},
  ) {}

  private get b(): string {
    return `/v2/boards/${encodeURIComponent(this.boardId)}`;
  }

  private toItem(r: RawItem, frame?: Box): BoardItem {
    const dx = frame && r.position?.relativeTo === "parent_top_left" ? frame.x : 0;
    const dy = frame && r.position?.relativeTo === "parent_top_left" ? frame.y : 0;
    this.typeOf.set(r.id, r.type);
    if (r.parent?.id) this.parentOf.set(r.id, r.parent.id);
    else if (!frame) this.parentOf.delete(r.id);
    return {
      id: r.id,
      type: r.type,
      content: r.data?.content ?? "",
      fill: r.style?.fillColor,
      x: (r.position?.x ?? 0) + dx,
      y: (r.position?.y ?? 0) + dy,
      w: r.geometry?.width ?? 0,
      h: r.geometry?.height ?? 0,
      createdBy: r.createdBy?.id ?? "",
      modifiedBy: r.modifiedBy?.id ?? "",
      createdAt: Date.parse(r.createdAt ?? "") || 0,
      modifiedAt: Date.parse(r.modifiedAt ?? "") || 0,
      parentId: r.parent?.id,
      rotation: r.geometry?.rotation || undefined,
    };
  }

  private async pages(query: string): Promise<RawItem[]> {
    const out: RawItem[] = [];
    let cursor = "";
    for (;;) {
      const page = await this.req<{ data: RawItem[]; cursor?: string }>("GET", `${this.b}/items?limit=50${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      out.push(...(page.data ?? []));
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  }

  async listGridItems(): Promise<BoardItem[]> {
    const out: BoardItem[] = [];
    await pool(
      [...this.frames].map(([id, box]) => async () => {
        for (const r of await this.pages(`&parent_item_id=${id}`)) out.push(this.toItem(r, box));
      }),
      12,
    );
    return out;
  }

  private async req<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // Network blips (timeouts, resets) are retried; they must never crash a live game.
      if (attempt >= 4) throw e;
      this.log(`network error (${(e as Error).message}); retrying`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return this.req(method, path, body, attempt + 1);
    }
    if (res.status >= 500 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return this.req(method, path, body, attempt + 1);
    }
    if (res.status === 429 && attempt < 5) {
      const reset = Number(res.headers.get("X-RateLimit-Reset"));
      // Never sleep longer than 20 s inside one call: the referee would rather skip a tick and try again.
      const waitMs = Math.min(20_000, Number.isFinite(reset) && reset > 0 ? Math.max(1000, reset * 1000 - Date.now()) : 2000 * 2 ** attempt);
      this.log(`429 rate limited; waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.req(method, path, body, attempt + 1);
    }
    if (!res.ok) throw new Error(`Miro ${method} ${path} -> ${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async tokenContext(): Promise<{ userId: string; userName: string; teamId: string; scopes: string[] }> {
    const r = await this.req<{ user: { id: string; name: string }; team: { id: string }; scopes: string[] }>("GET", "/v1/oauth-token");
    return { userId: r.user.id, userName: r.user.name, teamId: r.team.id, scopes: r.scopes };
  }

  async listItems(): Promise<BoardItem[]> {
    const raw = await this.pages("");
    const frameBox = new Map<string, Box>();
    this.seenFrames.clear();
    this.rawFrames = raw.filter((r) => r.type === "frame");
    for (const r of raw) {
      if (r.type !== "frame") continue;
      const w = r.geometry?.width ?? 0;
      const h = r.geometry?.height ?? 0;
      const box = { x: (r.position?.x ?? 0) - w / 2, y: (r.position?.y ?? 0) - h / 2, w, h };
      frameBox.set(r.id, box);
      this.seenFrames.set(r.id, { ...box, title: r.data?.title ?? "" });
    }
    return raw.filter((r) => r.type !== "frame").map((r) => this.toItem(r, r.parent?.id ? (frameBox.get(r.parent.id) ?? this.frames.get(r.parent.id)) : undefined));
  }

  /** Frames from the last full listing (center-based, like every item). */
  async listFrames(): Promise<BoardItem[]> {
    return this.rawFrames.map((r) => ({ ...this.toItem(r), content: r.data?.title ?? "" }));
  }

  async createFrame(box: FrameBox, fill: string, title: string): Promise<string> {
    const [id] = await this.createFrames([{ ...box, title }], fill);
    return id!;
  }

  /** Move/resize a frame back (center-based box); Miro moves its children with it. */
  async updateFrame(id: string, box: FrameBox): Promise<void> {
    await this.req("PATCH", `${this.b}/frames/${id}`, { position: { x: box.x, y: box.y }, geometry: { width: box.w, height: box.h } });
  }

  /** The 9 grid band frames, top band first (after the referee recreated one). */
  setGridFrames(ids: string[]): void {
    const boxes = frameBoxes();
    this.frames.clear();
    ids.forEach((id, i) => id && boxes[i] && this.frames.set(id, boxes[i]!));
  }

  /** Create frames (dark grid bands have no title). Returns their ids in order. */
  async createFrames(boxes: (Box & { title?: string })[], fill: string): Promise<string[]> {
    const ids: string[] = [];
    for (const b of boxes) {
      const r = await this.req<{ id: string }>("POST", `${this.b}/frames`, {
        data: { format: "custom", type: "freeform", title: b.title ?? "", showContent: true },
        style: { fillColor: fill },
        position: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        geometry: { width: b.w, height: b.h },
      });
      ids.push(r.id);
      this.frames.set(r.id, b);
    }
    return ids;
  }

  /** Bulk-create text items (titles, headers, rules). */
  async createTexts(texts: { content: string; x: number; y: number; w: number; fontSize: number; color?: string; align?: "left" | "center" | "right" }[]): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < texts.length; i += 20) {
      const chunk = texts.slice(i, i + 20).map((t) => ({
        type: "text",
        data: { content: t.content },
        style: { fontSize: String(t.fontSize), color: t.color ?? "#1a1a1a", textAlign: t.align ?? "left", fontFamily: "noto_sans" },
        position: { x: t.x + t.w / 2, y: t.y },
        geometry: { width: t.w },
      }));
      const r = await this.req<{ data: { id: string }[] }>("POST", `${this.b}/items/bulk`, chunk);
      ids.push(...r.data.map((d) => d.id));
    }
    return ids;
  }

  async updateShape(id: string, p: ShapePatch): Promise<void> {
    if (this.typeOf.get(id) === "sticky_note") {
      // An inbox card made as a sticky note: only its text and place can change.
      const body: Record<string, unknown> = {};
      if (p.content !== undefined) body.data = { content: p.content };
      if (p.x !== undefined && p.y !== undefined) body.position = { x: p.x, y: p.y };
      await this.req("PATCH", `${this.b}/sticky_notes/${id}`, body);
      return;
    }
    if (this.typeOf.get(id) === "text") {
      // A static text (title, rules, headers) put back after a vandal edited or moved it.
      const body: Record<string, unknown> = {};
      if (p.content !== undefined) body.data = { content: p.content };
      if (p.x !== undefined && p.y !== undefined) body.position = { x: p.x, y: p.y };
      if (p.w !== undefined) body.geometry = { width: p.w, ...(p.rotation !== undefined ? { rotation: p.rotation } : {}) };
      await this.req("PATCH", `${this.b}/texts/${id}`, body);
      return;
    }
    const body: Record<string, unknown> = {};
    if (p.content !== undefined) body.data = { content: p.content };
    const style: Record<string, unknown> = {};
    if (p.fill !== undefined) style.fillColor = p.fill;
    if (p.borderColor !== undefined) style.borderColor = p.borderColor;
    if (p.borderWidth !== undefined) style.borderWidth = String(p.borderWidth);
    if (p.textColor !== undefined) style.color = p.textColor;
    if (p.fontSize !== undefined) style.fontSize = String(p.fontSize);
    if (Object.keys(style).length) body.style = style;
    if (p.x !== undefined && p.y !== undefined) {
      const f = this.frames.get(this.parentOf.get(id) ?? "");
      body.position = f ? { x: p.x - f.x, y: p.y - f.y } : { x: p.x, y: p.y };
    }
    if (p.w !== undefined && p.h !== undefined) body.geometry = { width: p.w, height: p.h, ...(p.rotation !== undefined ? { rotation: p.rotation } : {}) };
    else if (p.rotation !== undefined) body.geometry = { rotation: p.rotation };
    await this.req("PATCH", `/v2/boards/${encodeURIComponent(this.boardId)}/shapes/${id}`, body);
  }

  async deleteItem(id: string): Promise<void> {
    await this.req("DELETE", `/v2/boards/${encodeURIComponent(this.boardId)}/items/${id}`);
  }

  async createShapes(shapes: NewShape[]): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < shapes.length; i += 20) {
      const chunk = shapes.slice(i, i + 20).map((s) => ({
        type: "shape",
        data: { content: s.content, shape: s.shape ?? "rectangle" },
        style: {
          fillColor: s.fill,
          borderColor: s.borderColor ?? "#1a1a1a",
          borderWidth: String(s.borderWidth ?? 2),
          color: s.textColor ?? "#1a1a1a",
          fontSize: String(s.fontSize ?? 14),
          textAlign: s.textAlign ?? "center",
          textAlignVertical: s.textAlignVertical ?? "middle",
        },
        position: s.parentId && this.frames.get(s.parentId) ? { x: s.x - this.frames.get(s.parentId)!.x, y: s.y - this.frames.get(s.parentId)!.y } : { x: s.x, y: s.y },
        geometry: { width: s.w, height: s.h },
        ...(s.parentId ? { parent: { id: s.parentId } } : {}),
      }));
      const r = await this.req<{ data: { id: string }[] }>("POST", `/v2/boards/${encodeURIComponent(this.boardId)}/items/bulk`, chunk);
      ids.push(...r.data.map((d) => d.id));
      shapes.slice(i, i + 20).forEach((s, k) => s.parentId && this.parentOf.set(r.data[k]!.id, s.parentId));
    }
    return ids;
  }

  async members(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    let cursor = "";
    for (;;) {
      const page = await this.req<{ data: { id: string; name: string }[]; cursor?: string }>("GET", `/v2/boards/${encodeURIComponent(this.boardId)}/members?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const m of page.data ?? []) out[m.id] = m.name;
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  }
}
