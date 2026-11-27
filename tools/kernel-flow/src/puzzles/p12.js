import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 12: dot product with a shared-memory tree reduction, one block of 8 threads.
const TPB = 8;
const a = range(TPB); // main(): a_host[i] = i
const b = range(TPB); // main(): b_host[i] = i
const strides = [4, 2, 1];
// levels[0] = products; levels[k] = after the round with stride strides[k-1]
const levels = [a.map((x, i) => x * b[i])];
for (const s of strides) {
  const prev = levels[levels.length - 1];
  levels.push(prev.map((v, i) => (i < s ? v + prev[i + s] : v)));
}
const total = levels[3][0];
// where thread j's product sits after each round
const path = j => [j, ...strides.map(s => j % s)].map((idx, k) => ({ level: k, idx }));
const onPath = (j, level, idx) => path(j)[level].idx === idx;

function rows(sel, stage) {
  const out = [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    { id: 'b', label: 'b', kind: 'global', cells: b.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: range(TPB).map(t => {
        if (stage === 0) return cell(t, t === sel ? 'focus' : 'active');
        if (stage <= 3) {
          const s = strides[stage - 1];
          const busy = t < s;
          return cell(t, busy ? (t === path(sel)[stage].idx ? 'focus' : 'active') : 'idle', busy ? undefined : { note: L('idle', '空闲') });
        }
        return cell(t, t === 0 ? 'focus' : 'idle');
      }),
    },
  ];
  // the tree: one row per round, revealed as the stages advance
  const shown = Math.min(stage, 3);
  for (let k = 0; k <= shown; k++) {
    const live = k === 0 ? TPB : strides[k - 1];
    out.push({
      id: `L${k}`,
      label: k === 0 ? 'shared' : L(`stride ${strides[k - 1]}`, `步长 ${strides[k - 1]}`),
      kind: 'shared',
      cells: levels[k].map((v, i) => {
        if (i >= live) return cell(null, 'muted');
        const mine = onPath(sel, k, i);
        const tone = k === shown && stage <= 3 ? (mine ? 'write' : 'focus') : mine ? 'focus' : 'muted';
        return cell(v, tone);
      }),
    });
  }
  out.push({ id: 'output', label: 'output', kind: 'global', cells: [cell(stage === 4 ? total : null, stage === 4 ? 'write' : 'muted')] });
  return out;
}

// arrows for every round up to k: the tree so far, with the followed product's path drawn solid
function treeArrows(sel, k) {
  const out = [];
  for (let r = 1; r <= k; r++) {
    const s = strides[r - 1];
    for (const i of range(s)) {
      const here = onPath(sel, r, i);
      out.push(arrow(at(`L${r - 1}`, i), at(`L${r}`, i), 'move', !(here && onPath(sel, r - 1, i))), arrow(at(`L${r - 1}`, i + s), at(`L${r}`, i), 'move', !(here && onPath(sel, r - 1, i + s))));
    }
  }
  return out;
}

