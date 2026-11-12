// Red team, round 2: the team draw, --teams / --team-size / --no-draw, the ranking strip and team cards.
// Every test here FAILS on the code it was written against: each one is a confirmed bug (see the comment
// above it for the repro and a suggested fix). Delete or flip a test once its bug is fixed.
import { describe, expect, it } from "vitest";
import { TEAMS, type Team } from "../src/layout.js";
import { Referee } from "../src/referee.js";
import { mulberry32, type RuleSet } from "../src/rules.js";
import { CALM, setup } from "./harness.js";

const DRAW: RuleSet = { ...CALM, drawTeams: true };
const seats = (n: number, prefix = "u"): [string, string][] => Array.from({ length: n }, (_, i) => [`${prefix}${i}`, `P${prefix}${i}`]);
const teamsOf = (ref: Referee) => Object.values(ref.state.players).map((p) => p.team);
/** The instructor stops the lobby (Ctrl-C) and starts `run` with other flags: a new Referee on the same saved game and board. */
async function rerun(g: Awaited<ReturnType<typeof setup>>, rules: RuleSet) {
  const ref = new Referee(g.fake, g.game, rules, { now: g.now, log: () => {}, rng: mulberry32(7) });
  await ref.discover();
  await ref.rebuildMissing();
  await ref.start();
  g.advance(3000);
  const r = await ref.tick();
  expect(r.error).toBeUndefined();
  return ref;
}

describe("red team 2: flags", () => {
  // `--teams abc` (or `--teams --no-draw`, where opt() takes the next flag as the value) makes rules.teams NaN:
  // openTeams() -> TEAMS.slice(0, NaN) = [] -> drawTeams pushes into members[undefined] and start() throws.
  // Fix: validate in cli.ts (Number.isInteger, 1..4, else exit with a message) and make openTeams fall back to 4 on NaN.
  it("R01 --teams NaN with the draw: start() must not throw and everyone gets a real team", async () => {
    const g = await setup({ rules: { ...DRAW, teams: Number("abc") } });
    await expect(g.ref.start()).resolves.toBeUndefined();
    for (const t of teamsOf(g.ref)) expect(TEAMS).toContain(t);
  });

  // Same NaN without the draw: applyJoin picks smallest[0] of an empty pool -> player.team undefined ->
  // welcome() reads TEAM_INFO[undefined].name and every join tick throws.
  it("R02 --teams NaN --no-draw: a join must not crash the tick", async () => {
    const g = await setup({ rules: { ...CALM, teams: Number("abc") }, players: [] });
    g.fake.playerJoin("r1", "Rita");
    g.advance(3000);
    const r = await g.ref.tick();
    expect(r.error).toBeUndefined();
    expect(TEAMS).toContain(g.ref.state.players.r1?.team);
  });

  // `reset` then straight to `run --teams 2` (no lobby; or nobody joined yet): startGame sees no players and sets
  // playing = all four TEAMS. Every late joiner is then spread over Teams 1-4, start fires and lightning hit all four.
  // Fix: in startGame, with no players use openTeams(rules) (and the teamSize-limited set) instead of [...TEAMS].
  it("R03 --teams 2 and nobody in yet at the start: late joiners still only go to Team 1 and Team 2", async () => {
    const g = await setup({ rules: { ...DRAW, teams: 2 }, players: [] });
    await g.ref.start();
    for (const [u, n] of seats(8)) g.fake.playerJoin(u, n);
    await g.tick();
    expect(g.ref.state.playing).toEqual(["ridge", "pine"]);
    for (const t of teamsOf(g.ref)) expect(["ridge", "pine"]).toContain(t);
  });

  // README/RUNBOOK put the flags on `run` only ("npm run referee lobby", then "run -- --teams 3 / --no-draw").
  // The lobby ran with rules.json (drawTeams: true, 4 teams), so applyJoin already parked players in all four
  // teams (hidden). `run --teams 2 --no-draw` then skips the draw and keeps that 4-team split: --teams is ignored.
  // Fix: at start(), when players were never shown a team (joined before the draw), always place them with the
  // run's rules (draw them, or re-place them in openTeams order) even if drawTeams is now off.
  it("R04 lobby with defaults, then `run --teams 2 --no-draw`: only Team 1 and Team 2 play", async () => {
    const g = await setup({ rules: DRAW, players: seats(6) });
    const ref = await rerun(g, { ...CALM, teams: 2, drawTeams: false });
    for (const t of teamsOf(ref)) expect(["ridge", "pine"]).toContain(t);
  });

  // The other way round: `lobby -- --no-draw` (players are told "you are on Team 1, the BOSS"), then `run` without
  // repeating --no-draw: rules.json has drawTeams: true, so start() re-draws and everyone's team and role change
  // after their agents already saved them. Fix: persist the draw choice in the GameFile at the first join (or skip
  // the draw when any player has already been sent a team welcome), and log the mismatch.
  it("R05 lobby --no-draw, then plain `run`: teams already announced in the lobby are not re-drawn", async () => {
    const g = await setup({ rules: CALM, players: seats(8) });
    expect(g.card("u0")).toContain("you are on Team 1");
    const before = Object.values(g.ref.state.players).map((p) => `${p.userId}:${p.team}:${p.role}`);
    const ref = await rerun(g, DRAW);
    expect(Object.values(ref.state.players).map((p) => `${p.userId}:${p.team}:${p.role}`)).toEqual(before);
  });

  // --team-size is documented as "uses only the teams that needs", but a classroom's stragglers join after the draw:
  // 3 joined before `run --team-size 3` -> the draw opens one team; the next 6 all pile into Team 1 (9 players, one
  // area) because late joiners never open a new team. DESIGN ISSUE rather than a crash. Fix: a late joiner whose
  // teams in play are all at teamSize opens the next open team (it gets its start fire then) instead of overfilling.
  it("R06 --team-size 3, 3 players at the start, 6 stragglers: no team ends up with 9", async () => {
    const g = await setup({ rules: { ...DRAW, teamSize: 3 }, live: true, players: seats(3) });
    for (const [u, n] of seats(6, "late")) g.fake.playerJoin(u, n);
    await g.tick();
    const size = (t: Team) => teamsOf(g.ref).filter((x) => x === t).length;
    expect(Math.max(...TEAMS.map(size))).toBeLessThanOrEqual(3);
  });
});

