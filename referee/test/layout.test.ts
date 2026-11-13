import { describe, expect, it } from "vitest";
import { GAP, GRID, GRID_BOX, INBOX_CARD, ORDERS, PANELS, TEAMS, TEAM_INFO, buildCells, cellBox, frameBoxes, frameOfRow, inside } from "../src/layout.js";

const cells = buildCells();
const at = (l: string) => cells.find((c) => c.label === l)!;

describe("the gap between the team areas", () => {
  it("columns S-AJ and rows 18-34 sit one GAP further out", () => {
    expect(GAP).toBe(64);
    expect([at("A1").x, at("A1").y]).toEqual([0, 0]);
    expect([at("R17").x, at("R17").y]).toEqual([1088, 1024]);
    expect([at("S17").x, at("S17").y]).toEqual([1216, 1024]);
    expect([at("R18").x, at("R18").y]).toEqual([1088, 1152]);
    expect([at("AJ34").x, at("AJ34").y]).toEqual([2304, 2176]);
    expect(GRID_BOX).toEqual({ x: 0, y: 0, w: 2364, h: 2236 });
  });

  it("the four areas are disjoint with an empty GAP-wide strip between them", () => {
    const area = (t: (typeof TEAMS)[number]) => {
      const mine = cells.filter((c) => c.sector === t);
      const x0 = Math.min(...mine.map((c) => c.x));
      const y0 = Math.min(...mine.map((c) => c.y));
      return { x0, y0, x1: Math.max(...mine.map((c) => c.x)) + GRID.cell, y1: Math.max(...mine.map((c) => c.y)) + GRID.cell };
    };
    expect(area("pine").x0 - area("ridge").x1).toBe(GAP + GRID.pitch - GRID.cell);
    expect(area("cedar").y0 - area("ridge").y1).toBe(GAP + GRID.pitch - GRID.cell);
    for (const t of TEAMS) expect(cells.filter((c) => c.sector === t).length).toBe(18 * 17);
    expect(TEAM_INFO.ridge.cols).toEqual([0, 17]);
  });

  it("every square lies inside its band frame, and the frames don't overlap", () => {
    const boxes = frameBoxes();
    for (const c of cells) {
      const f = boxes[frameOfRow(c.row)]!;
      const b = cellBox(c);
      expect(b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h, c.label).toBe(true);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.h);
  });

  it("the panels right of and below the grid don't overlap it (with room for the rim and area labels)", () => {
    for (const t of TEAMS) expect(ORDERS[t].x).toBeGreaterThanOrEqual(GRID_BOX.x + GRID_BOX.w + 120);
    expect(PANELS.rules.x).toBeGreaterThanOrEqual(GRID_BOX.x + GRID_BOX.w + 120);
    expect(PANELS.inbox.y).toBeGreaterThanOrEqual(GRID_BOX.y + GRID_BOX.h + 120);
    expect(inside(PANELS.inbox, PANELS.inbox.x + INBOX_CARD.firstX, INBOX_CARD.firstY)).toBe(true);
  });
});
