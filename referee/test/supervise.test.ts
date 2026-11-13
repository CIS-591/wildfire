import { describe, expect, it } from "vitest";
import { decide, initialPolicy, isHung, type ExitFacts, type PolicyState } from "../src/supervise.js";

const crash = (ranMs: number, over: Partial<ExitFacts> = {}): ExitFacts => ({ code: 1, signal: null, ranMs, gameOver: false, stopRequested: false, signalled: false, ...over });

/** Feed a series of run lengths through the policy; returns the restart delays (s). */
function delays(runs: number[], st: PolicyState = initialPolicy()): number[] {
  const out: number[] = [];
  for (const ms of runs) {
    const d = decide(crash(ms), st);
    if (d.action !== "restart") throw new Error("expected a restart");
    out.push(d.delayMs / 1000);
    st = d.next;
  }
  return out;
}

describe("supervise restart policy", () => {
  it("first restart is after 2 s and counts restarts", () => {
    const d = decide(crash(5_000), initialPolicy());
    expect(d).toEqual({ action: "restart", delayMs: 2000, next: { backoffMs: 4000, restarts: 1 } });
  });

  it("doubles the wait while it keeps crashing within 20 s, capped at 30 s", () => {
    expect(delays([1000, 1000, 1000, 1000, 1000, 1000, 1000])).toEqual([2, 4, 8, 16, 30, 30, 30]);
  });

  it("resets the wait after a run longer than 60 s", () => {
    expect(delays([1000, 1000, 1000, 61_000, 1000, 1000])).toEqual([2, 4, 8, 2, 2, 4]);
  });

  it("keeps (does not grow) the wait after a run of 20-60 s", () => {
    expect(delays([1000, 1000, 30_000, 30_000, 1000])).toEqual([2, 4, 8, 8, 8]);
  });

  it("restarts after a kill by signal, or a clean exit mid-game", () => {
    expect(decide(crash(5000, { code: null, signal: "SIGKILL" }), initialPolicy()).action).toBe("restart");
    expect(decide(crash(5000, { code: 0 }), initialPolicy()).action).toBe("restart");
  });

  it("stops when the game is over, stop was requested, the supervisor was signalled, or .env is missing", () => {
    for (const over of [{ gameOver: true }, { stopRequested: true }, { signalled: true }, { code: 2 }] as Partial<ExitFacts>[]) {
      expect(decide(crash(1000, over), initialPolicy()).action).toBe("stop");
    }
  });

  it("a signalled supervisor wins over everything else (Ctrl-C pauses, never restarts)", () => {
    const d = decide(crash(1000, { signalled: true, gameOver: true }), initialPolicy());
    expect(d).toMatchObject({ action: "stop", reason: expect.stringContaining("paused") });
  });
});

describe("guard restart policy (MIRO_ACCESS_TOKEN_2)", () => {
  it("restarts the guard after game over or a stop request (it guards in every phase)", () => {
    for (const over of [{ gameOver: true }, { stopRequested: true }, {}] as Partial<ExitFacts>[]) {
      expect(decide(crash(1000, over), initialPolicy(), true).action).toBe("restart");
    }
  });
  it("stops the guard when the supervisor is interrupted or its token is missing", () => {
    expect(decide(crash(1000, { signalled: true }), initialPolicy(), true).action).toBe("stop");
    expect(decide(crash(1000, { code: 2 }), initialPolicy(), true)).toMatchObject({ action: "stop", reason: expect.stringContaining("MIRO_ACCESS_TOKEN_2") });
  });
});

describe("hang watchdog", () => {
  const start = 1_000_000;
  it("is not hung while game.json keeps changing", () => {
    expect(isHung(start + 200_000, start, start + 150_000, 60_000, 180_000)).toBe(false);
  });
  it("is hung when game.json is 60 s old after the child's first write", () => {
    expect(isHung(start + 70_000, start, start + 9_000, 60_000, 180_000)).toBe(true);
  });
  it("gives a fresh child the startup grace before its first write (old file from the last run)", () => {
    expect(isHung(start + 120_000, start, start - 500_000, 60_000, 180_000)).toBe(false);
    expect(isHung(start + 181_000, start, start - 500_000, 60_000, 180_000)).toBe(true);
    expect(isHung(start + 181_000, start, null, 60_000, 180_000)).toBe(true);
  });
});
