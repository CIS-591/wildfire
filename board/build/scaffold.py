L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def col(c): return L[c] if c < 26 else L[c//26-1] + L[c%26]
T = {"ridge": "#b384bb", "pine": "#ea94bb", "cedar": "#7b92ff", "birch": "#ffffff"}
RIM = "#262a33"; PANEL = "#262a33"; INK = "#1a1a1a"; ORANGE = "#ff9d48"; LIGHT = "#e7e7e7"
o = ['<svg xmlns="http://www.w3.org/2000/svg">']
a = o.append
# rim around the grid (does not overlap the band frames)
a(f'<rect id="rimT" x="-74" y="-74" width="2448" height="72" fill="{RIM}" stroke="none"/>')
a(f'<rect id="rimB" x="-74" y="2174" width="2448" height="72" fill="{RIM}" stroke="none"/>')
a(f'<rect id="rimL" x="-74" y="-2" width="72" height="2176" fill="{RIM}" stroke="none"/>')
a(f'<rect id="rimR" x="2302" y="-2" width="72" height="2176" fill="{RIM}" stroke="none"/>')
F = 'font-family="roboto_condensed" font-size="26" font-weight="bold" text-anchor="middle"'
for c in range(36):
    x = c*64+30
    a(f'<text x="{x}" y="-28" {F} fill="{T["ridge"] if c<18 else T["pine"]}">{col(c)}</text>')
    a(f'<text x="{x}" y="2220" {F} fill="{T["cedar"] if c<18 else T["birch"]}">{col(c)}</text>')
for r in range(34):
    y = r*64+39
    a(f'<text x="-38" y="{y}" {F} fill="{T["ridge"] if r<17 else T["cedar"]}">{r+1}</text>')
    a(f'<text x="2338" y="{y}" {F} fill="{T["pine"] if r<17 else T["birch"]}">{r+1}</text>')
# 9 band frames, no title
for b in range(9):
    rows = min(4, 34-b*4)
    a(f'<g id="band{b}" transform="translate(-2,{b*256-2})" data-frame=""><rect data-type="frame" x="0" y="0" width="2304" height="{rows*64}" fill="#3d4250"/></g>')
# title
a(f'<textArea id="title" x="0" y="-330" width="460" font-family="titan_one" font-size="60" fill="{ORANGE}">WILDFIRE</textArea>')
a(f'<text id="subtitle" x="480" y="-276" font-family="roboto_condensed" font-size="28" fill="#595959">CIS 591 · four teams, one forest, one fire. Hold the line.</text>')
# compass / wind rose left of the banner
a(f'<circle id="rose" cx="-90" cy="-165" r="85" fill="{PANEL}" stroke="{ORANGE}" stroke-width="3"/>')
a(f'<rect id="roseV" data-shape="rhombus" x="-100" y="-212" width="20" height="94" fill="{ORANGE}" stroke="none"/>')
a(f'<rect id="roseH" data-shape="rhombus" x="-137" y="-175" width="94" height="20" fill="#ffdc4a" stroke="none"/>')
CF = 'font-family="roboto_condensed" font-size="18" font-weight="bold" text-anchor="middle"'
a(f'<text x="-90" y="-226" {CF} fill="{ORANGE}">N</text>')
a(f'<text x="-90" y="-92" {CF} fill="#e7e7e7">S</text>')
a(f'<text x="-157" y="-159" {CF} fill="#e7e7e7">W</text>')
a(f'<text x="-23" y="-159" {CF} fill="#e7e7e7">E</text>')
# fixtures
a(f'<rect id="banner" x="0" y="-220" width="1100" height="110" rx="12" fill="{INK}" stroke="{ORANGE}" stroke-width="4" data-content="WILDFIRE · waiting for the referee" data-font-family="roboto_condensed" data-font-size="36" data-font-weight="bold" data-text-color="#ffdc4a"/>')
a(f'<rect id="scoreboard" x="1160" y="-220" width="1140" height="110" rx="12" fill="{INK}" stroke="{ORANGE}" stroke-width="4" data-content="RIDGE 100% · PINE VALLEY 100% · CEDAR CREEK 100% · BIRCH HOLLOW 100%" data-font-family="roboto_condensed" data-font-size="30" data-font-weight="bold" data-text-color="#ffffff"/>')
# rules panel
x0, y0 = 2440, -330
a(f'<rect id="rulesPanel" x="{x0}" y="{y0}" width="760" height="610" rx="16" fill="{PANEL}" stroke="none"/>')
a(f'<text id="rulesHead" x="{x0+32}" y="{y0+52}" font-family="roboto_condensed" font-size="33" font-weight="bold" fill="{ORANGE}">RULES</text>')
rules = ("<b>Fire</b> spreads every 20 s, faster downwind. Embers can jump a 1-wide firebreak. Wind turns every 5 min. Lightning strikes a few times: watch the banner.<br/>"
 "<b>Paint</b> only your sector, after a teammate approves your PLAN. One paint per player every 5 s.<br/>"
 "<b>Water</b> on fire, forest or cabin. Dries in 90 s. One shared pool for the whole class (count on the banner).<br/>"
 "<b>Firebreak</b> on forest. Permanent.<br/>"
 "<b>Backburn</b>: an approved run of up to 20 forest squares, painted burnt.<br/>"
 "<b>HELP</b>: 2 players of another team may paint your sector for 3 min.<br/>"
 "<b>Approve</b> a teammate's sticky: add a line YES or NO.<br/>"
 "<b>Score</b>: forest + water + 10 per cabin, as % of the start. 30 min. Highest % wins.")
a(f'<textArea id="rulesText" x="{x0+32}" y="{y0+68}" width="440" font-family="roboto_condensed" font-size="21" fill="{LIGHT}">{rules}</textArea>')
lx = x0+500
a(f'<text id="legendHead" x="{lx}" y="{y0+52}" font-family="roboto_condensed" font-size="33" font-weight="bold" fill="{ORANGE}">LEGEND</text>')
legend = [("#93d275","Forest"),("#f5d128","Cabin (10 pts)"),("#414bb2","River"),("#ff9d48","Fire"),("#23bfe7","Water (90 s)"),("#8b5a2b","Firebreak"),("#1a1a1a","Burnt")]
for i,(h,n) in enumerate(legend):
    y = y0+84+i*40
    st = 'stroke="#595959" stroke-width="2"' if h == "#1a1a1a" else 'stroke="none"'
    a(f'<rect x="{lx}" y="{y}" width="32" height="32" rx="4" fill="{h}" {st}/>')
    a(f'<text x="{lx+44}" y="{y+24}" font-family="roboto_condensed" font-size="22" fill="#ffffff">{n}</text>')
a(f'<text x="{lx}" y="{y0+392}" font-family="roboto_condensed" font-size="18" font-weight="bold" fill="{ORANGE}">SECTORS</text>')
for i,(k,n) in enumerate([("ridge","RIDGE"),("pine","PINE VALLEY"),("cedar","CEDAR CREEK"),("birch","BIRCH HOLLOW")]):
    bx = lx + (i%2)*116; by = y0+404 + (i//2)*66
    a(f'<rect x="{bx}" y="{by}" width="110" height="60" rx="6" fill="{T[k]}" stroke="none" data-content="{n}" data-font-family="roboto_condensed" data-font-size="14" data-font-weight="bold" data-text-color="{INK}"/>')
a(f'<textArea x="{lx}" y="{y0+540}" width="250" font-family="roboto_condensed" font-size="16" fill="#b0b0b0">Square borders show the sector. Fire starts at R17 S17 R18 S18.</textArea>')
# leaderboard panel + fixture
x1 = 3240
a(f'<rect id="lbPanel" x="{x1}" y="{y0}" width="760" height="610" rx="16" fill="{PANEL}" stroke="none"/>')
a(f'<text id="lbHead" x="{x1+32}" y="{y0+52}" font-family="roboto_condensed" font-size="33" font-weight="bold" fill="{ORANGE}">LEADERBOARD · live</text>')
a(f'<rect id="leaderboard" x="{x1+32}" y="{y0+76}" width="696" height="502" rx="8" fill="{INK}" stroke="none" data-content="No players yet. /join to enter the fight." data-font-family="roboto_condensed" data-font-size="22" data-text-color="{LIGHT}" data-text-align="left" data-text-align-vertical="top"/>')
# orders frames 2x2
ex = {"ridge":"EXAMPLE · a PLAN sticky looks like: PLAN hold the east edge with water, firebreak column P",
      "pine":"EXAMPLE · a PLAN sticky looks like: PLAN hold the west edge with water, firebreak column U",
      "cedar":"EXAMPLE · a PLAN sticky looks like: PLAN hold the east edge with water, firebreak column P",
      "birch":"EXAMPLE · a PLAN sticky looks like: PLAN hold the west edge with water, firebreak column U"}
for k,n,x,y in [("ridge","RIDGE",2440,340),("pine","PINE VALLEY",3240,340),("cedar","CEDAR CREEK",2440,1300),("birch","BIRCH HOLLOW",3240,1300)]:
    a(f'<g id="orders_{k}" transform="translate({x},{y})" data-frame="ORDERS · {n}"><rect data-type="frame" x="0" y="0" width="760" height="900" fill="{PANEL}"/>')
    a(f'<rect id="ordersHead_{k}" x="0" y="0" width="760" height="72" fill="{T[k]}" stroke="none" data-content="ORDERS · {n}" data-font-family="roboto_condensed" data-font-size="33" data-font-weight="bold" data-text-color="{INK}"/>')
    a(f'<textArea id="ordersHint_{k}" x="24" y="88" width="712" font-family="roboto_condensed" font-size="22" fill="{LIGHT}">Boss posts PLAN, ORDER · name, BACKBURN P6-P15 and STATUS here. HELP goes in a neighbour\'s frame. A teammate approves by adding a line YES or NO.</textArea>')
    a(f'<rect id="example_{k}" data-type="sticky" x="24" y="176" width="199" height="228" data-color="light_yellow" data-content="{ex[k]}"/>')
    a('</g>')
# inbox panel
a(f'<rect id="inboxPanel" x="0" y="2300" width="4000" height="1500" rx="16" fill="{PANEL}" stroke="none"/>')
a(f'<text id="inboxHead" x="32" y="2362" font-family="roboto_condensed" font-size="33" font-weight="bold" fill="{ORANGE}">INBOX · one card per player · read only your own</text>')
a(f'<text id="inboxHint" x="900" y="2360" font-family="roboto_condensed" font-size="18" fill="#b0b0b0">/join Your Name creates your card here. The referee writes your team, role and every refusal on it.</text>')
a('</svg>')
open("scaffold.svg","w").write("\n".join(o))
