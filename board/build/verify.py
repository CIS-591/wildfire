import json, re
S=json.load(open("ids_scaffold.json")); F=S["frames"]
exp=json.load(open("cells.json"))
cells={}; perframe={f:0 for f in F}; problems=[]
for fn in ["rf1.json","rf2.json","rf3.json"]:
    d=json.load(open(fn)); print(fn, d["message"])
    svg=d["svg"]; cur=None; tx=ty=0
    for line in svg.splitlines():
        m=re.match(r'<g id="m(\d+)".*transform="translate\((-?\d+),(-?\d+)\)"',line)
        if m: cur=m.group(1); tx,ty=int(m.group(2)),int(m.group(3)); continue
        if line.startswith('</g>'): cur=None; continue
        m=re.search(r'data-miro-id="(\d+)" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" data-content="([^"]*)" fill="(#[0-9a-f]+)"',line)
        if not m: continue
        mid,x,y,w,h,lab,fill=m.groups()
        st=re.search(r'stroke="(#[0-9a-f]+)" stroke-width="([\d.]+)"',line)
        fs=re.search(r'data-font-size="(\d+)"',line)
        perframe[cur]+=1
        e=exp.get(lab)
        if not e: problems.append(("unknown",lab)); continue
        ax,ay=float(x)+tx,float(y)+ty
        if lab in cells: problems.append(("dup",lab))
        cells[lab]=mid
        GAP=64  # the gap between the team areas (referee/src/layout.ts GAP)
        if (ax,ay)!=(e["col"]*64+(GAP if e["col"]>=18 else 0),e["row"]*64+(GAP if e["row"]>=17 else 0)): problems.append(("pos",lab,ax,ay))
        if F.index(cur)!=e["row"]//4: problems.append(("frame",lab))
        if fill!=e["fill"]: problems.append(("fill",lab,fill))
        if not st or st.group(1)!=e["stroke"] or st.group(2)!="3": problems.append(("stroke",lab,st and st.groups()))
        if (w,h)!=("60","60"): problems.append(("size",lab,w,h))
        if not fs or fs.group(1)!="20": problems.append(("font",lab))
print("cells",len(cells),"missing",[k for k in exp if k not in cells][:10])
print("per frame",[perframe[f] for f in F])
print("problems",len(problems),problems[:10])
json.dump(cells,open("cells_ids.json","w"))
