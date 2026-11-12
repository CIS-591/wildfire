// The projector text: banner and scoreboard (no emoji, the room-shouting hooks, the tokens bots and the kit read).
import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/board.js";
import { percents, waterOf } from "../src/bot.js";
import { FakeBoard } from "../src/fake-board.js";
import { buildCells, type Team } from "../src/layout.js";
import { Referee, emptyGame } from "../src/referee.js";
import { LEAD_COOLDOWN_MS, applyJoin, mulberry32, scores, startGame, stopGame, trackLead, type GameState, type RuleSet } from "../src/rules.js";

const rules: RuleSet = {
  spreadSeconds: 20, pSide: 0.3, pDiag: 0.08, burnTicks: 3, lightningAt: [5], lightningMinDistance: 6, startFires: [], paintBatch: 1,
  waterPerTeam: 400, cooldownSeconds: 5, timeoutSeconds: 5, attackMinutes: 2, attackSquares: 3, attacksPerTeam: 2, gameMinutes: 10,
};
const EMOJI = /\p{Extended_Pictographic}/u;
const cells = buildCells();

/** A referee whose state we drive by hand: 2 players per team, live. */
function game(live = true) {
  let t = 1_000_000;
  const ref = new Referee(FakeBoard.seeded(() => t), emptyGame(), rules, { now: () => t, log: () => {}, rng: mulberry32(7) });
  const s = ref.state;
  for (const [u, name] of [["r1", "Rita"], ["p1", "Pat"], ["c1", "Cy"], ["b1", "Bea"], ["r2", "Rob"], ["p2", "Pia"], ["c2", "Cal"], ["b2", "Ben"]] as const) applyJoin(s, { userId: u, name, at: t }, undefined);
  if (live) startGame(s, rules, t);
  return { ref, s, banner: () => stripHtml(ref.bannerHtml()).trim(), scoreboard: () => stripHtml(ref.scoreboardHtml()).trim(), end: () => (t += 1000) };
}

/** Burn n green squares in a team's area (score down by about n/306). */
function burn(s: GameState, team: Team, n: number) {
  for (const c of cells.filter((c) => c.sector === team && s.cells[c.label] === "forest").slice(0, n)) s.cells[c.label] = "burnt";
}

describe("banner and scoreboard: words, not emoji", () => {
  it("no emoji in the lobby, live, final-minute, game-over and paused banners or the scoreboard", () => {
    const lobby = game(false);
    expect(lobby.banner()).not.toMatch(EMOJI);
    expect(lobby.banner()).toContain("/join now");
    expect(lobby.scoreboard()).not.toMatch(EMOJI);
    const g = game();
    burn(g.s, "pine", 30);
    g.s.cells.A1 = "fire";
    expect(g.banner()).toMatch(/^LIVE · \d+:\d\d left · next spread \d+s · WATER T1 400 · T2 400 · T3 400 · T4 400/);
    expect(g.banner()).not.toMatch(EMOJI);
    for (const e of g.s.events) expect(e.text).not.toMatch(EMOJI);
    expect(g.scoreboard()).not.toMatch(EMOJI);
    g.s.elapsed = 9.5 * 60_000;
    expect(g.banner()).not.toMatch(EMOJI);
    stopGame(g.s, cells, g.end());
    expect(g.banner()).not.toMatch(EMOJI);
  });

  it("the scoreboard marks the leader with LEAD, shows ON FIRE n, and percents() still reads it", () => {
    const g = game();
    burn(g.s, "pine", 31); // 90%
    burn(g.s, "cedar", 61); // 80%
    burn(g.s, "birch", 31); // 90% (the centre fire is one square in each area)
    g.s.cells.A1 = "fire";
    g.s.cells.A2 = "fire";
    const sb = g.scoreboard();
    expect(sb).toContain("TEAM 1 99% LEAD · ON FIRE 3"); // A1 A2 and the centre R17 cost Team 1 1%
    expect(sb.match(/LEAD/g)).toHaveLength(1);
    expect(percents(sb)).toEqual({ ridge: 99, pine: 90, cedar: 80, birch: 90 });
  });

  it("a tie at the top gets no LEAD", () => {
    const g = game();
    expect(g.scoreboard()).not.toContain("LEAD");
  });

  it("the bots read each team's water after WATER", () => {
    const g = game();
    g.s.water.pine = 37;
    expect(waterOf(g.banner(), "pine")).toBe(37);
    expect(waterOf(g.banner(), "ridge")).toBe(400);
    expect(waterOf("LIVE · 3:00 left", "ridge")).toBe(0);
  });
});

