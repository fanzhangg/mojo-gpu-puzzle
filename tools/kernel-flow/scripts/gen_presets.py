#!/usr/bin/env python3
"""Regenerate src/presets.json (test fixtures) and src/library.json (the solutions, bundled into the page)."""
import json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
SRC = HERE.parent / "src"

def anchor(path):
    """The whole solution file (the parser skips main() and anything else it does not need)."""
    return (ROOT / "solutions" / path).read_text()

L = lambda *lines: "grid  = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\n" + "\n".join(lines)
PRESETS = [
    ("p01", "p01 · Map", "p01/p01.mojo", L("output = zeros(SIZE)", "a = arange(SIZE)", "expect output = arange(SIZE) + 10")),
    ("p02", "p02 · Zip", "p02/p02.mojo", L("output = zeros(SIZE)", "a = arange(SIZE)", "b = arange(SIZE)", "expect output = a + b")),
    ("p03", "p03 · Guards", "p03/p03.mojo", L("output = zeros(SIZE)", "a = arange(SIZE)", "size_dev = SIZE", "expect output = arange(SIZE) + 10")),
    ("p04", "p04 · 2D map", "p04/p04.mojo", L("output = zeros(SIZE * SIZE)", "a = arange(SIZE * SIZE)", "size_dev = SIZE", "expect output = arange(SIZE * SIZE) + 10")),
    ("p04t", "p04 · 2D map (TileTensor)", "p04/p04_tile_tensor.mojo", L("output = zeros(SIZE * SIZE)", "a = arange(SIZE * SIZE)", "size_dev = SIZE", "expect output = arange(SIZE * SIZE) + 10")),
    ("p05", "p05 · Broadcast", "p05/p05.mojo", L("output = zeros(SIZE * SIZE)", "a = arange(SIZE) + 1", "b = arange(SIZE) * 10", "size_dev = SIZE", "expect output = [1, 2, 11, 12]")),
    ("p06", "p06 · Blocks", "p06/p06.mojo", L("output = zeros(SIZE)", "a = arange(SIZE)", "size_dev = SIZE", "expect output = arange(SIZE) + 10")),
    ("p07", "p07 · 2D blocks", "p07/p07.mojo", L("output = zeros(SIZE * SIZE)", "a = arange(SIZE * SIZE)", "size_dev = SIZE", "expect output = arange(SIZE * SIZE) + 10")),
    ("p08", "p08 · Shared memory", "p08/p08.mojo", L("output = zeros(SIZE)", "a = ones(SIZE)", "size_dev = SIZE", "expect output = fill(SIZE, 11)")),
]

def main():
    presets = [dict(id=i, title=t, code=anchor(f), launch=l) for i, t, f, l in PRESETS]
    p03 = presets[2]
    presets.append(dict(id="bug-guard", title="Demo · missing bounds guard",
        code=p03["code"].replace("    if i < size:\n        output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0",
                                 "    output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0"),
        launch=p03["launch"]))
    presets.append(json.loads((HERE / "demo_race.json").read_text()))
    (SRC / "presets.json").write_text(json.dumps(presets, indent=1, ensure_ascii=False) + "\n")
    print("wrote", SRC / "presets.json", len(presets), "presets")

    # Library: every reference solution in solutions/. The page loads these when no local server is running.
    files = [dict(path=str(f.relative_to(ROOT)), group="solutions", puzzle=f.parent.name, code=f.read_text())
             for f in sorted((ROOT / "solutions").glob("p*/*.mojo"))]
    (SRC / "library.json").write_text(json.dumps(files, ensure_ascii=False) + "\n")
    print("wrote", SRC / "library.json", len(files), "files")


if __name__ == "__main__":
    main()
