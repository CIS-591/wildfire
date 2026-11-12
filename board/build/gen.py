import json, sys
OUT = sys.argv[1]
L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def col(c): return L[c] if c < 26 else L[c//26-1] + L[c%26]
def lab(c, r): return f"{col(c)}{r+1}"
TEAM = {"ridge": "#b384bb", "pine": "#ea94bb", "cedar": "#7b92ff", "birch": "#ffffff"}
def sector(c, r):
    return ("ridge" if c < 18 else "pine") if r < 17 else ("cedar" if c < 18 else "birch")
FOREST, CABIN, RIVER, FIRE = "#93d275", "#f5d128", "#414bb2", "#ff9d48"
cab = set()
for c, r in [(4, 4), (12, 12)]:
    for cc, rr in [(c, r), (35-c, r), (c, 33-r), (35-c, 33-r)]: cab.add((cc, rr))
riv = set()
for r in list(range(3, 12)) + list(range(22, 31)):
    riv.add((9, r)); riv.add((26, r))
fire = {(17, 16), (18, 16), (17, 17), (18, 17)}
def fill(c, r):
    if (c, r) in fire: return FIRE
    if (c, r) in cab: return CABIN
    if (c, r) in riv: return RIVER
    return FOREST
cells = {}
for r in range(34):
    for c in range(36):
        cells[lab(c, r)] = {"col": c, "row": r, "fill": fill(c, r), "stroke": TEAM[sector(c, r)], "sector": sector(c, r)}
json.dump(cells, open(f"{OUT}/cells.json", "w"))
# one file per band: children of the frame (frame-relative coords)
for b in range(9):
    r0 = b*4
    lines = []
    for r in range(r0, min(r0+4, 34)):
        row = []
        for c in range(36):
            k = lab(c, r); d = cells[k]
            tc = ' data-text-color="#ffffff"' if d["fill"] == RIVER else ''
            row.append(f'<rect x="{c*64+2}" y="{(r-r0)*64+2}" width="60" height="60" fill="{d["fill"]}" stroke="{d["stroke"]}" stroke-width="3" data-content="{k}" data-font-size="20"{tc}/>')
        lines.append("".join(row))
    open(f"{OUT}/band{b}.txt", "w").write("\n".join(lines))
print(sum(1 for _ in cells), [k for k, v in cells.items() if v["fill"] != FOREST])
