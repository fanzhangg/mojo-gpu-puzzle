import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 04 (TileTensor): output[row, col] = a[row, col] + 10, a 3x3 block of threads over a 2x2 matrix.
const SIZE = 2, TB = 3;
const a = range(SIZE * SIZE); // main(): a_host[i] = i, viewed as a 2x2 row-major matrix
const rc = k => [Math.floor(k / SIZE), k % SIZE];
// thread cells are laid out like the block: cell index = thread_idx.y * 3 + thread_idx.x
const tcell = (r, c) => r * TB + c;

function rows(sel, stage) {
  const [r, c] = rc(sel);
  return [
    {
      id: 'a', label: 'a', kind: 'global', cols: SIZE,
      cells: a.map((v, k) => cell(v, k === sel ? (stage === 2 ? 'read' : 'focus') : stage === 2 ? undefined : 'muted', { idx: rc(k).join(',') })),
    },
    {
      id: 'mem', label: L('a in memory', 'a 在内存里'), kind: 'global',
      cells: a.map((v, k) => cell(v, k === sel ? (stage === 1 ? 'read' : 'focus') : 'muted', { note: k === sel && stage >= 1 ? `${rc(k)[0]}×${SIZE}+${rc(k)[1]}` : undefined })),
    },
    {
      id: 'threads', label: L('threads (x,y)', '线程 (x,y)'), kind: 'threads', cols: TB,
      cells: range(TB * TB).map(t => {
        const y = Math.floor(t / TB), x = t % TB;
        const live = y < SIZE && x < SIZE;
        if (y === r && x === c) return cell(`${x},${y}`, 'focus', { note: L(`row ${y} col ${x}`, `第 ${y} 行 第 ${x} 列`) });
        return cell(`${x},${y}`, live ? 'active' : 'idle', live ? undefined : { note: L('skips', '跳过') });
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global', cols: SIZE,
      cells: range(SIZE * SIZE).map(k => cell(stage === 2 ? a[k] + 10 : null, k === sel ? (stage === 2 ? 'write' : 'focus') : stage === 2 ? undefined : 'muted', { idx: rc(k).join(',') })),
    },
  ];
}

export default {
  id: 'p04',
  num: 4,
  title: L('2D Map', '二维映射'),
  goal: L(
    'Add 10 to every element of a 2×2 matrix, `output[row, col] = a[row, col] + 10`, with a 3×3 block of threads.',
    '给 2×2 矩阵的每个元素加 10：`output[row, col] = a[row, col] + 10`，使用一个 3×3 的线程 block。',
  ),
  idea: L(
    'Threads can be numbered in 2D: `thread_idx.x` picks the column and `thread_idx.y` picks the row, so the block of threads lines up with the matrix. Memory itself is still one flat line; the matrix is stored row after row (row-major), and `a[row, col]` is element `row × size + col`. The block is bigger than the matrix, so the guard keeps the extra row and column of threads idle.',
    '线程可以按二维编号：`thread_idx.x` 选列，`thread_idx.y` 选行，于是线程 block 和矩阵对齐。但内存本身仍是一条直线：矩阵一行接一行地存放（行主序），`a[row, col]` 就是第 `row × size + col` 个元素。block 比矩阵大，所以边界检查让多出来的一行一列线程保持空闲。',
  ),
  data: {
    launch: L('1 block of 3×3 threads for a 2×2 matrix', '1 个 3×3 线程的 block，处理 2×2 矩阵'),
    tensors: [
      { name: 'a', values: a, note: L('2×2 matrix stored row by row: [[0, 1], [2, 3]]', '按行存放的 2×2 矩阵：[[0, 1], [2, 3]]') },
      { name: 'output', values: [0, 0, 0, 0], note: L('2×2, starts at 0', '2×2，初始为 0') },
      { name: 'size', values: 'Int = 2', note: L('matrix width and height', '矩阵的宽和高') },
    ],
  },
  pick: { row: 'output', initial: 2, hint: L('Click an output cell; its [row,col] label is above it. Threads are labelled the other way round, x,y = col,row.', '点击一个输出格子，它上方标着 [行,列]。线程的标签顺序相反：x,y 即 列,行。') },
  stages: [
    {
      name: L('Row and column', '行和列'),
      lines: ['var row = thread_idx.y', 'var col = thread_idx.x'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 0),
          arrows: [],
          say: L(
            `The thread labelled (x, y) = (${c}, ${r}) in the block works on row ${r}, column ${c}: \`col\` comes from \`thread_idx.x\` and \`row\` from \`thread_idx.y\`, so x is the horizontal position and y the vertical one. Threads in the third row or column have no element.`,
            `block 中标为 (x, y) = (${c}, ${r}) 的线程处理第 ${r} 行、第 ${c} 列：\`col\` 来自 \`thread_idx.x\`，\`row\` 来自 \`thread_idx.y\`，即 x 是水平位置，y 是垂直位置。第三行、第三列的线程没有对应元素。`,
          ),
          math: `row = thread_idx.y = ${r}\ncol = thread_idx.x = ${c}`,
        };
      },
    },
    {
      name: L('Find it in memory', '在内存中定位'),
      lines: ['output[row, col] = a[row, col] + 10.0'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 1),
          arrows: [arrow(at('a', sel), at('mem', sel), 'read')],
          say: L(
            `\`a[${r}, ${c}]\` looks 2D, but memory is one line. The rows are laid end to end, so row ${r} starts at ${r} × ${SIZE} and column ${c} is ${c} further along. \`TileTensor\` does this arithmetic for you.`,
            `\`a[${r}, ${c}]\` 看起来是二维的，但内存是一条线。各行首尾相接，所以第 ${r} 行从 ${r} × ${SIZE} 开始，第 ${c} 列再往后 ${c} 个。\`TileTensor\` 会替你做这个计算。`,
          ),
          math: `a[${r}, ${c}]  →  ${r} × size + ${c} = ${r} × ${SIZE} + ${c} = ${sel}`,
        };
      },
    },
    {
      name: L('Guard and add 10', '检查并加 10'),
      lines: ['if col < size and row < size', 'output[row, col] = a[row, col] + 10.0'],
      scene(sel) {
        const [r, c] = rc(sel);
        const arrows = [];
        for (const k of range(SIZE * SIZE)) {
          const [y, x] = rc(k);
          arrows.push(arrow(at('a', k), at('threads', tcell(y, x)), 'read', k !== sel), arrow(at('threads', tcell(y, x)), at('output', k), 'write', k !== sel));
        }
        return {
          rows: rows(sel, 2),
          arrows,
          say: L(
            `The 4 threads inside the matrix pass \`row < size and col < size\` and each add 10 to their own element. The other 5 threads fail the check and do nothing.`,
            `矩阵内的 4 个线程通过 \`row < size and col < size\` 检查，各自给自己的元素加 10。其余 5 个线程没通过检查，什么也不做。`,
          ),
          math: `output[${r}, ${c}] = a[${r}, ${c}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}`,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p04/p04_tile_tensor.mojo', kernel: 'add_10_2d', buffer: 'output' },
};
