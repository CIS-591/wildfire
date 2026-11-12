#!/usr/bin/env tsx
// Instructor CLI. Every command that touches Miro needs MIRO_ACCESS_TOKEN + MIRO_BOARD_ID (.env).
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./board.js";
import { GAME_FILE, LIVE_IDS_FILE, ROOT, loadEnv, loadGame, loadLayoutIds, loadRules, loadTeams, saveGame, saveLiveIds } from "./config.js";
import {
  BACKDROP, CELL_FONT, COLORS, FIXTURES, GRID, ORDERS, PANELS, STATE_COLOR, TEAMS, TEAM_INFO, buildCells, cellStroke, center, colName, frameBoxes, frameOfRow, ordersTitle,
  sectorText, startFill, startState, textColorFor, type Box, type CellState,
} from "./layout.js";
import { acquireLock, lockOwner as lockPid, releaseLock } from "./lock.js";
import { MiroRest } from "./miro-rest.js";
import { Referee } from "./referee.js";
import { mulberry32, scores, type RuleSet } from "./rules.js";
import { formatSim, runSimulation } from "./sim.js";
import { supervise } from "./supervise.js";

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

function miro(): MiroRest {
  loadEnv();
  const token = process.env.MIRO_ACCESS_TOKEN;
  const boardId = process.env.MIRO_BOARD_ID;
  if (!token || !boardId) {
    console.error("Set MIRO_ACCESS_TOKEN and MIRO_BOARD_ID in .env (see README).");
    process.exit(2);
  }
  return new MiroRest(token, boardId, (s) => console.log(`[miro] ${s}`));
}

async function makeReferee(board: MiroRest) {
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
  const rehearsal = args.includes("--rehearsal");
  if (rehearsal) console.log("REHEARSAL: one Miro account plays every seat (each inbox card is a player). Not for class.");
  // The token's own user id: the referee's own writes echoed back are never judged as a player's move.
  const selfId = rehearsal ? undefined : await board.tokenContext().then((c) => c.userId).catch(() => undefined);
  const ref = new Referee(board, game, rules, { staticIds: new Set(layout?.static), presets, frameIds: frames, ordersIds: layout?.orders, rng: seed ? mulberry32(Number(seed)) : undefined, rehearsal, selfId });
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
/** `stop` from a second terminal drops this file; the running referee ends the game on its next tick. */
const STOP_FLAG = path.join(ROOT, "state/stop");
/** `start` from a second terminal drops this file; a referee in `serve` mode starts the fire on its next poll. */
const START_FLAG = path.join(ROOT, "state/start");

function lockOwner(): number | null {
  return lockPid(LOCK);
}

function takeLock() {
  const got = acquireLock(LOCK);
  if (!got.ok) {
    console.error(`another referee is running (pid ${got.owner}). Only one may run: Ctrl-C it first.`);
    process.exit(1);
  }
  process.on("exit", () => releaseLock(LOCK));
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
    "Your area = the thick border in your team's color.",
    "Paint only <b>blue</b>, only in your area, on green or orange.",
    `Up to ${r.paintBatch} squares at a time, then wait ${r.cooldownSeconds} s.`,
    "<b>Orange</b> only after a teammate's <b>YES</b>: 1 square next door.",
    `Each team has ${r.attacksPerTeam} attacks and one water bucket.`,
    "Write only in your own team's Orders.",
    "Don't move, edit or delete anything else.",
    "No images, shapes or text on the board.",
  ].map((l, i) => `<b>${i + 1}.</b> ${l}`),
  "<b>Break a rule:</b> it is undone and you are frozen.",
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
    { content: "<b>TEAMS &amp; ROLES</b>", x: PANELS.inbox.x + 40, y: PANELS.inbox.y + 50, w: 1600, fontSize: 36, color: COLORS.heading },
    { content: rulesHtml(loadRules(rulesFile())).map((l) => `<p>${l}</p>`).join(""), x: PANELS.rules.x + 24, y: PANELS.rules.y + 250, w: PANELS.rules.w - 48, fontSize: 17, color: COLORS.text },
    ...Array.from({ length: GRID.cols }, (_, c) => ({ content: `<b>${colName(c)}</b>`, x: c * GRID.pitch, y: -36, w: GRID.cell, fontSize: 24, color: TEAM_INFO[c < 18 ? "ridge" : "pine"].color, align: "center" as const })),
    ...Array.from({ length: GRID.rows }, (_, r) => ({ content: `<b>${r + 1}</b>`, x: -84, y: r * GRID.pitch + 30, w: 70, fontSize: 24, color: TEAM_INFO[r < 17 ? "ridge" : "cedar"].color, align: "right" as const })),
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
      const r = await ref.reset();
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
      takeLock();
      if (existsSync(STOP_FLAG)) unlinkSync(STOP_FLAG);
      const { ref, game } = await makeReferee(miro());
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
    case "supervise": {
      // `run` under a watchdog (src/supervise.ts): restarted when it crashes or hangs, until the game is over,
      // `stop` is used, or Ctrl-C (pauses, like `run`). Bad flags fail here, not in a restart loop.
      intOpt("teams", 1, 4);
      intOpt("team-size", 1);
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
  npm run referee stop       end now: highest % wins
  npm run referee results    print the result
  options: --poll 3 (seconds between board reads), --seed N (repeatable fire), --minutes N (shorter game),
           --teams N (1-4 teams play, Team 1 first), --team-size N (players per team: uses only the teams that needs),
           --no-draw (place players as they join instead of a random draw at the start),
           --rehearsal (test with ONE Miro account: every inbox card is its own player; never in class)
state: ${GAME_FILE}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
