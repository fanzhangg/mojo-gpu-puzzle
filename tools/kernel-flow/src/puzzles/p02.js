import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 02: output[i] = a[i] + b[i], one thread per element.
const SIZE = 4;
const a = range(SIZE); // main(): a_host[i] = i
const b = range(SIZE); // main(): b_host[i] = i

function rows(sel, stage) {
  const input = (v, i) => cell(v, stage === 1 ? (i === sel ? 'read' : undefined) : 'muted');
  return [
    { id: 'a', label: 'a', kind: 'global', cells: a.map(input) },
    { id: 'b', label: 'b', kind: 'global', cells: b.map(input) },
    { id: 'threads', label: L('threads', '线程'), kind: 'threads', cells: range(SIZE).map(t => cell(t, t === sel ? 'focus' : 'active', { note: `i = ${t}` })) },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(SIZE).map(i => cell(stage === 1 ? a[i] + b[i] : null, i === sel ? (stage === 1 ? 'write' : 'focus') : stage === 1 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p02',
  num: 2,
  title: L('Zip', '逐元素相加'),
  goal: L('Add two arrays element by element: `output[i] = a[i] + b[i]`.', '把两个数组逐元素相加：`output[i] = a[i] + b[i]`。'),
  idea: L(
    'Same pattern as Puzzle 1, with two inputs: thread i reads position i of both arrays. The same index lines up the two inputs and the output, so there is still nothing for threads to coordinate.',
    '和第 1 题同样的模式，只是有两个输入：线程 i 读两个数组的第 i 个位置。同一个下标把两个输入和输出对齐，所以线程之间仍然不需要任何协作。',
  ),
  data: {
    launch: L('1 block of 4 threads, one per element', '1 个 block，4 个线程，每个元素一个'),
    tensors: [
      { name: 'a', values: a, note: L('4 elements, a[i] = i', '4 个元素，a[i] = i') },
      { name: 'b', values: b, note: L('4 elements, b[i] = i', '4 个元素，b[i] = i') },
      { name: 'output', values: [0, 0, 0, 0], note: L('4 elements, starts at 0', '4 个元素，初始为 0') },
    ],
  },
  pick: { row: 'output', initial: 3, hint: L('Click an output to see which thread computes it.', '点击一个输出，看是哪个线程算出它的。') },
  stages: [
    {
      name: L('Index', '取下标'),
      lines: ['var i = thread_idx.x'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: [],
          say: L(
            `Each thread takes its number as the index. Thread ${sel} will work only on position ${sel} of \`a\`, \`b\` and \`output\`.`,
            `每个线程把自己的编号当作下标。线程 ${sel} 只处理 \`a\`、\`b\` 和 \`output\` 的第 ${sel} 个位置。`,
          ),
          math: `i = thread_idx.x = ${sel}`,
        };
      },
    },
    {
      name: L('Add', '相加'),
      lines: ['output[unsafe_offset=i] = a[unsafe_offset=i] + b[unsafe_offset=i]'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          arrows: range(SIZE).flatMap(i => [
            arrow(at('a', i), at('threads', i), 'read', i !== sel),
            arrow(at('b', i), at('threads', i), 'read', i !== sel),
            arrow(at('threads', i), at('output', i), 'write', i !== sel),
          ]),
          say: L(
            `All ${SIZE} threads read one value from each array and write one sum, at the same time.`,
            `${SIZE} 个线程同时从每个数组各读一个值，写出一个和。`,
          ),
          math: `output[${sel}] = a[${sel}] + b[${sel}] = ${a[sel]} + ${b[sel]} = ${a[sel] + b[sel]}`,
        };
      },
    },
  ],
  result: () => a.map((v, i) => v + b[i]),
  oracle: { file: 'p02/p02.mojo', kernel: 'add', buffer: 'output' },
};
