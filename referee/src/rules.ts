// Pure rules engine (SPEC.md section 3): state + observed board changes -> decisions. No I/O, no clocks:
// game time (`elapsed`) only moves through advance(), and every random draw comes from the injected rng.
import { FIRST_FIRE, STATE_COLOR, TEAMS, TEAM_INFO, WIND, sectorText, startState, stateOfFill, teamByName, type CellDef, type CellState, type Team } from "./layout.js";

export type Rng = () => number;

/** Seedable RNG (mulberry32): same seed, same fire. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RuleSet {
  spreadSeconds: number;
  pSide: number;
  pDiag: number;
  downwindMult: number;
  upwindMult: number;
  burnTicks: number;
  windMinutes: number; // the wind turns 45° once, at this minute
  lightningAt: number[]; // minutes
  lightningMinDistance: number;
  waterTotal: number;
  cooldownSeconds: number;
  timeoutSeconds: number;
  outsideMinutes: number;
  gameMinutes: number;
}

export type RuleId = "lobby" | "over" | "unjoined" | "timeout" | "cooldown" | "color" | "square" | "area" | "water" | "tamper";
export const RULE_IDS: RuleId[] = ["lobby", "over", "unjoined", "timeout", "cooldown", "color", "square", "area", "water", "tamper"];

export type Phase = "lobby" | "live" | "over";
export type Role = "boss" | "worker";

export interface Player {
  userId: string;
  name: string;
  team: Team;
  role: Role;
  joinedAt: number;
}

export interface PlayerStats {
  name: string;
  team: Team;
  role: Role;
  water: number; // accepted blue paints
  outside: number; // ... of them in a neighbour's area
  illegal: Record<RuleId, number>;
}

/** A "Spray water in <neighbour>'s area?" sticky's remembered answer. */
export interface Approval {
  team: Team; // whose Orders frame it is in (the team that asks)
  to: Team; // the neighbour whose sector it opens
  creator: string;
  status: "approved" | "refused";
  by: string;
  at: number; // game ms
}

/** An approved question: `team` may paint blue in `to`'s area until `until`. */
export interface OutsideGrant {
  sticky: string;
  team: Team;
  to: Team;
  until: number; // game ms
}

export interface GameEvent {
  at: number; // game ms
  text: string;
}

export interface GameState {
  version: 2;
  phase: Phase;
  startedAt: number | null; // real ms
  endedAt: number | null; // real ms
  endReason: "time" | "out" | "stopped" | null;
  winner: Team | null;
  elapsed: number; // game ms since the start (only advance() moves it)
  cells: Record<string, CellState>;
  burnLeft: Record<string, number>; // label -> spreads left before it burns out
  wind: number; // index into WIND
  windTurned: boolean;
  nextSpreadAt: number;
  spreads: number;
  lightningDone: number; // how many of rules.lightningAt have struck
  water: number; // the shared pool
  startScore: Record<Team, number>;
  players: Record<string, Player>;
  lastPaintAt: Record<string, number>; // userId -> real ms of last ACCEPTED paint
  timeoutUntil: Record<string, number>; // userId -> frozen until (real ms)
  approvals: Record<string, Approval>; // sticky id -> remembered answer
  noted: Record<string, string>; // sticky id -> last problem told to its creator (no repeats)
  outside: OutsideGrant[]; // running grants to spray outside the team's own area
  events: GameEvent[];
  stats: {
    accepted: number;
    ignitions: number;
    burntOut: number;
    strikes: string[];
    illegal: Record<RuleId, number>;
    byPlayer: Record<string, PlayerStats>;
  };
}

export interface PaintEvent {
  label: string;
  fill: string;
  userId: string;
  at: number; // real ms
}

export interface TamperEvent {
  userId: string;
  what: "moved" | "resized" | "rotated" | "deleted" | "edited" | "added" | "locked";
  target: string;
  at: number;
}

export interface Decision {
  accept: boolean;
  rule?: RuleId;
  feedback: string;
}

/** A sticky note seen in a team's Orders frame. */
export interface StickyView {
  id: string;
  team: Team; // frame it sits in
  text: string; // plain text, one line per line
  createdBy: string;
  modifiedBy: string;
}

