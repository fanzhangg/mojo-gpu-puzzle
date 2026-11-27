import { L, range, cell, at, arrow, list, listZh, fmt } from './kit.js';

// Puzzle 13 (simple): output[i] = sum_j a[i + j] * b[j], one block, shared memory.
const SIZE = 6, CONV = 3, TPB = 8;
const a = range(SIZE); // main(): a_host[i] = i
const b = range(CONV); // main(): b_host[i] = i
const window = i => range(CONV).filter(j => i + j < SIZE);
const result = i => window(i).reduce((s, j) => s + a[i + j] * b[j], 0);

function base(sel, stage) {
  const win = window(sel).map(j => sel + j);
  return [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 0 ? (win.includes(i) ? 'read' : undefined) : 'muted')) },
    { id: 'b', label: 'b', kind: 'global', cells: b.map(v => cell(v, stage === 0 ? 'read' : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: range(TPB).map(t => {
        if (t >= SIZE) return cell(t, 'idle', { note: L('no data', '无数据') });
        if (stage === 0) return cell(t, t === sel ? 'focus' : win.includes(t) || t < CONV ? 'active' : 'muted');
        if (stage === 1) return cell(t, t === sel ? 'focus' : 'wait');
        if (stage === 2) return cell(t, t === sel ? 'focus' : 'muted', t === sel ? { note: `Σ = ${result(sel)}` } : undefined);
        return cell(t, t === sel ? 'focus' : 'active', t === sel ? { note: `Σ = ${result(sel)}` } : undefined);
      }),
    },
    {
      id: 'sa', label: 'shared_a', kind: 'shared',
      cells: a.map((v, i) => cell(v, stage === 0 ? (win.includes(i) ? 'write' : undefined) : win.includes(i) ? (stage === 2 ? 'read' : 'focus') : 'muted')),
    },
    { id: 'sb', label: 'shared_b', kind: 'shared', cells: b.map(v => cell(v, stage === 0 ? 'write' : stage === 2 ? 'read' : stage === 1 ? 'focus' : 'muted')) },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(SIZE).map(i => cell(stage === 3 ? result(i) : null, i === sel ? (stage === 3 ? 'write' : 'focus') : stage === 3 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p13',
  num: 13,
  title: L('1D Convolution', '一维卷积'),
  goal: L(
    'Slide a 3-wide kernel `b` along `a`: `output[i] = a[i]·b[0] + a[i+1]·b[1] + a[i+2]·b[2]`.',
    '让宽度为 3 的卷积核 `b` 沿着 `a` 滑动：`output[i] = a[i]·b[0] + a[i+1]·b[1] + a[i+2]·b[2]`。',
  ),
  idea: L(
    'One thread per output. Neighbouring outputs reuse the same inputs, so the block copies `a` into shared memory once, waits, and then every thread reads its 3-wide window from there instead of from slow global memory.',
    '每个线程负责一个输出。相邻的输出会用到相同的输入，所以 block 先把 `a` 一次性复制到共享内存，等全部复制完，每个线程再从共享内存读取自己的 3 格窗口，而不是反复去读较慢的全局内存。',
  ),
  data: {
    launch: L('1 block of 8 threads (6 elements, so threads 6 and 7 have no data)', '1 个 block，8 个线程（只有 6 个元素，所以线程 6、7 没有数据）'),
    tensors: [
      { name: 'a', values: a, note: L('input, 6 elements, a[i] = i', '输入，6 个元素，a[i] = i') },
      { name: 'b', values: b, note: L('the 3-wide kernel (weights), b[j] = j', '宽度为 3 的卷积核（权重），b[j] = j') },
      { name: 'output', values: range(SIZE).map(() => 0), note: L('6 elements, starts at 0', '6 个元素，初始为 0') },
    ],
  },
  pick: { row: 'output', initial: 1, hint: L('Click an output to see what it is made of.', '点击一个输出，看它由哪些数据算出。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['shared_a[local_i] =', 'shared_b[local_i] ='],
      scene(sel) {
        const win = window(sel).map(j => sel + j);
        const arrows = [];
        for (const t of range(SIZE)) {
          const faint = !win.includes(t);
          arrows.push(arrow(at('a', t), at('threads', t), 'read', faint), arrow(at('threads', t), at('sa', t), 'write', faint));
        }
        for (const t of range(CONV)) arrows.push(arrow(at('b', t), at('threads', t), 'read'), arrow(at('threads', t), at('sb', t), 'write'));
        return {
          rows: base(sel, 0),
          arrows,
          say: L(
            `Each thread copies one element of \`a\` into shared memory, and threads 0–2 also copy the kernel \`b\`. Output ${sel} will need \`shared_a\` cells ${list(win)}, loaded by threads ${list(win)}.`,
            `每个线程把 \`a\` 的一个元素复制到共享内存，线程 0–2 还负责复制卷积核 \`b\`。输出 ${sel} 需要 \`shared_a\` 的第 ${listZh(win)} 格，它们由线程 ${listZh(win)} 加载。`,
          ),
        };
      },
    },
    {
      name: L('Wait', '等待'),
      lines: ['barrier()'],
      scene(sel) {
        const others = window(sel).map(j => sel + j).filter(t => t !== sel);
        return {
          rows: base(sel, 1),
          arrows: [],
          say: others.length
            ? L(
                `\`barrier()\` holds every thread here until all of them have finished loading. Thread ${sel} is about to read values that threads ${list(others)} wrote, so starting early would read garbage.`,
                `\`barrier()\` 让所有线程停在这里，直到每个线程都加载完。线程 ${sel} 马上要读线程 ${listZh(others)} 写入的值，如果提前开始，就会读到垃圾数据。`,
              )
            : L(
                '`barrier()` holds every thread here until all of them have finished loading, so no thread reads a shared cell before it is written.',
                '`barrier()` 让所有线程停在这里，直到每个线程都加载完，保证没有线程会在某格被写入之前就去读它。',
              ),
        };
      },
    },
    {
      name: L('Multiply-add', '乘加'),
      lines: ['var local_sum', 'comptime for j', 'if local_i + j < SIZE', 'local_sum +='],
      scene(sel) {
        const js = window(sel);
        const arrows = js.flatMap(j => [arrow(at('sa', sel + j), at('threads', sel), 'read'), arrow(at('sb', j), at('threads', sel), 'read')]);
        const skipped = range(CONV).filter(j => !js.includes(j));
        const span = `shared_a[${sel}..${sel + js.length - 1}]`;
        return {
          rows: base(sel, 2),
          arrows,
          say: L(
            `Thread ${sel} multiplies its window \`${span}\` by the kernel and adds the products in a register (\`local_sum\`). Thread ${sel + 1} does the same one cell to the right${skipped.length ? `. Near the end the window runs off the array, so the \`if\` skips j = ${list(skipped)}` : ''}.`,
            `线程 ${sel} 把自己的窗口 \`${span}\` 与卷积核逐项相乘，并在寄存器（\`local_sum\`）里累加。线程 ${sel + 1} 在右边一格做同样的事${skipped.length ? `。窗口在末尾超出了数组，所以 \`if\` 跳过了 j = ${listZh(skipped)}` : ''}。`,
          ),
          math: `local_sum = ${js.map(j => `${fmt(a[sel + j])}·${fmt(b[j])}`).join(' + ')} = ${fmt(result(sel))}`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['output[global_i] = local_sum'],
      scene(sel) {
        return {
          rows: base(sel, 3),
          arrows: [arrow(at('threads', sel), at('output', sel), 'write')],
          say: L(
            `Thread ${sel} writes its sum to \`output[${sel}]\`. Every other thread wrote its own output at the same time.`,
            `线程 ${sel} 把和写到 \`output[${sel}]\`。其他线程在同一时间写出了各自的输出。`,
          ),
        };
      },
    },
  ],
  result: () => range(SIZE).map(result),
  oracle: { file: 'p13/p13.mojo', kernel: 'conv_1d_simple', buffer: 'output' },
};
