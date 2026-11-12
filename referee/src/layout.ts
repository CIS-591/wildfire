// Board geometry shared by the referee, the MCP-built board and the student kit (SPEC.md section 1).
// All x/y here are TOP-LEFT in Miro canvas units (the MCP SVG convention).
// The REST API positions items by CENTER; use center() to convert.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Team = "ridge" | "pine" | "cedar" | "birch";
export const TEAMS: Team[] = ["ridge", "pine", "cedar", "birch"];

/** What a square is at the start of the game (never changes). */
export type CellKind = "forest" | "cabin" | "river";
/** What a square is right now. */
export type CellState = "forest" | "cabin" | "river" | "fire" | "water" | "firebreak" | "burnt";
export const CELL_STATES: CellState[] = ["forest", "cabin", "river", "fire", "water", "firebreak", "burnt"];

export interface CellDef {
  label: string;
  col: number; // 0-based, A = 0
  row: number; // 0-based, 1 = 0
  kind: CellKind;
  sector: Team;
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GRID = { cols: 36, rows: 34, cell: 60, pitch: 64, originX: 0, originY: 0 };
export const CELL_FONT = 20;

/** Square fills (lowercase hex). config/colors.json, so a refused color (brown) can be swapped. */
const colorFile = path.resolve(import.meta.dirname, "../config/colors.json");
export const STATE_COLOR = JSON.parse(readFileSync(colorFile, "utf8")) as Record<CellState, string>;

export const COLORS = {
  ...STATE_COLOR,
  frame: "#3d4250",
  backdrop: "#262a33",
  ink: "#1a1a1a",
  paper: "#ffffff",
};

export interface TeamInfo {
  name: string;
  color: string;
  cols: [number, number]; // inclusive, 0-based
  rows: [number, number];
  emoji: string;
  neighbours: Team[];
}

export const TEAM_INFO: Record<Team, TeamInfo> = {
  ridge: { name: "Ridge", color: "#b384bb", cols: [0, 17], rows: [0, 16], emoji: "🟪", neighbours: ["pine", "cedar"] },
  pine: { name: "Pine Valley", color: "#ea94bb", cols: [18, 35], rows: [0, 16], emoji: "🌸", neighbours: ["ridge", "birch"] },
  cedar: { name: "Cedar Creek", color: "#7b92ff", cols: [0, 17], rows: [17, 33], emoji: "🟦", neighbours: ["ridge", "birch"] },
  birch: { name: "Birch Hollow", color: "#ffffff", cols: [18, 35], rows: [17, 33], emoji: "⬜", neighbours: ["pine", "cedar"] },
};

export const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Spreadsheet-style column names: A..Z, then AA, AB, ... */
export function colName(col: number): string {
  return col < 26 ? COL_LETTERS[col]! : `${COL_LETTERS[Math.floor(col / 26) - 1]}${COL_LETTERS[col % 26]}`;
}

export function colIndex(name: string): number {
  return name.length === 1 ? COL_LETTERS.indexOf(name) : (COL_LETTERS.indexOf(name[0]!) + 1) * 26 + COL_LETTERS.indexOf(name[1]!);
}

export function label(col: number, row: number): string {
  return `${colName(col)}${row + 1}`;
}

export function parseLabel(text: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,2})(\d{1,2})$/.exec(text.trim().toUpperCase());
  if (!m) return null;
  const col = colIndex(m[1]!);
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) return null;
  return { col, row };
}

export function sectorOf(col: number, row: number): Team {
  const right = col >= 18;
  const bottom = row >= 17;
  return bottom ? (right ? "birch" : "cedar") : right ? "pine" : "ridge";
}

/** Human description of a sector, e.g. "A–R, rows 1–17". */
export function sectorText(team: Team): string {
  const t = TEAM_INFO[team];
  return `${colName(t.cols[0])}–${colName(t.cols[1])}, rows ${t.rows[0] + 1}–${t.rows[1] + 1}`;
}

// Map features: mirror-symmetric left/right (col c <-> 35-c) and top/bottom (row r <-> 33-r).
const MIRROR_C = (c: number) => GRID.cols - 1 - c;
const MIRROR_R = (r: number) => GRID.rows - 1 - r;
const RIVERS = new Set<string>();
const CABINS = new Set<string>();
const all4 = (set: Set<string>, col: number, row: number) => {
  for (const c of [col, MIRROR_C(col)]) for (const r of [row, MIRROR_R(row)]) set.add(label(c, r));
};
for (let r = 3; r <= 11; r++) all4(RIVERS, 9, r); // J4-J12, AA4-AA12, J23-J31, AA23-AA31
all4(CABINS, 4, 4); // E5, AF5, E30, AF30
all4(CABINS, 12, 12); // M13, X13, M22, X22
export const FIRST_FIRE = ["R17", "S17", "R18", "S18"];

export function buildCells(): CellDef[] {
  const cells: CellDef[] = [];
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.cols; col++) {
      const lab = label(col, row);
      const kind: CellKind = RIVERS.has(lab) ? "river" : CABINS.has(lab) ? "cabin" : "forest";
      cells.push({ label: lab, col, row, kind, sector: sectorOf(col, row), x: GRID.originX + col * GRID.pitch, y: GRID.originY + row * GRID.pitch });
    }
  }
  return cells;
}

export function startFill(cell: CellDef): string {
  return STATE_COLOR[cell.kind];
}