export interface Note {
  userId: string;
  line: string;
}

export const teamName = (t: Team) => TEAM_INFO[t].name;
const BLUE = () => `blue ${STATE_COLOR.water}`;

export function emptyIllegal(): Record<RuleId, number> {
  return Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<RuleId, number>;
}

function playerStats(p: Player): PlayerStats {
  return { name: p.name, team: p.team, role: p.role, water: 0, outside: 0, illegal: emptyIllegal() };
}

export function createState(cells: CellDef[], rules: RuleSet, rng: Rng): GameState {
  const state: GameState = {
    version: 2,
    phase: "lobby",
    startedAt: null,
    endedAt: null,
    endReason: null,
    winner: null,
    elapsed: 0,
    cells: Object.fromEntries(cells.map((c) => [c.label, startState(c)])),
    burnLeft: Object.fromEntries(FIRST_FIRE.map((l) => [l, rules.burnTicks])),
    wind: Math.floor(rng() * 8),
    windTurned: false,
    nextSpreadAt: rules.spreadSeconds * 1000,
    spreads: 0,
    lightningDone: 0,
    water: rules.waterTotal,
    startScore: { ridge: 0, pine: 0, cedar: 0, birch: 0 },
    players: {},
    lastPaintAt: {},
    timeoutUntil: {},
    approvals: {},
    noted: {},
    outside: [],
    events: [],
    stats: { accepted: 0, ignitions: FIRST_FIRE.length, burntOut: 0, strikes: [], illegal: emptyIllegal(), byPlayer: {} },
  };
  for (const c of cells) state.startScore[c.sector]++; // every square of the sector is the 100%
  return state;
}

/** The game goes live: the four centre squares (on fire since the reset) start spreading. */
export function startGame(state: GameState, rules: RuleSet, at: number): string[] {
  if (state.phase !== "lobby") return [];
  state.phase = "live";
  state.startedAt = at;
  for (const lab of FIRST_FIRE) {
    state.cells[lab] = "fire";
    state.burnLeft[lab] = rules.burnTicks;
  }
  pushEvent(state, `🔥 The fire started at ${FIRST_FIRE.join(" ")}!`);
  return [...FIRST_FIRE];
}

export function stopGame(state: GameState, cells: CellDef[], at: number): void {
  if (state.phase === "over") return;
  endGame(state, cells, at, "stopped");
}

function endGame(state: GameState, cells: CellDef[], at: number, reason: "time" | "out" | "stopped") {
  state.phase = "over";
  state.endedAt = at;
  state.endReason = reason;
  const sc = scores(state, cells);
  state.winner = TEAMS.slice().sort((a, b) => sc[b].points / state.startScore[b] - sc[a].points / state.startScore[a])[0]!;
}

function pushEvent(state: GameState, text: string) {
  state.events.push({ at: state.elapsed, text });
  if (state.events.length > 12) state.events.shift();
}

// ---------- players ----------

export function cleanName(raw: string): string {
  const s = String(raw ?? "")
    .slice(0, 2000) // a giant /join name must not cost anything
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[<>]/g, "") // never let a name look like HTML on a card
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "") // control, zero-width, bidi
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, 24).join("").trim(); // by code point: never split an emoji
}

/** Register a player (any phase). `preset` picks the team; otherwise the smallest team. First on a team = boss. */
export function applyJoin(state: GameState, ev: { userId: string; name: string; at: number }, preset?: Team): { player: Player; duplicate: boolean } {
  const existing = state.players[ev.userId];
  if (existing) return { player: existing, duplicate: true };
  const size = (t: Team) => Object.values(state.players).filter((p) => p.team === t).length;
  const team = preset ?? TEAMS.slice().sort((a, b) => size(a) - size(b))[0]!;
  const role: Role = size(team) === 0 ? "boss" : "worker";
  let name = cleanName(ev.name) || `Player ${Object.keys(state.players).length + 1}`;
  // Two players with one name would share one "Name: paint ..." order: the later one gets a number.
  const taken = new Set(Object.values(state.players).map((p) => p.name.toLowerCase()));
  if (taken.has(name.toLowerCase())) {
    let k = 2;
    while (taken.has(`${name} ${k}`.toLowerCase())) k++;
    name = `${name} ${k}`;
  }
  const player: Player = { userId: ev.userId, name, team, role, joinedAt: ev.at };
  state.players[ev.userId] = player;
  state.stats.byPlayer[ev.userId] = playerStats(player);
  return { player, duplicate: false };
}