const round = k => ({
  name: L(`Stride ${strides[k - 1]}`, `步长 ${strides[k - 1]}`),
  lines: ['while stride > 0', 'if local_i < stride', 'shared[local_i] += shared[local_i + stride]', 'stride //= 2'],
  scene(sel) {
    const s = strides[k - 1];
    const me = path(sel)[k].idx, from = path(sel)[k - 1].idx;
    const prev = levels[k - 1];
    const workers = s === 1 ? L('Thread 0 adds the value 1 place to its right', '线程 0 把右边 1 格的值加到自己的格子里') : L(`Threads 0–${s - 1} each add the value ${s} places to their right`, `线程 0–${s - 1} 各自把右边第 ${s} 格的值加到自己的格子里`);
    return {
      rows: rows(sel, k),
      arrows: treeArrows(sel, k),
      say: L(
        `${workers.en}; threads ${s}–${TPB - 1} have nothing left to do and sit idle. A \`barrier()\` after every round makes sure the next round reads finished sums.${k === 3 ? ` After log₂ ${TPB} = 3 rounds, \`shared[0]\` holds the total.` : ''}`,
        `${workers.zh}；线程 ${s}–${TPB - 1} 没有事做，保持空闲。每轮之后的 \`barrier()\` 确保下一轮读到的是已经加完的和。${k === 3 ? `经过 log₂ ${TPB} = 3 轮，\`shared[0]\` 里就是总和。` : ''}`,
      ),
      math: L(
        `thread ${me}:  shared[${me}] = ${fmt(prev[me])} + ${fmt(prev[me + s])} = ${fmt(levels[k][me])}${from !== me ? `\n# thread ${sel}'s product (in cell ${from}) is now part of cell ${me}` : ''}`,
        `线程 ${me}：  shared[${me}] = ${fmt(prev[me])} + ${fmt(prev[me + s])} = ${fmt(levels[k][me])}${from !== me ? `\n# 线程 ${sel} 的乘积（在第 ${from} 格）现在并入了第 ${me} 格` : ''}`,
      ),
    };
  },
});

export default {
  id: 'p12',
  num: 12,
  title: L('Dot Product', '点积'),
  goal: L(
    'Compute one number, `output[0] = a[0]·b[0] + a[1]·b[1] + … + a[7]·b[7]`, with 8 threads.',
    '用 8 个线程算出一个数：`output[0] = a[0]·b[0] + a[1]·b[1] + … + a[7]·b[7]`。',
  ),
  idea: L(
    'Each thread multiplies one pair. Adding the 8 products one by one would take 7 steps on a single thread, so the block halves the problem every round instead: 4 threads add pairs, then 2, then 1. It takes 3 rounds, and the shape of the work is a tree.',
    '每个线程先算一对乘积。如果由一个线程把 8 个乘积依次相加，需要 7 步；所以 block 每轮把问题规模减半：先 4 个线程两两相加，再 2 个，再 1 个。只要 3 轮，整个计算的形状是一棵树。',
  ),
  data: {
    launch: L('1 block of 8 threads', '1 个 block，8 个线程'),
    tensors: [
      { name: 'a', values: a, note: L('a[i] = i', 'a[i] = i') },
      { name: 'b', values: b, note: L('b[i] = i, so each product a[i]·b[i] = i²', 'b[i] = i，所以每个乘积 a[i]·b[i] = i²') },
      { name: 'output', values: [0], note: L('1 element, filled by the kernel', '1 个元素，由 kernel 写入') },
    ],
  },
  pick: { row: 'threads', initial: 5, hint: L('Click a thread to follow its product up the tree.', '点击一个线程，跟踪它的乘积沿树向上合并的路径。') },
  stages: [
    {
      name: L('Multiply', '相乘'),
      lines: ['shared[local_i] = rebind', 'barrier()'],
      scene(sel) {
        const arrows = range(TPB).flatMap(i => [
          arrow(at('a', i), at('threads', i), 'read', i !== sel),
          arrow(at('b', i), at('threads', i), 'read', i !== sel),
          arrow(at('threads', i), at('L0', i), 'write', i !== sel),
        ]);
        return {
          rows: rows(sel, 0),
          arrows,
          say: L(
            'Every thread multiplies one pair and stores the product in shared memory, so the whole block can see all 8 products. `barrier()` waits until all of them are there.',
            '每个线程算一对乘积并存进共享内存，这样整个 block 都能看到 8 个乘积。`barrier()` 等到它们全部写好。',
          ),
          math: `shared[${sel}] = a[${sel}]·b[${sel}] = ${fmt(a[sel])}·${fmt(b[sel])} = ${fmt(levels[0][sel])}`,
        };
      },
    },
    round(1),
    round(2),
    round(3),
    {
      name: L('Write', '写回'),
      lines: ['if local_i == 0', 'output[0] = shared[0]'],
      scene(sel) {
        return {
          rows: rows(sel, 4),
          arrows: [...treeArrows(sel, 3), arrow(at('L3', 0), at('output', 0), 'write')],
          say: L('Only thread 0 writes the answer; one write is all that is needed.', '只有线程 0 写出结果，一次写入就够了。'),
          math: `output[0] = shared[0] = ${fmt(total)}   (= 0² + 1² + … + 7²)`,
        };
      },
    },
  ],
  result: () => [total],
  oracle: { file: 'p12/p12.mojo', kernel: 'dot_product', buffer: 'output' },
};
