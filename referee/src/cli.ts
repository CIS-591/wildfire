#!/usr/bin/env tsx
// Instructor CLI. Every command that touches Miro needs MIRO_ACCESS_TOKEN + MIRO_BOARD_ID (.env).
import { existsSync, mkdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./board.js";
import { GAME_FILE, LIVE_IDS_FILE, ROOT, loadEnv, loadGame, loadLayoutIds, loadRules, loadTeams, saveGame, saveLiveIds } from "./config.js";
import {
  BACKDROP, CELL_FONT, COLORS, FIXTURES, GRID, ORDERS, PANELS, STATE_COLOR, TEAMS, TEAM_INFO, buildCells, cellStroke, center, colName, colX, frameBoxes, frameOfRow, ordersTitle,
  rowY, sectorText, startFill, startState, textColorFor, type Box, type CellState,
} from "./layout.js";
import { acquireLock, lockOwner as lockPid, releaseLock } from "./lock.js";
import { MiroRest } from "./miro-rest.js";
import { gameFileLink, guardFileLink } from "./guard-link.js";
import { Referee, type RefereeRole } from "./referee.js";
import { mulberry32, scores, type RuleSet } from "./rules.js";
import { formatSim, runSimulation } from "./sim.js";
import { supervise } from "./supervise.js";
import { AGENT_PROFILE, BotRunner, CLASS_PROFILE, type Profile } from "./bots.js";
import { formatDryRun, runBotsDryRun } from "./bots-dry.js";
import { MiroBotIO } from "./bots-miro.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const opt = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : def; // `--teams --no-draw`: --teams has no value
};

/** An integer flag (--teams 3): absent = undefined; present but not an integer in [min, max] = exit with a message. */
const intOpt = (name: string, min: number, max = Infinity): number | undefined => {
  if (!args.includes(`--${name}`)) return undefined;
  const raw = opt(name);
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name} needs a whole number ${max === Infinity ? `of at least ${min}` : `from ${min} to ${max}`} (got ${raw === undefined ? "nothing" : JSON.stringify(raw)}), like --${name} ${min === 1 && max === 4 ? 3 : 4}`);
    process.exit(1);
  }
  return n;
};

/** `--role guard` uses the second token (MIRO_ACCESS_TOKEN_2, another Miro user: its own rate-limit budget). */
function miro(guard = false): MiroRest {
  loadEnv();
  const name = guard ? "MIRO_ACCESS_TOKEN_2" : "MIRO_ACCESS_TOKEN";
  const token = process.env[name];
  const boardId = process.env.MIRO_BOARD_ID;
  if (!token || !boardId) {
    console.error(`Set ${name} and MIRO_BOARD_ID in .env (see README / RUNBOOK).`);
    process.exit(2);
  }
  return new MiroRest(token, boardId, (s) => console.log(`[miro${guard ? " guard" : ""}] ${s}`));
}

/** Both tokens' Miro user ids (a split referee never judges or undoes either one's writes). */
async function tokenUsers(guard: boolean): Promise<{ self?: string; other?: string }> {
  loadEnv();
  const boardId = process.env.MIRO_BOARD_ID ?? "";
  const ctx = async (token: string | undefined) => {
    if (!token) return undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return (await new MiroRest(token, boardId).tokenContext()).userId;
      } catch (e) {
        if (attempt === 3) console.warn(`could not read a token's Miro user (${(e as Error).message.split("\n")[0]}); its writes may be judged`);
        else await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    return undefined;
  };
  const [a, b] = await Promise.all([ctx(process.env.MIRO_ACCESS_TOKEN), ctx(process.env.MIRO_ACCESS_TOKEN_2)]);
  return guard ? { self: b, other: a } : { self: a, other: b };
}

const TOKEN_ENV = (n: number) => (n === 1 ? "MIRO_ACCESS_TOKEN" : `MIRO_ACCESS_TOKEN_${n}`);

/**
 * Bot rehearsal (`--bots-token N`): who is "self" for this referee. Every referee token's user is, except
 * the bots' token user (its writes are the players' moves, attributed card by card). Bots on token 2 with a
 * guard: the guard has no self of its own (it tells its own put-backs apart by what it last wrote, like a
 * plain rehearsal) and the game referee's user is still its "other" self. Bots on token 1 need ONE referee
 * (MIRO_ACCESS_TOKEN_2 blank): a guard could not tell the game's new items from the bots'.
 */
