import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 03: output[i] = a[i] + 10 with 8 threads but only 4 elements.
const SIZE = 4, THREADS = 8;
const a = range(SIZE); // main(): a_host[i] = i
const ghost = i => cell('✕', 'ghost', { idx: String(i) });

function rows(sel, stage) {
  return [
    {
      id: 'a', label: 'a', kind: 'global',
      cells: range(THREADS).map(i => (i < SIZE ? cell(a[i], stage === 1 && i === sel ? 'read' : stage === 1 ? undefined : 'muted') : ghost(i))),
    },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: range(THREADS).map(t => {
        const pass = t < SIZE;
        if (t === sel) return cell(t, 'focus', { note: pass ? `${t} < 4 ✓` : `${t} < 4 ✗` });
        return cell(t, pass ? 'active' : 'idle', { note: pass ? undefined : L('skips', '跳过') });
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(THREADS).map(i => (i < SIZE ? cell(stage === 1 ? a[i] + 10 : null, stage === 1 && i === sel ? 'write' : stage === 1 ? undefined : 'muted') : ghost(i))),
    },
  ];
}

export default {
  id: 'p03',
  num: 3,
  title: L('Guards', '边界检查'),
  goal: L(
    'Add 10 to every element of a 4-element array, `output[i] = a[i] + 10`, launched with 8 threads.',
    '给一个只有 4 个元素的数组每个元素加 10：`output[i] = a[i] + 10`，但启动了 8 个线程。',
  ),
  idea: L(
    'You often launch more threads than there is data (the thread count is rounded up to whole blocks, and the data size is rarely an exact multiple of the block size). The extra threads must do nothing, so every thread first checks `i < size`. Without that guard, threads 4–7 would read and write memory past the end of the arrays.',
    '启动的线程数常常比数据多（线程数按整个 block 向上取整，而数据量很少正好是 block 大小的整数倍）。多出来的线程什么都不能做，所以每个线程先检查 `i < size`。没有这个检查，线程 4–7 就会读写数组末尾之外的内存。',
  ),
  data: {
    launch: L('1 block of 8 threads, for only 4 elements', '1 个 block，8 个线程，但只有 4 个元素'),
    tensors: [
      { name: 'a', values: a, note: L('4 elements, a[i] = i', '4 个元素，a[i] = i') },
      { name: 'output', values: [0, 0, 0, 0], note: L('4 elements, starts at 0', '4 个元素，初始为 0') },
      { name: 'size', values: 'Int = 4', note: L('number of elements, passed to the kernel', '元素个数，作为参数传给 kernel') },
    ],
  },
  pick: { row: 'threads', initial: 6, hint: L('Click a thread. Try one of 0–3, then one of 4–7.', '点击一个线程。先试 0–3 中的一个，再试 4–7 中的一个。') },
  stages: [
    {
      name: L('Check', '检查'),
      lines: ['var i = thread_idx.x', 'if i < size'],
      scene(sel) {
        const pass = sel < SIZE;
        return {
          rows: rows(sel, 0),
          arrows: pass ? [] : [arrow(at('threads', sel), at('a', sel), 'ghost')],
          say: pass
            ? L(`Thread ${sel} checks the guard: ${sel} < ${SIZE}, so there is an element for it to work on.`, `线程 ${sel} 检查边界：${sel} < ${SIZE}，有元素可以处理。`)
            : L(
                `Thread ${sel} checks the guard: ${sel} is not < ${SIZE}. There is no \`a[${sel}]\` (the red dashed arrow is the read it would make without the guard), so it skips the body and does nothing.`,
                `线程 ${sel} 检查边界：${sel} 不小于 ${SIZE}。\`a[${sel}]\` 并不存在（红色虚线是没有检查时它会做的读取），所以它跳过函数体，什么也不做。`,
              ),
          math: `if i < size:   ${sel} < ${SIZE}  →  ${pass ? 'True' : 'False'}`,
        };
      },
    },
    {
      name: L('Add 10', '加 10'),
      lines: ['output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0'],
      scene(sel) {
        const pass = sel < SIZE;
        const arrows = range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', i !== sel), arrow(at('threads', i), at('output', i), 'write', i !== sel)]);
        if (!pass) arrows.push(arrow(at('a', sel), at('threads', sel), 'ghost'), arrow(at('threads', sel), at('output', sel), 'ghost'));
        return {
          rows: rows(sel, 1),
          arrows,
          say: pass
            ? L('Threads 0–3 each add 10 to their own element at the same time.', '线程 0–3 同时给各自的元素加 10。')
            : L(
                `Threads 0–3 do the work. Thread ${sel} stays idle; without the guard it would read \`a[${sel}]\` and write \`output[${sel}]\`, memory that belongs to something else.`,
                `线程 0–3 完成计算。线程 ${sel} 保持空闲；没有边界检查的话，它会读 \`a[${sel}]\`、写 \`output[${sel}]\`，而这些内存属于别的东西。`,
              ),
          math: pass ? `output[${sel}] = a[${sel}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}` : undefined,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p03/p03.mojo', kernel: 'add_10_guard', buffer: 'output' },
};
