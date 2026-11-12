// Strip emoji from the STATIC board items (title, rules panel, Orders headers + subtitles, example stickies,
// area labels, inbox heading, legend swatches): the instructor wants no emoji on the projector board.
// Only ids in board.json `static` / `examples` are touched: never squares, fixtures, inbox cards or players' stickies.
// Miro stores emoji as HTML entities (&#x1f525;), so entities are decoded before matching.
// Run: node board/build/static_no_emoji.mjs            (dry run: lists what would change)
//      node board/build/static_no_emoji.mjs --apply    (PATCHes the items)
// Token + board id from referee/.env. The referee snapshots static text at its next start.
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
const APPLY = process.argv.includes("--apply");

const API = `https://api.miro.com/v2/boards/${boardId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|[\u{1F7E0}-\u{1F7EB}]/u;
const EMOJI_G = new RegExp(EMOJI.source, "gu");
const ZWJ = String.fromCharCode(0x200d); // joins multi-part emoji
// Emoji written as entities (&#x1f525; / &#128293;) become real characters; other entities stay as they are.
const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);|&#(\d+);/gi, (m, hex, dec) => {
    const ch = String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec));
    return EMOJI.test(ch) || ch === ZWJ ? ch : m;
  });
// Color squares carry meaning (a legend), so they become words; everything else is dropped.
const WORDS = [
  [/🟩\s*/gu, "GREEN = "],
  [/🟧\s*/gu, "ORANGE = "],
  [/🟦\s*/gu, "BLUE = "],
  [/⬛\s*/gu, "BLACK = "],
  [/🟥\s*/gu, "RED = "],
];
function clean(html) {
  let s = decode(html);
  for (const [re, word] of WORDS) s = s.replace(re, word);
  s = s.split(ZWJ).join("").replace(EMOJI_G, "");
  return s
    .replace(/ {2,}/g, " ")
    .replace(/(>|^) +/g, "$1") // no leading space after a tag / at the start
    .replace(/ +(<|$)/g, "$1") // no trailing space before a tag / at the end
    .replace(/ = (<|$)/g, "$1"); // a color word left with nothing after it
}

const items = [];
for (let cursor = ""; ; ) {
  const page = await call("GET", `/items?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
  items.push(...page.data);
  if (!page.cursor) break;
  cursor = page.cursor;
}
const staticIds = new Set([...board.static, ...Object.values(board.examples)]);
const PATHS = { shape: "shapes", text: "texts", sticky_note: "sticky_notes" };

const jobs = [];
const skipped = [];
for (const it of items) {
  if (!staticIds.has(it.id)) continue;
  const content = it.data?.content ?? "";
  if (!EMOJI.test(decode(content))) continue;
  if (!PATHS[it.type]) {
    skipped.push(`${it.type} ${it.id}`);
    continue;
  }
  jobs.push({ id: it.id, type: it.type, before: content, after: clean(content) });
}
console.log(`${items.length} items on the board, ${staticIds.size} static ids, ${jobs.length} static items with emoji`);
for (const j of jobs) console.log(`\n${j.type} ${j.id}\n  - ${decode(j.before)}\n  + ${j.after}`);
for (const s of skipped) console.log(`SKIP (type has no content PATCH): ${s}`);

if (!APPLY) {
  console.log(jobs.length ? "\ndry run: re-run with --apply to write" : "\nnothing to do");
  process.exit(0);
}
let failed = 0;
for (const j of jobs) {
  try {
    await call("PATCH", `/${PATHS[j.type]}/${j.id}`, { data: { content: j.after } });
  } catch (e) {
    failed++;
    console.log("  FAIL", e.message);
  }
}
console.log(`applied ${jobs.length - failed}/${jobs.length}`);
process.exit(failed ? 1 : 0);
