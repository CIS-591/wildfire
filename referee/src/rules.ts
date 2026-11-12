// Pure rules engine (SPEC.md section 3): state + observed board changes -> decisions. No I/O, no clocks:
// game time (`elapsed`) only moves through advance(), and every random draw comes from the injected rng.
import { FIRST_FIRE, NEIGHBOURS, STATE_COLOR, TEAMS, TEAM_INFO, WIND, sectorText, startState, stateOfFill, teamByName, type CellDef, type CellState, type Team } from "./layout.js";

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
  pSide: number; // a burning square ignites each green neighbour up/down/left/right (per spread)
  pDiag: number; // ... each diagonal one (small). With the wind off: the same in every direction.
  /** Wind, switched off by default (kept so it can be turned back on): downwind pDown, upwind pUp, crosswind pSide; turns 45° once at turnAt. */
  wind?: { enabled: boolean; pDown: number; pUp: number; turnAt: number };
  burnTicks: number;
  lightningAt: number[]; // minutes; each strike hits a different team's area
  startFires: string[]; // lit at the start besides the centre fire (2 squares inside each area, mirrored)
  /** Game minute the startFires are lit (default 0: with the centre fire). Later gives agents time to get going. */
  startFiresAt?: number;
  paintBatch: number; // squares one player may change in one batch (one poll); then cooldownSeconds
  lightningMinDistance: number;
  waterPerTeam: number; // each team's own bucket of blue paints
  cooldownSeconds: number;
  timeoutSeconds: number;
  attackMinutes: number; // an approved attack lasts this long
  attackSquares: number; // ... and may light at most this many green squares
  attacksPerTeam: number; // approved attacks per team per game
  gameMinutes: number;
}

export type RuleId = "lobby" | "over" | "unjoined" | "timeout" | "cooldown" | "batch" | "color" | "square" | "area" | "attack" | "water" | "tamper";
export const RULE_IDS: RuleId[] = ["lobby", "over", "unjoined", "timeout", "cooldown", "batch", "color", "square", "area", "attack", "water", "tamper"];
/** Who lit a fire (or the fire that burned a square): the wild fire (centre, lightning) or a team's attack. */
export type Origin = Team | "wild";

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
  lit: number; // accepted orange paints (attack fires lit)
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

/** An approved attack: `team` may paint orange on up to `left` green squares in `to`'s area until `until`. */
export interface Attack {
  sticky: string;
  team: Team;
  to: Team;
  until: number; // game ms
  left: number; // squares it may still light
  lit: number; // squares lit so far
}

export interface GameEvent {
  at: number; // game ms
  text: string;
}

export interface GameState {
  version: 3;
  phase: Phase;
  startedAt: number | null; // real ms
  endedAt: number | null; // real ms
  endReason: "time" | "out" | "stopped" | null;
  winner: Team | null;
  elapsed: number; // game ms since the start (only advance() moves it)
  cells: Record<string, CellState>;
  burnLeft: Record<string, number>; // label -> spreads left before it burns out
  nextSpreadAt: number;
  spreads: number;
  lightningDone: number; // how many of rules.lightningAt have struck
  /** The in-area start fires are lit (absent on old saves: treated as lit). */
  startFiresLit?: boolean;
  water: Record<Team, number>; // each team's bucket
  wind: number; // index into WIND (used only when rules.wind.enabled)
  windTurned: boolean;
  startScore: Record<Team, number>;
  players: Record<string, Player>;
  lastPaintAt: Record<string, number>; // userId -> real ms when their last batch began
  batch: Record<string, { at: number; n: number; id?: number }>; // userId -> current batch: start (real ms) and squares in it
  struck: Team[]; // areas lightning has hit (each team once)
  timeoutUntil: Record<string, number>; // userId -> frozen until (real ms)
  approvals: Record<string, Approval>; // sticky id -> remembered answer
  noted: Record<string, string>; // sticky id -> last problem told to its creator (no repeats)
  junk: Record<string, number>; // userId -> junk items of theirs removed (images, stray shapes...): escalating freeze
  attacks: Attack[]; // running attacks (approved "Start a fire in <neighbour>'s area?")
  attacksUsed: Record<Team, number>; // approved attacks per team so far
  origin: Record<string, Origin>; // fire/burnt square -> who lit the fire (absent = wild)
  events: GameEvent[];
  stats: {
    accepted: number;
    ignitions: number;
    burntOut: number;
    strikes: string[];
    illegal: Record<RuleId, number>;
    byPlayer: Record<string, PlayerStats>;
    lit: Record<Team, number>; // orange squares each team lit in a neighbour's area
    burnedOthers: Record<Team, number>; // trees in OTHER teams' areas burned out by this team's fires
    blowback: Record<Team, number>; // trees in its OWN area burned out by this team's fires
  };
}

