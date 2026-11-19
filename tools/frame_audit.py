#!/usr/bin/env python3
"""Audit a screen recording of the Wildfire board, one frame per second.

Reads the cropped 1 fps frames (frames/<part>_<n>.png plus frames/starts.txt: "<part>.mov <epoch>"),
classifies every grid square in every frame (green tree, orange fire, blue water, black burnt), and
lists the transitions the rules forbid:
  BLUE_TO_FIRE    a blue square later shows orange
  BLUE_TO_BURNT   a blue square later shows black
  BURNT_CHANGED   a black square later shows anything else
  FIRE_TO_GREEN   an orange square goes back to green
  BURNT_NO_FIRE   a green square goes black without ever showing orange
  JUMP            a square catches fire with no burning neighbour (8 around) in the last 25 s,
                  away from the new-fire minutes (possible jump over water)
  DIAG_PAST_WATER a square catches fire whose only burning neighbours are diagonal and both squares
                  between are blue (fire slipped past a water wall at a corner)
Flicker (a state seen in one frame only, e.g. a cursor over a square) is ignored.

Usage: frame_audit.py <frames dir> <out dir> [--live-start EPOCH]
"""
import json, os, sys
from collections import Counter
import numpy as np
from PIL import Image

COLS = [chr(65 + i) for i in range(26)] + ["AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ"]
PAL = {"G": (53, 154, 95), "O": (255, 90, 31), "B": (58, 167, 255), "K": (38, 31, 28)}
NAMES = {"G": "green", "O": "fire", "B": "water", "K": "burnt", "X": "unreadable"}
# each team area: its border color, color tolerance, first column, first row (areas are 18 x 17 squares)
AREAS = [((110, 49, 231), 40, 0, 0), ((209, 32, 104), 40, 18, 0), ((192, 124, 1), 40, 0, 17), ((44, 56, 74), 15, 18, 17)]


def classify_rgb(c):
    best, bd = "X", 1e9
    for k, p in PAL.items():
        d = sum((a - b) ** 2 for a, b in zip(c, p)) ** 0.5
        if d < bd:
            best, bd = k, d
    return best if bd < 75 else "X"


def longest_run(on, gap=9):
    best, cur, last = (0, -1), None, None
    for i in np.flatnonzero(on):
        if cur is None or i - last > gap:
            cur = i
        last = i
        if last - cur > best[1] - best[0]:
            best = (cur, last)
    return best


def fill_near(im):
    """pixels within a few px of a square fill color (green/orange/blue/burnt): the grid, not the leaderboard."""
    from scipy.ndimage import binary_dilation
    i = im.astype(np.int32)
    f = np.zeros(im.shape[:2], bool)
    for p in PAL.values():
        f |= ((i - np.array(p)) ** 2).sum(-1) < 30 ** 2
    return binary_dilation(f, iterations=4)


def find_area(im, col, tol, near):
    """bounding box of one team area's 18 x 17 grid, found from its border color; None when not fully on screen."""
    d = np.sqrt(((im.astype(np.int32) - np.array(col)) ** 2).sum(-1))
    m = (d < tol) & near
    if m.sum() < 500:
        return None
    cs, rs = m.sum(0), m.sum(1)
    x0, x1 = longest_run(cs > 0.06 * cs.max())
    y0, y1 = longest_run(rs > 0.06 * rs.max())
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if w < 18 * 8 or h < 17 * 8:
        return None
    pw, ph = w / 18, h / 17
    if abs(pw - ph) / ph > 0.08:  # cut off by the screen edge or covered
        return None
    H, W = m.shape
    if x0 <= 1 or y0 <= 1 or x1 >= W - 2 or y1 >= H - 2:
        return None
    return x0, y0, pw, ph