describe("red team 2: who plays", () => {
  // A preset (config/teams.json) for a team that is not playing wins over state.playing in applyJoin: a late joiner
  // becomes the lone BOSS of an empty area (no fire, can't be attacked, card says "not playing this game").
  // Fix: in applyJoin, once state.playing is fixed, ignore a preset outside it (or only honour presets in the draw).
  it("R07 a late joiner with a preset for a team not in play lands in a team that plays", async () => {
    const g = await setup({ rules: { ...DRAW, teams: 2 }, live: true, ref: { presets: { late: "birch" } } });
    g.fake.playerJoin("z9", "Late");
    await g.tick();
    expect(g.ref.state.playing).toEqual(["ridge", "pine"]);
    expect(["ridge", "pine"]).toContain(g.ref.state.players.z9!.team);
  });

  // policeQuestions still uses all neighbours, so a question about a neighbour that is not playing is NOT removed
  // (judgeSticky only replies). Two of them count as the player's 2 open questions and the policeman then deletes
  // their valid third question ("at most 2 open questions"). Fix: in policeQuestions filter `near` by
  // playingTeams(state) like judgeSticky does, so the invalid ones are removed instead of counted.
  it("R08 two questions about a non-playing team don't get the player's valid question deleted", async () => {
    const g = await setup({ rules: { ...DRAW, teams: 2 }, live: true, players: seats(6) });
    const [a, b] = Object.values(g.ref.state.players).filter((p) => p.team === "ridge");
    g.fake.playerSticky(a!.userId, "ridge", "Start a fire in Team 3's area?", g.now() - 3000);
    g.fake.playerSticky(a!.userId, "ridge", "Start a fire in Team 3's area?", g.now() - 2000);
    const q = g.fake.playerSticky(a!.userId, "ridge", "Start a fire in Team 2's area?", g.now() - 1000);
    await g.ticks(2);
    expect(g.fake.items.has(q.id)).toBe(true);
    g.fake.playerEditSticky(b!.userId, q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    expect(g.ref.state.attacks).toMatchObject([{ team: "ridge", to: "pine" }]);
  });

  // In the lobby with the draw, applyJoin has already given everyone a hidden team, and stickies are judged in the
  // lobby too. Two players hidden on Team 1 post + YES "Start a fire in Team 2's area?" before the start: it is
  // approved (attacksUsed.ridge = 1, an attack that runs for 2 min after the start) and then the draw reshuffles who
  // is on Team 1. Fix: skip judgeSticky / policeQuestions while beforeDraw() (or in the lobby altogether), or clear
  // approvals/attacks/attacksUsed in draw().
  it("R09 a question approved in the lobby before the draw does not survive into the game", async () => {
    const g = await setup({ rules: DRAW, players: seats(8) });
    const hidden = Object.values(g.ref.state.players).filter((p) => p.team === "ridge");
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    const q = g.fake.playerSticky(hidden[0]!.userId, "ridge", "Start a fire in Team 2's area?");
    await g.tick();
    g.fake.playerEditSticky(hidden[1]!.userId, q.id, "Start a fire in Team 2's area?\nYES");
    await g.tick();
    await g.ref.start();
    await g.tick();
    expect(g.ref.state.attacks).toEqual([]);
    expect(g.ref.state.attacksUsed.ridge).toBe(0);
  });
});

describe("red team 2: leaderboard ranking", () => {
  // The leaderboard order (rankOrder / the strip / medals) and the banner podium sort by the ROUNDED pct (stable
  // order on ties); endGame picks the winner by exact points. Team 1 300/306 and Team 2 301/306 are both 98%: the
  // banner says TEAM 2 WINS, leaderboard slot 1 (first place, gold medal) is Team 1. Fix: rank with the same
  // comparator as endGame (points/startScore) everywhere, and put the winner first once the game is over.
  it("R10 at GAME OVER first place on the leaderboard is the team the banner names as the winner", async () => {
    const g = await setup({ rules: { ...CALM, lightningAt: [] }, live: true });
    const burn = (t: Team, n: number) =>
      g.ref.cellList
        .filter((c) => c.sector === t && g.ref.state.cells[c.label] === "forest")
        .slice(0, n)
        .forEach((c) => (g.ref.state.cells[c.label] = "burnt"));
    burn("ridge", 6);
    burn("pine", 5);
    burn("cedar", 40);
    burn("birch", 40);
    await g.ref.stop();
    await g.tick();
    expect(g.ref.state.winner).toBe("pine");
    expect(g.fx("banner")).toMatch(/TEAM 2/);
    // First place on the leaderboard (the first team it names) is the winner.
    expect(/team ([1-4])/i.exec(g.fx("leaderboard"))?.[1]).toBe("2");
  });
});