// ---------- score ----------

/** Per team: green + blue squares in its sector, % of the sector, squares on fire. */
export function scores(state: GameState, cells: CellDef[]): Record<Team, { points: number; pct: number; fire: number }> {
  const out = {} as Record<Team, { points: number; pct: number; fire: number }>;
  for (const t of TEAMS) out[t] = { points: 0, pct: 0, fire: 0 };
  for (const c of cells) {
    const st = state.cells[c.label]!;
    if (st === "forest" || st === "water") out[c.sector].points++;
    if (st === "fire") out[c.sector].fire++;
  }
  for (const t of TEAMS) out[t].pct = Math.round((100 * out[t].points) / state.startScore[t]);
  return out;
}

// ---------- fire ----------

function ignite(state: GameState, rules: RuleSet, lab: string) {
  state.cells[lab] = "fire";
  state.burnLeft[lab] = rules.burnTicks;
  state.stats.ignitions++;
}

/** 1 = downwind (within 45° of the wind), -1 = upwind (135° or more), 0 = across. */
function windSide(dirIndex: number, wind: number): 1 | 0 | -1 {
  const d = Math.min(Math.abs(dirIndex - wind), 8 - Math.abs(dirIndex - wind));
  return d <= 1 ? 1 : d >= 3 ? -1 : 0;
}

export interface AdvanceResult {
  changed: string[]; // labels whose state changed
  events: string[];
  ended: OutsideGrant[]; // spray-outside grants that just ran out
}

/** One spread: every burning square may ignite its green neighbours, old fires burn out. */
export function spread(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng): string[] {
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  const lit = new Set<string>();
  for (const f of fires) {
    WIND.forEach((w, i) => {
      const n = byPos.get(`${f.col + w.dc},${f.row + w.dr}`);
      if (!n || state.cells[n.label] !== "forest" || lit.has(n.label)) return;
      const side = windSide(i, state.wind);
      const p = (w.dc && w.dr ? rules.pDiag : rules.pSide) * (side === 1 ? rules.downwindMult : side === -1 ? rules.upwindMult : 1);
      if (rng() < p) lit.add(n.label);
    });
  }
  const changed: string[] = [];
  for (const f of fires) {
    state.burnLeft[f.label] = (state.burnLeft[f.label] ?? 1) - 1;
    if (state.burnLeft[f.label]! <= 0) {
      state.cells[f.label] = "burnt";
      delete state.burnLeft[f.label];
      state.stats.burntOut++;
      changed.push(f.label);
    }
  }
  for (const lab of lit) {
    ignite(state, rules, lab);
    changed.push(lab);
  }
  state.spreads++;
  return changed;
}

/** Lightning: a random green square at least lightningMinDistance (Chebyshev) from any fire. */
export function strike(state: GameState, rules: RuleSet, cells: CellDef[], rng: Rng): string | null {
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  const forest = cells.filter((c) => state.cells[c.label] === "forest");
  const far = forest.filter((c) => fires.every((f) => Math.max(Math.abs(f.col - c.col), Math.abs(f.row - c.row)) >= rules.lightningMinDistance));
  const pool = far.length ? far : forest;
  if (!pool.length) return null;
  const hit = pool[Math.floor(rng() * pool.length)]!;
  ignite(state, rules, hit.label);
  state.stats.strikes.push(hit.label);
  pushEvent(state, `⚡ Lightning! New fire at ${hit.label} (${teamName(hit.sector)})`);
  return hit.label;
}

/**
 * Move game time forward by dtMs: the wind turns (once), lightning strikes, the fire spreads,
 * spray-outside grants run out, the game ends. Events fire in time order. Mutates state.
 */
