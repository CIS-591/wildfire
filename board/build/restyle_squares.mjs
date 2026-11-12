// Restyle the 1,224 squares and 9 band frames to the "night map" palette (SPEC.md, Palette).
// Squares: border #0e1311 width 2, label #0b1a10. Fills are NOT touched (the referee reset repaints them).
// Frames: fill #0e1311.
// Run: node board/build/restyle_squares.mjs   (token + board id from referee/.env, ids from board/board.json)
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
const boardId = encodeURIComponent(env.MIRO_BOARD_ID || board.boardId);
if (!token) throw new Error("MIRO_ACCESS_TOKEN missing in referee/.env");

const API = `https://api.miro.com/v2/boards/${boardId}`;
const MAX_IN_FLIGHT = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patch(path, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(500 * attempt);
      continue;
    }
    if (res.ok) return res.status;
    if (res.status === 429) {
      const reset = Number(res.headers.get("X-RateLimit-Reset"));
      // X-RateLimit-Reset is a unix timestamp in seconds; fall back to 2 s.
      const wait = reset ? Math.max(1000, reset * 1000 - Date.now() + 250) : 2000;
      console.log(`429, waiting ${Math.round(wait / 1000)} s`);
      await sleep(Math.min(wait, 65_000));
      continue;
    }
    if (res.status >= 500 && attempt < 6) {
      await sleep(500 * attempt);
      continue;
    }
    throw new Error(`${path}: ${res.status} ${await res.text()}`);
  }
}

const jobs = [
  ...board.frames.map((id) => ({ kind: "frame", path: `/frames/${id}`, body: { style: { fillColor: "#0e1311" } } })),
  ...Object.entries(board.cells).map(([label, id]) => ({
    kind: "square",
    label,
    path: `/shapes/${id}`,
    body: { style: { borderColor: "#0e1311", borderWidth: "2", color: "#0b1a10" } },
  })),
];

const count = { frame: 0, square: 0, failed: 0 };
const failures = [];
let next = 0;
const t0 = Date.now();
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      await patch(job.path, job.body);
      count[job.kind]++;
      const done = count.frame + count.square;
      if (done % 100 === 0) console.log(`${done}/${jobs.length}`);
    } catch (e) {
      count.failed++;
      failures.push(`${job.label ?? job.path}: ${e.message.slice(0, 200)}`);
    }
  }
}
await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, worker));

console.log(
  `done in ${Math.round((Date.now() - t0) / 1000)} s: frames ${count.frame}/${board.frames.length}, ` +
    `squares ${count.square}/${Object.keys(board.cells).length}, failed ${count.failed}`,
);
for (const f of failures.slice(0, 20)) console.log("  FAIL", f);
process.exit(count.failed ? 1 : 0);
