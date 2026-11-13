// Two referees, two Miro tokens (two users = two rate-limit budgets). The GAME referee owns state/game.json
// (squares, fixtures, inbox cards, the rules); the GUARD referee (second token) owns the slow whole-board
// work: junk, static put-backs, foreign stickies, spotting new inbox cards. They talk through append-only
// files in state/: the guard appends join requests and penalties, the game consumes them each tick and keeps
// how far it read inside game.json (so a restart neither loses nor repeats a line). The guard only ever
// reads game.json.
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, appendFileSync } from "node:fs";
import path from "node:path";
import type { GameFile } from "./referee.js";
import type { TamperEvent } from "./rules.js";

/** A new card in the Inbox, seen by the guard: the game referee joins its creator. */
export interface JoinRequest {
  cardId: string;
  createdBy: string;
  content: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: number;
  /** When the guard saw it. */
  at: number;
}

/** Something the guard tells a player through the game referee: a penalty (judged by the game) or a plain line. */
export interface GuardNote {
  userId: string;
  /** A penalty: the game applies it (freeze, junk count) once per key, like its own. */
  tamper?: { what: TamperEvent["what"]; target: string; at: number; key: string };
  line?: string;
  at: number;
}

export interface GuardLink {
  // guard side
  postJoin?(j: JoinRequest): void;
  postNote?(n: GuardNote): void;
  /** The game referee's latest save (read-only), or null when unreadable. */
  readGame?(): GameFile | null;
  // game side
  takeJoins?(): JoinRequest[];
  takeNotes?(): GuardNote[];
}

export const JOINS_FILE = "joins.jsonl";
export const NOTES_FILE = "guard-feedback.jsonl";

/** New complete lines of an append-only file after `offset` bytes; returns them and the new offset. */
export function readNewLines(file: string, offset: number): { lines: string[]; offset: number } {
  if (!existsSync(file)) return { lines: [], offset: 0 };
  const size = statSync(file).size;
  if (size < offset) offset = 0; // the file was replaced (state/ wiped): read it from the start
  if (size === offset) return { lines: [], offset };
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf8");
  const end = text.lastIndexOf("\n");
  if (end < 0) return { lines: [], offset }; // half a line: next time
  const done = text.slice(0, end + 1);
  return { lines: done.split("\n").filter((l) => l.trim()), offset: offset + Buffer.byteLength(done, "utf8") };
}

function parse<T>(lines: string[]): T[] {
  const out: T[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      /* a damaged line is skipped */
    }
  }
  return out;
}

/** The game referee's side: consumes the guard's files; how far it read is saved in game.json with the game. */
export function gameFileLink(dir: string, game: GameFile): GuardLink {
  const take = <T>(name: string, key: "joins" | "notes"): T[] => {
    const read = (game.guardRead ??= { joins: 0, notes: 0 });
    const r = readNewLines(path.join(dir, name), read[key] ?? 0);
    read[key] = r.offset;
    return parse<T>(r.lines);
  };
  return { takeJoins: () => take<JoinRequest>(JOINS_FILE, "joins"), takeNotes: () => take<GuardNote>(NOTES_FILE, "notes") };
}

/** The guard's side: appends to the files, reads game.json with `load`. */
export function guardFileLink(dir: string, load: () => GameFile | null): GuardLink {
  const append = (name: string, rec: unknown) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, name), `${JSON.stringify(rec)}\n`);
  };
  return { postJoin: (j) => append(JOINS_FILE, j), postNote: (n) => append(NOTES_FILE, n), readGame: load };
}

/** In memory, for tests: the guard sees a copy of the game referee's GameFile, never the object itself. */
export function memoryLink(gameFile: () => GameFile): { game: GuardLink; guard: GuardLink; joins: JoinRequest[]; notes: GuardNote[] } {
  const joins: JoinRequest[] = [];
  const notes: GuardNote[] = [];
  return {
    joins,
    notes,
    game: { takeJoins: () => joins.splice(0), takeNotes: () => notes.splice(0) },
    guard: { postJoin: (j) => joins.push(j), postNote: (n) => notes.push(n), readGame: () => structuredClone(gameFile()) },
  };
}
