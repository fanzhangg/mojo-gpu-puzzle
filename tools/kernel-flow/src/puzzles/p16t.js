import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 16 (tiled): C = A @ B for 9×9 matrices with a 3×3 grid of 3×3-thread blocks.
// Each block computes one 3×3 tile of C, bringing A and B through shared memory one 3×3 tile at a time.
const N = 9, T = 3, TILES = N / T;
const A = range(N * N);          // main(): a[r][c] = r·9 + c
const B = A.map(v => 2 * v);     // main(): b[r][c] = 2·(r·9 + c)
const a = (r, c) => A[r * N + c];
const b = (r, c) => B[r * N + c];
const C = range(N * N).map(i => range(N).reduce((s, k) => s + a(Math.floor(i / N), k) * b(k, i % N), 0));
const rc = i => [Math.floor(i / N), i % N];
// partial sum of output (r, c) after tiles 0..t
const accAfter = (r, c, t) => range(T * (t + 1)).reduce((s, k) => s + a(r, k) * b(k, c), 0);

function info(sel) {
  const [r, c] = rc(sel);
  return { r, c, by: Math.floor(r / T), bx: Math.floor(c / T), ly: r % T, lx: c % T };
}

// stage s: 0..5 = tile floor(s/2), load (even) or multiply (odd); 6 = write
function rows(sel, s) {
  const { r, c, by, bx, ly, lx } = info(sel);
  const t = Math.min(Math.floor(s / 2), TILES - 1);
  const loading = s < 6 && s % 2 === 0, multiplying = s < 6 && s % 2 === 1;
  const inATile = i => { const [ir, ic] = rc(i); return Math.floor(ir / T) === by && Math.floor(ic / T) === t; };
  const inBTile = i => { const [ir, ic] = rc(i); return Math.floor(ir / T) === t && Math.floor(ic / T) === bx; };
  const aTone = i => {
    if (s === 6) return 'muted';
    if (loading) return inATile(i) ? (rc(i)[0] === r && rc(i)[1] === t * T + lx ? 'read' : 'focus') : Math.floor(rc(i)[0] / T) === by ? undefined : 'muted';
    return inATile(i) && rc(i)[0] === r ? 'focus' : 'muted';
  };
  const bTone = i => {
    if (s === 6) return 'muted';
    if (loading) return inBTile(i) ? (rc(i)[1] === c && rc(i)[0] === t * T + ly ? 'read' : 'focus') : Math.floor(rc(i)[1] / T) === bx ? undefined : 'muted';
    return inBTile(i) && rc(i)[1] === c ? 'focus' : 'muted';
  };
  const shA = range(T * T).map(i => a(by * T + Math.floor(i / T), t * T + (i % T)));
  const shB = range(T * T).map(i => b(t * T + Math.floor(i / T), bx * T + (i % T)));
  return [
    { id: 'a', label: 'a', kind: 'global', cols: N, dense: true, cells: A.map((v, i) => cell(v, aTone(i), { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    {
      id: 'as', label: 'a_shared', kind: 'shared', cols: T,
      cells: shA.map((v, i) => cell(v, s === 6 ? 'muted' : loading ? (Math.floor(i / T) === ly && i % T === lx ? 'write' : undefined) : Math.floor(i / T) === ly ? 'read' : 'muted', { idx: `${Math.floor(i / T)},${i % T}` })),
    },
    { id: 'b', label: 'b', kind: 'global', cols: N, dense: true, cells: B.map((v, i) => cell(v, bTone(i), { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    {
      id: 'bs', label: 'b_shared', kind: 'shared', cols: T,
      cells: shB.map((v, i) => cell(v, s === 6 ? 'muted' : loading ? (Math.floor(i / T) === ly && i % T === lx ? 'write' : undefined) : i % T === lx ? 'read' : 'muted', { idx: `${Math.floor(i / T)},${i % T}` })),
    },
    {
      id: 'threads', label: L(`threads of block (${bx}, ${by})`, `block (${bx}, ${by}) 的线程`), kind: 'threads', cols: T,
      cells: range(T * T).map(i => {
        const x = i % T, y = Math.floor(i / T);
        const me = x === lx && y === ly;
        const accNow = multiplying ? accAfter(r, c, t) : loading ? (t > 0 ? accAfter(r, c, t - 1) : 0) : C[sel];
        return cell(`${x},${y}`, me ? 'focus' : multiplying ? 'muted' : 'active', me ? { note: `acc = ${fmt(accNow)}` } : undefined);
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global', cols: N,
      cells: range(N * N).map(i => {
        const [ir, ic] = rc(i);
        const inBlock = Math.floor(ir / T) === by && Math.floor(ic / T) === bx;
        if (s === 6) return cell(C[i], i === sel ? 'write' : inBlock ? undefined : 'muted');
        return cell(null, i === sel ? 'focus' : inBlock ? undefined : 'muted');
      }),
    },
  ];
}

const tileStages = range(TILES).flatMap(t => [
  {
    name: L(`Tile ${t}: load`, `第 ${t} 块：加载`),
    lines: ['comptime for tile in range', 'a_shared[local_row, local_col] = rebind', 'b_shared[local_row, local_col] = rebind', 'barrier()'],
    scene(sel) {
      const { r, c, by, bx, ly, lx } = info(sel);
      const arrows = [];
      for (const i of range(T * T)) {
        const y = Math.floor(i / T), x = i % T, mine = y === ly && x === lx;
        arrows.push(arrow(at('a', (by * T + y) * N + t * T + x), at('as', i), 'move', !mine));
        arrows.push(arrow(at('b', (t * T + y) * N + bx * T + x), at('bs', i), 'move', !mine));
      }
      return {
        rows: rows(sel, 2 * t),
        arrows,
        say: t === 0
          ? L(
              `Block (${bx}, ${by}) computes the 3×3 corner of \`output\` that contains \`output[${r}][${c}]\`. For that it needs rows ${by * T}–${by * T + 2} of \`a\` and columns ${bx * T}–${bx * T + 2} of \`b\`, too much to hold at once, so it brings them in one 3×3 tile at a time. Tile 0: each of the 9 threads copies one value of \`a\` and one of \`b\` into shared memory, then \`barrier()\`.`,
              `block (${bx}, ${by}) 负责 \`output\` 中包含 \`output[${r}][${c}]\` 的那个 3×3 区域。为此它需要 \`a\` 的第 ${by * T}–${by * T + 2} 行和 \`b\` 的第 ${bx * T}–${bx * T + 2} 列，一次放不下，所以每次只搬进一个 3×3 的块。第 0 块：9 个线程各把 \`a\` 的一个值和 \`b\` 的一个值复制到共享内存，然后 \`barrier()\`。`,
            )
          : L(
              `Tile ${t}: the block slides one tile along — the next 3 columns of \`a\` and the next 3 rows of \`b\` — and overwrites shared memory with them. The \`barrier()\` at the end of the previous tile guarantees nobody is still reading the old values.`,
              `第 ${t} 块：block 沿着往前滑一块——\`a\` 的下 3 列和 \`b\` 的下 3 行——用它们覆盖共享内存。上一块结尾的 \`barrier()\` 保证没有线程还在读旧值。`,
            ),
        math: `a_shared[${ly}][${lx}] = a[${r}][${t * T + lx}] = ${fmt(a(r, t * T + lx))}\nb_shared[${ly}][${lx}] = b[${t * T + ly}][${c}] = ${fmt(b(t * T + ly, c))}`,
      };
    },
  },
  {
    name: L(`Tile ${t}: multiply`, `第 ${t} 块：乘加`),
    lines: ['comptime for k in range(min', 'acc += a_shared[local_row, k] * b_shared[k, local_col]'],
    scene(sel) {
      const { r, c, ly, lx } = info(sel);
      const me = ly * T + lx;
      const prev = t > 0 ? accAfter(r, c, t - 1) : 0;
      const terms = range(T).map(k => `${fmt(a(r, t * T + k))}·${fmt(b(t * T + k, c))}`);
      return {
        rows: rows(sel, 2 * t + 1),
        arrows: range(T).flatMap(k => [arrow(at('as', ly * T + k), at('threads', me), 'read'), arrow(at('bs', k * T + lx), at('threads', me), 'read')]),
        say: L(
          `Thread (${lx}, ${ly}) multiplies row ${ly} of \`a_shared\` by column ${lx} of \`b_shared\` and adds the 3 products to \`acc\`. The same row of \`a_shared\` is used by all 3 threads in that row, and the same column of \`b_shared\` by all 3 threads in that column, so every value fetched from global memory is used 3 times.${t === TILES - 1 ? ' This was the last tile.' : ''}`,
          `线程 (${lx}, ${ly}) 用 \`a_shared\` 的第 ${ly} 行乘以 \`b_shared\` 的第 ${lx} 列，把 3 个乘积加到 \`acc\` 上。\`a_shared\` 的同一行被这一行的 3 个线程共用，\`b_shared\` 的同一列被这一列的 3 个线程共用，所以从全局内存取来的每个值都用了 3 次。${t === TILES - 1 ? '这是最后一块。' : ''}`,
        ),
        math: `acc = ${fmt(prev)} + ${terms.join(' + ')} = ${fmt(accAfter(r, c, t))}`,
      };
    },
  },
]);

export default {
  id: 'p16t',
  num: 16,
  title: L('Matrix Multiplication', '矩阵乘法'),
  variant: L('Tiled', '分块'),
  goal: L(
    'Multiply two 9×9 matrices, `output[row][col] = Σₖ a[row][k] · b[k][col]`, with a 3×3 grid of blocks of 3×3 threads.',
    '计算两个 9×9 矩阵的乘积 `output[row][col] = Σₖ a[row][k] · b[k][col]`，用 3×3 个 block，每个 block 3×3 个线程。',
  ),
  idea: L(
    'Shared memory is small, so a block cannot hold whole rows of `a` and columns of `b`. Instead it walks along them in 3×3 tiles: load one tile of each into shared memory, let every thread add that tile\'s contribution to its running sum, then move on to the next tile. Three tiles cover the 9 terms of every dot product.',
    '共享内存很小，一个 block 放不下 `a` 的整行和 `b` 的整列。于是它按 3×3 的块沿着行和列前进：每次把两个矩阵各一块加载到共享内存，让每个线程把这一块的贡献加到自己的累加值上，再换下一块。3 块正好覆盖每个点积的 9 项。',
  ),
  data: {
    launch: L('3×3 blocks of 3×3 threads (81 threads, one per output)', '3×3 个 block，每个 3×3 个线程（共 81 个，每个输出一个）'),
    tensors: [
      { name: 'a', values: L('9×9, a[r][c] = r·9 + c (0 … 80)', '9×9，a[r][c] = r·9 + c（0 … 80）'), note: L('row by row', '按行存放') },
      { name: 'b', values: L('9×9, b[r][c] = 2·(r·9 + c) (0 … 160)', '9×9，b[r][c] = 2·(r·9 + c)（0 … 160）'), note: L('row by row', '按行存放') },
      { name: 'output', values: L('9×9 zeros', '9×9 个 0'), note: L('filled by the kernel', '由 kernel 写入') },
      { name: 'shared', values: L('a_shared, b_shared: 3×3 each, per block', 'a_shared、b_shared：各 3×3，每个 block 一份'), note: L('reused for every tile', '每一块都复用') },
    ],
  },
  pick: { row: 'output', initial: 4 * N + 5, hint: L('Click any output cell; the diagram follows its block through the 3 tiles.', '点击任意输出元素，图会跟着它所在的 block 走完 3 个块。') },
  stages: [
    ...tileStages,
    {
      name: L('Write', '写回'),
      lines: ['output[tiled_row, tiled_col] = acc'],
      scene(sel) {
        const { r, c, ly, lx } = info(sel);
        return {
          rows: rows(sel, 6),
          arrows: [arrow(at('threads', ly * T + lx), at('output', sel), 'write')],
          say: L(
            `After 3 tiles, thread (${lx}, ${ly}) has added all 9 products of row ${r} of \`a\` and column ${c} of \`b\`, and writes \`output[${r}][${c}]\`. All 81 threads in the 9 blocks did the same for their own cells.`,
            `3 块之后，线程 (${lx}, ${ly}) 已经累加了 \`a\` 第 ${r} 行与 \`b\` 第 ${c} 列的全部 9 个乘积，写出 \`output[${r}][${c}]\`。9 个 block 中的全部 81 个线程同时为各自的元素做了同样的事。`,
          ),
          math: `output[${r}][${c}] = ${range(TILES).map(t => fmt(accAfter(r, c, t) - (t ? accAfter(r, c, t - 1) : 0))).join(' + ')} = ${fmt(C[sel])}   # tile 0 + tile 1 + tile 2`,
        };
      },
    },
  ],
  result: () => C.slice(),
  oracle: { file: 'p16/p16.mojo', kernel: 'matmul_tiled', buffer: 'output', inputs: { b: 'arange(SIZE_TILED * SIZE_TILED) * 2' } },
};
