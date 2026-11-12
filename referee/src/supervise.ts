// `npm run referee supervise -- <run flags>`: runs `run` as a child and restarts it when it dies
// (crash, uncaught error, kill, a hung tick), so a class game keeps going without the instructor.
// It stops supervising when the game is over, when `npm run referee stop` was used, or on Ctrl-C (which
// pauses the game exactly like Ctrl-C on `run`). The policy is pure (`decide`, `isHung`) and unit-tested.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { acquireLock, lockOwner, releaseLock } from "./lock.js";

export const BACKOFF_START_MS = 2_000;
export const BACKOFF_MAX_MS = 30_000;
/** A run shorter than this that ends is a crash loop: the next wait doubles. */
export const FAST_CRASH_MS = 20_000;
/** A run longer than this was healthy: the wait goes back to 2 s. */
export const HEALTHY_RUN_MS = 60_000;

export interface PolicyState {
  /** The wait before the next restart (before this exit's adjustment). */
  backoffMs: number;
  /** Restarts so far. */
  restarts: number;
}

export interface ExitFacts {
  code: number | null;
  signal: string | null;
  /** How long the child ran. */
  ranMs: number;
  /** state/game.json says state.phase === "over". */
  gameOver: boolean;
  /** state/stop exists (`npm run referee stop` asked a running referee to end the game). */
  stopRequested: boolean;
  /** The supervisor itself got SIGINT/SIGTERM/SIGHUP. */
  signalled: boolean;
}

export type Decision = { action: "stop"; reason: string } | { action: "restart"; delayMs: number; next: PolicyState };

export const initialPolicy = (): PolicyState => ({ backoffMs: BACKOFF_START_MS, restarts: 0 });

/** What to do when the child exits. Pure. */
export function decide(exit: ExitFacts, st: PolicyState): Decision {
  if (exit.signalled) return { action: "stop", reason: "supervisor interrupted: game paused" };
  if (exit.gameOver) return { action: "stop", reason: "the game is over" };
  if (exit.stopRequested) return { action: "stop", reason: "stop was requested (state/stop): run `npm run referee stop` again to end the game" };
  if (exit.code === 2) return { action: "stop", reason: "configuration error (exit 2: MIRO_ACCESS_TOKEN / MIRO_BOARD_ID missing in .env)" };
  const base = exit.ranMs > HEALTHY_RUN_MS ? BACKOFF_START_MS : st.backoffMs;
  const nextBackoff = exit.ranMs < FAST_CRASH_MS ? Math.min(base * 2, BACKOFF_MAX_MS) : base;
  return { action: "restart", delayMs: base, next: { backoffMs: nextBackoff, restarts: st.restarts + 1 } };
}

/**
 * The child is hung when game.json (written every tick) hasn't changed for `hangMs`. Until the child's first
 * own write (lastWriteMs before startedMs) it gets `startupGraceMs`: board discovery retries for up to ~90 s.
 */
export function isHung(nowMs: number, startedMs: number, lastWriteMs: number | null, hangMs: number, startupGraceMs: number): boolean {
  if (lastWriteMs === null || lastWriteMs < startedMs) return nowMs - startedMs > startupGraceMs;
  return nowMs - lastWriteMs > hangMs;
}

const describeExit = (code: number | null, signal: string | null) => (signal ? `signal ${signal}` : `code ${code}`);

/** Paths and timings, overridable by env for testing without touching the live state/ folder. */
function settings() {
  const stateDir = process.env.WILDFIRE_STATE_DIR ? path.resolve(process.env.WILDFIRE_STATE_DIR) : path.join(ROOT, "state");
  const sec = (name: string, def: number) => (process.env[name] ? Number(process.env[name]) * 1000 : def);
  return {
    gameFile: path.join(stateDir, "game.json"),
    stopFlag: path.join(stateDir, "stop"),
    lock: path.join(stateDir, "referee.lock"),
    superLock: path.join(stateDir, "supervise.lock"),
    logFile: process.env.WILDFIRE_SUPERVISE_LOG ? path.resolve(process.env.WILDFIRE_SUPERVISE_LOG) : path.join(ROOT, "results/supervise.log"),
    hangMs: sec("WILDFIRE_HANG_SECONDS", 60_000),
    startupGraceMs: sec("WILDFIRE_STARTUP_GRACE_SECONDS", 180_000),
    killGraceMs: sec("WILDFIRE_KILL_GRACE_SECONDS", 10_000),
    pauseGraceMs: 45_000,
    childCmd: process.env.WILDFIRE_CHILD,
  };
}

function readPhase(gameFile: string): string | undefined {
  for (const f of [gameFile, `${gameFile}.bak`]) {
    try {
      return (JSON.parse(readFileSync(f, "utf8")) as { state?: { phase?: string } }).state?.phase;
    } catch {
      /* missing or cut short: try the backup */
    }
  }
  return undefined;
}

function mtimeMs(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

const sleep = (ms: number, wake: { cancel?: () => void }) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    wake.cancel = () => {
      clearTimeout(t);
      res();
    };
  });

