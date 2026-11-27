import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 25 (broadcast): lane 0 sums input[0..3], broadcasts it, every lane adds it to its element.
const W = 32;
const lanes = range(W);
const input = lanes.map(i => i + 1); // test: input_host[i] = i + 1
const shared = input.slice(0, 4).reduce((s, v) => s + v, 0); // 1 + 2 + 3 + 4 = 10
const out = input.map(v => shared + v);

function rows(sel, stage) {
  return [
    {
      id: 'input', label: 'input', kind: 'global', dense: true, cols: 8,
      cells: input.map((v, i) => cell(v, stage === 0 ? (i < 4 ? 'read' : 'muted') : stage === 2 ? (i === sel ? 'read' : 'muted') : 'muted')),
    },
    {
      id: 'lanes', label: L('lanes', 'lane'), kind: 'threads', dense: true, cols: 8,
      cells: lanes.map(i => {
        if (stage === 0) return cell(i, i === 0 ? 'focus' : 'wait', { note: i === 0 ? fmt(shared) : '0' });
        return cell(i, i === sel ? 'focus' : i === 0 ? 'active' : 'active', { note: fmt(shared) });
      }),
    },
    { id: 'output', label: 'output', kind: 'global', dense: true, cols: 8, cells: out.map((v, i) => cell(stage === 2 ? v : null, stage === 2 ? (i === sel ? 'write' : undefined) : 'muted')) },
  ];
}

export default {
  id: 'p25b',
  num: 25,
  title: L('Warp Communication', 'Warp 通信'),
  variant: L('broadcast', 'broadcast'),
  goal: L(
    'Lane 0 adds up the first 4 elements; every lane then adds that sum to its own element: `output[i] = (input[0] + … + input[3]) + input[i]`.',
    'lane 0 先把前 4 个元素加起来，然后每个 lane 把这个和加到自己的元素上：`output[i] = (input[0] + … + input[3]) + input[i]`。',
  ),
  idea: L(
    'One lane computes a value that all lanes need. `broadcast()` copies lane 0\'s register to every lane of the warp in one instruction, with no shared memory and no barrier.',
    '一个 lane 算出所有 lane 都要用的值。`broadcast()` 用一条指令把 lane 0 的寄存器复制给 warp 里每个 lane，不需要共享内存，也不需要 barrier。',
  ),
  data: {
    launch: L('1 block of 32 threads = one warp', '1 个 block，32 个线程，即一个 warp'),
    tensors: [
      { name: 'input', values: L('[1, 2, 3, …, 32]', '[1, 2, 3, …, 32]'), note: L('32 elements, input[i] = i + 1', '32 个元素，input[i] = i + 1') },
      { name: 'output', values: L('32 zeros', '32 个 0'), note: L('32 elements, starts at 0', '32 个元素，初始为 0') },
    ],
  },
  pick: { row: 'lanes', initial: 7, hint: L('Click a lane to follow the broadcast value into it.', '点击一个 lane，看广播的值如何到达它。') },
  stages: [
    {
      name: L('Lane 0 sums', 'lane 0 求和'),
      lines: ['if lane == 0', 'for i in range(4)', 'sum += input[block_start + i]', 'broadcast_value = sum'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: range(4).map(i => arrow(at('input', i), at('lanes', 0), 'read')),
          say: L(
            'Only lane 0 does this step: it reads the first 4 elements and adds them. Every other lane keeps `broadcast_value = 0` for now.',
            '只有 lane 0 做这一步：读出前 4 个元素并相加。其他 lane 此时的 `broadcast_value` 还是 0。',
          ),
          math: `lane 0:  sum = ${input.slice(0, 4).join(' + ')} = ${fmt(shared)}`,
        };
      },
    },
    {
      name: L('broadcast', 'broadcast'),
      lines: ['broadcast_value = broadcast(broadcast_value)'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          // solid to the followed lane; faint to the rest of its row of 8 as context
          arrows: lanes.filter(i => i !== 0 && (i === sel || Math.floor(i / 8) === Math.floor(sel / 8))).map(i => arrow(at('lanes', 0), at('lanes', i), 'move', i !== sel)),
          say: L(
            `\`broadcast()\` copies lane 0's register to all 32 lanes at once. Lane ${sel} now holds ${fmt(shared)} too, without touching memory.`,
            `\`broadcast()\` 一次性把 lane 0 的寄存器复制到全部 32 个 lane。lane ${sel} 现在也拿到了 ${fmt(shared)}，全程不经过内存。`,
          ),
          math: `lane ${sel}:  broadcast_value = lane 0's value = ${fmt(shared)}`,
        };
      },
    },
    {
      name: L('Add & write', '相加并写回'),
      lines: ['output[global_i] = broadcast_value + input[global_i]'],
      scene(sel) {
        return {
          rows: rows(sel, 2),
          arrows: [arrow(at('input', sel), at('lanes', sel), 'read'), ...lanes.map(i => arrow(at('lanes', i), at('output', i), 'write', i !== sel))],
          say: L(
            `Every lane adds the shared value to its own element and writes the result.`,
            '每个 lane 把这个共同的值加到自己的元素上，再写出结果。',
          ),
          math: `output[${sel}] = ${fmt(shared)} + input[${sel}] = ${fmt(shared)} + ${fmt(input[sel])} = ${fmt(out[sel])}`,
        };
      },
    },
  ],
  result: () => out,
  oracle: {
    file: 'p25/p25.mojo', kernel: 'basic_broadcast', buffer: 'output',
    launch: 'size = 32\ngrid = (1, 1)\nblock = (32, 1)\noutput = zeros(32)\ninput = arange(32) + 1',
  },
};
