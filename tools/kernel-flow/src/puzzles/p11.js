import { L, range, cell, at, arrow, list, listZh, fmt } from './kit.js';

// Puzzle 11: output[i] = a[i-2] + a[i-1] + a[i] (fewer terms at the start), one block, shared memory.
const SIZE = 8, TPB = 8;
const a = range(SIZE); // main(): a_host[i] = i
const window = i => range(3).map(k => i - 2 + k).filter(x => x >= 0);
const result = i => window(i).reduce((s, x) => s + a[x], 0);

function rows(sel, stage) {
  const win = window(sel);
  return [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 0 ? (win.includes(i) ? 'read' : undefined) : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: range(TPB).map(t => {
        if (stage === 0) return cell(t, t === sel ? 'focus' : win.includes(t) ? 'active' : 'muted');
        if (stage === 1) return cell(t, t === sel ? 'focus' : 'wait');
        return cell(t, t === sel ? 'focus' : 'active', t === sel ? { note: `Σ = ${result(sel)}` } : undefined);
      }),
    },
    {
      id: 'shared', label: 'shared', kind: 'shared',
      cells: a.map((v, i) => cell(v, win.includes(i) ? (stage === 0 ? 'write' : stage === 2 ? 'read' : 'focus') : stage === 0 ? undefined : 'muted')),
    },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(SIZE).map(i => cell(stage === 2 ? result(i) : null, i === sel ? (stage === 2 ? 'write' : 'focus') : stage === 2 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p11',
  num: 11,
  title: L('Pooling', '池化'),
  goal: L(
    'Sum each element with the two before it: `output[i] = a[i-2] + a[i-1] + a[i]`, using only the elements that exist near the start.',
    '把每个元素和它前面两个元素相加：`output[i] = a[i-2] + a[i-1] + a[i]`；开头不足 3 个时，只加存在的元素。',
  ),
  idea: L(
    'Each output needs a 3-wide window that ends at its own position, and neighbouring windows overlap. So the block first copies `a` into shared memory once, waits, and then every thread reads its window from shared memory. The first two outputs have shorter windows and get their own branches.',
    '每个输出需要一个以自己为结尾、宽度为 3 的窗口，相邻窗口互相重叠。所以 block 先把 `a` 一次性复制到共享内存，等全部复制完，每个线程再从共享内存读取自己的窗口。前两个输出的窗口更短，代码里为它们单独写了分支。',
  ),
  data: {
    launch: L('1 block of 8 threads', '1 个 block，8 个线程'),
    tensors: [
      { name: 'a', values: a, note: L('input, 8 elements, a[i] = i', '输入，8 个元素，a[i] = i') },
      { name: 'output', values: range(SIZE).map(() => 0), note: L('8 elements, starts at 0', '8 个元素，初始为 0') },
    ],
  },
  pick: { row: 'output', initial: 4, hint: L('Click an output. Try 0 and 1 too: their windows are shorter.', '点击一个输出。也试试 0 和 1：它们的窗口更短。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['shared[local_i] = rebind'],
      scene(sel) {
        const win = window(sel);
        return {
          rows: rows(sel, 0),
          arrows: range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', !win.includes(i)), arrow(at('threads', i), at('shared', i), 'write', !win.includes(i))]),
          say: L(
            `Each thread copies one element of \`a\` into shared memory. Output ${sel} will need cells ${list(win)}, loaded by threads ${list(win)}.`,
            `每个线程把 \`a\` 的一个元素复制到共享内存。输出 ${sel} 需要第 ${listZh(win)} 格，它们由线程 ${listZh(win)} 加载。`,
          ),
        };
      },
    },
    {
      name: L('Wait', '等待'),
      lines: ['barrier()'],
      scene(sel) {
        const others = window(sel).filter(t => t !== sel);
        return {
          rows: rows(sel, 1),
          arrows: [],
          say: others.length
            ? L(
                `\`barrier()\` holds every thread until all of them have finished loading. Thread ${sel} is about to read cells written by threads ${list(others)}.`,
                `\`barrier()\` 让所有线程等到每个线程都加载完。线程 ${sel} 马上要读线程 ${listZh(others)} 写入的格子。`,
              )
            : L(
                '`barrier()` holds every thread until all of them have finished loading. Thread 0 only reads its own cell, but the other threads need it to wait too.',
                '`barrier()` 让所有线程等到每个线程都加载完。线程 0 只读自己的格子，但其他线程需要它也一起等。',
              ),
        };
      },
    },
    {
      name: L('Sum the window', '窗口求和'),
      lines: ['if global_i == 0', 'output[0] = shared[0]', 'elif global_i == 1', 'output[1] = shared[0] + shared[1]', 'elif 1 < global_i < size', 'output[global_i] = (', 'shared[local_i - 2] + shared[local_i - 1] + shared[local_i]'],
      scene(sel) {
        const win = window(sel);
        const branch = sel === 0 ? L('the `global_i == 0` branch: only one element exists', '`global_i == 0` 分支：只有一个元素') : sel === 1 ? L('the `global_i == 1` branch: only two elements exist', '`global_i == 1` 分支：只有两个元素') : L('the general branch: three elements', '一般分支：三个元素');
        return {
          rows: rows(sel, 2),
          arrows: [...win.map(i => arrow(at('shared', i), at('threads', sel), 'read')), arrow(at('threads', sel), at('output', sel), 'write')],
          say: L(
            `Thread ${sel} takes ${branch.en}. It adds its window from shared memory and writes the sum to \`output[${sel}]\`; all other threads do the same for their own position.`,
            `线程 ${sel} 走${branch.zh}。它把共享内存中的窗口相加，写到 \`output[${sel}]\`；其他线程同时为各自的位置做同样的事。`,
          ),
          math: `output[${sel}] = ${win.map(i => `shared[${i}]`).join(' + ')} = ${win.map(i => fmt(a[i])).join(' + ')} = ${fmt(result(sel))}`,
        };
      },
    },
  ],
  result: () => range(SIZE).map(result),
  oracle: { file: 'p11/p11.mojo', kernel: 'pooling', buffer: 'output' },
};
