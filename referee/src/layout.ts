// Board geometry shared by the referee, the MCP-built board and the student kit (SPEC.md section 1).
// All x/y here are TOP-LEFT in Miro canvas units (the MCP SVG convention).
// The REST API positions items by CENTER; use center() to convert.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Team = "ridge" | "pine" | "cedar" | "birch";
export const TEAMS: Team[] = ["ridge", "pine", "cedar", "birch"];

/** What a square is right now: green tree, orange fire, blue water, black burnt. That is the whole game. */
export type CellState = "forest" | "fire" | "water" | "burnt";
export const CELL_STATES: CellState[] = ["forest", "fire", "water", "burnt"];

export interface CellDef {
  label: string;
  col: number; // 0-based, A = 0
  row: number; // 0-based, 1 = 0
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

/** Square fills (lowercase hex), from config/colors.json. */
const colorFile = path.resolve(import.meta.dirname, "../config/colors.json");
interface Palette {
  forest: string;
  fire: string;
  water: string;
  burnt: string;
  teams: Record<Team, string>;
  square: { border: string; borderWidth: number; label: string; labelBurnt: string };
  frame: string;
  backdrop: string;
  panel: string;
  panelBorder: string;
  text: string;
  muted: string;
  heading: string;
}
export const PALETTE = JSON.parse(readFileSync(colorFile, "utf8")) as Palette;
export const STATE_COLOR: Record<CellState, string> = { forest: PALETTE.forest.toLowerCase(), fire: PALETTE.fire.toLowerCase(), water: PALETTE.water.toLowerCase(), burnt: PALETTE.burnt.toLowerCase() };

export const COLORS = {
  ...STATE_COLOR,
  frame: PALETTE.frame,
  backdrop: PALETTE.backdrop,
  panel: PALETTE.panel,
  panelBorder: PALETTE.panelBorder,
  text: PALETTE.text,
  muted: PALETTE.muted,
  heading: PALETTE.heading,
  ink: PALETTE.square.border,
  paper: PALETTE.panel,
};

export interface TeamInfo {
  /** What students read: "Team 1".."Team 4". */
  name: string;
  /** The old display name, still accepted on question stickies. */
  oldName: string;
  num: number;
  color: string;
  cols: [number, number]; // inclusive, 0-based
  rows: [number, number];
  emoji: string;
  neighbours: Team[];
}

export const TEAM_INFO: Record<Team, TeamInfo> = {
  ridge: { name: "Team 1", oldName: "Ridge", num: 1, color: PALETTE.teams.ridge, cols: [0, 17], rows: [0, 16], emoji: "🟪", neighbours: ["pine", "cedar"] },
  pine: { name: "Team 2", oldName: "Pine Valley", num: 2, color: PALETTE.teams.pine, cols: [18, 35], rows: [0, 16], emoji: "🌸", neighbours: ["ridge", "birch"] },
  cedar: { name: "Team 3", oldName: "Cedar Creek", num: 3, color: PALETTE.teams.cedar, cols: [0, 17], rows: [17, 33], emoji: "🟨", neighbours: ["ridge", "birch"] },
  birch: { name: "Team 4", oldName: "Birch Hollow", num: 4, color: PALETTE.teams.birch, cols: [18, 35], rows: [17, 33], emoji: "⬜", neighbours: ["pine", "cedar"] },
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

/** The first fire: the four centre squares, one in each sector (fair). */
export const FIRST_FIRE = ["R17", "S17", "R18", "S18"];

export function buildCells(): CellDef[] {
  const cells: CellDef[] = [];
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.cols; col++) {
      cells.push({ label: label(col, row), col, row, sector: sectorOf(col, row), x: GRID.originX + col * GRID.pitch, y: GRID.originY + row * GRID.pitch });
    }
  }
  return cells;
}

/** What a square is when a game is reset: green, except the first fire. */
export function startState(cell: CellDef): CellState {
  return FIRST_FIRE.includes(cell.label) ? "fire" : "forest";
}

export function startFill(cell: CellDef): string {
  return STATE_COLOR[startState(cell)];
}

/** Fill -> state (lowercase compare). Unknown fills are null. */
export function stateOfFill(fill: string): CellState | null {
  const f = fill.toLowerCase();
  return CELL_STATES.find((s) => STATE_COLOR[s] === f) ?? null;
}

/** Label text color that stays readable on each fill. */
export function textColorFor(state: CellState): string {
  return state === "burnt" ? PALETTE.square.labelBurnt : PALETTE.square.label;
}

/** Every square has the same thin dark border (team colors live only on the area edges and headers). */
export function cellStroke(_cell: CellDef): { color: string; width: number } {
  return { color: PALETTE.square.border, width: PALETTE.square.borderWidth };
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
export const ordersTitle = (t: Team) => `ORDERS · ${TEAM_INFO[t].name.toUpperCase()}`; // "ORDERS · TEAM 1"

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
  { name: "N", arrow: "↑", dc: 0, dr: -1, word: "north" },
  { name: "NE", arrow: "↗", dc: 1, dr: -1, word: "north-east" },
  { name: "E", arrow: "→", dc: 1, dr: 0, word: "east" },
  { name: "SE", arrow: "↘", dc: 1, dr: 1, word: "south-east" },
  { name: "S", arrow: "↓", dc: 0, dr: 1, word: "south" },
  { name: "SW", arrow: "↙", dc: -1, dr: 1, word: "south-west" },
  { name: "W", arrow: "←", dc: -1, dr: 0, word: "west" },
  { name: "NW", arrow: "↖", dc: -1, dr: -1, word: "north-west" },
] as const;

/**
 * Team by "Team 2" / "team2" / "T2" / "2", by id ("pine"), or by the old name or its first word
 * ("Pine Valley", "pine valley", "PINE").
 */
export function teamByName(text: string): Team | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const num = /^(?:team|t)?\s*#?\s*([1-4])\b/.exec(s);
  if (num) return TEAMS.find((t) => TEAM_INFO[t].num === Number(num[1])) ?? null;
  for (const t of TEAMS) {
    const n = TEAM_INFO[t].oldName.toLowerCase();
    if (s === t || s === n || s.startsWith(n) || s.split(" ")[0] === n.split(" ")[0]) return t;
  }
  return null;
}
