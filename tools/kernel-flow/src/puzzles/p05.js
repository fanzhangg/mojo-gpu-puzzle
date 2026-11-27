import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 05: output[row, col] = a[0, col] + b[row, 0]; a is a row vector, b a column vector.
const SIZE = 2, TB = 3;
const a = range(SIZE).map(i => i + 1); // main(): a_host[i] = i + 1  -> [1, 2]
const b = range(SIZE).map(i => i * 10); // main(): b_host[i] = i * 10 -> [0, 10]
const rc = k => [Math.floor(k / SIZE), k % SIZE];
const out = k => { const [r, c] = rc(k); return a[c] + b[r]; };
const tcell = (r, c) => r * TB + c;

function rows(sel, stage) {
  const [r, c] = rc(sel);
  return [
    { id: 'a', label: L('a (row)', 'a（行向量）'), kind: 'global', cols: SIZE, cells: a.map((v, j) => cell(v, j === c ? 'read' : stage === 1 ? undefined : 'muted', { idx: `0,${j}` })) },
    { id: 'b', label: L('b (column)', 'b（列向量）'), kind: 'global', cols: 1, cells: b.map((v, i) => cell(v, i === r ? 'read' : stage === 1 ? undefined : 'muted', { idx: `${i},0` })) },
    {
      id: 'threads', label: L('threads (x,y)', '线程 (x,y)'), kind: 'threads', cols: TB,
      cells: range(TB * TB).map(t => {
        const y = Math.floor(t / TB), x = t % TB;
        if (y >= SIZE || x >= SIZE) return cell(`${x},${y}`, 'idle', { note: L('skips', '跳过') });
        return cell(`${x},${y}`, y === r && x === c ? 'focus' : 'active');
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global', cols: SIZE,
      cells: range(SIZE * SIZE).map(k => {
        const [y, x] = rc(k);
        const shares = (y === r) !== (x === c); // same row (shares b[r]) or same column (shares a[c]), not the cell itself
        const tone = k === sel ? (stage === 1 ? 'write' : 'focus') : shares ? 'focus' : stage === 1 ? undefined : 'muted';
        return cell(stage === 1 ? out(k) : null, tone, { idx: `${y},${x}` });
      }),
    },
  ];
}

export default {
  id: 'p05',
  num: 5,
  title: L('Broadcast', '广播'),
  goal: L(
    'Add a row vector `a` and a column vector `b` into a 2×2 matrix: `output[row, col] = a[col] + b[row]`.',
    '把行向量 `a` 和列向量 `b` 相加得到 2×2 矩阵：`output[row, col] = a[col] + b[row]`。',
  ),
  idea: L(
    'Nobody builds the expanded 2×2 copies of `a` and `b`. Each thread just reads the one entry it needs from each vector: every output in column `col` reads the same `a[col]`, and every output in row `row` reads the same `b[row]`. That reuse of a small input across a whole row or column is what "broadcasting" means.',
    '没有人去构造 `a` 和 `b` 扩展成 2×2 的副本。每个线程只从两个向量各读自己需要的那一个值：第 `col` 列的所有输出读同一个 `a[col]`，第 `row` 行的所有输出读同一个 `b[row]`。一个小输入被整行或整列重复使用，这就是"广播"。',
  ),
  data: {
    launch: L('1 block of 3×3 threads for a 2×2 output', '1 个 3×3 线程的 block，输出是 2×2'),
    tensors: [
      { name: 'a', values: a, note: L('row vector (1×2), a[j] = j + 1', '行向量（1×2），a[j] = j + 1') },
      { name: 'b', values: b, note: L('column vector (2×1), b[i] = i × 10', '列向量（2×1），b[i] = i × 10') },
      { name: 'output', values: [0, 0, 0, 0], note: L('2×2, starts at 0', '2×2，初始为 0') },
    ],
  },
  pick: { row: 'output', initial: 3, hint: L('Click an output; the outlined neighbours share one of its inputs.', '点击一个输出；带框的格子和它共用一个输入。') },
  stages: [
    {
      name: L('Pick inputs', '选取输入'),
      lines: ['var row = thread_idx.y', 'var col = thread_idx.x', 'if row < size and col < size'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 0),
          arrows: [arrow(at('a', c), at('threads', tcell(r, c)), 'read'), arrow(at('b', r), at('threads', tcell(r, c)), 'read')],
          say: L(
            `The thread for row ${r}, column ${c} needs only \`a[${c}]\` (the column's entry) and \`b[${r}]\` (the row's entry). The outlined outputs share one of them: the other cell in column ${c} also reads \`a[${c}]\`, and the other cell in row ${r} also reads \`b[${r}]\`.`,
            `第 ${r} 行第 ${c} 列的线程只需要 \`a[${c}]\`（这一列对应的值）和 \`b[${r}]\`（这一行对应的值）。带框的输出和它共用其中一个：第 ${c} 列的另一个格子也读 \`a[${c}]\`，第 ${r} 行的另一个格子也读 \`b[${r}]\`。`,
          ),
          math: `row = thread_idx.y = ${r},  col = thread_idx.x = ${c}`,
        };
      },
    },
    {
      name: L('Add', '相加'),
      lines: ['output[row, col] = a[0, col] + b[row, 0]'],
      scene(sel) {
        const [r, c] = rc(sel);
        const arrows = [];
        for (const k of range(SIZE * SIZE)) {
          const [y, x] = rc(k);
          const t = tcell(y, x), faint = k !== sel;
          arrows.push(arrow(at('a', x), at('threads', t), 'read', faint), arrow(at('b', y), at('threads', t), 'read', faint), arrow(at('threads', t), at('output', k), 'write', faint));
        }
        return {
          rows: rows(sel, 1),
          arrows,
          say: L(
            'Four threads, four sums, but only two values of `a` and two of `b` are ever read: each input fans out to a whole column or row of outputs.',
            '四个线程算出四个和，但 `a` 和 `b` 各自只有两个值被读取：每个输入扇出到一整列或一整行输出。',
          ),
          math: `output[${r}, ${c}] = a[${c}] + b[${r}] = ${a[c]} + ${b[r]} = ${out(sel)}`,
        };
      },
    },
  ],
  result: () => range(SIZE * SIZE).map(out),
  // main() fills a[i] = i + 1 and b[i] = i * 10, which the oracle's launch extractor reads as arange,
  // so this page states its inputs explicitly.
  oracle: {
    file: 'p05/p05.mojo', kernel: 'broadcast_add', buffer: 'output',
    launch: 'grid = BLOCKS_PER_GRID\nblock = THREADS_PER_BLOCK\noutput = zeros(4)\na = [1, 2]\nb = [0, 10]\nsize_dev = SIZE',
  },
};
