import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 15: sum each row of a 4×6 matrix. One block (8 threads) per row, tree reduction in shared memory.
const BATCH = 4, SIZE = 6, TPB = 8;
const a = range(BATCH * SIZE); // main(): inp_host[row * SIZE + col] = row * SIZE + col
const strides = [4, 2, 1];
const levelsOf = r => {
  const lv = [range(TPB).map(c => (c < SIZE ? a[r * SIZE + c] : 0))];
  for (const s of strides) { const p = lv[lv.length - 1]; lv.push(p.map((v, i) => (i < s ? v + p[i + s] : v))); }
  return lv;
};
const result = r => levelsOf(r)[3][0];

function rows(sel, stage) {
  const lv = levelsOf(sel);
  const out = [
    {
      id: 'a', label: 'a', kind: 'global', cols: SIZE,
      cells: a.map((v, i) => cell(v, Math.floor(i / SIZE) === sel ? (stage === 0 ? 'read' : 'focus') : 'muted', { idx: `${Math.floor(i / SIZE)},${i % SIZE}` })),
    },
    {
      id: 'threads', label: L(`block ${sel}`, `block ${sel}`), kind: 'threads',
      cells: range(TPB).map(t => {
        if (stage === 0) return cell(t, t < SIZE ? 'active' : 'idle', t < SIZE ? undefined : { note: L('pads 0', '补 0') });
        if (stage <= 3) { const s = strides[stage - 1]; return cell(t, t < s ? (t === 0 ? 'focus' : 'active') : 'idle', t < s ? undefined : { note: L('idle', '空闲') }); }
        return cell(t, t === 0 ? 'focus' : 'idle');
      }),
    },
  ];
  const shown = Math.min(stage, 3);
  for (let k = 0; k <= shown; k++) {
    const live = k === 0 ? TPB : strides[k - 1];
    out.push({
      id: `L${k}`,
      label: k === 0 ? 'cache' : L(`after stride ${strides[k - 1]}`, `步长 ${strides[k - 1]} 之后`),
      kind: 'shared',
      cells: lv[k].map((v, i) => (i >= live ? cell(v, 'muted') : cell(v, k === shown && stage <= 3 ? (i === 0 ? 'write' : 'focus') : i === 0 ? 'focus' : 'muted'))),
    });
  }
  out.push({
    id: 'output', label: 'output', kind: 'global',
    cells: range(BATCH).map(r => cell(stage === 4 ? result(r) : null, r === sel ? (stage === 4 ? 'write' : 'focus') : stage === 4 ? undefined : 'muted', { idx: `${r},0` })),
  });
  return out;
}

function treeArrows(k) {
  const out = [];
  for (let r = 1; r <= k; r++) {
    const s = strides[r - 1];
    for (const i of range(s)) out.push(arrow(at(`L${r - 1}`, i), at(`L${r}`, i), 'move', r < k), arrow(at(`L${r - 1}`, i + s), at(`L${r}`, i), 'move', r < k));
  }
  return out;
}

const round = k => ({
  name: L(`Stride ${strides[k - 1]}`, `步长 ${strides[k - 1]}`),
  lines: ['while stride > 0', 'if local_i < stride', 'cache[local_i] += cache[local_i + stride]', '        barrier()', 'stride //= 2'],
  scene(sel) {
    const s = strides[k - 1];
    const lv = levelsOf(sel);
    return {
      rows: rows(sel, k),
      arrows: treeArrows(k),
      say: L(
        `${s === 1 ? 'Thread 0 adds the value 1 place to its right' : `Threads 0–${s - 1} each add the value ${s} places to their right`}, exactly like the dot product in Puzzle 12, then \`barrier()\`. Each row is the same \`cache\`, updated in place; cells ${s}–${TPB - 1} keep their old values (grey) but are no longer read. The other 3 blocks do the same for their rows at the same time.`,
        `${s === 1 ? '线程 0 把右边 1 格的值加到自己的格子里' : `线程 0–${s - 1} 各自把右边第 ${s} 格的值加到自己的格子里`}，和第 12 题的点积完全一样，然后 \`barrier()\`。每一行都是同一个 \`cache\` 被原地更新；第 ${s}–${TPB - 1} 格的旧值还在（灰色），只是不再被读取。另外 3 个 block 同时对各自的行做同样的事。`,
      ),
      math: range(s).map(i => `cache[${i}] = ${fmt(lv[k - 1][i])} + ${fmt(lv[k - 1][i + s])} = ${fmt(lv[k][i])}`).join('\n'),
    };
  },
});

