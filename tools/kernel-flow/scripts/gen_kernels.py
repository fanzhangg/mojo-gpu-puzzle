#!/usr/bin/env python3
"""Copy each visualized puzzle's solution kernel from solutions/ into src/kernels.json.

The page shows the kernel exactly as written in the reference solution, from its `def` line to the
end of its body.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
OUT = HERE.parent / "src" / "kernels.json"

# puzzle id -> (solution file, kernel function name)
KERNELS = {
    "p01": ("p01/p01.mojo", "add_10"),
    "p02": ("p02/p02.mojo", "add"),
    "p03": ("p03/p03.mojo", "add_10_guard"),
    "p04": ("p04/p04_tile_tensor.mojo", "add_10_2d"),
    "p05": ("p05/p05.mojo", "broadcast_add"),
    "p06": ("p06/p06.mojo", "add_10_blocks"),
    "p07": ("p07/p07.mojo", "add_10_blocks_2d"),
    "p08": ("p08/p08.mojo", "add_10_shared_tile_tensor"),
    "p11": ("p11/p11.mojo", "pooling"),
    "p12": ("p12/p12.mojo", "dot_product"),
    "p13": ("p13/p13.mojo", "conv_1d_simple"),
    "p13b": ("p13/p13.mojo", "conv_1d_block_boundary"),
    "p14": ("p14/p14.mojo", "prefix_sum_simple"),
    "p14b": ("p14/p14.mojo", ["prefix_sum_local_phase", "prefix_sum_block_sum_phase"]),
    "p15": ("p15/p15.mojo", "axis_sum"),
    "p16": ("p16/p16.mojo", "naive_matmul"),
    "p16s": ("p16/p16.mojo", "single_block_matmul"),
    "p16t": ("p16/p16.mojo", "matmul_tiled"),
    "p24": ("p24/p24.mojo", "simple_warp_dot_product"),
    "p25": ("p25/p25.mojo", "neighbor_difference"),
    "p25b": ("p25/p25.mojo", "basic_broadcast"),
    "p26": ("p26/p26.mojo", "butterfly_parallel_max"),
    "p26b": ("p26/p26.mojo", "warp_inclusive_prefix_sum"),
    "p27": ("p27/p27.mojo", "block_sum_dot_product"),
    "p27b": ("p27/p27.mojo", "block_normalize_vector"),
}


def kernel_source(path: str, name: str) -> str:
    lines = (ROOT / "solutions" / path).read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if re.match(rf"def {name}\b", l))
    end = start + 1
    while end < len(lines):
        l = lines[end]
        # the body ends at the next top-level statement or anchor comment
        if l and not l[0].isspace() and not l.startswith(")") and not l.startswith("]"):
            break
        end += 1
    body = lines[start:end]
    while body and not body[-1].strip():
        body.pop()
    return "\n".join(body) + "\n"


def main():
    out = {}
    for pid, (path, names) in KERNELS.items():
        names = [names] if isinstance(names, str) else names
        out[pid] = {"file": f"solutions/{path}", "kernel": " + ".join(names), "code": "\n\n".join(kernel_source(path, n).rstrip("\n") for n in names) + "\n"}
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print("wrote", OUT, "with", ", ".join(out))


if __name__ == "__main__":
    main()
