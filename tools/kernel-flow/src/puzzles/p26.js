import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 26: maximum of 32 values with a shuffle_xor butterfly, one warp.
const W = 32;
const lanes = range(W);
const input = lanes.map(i => (i === W - 1 ? 1000 : i * 2)); // test: input_host[i] = 2i, input_host[31] = 1000
const offsets = [16, 8, 4, 2, 1];
// vals[0] = loaded values; vals[k] = after the round with offset offsets[k-1]
const vals = [input.slice()];
for (const o of offsets) {
  const prev = vals[vals.length - 1];
  vals.push(prev.map((v, i) => Math.max(v, prev[i ^ o])));
}
const out = vals[offsets.length];

function rows(sel, round, writing) {
  // round: 0 = after load, k = after offset round k
  const o = round > 0 && !writing ? offsets[round - 1] : null;
  return [
    { id: 'input', label: 'input', kind: 'global', dense: true, cols: 8, cells: input.map((v, i) => cell(v, round === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'lanes', label: L('lanes', 'lane'), kind: 'threads', dense: true, cols: 8,
      cells: lanes.map(i => cell(i, i === sel ? 'focus' : o != null && i === (sel ^ o) ? 'active' : 'muted', { note: fmt(vals[round][i]) })),
    },
    { id: 'output', label: 'output', kind: 'global', dense: true, cols: 8, cells: out.map((v, i) => cell(writing ? v : null, writing ? (i === sel ? 'write' : undefined) : 'muted')) },
  ];
}

const round = k => {
  const o = offsets[k - 1];
  return {
    name: L(`XOR ${o}`, `XOR ${o}`),
    lines: ['var offset = WARP_SIZE // 2', 'while offset > 0', 'max_val = max(max_val, shuffle_xor', 'offset //= 2'],
    scene(sel) {
      const p = sel ^ o;
      const arrows = [];
      // the followed pair both ways, solid; the other lanes in the same row of 8, faint, as context
      arrows.push(arrow(at('lanes', p), at('lanes', sel), 'move'), arrow(at('lanes', sel), at('lanes', p), 'move'));
      for (const i of lanes) if (i !== sel && i !== p && Math.floor(i / 8) === Math.floor(sel / 8)) arrows.push(arrow(at('lanes', i ^ o), at('lanes', i), 'move', true));
      const span = 2 ** k;
      return {
        rows: rows(sel, k, false),
        arrows,
        say: L(
          `Every lane swaps its current maximum with the lane whose number differs in one bit: its partner is lane XOR ${o}. Lane ${sel} pairs with lane ${p}, and both keep the larger value. After this round each lane holds the maximum of a group of ${span} lanes${k === offsets.length ? ', which is now the whole warp' : ''}.`,
          `每个 lane 和编号只差一位的 lane 交换当前最大值：搭档是 lane XOR ${o}。lane ${sel} 和 lane ${p} 配对，两者都保留较大的值。这一轮之后，每个 lane 都持有 ${span} 个 lane 一组中的最大值${k === offsets.length ? '，也就是整个 warp 的最大值' : ''}。`,
        ),
        math: `lane ${sel}:  partner = ${sel} XOR ${o} = ${p}\nmax_val = max(${fmt(vals[k - 1][sel])}, ${fmt(vals[k - 1][p])}) = ${fmt(vals[k][sel])}`,
      };
    },
  };
};

export default {
  id: 'p26',
  num: 26,
  title: L('Advanced Warp Patterns', '高级 Warp 模式'),
  variant: L('shuffle_xor butterfly', 'shuffle_xor 蝴蝶网络'),
  goal: L(
    'Find the maximum of 32 values and give it to every lane: `output[i] = max(input)` for all i.',
    '找出 32 个值中的最大值，并让每个 lane 都拿到它：对所有 i，`output[i] = max(input)`。',
  ),
  idea: L(
    'In each round, every lane exchanges with a partner whose lane number differs in one bit (`shuffle_xor`) and keeps the larger value. With partners 16, 8, 4, 2, 1 apart, 5 rounds (log₂ 32) are enough, and unlike a tree, every lane ends up with the answer, not just lane 0.',
    '每一轮，每个 lane 和编号只差一位的搭档交换数据（`shuffle_xor`），保留较大的值。搭档距离依次为 16、8、4、2、1，5 轮（log₂ 32）就够了；而且和树形归约不同，最后每个 lane 都拿到答案，而不只是 lane 0。',
  ),
  data: {
    launch: L('1 block of 32 threads = one warp', '1 个 block，32 个线程，即一个 warp'),
    tensors: [
      { name: 'input', values: L('[0, 2, 4, …, 60, 1000]', '[0, 2, 4, …, 60, 1000]'), note: L('input[i] = 2i, except the last element is 1000', 'input[i] = 2i，只有最后一个元素是 1000') },
      { name: 'output', values: L('32 zeros', '32 个 0'), note: L('32 elements, starts at 0', '32 个元素，初始为 0') },
    ],
  },
  pick: { row: 'lanes', initial: 5, hint: L('Click a lane to follow its partners round by round.', '点击一个 lane，逐轮跟踪它的搭档。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['var max_val = input[global_i]'],
      scene(sel) {
        return {
          rows: rows(sel, 0, false),
          arrows: lanes.map(i => arrow(at('input', i), at('lanes', i), 'read', i !== sel)),
          say: L(
            'Each lane starts with its own element as its current maximum (the small number under the lane).',
            '每个 lane 先把自己的元素当作当前最大值（lane 下面的小数字）。',
          ),
          math: `lane ${sel}:  max_val = input[${sel}] = ${fmt(input[sel])}`,
        };
      },
    },
    ...offsets.map((_, i) => round(i + 1)),
    {
      name: L('Write', '写回'),
      lines: ['output[global_i] = max_val'],
      scene(sel) {
        return {
          rows: rows(sel, offsets.length, true),
          arrows: lanes.map(i => arrow(at('lanes', i), at('output', i), 'write', i !== sel)),
          say: L('Every lane holds the warp\'s maximum, so every lane writes it.', '每个 lane 都持有整个 warp 的最大值，所以每个 lane 都把它写出。'),
          math: `output[${sel}] = max_val = ${fmt(out[sel])}`,
        };
      },
    },
  ],
  result: () => out,
  oracle: {
    file: 'p26/p26.mojo', kernel: 'butterfly_parallel_max', buffer: 'output',
    launch: 'size = 32\ngrid = (1, 1)\nblock = (32, 1)\noutput = zeros(32)\ninput = concat(arange(31) * 2, 1000)',
  },
};
