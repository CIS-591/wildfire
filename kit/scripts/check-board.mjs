// Offline sanity check for kit/board.json: label <-> coordinate math, sectors, cabins, rivers, slots.
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
ok("cabins and first fire inside their own sector", () => {
  for (const [t, team] of Object.entries(board.teams)) {
    for (const c of team.cabins) assert.equal(sectorOf(c), t, c);
    assert.equal(sectorOf(team.firstFire), t);
  }
});
ok("cabins are mirror images (col c <-> 35-c, row r <-> 33-r)", () => {
  const mirrorLR = (l) => { const { col, row } = parse(l); return `${colName(35 - col)}${row}`; };
  const mirrorTB = (l) => { const { col, row } = parse(l); return `${colName(col)}${34 - row + 1}`; };
  assert.deepEqual(board.teams.pine.cabins, board.teams.ridge.cabins.map(mirrorLR));
  assert.deepEqual(board.teams.cedar.cabins, board.teams.ridge.cabins.map(mirrorTB));
  assert.deepEqual(board.teams.birch.cabins, board.teams.ridge.cabins.map((l) => mirrorTB(mirrorLR(l))));
});
ok("rivers inside their own sector", () => {
  for (const [t, team] of Object.entries(board.teams)) {
    const [a, b] = team.river.split("-");
    assert.equal(sectorOf(a), t);
    assert.equal(sectorOf(b), t);
  }
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
ok("sticky slots fit inside an Orders frame and do not overlap", () => {
  const { size, colors, note, ...kinds } = board.stickySlots;
  const all = Object.values(kinds).flat();
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
ok("colors are lowercase hex", () => {
  for (const v of Object.values(board.colors)) assert.match(v, /^#[0-9a-f]{6}$/);
  for (const t of Object.values(board.teams)) assert.match(t.color, /^#[0-9a-f]{6}$/);
});

console.log(`\n${n} checks passed`);
