import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 27 (broadcast): divide every element by the mean, with block.sum() then block.broadcast().
// The input/output rows zoom into the selected warp's 32 elements; the thread row shows only
// thread 0 (which computes the mean) and the followed thread.
const N = 128, W = 32, WARPS = N / W;
const input = range(N).map(i => (i % 8) + 1); // test: values cycle 1..8
const warpSum = range(WARPS).map(w => input.slice(w * W, (w + 1) * W).reduce((s, v) => s + v, 0));
const total = warpSum.reduce((s, v) => s + v, 0); // 576
const mean = total / N; // 4.5
const out = input.map(v => Math.fround(v / mean));
const show = v => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const LANE = 5;
const followed = w => w * W + LANE; // follow lane 5 of the selected warp

function rows(w, stage) {
  const t = followed(w);
  const seg = range(W).map(l => w * W + l);
  return [
    {
      id: 'warps', label: L('warp sums', 'warp 部分和'), kind: 'shared',
      cells: warpSum.map((v, k) => cell(stage === 0 ? v : stage >= 1 ? v : null, stage === 0 ? (k === w ? 'write' : 'focus') : 'muted', { idx: `w${k}` })),
    },
    {
      id: 'input', label: L(`input_data (warp ${w})`, `input_data（warp ${w}）`), kind: 'global', dense: true, cols: 8,
      cells: seg.map(g => cell(input[g], g === t ? (stage === 3 ? 'read' : 'focus') : stage === 0 ? undefined : 'muted', { idx: String(g) })),
    },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: [0, t].map(x => {
        const note = stage === 0 ? (x === 0 ? `Σ=${fmt(total)}` : undefined) : stage === 1 ? (x === 0 ? `μ=${mean}` : 'μ=1.0') : `μ=${mean}`;
        return cell(x, x === 0 && stage <= 1 ? 'focus' : x === t ? 'focus' : 'active', { note });
      }),
    },
    {
      id: 'output', label: L(`output_data (warp ${w})`, `output_data（warp ${w}）`), kind: 'global', dense: true, cols: 8,
      cells: seg.map(g => cell(stage === 3 ? show(out[g]) : null, stage === 3 ? (g === t ? 'write' : undefined) : 'muted', { idx: String(g) })),
    },
  ];
}