export function advance(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng, dtMs: number, realNow = 0): AdvanceResult {
  const changed = new Set<string>();
  const events: string[] = [];
  if (state.phase !== "live") return { changed: [], events, ended: [] };
  const target = state.elapsed + Math.max(0, dtMs);
  const gameEnd = rules.gameMinutes * 60_000;
  const windAt = state.windTurned ? Infinity : rules.windMinutes * 60_000;
  for (;;) {
    const nextLightning = state.lightningDone < rules.lightningAt.length ? rules.lightningAt[state.lightningDone]! * 60_000 : Infinity;
    const next = Math.min(state.nextSpreadAt, state.windTurned ? Infinity : windAt, nextLightning, gameEnd);
    if (next > target) break;
    state.elapsed = next;
    if (next === gameEnd) {
      endGame(state, cells, realNow, "time");
      pushEvent(state, "⏱ Time is up!");
      events.push("⏱ Time is up");
      break;
    }
    if (next === nextLightning) {
      state.lightningDone++;
      const hit = strike(state, rules, cells, rng);
      if (hit) {
        changed.add(hit);
        events.push(`⚡ lightning at ${hit}`);
      }
    } else if (!state.windTurned && next === windAt) {
      state.windTurned = true;
      state.wind = (state.wind + (rng() < 0.5 ? 1 : 7)) % 8;
      pushEvent(state, `🌬️ The wind turned! Now blowing ${WIND[state.wind]!.arrow} ${WIND[state.wind]!.word}`);
      events.push(`wind ${WIND[state.wind]!.name}`);
    } else {
      for (const l of spread(state, rules, cells, byPos, rng)) changed.add(l);
      state.nextSpreadAt += rules.spreadSeconds * 1000;
    }
    if (state.phase === "live" && fireOut(state, rules)) {
      endGame(state, cells, realNow, "out");
      pushEvent(state, "🌧️ The fire is out!");
      events.push("fire out");
      break;
    }
  }
  if (state.phase === "live") state.elapsed = target;
  const ended = state.outside.filter((g) => g.until <= state.elapsed || state.phase !== "live");
  state.outside = state.outside.filter((g) => !ended.includes(g));
  return { changed: [...changed], events, ended };
}

/** No square burns and no lightning is still to come. */
function fireOut(state: GameState, rules: RuleSet): boolean {
  return state.lightningDone >= rules.lightningAt.length && !Object.values(state.cells).some((s) => s === "fire");
}

// ---------- paints ----------

function reject(state: GameState, userId: string, rule: RuleId, feedback: string): Decision {
  state.stats.illegal[rule]++;
  const ps = state.stats.byPlayer[userId];
  if (ps) ps.illegal[rule]++;
  return { accept: false, rule, feedback };
}

/** The running spray-outside grant that lets `team` paint in `sector`, if any. */
export function outsideGrant(state: GameState, team: Team, sector: Team): OutsideGrant | null {
  return state.outside.find((g) => g.team === team && g.to === sector && g.until > state.elapsed) ?? null;
}

/**
 * Decide one observed fill change against the referee's state. On accept the square turns blue
 * and the shared pool loses 1. Events for one tick must be passed in time order.
 */
