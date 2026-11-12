import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuleSet } from "./rules.js";
import { TEAMS, type Team } from "./layout.js";
import { emptyGame, type GameFile } from "./referee.js";

export const ROOT = path.resolve(import.meta.dirname, "..");

export function loadRules(file = path.join(ROOT, "config/rules.json")): RuleSet {
  return JSON.parse(readFileSync(file, "utf8")) as RuleSet;
}

/**
 * Optional preset teams, config/teams.json: {"ridge": ["Alice"], "pine": [...], "cedar": [...], "birch": [...]}.
 * A player whose /join name or Miro display name matches (case-insensitive) gets that team.
 */
export function loadTeams(file = path.join(ROOT, "config/teams.json")): Record<string, Team> {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Record<Team, string[]>>;
  const out: Record<string, Team> = {};
  for (const team of TEAMS) for (const name of raw[team] ?? []) out[name.trim().toLowerCase()] = team;
  return out;
}

export interface LayoutIds {
  boardId?: string;
  builtAt?: string;
  frames?: string[]; // grid frames, top band first (layout.ts frameBoxes order)
  fixtures: Partial<Record<"banner" | "scoreboard" | "leaderboard", string>>;
  orders?: Partial<Record<Team, string>>;
  static: string[];
  cells: Record<string, string>;
}

/**
 * Item ids of the live board: config/layout.json (written by `build`, or copied from the MCP-built
 * ../board/board.json by board/build/sync_ids.py), else ../board/board.json itself. Null when neither
 * exists: everything is found by position. Orders frames are always found by position (layout.ts ORDERS).
 */
export function loadLayoutIds(file = path.join(ROOT, "config/layout.json")): LayoutIds | null {
  for (const f of [file, path.join(ROOT, "../board/board.json")]) {
    if (!existsSync(f)) continue;
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<LayoutIds> & { fixtures?: Record<string, unknown> };
    const ids = (o: unknown): string[] => (Array.isArray(o) ? o.filter((x): x is string => typeof x === "string") : []);
    const fixtures: LayoutIds["fixtures"] = {};
    for (const [k, v] of Object.entries(raw.fixtures ?? {})) {
      const id = typeof v === "string" ? v : (v as { id?: string } | null)?.id;
      if (id && (k === "banner" || k === "scoreboard" || k === "leaderboard")) fixtures[k] = id;
    }
    return { boardId: raw.boardId, builtAt: raw.builtAt, orders: raw.orders, frames: ids(raw.frames).length === 9 ? ids(raw.frames) : undefined, fixtures, static: ids(raw.static), cells: raw.cells ?? {} };
  }
  return null;
}

export const GAME_FILE = path.join(ROOT, "state/game.json");

/**
 * The saved game. A file cut short by a kill mid-write (or edited by hand into bad JSON) falls back to the
 * previous save (`game.json.bak`), then to a fresh game: a restart never crashes on its own save.
 */
export function loadGame(file = GAME_FILE, log: (s: string) => void = console.warn): GameFile {
  for (const f of [file, `${file}.bak`]) {
    if (!existsSync(f)) continue;
    let saved: Partial<GameFile>;
    try {
      saved = JSON.parse(readFileSync(f, "utf8")) as Partial<GameFile>;
      if (!saved || typeof saved !== "object") throw new Error("not an object");
    } catch (e) {
      log(`${path.basename(f)} is unreadable (${(e as Error).message.slice(0, 80)}); trying the previous save`);
      continue;
    }
    // A save from an older version of the game (Color Wars, or Wildfire with PLAN/cabins): start a fresh game (keep the fixture ids).
    const state = saved.state && (saved.state as { version?: number }).version === 3 && typeof saved.state.cells === "object" ? saved.state : undefined;
    return { ...emptyGame(), ...saved, fixtureIds: saved.fixtureIds ?? {}, state };
  }
  return emptyGame();
}

/** Atomic save: write a temp file, keep the last good save as .bak, then rename over (a kill never leaves half a file). */
export function saveGame(game: GameFile, file = GAME_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(game, null, 2));
  if (existsSync(file)) {
    try {
      JSON.parse(readFileSync(file, "utf8"));
      copyFileSync(file, `${file}.bak`);
    } catch {
      /* the old file was already bad: keep the older .bak */
    }
  }
  renameSync(tmp, file);
}

/** Minimal .env loader: KEY=VALUE lines, no quotes handling beyond trimming. */
export function loadEnv(file = path.join(ROOT, ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
