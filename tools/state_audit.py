#!/usr/bin/env python3
"""Fairness and rule audit of a Wildfire game from the referee's per-second state log.

Input: a JSONL file, one line per second: {"t", "phase", "elapsed", "cells", "unshown", "water", "out", "strikes"}
(written by sampling state/game.json during the game). Reports, per team:
  - new fires lit by spreading, per minute and per spread step (equal spread check)
  - scheduled new fires (strikes) per round
  - how long fires waited to be drawn on the board (the "unshown" list) — the board lag each team saw
  - water used, when the team went out
and lists engine-level rule breaks: water that became fire/burnt, burnt that changed, green that went
straight to burnt.

Usage: state_audit.py <states.jsonl> [--log referee.log]
"""
import json, re, sys
from collections import Counter, defaultdict

COLS = [chr(65 + i) for i in range(26)] + ["AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ"]
TEAMS = ["ridge", "pine", "cedar", "birch"]
NAME = {"ridge": "Team 1", "pine": "Team 2", "cedar": "Team 3", "birch": "Team 4"}


def team_of(label):
    m = re.match(r"([A-Z]+)(\d+)$", label)
    c, r = COLS.index(m.group(1)), int(m.group(2))
    return TEAMS[(c >= 18) + 2 * (r >= 18)]


def mmss(ms):
    s = int(ms // 1000)
    return f"{s // 60}:{s % 60:02d}"


def main():
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
    live = [r for r in rows if r["phase"] in ("live", "over") and r.get("cells")]
    # drop repeated snapshots (the referee saves once per tick)
    snaps = []
    for r in live:
        if not snaps or r["elapsed"] != snaps[-1]["elapsed"] or r["cells"] != snaps[-1]["cells"]:
            snaps.append(r)
    print(f"{len(snaps)} distinct snapshots, game {mmss(snaps[0]['elapsed'])} to {mmss(snaps[-1]['elapsed'])}")

    breaks = []
    spread_per_step = []  # (elapsed, Counter team -> new fires)
    per_min = defaultdict(Counter)
    strikes_seen = set(snaps[0].get("strikes") or [])
    unshown_since = {}
    unshown_wait = defaultdict(list)
    for a, b in zip(snaps, snaps[1:]):
        new = Counter()
        new_strikes = set(b.get("strikes") or []) - strikes_seen
        strikes_seen |= new_strikes
        for lab, st in b["cells"].items():
            was = a["cells"].get(lab)
            if was == st:
                continue
            if was == "water" and st in ("fire", "burnt"):
                breaks.append((b["elapsed"], lab, f"water -> {st}"))
            elif was == "burnt":
                breaks.append((b["elapsed"], lab, f"burnt -> {st}"))
            elif was == "forest" and st == "burnt":
                breaks.append((b["elapsed"], lab, "green -> burnt without fire"))
            elif was == "forest" and st == "fire" and lab not in new_strikes:
                new[team_of(lab)] += 1
                per_min[int(b["elapsed"] // 60000)][team_of(lab)] += 1
        if new:
            spread_per_step.append((b["elapsed"], new))
        # board lag: how long each fire stayed in the unshown list
        now_un = set(b.get("unshown") or [])
        for lab in now_un:
            unshown_since.setdefault(lab, b["t"])
        for lab in list(unshown_since):
            if lab not in now_un:
                unshown_wait[team_of(lab)].append(b["t"] - unshown_since.pop(lab))

    print("\nRule breaks in the referee's own record:", len(breaks))
    for e in breaks[:20]:
        print(f"  {mmss(e[0])} {e[1]} {e[2]}")

    print("\nNew fires from spreading, per minute (Team 1/2/3/4):")
    for m in sorted(per_min):
        print(f"  minute {m}: " + " / ".join(str(per_min[m][t]) for t in TEAMS))

    # equal spread: in each step, did every team still in get the same count?
    unequal = []
    for el, c in spread_per_step:
        snap = next(s for s in snaps if s["elapsed"] == el)
        out = {o["team"] for o in (snap.get("out") or [])}
        alive = [t for t in TEAMS if t not in out]
        vals = [c[t] for t in alive]
        if len(set(vals)) > 1:
            unequal.append((el, {NAME[t]: c[t] for t in alive}))
    print(f"\nSpread steps with new fires: {len(spread_per_step)}; steps where teams still in got different counts: {len(unequal)}")
    for el, d in unequal[:12]:
        print(f"  {mmss(el)} {d}")

    print("\nScheduled new fires (in order):", " ".join(f"{s}({NAME[team_of(s)]})" for s in snaps[-1].get("strikes") or []))

    print("\nBoard lag — seconds a fire waited before the board showed it (median / 90th pct / max, count):")
    for t in TEAMS:
        w = sorted(unshown_wait[t])
        if w:
            print(f"  {NAME[t]}: {w[len(w) // 2]:.0f} / {w[int(len(w) * .9)]:.0f} / {w[-1]:.0f} s  ({len(w)} fires)")
        else:
            print(f"  {NAME[t]}: none")

    last = snaps[-1]
    print("\nWater used:", ", ".join(f"{NAME[t]} {75 - last['water'][t]}" for t in TEAMS))
    print("Went out:", ", ".join(f"{NAME[o['team']]} at {mmss(o['at'])}" for o in last.get("out") or []))

    if "--log" in sys.argv:
        log = open(sys.argv[sys.argv.index("--log") + 1]).read().replace("\r", "\n")
        ref = Counter()
        for m in re.finditer(r"([A-Z]+\d+) undone: water can't go on fire", log):
            ref[team_of(m.group(1))] += 1
        print("\n'water can't go on fire' refusals (player painted blue on a fire):", ", ".join(f"{NAME[t]} {ref[t]}" for t in TEAMS))


if __name__ == "__main__":
    main()
