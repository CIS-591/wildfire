// Put the RULES on the rules panel (2440, -330, 760, 610), matching what the referee enforces
// (referee/src/rules.ts decidePaint/judgeSticky, referee.ts isJunk/isMeme/policeQuestions/statics repair) and
// referee/src/cli.ts rulesHtml(). Layout, top to bottom:
//   heading "RULES" (same item, same style) · 10 numbered rules (two text items) · the penalty line ·
//   divider · the colour legend (4 swatch rows, moved down to the panel's bottom, otherwise untouched).
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

// The rules (same wording as referee/src/cli.ts rulesHtml()).
const RULES = [
  "Paint only squares in your team's area.",
  "Paint only <b>blue</b>, and only on green or orange squares.",
  `Max ${r.paintBatch} squares per move, then wait ${r.cooldownSeconds} s.`,
  `<b>Orange</b> only after a teammate's <b>YES</b>: ${r.attackSquares} green square${r.attackSquares === 1 ? "" : "s"} in that neighbour's area, ${r.attackMinutes} min.`,
  "Ask only in your own team's Orders, and only about a neighbour.",
  "Never answer your own question.",
  "Edit only your own inbox card and your own Orders sticky.",
  "Never move, edit, recolor or delete anything else.",
  "No images, shapes or text anywhere.",
  `Water is limited: each team has one bucket (on the banner). ${r.attacksPerTeam} attacks per team.`,
];
const PENALTY = "<b>Break a rule:</b> your move is undone, you are frozen, and the leaderboard names you.";
const rulesHtml = (from, to) => RULES.slice(from, to).map((l, i) => `<p><b>${from + i + 1}.</b> ${l}</p>`).join("");

// Geometry (board coords, centre origin). Panel: x 2440..3200, y -330..280. Text column: x 2472, width 696.
const FONT = 17; // >= 15 px; 1 line = 1.2 x font
const LINE = FONT * 1.2;
const X = 2472 + 696 / 2;
const TOP = -264; // just under the heading (heading box ends at -273.5)
// Miro renders a text item from its STORED top (centre - storedHeight/2) downward, and a REST content/font
// change does not recompute the stored height: it only scales the old one by newFont/oldFont. These items
// were one line, three lines and one line at 25 px (heights 30, 91, 30), so at 17 px Miro keeps 20.4, 61.9
// and 20.4 whatever the content. Place each block's centre so its stored top is where the text should start.
const STORED_H = { rules1: (30 * FONT) / 25, rules2: (91 * FONT) / 25, penalty: (30 * FONT) / 25 };
const at = (top, key) => top + STORED_H[key] / 2;
const ID = {
  heading: "3458764690218441591",
  rules1: "3458764690218441601",
  rules2: "3458764690218441602",
  penalty: "3458764690218441614",
  divider: "3458764690218441600",
};
const top2 = TOP + 5 * LINE + 2;
const topP = top2 + 5 * LINE + 6;
const textStyle = { fontSize: String(FONT), fontFamily: "roboto_condensed", textAlign: "left", color: "#1f2328" };

// Legend rows: original centre y (as the board was styled) + 238, so the last row ends at y 260 (panel bottom 280).
const SHIFT = 238;
const LEGEND = {
  "3458764690218441592": { x: 2500, y: -222 }, // green swatch
  "3458764690218441593": { x: 2860, y: -223 }, // "Green = tree."
  "3458764690218441594": { x: 2500, y: -150 }, // orange swatch
  "3458764690218441595": { x: 2860, y: -151 }, // "Orange = fire."
  "3458764690218441596": { x: 2500, y: -78 }, // blue swatch
  "3458764690218587339": { x: 2868, y: -64 }, // "Blue = water."
  "3458764690218441598": { x: 2500, y: -6 }, // black swatch
  "3458764690218441599": { x: 2860, y: -7 }, // "Black = burnt."
};

const jobs = [
  ["PATCH", `/texts/${ID.heading}`, { data: { content: "RULES" } }],
  ["PATCH", `/texts/${ID.rules1}`, { data: { content: rulesHtml(0, 5) }, style: textStyle, position: { x: X, y: at(TOP, "rules1") }, geometry: { width: 696 } }],
  ["PATCH", `/texts/${ID.rules2}`, { data: { content: rulesHtml(5, 10) }, style: textStyle, position: { x: X, y: at(top2, "rules2") }, geometry: { width: 696 } }],
  ["PATCH", `/texts/${ID.penalty}`, { data: { content: PENALTY }, style: { ...textStyle, color: "#c92a2a" }, position: { x: X, y: at(topP, "penalty") }, geometry: { width: 696 } }],
  ...Object.entries(LEGEND).map(([id, p]) => ["PATCH", `/items/${id}`, { position: { x: p.x, y: p.y + SHIFT } }]),
];

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
// The divider line (${ID.divider}) can't be moved over REST (400 operationNotSupported). It was moved once with the
// Miro MCP canvas_update_from_svg to y = ${Math.round(topP + LINE + 10)} (x 2472..3168), between the penalty line and the legend.
process.exit(failed ? 1 : 0);
