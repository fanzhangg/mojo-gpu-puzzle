import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 25: neighbor difference with shuffle_down, one warp.
const W = 32;
const lanes = range(W);
const input = lanes.map(i => i * i); // test: input_host[i] = i * i
const next = i => (i < W - 1 ? input[i + 1] : null);
const out = lanes.map(i => (i < W - 1 ? input[i + 1] - input[i] : 0));

function rows(sel, stage) {
  return [
    { id: 'input', label: 'input', kind: 'global', dense: true, cols: 8, cells: input.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'lanes', label: L('lanes', 'lane'), kind: 'threads', dense: true, cols: 8,
      cells: lanes.map(i => {
        let note = fmt(input[i]);
        if (stage >= 1) note = i === W - 1 ? '—' : fmt(next(i));
        return cell(i, i === sel ? 'focus' : i === W - 1 && stage >= 1 ? 'idle' : 'active', { note });
      }),
    },
    { id: 'output', label: 'output', kind: 'global', dense: true, cols: 8, cells: out.map((v, i) => cell(stage === 2 ? v : null, stage === 2 ? (i === sel ? 'write' : undefined) : 'muted')) },
  ];
}

export default {
  id: 'p25',
  num: 25,
  title: L('Warp Communication', 'Warp 通信'),
  variant: L('shuffle_down', 'shuffle_down'),
  goal: L(
    'Compute the difference to the next element, `output[i] = input[i+1] − input[i]`, inside one warp.',
    '在一个 warp 内计算相邻元素的差：`output[i] = input[i+1] − input[i]`。',
  ),
  idea: L(
    'Each lane needs its right neighbour\'s value. Instead of writing everything to shared memory and waiting at a barrier, `shuffle_down(val, 1)` hands each lane the register of the lane one place to its right. The last lane has no neighbour inside the warp.',
    '每个 lane 需要右边邻居的值。不用先把所有值写进共享内存再等 barrier，`shuffle_down(val, 1)` 直接把右边一个 lane 的寄存器值交给自己。最后一个 lane 在 warp 内没有右邻居。',
  ),
  data: {
    launch: L('1 block of 32 threads = one warp', '1 个 block，32 个线程，即一个 warp'),
    tensors: [
      { name: 'input', values: L('[0, 1, 4, 9, …, 961]', '[0, 1, 4, 9, …, 961]'), note: L('32 elements, input[i] = i²', '32 个元素，input[i] = i²') },
      { name: 'output', values: L('32 zeros', '32 个 0'), note: L('32 elements, starts at 0', '32 个元素，初始为 0') },
    ],
  },
  pick: { row: 'lanes', initial: 4, hint: L('Click a lane. Try lane 31, the last one.', '点击一个 lane。试试最后一个 lane 31。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['var current_val = input[global_i]'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: lanes.map(i => arrow(at('input', i), at('lanes', i), 'read', i !== sel)),
          say: L(
            'Each lane reads one element into its register (the small number under the lane).',
            '每个 lane 把一个元素读进自己的寄存器（lane 下面的小数字）。',
          ),
          math: `lane ${sel}:  current_val = input[${sel}] = ${fmt(input[sel])}`,
        };
      },
    },
    {
      name: L('shuffle_down', 'shuffle_down'),
      lines: ['var next_val = shuffle_down(current_val, 1)'],
      scene(sel) {
        const arrows = lanes.filter(i => i < W - 1).map(i => arrow(at('lanes', i + 1), at('lanes', i), 'move', i !== sel));
        return {
          rows: rows(sel, 1),
          arrows,
          say: sel < W - 1
            ? L(
                `Every lane receives the value of the lane one place to its right, register to register. Lane ${sel} gets lane ${sel + 1}'s value. All 32 lanes do this in the same instruction.`,
                `每个 lane 收到右边一个 lane 的值，直接从寄存器到寄存器。lane ${sel} 拿到 lane ${sel + 1} 的值。32 个 lane 在同一条指令里同时完成。`,
              )
            : L(
                'Lane 31 is the last lane in the warp, so there is no lane to its right; the value it gets back is not a real neighbour.',
                'lane 31 是 warp 里最后一个 lane，右边没有 lane 了，它拿到的值不是真正的邻居。',
              ),
          math: sel < W - 1 ? `lane ${sel}:  next_val = shuffle_down(current_val, 1) = lane ${sel + 1}'s value = ${fmt(next(sel))}` : `lane 31:  no lane 32 in this warp`,
        };
      },
    },
    {
      name: L('Subtract', '相减'),
      lines: ['if lane < WARP_SIZE - 1', 'output[global_i] = next_val - current_val', 'output[global_i] = 0'],
      scene(sel) {
        return {
          rows: rows(sel, 2),
          arrows: lanes.map(i => arrow(at('lanes', i), at('output', i), 'write', i !== sel)),
          say: sel < W - 1
            ? L(
                `Lane ${sel} subtracts its own value from its neighbour's and writes the difference. With input = i², the difference is always 2i + 1.`,
                `lane ${sel} 用邻居的值减去自己的值并写出差。因为 input = i²，差总是 2i + 1。`,
              )
            : L('The last lane has no neighbour, so the `else` branch writes 0.', '最后一个 lane 没有邻居，所以 `else` 分支写入 0。'),
          math: sel < W - 1 ? `output[${sel}] = ${fmt(next(sel))} − ${fmt(input[sel])} = ${fmt(out[sel])}` : 'output[31] = 0',
        };
      },
    },
  ],
  result: () => out,
  oracle: {
    file: 'p25/p25.mojo', kernel: 'neighbor_difference', buffer: 'output',
    launch: 'size = 32\ngrid = (1, 1)\nblock = (32, 1)\noutput = zeros(32)\ninput = arange(32) * arange(32)',
  },
};
