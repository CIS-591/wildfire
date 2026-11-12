// Pure rules engine (SPEC.md section 3): state + observed board changes -> decisions. No I/O, no clocks:
// game time (`elapsed`) only moves through advance(), and every random draw comes from the injected rng.
import {
  FIRST_FIRE, STATE_COLOR, TEAMS, TEAM_INFO, WIND, label, parseLabel, sectorText, stateOfFill, teamByName, type CellDef, type CellState, type Team,
} from "./layout.js";

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
  pEmber: number;
  burnTicks: number;
  windMinutes: number;
  lightningAt: number[];
  lightningMinDistance: number;
  wetSeconds: number;
  waterTotal: number;
  cooldownSeconds: number;
  timeoutSeconds: number;
  backburnMax: number;
  helpMinutes: number;
  helpPlayers: number;
  gameMinutes: number;
  quietSpreads: number;
}

export type RuleId = "lobby" | "over" | "unjoined" | "timeout" | "cooldown" | "plan" | "sector" | "color" | "backburn" | "water" | "tamper";
export const RULE_IDS: RuleId[] = ["lobby", "over", "unjoined", "timeout", "cooldown", "plan", "sector", "color", "backburn", "water", "tamper"];

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
  water: number;
  firebreak: number;
  burnt: number;
  illegal: Record<RuleId, number>;
}

export type StickyKind = "PLAN" | "BACKBURN" | "HELP";

export interface Approval {
  kind: StickyKind;
  team: Team; // whose Orders frame it is in
  creator: string;
  status: "approved" | "refused";
  by: string;
  at: number; // game ms
  labels?: string[]; // BACKBURN
  forTeam?: Team; // HELP: the team asking
}

export interface HelpGrant {
  sticky: string;
  helper: Team;
  to: Team;
  until: number; // game ms
  players: string[]; // userIds of the helpers (at most helpPlayers)
}

export interface GameEvent {
  at: number; // game ms
  text: string;
}