/** Fill -> state (lowercase compare). Unknown fills are null. */
export function stateOfFill(fill: string): CellState | null {
  const f = fill.toLowerCase();
  return CELL_STATES.find((s) => STATE_COLOR[s] === f) ?? null;
}

/** Label text color that stays readable on each fill. */
export function textColorFor(state: CellState): string {
  return state === "river" || state === "burnt" || state === "firebreak" ? "#ffffff" : COLORS.ink;
}

export function cellStroke(cell: CellDef): { color: string; width: number } {
  return { color: TEAM_INFO[cell.sector].color, width: 3 };
}

export const GRID_BOX: Box = { x: GRID.originX, y: GRID.originY, w: GRID.cols * GRID.pitch - (GRID.pitch - GRID.cell), h: GRID.rows * GRID.pitch - (GRID.pitch - GRID.cell) };

// Grid squares live in horizontal frames (bands of FRAME_ROWS rows) so the referee can read them in
// parallel; Miro positions a frame's children from the frame's top-left.
export const FRAME_ROWS = 4;
export function frameBoxes(): Box[] {
  const out: Box[] = [];
  for (let r0 = 0; r0 < GRID.rows; r0 += FRAME_ROWS) {
    const rows = Math.min(FRAME_ROWS, GRID.rows - r0);
    out.push({ x: GRID.originX - 2, y: GRID.originY + r0 * GRID.pitch - 2, w: GRID.cols * GRID.pitch, h: rows * GRID.pitch });
  }
  return out;
}
export const frameOfRow = (row: number) => Math.floor(row / FRAME_ROWS);

/** Dark backdrop behind the grid and its row/column headers (static). */
export const BACKDROP: Box = { x: -96, y: -80, w: GRID_BOX.w + 96 + 36, h: GRID_BOX.h + 80 + 36 };

export const PANELS = {
  title: { x: 0, y: -330, w: 1400, h: 90 } as Box,
  rules: { x: 2440, y: -330, w: 760, h: 610 } as Box,
  leaderboard: { x: 3240, y: -330, w: 760, h: 610 } as Box,
  inbox: { x: 0, y: 2300, w: 4000, h: 1500 } as Box,
  compass: { x: -330, y: -330, w: 200, h: 200 } as Box,
};

export const ORDERS: Record<Team, Box> = {
  ridge: { x: 2440, y: 340, w: 760, h: 900 },
  pine: { x: 3240, y: 340, w: 760, h: 900 },
  cedar: { x: 2440, y: 1300, w: 760, h: 900 },
  birch: { x: 3240, y: 1300, w: 760, h: 900 },
};
export const ordersTitle = (t: Team) => `ORDERS · ${TEAM_INFO[t].name.toUpperCase()}`;

export const FIXTURES = {
  banner: { x: 0, y: -220, w: 1100, h: 110 } as Box,
  scoreboard: { x: 1160, y: -220, w: 1140, h: 110 } as Box,
  leaderboard: { x: 3260, y: -250, w: 720, h: 510 } as Box,
};

export const INBOX_CARD = { w: 380, h: 150, cols: 9, gapX: 50, gapY: 24, firstX: 40, firstY: 2400 };

export function inboxSlot(index: number): Box {
  const c = index % INBOX_CARD.cols;
  const r = Math.floor(index / INBOX_CARD.cols);
  return {
    x: PANELS.inbox.x + INBOX_CARD.firstX + c * (INBOX_CARD.w + INBOX_CARD.gapX),
    y: INBOX_CARD.firstY + r * (INBOX_CARD.h + INBOX_CARD.gapY),
    w: INBOX_CARD.w,
    h: INBOX_CARD.h,
  };
}

export function center(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function inside(b: Box, cx: number, cy: number): boolean {
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
}

export function cellBox(cell: CellDef): Box {
  return { x: cell.x, y: cell.y, w: GRID.cell, h: GRID.cell };
}

/** Which team's Orders frame a point (item center) is in, if any. */
export function ordersTeamAt(cx: number, cy: number): Team | null {
  return TEAMS.find((t) => inside(ORDERS[t], cx, cy)) ?? null;
}

// Wind: 8 directions, index 0 = N, clockwise. The wind BLOWS toward this direction: the fire runs that way.
export const WIND = [
  { name: "N", arrow: "⬆", dc: 0, dr: -1, word: "north" },
  { name: "NE", arrow: "↗", dc: 1, dr: -1, word: "north-east" },
  { name: "E", arrow: "➡", dc: 1, dr: 0, word: "east" },
  { name: "SE", arrow: "↘", dc: 1, dr: 1, word: "south-east" },
  { name: "S", arrow: "⬇", dc: 0, dr: 1, word: "south" },
  { name: "SW", arrow: "↙", dc: -1, dr: 1, word: "south-west" },
  { name: "W", arrow: "⬅", dc: -1, dr: 0, word: "west" },
  { name: "NW", arrow: "↖", dc: -1, dr: -1, word: "north-west" },
] as const;

/** Team by id, name or first word of the name ("Cedar Creek", "cedar", "CEDAR"). */
export function teamByName(text: string): Team | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  for (const t of TEAMS) {
    const n = TEAM_INFO[t].name.toLowerCase();
    if (s === t || s === n || s.startsWith(n) || s.split(" ")[0] === n.split(" ")[0]) return t;
  }
  return null;
}
