// The bot runner's IO on the real board, through the bot token (MiroRest). Reads are the cheap per-frame
// listings (the 9 grid bands, the 4 Orders frames) plus fixtures and cards by id; ids come from the running
// referee's state/game.json (re-read before every board read, so recreated fixtures are followed), else
// config/layout.json, else frames found by position with one full listing at startup.
import { existsSync, readFileSync } from "node:fs";
import { stripHtml } from "./board.js";
import type { CellView, StickyNote } from "./bot.js";
import type { BotIO, Fixtures } from "./bots.js";
import { GAME_FILE, loadLayoutIds } from "./config.js";
import { ICON_URL, ORDERS, RANK_SLOTS, TEAMS, buildCells, frameBoxes, parseLabel, rankKey, type Team } from "./layout.js";
import type { MiroRest } from "./miro-rest.js";
import type { GameFile } from "./referee.js";

export class MiroBotIO implements BotIO {
  private kinds = new Map(buildCells().map((c) => [c.label, c]));
  private orders: Partial<Record<Team, string>> = {};
  private fixtureIds: GameFile["fixtureIds"] = {};

  constructor(
    private rest: MiroRest,
    private gameFile = GAME_FILE,
  ) {}

  /** Ids from the referee's save (or the layout); frames by position when neither has them. */
  async init(): Promise<void> {
    this.syncIds();
    if (this.rest.frames.size === 9 && TEAMS.every((t) => this.orders[t])) return;
    await this.rest.listItems();
    const near = (f: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }) => Math.abs(f.x - b.x) < 8 && Math.abs(f.y - b.y) < 8 && Math.abs(f.w - b.w) < 16;
    const seen = [...this.rest.seenFrames];
    if (this.rest.frames.size !== 9) {
      const ids = frameBoxes().map((b) => seen.find(([, f]) => near(f, b))?.[0] ?? "");
      if (ids.every(Boolean)) this.rest.setGridFrames(ids);
    }
    for (const t of TEAMS) this.orders[t] ??= seen.find(([, f]) => near(f, ORDERS[t]))?.[0];
    if (this.rest.frames.size !== 9) throw new Error("could not find the 9 grid frames (state/game.json, config/layout.json or by position)");
  }

  private syncIds() {
    const layout = loadLayoutIds();
    let g: Partial<GameFile> = {};
    try {
      if (existsSync(this.gameFile)) g = JSON.parse(readFileSync(this.gameFile, "utf8")) as GameFile;
    } catch {
      /* mid-write: keep the ids we have */
      return;
    }
    const frames = g.frames?.length === 9 ? g.frames : layout?.frames;
    if (frames?.length === 9 && frames.every(Boolean)) this.rest.setGridFrames(frames);
    this.orders = { ...(layout?.orders ?? {}), ...this.orders, ...(g.orders ?? {}) };
    this.fixtureIds = { ...(layout?.fixtures ?? {}), ...(g.fixtureIds ?? {}) } as GameFile["fixtureIds"];
  }

  async readGrid(): Promise<CellView[]> {
    this.syncIds();
    const out: CellView[] = [];
    for (const it of await this.rest.listGridItems()) {
      if (it.type !== "shape" || it.w > 100) continue;
      const lab = stripHtml(it.content).toUpperCase();
      const def = parseLabel(lab) && this.kinds.get(lab);
      if (def) out.push({ id: it.id, label: lab, col: def.col, row: def.row, sector: def.sector, fill: (it.fill ?? "").toLowerCase() });
    }
    return out;
  }

  async readOrders(): Promise<Record<Team, StickyNote[]>> {
    const out = Object.fromEntries(TEAMS.map((t) => [t, [] as StickyNote[]])) as Record<Team, StickyNote[]>;
    const frames = TEAMS.filter((t) => this.orders[t]).map((t) => ({ id: this.orders[t]!, ...ORDERS[t] }));
    const teamOf = new Map(TEAMS.map((t) => [this.orders[t], t]));
    for (const it of await this.rest.listFrameItems(frames)) {
      const t = teamOf.get(it.parentId);
      if (t && it.type === "sticky_note") out[t].push({ id: it.id, text: stripHtml(it.content), createdBy: it.createdBy, modifiedBy: it.modifiedBy });
    }
    return out;
  }

  async readFixtures(): Promise<Fixtures> {
    const ids = this.fixtureIds;
    const keys = ["banner", "scoreboard", ...RANK_SLOTS.map(rankKey)] as const;
    const texts = await Promise.all(keys.map(async (k) => (ids[k] ? stripHtml((await this.rest.getItem(ids[k]!))?.content ?? "") : "")));
    return { banner: texts[0]!, scoreboard: texts[1]!, leaderboard: texts.slice(2).join("\n") };
  }

  async readCard(id: string): Promise<string | null> {
    const it = await this.rest.getItem(id);
    return it ? stripHtml(it.content) : null;
  }

  /** The kit's /join card: a white 380 x 150 rectangle "Inbox · NAME" in the Inbox panel. */
  async createCard(name: string, x: number, y: number): Promise<string> {
    const [id] = await this.rest.createShapes([
      { content: `Inbox · ${name}`, fill: "#ffffff", x: x + 190, y: y + 75, w: 380, h: 150, borderColor: "#e2e5ea", borderWidth: 2, textColor: "#1f2328", fontSize: 16, textAlign: "left", textAlignVertical: "top" },
    ]);
    return id!;
  }

  async paint(cellId: string, fill: string): Promise<void> {
    await this.rest.updateShape(cellId, { fill });
  }

  async postSticky(team: Team, text: string, slot: number): Promise<string> {
    const box = ORDERS[team];
    const x = box.x + 104 + (slot % 4) * 184;
    const y = box.y + 162 + (Math.floor(slot / 4) % 4) * 204;
    const id = this.orders[team];
    return this.rest.createSticky(text, x, y, id ? { id, box } : undefined);
  }

  async editSticky(id: string, text: string): Promise<void> {
    await this.rest.updateSticky(id, text);
  }

  async dropImage(x: number, y: number): Promise<string> {
    return this.rest.createImage({ url: ICON_URL.fire, x, y, w: 200 });
  }

  async dropSticky(x: number, y: number, text: string): Promise<string> {
    return this.rest.createSticky(text, x, y);
  }
}
