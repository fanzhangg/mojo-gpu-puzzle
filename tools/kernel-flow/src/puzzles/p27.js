import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 27: dot product of two 128-element vectors with block.sum(), one block of 128 threads (4 warps).
// 128 threads do not fit legibly, so the thread row zooms into the selected warp; the other warps
// appear through their sums.
const N = 128, W = 32, WARPS = N / W;
const a = range(N);                  // test: a_host[i] = i
const b = range(N).map(i => 2 * i);  // test: b_host[i] = 2 * i
const prod = range(N).map(i => a[i] * b[i]);
const warpSum = range(WARPS).map(w => prod.slice(w * W, (w + 1) * W).reduce((s, v) => s + v, 0));
const total = warpSum.reduce((s, v) => s + v, 0);
const followed = w => w * W + 5; // follow lane 5 of the selected warp

function rows(w, stage) {
  const t = followed(w);
  return [
    {
      id: 'warps', label: L('warp sums', 'warp 部分和'), kind: 'shared',
      cells: warpSum.map((v, k) => cell(stage >= 1 ? v : null, stage === 1 ? (k === w ? 'write' : 'focus') : stage === 2 ? 'read' : k === w ? 'focus' : 'muted', { idx: `w${k}` })),
    },
    {
      id: 'threads', label: L(`warp ${w}`, `warp ${w}`), kind: 'threads', dense: true, cols: 8,
      cells: range(W).map(l => {
        const g = w * W + l;
        if (stage === 2) return cell(g, 'muted');
        if (stage === 1) return cell(g, g === t ? 'focus' : 'active');
        return cell(g, g === t ? 'focus' : 'active');
      }),
    },
    { id: 'output', label: 'output', kind: 'global', cells: [cell(stage === 2 ? total : null, stage === 2 ? 'write' : 'muted')] },
  ];
}

export default {
  id: 'p27',
  num: 27,
  title: L('Block-Wide Patterns', 'Block 级模式'),
  variant: L('block.sum', 'block.sum'),
  goal: L(
    'Dot product of two 128-element vectors with one block of 128 threads: `output[0] = a[0]·b[0] + … + a[127]·b[127]`.',
    '用一个 128 线程的 block 计算两个 128 元素向量的点积：`output[0] = a[0]·b[0] + … + a[127]·b[127]`。',
  ),
  idea: L(
    'A block of 128 threads is 4 warps. `block.sum()` adds one value per thread across the whole block: each warp first sums its 32 lanes with shuffles, then the 4 warp results are combined. One call replaces the shared-memory tree and barriers of Puzzle 12.',
    '128 个线程的 block 由 4 个 warp 组成。`block.sum()` 把整个 block 每个线程的一个值加起来：先在每个 warp 内用 shuffle 求出 32 个 lane 的和，再把 4 个 warp 的结果合并。一次调用就替代了第 12 题里的共享内存树形归约和 barrier。',
  ),
  data: {
    launch: L('1 block of 128 threads = 4 warps of 32', '1 个 block，128 个线程 = 4 个 warp，每个 32 线程'),
    tensors: [
      { name: 'a', values: L('[0, 1, 2, …, 127]', '[0, 1, 2, …, 127]'), note: L('128 elements, a[i] = i', '128 个元素，a[i] = i') },
      { name: 'b', values: L('[0, 2, 4, …, 254]', '[0, 2, 4, …, 254]'), note: L('b[i] = 2i, so each product is 2i²', 'b[i] = 2i，所以每个乘积是 2i²') },
      { name: 'output', values: [0], note: L('1 element, written by thread 0', '1 个元素，由线程 0 写入') },
    ],
  },
  pick: { row: 'warps', initial: 1, hint: L('Click a warp sum to see that warp\'s 32 threads.', '点击一个 warp 部分和，查看这个 warp 的 32 个线程。') },
  stages: [
    {
      name: L('Multiply', '相乘'),
      lines: ['var partial_product', 'partial_product = a[global_i][0] * b[global_i][0]'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 0),
          arrows: [],
          say: L(
            `All 128 threads multiply one pair each and keep the product in a register. Shown here are the 32 threads of warp ${w} (threads ${w * W}–${w * W + W - 1}); the other 3 warps do the same at the same time.`,
            `128 个线程各算一对乘积，放在寄存器里。图中是 warp ${w} 的 32 个线程（线程 ${w * W}–${w * W + W - 1}）；另外 3 个 warp 同时做同样的事。`,
          ),
          math: `thread ${t}:  partial_product = a[${t}]·b[${t}] = ${a[t]}·${b[t]} = ${fmt(prod[t])}`,
        };
      },
    },
    {
      name: L('Sum each warp', '各 warp 求和'),
      lines: ['var total = block.sum'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 1),
          arrows: range(W).map(l => arrow(at('threads', l), at('warps', w), 'move', w * W + l !== t)),
          say: L(
            `Inside \`block.sum()\`, each warp first adds its own 32 products with shuffles, like Puzzle 24. Warp ${w} produces one partial sum; every other warp produces its own at the same time.`,
            `在 \`block.sum()\` 内部，每个 warp 先像第 24 题那样用 shuffle 把自己的 32 个乘积加起来。warp ${w} 得到一个部分和，其他 warp 同时得到各自的部分和。`,
          ),
          math: `warp ${w}:  ${fmt(prod[w * W])} + ${fmt(prod[w * W + 1])} + … + ${fmt(prod[w * W + W - 1])} = ${fmt(warpSum[w])}`,
        };
      },
    },
    {
      name: L('Combine & write', '合并并写回'),
      lines: ['var total = block.sum', 'if local_i == 0', 'output[0] = total[0]'],
      scene(w) {
        return {
          rows: rows(w, 2),
          arrows: range(WARPS).map(k => arrow(at('warps', k), at('output', 0), 'move')),
          say: L(
            'Warps cannot read each other\'s registers, so the 4 warp results go through a few slots of shared memory and are added into the final total. With `broadcast=False`, only thread 0 is guaranteed to receive it, and thread 0 writes it.',
            'warp 之间不能互读寄存器，所以 4 个 warp 的结果要经过共享内存里的几个位置，再加成最终总和。因为 `broadcast=False`，只保证线程 0 拿到它，由线程 0 写出。',
          ),
          math: `output[0] = ${warpSum.map(fmt).join(' + ')} = ${fmt(total)}   (= 2·(0² + 1² + … + 127²))`,
        };
      },
    },
  ],
  result: () => [total],
  oracle: {
    file: 'p27/p27.mojo', kernel: 'block_sum_dot_product', buffer: 'output',
    launch: 'tpb = 128\ngrid = (1, 1)\nblock = (128, 1)\noutput = zeros(1)\na = arange(128)\nb = arange(128) * 2\nsize_dev = 128',
  },
};
