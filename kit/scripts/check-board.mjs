// Offline sanity check for kit/board.json: label <-> coordinate math, areas, scan boxes, 4 colors, slots, ids.
// Run: node scripts/check-board.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const board = JSON.parse(readFileSync(new URL("../board.json", import.meta.url), "utf8"));
const P = board.grid.pitch;

const colIndex = (s) => (s.length === 1 ? s.charCodeAt(0) - 65 : 26 + s.charCodeAt(1) - 65);
const colName = (c) => (c < 26 ? String.fromCharCode(65 + c) : "A" + String.fromCharCode(65 + c - 26));
const parse = (label) => {
  const m = /^([A-Z]{1,2})(\d{1,2})$/.exec(label);
  return { col: colIndex(m[1]), row: Number(m[2]) };
};
const toXY = (label) => {
  const { col, row } = parse(label);
  return { x: col * P, y: (row - 1) * P };
};
const fromXY = (x, y) => `${colName(Math.floor(x / P))}${Math.floor(y / P) + 1}`;
const inBox = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
const sectorOf = (label) => {
  const { x, y } = toXY(label);
  return Object.keys(board.teams).find((t) => inBox(board.teams[t].sector, x, y));
};

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

ok("A1 -> (0,0)", () => assert.deepEqual(toXY("A1"), { x: 0, y: 0 }));
ok("R17 -> (1088,1024)", () => assert.deepEqual(toXY("R17"), { x: 1088, y: 1024 }));
ok("AJ34 -> (2240,2112)", () => assert.deepEqual(toXY("AJ34"), { x: 2240, y: 2112 }));
ok("round trip every square", () => {
  for (let c = 0; c < 36; c++)
    for (let r = 1; r <= 34; r++) {
      const l = `${colName(c)}${r}`;
      const { x, y } = toXY(l);
      assert.equal(fromXY(x + 30, y + 30), l);
    }
});
ok("grid box covers 36x34", () => assert.deepEqual(board.grid.box, { x: 0, y: 0, w: 36 * P, h: 34 * P }));
ok("sector table", () => {
  assert.equal(sectorOf("A1"), "ridge");
  assert.equal(sectorOf("R17"), "ridge");
  assert.equal(sectorOf("S1"), "pine");
  assert.equal(sectorOf("AJ17"), "pine");
  assert.equal(sectorOf("A18"), "cedar");
  assert.equal(sectorOf("R34"), "cedar");
  assert.equal(sectorOf("S18"), "birch");
  assert.equal(sectorOf("AJ34"), "birch");
});
ok("every square in exactly one sector, 306 each", () => {
  const count = {};
  for (let c = 0; c < 36; c++)
    for (let r = 1; r <= 34; r++) {
      const { x, y } = toXY(`${colName(c)}${r}`);
      const hits = Object.keys(board.teams).filter((t) => inBox(board.teams[t].sector, x, y));
      assert.equal(hits.length, 1);
      count[hits[0]] = (count[hits[0]] ?? 0) + 1;
    }
  for (const t of Object.keys(board.teams)) assert.equal(count[t], 18 * 17);
});
ok("first fire inside its own area, startScan is 6x6 at the inner corner", () => {
  for (const [t, team] of Object.entries(board.teams)) {
    assert.equal(sectorOf(team.firstFire), t);
    const b = team.startScan, s = team.sector;
    assert.ok(b.w <= board.maxScan.w && b.h <= board.maxScan.h);
    assert.ok(b.x >= s.x && b.y >= s.y && b.x + b.w <= s.x + s.w && b.y + b.h <= s.y + s.h);
    const { x, y } = toXY(team.firstFire);
    assert.ok(inBox(b, x, y), `${t} startScan misses ${team.firstFire}`);
  }
});
ok("no leftover kinds (cabins, rivers)", () => {
  for (const team of Object.values(board.teams)) assert.ok(!("cabins" in team) && !("river" in team));
});
ok("neighbours share a border", () => {
  for (const [t, team] of Object.entries(board.teams))
    for (const n of team.neighbours) assert.ok(board.teams[n].neighbours.includes(t));
});
ok("watch box = sector + 3 squares, inside the grid", () => {
  for (const team of Object.values(board.teams)) {
    const w = team.watch, s = team.sector, g = board.grid.box;
    assert.ok(w.x <= s.x && w.y <= s.y && w.x + w.w >= s.x + s.w && w.y + w.h >= s.y + s.h);
    assert.ok(w.x >= g.x && w.y >= g.y && w.x + w.w <= g.x + g.w && w.y + w.h <= g.y + g.h);
    assert.equal(w.w, s.w + 3 * P);
    assert.equal(w.h, s.h + 3 * P);
  }
});
ok("sticky slots: only order/question, fit the frame, no overlap, EXAMPLE corner reserved", () => {
  const { size, colors, note, reserved, ...kinds } = board.stickySlots;
  assert.deepEqual(Object.keys(kinds).sort(), ["order", "question"]);
  assert.deepEqual(Object.keys(colors).sort(), ["order", "question"]);
  assert.deepEqual(reserved.example, { x: 600, y: 726 });
  const all = [...Object.values(kinds).flat(), reserved.example];
  const f = board.orders.ridge;
  for (const s of all) assert.ok(s.x >= 0 && s.y >= 0 && s.x + size.w <= f.w && s.y + size.h <= f.h, JSON.stringify(s));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const overlap = a.x < b.x + size.w && b.x < a.x + size.w && a.y < b.y + size.h && b.y < a.y + size.h;
      assert.ok(!overlap, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`);
    }
});
ok("Orders frames do not overlap the grid or each other", () => {
  const boxes = [board.grid.box, ...Object.values(board.orders)];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
    }
});
ok("exactly four square colors", () => {
  const { frame, ...squares } = board.colors;
  assert.deepEqual(squares, { tree: "#3fa66b", fire: "#ff5a1f", water: "#3aa7ff", burnt: "#2a2420" });
  assert.equal(frame, "#ffffff");
});
ok("teams are Team 1..Team 4 with their team colors and Orders titles", () => {
  const want = {
    ridge: ["Team 1", "#7c3aed"],
    pine: ["Team 2", "#db2777"],
    cedar: ["Team 3", "#4338ca"],
    birch: ["Team 4", "#334155"],
  };
  assert.deepEqual(Object.keys(board.teams).sort(), Object.keys(want).sort());
  for (const [id, [name, color]] of Object.entries(want)) {
    assert.equal(board.teams[id].name, name, id);
    assert.equal(board.teams[id].color, color, id);
    assert.equal(board.orders[id].title, `ORDERS · ${name.toUpperCase()}`, id);
  }
});
ok("legend uses the four square colors", () => {
  const { frame, ...squares } = board.colors;
  const text = board.legend.join("\n");
  for (const hex of Object.values(squares)) assert.ok(text.includes(hex), hex);
});
ok("ids present: board, frames, fixtures, orders, all 1224 cells", () => {
  assert.ok(board.boardUrl && board.boardId);
  assert.equal(board.frames.length, 9);
  for (const f of Object.values(board.fixtures)) assert.ok(f.id);
  for (const o of Object.values(board.orders)) assert.ok(o.id);
  assert.equal(Object.keys(board.cells).length, 36 * 34);
  for (let c = 0; c < 36; c++) for (let r = 1; r <= 34; r++) assert.ok(board.cells[`${colName(c)}${r}`]);
});
ok("colors are lowercase hex", () => {
  for (const v of Object.values(board.colors)) assert.match(v, /^#[0-9a-f]{6}$/);
  for (const t of Object.values(board.teams)) assert.match(t.color, /^#[0-9a-f]{6}$/);
});

console.log(`\n${n} checks passed`);