def read_frame(path):
    """34 x 36 states ("X" = unreadable / area not on screen) and which areas were read."""
    im = np.asarray(Image.open(path).convert("RGB"))
    # every pixel -> nearest square color (index into PAL) or -1 when none is close
    i32 = im.astype(np.int32)
    keys = list(PAL)
    dist = np.stack([((i32 - np.array(PAL[k])) ** 2).sum(-1) for k in keys])
    lab = np.where(dist.min(0) < 55 ** 2, dist.argmin(0), -1)
    states = [["X"] * 36 for _ in range(34)]
    seen = []
    near = fill_near(im)
    boxes = [find_area(im, col, tol, near) for col, tol, _, _ in AREAS]
    # An area whose border isn't picked up (e.g. Team 2's pink next to Team 1's purple): take its x from
    # the area below/above it and its y from the area beside it (the 4 grids are aligned).
    for a in range(4):
        if boxes[a] is None and boxes[a ^ 2] and boxes[a ^ 1]:
            boxes[a] = (boxes[a ^ 2][0], boxes[a ^ 1][1], boxes[a ^ 2][2], boxes[a ^ 1][3])
    for a, (col, tol, c0, r0) in enumerate(AREAS):
        box = boxes[a]
        if not box:
            continue
        x0, y0, pw, ph = box
        half = max(2, int(0.2 * pw))
        seen.append(a)
        for r in range(17):
            for c in range(18):
                x, y = int(x0 + (c + 0.5) * pw), int(y0 + (r + 0.5) * ph)
                patch = lab[y - half:y + half + 1, x - half:x + half + 1].ravel()
                if patch.size == 0:
                    continue
                cnt = np.bincount(patch[patch >= 0], minlength=len(keys))
                if cnt.max() < 0.3 * patch.size:
                    continue
                states[r0 + r][c0 + c] = keys[int(cnt.argmax())]
    return states, seen


def label(c, r):
    return f"{COLS[c]}{r + 1}"


def area(c, r):
    return (c >= 18, r >= 17)