export interface GameState {
  phase: Phase;
  startedAt: number | null; // real ms
  endedAt: number | null; // real ms
  endReason: "time" | "out" | "stopped" | null;
  winner: Team | null;
  elapsed: number; // game ms since the start (only advance() moves it)
  cells: Record<string, CellState>;
  burnLeft: Record<string, number>; // label -> spreads left before it burns out
  wet: Record<string, { until: number; back: "forest" | "cabin" }>;
  wind: number; // index into WIND
  nextWindAt: number;
  nextSpreadAt: number;
  spreads: number;
  quiet: number; // spreads in a row with nothing burning (after the last lightning)
  lightningDone: number; // how many of rules.lightningAt have struck
  water: number; // the shared pool
  startScore: Record<Team, number>;
  players: Record<string, Player>;
  lastPaintAt: Record<string, number>; // userId -> real ms of last ACCEPTED paint
  timeoutUntil: Record<string, number>; // userId -> frozen until (real ms)
  plan: Partial<Record<Team, string>>; // team -> id of its approved PLAN sticky
  approvals: Record<string, Approval>; // sticky id -> remembered answer
  noted: Record<string, string>; // sticky id -> last problem told to its creator (no repeats)
  backburn: Record<Team, string[]>;
  grants: HelpGrant[];
  events: GameEvent[];
  stats: {
    accepted: number;
    ignitions: number;
    embers: number;
    burntOut: number;
    strikes: string[];
    cabinsLost: string[];
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
  what: "moved" | "resized" | "deleted" | "edited" | "added";
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

export function emptyIllegal(): Record<RuleId, number> {
  return Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<RuleId, number>;
}

function playerStats(p: Player): PlayerStats {
  return { name: p.name, team: p.team, role: p.role, water: 0, firebreak: 0, burnt: 0, illegal: emptyIllegal() };
}

export function createState(cells: CellDef[], rules: RuleSet, rng: Rng): GameState {
  const state: GameState = {
    phase: "lobby",
    startedAt: null,
    endedAt: null,
    endReason: null,
    winner: null,
    elapsed: 0,
    cells: Object.fromEntries(cells.map((c) => [c.label, c.kind as CellState])),
    burnLeft: {},
    wet: {},
    wind: Math.floor(rng() * 8),
    nextWindAt: rules.windMinutes * 60_000,
    nextSpreadAt: rules.spreadSeconds * 1000,
    spreads: 0,
    quiet: 0,
    lightningDone: 0,
    water: rules.waterTotal,
    startScore: { ridge: 0, pine: 0, cedar: 0, birch: 0 },
    players: {},
    lastPaintAt: {},
    timeoutUntil: {},
    plan: {},
    approvals: {},
    noted: {},
    backburn: { ridge: [], pine: [], cedar: [], birch: [] },
    grants: [],
    events: [],
    stats: { accepted: 0, ignitions: 0, embers: 0, burntOut: 0, strikes: [], cabinsLost: [], illegal: emptyIllegal(), byPlayer: {} },
  };
  for (const t of TEAMS) state.startScore[t] = 0;
  for (const c of cells) state.startScore[c.sector] += c.kind === "cabin" ? 10 : c.kind === "forest" ? 1 : 0;
  return state;
}

/** The game goes live: the four centre squares catch fire. */
export function startGame(state: GameState, rules: RuleSet, at: number): string[] {
  if (state.phase !== "lobby") return [];
  state.phase = "live";
  state.startedAt = at;
  for (const lab of FIRST_FIRE) ignite(state, rules, lab);
  pushEvent(state, `🔥 The fire is loose at ${FIRST_FIRE.join(" ")}!`);
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
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

/** Register a player (any phase). `preset` picks the team; otherwise the smallest team. First on a team = boss. */
export function applyJoin(state: GameState, ev: { userId: string; name: string; at: number }, preset?: Team): { player: Player; duplicate: boolean } {
  const existing = state.players[ev.userId];
  if (existing) return { player: existing, duplicate: true };
  const size = (t: Team) => Object.values(state.players).filter((p) => p.team === t).length;
  const team = preset ?? TEAMS.slice().sort((a, b) => size(a) - size(b))[0]!;
  const role: Role = size(team) === 0 ? "boss" : "worker";
  const name = cleanName(ev.name) || `Player ${Object.keys(state.players).length + 1}`;
  const player: Player = { userId: ev.userId, name, team, role, joinedAt: ev.at };
  state.players[ev.userId] = player;
  state.stats.byPlayer[ev.userId] = playerStats(player);
  return { player, duplicate: false };
}

// ---------- score ----------

export function cellPoints(state: CellState, kind: CellDef["kind"]): number {
  if (kind === "cabin") return state === "cabin" || state === "water" ? 10 : 0;
  return state === "forest" || state === "water" ? 1 : 0;
}

/** Per team: points (forest + water + 10 per standing cabin), % of its start, squares on fire. */
export function scores(state: GameState, cells: CellDef[]): Record<Team, { points: number; pct: number; fire: number }> {
  const out = {} as Record<Team, { points: number; pct: number; fire: number }>;
  for (const t of TEAMS) out[t] = { points: 0, pct: 0, fire: 0 };
  for (const c of cells) {
    const st = state.cells[c.label]!;
    out[c.sector].points += cellPoints(st, c.kind);
    if (st === "fire") out[c.sector].fire++;
  }
  for (const t of TEAMS) out[t].pct = Math.round((100 * out[t].points) / state.startScore[t]);
  return out;
}

// ---------- fire ----------

function ignite(state: GameState, rules: RuleSet, lab: string) {
  state.cells[lab] = "fire";
  state.burnLeft[lab] = rules.burnTicks;
  delete state.wet[lab];
  state.stats.ignitions++;
}

/** 1 = downwind (within 45° of the wind), -1 = upwind (135° or more), 0 = across. */
function windSide(dirIndex: number, wind: number): 1 | 0 | -1 {
  const d = Math.min(Math.abs(dirIndex - wind), 8 - Math.abs(dirIndex - wind));
  return d <= 1 ? 1 : d >= 3 ? -1 : 0;
}

const burnable = (s: CellState | undefined) => s === "forest" || s === "cabin";

export interface AdvanceResult {
  changed: string[]; // labels whose state changed
  events: string[];
}

/** One spread: every burning square may ignite its neighbours, embers fly, old fires burn out. */
export function spread(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng): string[] {
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  const lit = new Set<string>();
  for (const f of fires) {
    WIND.forEach((w, i) => {
      const n = byPos.get(`${f.col + w.dc},${f.row + w.dr}`);
      if (!n || !burnable(state.cells[n.label]) || lit.has(n.label)) return;
      const side = windSide(i, state.wind);
      const p = (w.dc && w.dr ? rules.pDiag : rules.pSide) * (side === 1 ? rules.downwindMult : side === -1 ? rules.upwindMult : 1);
      if (rng() < p) lit.add(n.label);
    });
    if (rng() < rules.pEmber) {
      const w = WIND[state.wind]!;
      const t = byPos.get(`${f.col + 2 * w.dc},${f.row + 2 * w.dr}`);
      if (t && state.cells[t.label] === "forest" && !lit.has(t.label)) {
        lit.add(t.label);
        state.stats.embers++;
      }
    }
  }
  const changed: string[] = [];
  for (const f of fires) {
    state.burnLeft[f.label] = (state.burnLeft[f.label] ?? 1) - 1;
    if (state.burnLeft[f.label]! <= 0) {
      state.cells[f.label] = "burnt";
      delete state.burnLeft[f.label];
      state.stats.burntOut++;
      if (f.kind === "cabin") {
        state.stats.cabinsLost.push(f.label);
        pushEvent(state, `🏚️ Cabin ${f.label} (${teamName(f.sector)}) burned down!`);
      }
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

/** Lightning: a random forest square at least lightningMinDistance (Chebyshev) from any fire. */
export function strike(state: GameState, rules: RuleSet, cells: CellDef[], rng: Rng): string | null {
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  const forest = cells.filter((c) => state.cells[c.label] === "forest");
  const far = forest.filter((c) => fires.every((f) => Math.max(Math.abs(f.col - c.col), Math.abs(f.row - c.row)) >= rules.lightningMinDistance));
  const pool = far.length ? far : forest;
  if (!pool.length) return null;
  const hit = pool[Math.floor(rng() * pool.length)]!;
  ignite(state, rules, hit.label);
  state.stats.strikes.push(hit.label);
  pushEvent(state, `⚡ LIGHTNING struck ${hit.label} in ${teamName(hit.sector)}!`);
  return hit.label;
}

function dry(state: GameState, upTo: number): string[] {
  const out: string[] = [];
  for (const [lab, w] of Object.entries(state.wet)) {
    if (w.until > upTo || state.cells[lab] !== "water") continue;
    state.cells[lab] = w.back;
    delete state.wet[lab];
    out.push(lab);
  }
  return out;
}

/**
 * Move game time forward by dtMs: water dries, the wind turns, lightning strikes, the fire spreads,
 * the game ends. Events fire in time order. Mutates state.
 */
export function advance(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng, dtMs: number, realNow = 0): AdvanceResult {
  const changed = new Set<string>();
  const events: string[] = [];
  if (state.phase !== "live") return { changed: [], events };
  const target = state.elapsed + Math.max(0, dtMs);
  const lastLightning = Math.max(0, ...rules.lightningAt) * 60_000;
  for (;;) {
    const nextLightning = state.lightningDone < rules.lightningAt.length ? rules.lightningAt[state.lightningDone]! * 60_000 : Infinity;
    const gameEnd = rules.gameMinutes * 60_000;
    const next = Math.min(state.nextSpreadAt, state.nextWindAt, nextLightning, gameEnd);
    if (next > target) break;
    state.elapsed = next;
    for (const l of dry(state, next)) changed.add(l);
    if (next === gameEnd) {
      endGame(state, cells, realNow, "time");
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
    } else if (next === state.nextWindAt) {
      state.wind = (state.wind + (rng() < 0.5 ? 1 : 7)) % 8;
      state.nextWindAt += rules.windMinutes * 60_000;
      pushEvent(state, `🌬️ The wind turned: now blowing ${WIND[state.wind]!.arrow} ${WIND[state.wind]!.word}`);
      events.push(`wind ${WIND[state.wind]!.name}`);
    } else {
      for (const l of spread(state, rules, cells, byPos, rng)) changed.add(l);
      state.nextSpreadAt += rules.spreadSeconds * 1000;
      const burning = Object.values(state.cells).some((s) => s === "fire");
      state.quiet = burning || state.elapsed < lastLightning ? 0 : state.quiet + 1;
      if (state.quiet >= rules.quietSpreads) {
        endGame(state, cells, realNow, "out");
        pushEvent(state, "🌧️ The fire is out!");
        events.push("fire out");
        break;
      }
    }
  }
  if (state.phase === "live") {
    state.elapsed = target;
    for (const l of dry(state, target)) changed.add(l);
  }
  state.grants = state.grants.filter((g) => g.until > state.elapsed);
  return { changed: [...changed], events };
}

// ---------- paints ----------

function reject(state: GameState, userId: string, rule: RuleId, feedback: string): Decision {
  state.stats.illegal[rule]++;
  const ps = state.stats.byPlayer[userId];
  if (ps) ps.illegal[rule]++;
  return { accept: false, rule, feedback };
}

/** An active HELP grant that lets this player paint in `sector` (claims a helper slot if free). */
function helpFor(state: GameState, rules: RuleSet, player: Player, sector: Team): HelpGrant | null {
  for (const g of state.grants) {
    if (g.to !== sector || g.helper !== player.team || g.until <= state.elapsed) continue;
    if (g.players.includes(player.userId) || g.players.length < rules.helpPlayers) return g;
  }
  return null;
}

/**
 * Decide one observed fill change against the referee's state. On accept the state takes the paint
 * (and uses water from the pool). Events for one tick must be passed in time order.
 */
export function decidePaint(state: GameState, rules: RuleSet, cells: Map<string, CellDef>, ev: PaintEvent): Decision {
  const cell = cells.get(ev.label);
  if (!cell) return { accept: false, feedback: `❌ ${ev.label} reverted: unknown square.` };
  const lab = cell.label;
  if (state.phase === "lobby") return reject(state, ev.userId, "lobby", `⏸ ${lab} reverted: the game hasn't started yet.`);
  if (state.phase === "over") return reject(state, ev.userId, "over", `🏁 ${lab} reverted: the game is over.`);
  const player = state.players[ev.userId];
  if (!player) return reject(state, ev.userId, "unjoined", `❌ ${lab} reverted: you haven't joined. Run /join first.`);
  const team = player.team;
  const frozen = state.timeoutUntil[ev.userId];
  if (frozen !== undefined && ev.at < frozen) return reject(state, ev.userId, "timeout", `🧊 ${lab} reverted: you're frozen for ${Math.ceil((frozen - ev.at) / 1000)}s more.`);
  const last = state.lastPaintAt[ev.userId];
  const cool = rules.cooldownSeconds * 1000;
  if (last !== undefined && ev.at - last < cool) return reject(state, ev.userId, "cooldown", `⏳ ${lab} reverted: one paint every ${rules.cooldownSeconds}s (${Math.ceil((cool - (ev.at - last)) / 1000)}s early).`);
  if (!state.plan[team]) return reject(state, ev.userId, "plan", `📋 ${lab} reverted: ${teamName(team)} has no approved PLAN yet. Your boss posts PLAN in ${`ORDERS · ${teamName(team).toUpperCase()}`}; a teammate answers YES.`);
  let grant: HelpGrant | null = null;
  if (cell.sector !== team) {
    grant = helpFor(state, rules, player, cell.sector);
    if (!grant) return reject(state, ev.userId, "sector", `🧭 ${lab} reverted: it's in ${teamName(cell.sector)}. Paint only in your sector (${sectorText(team)}) unless an approved HELP covers you.`);
  }
  const want = stateOfFill(ev.fill);
  const cur = state.cells[lab]!;
  if (want === "water") {
    if (cur !== "fire" && cur !== "forest" && cur !== "cabin") return reject(state, ev.userId, "color", `❌ ${lab} reverted: water goes on fire, forest or a cabin (it is ${cur}).`);
    if (state.water <= 0) return reject(state, ev.userId, "water", `🚱 ${lab} reverted: the shared water is all used up. Firebreaks still work.`);
  } else if (want === "firebreak") {
    if (cur !== "forest") return reject(state, ev.userId, "color", `❌ ${lab} reverted: a firebreak goes on forest only (it is ${cur}).`);
  } else if (want === "burnt") {
    if (cur !== "forest") return reject(state, ev.userId, "color", `❌ ${lab} reverted: only forest can be backburned (it is ${cur}).`);
    if (!state.backburn[team].includes(lab)) return reject(state, ev.userId, "backburn", `❌ ${lab} reverted: it isn't in an approved BACKBURN of ${teamName(team)}.`);
  } else {
    return reject(state, ev.userId, "color", `🎨 ${lab} reverted: paint only water ${STATE_COLOR.water}, firebreak ${STATE_COLOR.firebreak}, or burnt ${STATE_COLOR.burnt} (approved BACKBURN).`);
  }

  if (grant && !grant.players.includes(ev.userId)) grant.players.push(ev.userId);
  const ps = state.stats.byPlayer[ev.userId]!;
  state.stats.accepted++;
  state.lastPaintAt[ev.userId] = ev.at;
  if (want === "water") {
    state.water--;
    state.wet[lab] = { until: state.elapsed + rules.wetSeconds * 1000, back: cur === "fire" ? (cell.kind === "cabin" ? "cabin" : "forest") : (cur as "forest" | "cabin") };
    delete state.burnLeft[lab];
    state.cells[lab] = "water";
    ps.water++;
    return { accept: true, feedback: `💧 ${lab} ${cur === "fire" ? "put out" : "soaked"} (${state.water} water left).` };
  }
  state.cells[lab] = want;
  if (want === "firebreak") {
    ps.firebreak++;
    return { accept: true, feedback: `🪓 ${lab} is a firebreak.` };
  }
  ps.burnt++;
  return { accept: true, feedback: `⬛ ${lab} backburned.` };
}

export function decideTamper(state: GameState, rules: RuleSet, ev: TamperEvent): Decision {
  const player = state.players[ev.userId];
  const verb = ev.what === "added" ? "Removed" : "Restored";
  let freeze = "";
  if (player && state.phase === "live") {
    state.timeoutUntil[ev.userId] = ev.at + rules.timeoutSeconds * 1000;
    freeze = ` You're frozen for ${rules.timeoutSeconds}s.`;
  }
  return reject(state, ev.userId, "tamper", `⚠️ ${verb} ${ev.target} (${ev.what}). Only square colors may change.${freeze}`);
}

// ---------- approvals (sticky notes in the Orders frames) ----------

/** BACKBURN squares: "P6-P15" (one column or row) or labels separated by spaces/commas. */
export function parseBackburn(spec: string, team: Team, cells: Map<string, CellDef>, max: number): { labels: string[] } | { error: string } {
  const labels: string[] = [];
  for (const tok of spec.toUpperCase().split(/[\s,;]+/).filter(Boolean)) {
    const range = /^([A-Z]{1,2}\d{1,2})(?:-|–|—|\.\.)([A-Z]{1,2}\d{1,2})$/.exec(tok);
    if (range) {
      const a = parseLabel(range[1]!);
      const b = parseLabel(range[2]!);
      if (!a || !b) return { error: `"${tok}" is not a range of squares` };
      if (a.col !== b.col && a.row !== b.row) return { error: `${tok} is not a straight run in one column or row` };
      const n = Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
      const dc = Math.sign(b.col - a.col);
      const dr = Math.sign(b.row - a.row);
      for (let i = 0; i <= n; i++) labels.push(label(a.col + i * dc, a.row + i * dr));
      continue;
    }
    if (!parseLabel(tok)) return { error: `"${tok}" is not a square` };
    labels.push(tok);
  }
  const uniq = [...new Set(labels)];
  if (!uniq.length) return { error: "no squares listed (write e.g. BACKBURN P6-P15)" };
  if (uniq.length > max) return { error: `${uniq.length} squares; the limit is ${max}` };
  const outside = uniq.filter((l) => cells.get(l)?.sector !== team);
  if (outside.length) return { error: `${outside.slice(0, 4).join(" ")} ${outside.length === 1 ? "is" : "are"} outside ${teamName(team)}` };
  return { labels: uniq };
}

function stickyLines(text: string): string[] {
  return text.split(/\n/).map((l) => l.trim()).filter(Boolean);
}

export function stickyKind(text: string): StickyKind | "ORDER" | "STATUS" | null {
  const first = stickyLines(text)[0]?.toUpperCase() ?? "";
  const m = /^(PLAN|BACKBURN|HELP|ORDER|STATUS)\b/.exec(first);
  return (m?.[1] as StickyKind | "ORDER" | "STATUS" | undefined) ?? null;
}

/**
 * Judge one PLAN/BACKBURN/HELP sticky. Approved = it has a YES line and its last editor is on the
 * right team and is not its creator; approvals are remembered once seen. Returns lines for inbox cards.
 */
export function judgeSticky(state: GameState, rules: RuleSet, cells: Map<string, CellDef>, s: StickyView): Note[] {
  if (state.approvals[s.id]?.status === "approved") return [];
  const kind = stickyKind(s.text);
  if (kind !== "PLAN" && kind !== "BACKBURN" && kind !== "HELP") return [];
  const lines = stickyLines(s.text);
  const first = lines[0]!.replace(/^\S+\s*/, "");
  const creator = state.players[s.createdBy];
  const notes: Note[] = [];
  const tellCreator = (line: string) => {
    if (state.noted[s.id] === line) return;
    state.noted[s.id] = line;
    notes.push({ userId: s.createdBy, line });
  };
  const teamOf = (t: Team) => Object.values(state.players).filter((p) => p.team === t).map((p) => p.userId);
  const frame = `ORDERS · ${teamName(s.team).toUpperCase()}`;

  // Is the sticky itself valid?
  let labels: string[] | undefined;
  let forTeam: Team | undefined;
  if (!creator) return notes; // not a player (the instructor's examples, a guest): ignored
  if (kind === "HELP") {
    forTeam = teamByName(first) ?? undefined;
    if (!forTeam) return (tellCreator(`❓ HELP in ${frame}: write HELP and your team's name, e.g. HELP ${teamName(creator.team)}.`), notes);
    if (forTeam === s.team) return (tellCreator(`❓ HELP for ${teamName(forTeam)} must go in another team's Orders frame.`), notes);
    if (creator.team !== forTeam) return (tellCreator(`❓ Only ${teamName(forTeam)} can ask for help for ${teamName(forTeam)}.`), notes);
  } else {
    if (creator.team !== s.team) return (tellCreator(`❓ Your ${kind} is in ${frame}; post it in your own team's frame.`), notes);
    if (kind === "BACKBURN") {
      const r = parseBackburn(first, s.team, cells, rules.backburnMax);
      if ("error" in r) return (tellCreator(`❓ BACKBURN not valid: ${r.error}.`), notes);
      labels = r.labels;
    }
  }

  const answers = lines.slice(1).map((l) => l.toUpperCase()).filter((l) => l === "YES" || l === "NO");
  if (!answers.length) return notes;
  const answer = answers.includes("YES") && answers.includes("NO") ? answers[answers.length - 1]! : answers.includes("YES") ? "YES" : "NO";
  if (s.modifiedBy === s.createdBy) return (tellCreator(`✋ Your ${kind} needs an answer from ${kind === "HELP" ? `a ${teamName(s.team)} player` : "a teammate"} who did not post it.`), notes);
  const editor = state.players[s.modifiedBy];
  if (!editor || editor.team !== s.team) return (tellCreator(`✋ Your ${kind} was answered by someone outside ${teamName(s.team)}; that doesn't count.`), notes);

  if (answer === "NO") {
    if (state.approvals[s.id]?.status !== "refused") {
      state.approvals[s.id] = { kind, team: s.team, creator: s.createdBy, status: "refused", by: s.modifiedBy, at: state.elapsed, labels, forTeam };
      notes.push({ userId: s.createdBy, line: `🙅 ${editor.name} said NO to your ${kind}.` });
    }
    return notes;
  }
  state.approvals[s.id] = { kind, team: s.team, creator: s.createdBy, status: "approved", by: s.modifiedBy, at: state.elapsed, labels, forTeam };
  if (kind === "PLAN") {
    state.plan[s.team] ??= s.id;
    pushEvent(state, `📋 ${teamName(s.team)}'s PLAN approved`);
    for (const u of teamOf(s.team)) notes.push({ userId: u, line: `✅ PLAN approved by ${editor.name}: ${teamName(s.team)} may paint now.` });
  } else if (kind === "BACKBURN") {
    state.backburn[s.team] = [...new Set([...state.backburn[s.team], ...labels!])];
    pushEvent(state, `⬛ ${teamName(s.team)} BACKBURN approved (${labels!.length} squares)`);
    for (const u of teamOf(s.team)) notes.push({ userId: u, line: `⬛ BACKBURN approved by ${editor.name}: paint burnt ${STATE_COLOR.burnt} on ${labels!.join(" ")}` });
  } else {
    const until = state.elapsed + rules.helpMinutes * 60_000;
    state.grants.push({ sticky: s.id, helper: s.team, to: forTeam!, until, players: [] });
    pushEvent(state, `🤝 ${teamName(s.team)} is helping ${teamName(forTeam!)}`);
    for (const u of teamOf(s.team)) notes.push({ userId: u, line: `🤝 HELP approved: up to ${rules.helpPlayers} of you may paint in ${teamName(forTeam!)} (${forTeam}) for ${rules.helpMinutes} min.` });
    for (const u of teamOf(forTeam!)) notes.push({ userId: u, line: `🤝 ${teamName(s.team)} is sending help for ${rules.helpMinutes} min.` });
  }
  return notes;
}

/** Stickies waiting for an answer, for the leaderboard: "PLAN by Alice". */
export function pendingStickies(state: GameState, stickies: StickyView[]): Record<Team, string[]> {
  const out: Record<Team, string[]> = { ridge: [], pine: [], cedar: [], birch: [] };
  for (const s of stickies) {
    const kind = stickyKind(s.text);
    if (kind !== "PLAN" && kind !== "BACKBURN" && kind !== "HELP") continue;
    const who = state.players[s.createdBy]?.name;
    if (!who) continue; // not a player (the instructor's example sticky): judgeSticky ignores it too
    const a = state.approvals[s.id];
    // A refused sticky rewritten without its NO line is asking again.
    if (a?.status === "approved" || (a && stickyLines(s.text).slice(1).some((l) => l.toUpperCase() === "NO"))) continue;
    out[s.team].push(`${kind === "HELP" ? stickyLines(s.text)[0] : kind} by ${who}`);
  }
  return out;
}
