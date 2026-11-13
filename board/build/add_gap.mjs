// Open an empty gap (GAP = 64, one square-width) between the four team areas on the LIVE board, in place:
// between columns R|S and between rows 17|18. Same layout as referee/src/layout.ts (GAP, colX, rowY,
// frameBoxes, PANELS, ORDERS, LB_ROW, TEAM_CARD, INBOX_CARD). Ids never change: every item is PATCHed.
//
//   node board/build/add_gap.mjs --dry-run --offline   counts from board/board.json only (no network)
//   node board/build/add_gap.mjs --dry-run             reads the board (GETs only), prints what it would move
//   node board/build/add_gap.mjs                       moves everything (stop the referee first!)
//   options: --rate N    max requests per minute (default 500; 1 PATCH ~ 100 credits, limit 100k credits/min)
//            --force-statics   move the non-grid items even though the band frames already have the new size
//
// What moves (centers in old canvas coordinates):
//   1. the 9 band frames -> frameBoxes() with the gap (all GAP wider; band 5 (rows 17-20) also GAP taller,
//      bands 6-9 GAP lower). Absolute targets: rerunning is a no-op.
//   2. the 1,224 squares -> top-left x = col*64 (+GAP from S), y = (row-1)*64 (+GAP from row 18), set
//      relative to their band frame's top-left (Miro's API positions frame children that way). Absolute targets.
//   3. everything else that is not inside a frame (headers, rim bars, area labels/stripes/bands, panels,
//      Orders frames (their stickies ride along), leaderboard rows/badges/icons, TEAMS cards, inbox panel
//      and cards), by zone:
//        right of the grid (center x >= 2420, y < 2280): x + GAP;
//        the inbox (center y >= 2280): y + GAP (a shape spanning the whole width, i.e. the inbox panel,
//          also gets GAP wider);
//        around the grid (center x < 2420, -120 <= y < 2280): the plane is cut at x 1150 / y 1086: items
//          past a cut move by GAP; a long bar that spans a cut (rim bars, the inbox panel) gets GAP longer.
//        above the grid (title, banner, scoreboard, the parked wind rose): unchanged. The locked backdrop
//          is unchanged (it still covers everything).
//      These are deltas, so each moved id is recorded in board/build/add_gap.progress.json: a rerun skips them.
//
// Never prints the token. Token + board id from referee/.env (MIRO_ACCESS_TOKEN, MIRO_BOARD_ID), ids from board/board.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const GAP = 64;
const PITCH = 64;
const CELL = 60;
const COLS = 36;
const ROWS = 34;
const GAP_COL = 18; // S
const GAP_ROW = 17; // row 18 (0-based 17)
const SEAM_X = 18 * PITCH - 2; // 1150: between R (1088..1148) and S (1152..)
const SEAM_Y = 17 * PITCH - 2; // 1086
const RIGHT_X = 2420; // the rules/leaderboard/TEAMS/Orders column starts at x 2440
const INBOX_Y = 2280; // the inbox panel starts at y 2300
const ABOVE_Y = -120; // banner/scoreboard/title centers are above this

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OFFLINE = args.includes("--offline");
const FORCE_STATICS = args.includes("--force-statics");
const rateArg = args.indexOf("--rate");
const RATE = rateArg >= 0 ? Number(args[rateArg + 1]) : 500;
if (!(RATE > 0 && RATE <= 900)) throw new Error("--rate must be 1..900 requests per minute");

const root = new URL("../../", import.meta.url);
const board = JSON.parse(readFileSync(new URL("board/board.json", root), "utf8"));
const progressUrl = new URL("board/build/add_gap.progress.json", root);

// ---------- geometry (mirrors referee/src/layout.ts) ----------
const colX = (c) => c * PITCH + (c >= GAP_COL ? GAP : 0);
const rowY = (r) => r * PITCH + (r >= GAP_ROW ? GAP : 0);
function frameBoxes() {
  const out = [];
  for (let r0 = 0; r0 < ROWS; r0 += 4) {
    const rows = Math.min(4, ROWS - r0);
    const y0 = rowY(r0) - 2;
    const y1 = rowY(r0 + rows - 1) + PITCH - 2;
    out.push({ x: -2, y: y0, w: COLS * PITCH + GAP, h: y1 - y0 });
  }
  return out;
}
const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function parseLabel(text) {
  const m = /^([A-Z]{1,2})(\d{1,2})$/.exec(String(text).replace(/<[^>]*>/g, "").trim().toUpperCase());
  if (!m) return null;
  const col = m[1].length === 1 ? L.indexOf(m[1]) : (L.indexOf(m[1][0]) + 1) * 26 + L.indexOf(m[1][1]);
  const row = Number(m[2]) - 1;
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { col, row } : null;
}
const near = (a, b) => Math.abs(a - b) <= 1;

