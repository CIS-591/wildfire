#!/usr/bin/env tsx
// Instructor CLI. Every command that touches Miro needs MIRO_ACCESS_TOKEN + MIRO_BOARD_ID (.env).
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./board.js";
import { GAME_FILE, ROOT, loadEnv, loadGame, loadLayoutIds, loadRules, loadTeams, saveGame } from "./config.js";
import {
  BACKDROP, CELL_FONT, COLORS, FIXTURES, GRID, ORDERS, PANELS, STATE_COLOR, TEAMS, TEAM_INFO, buildCells, cellStroke, center, colName, frameBoxes, frameOfRow, ordersTitle,
  sectorText, startFill, textColorFor, type Box, type CellState,
} from "./layout.js";
import { MiroRest } from "./miro-rest.js";
import { Referee } from "./referee.js";
import { mulberry32, scores, type RuleSet } from "./rules.js";
import { formatSim, runSimulation } from "./sim.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const opt = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
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
  for (const [k, id] of Object.entries(layout?.fixtures ?? {})) game.fixtureIds[k as keyof typeof game.fixtureIds] ??= id;
  const presets = loadTeams();
  if (Object.keys(presets).length) console.log(`preset teams: ${Object.entries(presets).map(([n, t]) => `${n}=${t}`).join(", ")}`);
  const seed = opt("seed");
  const ref = new Referee(board, game, loadRules(), { staticIds: new Set(layout?.static), presets, frameIds: frames, rng: seed ? mulberry32(Number(seed)) : undefined });
  return { ref, game };
}

// One referee at a time: two of them double the Miro reads and fight over game.json (REFLECTION §3).
const LOCK = path.join(ROOT, "state/referee.lock");
/** `stop` from a second terminal drops this file; the running referee ends the game on its next tick. */
const STOP_FLAG = path.join(ROOT, "state/stop");

function lockOwner(): number | null {
  try {
    const pid = Number(readFileSync(LOCK, "utf8"));
    if (!pid || pid === process.pid) return null;
    process.kill(pid, 0); // throws when that process is gone
    return pid;
  } catch {
    return null;
  }
}

function takeLock() {
  const pid = lockOwner();
  if (pid) {
    console.error(`another referee is running (pid ${pid}). Only one may run: Ctrl-C it first.`);
    process.exit(1);
  }
  mkdirSync(path.dirname(LOCK), { recursive: true });
  writeFileSync(LOCK, String(process.pid));
  process.on("exit", () => {
    try {
      if (readFileSync(LOCK, "utf8") === String(process.pid)) unlinkSync(LOCK);
    } catch {
      /* already gone */
    }
  });
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
        `\r${ref.state.phase.toUpperCase()} ${mm} · ${players} players · ${TEAMS.map((t) => `${t} ${sc[t].pct}%`).join(" ")} · 🔥${r.fire} 💧${ref.state.water} · paints ${r.paints} tampers ${r.tampers} joins ${r.joins} · tick ${((Date.now() - t0) / 1000).toFixed(1)}s   `,
      );
    } catch (e) {
      console.error(`\ntick failed: ${(e as Error).message}`);
    }
    saveGame(game);
    await new Promise((res) => setTimeout(res, Math.max(0, pollMs - (Date.now() - t0))));
  }
  return stopping;
}