export function decidePaint(state: GameState, rules: RuleSet, cells: Map<string, CellDef>, ev: PaintEvent): Decision {
  const cell = cells.get(ev.label);
  if (!cell) return { accept: false, feedback: `❌ ${ev.label} undone: no such square.` };
  const lab = cell.label;
  if (state.phase === "lobby") return reject(state, ev.userId, "lobby", `⏸ ${lab} undone: the game hasn't started yet.`);
  if (state.phase === "over") return reject(state, ev.userId, "over", `🏁 ${lab} undone: the game is over.`);
  const player = state.players[ev.userId];
  if (!player) return reject(state, ev.userId, "unjoined", `❌ ${lab} undone: you haven't joined. Run /join first.`);
  const team = player.team;
  const frozen = state.timeoutUntil[ev.userId];
  if (frozen !== undefined && ev.at < frozen) return reject(state, ev.userId, "timeout", `🧊 ${lab} undone: you are frozen ${Math.ceil((frozen - ev.at) / 1000)} s more.`);
  const last = state.lastPaintAt[ev.userId];
  const cool = rules.cooldownSeconds * 1000;
  if (last !== undefined && ev.at - last < cool) return reject(state, ev.userId, "cooldown", `⏳ ${lab} undone: wait ${rules.cooldownSeconds} s between paints.`);
  if (stateOfFill(ev.fill) !== "water") return reject(state, ev.userId, "color", `🎨 ${lab} undone: paint only ${BLUE()}.`);
  const cur = state.cells[lab]!;
  if (cur !== "forest" && cur !== "fire") return reject(state, ev.userId, "square", `❌ ${lab} undone: it is already ${cur === "water" ? "water" : "burnt"}. Paint green or orange squares.`);
  const away = cell.sector !== team;
  if (away && !outsideGrant(state, team, cell.sector)) {
    return reject(state, ev.userId, "area", `🧭 ${lab} undone: it is ${teamName(cell.sector)}'s area. Paint only in your team's area (${sectorText(team)}) unless a teammate said YES to "Spray water in ${teamName(cell.sector)}'s area?".`);
  }
  if (state.water <= 0) return reject(state, ev.userId, "water", `🚱 ${lab} undone: the shared water is all used up.`);

  const ps = state.stats.byPlayer[ev.userId]!;
  state.stats.accepted++;
  state.lastPaintAt[ev.userId] = ev.at;
  state.water--;
  delete state.burnLeft[lab];
  state.cells[lab] = "water";
  ps.water++;
  if (away) ps.outside++;
  return { accept: true, feedback: `💧 ${lab} ${cur === "fire" ? "fire put out" : "is now water"}. ${state.water} water left.` };
}

export function decideTamper(state: GameState, rules: RuleSet, ev: TamperEvent): Decision {
  const player = state.players[ev.userId];
  const verb0 = ev.what === "added" ? "Removed" : "Put back";
  // Not a player (an unattributable delete, a guest, the instructor): nothing to freeze or count.
  if (!player) return { accept: false, rule: "tamper", feedback: `⚠️ ${verb0} ${ev.target} (${ev.what}).` };
  const verb = ev.what === "added" ? "Removed" : "Put back";
  let freeze = "";
  if (player && state.phase === "live") {
    state.timeoutUntil[ev.userId] = ev.at + rules.timeoutSeconds * 1000;
    freeze = ` You are frozen for ${rules.timeoutSeconds} s.`;
  }
  return reject(state, ev.userId, "tamper", `⚠️ ${verb} ${ev.target} (${ev.what}). Only paint squares blue.${freeze}`);
}

// ---------- the human decision: "Spray water in <neighbour>'s area?" stickies in the Orders frames ----------

function stickyLines(text: string): string[] {
  return text.split(/\n/).map((l) => l.trim()).filter(Boolean);
}

const QUESTION = /^spray\s+water\s+in\s+(.+?)\s*$/i;

/** "QUESTION" = a "Spray water in <team>'s area?" sticky; "ORDER" = "Ana: paint N9 N10" (communication only). */
export function stickyKind(text: string): "QUESTION" | "ORDER" | null {
  const first = stickyLines(text)[0] ?? "";
  if (QUESTION.test(first)) return "QUESTION";
  if (/^[^:]{1,30}:\s*paint\b/i.test(first)) return "ORDER";
  return null;
}

