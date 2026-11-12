import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

export function loadGame(file = GAME_FILE): GameFile {
  if (!existsSync(file)) return emptyGame();
  const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<GameFile>;
  // A Color Wars save has no fire: start a fresh game (keep the fixture ids).
  const state = saved.state && "burnLeft" in saved.state ? saved.state : undefined;
  return { ...emptyGame(), fixtureIds: saved.fixtureIds ?? {}, state };
}

export function saveGame(game: GameFile, file = GAME_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(game, null, 2));
}

/** Minimal .env loader: KEY=VALUE lines, no quotes handling beyond trimming. */
export function loadEnv(file = path.join(ROOT, ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