export interface PaintEvent {
  label: string;
  fill: string;
  userId: string;
  at: number; // real ms
  batchId?: number; // the poll (referee tick) that saw it: one player's squares in one poll are one batch
}

/** Squares by one player within this long of their batch's first square are the same batch. */
export const BATCH_WINDOW_MS = 3000;

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
  createdAt?: number; // epoch ms (oldest questions keep their place under the cap)
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
  return { name: p.name, team: p.team, role: p.role, water: 0, lit: 0, illegal: emptyIllegal() };
}

const zeroTeams = (): Record<Team, number> => ({ ridge: 0, pine: 0, cedar: 0, birch: 0 });

/** Accepted paints of a player (blue + orange): the number on their inbox card. */
export const paintsOf = (ps: PlayerStats | undefined) => (ps ? ps.water + (ps.lit ?? 0) : 0);

export function createState(cells: CellDef[], rules: RuleSet, rng: Rng): GameState {
  const state: GameState = {
    version: 3,
    phase: "lobby",
    startedAt: null,
    endedAt: null,
    endReason: null,
    winner: null,
    elapsed: 0,
    cells: Object.fromEntries(cells.map((c) => [c.label, startState(c)])),
    burnLeft: Object.fromEntries(FIRST_FIRE.map((l) => [l, rules.burnTicks])),
    nextSpreadAt: rules.spreadSeconds * 1000,
    spreads: 0,
    lightningDone: 0,
    startFiresLit: false,
    water: { ridge: rules.waterPerTeam, pine: rules.waterPerTeam, cedar: rules.waterPerTeam, birch: rules.waterPerTeam },
    wind: Math.floor(rng() * 8),
    windTurned: false,
    startScore: { ridge: 0, pine: 0, cedar: 0, birch: 0 },
    players: {},
    lastPaintAt: {},
    batch: {},
    struck: [],
    timeoutUntil: {},
    approvals: {},
    noted: {},
    junk: {},
    attacks: [],
    attacksUsed: zeroTeams(),
    origin: {},
    events: [],
    stats: { accepted: 0, ignitions: FIRST_FIRE.length, burntOut: 0, strikes: [], illegal: emptyIllegal(), byPlayer: {}, lit: zeroTeams(), burnedOthers: zeroTeams(), blowback: zeroTeams() },
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
  const extra = (rules.startFiresAt ?? 0) > 0 ? [] : lightStartFires(state, rules);
  pushEvent(state, `🔥 The fire started in the centre${extra.length ? " and in every team's area" : ""}!`);
  return [...FIRST_FIRE, ...extra];
}

/** The in-area start fires (rules.startFires), at the start or at rules.startFiresAt. */
function lightStartFires(state: GameState, rules: RuleSet): string[] {
  state.startFiresLit = true;
  const extra = (rules.startFires ?? []).filter((l) => state.cells[l] === "forest");
  for (const lab of extra) ignite(state, rules, lab);
  return extra;
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

/** Per team: green squares left in its own area, % of the area (306), squares on fire there. */
export function scores(state: GameState, cells: CellDef[]): Record<Team, { points: number; pct: number; fire: number }> {
  const out = {} as Record<Team, { points: number; pct: number; fire: number }>;
  for (const t of TEAMS) out[t] = { points: 0, pct: 0, fire: 0 };
  for (const c of cells) {
    const st = state.cells[c.label]!;
    if (st === "forest") out[c.sector].points++;
    if (st === "fire") out[c.sector].fire++;
  }
  for (const t of TEAMS) out[t].pct = Math.round((100 * out[t].points) / state.startScore[t]);
  return out;
}

// ---------- fire ----------

function ignite(state: GameState, rules: RuleSet, lab: string, origin: Origin = "wild") {
  state.cells[lab] = "fire";
  state.burnLeft[lab] = rules.burnTicks;
  state.stats.ignitions++;
  if (origin === "wild") delete state.origin[lab];
  else state.origin[lab] = origin;
}

/**
 * Chance a burning square ignites its green neighbour in direction `dirIndex` (index into NEIGHBOURS) this
 * spread. Diagonals: pDiag. Straight: pSide; with the wind on, pDown with it and pUp against it (halfway at 45°).
 */
export function igniteChance(rules: RuleSet, dirIndex: number, wind = 0): number {
  const w = NEIGHBOURS[dirIndex]!;
  if (w.dc && w.dr) return rules.pDiag;
  if (!rules.wind?.enabled) return rules.pSide;
  const d = Math.min(Math.abs(dirIndex - wind), 8 - Math.abs(dirIndex - wind)); // 0..4 steps of 45°
  const { pDown, pUp } = rules.wind;
  return [pDown, (pDown + rules.pSide) / 2, rules.pSide, (rules.pSide + pUp) / 2, pUp][d]!;
}

/** The wind is on (rules.json wind.enabled). */
export const windOn = (rules: RuleSet) => !!rules.wind?.enabled;

export interface AdvanceResult {
  changed: string[]; // labels whose state changed
  events: string[];
  ended: Attack[]; // attacks that just ran out
}

/** One spread: every burning square may ignite its green neighbours, old fires burn out. */
export function spread(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng): string[] {
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  const lit = new Map<string, Origin>(); // a new fire inherits the origin of the square that lit it
  for (const f of fires) {
    NEIGHBOURS.forEach((w, i) => {
      const n = byPos.get(`${f.col + w.dc},${f.row + w.dr}`);
      if (!n || state.cells[n.label] !== "forest" || lit.has(n.label)) return;
      if (rng() < igniteChance(rules, i, state.wind)) lit.set(n.label, state.origin[f.label] ?? "wild");
    });
  }
  const changed: string[] = [];
  for (const f of fires) {
    state.burnLeft[f.label] = (state.burnLeft[f.label] ?? 1) - 1;
    if (state.burnLeft[f.label]! <= 0) {
      state.cells[f.label] = "burnt"; // keeps its origin: the border shows whose fire burned it
      delete state.burnLeft[f.label];
      state.stats.burntOut++;
      const o = state.origin[f.label];
      if (o && o !== "wild") {
        if (o === f.sector) state.stats.blowback[o]++;
        else state.stats.burnedOthers[o]++;
      }
      changed.push(f.label);
    }
  }
  for (const [lab, origin] of lit) {
    ignite(state, rules, lab, origin);
    changed.push(lab);
  }
  state.spreads++;
  return changed;
}

/**
 * Lightning: each strike hits a different team's area (each team once, in random order), on a green square
 * at least lightningMinDistance (Chebyshev) from any fire; closer if that area has no such square.
 */
export function strike(state: GameState, rules: RuleSet, cells: CellDef[], rng: Rng): string | null {
  state.struck ??= [];
  const fires = cells.filter((c) => state.cells[c.label] === "fire");
  let teams = TEAMS.filter((t) => !state.struck.includes(t));
  if (!teams.length) teams = [...TEAMS];
  const area = teams[Math.floor(rng() * teams.length)]!;
  const green = (t?: Team) => cells.filter((c) => state.cells[c.label] === "forest" && (!t || c.sector === t));
  const distTo = (c: CellDef) => fires.reduce((d, f) => Math.min(d, Math.max(Math.abs(f.col - c.col), Math.abs(f.row - c.row))), Infinity);
  const inArea = green(area);
  const far = inArea.filter((c) => distTo(c) >= rules.lightningMinDistance);
  // No far square left there: the farthest green squares of that area; no green there: anywhere.
  const best = inArea.length ? Math.max(...inArea.map(distTo)) : 0;
  const pool = far.length ? far : inArea.length ? inArea.filter((c) => distTo(c) === best) : green();
  if (!pool.length) return null;
  const hit = pool[Math.floor(rng() * pool.length)]!;
  state.struck.push(hit.sector);
  ignite(state, rules, hit.label);
  state.stats.strikes.push(hit.label);
  pushEvent(state, `⚡ Lightning! New fire at ${hit.label} (${teamName(hit.sector)}'s area)`);
  return hit.label;
}

/**
 * Move game time forward by dtMs: lightning strikes, the fire spreads,
 * attacks run out, the game ends. Events fire in time order. Mutates state.
 */
export function advance(state: GameState, rules: RuleSet, cells: CellDef[], byPos: Map<string, CellDef>, rng: Rng, dtMs: number, realNow = 0): AdvanceResult {
  const changed = new Set<string>();
  const events: string[] = [];
  if (state.phase !== "live") return { changed: [], events, ended: [] };
  const target = state.elapsed + Math.max(0, dtMs);
  const gameEnd = rules.gameMinutes * 60_000;
  for (;;) {
    const nextLightning = state.lightningDone < rules.lightningAt.length ? rules.lightningAt[state.lightningDone]! * 60_000 : Infinity;
    const windAt = windOn(rules) && !state.windTurned ? rules.wind!.turnAt * 60_000 : Infinity;
    const startAt = state.startFiresLit === false ? (rules.startFiresAt ?? 0) * 60_000 : Infinity;
    const next = Math.min(state.nextSpreadAt, windAt, nextLightning, gameEnd, startAt);
    if (next > target) break;
    state.elapsed = next;
    if (next === gameEnd) {
      endGame(state, cells, realNow, "time");
      pushEvent(state, "⏱ Time is up!");
      events.push("⏱ Time is up");
      break;
    }
    if (next === startAt) {
      const lit = lightStartFires(state, rules);
      for (const l of lit) changed.add(l);
      if (lit.length) {
        pushEvent(state, "🔥 New fires in every team's area!");
        events.push(`🔥 start fires ${lit.join(" ")}`);
      }
    } else if (next === nextLightning) {
      state.lightningDone++;
      const hit = strike(state, rules, cells, rng);
      if (hit) {
        changed.add(hit);
        events.push(`⚡ lightning at ${hit}`);
      }
    } else if (next === windAt) {
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
  const ended = state.attacks.filter((g) => g.until <= state.elapsed || state.phase !== "live");
  state.attacks = state.attacks.filter((g) => !ended.includes(g));
  return { changed: [...changed], events, ended };
}

/** No square burns and no lightning is still to come. */
function fireOut(state: GameState, rules: RuleSet): boolean {
  return state.lightningDone >= rules.lightningAt.length && state.startFiresLit !== false && !Object.values(state.cells).some((s) => s === "fire");
}

// ---------- paints ----------

function reject(state: GameState, userId: string, rule: RuleId, feedback: string): Decision {
  state.stats.illegal[rule]++;
  const ps = state.stats.byPlayer[userId];
  if (ps) ps.illegal[rule]++;
  return { accept: false, rule, feedback };
}

/** The running attack that lets `team` light squares in `to`'s area, if any (the one with squares left first). */
export function attackOn(state: GameState, team: Team, to: Team): Attack | null {
  const running = state.attacks.filter((g) => g.team === team && g.to === to && g.until > state.elapsed);
  return running.find((g) => g.left > 0) ?? running[0] ?? null;
}

const ORANGE = () => `orange ${STATE_COLOR.fire}`;

/**
 * Decide one observed fill change against the referee's state. Blue: on a green or orange square in the
 * painter's own area (1 shared water). Orange: on a green square in a neighbour's area during the team's
 * approved attack (at most attackSquares per attack). Events for one tick must be passed in time order.
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
  // Batches: up to paintBatch squares in one go (same poll, within BATCH_WINDOW of its first square), then the cooldown.
  state.batch ??= {};
  const b = state.batch[ev.userId];
  const sameBatch = (rules.paintBatch ?? 1) > 1 && !!b && ev.at >= b.at && (ev.at - b.at < BATCH_WINDOW_MS || (ev.batchId !== undefined && ev.batchId === b.id));
  if (sameBatch) {
    if (b.n >= (rules.paintBatch ?? 1)) return reject(state, ev.userId, "batch", `✋ ${lab} undone: at most ${rules.paintBatch ?? 1} squares per paint, then wait ${rules.cooldownSeconds} s.`);
  } else {
    const last = state.lastPaintAt[ev.userId];
    const cool = rules.cooldownSeconds * 1000;
    if (last !== undefined && ev.at - last < cool) return reject(state, ev.userId, "cooldown", `⏳ ${lab} undone: wait ${rules.cooldownSeconds} s between paints.`);
  }
  // An accepted square joins the current batch, or starts a new one (which restarts the cooldown).
  const startBatch = () => {
    if (sameBatch) b!.n++;
    else {
      state.batch[ev.userId] = { at: ev.at, n: 1, id: ev.batchId };
      state.lastPaintAt[ev.userId] = ev.at;
    }
  };
  const color = stateOfFill(ev.fill);
  const cur = state.cells[lab]!;
  const away = cell.sector !== team;
  const ps = state.stats.byPlayer[ev.userId]!;

  if (color === "water") {
    if (cur !== "forest" && cur !== "fire") return reject(state, ev.userId, "square", `❌ ${lab} undone: it is already ${cur === "water" ? "water" : "burnt"}. Paint green or orange squares.`);
    if (away) return reject(state, ev.userId, "area", `🧭 ${lab} undone: it is ${teamName(cell.sector)}'s area. Paint ${BLUE()} only in your team's area (${sectorText(team)}).`);
    if ((state.water[team] ?? 0) <= 0) return reject(state, ev.userId, "water", `🚱 ${lab} undone: ${teamName(team)}'s water is empty.`);
    startBatch();
    state.stats.accepted++;
    state.water[team]--;
    delete state.burnLeft[lab];
    delete state.origin[lab];
    state.cells[lab] = "water";
    ps.water++;
    return { accept: true, feedback: `💧 ${lab} ${cur === "fire" ? "fire put out" : "is now water"}. ${state.water[team]} water left for ${teamName(team)}.` };
  }

  if (color === "fire") {
    if (!away) return reject(state, ev.userId, "color", `🎨 ${lab} undone: in your team's area paint only ${BLUE()}. ${ORANGE()} is for an approved attack on a neighbour.`);
    const atk = TEAM_INFO[team].neighbours.includes(cell.sector) ? attackOn(state, team, cell.sector) : null;
    if (!atk) return reject(state, ev.userId, "area", `🧭 ${lab} undone: setting fire in ${teamName(cell.sector)}'s area needs a teammate's YES to "${questionLine(cell.sector)}?".`);
    if (atk.left <= 0) return reject(state, ev.userId, "attack", `🔥 ${lab} undone: your attack on ${teamName(cell.sector)}'s area has lit its ${rules.attackSquares} squares.`);
    if (cur !== "forest") return reject(state, ev.userId, "square", `❌ ${lab} undone: only green squares can be set on fire.`);
    startBatch();
    ignite(state, rules, lab, team);
    atk.left--;
    atk.lit++;
    state.stats.lit[team]++;
    ps.lit++;
    if (atk.lit === 1) pushEvent(state, `🔥 ${teamName(team)} set fire to ${teamName(cell.sector)}'s area!`);
    return { accept: true, feedback: `🔥 ${lab} is burning. ${atk.left} more for this attack.` };
  }

  return reject(state, ev.userId, "color", `🎨 ${lab} undone: paint only ${BLUE()} (or ${ORANGE()} during an approved attack).`);
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

/** Freeze for the n-th junk item a player added: 5 s, 30 s, then 2 min. */
export const JUNK_FREEZE_SECONDS = [5, 30, 120];

/**
 * A player added junk (a meme image anywhere, a shape on the forest, a panel or an Orders frame): it is
 * removed and they are frozen, longer each time (5 s, 30 s, then 2 min).
 */
export function decideJunk(state: GameState, ev: { userId: string; what: string; at: number }): Decision {
  state.junk ??= {};
  const n = (state.junk[ev.userId] = (state.junk[ev.userId] ?? 0) + 1);
  const secs = JUNK_FREEZE_SECONDS[Math.min(n, JUNK_FREEZE_SECONDS.length) - 1]!;
  const player = state.players[ev.userId];
  if (!player) return { accept: false, rule: "tamper", feedback: `🚫 ${ev.what} removed.` };
  let freeze = "";
  if (state.phase === "live") {
    state.timeoutUntil[ev.userId] = Math.max(state.timeoutUntil[ev.userId] ?? 0, ev.at + secs * 1000);
    freeze = ` — frozen ${secs >= 60 ? `${secs / 60} min` : `${secs} s`}`;
  }
  return reject(state, ev.userId, "tamper", `🚫 ${ev.what} removed${freeze}`);
}

// ---------- the human decision: "Spray water in <neighbour>'s area?" stickies in the Orders frames ----------

function stickyLines(text: string): string[] {
  return text.split(/\n/).map((l) => l.trim()).filter(Boolean);
}

const QUESTION = /^start\s+a\s+fire\s+in\s+(.+?)\s*$/i;

/** "QUESTION" = a "Start a fire in <team>'s area?" sticky; "ORDER" = "Ana: paint N9 N10" (communication only). */
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

/** The question as the leaderboard lists it: "start a fire in Team 2's area". */
export const attackText = (to: Team) => `start a fire in ${teamName(to)}'s area`;
/** The question's first line as a boss posts it (without the "?"): "Start a fire in Team 2's area". */
export const questionLine = (to: Team) => `Start a fire in ${teamName(to)}'s area`;

/**
 * Judge one "Start a fire in <neighbour>'s area?" sticky (in the asking team's own Orders frame).
 * Approved = it has a YES line and its last editor is on that team and is not its creator; answers are
 * remembered once seen. On YES (at most attacksPerTeam per game) the team may paint orange on up to
 * attackSquares green squares in that neighbour's area for attackMinutes. Returns inbox lines.
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
  if (!to || !near.includes(to)) return tellCreator(`❓ Ask about a neighbour, like: ${questionLine(near[0]!)}? (or ${teamName(near[1]!)}'s).`);
  if (state.phase === "over") return notes;

  const answers = stickyLines(s.text).slice(1).map((l) => l.toUpperCase().replace(/[.!]+$/, "")).filter((l) => l === "YES" || l === "NO");
  if (!answers.length) return notes;
  const answer = answers.at(-1)!;
  if (s.modifiedBy === s.createdBy) return tellCreator(`✋ "${questionLine(to)}?" needs a YES from a teammate who did not post it.`);
  const editor = state.players[s.modifiedBy];
  if (!editor || editor.team !== team) return tellCreator(`✋ Only a ${teamName(team)} player can answer your question.`);

  if (answer === "NO") {
    if (state.approvals[s.id]?.status !== "refused") {
      state.approvals[s.id] = { team, to, creator: s.createdBy, status: "refused", by: s.modifiedBy, at: state.elapsed };
      notes.push({ userId: s.createdBy, line: `🙅 ${editor.name} said NO: don't ${attackText(to)}.` });
    }
    return notes;
  }
  if ((state.attacksUsed[team] ?? 0) >= rules.attacksPerTeam) return tellCreator(`✋ Your team has used its ${rules.attacksPerTeam} attacks for this game.`);
  state.approvals[s.id] = { team, to, creator: s.createdBy, status: "approved", by: s.modifiedBy, at: state.elapsed };
  state.attacksUsed[team] = (state.attacksUsed[team] ?? 0) + 1;
  state.attacks.push({ sticky: s.id, team, to, until: state.elapsed + rules.attackMinutes * 60_000, left: rules.attackSquares, lit: 0 });
  for (const u of teamOf(team))
    notes.push({ userId: u, line: `✅ ${editor.name} said YES: you may paint ${ORANGE()} on up to ${rules.attackSquares} green squares in ${teamName(to)}'s area (${to}) for ${rules.attackMinutes} min.` });
  for (const u of teamOf(to)) notes.push({ userId: u, line: `🔥 ${teamName(team)} may set fire to your area for ${rules.attackMinutes} min: watch for orange.` });
  return notes;
}

/** Open questions a player may have at once; extras are removed (class) and never listed. */
export const MAX_OPEN_QUESTIONS = 2;

/** The question as a student would post it: "Start a fire in Team 2's area". */
export const questionText = questionLine;

/** The sticky carries a YES or NO line. */
export const questionAnswered = (text: string) => stickyLines(text).slice(1).some((l) => /^(YES|NO)[.!]*$/i.test(l));

/**
 * Questions really waiting for a YES, for the leaderboard ("start a fire in Team 2's area"): the kit relies
 * on this list to decide what to ask a student, so only valid ones: posted by a player of that team in its
 * own Orders, naming a neighbour, not approved, not answered NO, the team still has an attack left, at most
 * MAX_OPEN_QUESTIONS per player (oldest first), each neighbour listed once per team.
 */
export function pendingStickies(state: GameState, stickies: StickyView[], rules?: Pick<RuleSet, "attacksPerTeam">): Record<Team, string[]> {
  const out: Record<Team, string[]> = { ridge: [], pine: [], cedar: [], birch: [] };
  if (state.phase === "over") return out;
  const perCreator = new Map<string, number>();
  const sorted = [...stickies].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const s of sorted) {
    if (stickyKind(s.text) !== "QUESTION") continue;
    const creator = state.players[s.createdBy];
    const to = questionTarget(s.text);
    if (!creator || creator.team !== s.team || !to || !TEAM_INFO[s.team].neighbours.includes(to)) continue;
    if (rules && (state.attacksUsed?.[s.team] ?? 0) >= rules.attacksPerTeam) continue;
    const a = state.approvals[s.id];
    // A refused question rewritten without its NO line is asking again.
    if (a?.status === "approved" || (a && stickyLines(s.text).slice(1).some((l) => l.toUpperCase() === "NO"))) continue;
    const n = perCreator.get(s.createdBy) ?? 0;
    if (n >= MAX_OPEN_QUESTIONS) continue;
    perCreator.set(s.createdBy, n + 1);
    const text = attackText(to);
    if (!out[s.team].includes(text)) out[s.team].push(text);
  }
  return out;
}
