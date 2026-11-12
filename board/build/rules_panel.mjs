// Put the RULES on the rules panel (2440, -330, 760, 610), matching what the referee enforces
// (referee/src/rules.ts decidePaint/judgeSticky, referee.ts isJunk/isMeme/policeQuestions/statics repair) and
// referee/src/cli.ts rulesHtml(). Layout, top to bottom:
//   heading "RULES" (same item, same style) · 8 numbered rules at 24 px (two text items) · the penalty line ·
//   divider · the colour legend (one row of 4 swatches with short labels, at the panel's bottom).
// Numbers come from referee/config/rules.json. Absolute positions, so running it twice is harmless.
// Run ONLY while the referee is stopped (it snapshots static items at start and puts edits back).
// Run: node board/build/rules_panel.mjs   (token + board id from referee/.env)
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
const r = JSON.parse(readFileSync(new URL("referee/config/rules.json", root), "utf8"));
const boardId = encodeURIComponent(env.MIRO_BOARD_ID || board.boardId);
if (!token) throw new Error("MIRO_ACCESS_TOKEN missing in referee/.env");

const API = `https://api.miro.com/v2/boards/${boardId}`;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function call(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
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
    throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

// The rules (same wording as referee/src/cli.ts rulesHtml()). Kept to 8 short rules so they can be 24 px
// (legible on a classroom projector at whole-board zoom). LINES = rendered line count of each rule at FONT px in
// the 696-px column (checked in the browser); positions below depend on it.
const RULES = [
  ["Your area = the thick border in your team's color.", 1],
  ["Paint only <b>blue</b>, only in your area, on green or orange.", 1],
  [`Up to ${r.paintBatch} squares at a time, then wait ${r.cooldownSeconds} s.`, 1],
  [`<b>Orange</b> only after a teammate's <b>YES</b>: 1 square next door.`, 1],
  [`Each team has ${r.attacksPerTeam} attacks and one water bucket.`, 1],
  ["Write only in your own team's Orders.", 1],
  ["Don't move, edit or delete anything else.", 1],
  ["No images, shapes or text on the board.", 1],
];
const PENALTY = ["<b>Break a rule:</b> it is undone and you are frozen.", 1];
const SPLIT = 4; // rules 1-4 in one text item, 5-8 in the other
const rulesHtml = (from, to) => RULES.slice(from, to).map(([l], i) => `<p><b>${from + i + 1}.</b> ${l}</p>`).join("");
const lines = (from, to) => RULES.slice(from, to).reduce((n, [, k]) => n + k, 0);

// Geometry (board coords, centre origin). Panel: x 2440..3200, y -330..280. Text column: x 2472, width 696.
const FONT = 24; // projector-legible; 1 line = 1.2 x font
const LINE = FONT * 1.2;
const X = 2472 + 696 / 2;
const TOP = -266; // just under the heading (heading box ends at -273.5)
// Miro renders a text item from its STORED top (centre - storedHeight/2) downward, and a REST content/font
// change does not recompute the stored height: it only scales the old one by newFont/oldFont. rules1 and penalty
// were single-line AUTO-WIDTH items (REST width is ignored: they render centred at their natural width), so on
// 2026-11-12 they were rewritten once with the Miro MCP canvas_update_from_svg (textArea x 2472, width 696),
// which makes them fixed-width and recomputed their stored heights. Stored heights at 24 px now: rules1 175,
// rules2 87 (old 91 @ 25 px scaled), penalty 58. If FONT changes they scale by newFont/24.
const STORED_H = { rules1: (175 * FONT) / 24, rules2: (91 * FONT) / 25, penalty: (58 * FONT) / 24 };
const at = (top, key) => top + STORED_H[key] / 2;
const ID = {
  heading: "3458764690218441591",
  rules1: "3458764690218441601",
  rules2: "3458764690218441602",
  penalty: "3458764690218441614",
  divider: "3458764690218441600",
};
const GAP = 8; // between blocks
const top2 = TOP + lines(0, SPLIT) * LINE + GAP;
const topP = top2 + lines(SPLIT, RULES.length) * LINE + GAP;
const textStyle = { fontSize: String(FONT), fontFamily: "roboto_condensed", textAlign: "left", color: "#1f2328" };

// Legend: one row of 4 (swatch + short label) at the panel bottom, 4 columns of 174 px across the text column.
// Labels stay at their 25 px font (one line), so their stored heights are unchanged: 30, except the blue label,
// which was two lines (60). Stored top = row centre - 16 for all of them.
const LEGEND_Y = 232; // swatch centre; row spans 208..256 (panel bottom 280)
const SW = 48;
const COL = 174;
const LEGEND = [
  { swatch: "3458764690218441592", label: "3458764690218441593", text: "tree", h: 30 },
  { swatch: "3458764690218441594", label: "3458764690218441595", text: "fire", h: 30 },
  { swatch: "3458764690218441596", label: "3458764690218587339", text: "water", h: 60 },
  { swatch: "3458764690218441598", label: "3458764690218441599", text: "burnt", h: 30 },
];
const LABEL_W = COL - SW - 16;

const jobs = [
  ["PATCH", `/texts/${ID.heading}`, { data: { content: "RULES" } }],
  ["PATCH", `/texts/${ID.rules1}`, { data: { content: rulesHtml(0, SPLIT) }, style: textStyle, position: { x: X, y: at(TOP, "rules1") }, geometry: { width: 696 } }],
  ["PATCH", `/texts/${ID.rules2}`, { data: { content: rulesHtml(SPLIT, RULES.length) }, style: textStyle, position: { x: X, y: at(top2, "rules2") }, geometry: { width: 696 } }],
  ["PATCH", `/texts/${ID.penalty}`, { data: { content: PENALTY[0] }, style: { ...textStyle, color: "#c92a2a" }, position: { x: X, y: at(topP, "penalty") }, geometry: { width: 696 } }],
  ...LEGEND.flatMap((l, i) => {
    const left = 2472 + i * COL;
    return [
      ["PATCH", `/shapes/${l.swatch}`, { position: { x: left + SW / 2, y: LEGEND_Y }, geometry: { width: SW, height: SW } }],
      ["PATCH", `/texts/${l.label}`, { data: { content: l.text }, style: { textAlign: "left" }, position: { x: left + SW + 10 + LABEL_W / 2, y: LEGEND_Y - 16 + l.h / 2 }, geometry: { width: LABEL_W } }],
    ];
  }),
];
console.log(`penalty ends at y ${Math.round(topP + PENALTY[1] * LINE)}; divider goes at y ${Math.round((topP + PENALTY[1] * LINE + LEGEND_Y - SW / 2) / 2)}`);

let failed = 0;
for (const [method, path, body] of jobs) {
  try {
    await call(method, path, body);
    console.log("ok  ", path);
  } catch (e) {
    failed++;
    console.log("FAIL", e.message);
  }
}
console.log(`done: ${jobs.length - failed}/${jobs.length} updated`);
// The divider line (ID.divider) can't be moved over REST (400 operationNotSupported). Move it with the Miro MCP
// canvas_update_from_svg to the y printed above (x 2472..3168), between the penalty line and the legend.
process.exit(failed ? 1 : 0);