export default {
  id: 'p15',
  num: 15,
  title: L('Axis Sum', '按行求和'),
  goal: L(
    'Sum each row of a 4 × 6 matrix: `output[r] = a[r, 0] + a[r, 1] + … + a[r, 5]`.',
    '对一个 4 × 6 矩阵的每一行求和：`output[r] = a[r, 0] + a[r, 1] + … + a[r, 5]`。',
  ),
  idea: L(
    'Rows are independent, so each row gets its own block: `block_idx.y` says which row. Inside the block it is the dot product\'s tree reduction again. The row has 6 elements but the block has 8 threads, so the 2 extra threads put 0 into the cache; adding 0 does not change the sum and keeps the tree a power of two.',
    '各行互不相关，所以每一行交给一个 block：`block_idx.y` 表示是哪一行。block 内部又是点积那样的树形归约。一行只有 6 个元素，block 却有 8 个线程，多出的 2 个线程往 cache 里放 0；加 0 不改变和，又让树的大小保持为 2 的幂。',
  ),
  data: {
    launch: L('4 blocks (one per row, grid = (1, 4)) of 8 threads', '4 个 block（每行一个，grid = (1, 4)），每个 8 个线程'),
    tensors: [
      { name: 'a', values: L('4 × 6, a[r, c] = 6r + c', '4 × 6，a[r, c] = 6r + c'), note: L('rows [0..5], [6..11], [12..17], [18..23]', '各行为 [0..5]、[6..11]、[12..17]、[18..23]') },
      { name: 'output', values: L('4 × 1, zeros', '4 × 1，全为 0'), note: L('one sum per row', '每行一个和') },
      { name: 'size', values: 'Int = 6', note: L('row length, passed to the kernel', '行长度，作为参数传给 kernel') },
    ],
  },
  pick: { row: 'output', initial: 1, hint: L('Click an output to see the block that sums that row.', '点击一个输出，看负责这一行的 block。') },
  stages: [
    {
      name: L('Load row', '加载一行'),
      lines: ['var batch = block_idx.y', 'if local_i < size', 'cache[local_i] = rebind', 'cache[local_i] = 0', 'barrier()'],
      scene(sel) {
        const arrows = [];
        for (const t of range(TPB)) {
          if (t < SIZE) arrows.push(arrow(at('a', sel * SIZE + t), at('threads', t), 'read'));
          arrows.push(arrow(at('threads', t), at('L0', t), 'write'));
        }
        return {
          rows: rows(sel, 0),
          arrows,
          say: L(
            `Block ${sel} handles row ${sel} (\`batch = block_idx.y = ${sel}\`). Threads 0–5 copy the row into the block's shared \`cache\`; threads 6 and 7 write 0, so the tree below has 8 slots.`,
            `block ${sel} 负责第 ${sel} 行（\`batch = block_idx.y = ${sel}\`）。线程 0–5 把这一行复制到 block 的共享 \`cache\`；线程 6、7 写入 0，让下面的树有 8 个位置。`,
          ),
          math: `cache = a[${sel}, 0..5] + [0, 0] = [${levelsOf(sel)[0].join(', ')}]`,
        };
      },
    },
    round(1),
    round(2),
    round(3),
    {
      name: L('Write', '写回'),
      lines: ['if local_i == 0', 'output[batch, 0] = cache[0]'],
      scene(sel) {
        return {
          rows: rows(sel, 4),
          arrows: [...treeArrows(3).map(x => ({ ...x, faint: true })), arrow(at('L3', 0), at('output', sel), 'write')],
          say: L(
            `Thread 0 of block ${sel} writes the row's sum to \`output[${sel}, 0]\`. Every block writes its own row's sum.`,
            `block ${sel} 的线程 0 把这一行的和写到 \`output[${sel}, 0]\`。每个 block 写出自己那一行的和。`,
          ),
          math: `output[${sel}, 0] = ${range(SIZE).map(c => fmt(a[sel * SIZE + c])).join(' + ')} = ${fmt(result(sel))}`,
        };
      },
    },
  ],
  result: () => range(BATCH).map(result),
  oracle: { file: 'p15/p15.mojo', kernel: 'axis_sum', buffer: 'output' },
};
