"""Copy the live board's ids from board/board.json into kit/board.json and referee/config/layout.json.
Run after every board rebuild, and after a game in which the referee recreated items:
    python3 board/build/sync_ids.py [--root DIR]

First merges referee/state/live-ids.json (written by the referee whenever it recreates a fixture or a
square, and by `reset`) into board/board.json fixtures/cells, so agents never peek at a replaced id.
It is skipped when it belongs to another board or is older than the last board build."""
import json, pathlib, sys
from datetime import datetime

root = pathlib.Path(__file__).resolve().parents[2]
if "--root" in sys.argv:
    root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1]).resolve()

board_path = root / "board/board.json"
b = json.loads(board_path.read_text())


def when(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


live_path = root / "referee/state/live-ids.json"
if live_path.exists():
    live = json.loads(live_path.read_text())
    built, updated = when(b.get("builtAt")), when(live.get("updatedAt"))
    if live.get("boardId") and live["boardId"] != b.get("boardId"):
        print(f"live ids skipped: they are for board {live['boardId']}, board.json is {b.get('boardId')}")
    elif built and updated and built.tzinfo and updated.tzinfo and updated < built:
        print(f"live ids skipped: written {live['updatedAt']}, before the board was built ({b['builtAt']})")
    else:
        fixtures = {k: v for k, v in (live.get("fixtures") or {}).items() if k in b["fixtures"] and v}
        cells = {k: v for k, v in (live.get("cells") or {}).items() if k in b["cells"] and v}
        changed = [k for k, v in fixtures.items() if b["fixtures"][k] != v] + [k for k, v in cells.items() if b["cells"][k] != v]
        b["fixtures"].update(fixtures)
        b["cells"].update(cells)
        if changed:
            b["liveIdsMergedAt"] = live.get("updatedAt")
            board_path.write_text(json.dumps(b, indent=2, ensure_ascii=False) + "\n")
        print(f"live ids merged from {live_path.relative_to(root)}: {len(changed)} changed ({' '.join(changed[:12])}{' ...' if len(changed) > 12 else ''})")

kit_path = root / "kit/board.json"
kit = json.loads(kit_path.read_text())
kit["boardUrl"], kit["boardId"] = b["boardUrl"], b["boardId"]
kit["frames"] = b["frames"]
for k, v in b["fixtures"].items():
    kit["fixtures"][k]["id"] = v
for t, v in b["orders"].items():
    kit["orders"][t]["id"] = v
kit["cells"] = b["cells"]
kit["note"] = ("Geometry and colors come from SPEC.md and never change. Ids (frames, fixtures, orders, cells) are copied "
               "from board/board.json by board/build/sync_ids.py. If an id is missing, find the item by reading a scope box.")
kit_path.write_text(json.dumps(kit, indent=2, ensure_ascii=False) + "\n")

layout = {
    "boardId": b["boardId"],
    "builtAt": b["builtAt"],
    "note": "Ids of the MCP-built board, copied from board/board.json by board/build/sync_ids.py. Rebuilding changes every id.",
    "frames": b["frames"],
    "orders": b["orders"],
    "fixtures": b["fixtures"],
    "static": b["static"],
    "cells": b["cells"],
}
(root / "referee/config/layout.json").write_text(json.dumps(layout, indent=2) + "\n")
print(f"synced: {len(b['frames'])} frames, {len(b['cells'])} cells, {len(b['static'])} static, orders {list(b['orders'])}")
