# Kernel Flow

A minimal picture of how data flows through a GPU kernel from these puzzles: the source on the left,
and on the right one diagram in the style of [srush/GPU-Puzzles](https://github.com/srush/GPU-Puzzles):
input buffers on top, threads grouped by block (with their shared memory) in the middle, outputs at the
bottom. Blue arrows read memory, orange arrows write it, purple arrows pass values between threads (warp
shuffles and reductions). A slider steps through only the moments when data moves and the `barrier()`
releases; the caption shows the line being run with one thread's values filled in.

Pick a puzzle's reference solution (`solutions/`), then the kernel inside it, or paste your own code. Grid, block size and inputs are read from the file's `main()`; Edit shows and changes them.

## Two ways to open it

- **`kernel-flow.html`**: open it in a browser. Everything is simulated in the page; the solutions are
  bundled as they were at the last build.
- **Local server** (reads files live from disk and runs them on your GPU):

  ```sh
  python3 tools/kernel-flow/server.py      # http://127.0.0.1:8765
  ```

  "Run" executes `pixi run mojo -I . <file> <flag>` on this machine and shows the real output. The
  command-line flag (`--tiled`, `--simple`, ...) that launches the selected kernel is picked from `main()`.
  You can also run it under `compute-sanitizer` (memcheck, racecheck, synccheck, initcheck). The server only
  listens on 127.0.0.1 and rejects requests from other sites, but it does run whatever code the page sends,
  so do not expose it to a network.

## What the simulator covers

The diagram comes from a JavaScript interpreter for the Mojo used in these puzzles, running every thread in
lockstep. It covers `Pointer` / `TileTensor` / `LayoutTensor` indexing, `.tile[]` views, `load` / `store`,
`stack_allocation` shared memory, `barrier()`, `comptime for` / `if`, kernel compile-time parameters,
`copy_dram_to_sram_async`, and warp / block collectives (`lane_id`, `shuffle_down/up/xor/idx`,
`broadcast`, `warp.sum`, `prefix_sum`, `block.sum/prefix_sum/broadcast`). That is 41 of the 52 kernels in
`solutions/` (`npm test` checks this). Not simulated: nested functions (p23, p24 functional), mbarriers
(p29 double buffering), clusters (p34), SIMD vector loads (p35), tensor cores (p33), and launches over
1024 threads (p28). For those, the server's real GPU run still works.

## Development

The UI is React + TypeScript with [shadcn/ui](https://ui.shadcn.com) components (Radix + Tailwind), bundled by
Vite into the single file `kernel-flow.html`.

```sh
npm install
npm run presets   # re-bundle solutions/ into src/library.json
npm run dev       # live dev server
npm test          # run every preset through the engine
npm run build     # type-check, build, and update kernel-flow.html
```

After editing puzzle files, run `npm run presets && npm run build` to refresh the bundled copy (the
local server always reads the files live). shadcn components live in `src/components/ui`; add more with
`npx shadcn@latest add <component>` (configured by `components.json`).

| Path | What it is |
| --- | --- |
| `src/engine/engine.js` | Tokenizer, parser and SIMT interpreter (no DOM). Records every memory access and an expression breakdown for each step. |
| `src/lib/model.ts` | Derived views: frames (ticks where data moves), memory at a tick, thread states. |
| `src/components/` | `Flow` (the diagram), `CodeView`, `Breakdown` (a line with values filled in) and `ui/` (shadcn). |
| `server.py` | Local server: serves the page, reads puzzle files, runs them on the GPU. Python standard library only. |
| `scripts/` | Preset generator and the post-build copy step. |
| `test/engine.test.mjs` | Engine tests. |
