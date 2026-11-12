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
  parentId?: string; // create inside this frame (x/y given absolute)
}

export interface BoardAdapter {
  /** Every item, with absolute positions. Slow on a big board (cursor-paginated, 50 per page). */
  listItems(): Promise<BoardItem[]>;
  /** Fast path: only the grid squares, read frame by frame in parallel. Absent = use listItems. */
  listGridItems?(): Promise<BoardItem[]>;
  updateShape(id: string, patch: ShapePatch): Promise<void>;
  deleteItem(id: string): Promise<void>;
  createShapes(shapes: NewShape[]): Promise<string[]>;
  /** userId -> display name for board members (REST only; the fake returns what it knows). */
  members(): Promise<Record<string, string>>;
}

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
