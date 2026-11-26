# Kernel Flow

A browser visualizer for the kernels in these puzzles, built for people new to Mojo and GPU programming.
Open `kernel-flow.html` directly in a browser (no server or GPU needed), pick an example or paste a kernel,
and follow one thread through it, tick by tick.

- **Values filled in**: every line a thread runs is shown again with each variable replaced by its value,
  labelled with where it came from (`4 × 1 + 2 = 6` over `block_dim.x`, `block_idx.x`, `thread_idx.x`).
- **Follow one thread**: one thread is followed by default; the Story tab explains in plain words what it did
  and what the other threads were doing at the same time.
- **What each thread is doing**: running, waiting at `barrier()`, masked because its `if` was false, or finished.
  Each thread chip also shows the index it computes (`↦6`).
- **Linked highlighting**: hover a thread to see every cell it touches, hover a cell to see which threads touch it.
- **Whole-run view and traffic score**: every read and write at once, plus global and shared memory traffic
  per thread, in the style of [srush/GPU-Puzzles](https://github.com/srush/GPU-Puzzles).
- **Checks**: out-of-bounds access, data races, barrier divergence, uninitialized shared reads, writes to
  `mut=False` buffers, and `expect` lines in the launch settings.

It interprets a subset of Mojo in JavaScript, running all threads in lockstep (one statement per tick). It
supports `Pointer` / `TileTensor` / `LayoutTensor` indexing, `stack_allocation` shared memory, `barrier()`,
`if` / `for` / `while` and `print`, which covers roughly p01–p14. Warp ops, `.tile[]`, slicing and async copies
are not supported.

## Development

The UI is React + TypeScript with [shadcn/ui](https://ui.shadcn.com) components (Radix + Tailwind), bundled by
Vite into the single file `kernel-flow.html`.

```sh
npm install
npm run presets   # regenerate src/presets.json from your solutions in ../../problems
npm run dev       # live dev server
npm test          # run every preset through the engine
npm run build     # type-check, build, and update kernel-flow.html
```

To add a puzzle you have solved, add an entry to `PRESETS` in `scripts/gen_presets.py`, then run
`npm run presets && npm run build`. shadcn components live in `src/components/ui`; add more with
`npx shadcn@latest add <component>` (configured by `components.json`).

| Path | What it is |
| --- | --- |
| `src/engine/engine.js` | Tokenizer, parser and SIMT interpreter (no DOM). Records every memory access and an expression breakdown for each step. |
| `src/lib/model.ts` | Derived views: memory at a tick, thread states, index variables, linked-highlight maps, narration. |
| `src/components/` | Page components (`Stage`, `CodePanel`, `Transport`, `Panels`, `Breakdown`) and `ui/` (shadcn). |
| `scripts/` | Preset generator and the post-build copy step. |
| `test/engine.test.mjs` | Engine tests. |