export default {
  id: 'p27b',
  num: 27,
  title: L('Block-Wide Patterns', 'Block 级模式'),
  variant: L('block.broadcast', 'block.broadcast'),
  goal: L(
    'Divide every element by the mean of all 128 elements: `output[i] = input[i] / mean(input)`.',
    '把每个元素除以全部 128 个元素的平均值：`output[i] = input[i] / mean(input)`。',
  ),
  idea: L(
    'This needs both directions of communication: all-to-one to get the sum (`block.sum()`), then one-to-all to share the mean (`block.broadcast()`). Thread 0 computes the mean once, and every thread in every warp receives it.',
    '这里需要两个方向的通信：先"所有线程到一个线程"求和（`block.sum()`），再"一个线程到所有线程"分发平均值（`block.broadcast()`）。线程 0 只算一次平均值，每个 warp 里的每个线程都能收到。',
  ),
  data: {
    launch: L('1 block of 128 threads = 4 warps of 32', '1 个 block，128 个线程 = 4 个 warp，每个 32 线程'),
    tensors: [
      { name: 'input_data', values: L('[1, 2, …, 8, 1, 2, …, 8, …]', '[1, 2, …, 8, 1, 2, …, 8, …]'), note: L('128 elements cycling 1–8; their mean is 4.5', '128 个元素，在 1–8 之间循环；平均值是 4.5') },
      { name: 'output_data', values: L('128 zeros', '128 个 0'), note: L('128 elements, starts at 0', '128 个元素，初始为 0') },
      { name: 'size', values: 'Int = 128', note: L('number of elements', '元素个数') },
    ],
  },
  pick: { row: 'warps', initial: 1, hint: L('Click a warp sum to look inside that warp.', '点击一个 warp 部分和，查看这个 warp 内部。') },
  stages: [
    {
      name: L('block.sum', 'block.sum'),
      lines: ['var my_value', 'my_value = input_data[global_i][0]', 'var total_sum = block.sum'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 0),
          arrows: [
            ...range(W).map(l => arrow(at('input', l), at('warps', w), 'move', l !== LANE)),
            ...range(WARPS).map(k => arrow(at('warps', k), at('threads', 0), 'move')),
          ],
          say: L(
            `Each thread loads one element; \`block.sum()\` adds them per warp and then across the 4 warps. Thread 0 receives the total. Shown: the 32 elements of warp ${w}, including thread ${t}'s.`,
            `每个线程读入一个元素；\`block.sum()\` 先在每个 warp 内相加，再把 4 个 warp 的结果合起来，线程 0 拿到总和。图中是 warp ${w} 的 32 个元素，包括线程 ${t} 的那个。`,
          ),
          math: `total_sum = ${warpSum.map(fmt).join(' + ')} = ${fmt(total)}`,
        };
      },
    },
    {
      name: L('Mean', '平均值'),
      lines: ['var mean_value', 'if local_i == 0', 'mean_value = total_sum[0] / Scalar[dtype](size)'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 1),
          arrows: [],
          say: L(
            `Only thread 0 divides the total by the number of elements. Every other thread, including thread ${t}, still has the default \`mean_value = 1.0\`.`,
            `只有线程 0 用总和除以元素个数。其他线程（包括线程 ${t}）的 \`mean_value\` 仍是默认的 1.0。`,
          ),
          math: `thread 0:  mean_value = ${fmt(total)} / ${N} = ${mean}`,
        };
      },
    },
    {
      name: L('block.broadcast', 'block.broadcast'),
      lines: ['var broadcasted_mean = block.broadcast'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 2),
          arrows: [arrow(at('threads', 0), at('threads', 1), 'move')],
          say: L(
            `\`block.broadcast(src_thread=0)\` copies thread 0's mean to all 128 threads. Thread 0 is in warp 0 and thread ${t} is in warp ${w}${w === 0 ? '' : ', so the value crosses warps'}; thread ${t} now has ${mean} instead of 1.0.`,
            `\`block.broadcast(src_thread=0)\` 把线程 0 的平均值复制给全部 128 个线程。线程 0 在 warp 0，线程 ${t} 在 warp ${w}${w === 0 ? '' : '，所以这个值跨越了 warp'}；线程 ${t} 现在拿到的是 ${mean}，而不是 1.0。`,
          ),
          math: `thread ${t}:  broadcasted_mean = thread 0's mean_value = ${mean}`,
        };
      },
    },
    {
      name: L('Normalize', '归一化'),
      lines: ['var normalized_value = my_value / broadcasted_mean[0]', 'output_data[global_i] = normalized_value'],
      scene(w) {
        const t = followed(w);
        return {
          rows: rows(w, 3),
          arrows: [arrow(at('input', LANE), at('threads', 1), 'read'), arrow(at('threads', 1), at('output', LANE), 'write')],
          say: L(
            'Every thread divides its own element by the shared mean and writes the result. The outputs now average exactly 1.',
            '每个线程用共同的平均值去除自己的元素并写出结果。现在输出的平均值正好是 1。',
          ),
          math: `output_data[${t}] = ${input[t]} / ${mean} = ${show(out[t])}`,
        };
      },
    },
  ],
  result: () => out,
  oracle: {
    file: 'p27/p27.mojo', kernel: 'block_normalize_vector', buffer: 'output_data',
    launch: 'tpb = 128\ngrid = (1, 1)\nblock = (128, 1)\ninput_data = repeat(arange(8) + 1, 16)\noutput_data = zeros(128)\nsize_dev = 128',
  },
};
