#!/usr/bin/env python3
"""Close-up strips for frame_audit.py events: the 9 x 9 squares around the cell, 3 frames before to 3 after.

Usage: frame_crops.py <frames dir> <audit dir>  (writes <audit dir>/crops/<n>.png and events.json)"""
import json, os, sys
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
import frame_audit as fa

FD, AD = sys.argv[1], sys.argv[2]
LIVE = float(os.environ.get("LIVE_START", "1794932823"))


def cell_rc(name):
    for k in range(len(fa.COLS) - 1, -1, -1):
        n = fa.COLS[k]
        if name.startswith(n) and name[len(n):].isdigit():
            return k, int(name[len(n):]) - 1


def crop(f, c, r, R=4):
    im = np.asarray(Image.open(os.path.join(FD, f)).convert("RGB"))
    near = fa.fill_near(im)
    a = (c >= 18) + 2 * (r >= 17)
    col, tol, c0, r0 = fa.AREAS[a]
    box = fa.find_area(im, col, tol, near)
    if not box:
        return None
    x0, y0, pw, ph = box
    cx, cy = x0 + (c - c0 + 0.5) * pw, y0 + (r - r0 + 0.5) * ph
    x1, y1 = int(cx - (R + 0.5) * pw), int(cy - (R + 0.5) * ph)
    x2, y2 = int(cx + (R + 0.5) * pw), int(cy + (R + 0.5) * ph)
    img = Image.fromarray(im).crop((x1, y1, x2, y2)).resize((270, 270))
    d = ImageDraw.Draw(img)
    s = 270 / (2 * R + 1)
    d.rectangle((R * s, R * s, (R + 1) * s, (R + 1) * s), outline=(255, 0, 255), width=3)
    return img


def job(args):
    n, ev, frames = args
    c, r = cell_rc(ev["cell"])
    W = Image.new("RGB", (280 * len(frames), 300), "white")
    d = ImageDraw.Draw(W)
    for k, (t, f) in enumerate(frames):
        im = crop(f, c, r)
        if im is not None:
            W.paste(im, (280 * k, 28))
        g = int(t - LIVE)
        d.text((280 * k + 4, 4), f"{'-' if g < 0 else ''}{abs(g) // 60}:{abs(g) % 60:02d}  {f}" + ("  <- change" if f == ev["frame_after"] else ""), fill=(0, 0, 0))
    p = os.path.join(AD, "crops", f"{n:03d}.png")
    W.save(p)
    return p


if __name__ == "__main__":
    a = json.load(open(os.path.join(AD, "anomalies.json")))
    tl = json.load(open(os.path.join(AD, "timeline.json")))
    T, F = tl["t"], tl["files"]
    os.makedirs(os.path.join(AD, "crops"), exist_ok=True)
    evs = [e for e in a["anomalies"] if e["t"] >= LIVE - 120]
    jobs = []
    for n, e in enumerate(evs):
        i = F.index(e["frame_after"])
        jobs.append((n, e, [(T[j], F[j]) for j in range(max(0, i - 3), min(len(F), i + 4))]))
    with Pool() as p:
        paths = p.map(job, jobs, chunksize=2)
    for e, (n, _, _), pth in zip(evs, jobs, paths):
        e["id"], e["crop"] = n, pth
    json.dump(evs, open(os.path.join(AD, "events.json"), "w"), indent=1)
    print(len(evs), "strips")
