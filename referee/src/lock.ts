// One referee at a time (REFLECTION.md §3: two referees doubled the Miro reads and fought over game.json).
// The lock file is created atomically (O_EXCL), so two referees started in the same second can't both win.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The pid holding the lock, if that process is still alive (a stale lock from a crash doesn't count). */
export function lockOwner(file: string, self = process.pid): number | null {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    if (!pid || pid === self) return null;
    process.kill(pid, 0); // throws when that process is gone
    return pid;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else: still a live referee.
    if ((e as NodeJS.ErrnoException).code === "EPERM") return Number(readFileSync(file, "utf8").trim()) || null;
    return null;
  }
}

/** Take the lock or return the pid of the live referee that has it. */
export function acquireLock(file: string, pid = process.pid): { ok: true } | { ok: false; owner: number } {
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, String(pid), { flag: "wx" });
      return { ok: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = lockOwner(file, pid);
      if (owner) return { ok: false, owner };
      try {
        if (readFileSync(file, "utf8").trim() === String(pid)) return { ok: true };
        unlinkSync(file); // stale: its referee died without cleaning up
      } catch {
        /* someone else removed it first: try again */
      }
    }
  }
  const owner = lockOwner(file, pid);
  return owner ? { ok: false, owner } : { ok: false, owner: -1 };
}

export function releaseLock(file: string, pid = process.pid): void {
  try {
    if (readFileSync(file, "utf8").trim() === String(pid)) unlinkSync(file);
  } catch {
    /* already gone */
  }
}
