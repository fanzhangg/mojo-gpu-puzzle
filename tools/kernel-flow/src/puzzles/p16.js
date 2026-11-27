import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 16 (naive): C = A @ B for 2×2 matrices, one block of 3×3 threads, straight from global memory.
const SIZE = 2, TPB = 3;
const A = range(SIZE * SIZE);              // main(): a[r][c] = r·size + c
const B = A.map(v => 2 * v);               // main(): b[r][c] = 2·(r·size + c)
const a = (r, c) => A[r * SIZE + c];
const b = (r, c) => B[r * SIZE + c];
const C = range(SIZE * SIZE).map(i => range(SIZE).reduce((s, k) => s + a(Math.floor(i / SIZE), k) * b(k, i % SIZE), 0));
const rc = i => [Math.floor(i / SIZE), i % SIZE];
const tid = (x, y) => y * TPB + x;          // threads drawn as a 3×3 grid, row = thread_idx.y

function rows(sel, stage) {
  const [r, c] = rc(sel);
  return [
    { id: 'a', label: 'a', kind: 'global', cols: SIZE, cells: A.map((v, i) => cell(v, stage === 1 ? (rc(i)[0] === r ? 'read' : 'muted') : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    { id: 'b', label: 'b', kind: 'global', cols: SIZE, cells: B.map((v, i) => cell(v, stage === 1 ? (rc(i)[1] === c ? 'read' : 'muted') : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    {
      id: 'threads', label: L('threads (x,y)', '线程 (x,y)'), kind: 'threads', cols: TPB,
      cells: range(TPB * TPB).map(t => {
        const x = t % TPB, y = Math.floor(t / TPB);
        const busy = x < SIZE && y < SIZE;
        if (!busy) return cell(`${x},${y}`, 'idle', { note: L('no cell', '无元素') });
        const me = x === c && y === r;
        return cell(`${x},${y}`, me ? 'focus' : stage === 1 ? 'muted' : 'active', me && stage >= 1 ? { note: `acc = ${fmt(C[sel])}` } : undefined);
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global', cols: SIZE,
      cells: range(SIZE * SIZE).map(i => cell(stage === 2 ? C[i] : null, i === sel ? (stage === 2 ? 'write' : 'focus') : stage === 2 ? undefined : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })),
    },
  ];
}

const sampleData = {
  launch: L('1 block of 3×3 threads for a 2×2 result (5 threads have no cell)', '1 个 block，3×3 个线程，结果只有 2×2（5 个线程没有元素）'),
  tensors: [
    { name: 'a', values: A, note: L('2×2, row by row: a[r][c] = r·2 + c', '2×2，按行存放：a[r][c] = r·2 + c') },
    { name: 'b', values: B, note: L('2×2: b[r][c] = 2·(r·2 + c)', '2×2：b[r][c] = 2·(r·2 + c)') },
    { name: 'output', values: [0, 0, 0, 0], note: L('2×2, starts at 0', '2×2，初始为 0') },
  ],
};

export { A, B, C, SIZE, TPB, rc, tid, sampleData };

export default {
  id: 'p16',
  num: 16,
  title: L('Matrix Multiplication', '矩阵乘法'),
  goal: L(
    'Multiply two matrices: `output[row][col] = Σₖ a[row][k] · b[k][col]`, the row of `a` times the column of `b`.',
    '计算两个矩阵的乘积：`output[row][col] = Σₖ a[row][k] · b[k][col]`，即 `a` 的一行乘以 `b` 的一列。',
  ),
  idea: L(
    'One thread per output cell, arranged in 2D: `thread_idx.y` picks the row and `thread_idx.x` the column. Each thread walks along its row of `a` and down its column of `b`, multiplying and adding. This version reads everything straight from global memory.',
    '每个线程负责一个输出元素，线程按二维排列：`thread_idx.y` 决定行，`thread_idx.x` 决定列。每个线程沿着 `a` 的一行、`b` 的一列，逐项相乘再累加。这个版本所有数据都直接从全局内存读取。',
  ),
  data: sampleData,
  pick: { row: 'output', initial: 3, hint: L('Click an output cell to see its row and column.', '点击一个输出元素，看它对应的行和列。') },
  stages: [
    {
      name: L('Pick a cell', '对应元素'),
      lines: ['var row = block_dim.y', 'var col = block_dim.x', 'if row < size and col < size'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 0),
          arrows: range(SIZE * SIZE).map(i => arrow(at('threads', tid(rc(i)[1], rc(i)[0])), at('output', i), 'write', i !== sel)),
          say: L(
            `Thread (${c}, ${r}) owns \`output[${r}][${c}]\`: its \`thread_idx.y\` is the row and its \`thread_idx.x\` the column. The block has 3×3 threads but the result is only 2×2, so the guard leaves 5 threads with nothing to do.`,
            `线程 (${c}, ${r}) 负责 \`output[${r}][${c}]\`：它的 \`thread_idx.y\` 是行，\`thread_idx.x\` 是列。block 有 3×3 个线程，但结果只有 2×2，所以边界检查让 5 个线程无事可做。`,
          ),
          math: `row = block_dim.y × block_idx.y + thread_idx.y = ${TPB} × 0 + ${r} = ${r}\ncol = block_dim.x × block_idx.x + thread_idx.x = ${TPB} × 0 + ${c} = ${c}`,
        };
      },
    },
    {
      name: L('Row × column', '行 × 列'),
      lines: ['var acc', 'comptime for k in range(size)', 'acc += a[row, k] * b[k, col]'],
      scene(sel) {
        const [r, c] = rc(sel);
        const me = tid(c, r);
        return {
          rows: rows(sel, 1),
          arrows: range(SIZE).flatMap(k => [arrow(at('a', r * SIZE + k), at('threads', me), 'read'), arrow(at('b', k * SIZE + c), at('threads', me), 'read')]),
          say: L(
            `Thread (${c}, ${r}) reads row ${r} of \`a\` and column ${c} of \`b\` from global memory, multiplies them pairwise and adds them up in \`acc\`. Its neighbour in the same row reads the same row of \`a\` again, so every value of \`a\` and \`b\` is fetched from global memory ${SIZE} times. The shared-memory version fixes that.`,
            `线程 (${c}, ${r}) 从全局内存读取 \`a\` 的第 ${r} 行和 \`b\` 的第 ${c} 列，逐项相乘后累加到 \`acc\`。同一行的另一个线程会再读一遍 \`a\` 的同一行，所以 \`a\` 和 \`b\` 的每个值都要从全局内存读 ${SIZE} 次。共享内存版本解决了这个问题。`,
          ),
          math: `acc = ${range(SIZE).map(k => `a[${r}][${k}]·b[${k}][${c}]`).join(' + ')}\n    = ${range(SIZE).map(k => `${fmt(A[r * SIZE + k])}·${fmt(B[k * SIZE + c])}`).join(' + ')} = ${fmt(C[sel])}`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['output[row, col] = acc'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 2),
          arrows: [arrow(at('threads', tid(c, r)), at('output', sel), 'write')],
          say: L(`Thread (${c}, ${r}) writes \`output[${r}][${c}]\`. The other three threads wrote their cells at the same time.`, `线程 (${c}, ${r}) 写出 \`output[${r}][${c}]\`，其余三个线程同时写出了各自的元素。`),
          math: `output[${r}][${c}] = ${fmt(C[sel])}`,
        };
      },
    },
  ],
  result: () => C.slice(),
  // inputs: main() fills b with 2·val, which the test's launch reader reads as arange
  oracle: { file: 'p16/p16.mojo', kernel: 'naive_matmul', buffer: 'output', inputs: { b: 'arange(SIZE * SIZE) * 2' } },
};
