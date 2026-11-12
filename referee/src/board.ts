// Board adapter contract. Positions are CENTER-based canvas coordinates (Miro REST convention).

export interface BoardItem {
  id: string;
  type: "shape" | "sticky_note" | "text" | string;
  content: string; // raw (may contain <p> tags)
  fill?: string; // shape fill or sticky color name
  x: number;
  y: number;
  w: number;
  h: number;
  createdBy: string;
  modifiedBy: string;
  createdAt: number; // epoch ms
  modifiedAt: number; // epoch ms
  parentId?: string; // the frame it sits in (x/y are still absolute)
  rotation?: number; // degrees; 0 or absent = upright
  /** Shape style as the listing gives it (absent when Miro leaves it out). */
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
}

/** A Miro frame (grid band or Orders frame). Center-based like every BoardItem. */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapePatch {
  fill?: string;
  content?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  fontSize?: number;
  rotation?: number;
}

export interface NewShape {
  content: string;
  fill: string;
  x: number; // center
  y: number; // center
  w: number;
  h: number;
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  fontSize?: number;
  shape?: "rectangle" | "round_rectangle" | "circle";
  textAlign?: "left" | "center";
  textAlignVertical?: "top" | "middle";
  fontFamily?: string;
  parentId?: string; // create inside this frame (x/y given absolute)
}

/** An image placed by the referee (icons): fetched by Miro from `url`; x/y center, w width (square icons). */
export interface NewImage {
  url: string;
  x: number;
  y: number;
  w: number;
}

export interface BoardAdapter {
  /** Every item, with absolute positions. Slow on a big board (cursor-paginated, 50 per page). */
  listItems(): Promise<BoardItem[]>;
  /** One item by id, read now (GET /items/{id}): null when Miro answers 404 (it was deleted). */
  getItem?(id: string): Promise<BoardItem | null>;
  /** Items of these types only, anywhere on the board (GET /items?type=image, one cheap listing per type). */
  listByType?(types: string[]): Promise<BoardItem[]>;
  /** Fast path: only the grid squares, read frame by frame in parallel. Absent = use listItems. */
  listGridItems?(): Promise<BoardItem[]>;
  updateShape(id: string, patch: ShapePatch): Promise<void>;
  deleteItem(id: string): Promise<void>;
  createShapes(shapes: NewShape[]): Promise<string[]>;
  /** Icons: create one image, or move/resize/swap one. Absent = no icons on this board. */
  createImage?(img: NewImage): Promise<string>;
  updateImage?(id: string, p: Partial<NewImage>): Promise<void>;
  /** userId -> display name for board members (REST only; the fake returns what it knows). */
  members(): Promise<Record<string, string>>;
  /** Frames seen in the last full listing (no extra API call). Absent = frames are not guarded. */
  listFrames?(): Promise<BoardItem[]>;
  /** Create one frame (box TOP-LEFT, like layout.ts). Returns its id. */
  createFrame?(box: FrameBox, fill: string, title: string): Promise<string>;
  /** Move/resize a frame back (CENTER-based box). Its children move with it. */
  updateFrame?(id: string, box: FrameBox): Promise<void>;
  /** The 9 grid band frame ids, top band first, after the referee recreated one (fast reads). */
  setGridFrames?(ids: string[]): void;
}

/** An HTTP error from Miro, worded like the REST adapter's: "Miro PATCH /v2/boards/B/shapes/ID -> 404 {...}". */
export class MiroHttpError extends Error {
  constructor(
    public status: number,
    method: string,
    path: string,
    body = "",
  ) {
    super(`Miro ${method} ${path} -> ${status} ${body}`.trim());
  }
}

/** The HTTP status of a failed Miro call (from `.status`, else from the "-> 404" in its message). */
export function httpStatus(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  if (typeof s === "number") return s;
  const m = / -> (\d{3})\b/.exec(String((e as Error)?.message ?? e));
  return m ? Number(m[1]) : undefined;
}

/** 404: the item is gone (deleted). Rebuild it; never treat it as locked. */
export const isGone = (e: unknown) => httpStatus(e) === 404;
/** 403 (or a message saying "locked"): the token may not change this item. */
export const isLocked = (e: unknown) => httpStatus(e) === 403 || /\blocked\b/i.test(String((e as Error)?.message ?? e));

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    // Miro returns apostrophes and emoji as numeric entities (&#39;, &#x1f44b;).
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // last, so "&amp;lt;" stays "&lt;"
    .trim();
}

/** Run async tasks with at most `limit` in flight (Miro limits credits per minute, not connections). */
export async function pool(tasks: (() => Promise<unknown>)[], limit = 10): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]!();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