export async function supervise(runArgs: string[]): Promise<void> {
  const s = settings();
  const log = (line: string) => {
    console.log(`\n[supervise] ${line}`);
    try {
      mkdirSync(path.dirname(s.logFile), { recursive: true });
      appendFileSync(s.logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* the log is a convenience; never stop supervising over it */
    }
  };

  // One supervisor at a time, and never next to a referee someone started by hand.
  const sup = acquireLock(s.superLock);
  if (!sup.ok) {
    console.error(`another supervisor is running (pid ${sup.owner}). Only one may run.`);
    process.exit(1);
  }
  process.on("exit", () => releaseLock(s.superLock));
  const other = lockOwner(s.lock);
  if (other) {
    console.error(`a referee is already running (pid ${other}). Ctrl-C it first, then supervise.`);
    process.exit(1);
  }

  let child: ChildProcess | null = null;
  let signalled = false;
  let signalledAt = 0;
  const wake: { cancel?: () => void } = {};
  const onSignal = (sig: NodeJS.Signals) => {
    if (signalled) {
      // A second Ctrl-C (not the same one relayed again by npm/tsx a moment later): don't wait for a clean pause.
      if (Date.now() - signalledAt > 2000 && child && child.exitCode === null) {
        log(`${sig} again: killing the referee (pid ${child.pid})`);
        child.kill("SIGKILL");
      }
      return;
    }
    signalled = true;
    signalledAt = Date.now();
    wake.cancel?.();
    if (child && child.exitCode === null && child.signalCode === null) {
      log(`${sig}: pausing the referee (pid ${child.pid}); Ctrl-C again to kill it`);
      child.kill("SIGINT"); // the referee's Ctrl-C path: pause, save, banner PAUSED
      const c = child;
      setTimeout(() => c.exitCode === null && c.signalCode === null && c.kill("SIGKILL"), s.pauseGraceMs).unref();
    }
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => onSignal(sig));

  let policy = initialPolicy();
  log(`supervising: ${s.childCmd ?? `run ${runArgs.join(" ")}`}`.trim());
  for (;;) {
    const started = Date.now();
    // detached: the child gets its own process group, so a terminal Ctrl-C reaches it once, forwarded by us.
    child = s.childCmd
      ? spawn(s.childCmd, { shell: true, stdio: "inherit", detached: true, cwd: ROOT })
      : spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", ...runArgs], { stdio: "inherit", detached: true, cwd: ROOT });
    const c = child;
    let hangKilled = false;
    const watchdog = setInterval(() => {
      if (hangKilled || signalled || c.exitCode !== null || c.signalCode !== null) return;
      if (!isHung(Date.now(), started, mtimeMs(s.gameFile), s.hangMs, s.startupGraceMs)) return;
      hangKilled = true;
      log(`referee (pid ${c.pid}) looks hung: ${path.basename(s.gameFile)} unchanged for ${Math.round(s.hangMs / 1000)} s; SIGTERM`);
      c.kill("SIGTERM");
      setTimeout(() => {
        if (c.exitCode === null && c.signalCode === null) {
          log(`referee (pid ${c.pid}) ignored SIGTERM; SIGKILL`);
          c.kill("SIGKILL");
        }
      }, s.killGraceMs).unref();
    }, 1000);
    const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>((res) => {
      c.once("exit", (code, signal) => res({ code, signal }));
      c.once("error", (e) => {
        log(`could not start the referee: ${e.message}`);
        res({ code: 1, signal: null });
      });
    });
    clearInterval(watchdog);
    child = null;
    // A killed referee leaves its pid in the lock. That pid is ours and dead: clear it, so the restart
    // can't be refused if the OS hands the pid to some other process in the meantime.
    try {
      if (c.pid && readFileSync(s.lock, "utf8").trim() === String(c.pid)) unlinkSync(s.lock);
    } catch {
      /* no lock: the referee released it */
    }

    const d = decide({ code, signal, ranMs: Date.now() - started, gameOver: readPhase(s.gameFile) === "over", stopRequested: existsSync(s.stopFlag), signalled }, policy);
    if (d.action === "stop") {
      log(`referee exited (${describeExit(code, signal)}${hangKilled ? ", hung" : ""}); not restarting: ${d.reason}`);
      return;
    }
    policy = d.next;
    log(`referee exited (${describeExit(code, signal)}${hangKilled ? ", hung" : ""}); restarting in ${d.delayMs / 1000} s (restart #${policy.restarts})`);
    await sleep(d.delayMs, wake);
    if (signalled) {
      log("interrupted while waiting to restart; the game stays paused/saved. `npm run referee run` resumes it");
      return;
    }
    // While we waited, `stop` may have ended the game itself, or someone started a referee by hand.
    if (readPhase(s.gameFile) === "over") return log("the game is over; not restarting");
    if (existsSync(s.stopFlag)) return log("stop was requested; not restarting");
    const holder = lockOwner(s.lock);
    if (holder) return log(`another referee (pid ${holder}) holds the lock; not restarting`);
  }
}