describe("banner hooks (presentation only)", () => {
  it("FINAL MINUTE! on line 2 in the last 60 s, with the leader", () => {
    const g = game();
    burn(g.s, "pine", 31);
    g.s.events = [];
    g.s.elapsed = 9 * 60_000 + 30_000;
    const [, line2] = g.banner().split("\n");
    expect(line2).toMatch(/^FINAL MINUTE! /);
    g.s.elapsed = 8 * 60_000;
    expect(g.banner()).not.toContain("FINAL MINUTE");
  });

  it("NECK AND NECK when the top two are within 2% (after minute 3)", () => {
    const g = game();
    burn(g.s, "ridge", 10); // 97%
    burn(g.s, "pine", 12); // 96%
    burn(g.s, "cedar", 40);
    burn(g.s, "birch", 40);
    g.s.events = [];
    g.s.elapsed = 2 * 60_000;
    expect(g.banner()).not.toContain("NECK AND NECK");
    g.s.elapsed = 3.5 * 60_000; // no lightning within a minute (it comes at 5:00)
    expect(g.banner().split("\n")[1]).toBe("TEAM 1 AND TEAM 2 ARE NECK AND NECK");
    burn(g.s, "pine", 20);
    expect(g.banner()).not.toContain("NECK AND NECK");
  });

  it("GAME OVER names the winner with its % and a podium on line 2", () => {
    const g = game();
    burn(g.s, "ridge", 40);
    burn(g.s, "cedar", 20);
    burn(g.s, "birch", 60);
    const sc = scores(g.s, cells);
    stopGame(g.s, cells, g.end());
    const [line1, line2] = g.banner().split("\n");
    expect(line1).toBe(`GAME OVER · TEAM 2 WINS WITH ${sc.pine.pct}%`);
    expect(line2).toBe(`2ND TEAM 3 ${sc.cedar.pct}% · 3RD TEAM 1 ${sc.ridge.pct}% · stopped`);
  });

  it("TAKES THE LEAD! fires once per change, never for the first leader or a tie, and not faster than the cooldown", () => {
    const { s } = game();
    const leads = () => s.events.filter((e) => e.text.endsWith("TAKES THE LEAD!")).map((e) => e.text);
    trackLead(s, cells); // all 100%: a tie, nobody leads
    expect(s.leader).toBeUndefined();
    burn(s, "pine", 3); // 99%
    burn(s, "cedar", 10); // 97%
    burn(s, "birch", 20); // 93%
    trackLead(s, cells); // Team 1 (100%) is ahead: the first leader, no shout
    expect(s.leader).toBe("ridge");
    trackLead(s, cells);
    expect(leads()).toEqual([]);
    burn(s, "ridge", 15); // 95%
    s.elapsed = 60_000;
    trackLead(s, cells);
    trackLead(s, cells); // no change: no second event
    expect(s.leader).toBe("pine");
    expect(leads()).toEqual(["TEAM 2 TAKES THE LEAD!"]);
    burn(s, "pine", 20); // 92%: Team 3 (97%) ahead within the cooldown: noted, not shouted
    s.elapsed = 60_000 + LEAD_COOLDOWN_MS - 1000;
    trackLead(s, cells);
    expect(s.leader).toBe("cedar");
    expect(leads()).toHaveLength(1);
    burn(s, "cedar", 30); // 87%: Team 1 (95%) ahead again, after the cooldown
    s.elapsed = 60_000 + 2 * LEAD_COOLDOWN_MS;
    trackLead(s, cells);
    expect(leads()).toEqual(["TEAM 2 TAKES THE LEAD!", "TEAM 1 TAKES THE LEAD!"]);
  });

  it("the lead change shows on the banner's line 2", () => {
    const g = game();
    burn(g.s, "pine", 3);
    burn(g.s, "cedar", 10);
    burn(g.s, "birch", 20);
    trackLead(g.s, cells);
    burn(g.s, "ridge", 30);
    g.s.elapsed = 60_000;
    trackLead(g.s, cells);
    expect(g.banner().split("\n")[1]).toBe("TEAM 2 TAKES THE LEAD!");
  });
});