if (OFFLINE) {
  if (!DRY) throw new Error("--offline only works with --dry-run");
  const statics = new Set([...(board.static ?? []), ...Object.keys(board.windRoseParked?.original ?? {})]);
  console.log(`offline dry run for board ${board.boardId} (counts from board/board.json, positions not read)`);
  console.log(`  band frames to resize/move:        ${board.frames.length}`);
  let expected = 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (c >= GAP_COL || (Math.floor(r / 4) === Math.floor(GAP_ROW / 4) && r >= GAP_ROW)) expected++;
  console.log(`  squares in band frames:             ${Object.keys(board.cells).length}; expected PATCHes ~${expected} (columns S-AJ, plus rows 18-20 of A-R in the band that spans the row gap; the other bands keep their frame-relative positions)`);
  console.log(`  Orders frames (x + ${GAP}):            ${Object.keys(board.orders).length} (their stickies move with them)`);
  console.log(`  fixtures (leaderboard rows/badges): ${Object.keys(board.fixtures).filter((k) => k.startsWith("rank_")).length} (x + ${GAP}); banner, scoreboard unchanged`);
  console.log(`  static items to classify:           ${statics.size} (${board.staticGroups?.headers?.length ?? "?"} row/column headers; panels, rim, area labels, ...)`);
  console.log(`  + referee-made items found on the board (TEAMS cards, icons, inbox cards): counted by --dry-run`);
  const maxReq = board.frames.length + Object.keys(board.cells).length + statics.size + 30 + 60;
  console.log(`  upper bound ~${maxReq} PATCHes + ~60 GETs: about ${Math.ceil(maxReq / RATE)} min at ${RATE}/min`);
  console.log(`new band frames: ${frameBoxes().map((b) => `${b.x},${b.y},${b.w}x${b.h}`).join("  ")}`);
  process.exit(0);
}

// ---------- REST ----------
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
if (!token) throw new Error("MIRO_ACCESS_TOKEN missing in referee/.env");
const boardId = env.MIRO_BOARD_ID || board.boardId;
const API = `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!DRY) {
  for (const f of ["referee/state/referee.lock", "referee/state/supervise.lock"]) {
    const p = new URL(f, root);
    if (!existsSync(p)) continue;
    const pid = Number(readFileSync(p, "utf8").trim());
    let alive = false;
    try {
      if (pid) process.kill(pid, 0), (alive = true);
    } catch (e) {
      alive = e.code === "EPERM";
    }
    if (alive) throw new Error(`a referee is running (pid ${pid}, ${f}): stop it first, or it will put every moved item back`);
  }
}

// Throttle: request starts spaced 60000/RATE ms apart, across all workers.
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 60_000 / RATE;
  if (at > now) await sleep(at - now);
}
let requests = 0;
async function call(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    await slot();
    requests++;
    let res;
    try {
      res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(1000 * attempt);
      continue;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 429 && attempt < 10) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const reset = Number(res.headers.get("X-RateLimit-Reset"));
      const wait = retryAfter > 0 ? retryAfter * 1000 : reset > 0 ? Math.max(1000, reset * 1000 - Date.now() + 500) : 5000 * attempt;
      console.log(`429 rate limited: waiting ${Math.round(wait / 1000)} s`);
      nextSlot = Date.now() + Math.min(wait, 70_000);
      continue;
    }
    if (res.status >= 500 && attempt < 6) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(`${method} ${path.replace(API, "")}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