def main():
    fdir, odir = sys.argv[1], sys.argv[2]
    live = None
    if "--live-start" in sys.argv:
        live = float(sys.argv[sys.argv.index("--live-start") + 1])
    os.makedirs(odir, exist_ok=True)
    starts = {}
    for line in open(os.path.join(fdir, "starts.txt")):
        p, e = line.split()
        starts[p[:-4]] = int(e)
    frames = []
    for f in os.listdir(fdir):
        if f.endswith(".png") and "_" in f and f.split("_")[0] in starts:
            part, n = f[:-4].split("_")
            frames.append((starts[part] + int(n), f))
    frames.sort()
    from multiprocessing import Pool
    with Pool() as pool:
        res = pool.map(read_frame, [os.path.join(fdir, f) for _, f in frames], chunksize=8)
    timeline = []  # (t, file, states or None, areas read)
    for (t, f), (states, seen) in zip(frames, res):
        timeline.append((t, f, states if seen else None, seen))
    usable = [x for x in timeline if x[2] is not None]
    print(f"frames {len(timeline)}, board visible in {len(usable)}")

    def gclock(t):
        if live is None:
            return None
        d = t - live
        return f"{'-' if d < 0 else ''}{int(abs(d)) // 60}:{int(abs(d)) % 60:02d}"

    # per-cell run lists over usable frames, flicker (1-frame runs) and X removed
    T = [x[0] for x in usable]
    F = [x[1] for x in usable]
    S = [x[2] for x in usable]
    runs = {}
    for r in range(34):
        for c in range(36):
            seq = [(i, S[i][r][c]) for i in range(len(S))]
            rl = []
            for i, st in seq:
                if st == "X":
                    continue
                if rl and rl[-1][0] == st:
                    rl[-1][2] = i
                    rl[-1][3] += 1
                else:
                    rl.append([st, i, i, 1])
            # drop 1-frame flickers, then merge
            rl = [x for x in rl if x[3] >= 2]
            m = []
            for x in rl:
                if m and m[-1][0] == x[0]:
                    m[-1][2] = x[2]; m[-1][3] += x[3]
                else:
                    m.append(list(x))
            runs[(c, r)] = m

    def state_at(c, r, i):
        for st, a, b, _ in runs[(c, r)]:
            if a <= i <= b:
                return st
        return None

    anomalies, ignitions = [], []
    for (c, r), rl in runs.items():
        for k in range(1, len(rl)):
            prev, cur = rl[k - 1], rl[k]
            i = cur[1]
            ev = {"cell": label(c, r), "t": T[i], "game": gclock(T[i]), "from": NAMES[prev[0]], "to": NAMES[cur[0]],
                  "prev_seconds": prev[3], "gap_seconds": T[i] - T[prev[2]], "frame_before": F[prev[2]], "frame_after": F[i],
                  "prev_prev": NAMES[rl[k - 2][0]] if k >= 2 else None, "next": NAMES[rl[k + 1][0]] if k + 1 < len(rl) else None}
            kind = None
            if prev[0] == "B" and cur[0] == "O":
                kind = "BLUE_TO_FIRE"
            elif prev[0] == "B" and cur[0] == "K":
                kind = "BLUE_TO_BURNT"
            elif prev[0] == "K":
                kind = "BURNT_CHANGED"
            elif prev[0] == "O" and cur[0] == "G":
                kind = "FIRE_TO_GREEN"
            elif prev[0] == "G" and cur[0] == "K":
                kind = "BURNT_NO_FIRE"
            if prev[0] == "G" and cur[0] == "O":
                ignitions.append((c, r, i, T[i] - T[prev[2]]))
            if kind:
                ev["kind"] = kind
                anomalies.append(ev)
    # fire spread checks
    for c, r, i, gap in ignitions:
        t = T[i]
        lo = next(j for j in range(len(T)) if T[j] >= t - 25)
        orth, diag = [], []
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                if not (dc or dr):
                    continue
                cc, rr = c + dc, r + dr
                if not (0 <= cc < 36 and 0 <= rr < 34) or area(cc, rr) != area(c, r):
                    continue
                burning = any(state_at(cc, rr, j) == "O" for j in range(lo, i))
                if burning:
                    (diag if dc and dr else orth).append((cc, rr, dc, dr))
        ev = {"cell": label(c, r), "t": t, "game": gclock(t), "gap_seconds": gap, "frame_before": F[max(i - 1, 0)], "frame_after": F[i]}
        if orth:
            continue
        if diag:
            walled = [d for d in diag if state_at(c + d[2], r, i - 1) == "B" and state_at(c, r + d[3], i - 1) == "B"]
            if walled:
                ev.update(kind="DIAG_PAST_WATER", via=[label(d[0], d[1]) for d in walled])
                anomalies.append(ev)
            continue
        ev["kind"] = "JUMP"
        if live is not None:
            gs = t - live
            ev["near_new_fire_minute"] = gs < 20 or (gs % 120) < 20 or (gs % 120) > 110
        anomalies.append(ev)
    anomalies.sort(key=lambda e: e["t"])
    team = lambda c, r: 1 + (c >= 18) + 2 * (r >= 17)
    per_team = {}
    for c, r, i, gap in ignitions:
        if live is None:
            continue
        m = int((T[i] - live) // 60)
        per_team.setdefault(m, Counter())[team(c, r)] += 1
    spont = {}
    for e in anomalies:
        if e["kind"] == "JUMP":
            col = next(k for k, n in enumerate(COLS) if e["cell"].startswith(n) and e["cell"][len(n):].isdigit())
            row = int(e["cell"][len(COLS[col]):]) - 1
            spont.setdefault(e["game"], Counter())[team(col, row)] += 1
    seen_frames = Counter(a for x in timeline for a in x[3])
    json.dump({"frames": len(timeline), "usable": len(usable),
               "unusable_frames": [x[1] for x in timeline if x[2] is None],
               "ignitions": len(ignitions), "area_frames": {f"team{a + 1}": n for a, n in sorted(seen_frames.items())},
               "ignitions_per_team_per_minute": {m: dict(sorted(v.items())) for m, v in sorted(per_team.items())},
               "spontaneous_fires_per_team": {k: dict(sorted(v.items())) for k, v in spont.items()},
               "anomalies": anomalies}, open(os.path.join(odir, "anomalies.json"), "w"), indent=1)
    json.dump({"t": T, "files": F, "states": ["".join("".join(row) for row in s) for s in S]},
              open(os.path.join(odir, "timeline.json"), "w"))
    print(Counter(a["kind"] for a in anomalies), "ignitions", len(ignitions))


if __name__ == "__main__":
    main()