async function botRehearsalUsers(role: RefereeRole, botsToken: number): Promise<{ self?: string; other?: string }> {
  loadEnv();
  if (!process.env[TOKEN_ENV(botsToken)]) {
    console.error(`--bots-token ${botsToken}: ${TOKEN_ENV(botsToken)} is not set in .env`);
    process.exit(2);
  }
  if (botsToken === 1 && role !== "solo") {
    console.error("--bots-token 1 (bots on the game referee's token) works with ONE referee only: blank MIRO_ACCESS_TOKEN_2 in .env, or put the bots on token 2/3.");
    process.exit(2);
  }
  const all = await tokenUsersOf([1, 2, 3]);
  const bot = all[botsToken];
  if (!bot) {
    console.error(`--bots-token ${botsToken}: could not read that token's Miro user; without it the bots' writes may be ignored. Try again.`);
    process.exit(1);
  }
  const keep = (u?: string) => (u && u !== bot ? u : undefined);
  if (role === "guard") return { self: keep(all[2]), other: keep(all[1]) };
  return { self: keep(all[1]), other: role === "game" ? keep(all[2]) : undefined };
}

/** Miro user id of each token that is set (token number -> user id). */
async function tokenUsersOf(nums: number[]): Promise<Record<number, string | undefined>> {
  const boardId = process.env.MIRO_BOARD_ID ?? "";
  const out: Record<number, string | undefined> = {};
  await Promise.all(
    nums.map(async (n) => {
      const token = process.env[TOKEN_ENV(n)];
      if (!token) return;
      for (let attempt = 1; attempt <= 3 && !out[n]; attempt++) {
        try {
          out[n] = (await new MiroRest(token, boardId).tokenContext()).userId;
        } catch {
          if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
    }),
  );
  return out;
}

const STATE_DIR = path.join(ROOT, "state");
/** serve only: with MIRO_ACCESS_TOKEN_2 set the game referee leaves the board guard to the second token. */
function serveRole(): RefereeRole {
  const r = opt("role", "game");
  if (r !== "game" && r !== "guard") {
    console.error(`--role is game (default) or guard (got ${JSON.stringify(r)})`);
    process.exit(1);
  }
  loadEnv();
  if (r === "guard") return "guard";
  return process.env.MIRO_ACCESS_TOKEN_2 ? "game" : "solo";
}

async function makeReferee(board: MiroRest, role: RefereeRole = "solo") {
  const game = loadGame();
  const layout = loadLayoutIds();
  const boxes = frameBoxes();
  let frames = layout?.frames;
  if (!frames) {
    // An MCP-built board: find the 9 grid frames by their boxes (fast per-frame reads).
    await board.listItems();
    const found = boxes.map((b) => [...board.seenFrames].find(([, f]) => Math.abs(f.x - b.x) < 8 && Math.abs(f.y - b.y) < 8 && Math.abs(f.w - b.w) < 16)?.[0]);
    if (found.every(Boolean)) frames = found as string[];
  }
  (frames ?? []).forEach((id, i) => board.frames.set(id, boxes[i]!));
  if (!layout) console.warn("no config/layout.json or ../board/board.json: panels are found by position only.");
  for (const [k, id] of Object.entries(layout?.fixtures ?? {})) if (k in FIXTURES) game.fixtureIds[k as keyof typeof game.fixtureIds] ??= id; // keys the layout no longer has are dropped
  const presets = loadTeams();
  if (Object.keys(presets).length) console.log(`preset teams: ${Object.entries(presets).map(([n, t]) => `${n}=${t}`).join(", ")}`);
  const seed = opt("seed");
  const rules = loadRules(rulesFile());
  const minutes = opt("minutes");
  if (minutes) {
    rules.gameMinutes = Number(minutes);
    rules.lightningAt = rules.lightningAt.filter((m) => m < rules.gameMinutes);
  }
  // Team setup (the draw happens when `run` starts the game): --teams 3 --team-size 4, --no-draw = placed as they join.
  const teams = intOpt("teams", 1, 4);
  const teamSize = intOpt("team-size", 1);
  if (teams !== undefined) rules.teams = teams;
  if (teamSize !== undefined) rules.teamSize = teamSize;
  if (args.includes("--no-draw")) rules.drawTeams = false;
  if (args.includes("--draw")) rules.drawTeams = true;
  console.log(`teams: up to ${rules.teams ?? 4}${rules.teamSize ? `, ${rules.teamSize} players each` : ", even split"}, ${rules.drawTeams ? "drawn at random when the game starts" : "placed as they join"}`);
  // --bots-token N: scripted bots (`npm run referee bots`) write with token N; implies --rehearsal.
  const botsToken = intOpt("bots-token", 1, 3);
  const rehearsal = args.includes("--rehearsal") || botsToken !== undefined;
  if (rehearsal) console.log(`REHEARSAL: one Miro account plays every seat (each inbox card is a player)${botsToken ? `: the bots on MIRO_ACCESS_TOKEN${botsToken === 1 ? "" : `_${botsToken}`}` : ""}. Not for class.`);
  // The token's own user id: the referee's own writes echoed back are never judged as a player's move. With a
  // second token (MIRO_ACCESS_TOKEN_2), both users are the referee's. Plain rehearsal: none (the referee's own
  // account plays too). Bot rehearsal: both referee users except the bots' token user.
  const users = !rehearsal ? await tokenUsers(role === "guard") : botsToken ? await botRehearsalUsers(role, botsToken) : {};
  const selfId = users.self;
  const link = role === "game" ? gameFileLink(STATE_DIR, game) : role === "guard" ? guardFileLink(STATE_DIR, () => loadGame(GAME_FILE, () => {})) : undefined;
  if (role !== "solo") console.log(`two referees: this one is the ${role.toUpperCase()} (${role === "game" ? "squares, fire, fixtures, cards" : "junk, statics, foreign stickies, joins"})`);
  const ref = new Referee(board, game, rules, {
    staticIds: new Set(layout?.static), presets, frameIds: frames, ordersIds: layout?.orders, rng: seed ? mulberry32(Number(seed)) : undefined, rehearsal, selfId,
    selfIds: users.other ? [users.other] : [], role, link,
    fixtureReadEvery: role === "guard" ? 1 : 3, // fixture writes don't wait for these reads
  });
  return { ref, game };
}

/** Discover the board, retrying while Miro is down or rate limiting (a restart mid-game must come back). */
async function discoverWithRetry(ref: Referee) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ref.discover();
    } catch (e) {
      if (attempt >= 8) throw e;
      console.error(`reading the board failed (${(e as Error).message.split("\n")[0]}); retrying in ${attempt * 3}s`);
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
}

// One referee at a time: two of them double the Miro reads and fight over game.json (REFLECTION §3).
const LOCK = path.join(ROOT, "state/referee.lock");
/** The guard referee (second token) has its own lock; it never writes game.json. */
const GUARD_LOCK = path.join(ROOT, "state/guard.lock");
/** Touched by the guard every tick: supervise's hang watchdog for it. */
const GUARD_HEARTBEAT = path.join(ROOT, "state/guard.heartbeat");
/** `stop` from a second terminal drops this file; the running referee ends the game on its next tick. */
const STOP_FLAG = path.join(ROOT, "state/stop");
/** `start` from a second terminal drops this file; a referee in `serve` mode starts the fire on its next poll. */
const START_FLAG = path.join(ROOT, "state/start");

function lockOwner(): number | null {
  return lockPid(LOCK);
}

function takeLock(file = LOCK) {
  const got = acquireLock(file);
  if (!got.ok) {
    console.error(`another ${file === GUARD_LOCK ? "guard" : "referee"} is running (pid ${got.owner}). Only one may run: Ctrl-C it first.`);
    process.exit(1);
  }
  process.on("exit", () => releaseLock(file));
}

/** `serve --role guard`: the second token's referee, in every phase, until Ctrl-C. Never writes game.json. */
async function serveGuard(pollMs: number) {
  takeLock(GUARD_LOCK);
  const { ref } = await makeReferee(miro(true), "guard");
  for (let attempt = 1; ; attempt++) {
    try {
      await ref.discoverGuard();
      break;
    } catch (e) {
      if (attempt >= 8) throw e;
      console.error(`reading the board failed (${(e as Error).message.split("\n")[0]}); retrying in ${attempt * 3}s`);
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
  console.log("GUARD on: junk, board panels, frames, foreign stickies, new inbox cards. Ctrl-C to quit.");
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  while (!stopping) {
    const t0 = Date.now();
    try {
      const r = await ref.tick();
      process.stdout.write(`\r[guard] ${ref.state.phase.toUpperCase()} · tampers ${r.tampers} joins ${r.joins} · writes ${r.writes} reads ${r.reads ?? 0} · tick ${((Date.now() - t0) / 1000).toFixed(1)}s   `);
    } catch (e) {
      console.error(`\nguard tick failed: ${(e as Error).message}`);
    }
    try {
      mkdirSync(path.dirname(GUARD_HEARTBEAT), { recursive: true });
      if (existsSync(GUARD_HEARTBEAT)) utimesSync(GUARD_HEARTBEAT, new Date(), new Date());
      else writeFileSync(GUARD_HEARTBEAT, "");
    } catch {
      /* the heartbeat only feeds the watchdog */
    }
    await new Promise((res) => setTimeout(res, Math.max(0, pollMs - (Date.now() - t0))));
  }
}

/** Poll the board until `done()` or Ctrl-C. Ctrl-C pauses: the game is saved and `run` resumes it. */
async function loop(ref: Referee, game: ReturnType<typeof loadGame>, done: () => boolean, pollMs: number) {
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\npausing...");
  });
  while (!stopping && !done()) {
    const t0 = Date.now();
    try {
      if (existsSync(STOP_FLAG)) {
        unlinkSync(STOP_FLAG);
        console.log("\nstop requested: ending the game now");
        await ref.stop();
      }
      const r = await ref.tick();
      const sc = scores(ref.state, ref.cellList);
      const players = Object.keys(ref.state.players).length;
      const mm = `${Math.floor(ref.state.elapsed / 60_000)}:${String(Math.floor((ref.state.elapsed % 60_000) / 1000)).padStart(2, "0")}`;
      process.stdout.write(
        `\r${ref.state.phase.toUpperCase()} ${mm} · ${players} players · ${TEAMS.map((t) => `${t} ${sc[t].pct}%`).join(" ")} · 🔥${r.fire} 💧${TEAMS.map((t) => ref.state.water[t]).join("/")} · paints ${r.paints} tampers ${r.tampers} joins ${r.joins} · writes ${r.writes} reads ${r.reads ?? 0} · tick ${((Date.now() - t0) / 1000).toFixed(1)}s   `,
      );
    } catch (e) {
      console.error(`\ntick failed: ${(e as Error).message}`);
    }
    try {
      saveGame(game);
      if (saveLiveIds(ref.liveIds(), process.env.MIRO_BOARD_ID)) console.log(`\nlive ids changed: ${path.relative(process.cwd(), LIVE_IDS_FILE)} (merge into the kit with python3 board/build/sync_ids.py)`);
    } catch (e) {
      console.error(`\nsaving the game failed: ${(e as Error).message}`);
    }
    await new Promise((res) => setTimeout(res, Math.max(0, pollMs - (Date.now() - t0))));
  }
  return stopping;
}

/** `--rules config/rules.8players.json`: another tuning (fewer players, slower agents); default config/rules.json. */
const rulesFile = () => (opt("rules") ? path.resolve(opt("rules")!) : undefined);

/** The rules panel, from the numbers the referee actually plays with (config/rules.json). */
const rulesHtml = (r: RuleSet) => [
  "<b>RULES</b>",
  ...[
    "Your team's area has a thick border in your team's color.",
    "Your Claude paints <b>blue</b> (water) on fire or trees there.",
    "Fire spreads every 20 s. Blue stops it. Black is burnt.",
    "Most green trees left after 10 minutes wins.",
    "Attack: a teammate says <b>YES</b>, 1 square next door burns.",
    `Each team has ${r.attacksPerTeam} attacks and one water bucket.`,
    "Write only in your own team's Orders.",
    "Don't move, edit or delete anything. No images or text.",
  ].map((l, i) => `<b>${i + 1}.</b> ${l}`),
  "<b>Break a rule:</b> your move is undone.",
];

async function build() {
  // Wipe the board and build it with the SPEC.md geometry (same as the MCP-built board).
  takeLock();
  const board = miro();
  const old = await board.listItems();
  console.log(`deleting ${old.length} items...`);
  await pool(old.map((it) => () => board.deleteItem(it.id).catch(() => {})), 8);
  await board.listItems(); // frames are listed apart (seenFrames)
  for (const id of [...board.seenFrames.keys()]) await board.deleteItem(id).catch(() => {});
  const staticIds: string[] = [];
  const shape = (b: Box, fill: string, content = "", fontSize = 14, extra: Record<string, unknown> = {}) => ({ content, fill, ...center(b), w: b.w, h: b.h, borderColor: fill, borderWidth: 1, fontSize, shape: "round_rectangle" as const, ...extra });
  const dark = COLORS.panel; // palette: config/colors.json
  // Backdrop + panels first (they sit behind everything made later).
  staticIds.push(
    ...(await board.createShapes([
      shape(BACKDROP, COLORS.backdrop),
      shape(PANELS.rules, COLORS.panel),
      shape(PANELS.leaderboard, dark),
      shape(PANELS.inbox, COLORS.panel),
    ])),
  );
  // Team-colored header bars on top of each Orders frame.
  const ordersFrames = await board.createFrames(TEAMS.map((t) => ({ ...ORDERS[t], title: ordersTitle(t) })), COLORS.panel);
  staticIds.push(
    ...(await board.createShapes(
      TEAMS.map((t) => ({ ...shape({ x: ORDERS[t].x + 16, y: ORDERS[t].y + 12, w: ORDERS[t].w - 32, h: 44 }, TEAM_INFO[t].color, `<b>${ordersTitle(t)} · ${sectorText(t)}</b>`, 20), borderColor: COLORS.panelBorder, borderWidth: 2 })),
    )),
  );
  // Legend swatches along the bottom of the rules panel.
  const legend: [CellState, string][] = [["forest", "tree"], ["fire", "FIRE"], ["water", "water"], ["burnt", "burnt"]];
  staticIds.push(
    ...(await board.createShapes(
      legend.map(([st, name], i) => ({ content: `<b>${name}</b>`, fill: STATE_COLOR[st], ...center({ x: PANELS.rules.x + 16 + i * 104, y: PANELS.rules.y + 520, w: 96, h: 64 }), w: 96, h: 64, borderColor: COLORS.ink, borderWidth: 2, fontSize: 13, textColor: textColorFor(st) })),
    )),
  );
  const fx = await board.createShapes([
    { ...shape(FIXTURES.banner, dark, "<p><b>🔥 WILDFIRE · waiting for the referee</b></p>", 28, { textColor: COLORS.text }), shape: "rectangle" as const, borderColor: COLORS.panelBorder, borderWidth: 2 },
    { ...shape(FIXTURES.scoreboard, dark, "<p><b>TEAM 1 100% · TEAM 2 100%</b></p><p><b>TEAM 3 100% · TEAM 4 100%</b></p>", 30, { textColor: COLORS.text }), shape: "rectangle" as const, borderColor: COLORS.panelBorder, borderWidth: 2 },
  ]); // the leaderboard rows, badges and icons are made by the referee on its first reset/lobby
  const texts = [
    { content: "<b>WILDFIRE</b>", x: PANELS.title.x, y: PANELS.title.y + 45, w: PANELS.title.w, fontSize: 72, color: COLORS.heading },
    { content: "<b>LEADERBOARD · live</b>", x: PANELS.leaderboard.x + 24, y: PANELS.leaderboard.y + 40, w: 600, fontSize: 30, color: COLORS.heading },
    { content: "<b>PLAYERS</b>", x: PANELS.inbox.x + 40, y: PANELS.inbox.y + 50, w: 1600, fontSize: 36, color: COLORS.heading },
    { content: rulesHtml(loadRules(rulesFile())).map((l) => `<p>${l}</p>`).join(""), x: PANELS.rules.x + 24, y: PANELS.rules.y + 250, w: PANELS.rules.w - 48, fontSize: 17, color: COLORS.text },
    ...Array.from({ length: GRID.cols }, (_, c) => ({ content: `<b>${colName(c)}</b>`, x: colX(c), y: -36, w: GRID.cell, fontSize: 24, color: TEAM_INFO[c < 18 ? "ridge" : "pine"].color, align: "center" as const })),
    ...Array.from({ length: GRID.rows }, (_, r) => ({ content: `<b>${r + 1}</b>`, x: -84, y: rowY(r) + 30, w: 70, fontSize: 24, color: TEAM_INFO[r < 17 ? "ridge" : "cedar"].color, align: "right" as const })),
  ];
  staticIds.push(...(await board.createTexts(texts)));
  const frames = await board.createFrames(frameBoxes(), COLORS.frame);
  const cells = buildCells();
  const ids = await board.createShapes(
    cells.map((c) => {
      const st = cellStroke(c);
      return { content: c.label, fill: startFill(c), x: c.x + GRID.cell / 2, y: c.y + GRID.cell / 2, w: GRID.cell, h: GRID.cell, borderColor: st.color, borderWidth: st.width, textColor: textColorFor(startState(c)), fontSize: CELL_FONT, parentId: frames[frameOfRow(c.row)] };
    }),
  );
  const layout = {
    boardId: process.env.MIRO_BOARD_ID,
    builtAt: new Date().toISOString().slice(0, 10),
    note: "Ids of the live board items, written by `npm run referee build`. Rebuilding changes every id.",
    frames,
    orders: Object.fromEntries(TEAMS.map((t, i) => [t, ordersFrames[i]])),
    fixtures: { banner: fx[0], scoreboard: fx[1] },
    static: staticIds,
    cells: Object.fromEntries(cells.map((c, i) => [c.label, ids[i]])),
  };
  writeFileSync(path.join(ROOT, "config/layout.json"), JSON.stringify(layout, null, 2) + "\n");
  saveGame({ fixtureIds: layout.fixtures });
  console.log(`built: ${frames.length} grid frames, ${ids.length} squares, 4 Orders frames, ${staticIds.length} static items. Next: npm run referee reset`);
}

/** "12-40" or "12,40" -> [12, 40]; absent = def. */
const rangeOpt = (name: string, def: [number, number]): [number, number] => {
  const raw = opt(name);
  if (raw === undefined) return def;
  const m = /^(\d+(?:\.\d+)?)[-,](\d+(?:\.\d+)?)$/.exec(raw);
  if (!m || Number(m[1]) > Number(m[2])) {
    console.error(`--${name} needs a range like 12-40 (got ${JSON.stringify(raw)})`);
    process.exit(1);
  }
  return [Number(m[1]), Number(m[2])];
};

/**
 * `bots`: N scripted players on the real board (or --dry-run on a FakeBoard with both referees). The
 * referees must run with `--bots-token N` (RUNBOOK "Bot rehearsal"). Stops at GAME OVER or Ctrl-C;
 * removes nothing.
 */
async function bots() {
  const players = intOpt("players", 1, 60) ?? 30;
  const seed = intOpt("seed", 0) ?? 1;
  const base = args.includes("--class") ? CLASS_PROFILE : AGENT_PROFILE;
  const scale = opt("mistakes") !== undefined ? Number(opt("mistakes")) : 1;
  const profile: Profile = {
    ...base,
    joinSpreadSec: intOpt("join-spread", 0) ?? base.joinSpreadSec,
    turnSec: rangeOpt("turn", base.turnSec),
    batch: rangeOpt("batch", base.batch),
    lateShare: opt("late-share") !== undefined ? Number(opt("late-share")) : base.lateShare,
    vandals: intOpt("vandals", 0) ?? base.vandals,
    bossPaint: opt("boss-paint") !== undefined ? Number(opt("boss-paint")) : base.bossPaint,
    attacks: !args.includes("--no-attacks"),
    mistakes: Object.fromEntries(Object.entries(base.mistakes).map(([k, v]) => [k, v * scale])) as Profile["mistakes"],
    overBatch: base.overBatch * scale,
    orangeNoYes: base.orangeNoYes * scale,
  };
  if (args.includes("--dry-run")) {
    const botsToken = (intOpt("token", 2, 3) ?? 2) as 2 | 3;
    const res = await runBotsDryRun(loadRules(rulesFile()), { players, seed, profile, botsToken, readEveryMs: (intOpt("read-every", 1) ?? 5) * 1000, writesPerMin: intOpt("writes-per-min", 10), log: args.includes("--verbose") ? (s) => console.log(s) : undefined });
    console.log(formatDryRun(res));
    const ok = res.over && res.accepted > 0 && res.judged >= 0.95 * res.botChanged && res.guardTouchedGame.length === 0 && res.gameTouchedStatics.length === 0 && res.unconverged.length === 0;
    console.log(ok ? "dry run OK" : "dry run FAILED");
    process.exit(ok ? 0 : 1);
  }
  loadEnv();
  // Which token: --token N, else a third account if set, else the guard's token, else the game's.
  const set = (n: number) => !!process.env[TOKEN_ENV(n)];
  const token = intOpt("token", 1, 3) ?? (set(3) ? 3 : set(2) ? 2 : 1);
  if (!set(token) || !process.env.MIRO_BOARD_ID) {
    console.error(`Set ${TOKEN_ENV(token)} and MIRO_BOARD_ID in .env.`);
    process.exit(2);
  }
  // Shared tokens get a smaller share of the 100k credits/min (RUNBOOK "Bot rehearsal").
  const shared = token !== 3;
  const readEvery = intOpt("read-every", 1) ?? (token === 1 ? 10 : shared ? 6 : 5);
  const writesPerMin = intOpt("writes-per-min", 10) ?? (token === 1 ? 200 : shared ? 300 : 450);
  const rest = new MiroRest(process.env[TOKEN_ENV(token)]!, process.env.MIRO_BOARD_ID, (s) => console.log(`\n[miro bots] ${s}`));
  const who = await rest.tokenContext();
  console.log(`bots: ${players} players (${args.includes("--class") ? "class" : "agent"} profile, seed ${seed}) on ${TOKEN_ENV(token)} (Miro user ${who.userName}) · shared read every ${readEvery}s · writes ≤ ${writesPerMin}/min`);
  console.log(`the referees must run with: npm run referee supervise -- --bots-token ${token}${token === 1 ? "   (MIRO_ACCESS_TOKEN_2 blank: one referee)" : ""}`);
  const io = new MiroBotIO(rest);
  await io.init();
  const runner = new BotRunner(io, { players, seed, profile, readEveryMs: readEvery * 1000, writesPerMin, log: (s) => console.log(`\n${s}`) });
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\nstopping the bots (nothing is removed)");
  });
  let lastStatus = 0;
  while (!stopping && !runner.over) {
    const t0 = Date.now();
    try {
      await runner.step(t0);
    } catch (e) {
      console.error(`\nbot step failed: ${(e as Error).message}`);
    }
    if (t0 - lastStatus >= 5000) {
      process.stdout.write(`\r${runner.status(Date.now())}   `);
      lastStatus = t0;
    }
    await new Promise((r) => setTimeout(r, Math.max(100, 500 - (Date.now() - t0))));
  }
  console.log(`\n${runner.status(Date.now())}`);
  if (runner.over) console.log("GAME OVER on the banner: the bots stop. Their cards and stickies stay (the next `reset` clears them).");
}

