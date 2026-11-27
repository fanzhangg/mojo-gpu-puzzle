# Kernel Flow

Visual explanations of the Mojo GPU puzzles, one puzzle at a time:
**https://fanzhangg.github.io/mojo-gpu-puzzle/**

Each puzzle page shows the task, the one idea that makes the solution work, and a diagram of the
reference solution (`solutions/`) next to its code. The diagram follows **one output** (or one thread):
you click a cell, and it shows only the data that cell depends on, instead of drawing every thread's
copy of the same pattern. It steps through the **stages of the algorithm** (load, wait, compute,
write), not through lines of code; the code panel highlights the lines of the current stage.

Every diagram is designed against one question: *would a GPU beginner understand this algorithm better
with the picture than without it?*

## Puzzles

Available now, in English and Chinese: 01 Map, 02 Zip, 03 Guards, 04 2D Map, 05 Broadcast, 06 Blocks,
07 2D Blocks, 08 Shared Memory, 11 Pooling, 12 Dot Product, 13 1D Convolution (and its block-boundary
version), 15 Axis Sum. Coming next: 14 Prefix Sum, 16 Matrix Multiplication, and the warp and block
puzzles 24–27.

Puzzles about debugging, profiling, MAX integration and hardware details (09–10, 17–23, 28–35) are left
out: they are not about how an algorithm moves data.

## How it is built

- `src/puzzles/pXX.js`: one file per puzzle. Each stage is a function of the selected cell that returns
  a *scene* (rows of cells, arrows, a caption and a worked formula with the real numbers).
- `src/components/Scene.tsx` draws a scene; `Code.tsx` shows the solution kernel.
- `scripts/gen_kernels.py` copies each puzzle's kernel from `solutions/` into `src/kernels.json`.
- `test/puzzles.test.mjs` checks every puzzle against the real solution: the numbers a diagram shows
  must equal what the kernel computes (using the simulator in `test/oracle/`), every arrow must point at
  a cell that exists, and every highlighted line must be in the kernel.

```sh
npm install
npm run kernels   # refresh src/kernels.json from solutions/
npm test
npm run dev       # live preview
npm run build     # writes kernel-flow.html (also deployed to GitHub Pages on push)
```

React + TypeScript with [shadcn/ui](https://ui.shadcn.com), bundled by Vite into one HTML file.