/** The team named on a question sticky's first line ("Pine Valley's area?", "pine valley area", "Pine"), or null. */
export function questionTarget(text: string): Team | null {
  const m = QUESTION.exec(stickyLines(text)[0] ?? "");
  if (!m) return null;
  const name = m[1]!
    .replace(/[?!.]+$/, "")
    .replace(/\s*\barea\b\s*$/i, "")
    .replace(/['’]s\s*$/i, "")
    .replace(/['’]\s*$/, "")
    .trim();
  return teamByName(name);
}

/** The question as students read it: "spray water in Pine Valley's area". */
export const sprayText = (to: Team) => `spray water in ${teamName(to)}'s area`;

/**
 * Judge one "Spray water in <neighbour>'s area?" sticky (in the asking team's own Orders frame).
 * Approved = it has a YES line and its last editor is on that team and is not its creator; answers
 * are remembered once seen. On YES the team may paint blue in that neighbour's area for
 * outsideMinutes. Returns inbox lines.
 */
export function judgeSticky(state: GameState, rules: RuleSet, s: StickyView): Note[] {
  if (state.approvals[s.id]?.status === "approved") return [];
  if (stickyKind(s.text) !== "QUESTION") return [];
  const creator = state.players[s.createdBy];
  if (!creator) return []; // not a player (the instructor's example, a guest): ignored
  const notes: Note[] = [];
  const tellCreator = (line: string) => {
    if (state.noted[s.id] === line) return notes;
    state.noted[s.id] = line;
    notes.push({ userId: s.createdBy, line });
    return notes;
  };
  const teamOf = (t: Team) => Object.values(state.players).filter((p) => p.team === t).map((p) => p.userId);
  const team = s.team;
  if (creator.team !== team) return tellCreator(`❓ Your question is in ${teamName(team)}'s Orders. Put it in your own team's Orders.`);
  const to = questionTarget(s.text);
  const near = TEAM_INFO[team].neighbours;
  if (!to || !near.includes(to)) return tellCreator(`❓ Ask about a neighbour, like: Spray water in ${teamName(near[0]!)}'s area? (or ${teamName(near[1]!)}'s).`);
  if (state.phase === "over") return notes;

  const answers = stickyLines(s.text).slice(1).map((l) => l.toUpperCase().replace(/[.!]+$/, "")).filter((l) => l === "YES" || l === "NO");
  if (!answers.length) return notes;
  const answer = answers.at(-1)!;
  if (s.modifiedBy === s.createdBy) return tellCreator(`✋ "Spray water in ${teamName(to)}'s area?" needs a YES from a teammate who did not post it.`);
  const editor = state.players[s.modifiedBy];
  if (!editor || editor.team !== team) return tellCreator(`✋ Only a ${teamName(team)} player can answer your question.`);

  if (answer === "NO") {
    if (state.approvals[s.id]?.status !== "refused") {
      state.approvals[s.id] = { team, to, creator: s.createdBy, status: "refused", by: s.modifiedBy, at: state.elapsed };
      notes.push({ userId: s.createdBy, line: `🙅 ${editor.name} said NO: don't ${sprayText(to)}. Stay in your team's area.` });
    }
    return notes;
  }
  state.approvals[s.id] = { team, to, creator: s.createdBy, status: "approved", by: s.modifiedBy, at: state.elapsed };
  const until = state.elapsed + rules.outsideMinutes * 60_000;
  const old = outsideGrant(state, team, to);
  if (old) old.until = Math.max(old.until, until);
  else state.outside.push({ sticky: s.id, team, to, until });
  pushEvent(state, `🤝 ${teamName(team)} may spray water in ${teamName(to)}'s area for ${rules.outsideMinutes} min`);
  for (const u of teamOf(team)) notes.push({ userId: u, line: `✅ ${editor.name} said YES: you may paint blue in ${teamName(to)}'s area (${to}) for ${rules.outsideMinutes} min.` });
  for (const u of teamOf(to)) notes.push({ userId: u, line: `🤝 ${teamName(team)} is spraying water in your area for ${rules.outsideMinutes} min.` });
  return notes;
}

/** Questions waiting for a YES, for the leaderboard: "spray water in Pine Valley's area". */
export function pendingStickies(state: GameState, stickies: StickyView[]): Record<Team, string[]> {
  const out: Record<Team, string[]> = { ridge: [], pine: [], cedar: [], birch: [] };
  for (const s of stickies) {
    if (stickyKind(s.text) !== "QUESTION") continue;
    const to = questionTarget(s.text);
    if (!state.players[s.createdBy] || !to) continue;
    const a = state.approvals[s.id];
    // A refused question rewritten without its NO line is asking again.
    if (a?.status === "approved" || (a && stickyLines(s.text).slice(1).some((l) => l.toUpperCase() === "NO"))) continue;
    out[s.team].push(sprayText(to));
  }
  return out;
}
