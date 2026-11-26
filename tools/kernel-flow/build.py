#!/usr/bin/env python3
"""Rebuild index.html from src/. Presets are regenerated from the solved puzzles in problems/."""
import json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = HERE / "src"

def anchor(path):
    src = (ROOT / "problems" / path).read_text()
    body = re.search(r"# ANCHOR: \w+\n(.*?)# ANCHOR_END", src, re.S).group(1)
    body = re.sub(r"\n[ \t]*# FILL ME IN.*", "", body)
    return re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"

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
    presets.append(dict(id="bug-guard", title="Demo · p03 without a guard",
        code=p03["code"].replace("    if i < size:\n        output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0",
                                 "    output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0"),
        launch=p03["launch"]))
    presets.append(json.loads((SRC / "demo_race.json").read_text()))
    js_presets = "const PRESETS = " + json.dumps(presets, indent=1, ensure_ascii=False) + ';\nif (typeof module !== "undefined") module.exports = PRESETS;\n'
    (SRC / "presets.js").write_text(js_presets)
    js = js_presets + "\n" + (SRC / "engine.js").read_text() + "\n" + (SRC / "ui.js").read_text()
    shell = (SRC / "shell.html").read_text()
    html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style>\n'
            '</head>\n<body>\n' + shell + "\n<script>\n" + js + "\n</script>\n</body>\n</html>\n")
    (HERE / "index.html").write_text(html)
    print("wrote", HERE / "index.html")

if __name__ == "__main__":
    main()