async function main() {
  const pollMs = Number(opt("poll", "3")) * 1000;
  switch (cmd) {
    case "sim": {
      const seeds = opt("seeds") ? Array.from({ length: Number(opt("seeds")) }, (_, i) => i + 1) : [Number(opt("seed", "1"))];
      for (const seed of seeds) {
        const res = await runSimulation(loadRules(rulesFile()), { players: Number(opt("players", "28")), seed, slow: process.argv.includes("--slow"), mistakeRate: opt("mistakes") ? Number(opt("mistakes")) : undefined, lateSec: opt("late") ? Number(opt("late")) : undefined });
        console.log(formatSim(res, seeds.length === 1));
      }
      return;
    }
    case "verify": {
      const board = miro();
      const ctx = await board.tokenContext();
      console.log(`token OK: user ${ctx.userName} (${ctx.userId}), team ${ctx.teamId}, scopes ${ctx.scopes.join(" ")}`);
      const { ref, game } = await makeReferee(board);
      const d = await ref.discover();
      saveGame(game);
      console.log(`squares found: ${d.cells}/${ref.cells.size}; fixtures: ${d.fixtures.join(", ") || "none"}${d.missing.length ? `; MISSING: ${d.missing.join(" ")}` : ""}`);
      console.log(`grid frames: ${board.frames.size}/9 (fast reads ${board.frames.size === 9 ? "on" : "off"}); stickies in Orders: ${ref.stickies.length}`);
      const id = ref.cellId.get("A1")!;
      for (const [name, fill] of Object.entries(STATE_COLOR)) {
        await board.updateShape(id, { fill });
        const back = (await board.listItems()).find((i) => i.id === id)?.fill;
        const ok = back?.toLowerCase() === fill;
        console.log(`  ${name.padEnd(9)} ${fill} -> read back ${back} ${ok ? "OK" : "MISMATCH"}`);
      }
      await board.updateShape(id, { fill: STATE_COLOR.forest });
      return;
    }
    case "build":
      return build();
    case "reset": {
      takeLock();
      const { ref, game } = await makeReferee(miro());
      const r = await ref.reset(process.argv.includes("--keep-players"));
      saveGame(game);
      saveLiveIds(ref.liveIds(), process.env.MIRO_BOARD_ID);
      console.log(`live ids: ${LIVE_IDS_FILE} (python3 ../board/build/sync_ids.py copies them to the kit)`);
      console.log(`new game: ${r.repainted} squares repainted, ${r.deleted} items deleted (inbox cards, stickies, junk)`);
      return;
    }
    case "lobby": {
      // Before the fire: students /join (an inbox card each), teams + roles assigned, paints undone.
      takeLock();
      const { ref, game } = await makeReferee(miro());
      await discoverWithRetry(ref);
      await ref.rebuildMissing();
      if (ref.state.phase !== "lobby") {
        console.error(`the game is ${ref.state.phase}; run \`reset\` for a new game, or \`run\` to resume it.`);
        process.exit(1);
      }
      console.log("LOBBY open: students /join now. Ctrl-C when everyone is in, then `npm run referee run`.");
      await loop(ref, game, () => false, pollMs);
      await ref.pause();
      saveGame(game);
      return;
    }
    case "run": {
      // The fire. Starts it from the lobby, or resumes a paused game. Ends at gameMinutes (10) or when the fire is out.
      takeLock();
      if (existsSync(STOP_FLAG)) unlinkSync(STOP_FLAG); // an old request must not end this game
      const { ref, game } = await makeReferee(miro());
      await discoverWithRetry(ref);
      await ref.rebuildMissing();
      if (ref.state.phase === "over") {
        console.log(ref.resultsText());
        console.log("\nthe game is over; `reset` starts a new one.");
        return;
      }
      await ref.start();
      console.log(`🔥 LIVE for ${ref.rules.gameMinutes} min. Ctrl-C pauses (resume with \`run\`); \`stop\` ends it now.`);
      const paused = await loop(ref, game, () => ref.state.phase === "over", pollMs);
      if (paused) await ref.pause();
      saveGame(game);
      console.log("\n" + ref.resultsText());
      if (paused) return;
      console.log("\nGAME OVER. Still guarding the board (late paints are undone). Ctrl-C to quit.");
      await loop(ref, game, () => false, pollMs);
      saveGame(game);
      return;
    }
    case "serve": {
      // Always-on referee (what `supervise` runs): the lobby (joins get their team at once, junk removed) until
      // the instructor runs `npm run referee start`, then the fire, then it keeps guarding the board.
      // With MIRO_ACCESS_TOKEN_2: `--role guard` is the second referee (junk, statics); this one is the game.
      const role = serveRole();
      if (role === "guard") return serveGuard(pollMs);
      takeLock();
      if (existsSync(STOP_FLAG)) unlinkSync(STOP_FLAG);
      const { ref, game } = await makeReferee(miro(), role);
      await discoverWithRetry(ref);
      await ref.rebuildMissing();
      if (ref.state.phase === "lobby") {
        console.log("LOBBY open: students /join now (each gets a team at once). `npm run referee start` starts the fire.");
        const paused = await loop(ref, game, () => existsSync(START_FLAG), pollMs);
        if (paused) {
          await ref.pause();
          saveGame(game);
          return;
        }
        unlinkSync(START_FLAG);
        console.log("\nstart requested");
      }
      if (ref.state.phase !== "over") {
        await ref.start();
        console.log(`🔥 LIVE for ${ref.rules.gameMinutes} min. \`npm run referee stop\` ends it now.`);
        const paused = await loop(ref, game, () => ref.state.phase === "over", pollMs);
        if (paused) {
          await ref.pause();
          saveGame(game);
          return;
        }
        saveGame(game);
        console.log("\n" + ref.resultsText());
      }
      console.log("\nGAME OVER. Still guarding the board (late paints and junk are undone). Ctrl-C to quit.");
      await loop(ref, game, () => false, pollMs);
      saveGame(game);
      return;
    }
    case "start": {
      const running = lockOwner();
      if (!running) {
        console.error("no referee is running: start it with `npm run referee supervise` first.");
        process.exit(1);
      }
      mkdirSync(path.dirname(START_FLAG), { recursive: true });
      writeFileSync(START_FLAG, String(Date.now()));
      console.log(`asked the running referee (pid ${running}) to start the fire; it does so on its next poll.`);
      return;
    }
    case "bots":
      return bots();
    case "supervise": {
      // `run` under a watchdog (src/supervise.ts): restarted when it crashes or hangs, until the game is over,
      // `stop` is used, or Ctrl-C (pauses, like `run`). Bad flags fail here, not in a restart loop.
      intOpt("teams", 1, 4);
      intOpt("team-size", 1);
      intOpt("bots-token", 1, 3);
      return supervise(args.slice(1));
    }
    case "stop": {
      const running = lockOwner();
      if (running) {
        mkdirSync(path.dirname(STOP_FLAG), { recursive: true });
        writeFileSync(STOP_FLAG, String(Date.now()));
        console.log(`asked the running referee (pid ${running}) to end the game; it does so on its next poll.`);
        return;
      }
      takeLock();
      const { ref, game } = await makeReferee(miro());
      await discoverWithRetry(ref);
      await ref.stop();
      saveGame(game);
      console.log(ref.resultsText());
      return;
    }
    case "results": {
      const game = loadGame();
      const noop = { listItems: async () => [], updateShape: async () => {}, deleteItem: async () => {}, createShapes: async () => [], members: async () => ({}) };
      console.log(new Referee(noop, game, loadRules(rulesFile())).resultsText());
      return;
    }
    default:
      console.log(`wildfire referee
  npm run sim [-- --players 28 --seed 1 | --seeds 5 --slow --late 75]   offline game with bots (tuning; --slow = half the rehearsal-3 pace; --late = agents start N s after the fire)
  any command: --rules config/rules.8players.json             another tuning (8 players; rules.slow.json for slow agents)
  npm run referee build      WIPE the board and build it (SPEC.md geometry): grid, panels, Orders frames
  npm run referee verify     token + board + color check
  npm run referee reset      new game: starting colors, empty Inbox and Orders
  npm run referee lobby      students join (Ctrl-C when everyone is in)
  npm run referee run        start the fire and referee the 10-minute game (Ctrl-C pauses; run again resumes)
  npm run referee supervise  same flags as run; runs it and restarts it if it crashes or hangs (Ctrl-C pauses; log: results/supervise.log)
  npm run referee supervise  ALWAYS-ON referee under a watchdog: lobby (teams at /join), then the game, then guarding
  npm run referee start      start the fire (tells the running supervised referee)
  npm run referee serve -- --role guard   the second referee (MIRO_ACCESS_TOKEN_2): junk, panels, joins; supervise starts it by itself
  npm run referee stop       end now: highest % wins
  npm run referee results    print the result
  options: --poll 3 (seconds between board reads), --seed N (repeatable fire), --minutes N (shorter game),
           --teams N (1-4 teams play, Team 1 first), --team-size N (players per team: uses only the teams that needs),
           --no-draw (place players as they join instead of a random draw at the start),
           --rehearsal (test with ONE Miro account: every inbox card is its own player; never in class)
           --bots-token N (bot rehearsal: scripted bots write with token N; see \`bots\`)
  npm run referee bots -- --players 30 [--seed N] [--class] [--dry-run]   scripted players on the board (RUNBOOK "Bot rehearsal")
           --token 1|2|3 (default: 3 if set, else 2, else 1) --read-every S --writes-per-min N
           --class: like today's class (staggered joins/starts, mistakes, vandals); tune with --join-spread S
           --turn 12-40 --batch 1-5 --late-share 0.3 --vandals N --boss-paint 0.2 --mistakes 1 (scale) --no-attacks
state: ${GAME_FILE}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
