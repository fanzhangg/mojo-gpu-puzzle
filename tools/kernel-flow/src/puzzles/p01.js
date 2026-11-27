import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 01: output[i] = a[i] + 10, one thread per element.
const SIZE = 4;
const a = range(SIZE); // main(): a_host[i] = i

function rows(sel, stage) {
  return [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 1 ? (i === sel ? 'read' : undefined) : 'muted')) },
    { id: 'threads', label: L('threads', '线程'), kind: 'threads', cells: range(SIZE).map(t => cell(t, t === sel ? 'focus' : 'active', { note: `i = ${t}` })) },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(SIZE).map(i => cell(stage === 1 ? a[i] + 10 : null, i === sel ? (stage === 1 ? 'write' : 'focus') : stage === 1 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p01',
  num: 1,
  title: L('Map', '映射'),
  goal: L('Add 10 to every element: `output[i] = a[i] + 10`.', '给每个元素加 10：`output[i] = a[i] + 10`。'),
  idea: L(
    'On a CPU you would write a loop over i. On a GPU there is no loop: you launch one thread per element, and each thread uses its own number (`thread_idx.x`) as the index. All the "iterations" happen at the same time.',
    '在 CPU 上你会写一个遍历 i 的循环。在 GPU 上没有循环：每个元素启动一个线程，每个线程把自己的编号（`thread_idx.x`）当作下标。所有"迭代"同时发生。',
  ),
  data: {
    launch: L('1 block of 4 threads, one per element', '1 个 block，4 个线程，每个元素一个'),
    tensors: [
      { name: 'a', values: a, note: L('4 elements, a[i] = i', '4 个元素，a[i] = i') },
      { name: 'output', values: [0, 0, 0, 0], note: L('4 elements, starts at 0', '4 个元素，初始为 0') },
    ],
  },
  pick: { row: 'output', initial: 2, hint: L('Click an output to see which thread computes it.', '点击一个输出，看是哪个线程算出它的。') },
  stages: [
    {
      name: L('Index', '取下标'),
      lines: ['var i = thread_idx.x'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: [],
          say: L(
            `Each of the ${SIZE} threads reads its own number, \`thread_idx.x\`, and uses it as the array index. Thread ${sel} is responsible for element ${sel} and nothing else.`,
            `${SIZE} 个线程各自读取自己的编号 \`thread_idx.x\`，并把它当作数组下标。线程 ${sel} 只负责第 ${sel} 个元素。`,
          ),
          math: `i = thread_idx.x = ${sel}`,
        };
      },
    },
    {
      name: L('Add 10', '加 10'),
      lines: ['output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          arrows: range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', i !== sel), arrow(at('threads', i), at('output', i), 'write', i !== sel)]),
          say: L(
            `All ${SIZE} threads run this line at the same time, each on its own element. Thread i reads \`a[i]\` and writes \`output[i]\`; no two threads touch the same cell.`,
            `${SIZE} 个线程同时执行这一行，各自处理自己的元素。线程 i 读 \`a[i]\`、写 \`output[i]\`，任何两个线程都不会碰同一个格子。`,
          ),
          math: `output[${sel}] = a[${sel}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}`,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p01/p01.mojo', kernel: 'add_10', buffer: 'output' },
};
