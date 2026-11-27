import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 24: dot product of two 32-element vectors with one warp and warp.sum().
const W = 32;
const lanes = range(W);
const a = range(W); // test: a_host[i] = i
const b = range(W); // test: b_host[i] = i
const prod = lanes.map(i => a[i] * b[i]);
const total = prod.reduce((s, v) => s + v, 0);

function rows(sel, stage) {
  return [
    { id: 'a', label: 'a', kind: 'global', dense: true, cols: 8, cells: a.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    { id: 'b', label: 'b', kind: 'global', dense: true, cols: 8, cells: b.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'lanes', label: L('lanes', 'lane'), kind: 'threads', dense: true, cols: 8,
      cells: lanes.map(i => {
        const note = stage === 0 ? fmt(prod[i]) : stage === 1 ? (i === sel ? fmt(total) : 'Σ') : undefined;
        if (stage === 2) return cell(i, i === 0 ? 'focus' : 'idle', { note: i === 0 ? fmt(total) : undefined });
        return cell(i, i === sel ? 'focus' : 'active', { note });
      }),
    },
    { id: 'output', label: 'output', kind: 'global', cells: [cell(stage === 2 ? total : null, stage === 2 ? 'write' : 'muted')] },
  ];
}

export default {
  id: 'p24',
  num: 24,
  title: L('Warp Sum', 'Warp 求和'),
  goal: L(
    'Compute the dot product of two 32-element vectors, `output[0] = a[0]·b[0] + … + a[31]·b[31]`, with one warp.',
    '用一个 warp 计算两个 32 元素向量的点积：`output[0] = a[0]·b[0] + … + a[31]·b[31]`。',
  ),
  idea: L(
    'A warp is 32 threads that the hardware runs in lockstep, and they can read each other\'s registers directly. So `warp_sum()` adds 32 values without shared memory and without a single `barrier()`; compare Puzzle 12, which needed a shared-memory tree and a barrier after every round.',
    'warp 是硬件同步执行的 32 个线程，它们可以直接读取彼此的寄存器。所以 `warp_sum()` 不用共享内存、也不用任何 `barrier()` 就能把 32 个值加起来；对比第 12 题，那里需要共享内存里的树形归约，每轮之后还要一次 barrier。',
  ),
  data: {
    launch: L('1 block of 32 threads = exactly one warp', '1 个 block，32 个线程，正好一个 warp'),
    tensors: [
      { name: 'a', values: L('[0, 1, 2, …, 31]', '[0, 1, 2, …, 31]'), note: L('32 elements, a[i] = i', '32 个元素，a[i] = i') },
      { name: 'b', values: L('[0, 1, 2, …, 31]', '[0, 1, 2, …, 31]'), note: L('b[i] = i, so each product is i²', 'b[i] = i，所以每个乘积是 i²') },
      { name: 'output', values: [0], note: L('1 element, written by lane 0', '1 个元素，由 lane 0 写入') },
    ],
  },
  pick: { row: 'lanes', initial: 5, hint: L('Click a lane to follow its product.', '点击一个 lane，跟踪它的乘积。') },
  stages: [
    {
      name: L('Multiply', '相乘'),
      lines: ['var partial_product', 'partial_product = rebind'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: lanes.flatMap(i => [arrow(at('a', i), at('lanes', i), 'read', i !== sel), arrow(at('b', i), at('lanes', i), 'read', i !== sel)]),
          say: L(
            'Each of the 32 lanes multiplies one pair and keeps the product in its own register (the small number under each lane). Nothing is written to memory.',
            '32 个 lane 各算一对乘积，结果放在自己的寄存器里（每个 lane 下面的小数字），不写入任何内存。',
          ),
          math: `lane ${sel}:  partial_product = a[${sel}]·b[${sel}] = ${a[sel]}·${b[sel]} = ${fmt(prod[sel])}`,
        };
      },
    },
    {
      name: L('warp_sum', 'warp_sum'),
      lines: ['var total = warp_sum(partial_product)'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          arrows: lanes.filter(i => i !== sel).map(i => arrow(at('lanes', i), at('lanes', sel), 'move', true)),
          say: L(
            `\`warp_sum()\` adds the 32 registers across the warp and gives the total to every lane, including lane ${sel} (the arrows show where its total comes from). There is no shared memory and no \`barrier()\`: the lanes already run in lockstep.`,
            `\`warp_sum()\` 把整个 warp 的 32 个寄存器加起来，并把总和交给每一个 lane，包括 lane ${sel}（箭头表示它的总和来自哪里）。这里没有共享内存，也没有 \`barrier()\`：这些 lane 本来就是同步执行的。`,
          ),
          math: `total = ${prod.slice(0, 3).map(fmt).join(' + ')} + … + ${fmt(prod[W - 1])} = ${fmt(total)}   (0² + 1² + … + 31²)`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['if lane_id() == 0', 'output.store'],
      scene() {
        return {
          rows: rows(0, 2),
          arrows: [arrow(at('lanes', 0), at('output', 0), 'write')],
          say: L(
            'Every lane holds the same total, so one write is enough: only lane 0 stores it.',
            '每个 lane 手里都是同一个总和，所以写一次就够了：只有 lane 0 把它存下来。',
          ),
          math: `output[0] = total = ${fmt(total)}`,
        };
      },
    },
  ],
  result: () => [total],
  oracle: {
    file: 'p24/p24.mojo', kernel: 'simple_warp_dot_product', buffer: 'output',
    launch: 'size = 32\ngrid = (1, 1)\nblock = (32, 1)\noutput = zeros(1)\na = arange(32)\nb = arange(32)',
  },
};
