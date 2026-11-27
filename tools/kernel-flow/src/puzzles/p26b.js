import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 26 (prefix sum): inclusive scan of 32 values with warp prefix_sum, one warp.
const W = 32;
const lanes = range(W);
const input = lanes.map(i => i + 1); // test: input_host[i] = i + 1
const scan = [];
input.reduce((s, v, i) => (scan[i] = s + v), 0);

function rows(sel, stage) {
  return [
    { id: 'input', label: 'input', kind: 'global', dense: true, cols: 8, cells: input.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'lanes', label: L('lanes', 'lane'), kind: 'threads', dense: true, cols: 8,
      cells: lanes.map(i => {
        const note = fmt(stage === 0 ? input[i] : scan[i]);
        if (stage === 1) return cell(i, i === sel ? 'focus' : i < sel ? 'active' : 'muted', { note });
        return cell(i, i === sel ? 'focus' : 'active', { note });
      }),
    },
    { id: 'output', label: 'output', kind: 'global', dense: true, cols: 8, cells: scan.map((v, i) => cell(stage === 2 ? v : null, stage === 2 ? (i === sel ? 'write' : undefined) : 'muted')) },
  ];
}

export default {
  id: 'p26b',
  num: 26,
  title: L('Advanced Warp Patterns', '高级 Warp 模式'),
  variant: L('prefix_sum', 'prefix_sum'),
  goal: L(
    'Running total: `output[i] = input[0] + input[1] + … + input[i]`, for 32 values in one warp.',
    '求前缀和：对一个 warp 中的 32 个值，`output[i] = input[0] + input[1] + … + input[i]`。',
  ),
  idea: L(
    'Each lane needs the sum of its own value and every lane to its left. `prefix_sum()` does this across the warp\'s registers in one call; Puzzle 14 needed shared memory and a barrier after every step for the same result. The idea is the same offset-1, 2, 4, … scan as Puzzle 14, with lanes passing values by shuffle instead of through shared memory.',
    '每个 lane 需要自己和左边所有 lane 的值之和。`prefix_sum()` 一次调用就在 warp 的寄存器之间完成；第 14 题为了同样的结果，需要共享内存，而且每一步之后都要 barrier。思路和第 14 题偏移 1、2、4……的扫描相同，只是 lane 之间用 shuffle 传值，而不经过共享内存。',
  ),
  data: {
    launch: L('1 block of 32 threads = one warp', '1 个 block，32 个线程，即一个 warp'),
    tensors: [
      { name: 'input', values: L('[1, 2, 3, …, 32]', '[1, 2, 3, …, 32]'), note: L('32 elements, input[i] = i + 1', '32 个元素，input[i] = i + 1') },
      { name: 'output', values: L('32 zeros', '32 个 0'), note: L('32 elements, starts at 0', '32 个元素，初始为 0') },
    ],
  },
  pick: { row: 'lanes', initial: 5, hint: L('Click a lane to see which lanes feed its running total.', '点击一个 lane，看它的前缀和由哪些 lane 组成。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['var current_val = rebind'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: lanes.map(i => arrow(at('input', i), at('lanes', i), 'read', i !== sel)),
          say: L('Each lane reads one element into its register.', '每个 lane 把一个元素读进自己的寄存器。'),
          math: `lane ${sel}:  current_val = input[${sel}] = ${fmt(input[sel])}`,
        };
      },
    },
    {
      name: L('prefix_sum', 'prefix_sum'),
      lines: ['var scan_result = prefix_sum[exclusive=False](current_val)'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          arrows: range(sel).map(i => arrow(at('lanes', i), at('lanes', sel), 'move')),
          say: L(
            `\`prefix_sum()\` gives each lane the sum of its own value and all lanes to its left (inclusive). Lane ${sel} adds lanes 0–${sel}; lanes to its right do not affect it.`,
            `\`prefix_sum()\` 让每个 lane 得到自己和左边所有 lane 的值之和（包含自己）。lane ${sel} 加的是 lane 0–${sel}，右边的 lane 不影响它。`,
          ),
          math: `lane ${sel}:  scan_result = ${input.slice(0, sel + 1).length > 6 ? `${input.slice(0, 3).join(' + ')} + … + ${input[sel]}` : input.slice(0, sel + 1).join(' + ')} = ${fmt(scan[sel])}`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['output[global_i] = scan_result'],
      scene(sel) {
        return {
          rows: rows(sel, 2),
          arrows: lanes.map(i => arrow(at('lanes', i), at('output', i), 'write', i !== sel)),
          say: L('Every lane writes its own running total.', '每个 lane 写出自己的前缀和。'),
          math: `output[${sel}] = ${fmt(scan[sel])}`,
        };
      },
    },
  ],
  result: () => scan,
  oracle: {
    file: 'p26/p26.mojo', kernel: 'warp_inclusive_prefix_sum', buffer: 'output',
    launch: 'size = 32\ngrid = (1, 1)\nblock = (32, 1)\noutput = zeros(32)\ninput = arange(32) + 1',
  },
};
