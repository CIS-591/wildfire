// Make the four team areas stand apart (SPEC.md, Palette):
// - every square gets a border in its team's color, width 4 (referee/config/colors.json teams);
// - Team 3's old indigo #4338ca becomes gold #ca8a04 on every item that uses it (labels, edges, headers);
// - the old one-block leaderboard fixture is deleted (the referee builds the ranking strip + 4 team cards
//   on its next `reset`/`lobby`).
// Fills are NOT touched. Run: node board/build/restyle_teams.mjs   (token + board id from referee/.env)
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL("referee/.env", root), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const token = env.MIRO_ACCESS_TOKEN;
const board = JSON.parse(readFileSync(new URL("board/board.json", root), "utf8"));
const colors = JSON.parse(readFileSync(new URL("referee/config/colors.json", root), "utf8"));
const game = JSON.parse(readFileSync(new URL("referee/state/game.json", root), "utf8"));
const boardId = encodeURIComponent(env.MIRO_BOARD_ID || board.boardId);
if (!token) throw new Error("MIRO_ACCESS_TOKEN missing in referee/.env");

const API = `https://api.miro.com/v2/boards/${boardId}`;
const OLD = "#4338ca";
const NEW = colors.teams.cedar.toLowerCase();
const WIDTH = String(colors.square.teamBorderWidth ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(500 * attempt);
      continue;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 429) {
      const reset = Number(res.headers.get("X-RateLimit-Reset"));
      const wait = reset ? Math.max(1000, reset * 1000 - Date.now() + 250) : 2000;
      console.log(`429, waiting ${Math.round(wait / 1000)} s`);
      await sleep(Math.min(wait, 65_000));
      continue;
    }
    if (res.status >= 500 && attempt < 6) {
      await sleep(500 * attempt);
      continue;
    }
    throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

// Every item on the board (frames included), to find the old Team 3 color.
const items = [];
for (let cursor = ""; ; ) {
  const page = await call("GET", `/items?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
  items.push(...page.data);
  if (!page.cursor) break;
  cursor = page.cursor;
}
console.log(`${items.length} items on the board`);

const PATHS = { shape: "shapes", text: "texts", frame: "frames", sticky_note: "sticky_notes", card: "cards" };
const squareIds = new Map(Object.entries(board.cells).map(([label, id]) => [id, label]));
const teamOf = (label) => {
  const m = /^([A-Z]+)(\d+)$/.exec(label);
  const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = Number(m[2]) - 1;
  return row >= 17 ? (col >= 18 ? "birch" : "cedar") : col >= 18 ? "pine" : "ridge";
};

const jobs = [];
for (const it of items) {
  const label = squareIds.get(it.id);
  if (label) {
    jobs.push({ kind: "square", path: `/shapes/${it.id}`, body: { style: { borderColor: colors.teams[teamOf(label)], borderWidth: WIDTH } } });
    continue;
  }
  const st = it.style ?? {};
  const fix = {};
  for (const k of ["fillColor", "borderColor", "color"]) if (String(st[k] ?? "").toLowerCase() === OLD) fix[k] = NEW;
  if (Object.keys(fix).length && PATHS[it.type]) jobs.push({ kind: "team3", path: `/${PATHS[it.type]}/${it.id}`, body: { style: fix } });
}
const oldBoard = game.fixtureIds?.leaderboard;
if (oldBoard && items.some((i) => i.id === oldBoard)) jobs.push({ kind: "delete", method: "DELETE", path: `/items/${oldBoard}` });

const count = { square: 0, team3: 0, delete: 0, failed: 0 };
const failures = [];
let next = 0;
const t0 = Date.now();
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      await call(job.method ?? "PATCH", job.path, job.body);
      count[job.kind]++;
      const done = count.square + count.team3 + count.delete;
      if (done % 200 === 0) console.log(`${done}/${jobs.length}`);
    } catch (e) {
      count.failed++;
      failures.push(e.message);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s: squares ${count.square}, team 3 color ${count.team3}, old leaderboard deleted ${count.delete}, failed ${count.failed}`);
for (const f of failures.slice(0, 20)) console.log("  FAIL", f);
process.exit(count.failed ? 1 : 0);
