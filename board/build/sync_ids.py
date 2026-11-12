"""Copy the live board's ids from board/board.json into kit/board.json and referee/config/layout.json.
Run after every board rebuild: python3 board/build/sync_ids.py"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parents[2]
b = json.loads((root / "board/board.json").read_text())

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