/** The rules panel, from the numbers the referee actually plays with (config/rules.json). */
const rulesHtml = (r: RuleSet) => [
  "<b>🔥 HOW WILDFIRE WORKS</b>",
  `Every ${r.spreadSeconds} s the fire spreads to neighbouring forest, faster downwind (the WIND arrow on the banner). Embers jump 2 squares downwind. A square burns ${r.burnTicks} spreads, then it's ash.`,
  "<b>Your team protects its sector</b> (colored borders). Score = forest + water squares + 10 per standing cabin, as % of the start.",
  `<b>Paint only in your sector, one paint per ${r.cooldownSeconds} s:</b> 💧 water on fire/forest/cabin (dries in ${r.wetSeconds} s, ONE shared pool of ${r.waterTotal}) · 🪓 firebreak on forest (never burns) · ⬛ burnt on forest in your approved BACKBURN.`,
  `<b>Humans approve</b> with a YES line on the sticky (in ORDERS): PLAN before anyone paints · BACKBURN ≤ ${r.backburnMax} squares · HELP lets ${r.helpPlayers} helpers paint in your sector for ${r.helpMinutes} min. Whoever posted it can't approve it.`,
  `⚡ Lightning at minutes ${r.lightningAt.join(", ")}. The wind turns every ${r.windMinutes} min. The game ends at ${r.gameMinutes} min or when the fire is out. Anything else you touch is undone.`,
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
  const dark = "#2b2f3a";
  // Backdrop + panels first (they sit behind everything made later).
  staticIds.push(
    ...(await board.createShapes([
      shape(BACKDROP, COLORS.backdrop),
      shape(PANELS.rules, "#fff6e0"),
      shape(PANELS.leaderboard, dark),
      shape(PANELS.inbox, "#eef1f6"),
      { ...shape(PANELS.compass, dark, "", 14), shape: "circle" as const },
    ])),
  );
  // Team-colored header bars on top of each Orders frame.
  const ordersFrames = await board.createFrames(TEAMS.map((t) => ({ ...ORDERS[t], title: ordersTitle(t) })), "#f7f3ea");
  staticIds.push(
    ...(await board.createShapes(
      TEAMS.map((t) => ({ ...shape({ x: ORDERS[t].x + 16, y: ORDERS[t].y + 12, w: ORDERS[t].w - 32, h: 44 }, TEAM_INFO[t].color, `<b>${ordersTitle(t)} · ${sectorText(t)}</b>`, 20), borderColor: COLORS.ink, borderWidth: 2 })),
    )),
  );
  // Legend swatches along the bottom of the rules panel.
  const legend: [CellState, string][] = [["forest", "forest"], ["cabin", "cabin ×10"], ["river", "river"], ["fire", "FIRE"], ["water", "water"], ["firebreak", "firebreak"], ["burnt", "burnt"]];
  staticIds.push(
    ...(await board.createShapes(
      legend.map(([st, name], i) => ({ content: `<b>${name}</b>`, fill: STATE_COLOR[st], ...center({ x: PANELS.rules.x + 16 + i * 104, y: PANELS.rules.y + 520, w: 96, h: 64 }), w: 96, h: 64, borderColor: COLORS.ink, borderWidth: 2, fontSize: 13, textColor: textColorFor(st) })),
    )),
  );
  const fx = await board.createShapes([
    { ...shape(FIXTURES.banner, dark, "<p><b>🔥 WILDFIRE · waiting for the referee</b></p>", 28, { textColor: "#ffffff" }), shape: "rectangle" as const, borderColor: COLORS.ink, borderWidth: 2 },
    { ...shape(FIXTURES.scoreboard, "#fff6e0", "<p><b>RIDGE 100% · PINE VALLEY 100%</b></p><p><b>CEDAR CREEK 100% · BIRCH HOLLOW 100%</b></p>", 30), shape: "rectangle" as const, borderColor: COLORS.ink, borderWidth: 2 },
    { ...shape(FIXTURES.leaderboard, "#ffffff", "<p><b>🏆 LEADERBOARD</b></p>", 16, { textAlign: "left", textAlignVertical: "top" }), shape: "rectangle" as const },
  ]);
  const white = "#ffffff";
  const texts = [
    { content: "<b>🔥 WILDFIRE</b>", x: PANELS.title.x, y: PANELS.title.y + 45, w: PANELS.title.w, fontSize: 72, color: "#ff6a00" },
    { content: "<b>LEADERBOARD · live</b>", x: PANELS.leaderboard.x + 24, y: PANELS.leaderboard.y + 40, w: 600, fontSize: 30, color: white },
    { content: "<b>INBOX · one card per player · read only your own</b>", x: PANELS.inbox.x + 40, y: PANELS.inbox.y + 50, w: 1600, fontSize: 36 },
    { content: rulesHtml(loadRules()).map((l) => `<p>${l}</p>`).join(""), x: PANELS.rules.x + 24, y: PANELS.rules.y + 250, w: PANELS.rules.w - 48, fontSize: 17 },
    { content: "<b>N</b>", x: PANELS.compass.x + 80, y: PANELS.compass.y + 22, w: 40, fontSize: 26, color: white, align: "center" as const },
    { content: "<b>S</b>", x: PANELS.compass.x + 80, y: PANELS.compass.y + 178, w: 40, fontSize: 26, color: white, align: "center" as const },
    { content: "<b>W</b>", x: PANELS.compass.x + 4, y: PANELS.compass.y + 100, w: 40, fontSize: 26, color: white, align: "center" as const },
    { content: "<b>E</b>", x: PANELS.compass.x + 156, y: PANELS.compass.y + 100, w: 40, fontSize: 26, color: white, align: "center" as const },
    { content: "🧭", x: PANELS.compass.x + 60, y: PANELS.compass.y + 100, w: 80, fontSize: 40, align: "center" as const },
    ...Array.from({ length: GRID.cols }, (_, c) => ({ content: `<b>${colName(c)}</b>`, x: c * GRID.pitch, y: -36, w: GRID.cell, fontSize: 24, color: TEAM_INFO[c < 18 ? "ridge" : "pine"].color, align: "center" as const })),
    ...Array.from({ length: GRID.rows }, (_, r) => ({ content: `<b>${r + 1}</b>`, x: -84, y: r * GRID.pitch + 30, w: 70, fontSize: 24, color: TEAM_INFO[r < 17 ? "ridge" : "cedar"].color, align: "right" as const })),
  ];
  staticIds.push(...(await board.createTexts(texts)));
  const frames = await board.createFrames(frameBoxes(), COLORS.frame);
  const cells = buildCells();
  const ids = await board.createShapes(
    cells.map((c) => {
      const st = cellStroke(c);
      return { content: c.label, fill: startFill(c), x: c.x + GRID.cell / 2, y: c.y + GRID.cell / 2, w: GRID.cell, h: GRID.cell, borderColor: st.color, borderWidth: st.width, textColor: textColorFor(c.kind), fontSize: CELL_FONT, parentId: frames[frameOfRow(c.row)] };
    }),
  );
  const layout = {
    boardId: process.env.MIRO_BOARD_ID,
    builtAt: new Date().toISOString().slice(0, 10),
    note: "Ids of the live board items, written by `npm run referee build`. Rebuilding changes every id.",
    frames,
    orders: Object.fromEntries(TEAMS.map((t, i) => [t, ordersFrames[i]])),
    fixtures: { banner: fx[0], scoreboard: fx[1], leaderboard: fx[2] },
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
        const res = await runSimulation(loadRules(), { players: Number(opt("players", "28")), seed, turnSec: Number(opt("turn", "15")), mistakeRate: opt("mistakes") ? Number(opt("mistakes")) : undefined });
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
        console.log(`  ${name.padEnd(9)} ${fill} -> read back ${back} ${ok ? "OK" : `MISMATCH${name === "firebreak" ? " (set firebreak to #808080 in config/colors.json and kit/board.json)" : ""}`}`);
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
      console.log(`new game: ${r.repainted} squares repainted, ${r.deleted} items deleted (inbox cards, stickies, junk)`);
      return;
    }
    case "lobby": {
      // Before the fire: students /join (an inbox card each), teams + roles assigned, PLANs approved, paints undone.
      takeLock();
      const { ref, game } = await makeReferee(miro());
      await ref.discover();
      await ref.rebuildMissing();
      if (ref.state.phase !== "lobby") {
        console.error(`the game is ${ref.state.phase}; run \`reset\` for a new game, or \`run\` to resume it.`);
        process.exit(1);
      }
      console.log("LOBBY open: students /join now and bosses post their PLAN. Ctrl-C when everyone is in, then `npm run referee run`.");
      await loop(ref, game, () => false, pollMs);
      await ref.pause();
      saveGame(game);
      return;
    }
    case "run": {
      // The fire. Lights it from the lobby, or resumes a paused game. Ends at 30 min or when the fire is out.
      takeLock();
      if (existsSync(STOP_FLAG)) unlinkSync(STOP_FLAG); // an old request must not end this game
      const { ref, game } = await makeReferee(miro());
      await ref.discover();
      await ref.rebuildMissing();
      if (ref.state.phase === "over") {
        console.log(ref.resultsText());
        console.log("\nthe game is over; `reset` starts a new one.");
        return;
      }
      await ref.start();
      console.log("🔥 LIVE. Ctrl-C pauses (resume with `run`); `stop` ends it now.");
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
      await ref.discover();
      await ref.stop();
      saveGame(game);
      console.log(ref.resultsText());
      return;
    }
    case "results": {
      const game = loadGame();
      const noop = { listItems: async () => [], updateShape: async () => {}, deleteItem: async () => {}, createShapes: async () => [], members: async () => ({}) };
      console.log(new Referee(noop, game, loadRules()).resultsText());
      return;
    }
    default:
      console.log(`wildfire referee
  npm run sim [-- --players 28 --turn 15 --seed 1 | --seeds 3]   offline game with bots (tuning)
  npm run referee build      WIPE the board and build it (SPEC.md geometry): grid, panels, Orders frames
  npm run referee verify     token + board + color check
  npm run referee reset      new game: starting colors, empty Inbox and Orders
  npm run referee lobby      students join, bosses post PLANs (Ctrl-C when everyone is in)
  npm run referee run        light the fire and referee it (Ctrl-C pauses; run again resumes)
  npm run referee stop       end now: highest % wins
  npm run referee results    print the result
  options: --poll 3 (seconds between board reads), --seed N (repeatable fire)
state: ${GAME_FILE}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