async function listAll(query = "") {
  const out = [];
  for (let cursor = ""; ; ) {
    const page = await call("GET", `/items?limit=50${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...page.data);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

// ---------- progress (idempotence for delta moves) ----------
let progress = { boardId, gap: GAP, moved: {} };
if (existsSync(progressUrl)) {
  const p = JSON.parse(readFileSync(progressUrl, "utf8"));
  if (p.boardId === boardId && p.gap === GAP) progress = p;
  else console.log(`ignoring ${progressUrl.pathname}: it is for board ${p.boardId}, gap ${p.gap}`);
}
let dirty = false;
const saveProgress = () => {
  if (!DRY && dirty) writeFileSync(progressUrl, JSON.stringify(progress, null, 2) + "\n");
  dirty = false;
};

const PATHS = { shape: "shapes", text: "texts", frame: "frames", sticky_note: "sticky_notes", card: "cards", image: "images", app_card: "app_cards", document: "documents", embed: "embeds" };
const patchPath = (it) => (PATHS[it.type] ? `/${PATHS[it.type]}/${it.id}` : null);

async function runJobs(label, jobs, workers = 4) {
  const done = { ok: 0, failed: 0 };
  const fails = [];
  if (DRY) {
    console.log(`[dry run] ${label}: ${jobs.length} PATCHes`);
    for (const j of jobs.slice(0, 6)) console.log(`    ${j.what}`);
    return done;
  }
  console.log(`${label}: ${jobs.length} PATCHes`);
  let next = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try {
          await call("PATCH", j.path, j.body);
          done.ok++;
          if (j.record) {
            progress.moved[j.record] = true;
            dirty = true;
            if (done.ok % 20 === 0) saveProgress();
          }
          if (done.ok % 100 === 0) console.log(`  ${done.ok}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
        } catch (e) {
          done.failed++;
          fails.push(`${j.what}: ${e.message}`);
        }
      }
    }),
  );
  saveProgress();
  console.log(`  done: ${done.ok} ok, ${done.failed} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const f of fails.slice(0, 20)) console.log(`  FAIL ${f}`);
  return done;
}

// ---------- 0. read the board ----------
console.log(`board ${boardId}${DRY ? " (dry run: GETs only)" : ""}, gap ${GAP}, max ${RATE} requests/min`);
const items = await listAll();
const byId = new Map(items.map((it) => [it.id, it]));
console.log(`${items.length} items on the board`);

const NEW_FRAMES = frameBoxes();
const bandIds = board.frames.slice();
// A band frame id missing from the board: find it by its (old or new) box.
const frames = items.filter((it) => it.type === "frame");
bandIds.forEach((id, i) => {
  if (byId.has(id)) return;
  const oldY = i * 256 - 2;
  const f = frames.find((fr) => {
    const x0 = fr.position.x - fr.geometry.width / 2;
    const y0 = fr.position.y - fr.geometry.height / 2;
    return near(x0, -2) && (near(y0, oldY) || near(y0, NEW_FRAMES[i].y)) && fr.geometry.width >= COLS * PITCH - 2;
  });
  if (f) bandIds[i] = f.id;
  else console.log(`band frame ${i + 1} (${id}) not found on the board: its squares are skipped`);
});
const bandSet = new Set(bandIds.filter((id) => byId.has(id)));
const alreadyWide = bandIds.every((id) => !byId.has(id) || near(byId.get(id).geometry.width, NEW_FRAMES[0].w));

// ---------- 1. band frames ----------
const frameJobs = [];
bandIds.forEach((id, i) => {
  const f = byId.get(id);
  if (!f) return;
  const b = NEW_FRAMES[i];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (near(f.position.x, cx) && near(f.position.y, cy) && near(f.geometry.width, b.w) && near(f.geometry.height, b.h)) return;
  frameJobs.push({ what: `band ${i + 1} -> ${b.x},${b.y} ${b.w}x${b.h}`, path: `/frames/${id}`, body: { position: { x: cx, y: cy }, geometry: { width: b.w, height: b.h } } });
});
await runJobs("1. band frames", frameJobs, 1);

// ---------- 2. squares (re-read each band's children: frame-relative positions) ----------
const squareJobs = [];
const seenLabels = new Set();
let squaresOk = 0;
for (const [i, id] of bandIds.entries()) {
  if (!bandSet.has(id)) continue;
  const fb = NEW_FRAMES[i];
  const kids = DRY ? items.filter((it) => it.parent?.id === id) : await listAll(`&parent_item_id=${id}`);
  for (const it of kids) {
    if (it.type !== "shape") continue;
    const cell = parseLabel(it.data?.content ?? "");
    if (!cell) continue;
    seenLabels.add(`${cell.col},${cell.row}`);
    // Target center, relative to the frame's NEW top-left.
    const rx = colX(cell.col) + CELL / 2 - fb.x;
    const ry = rowY(cell.row) + CELL / 2 - fb.y;
    // In a dry run the frame hasn't moved: compare against what the position would be after the frame PATCH
    // (Miro keeps children relative to the frame's top-left; bands 6-9 only move, band 5 only grows).
    if (near(it.position.x, rx) && near(it.position.y, ry)) {
      squaresOk++;
      continue;
    }
    squareJobs.push({ what: `${it.data.content.replace(/<[^>]*>/g, "")} -> rel ${rx},${ry}`, path: `/shapes/${it.id}`, body: { position: { x: rx, y: ry } } });
  }
}
console.log(`squares found in band frames: ${seenLabels.size}/${COLS * ROWS}; already in place: ${squaresOk}`);
await runJobs("2. squares", squareJobs, 4);

// ---------- 3. everything else outside frames ----------
const backdropId = board.restyle?.added?.backdrop;
const skip = new Set([backdropId, ...bandIds].filter(Boolean));
const otherJobs = [];
const zoneCount = { right: 0, inbox: 0, grid: 0, unchanged: 0, done: 0 };
const staticsDone = alreadyWide && !Object.keys(progress.moved).length && !FORCE_STATICS;
if (staticsDone) console.log("band frames already had the new width and there is no progress file: skipping step 3 (use --force-statics to run it)");
for (const it of staticsDone ? [] : items) {
  if (skip.has(it.id) || it.parent?.id) continue;
  if (progress.moved[it.id]) {
    zoneCount.done++;
    continue;
  }
  const path = patchPath(it);
  if (!path || !it.position) continue;
  const cx = it.position.x;
  const cy = it.position.y;
  let w = it.geometry?.width ?? 0;
  let h = it.geometry?.height ?? 0;
  const rot = Math.round(((it.geometry?.rotation ?? 0) % 360 + 360) % 360);
  const rotated = rot !== 0;
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  if (w > 3000 && h > 3000) continue; // a backdrop
  const stretchable = !rotated && (it.type === "shape" || it.type === "frame");
  let dx = 0;
  let dy = 0;
  let dw = 0;
  let dh = 0;
  let zone;
  if (cy >= INBOX_Y) {
    zone = "inbox";
    dy = GAP;
    if (stretchable && cx - w / 2 < SEAM_X - 200 && cx + w / 2 > SEAM_X + 200) (dw = GAP), (dx = GAP / 2);
  } else if (cx >= RIGHT_X) {
    zone = "right";
    dx = GAP;
  } else if (cy >= ABOVE_Y) {
    zone = "grid";
    if (stretchable && cx - w / 2 < SEAM_X - 200 && cx + w / 2 > SEAM_X + 200) (dw = GAP), (dx = GAP / 2);
    else if (cx > SEAM_X) dx = GAP;
    if (stretchable && h && cy - h / 2 < SEAM_Y - 200 && cy + h / 2 > SEAM_Y + 200) (dh = GAP), (dy = GAP / 2);
    else if (cy > SEAM_Y) dy = GAP;
  }
  if (!dx && !dy && !dw && !dh) {
    zoneCount.unchanged++;
    continue;
  }
  zoneCount[zone]++;
  const body = { position: { x: cx + dx, y: cy + dy } };
  if (dw || dh) body.geometry = rot === 90 || rot === 270 ? { width: (it.geometry.width ?? 0) + dh, height: (it.geometry.height ?? 0) + dw } : { width: w + dw, height: h + dh };
  const text = String(it.data?.content ?? it.data?.title ?? "").replace(/<[^>]*>/g, "").slice(0, 30);
  otherJobs.push({ what: `${zone} ${it.type} "${text}" (${Math.round(cx)},${Math.round(cy)}) +${dx},${dy}${dw || dh ? ` size +${dw},${dh}` : ""}`, path, body, record: it.id });
}
console.log(`other items: right of grid ${zoneCount.right}, inbox ${zoneCount.inbox}, around the grid ${zoneCount.grid}, unchanged ${zoneCount.unchanged}, moved in an earlier run ${zoneCount.done}`);
await runJobs("3. headers, labels, panels, Orders, leaderboard, inbox", otherJobs, 4);

console.log(`\n${DRY ? "would PATCH" : "PATCHed"}: frames ${frameJobs.length}, squares ${squareJobs.length}, other ${otherJobs.length}; ${requests} requests made`);
if (!DRY) console.log("next: python3 board/build/sync_ids.py (ids are unchanged, but it refreshes kit/ and referee/config/), then start the referee");
