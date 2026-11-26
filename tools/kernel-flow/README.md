# Kernel Flow

A browser visualizer for the kernels in these puzzles. Open `index.html` in a browser (no server or GPU needed),
pick an example or paste a kernel, and step through every thread's reads, writes and barriers.

It interprets a subset of Mojo in JavaScript, running all threads in lockstep (one statement per tick). It supports
`Pointer` / `TileTensor` / `LayoutTensor` indexing, `stack_allocation` shared memory, `barrier()`, `if` / `for` / `while`
and `print`, which covers roughly p01–p14. Warp ops, `.tile[]`, slicing and async copies are not supported.

Checks: out-of-bounds access, data races, barrier divergence, uninitialized shared reads, writes to `mut=False`
buffers, and `expect` lines in the launch settings.

## Layout

- `src/engine.js` — tokenizer, parser and SIMT interpreter (no DOM)
- `src/ui.js`, `src/shell.html` — page
- `src/demo_race.json` — the race demo preset
- `build.py` — regenerates `src/presets.js` from `problems/` and writes `index.html`
- `src/test.js` — runs every preset through the engine: `cd src && node test.js`
