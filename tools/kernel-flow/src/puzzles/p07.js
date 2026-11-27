import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 07: output[row, col] = a[row, col] + 10 on a 5x5 matrix, 2x2 blocks of 3x3 threads.
const SIZE = 5, TB = 3, GRID = 2;
const a = range(SIZE * SIZE); // main(): a_host[k] = k, a 5x5 row-major matrix
const rc = k => [Math.floor(k / SIZE), k % SIZE];
// Threads are drawn as two rows of blocks (block_idx.y = 0, 1); each holds two 3x3 blocks side by side.
// Within a thread row, cell index = block_idx.x * 9 + thread_idx.y * 3 + thread_idx.x.
const tref = (r, c) => {
  const by = Math.floor(r / TB), bx = Math.floor(c / TB);
  return at(`tb${by}`, bx * TB * TB + (r % TB) * TB + (c % TB));
};

function rows(sel, stage) {
  const [r, c] = rc(sel);
  const by = Math.floor(r / TB), bx = Math.floor(c / TB);
  const inMyBlock = (y, x) => Math.floor(y / TB) === by && Math.floor(x / TB) === bx;
  const threadRow = gy => ({
    id: `tb${gy}`,
    label: L(`block_idx.y = ${gy}`, `block_idx.y = ${gy}`),
    kind: 'threads',
    groups: GRID,
    cols: TB,
    groupLabel: gx => L(`block (${gx}, ${gy})`, `block (${gx}, ${gy})`),
    cells: range(GRID * TB * TB).map(i => {
      const gx = Math.floor(i / (TB * TB)), ty = Math.floor((i % (TB * TB)) / TB), tx = i % TB;
      const y = gy * TB + ty, x = gx * TB + tx;
      const live = y < SIZE && x < SIZE;
      if (y === r && x === c) return cell(`${tx},${ty}`, 'focus');
      if (!live) return cell(`${tx},${ty}`, 'idle');
      return cell(`${tx},${ty}`, stage === 0 && !(gx === bx && gy === by) ? 'muted' : 'active');
    }),
  });
  return [
    {
      id: 'a', label: 'a', kind: 'global', cols: SIZE,
      cells: a.map((v, k) => {
        const [y, x] = rc(k);
        return cell(v, k === sel ? (stage === 1 ? 'read' : 'focus') : stage === 0 && inMyBlock(y, x) ? undefined : stage === 1 ? undefined : 'muted', { idx: `${y},${x}` });
      }),
    },
    threadRow(0),
    threadRow(1),
    {
      id: 'output', label: 'output', kind: 'global', cols: SIZE,
      cells: range(SIZE * SIZE).map(k => {
        const [y, x] = rc(k);
        return cell(stage === 1 ? a[k] + 10 : null, k === sel ? (stage === 1 ? 'write' : 'focus') : stage === 0 && inMyBlock(y, x) ? 'focus' : stage === 1 ? undefined : 'muted', { idx: `${y},${x}` });
      }),
    },
  ];
}

export default {
  id: 'p07',
  num: 7,
  title: L('2D Blocks', '二维 Block'),
  goal: L(
    'Add 10 to every element of a 5×5 matrix, `output[row, col] = a[row, col] + 10`, using a 2×2 grid of 3×3-thread blocks.',
    '给 5×5 矩阵的每个元素加 10：`output[row, col] = a[row, col] + 10`，使用 2×2 个 block，每个 block 有 3×3 个线程。',
  ),
  idea: L(
    'Blocks tile the matrix like floor tiles: block (x, y) covers a 3×3 patch, and a thread finds its global row and column by skipping the tiles before it, in each direction separately. 2 × 3 = 6 threads per side cover 5 rows and columns, so the tiles on the right and bottom edges hang over the matrix, and the guard keeps those threads idle.',
    'block 像地砖一样铺满矩阵：block (x, y) 覆盖一块 3×3 的区域，线程在两个方向上分别跳过前面的地砖，得到自己的全局行号和列号。每个方向 2 × 3 = 6 个线程覆盖 5 行 5 列，所以右边和下边的地砖会超出矩阵，边界检查让那些线程保持空闲。',
  ),
  data: {
    launch: L('2×2 blocks of 3×3 threads = 6×6 threads for a 5×5 matrix', '2×2 个 block，每个 3×3 线程，共 6×6 个线程，处理 5×5 矩阵'),
    tensors: [
      { name: 'a', values: L('[0, 1, …, 24] as a 5×5 matrix', '[0, 1, …, 24]，按 5×5 矩阵存放'), note: L('row-major, a[row, col] = row × 5 + col', '行主序，a[row, col] = row × 5 + col') },
      { name: 'output', values: L('5×5 zeros', '5×5，全 0'), note: L('filled by the kernel', '由 kernel 写入') },
      { name: 'size', values: 'Int = 5', note: L('matrix width and height', '矩阵的宽和高') },
    ],
  },
  pick: { row: 'output', initial: 18, hint: L('Click an output; the outlined cells are the tile its block covers.', '点击一个输出；带框的格子是它所在 block 覆盖的区域。') },
  stages: [
    {
      name: L('Which block, which thread', '哪个 block，哪个线程'),
      lines: ['var row = block_dim.y * block_idx.y + thread_idx.y', 'var col = block_dim.x * block_idx.x + thread_idx.x'],
      scene(sel) {
        const [r, c] = rc(sel);
        const by = Math.floor(r / TB), bx = Math.floor(c / TB), ty = r % TB, tx = c % TB;
        const edge = (by + 1) * TB > SIZE || (bx + 1) * TB > SIZE;
        return {
          rows: rows(sel, 0),
          arrows: [],
          say: L(
            `Output [${r}, ${c}] lies in the tile of block (${bx}, ${by}); inside that block it is thread (${tx}, ${ty}). The outlined cells are the whole tile that block covers.${edge ? ' This tile sits on the edge, so part of it falls outside the 5×5 matrix: those threads are faded.' : ''}`,
            `输出 [${r}, ${c}] 位于 block (${bx}, ${by}) 的区域内；在这个 block 里它由线程 (${tx}, ${ty}) 负责。带框的格子是这个 block 覆盖的整块区域。${edge ? '这块区域在边上，有一部分落在 5×5 矩阵之外，对应的线程显示为淡色。' : ''}`,
          ),
          math: `row = block_dim.y × block_idx.y + thread_idx.y = 3 × ${by} + ${ty} = ${r}\ncol = block_dim.x × block_idx.x + thread_idx.x = 3 × ${bx} + ${tx} = ${c}`,
        };
      },
    },
    {
      name: L('Guard and add 10', '检查并加 10'),
      lines: ['if row < size and col < size', 'output[row, col] = a[row, col] + 10.0'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 1),
          arrows: [arrow(at('a', sel), tref(r, c), 'read'), arrow(tref(r, c), at('output', sel), 'write')],
          say: L(
            'The 25 threads that land inside the matrix each add 10 to their own element, all four blocks at once. The 11 threads that fall off the right or bottom edge fail the guard and do nothing.',
            '落在矩阵内的 25 个线程各自给自己的元素加 10，四个 block 同时进行。落在右边或下边之外的 11 个线程没有通过边界检查，什么也不做。',
          ),
          math: `output[${r}, ${c}] = a[${r}, ${c}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}   # flat index ${r} × 5 + ${c} = ${sel}`,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p07/p07.mojo', kernel: 'add_10_blocks_2d', buffer: 'output' },
};
