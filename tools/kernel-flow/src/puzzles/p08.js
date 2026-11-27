import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 08: output[i] = a[i] + 10, staged through shared memory, 2 blocks of 4 threads.
const TPB = 4, SIZE = 8, BLOCKS = 2;
const a = range(SIZE).map(() => 1); // main(): a.enqueue_fill(1)
const blockOf = i => Math.floor(i / TPB);
const localOf = i => i % TPB;

function rows(sel, stage) {
  const B = blockOf(sel);
  const mine = i => blockOf(i) === B;
  return [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads', groups: BLOCKS, groupLabel: g => L(`block ${g}`, `block ${g}`),
      cells: range(SIZE).map(i => {
        const note = L(`global ${i}`, `全局 ${i}`);
        if (i === sel) return cell(localOf(i), 'focus', { note });
        if (stage === 1) return cell(localOf(i), mine(i) ? 'wait' : 'muted', { note });
        return cell(localOf(i), stage === 0 || stage === 2 ? 'active' : 'muted', { note });
      }),
    },
    {
      id: 'shared', label: 'shared', kind: 'shared', groups: BLOCKS, groupLabel: g => L(`block ${g}'s shared memory`, `block ${g} 的共享内存`),
      cells: range(SIZE).map(i => cell(a[i], i === sel ? (stage === 0 ? 'write' : stage === 2 ? 'read' : 'focus') : mine(i) ? undefined : 'muted', { idx: String(localOf(i)), note: L(`from a[${i}]`, `来自 a[${i}]`) })),
    },
    {
      id: 'output', label: 'output', kind: 'global',
      cells: range(SIZE).map(i => cell(stage === 2 ? a[i] + 10 : null, i === sel ? (stage === 2 ? 'write' : 'focus') : stage === 2 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p08',
  num: 8,
  title: L('Shared Memory', '共享内存'),
  goal: L(
    'Add 10 to every element, `output[i] = a[i] + 10`, staging the data through shared memory.',
    '给每个元素加 10：`output[i] = a[i] + 10`，数据先经过共享内存中转。',
  ),
  idea: L(
    'Shared memory is a small, fast scratchpad that belongs to one block. Each block gets its own copy, so a thread indexes it with its position inside the block (`local_i`), and indexes global memory with its position in the whole grid (`global_i`).',
    '共享内存是属于一个 block 的小块高速暂存区，每个 block 各有一份。所以线程访问共享内存时用它在 block 内的位置（`local_i`），访问全局内存时用它在整个 grid 中的位置（`global_i`）。',
  ),
  data: {
    launch: L('2 blocks of 4 threads (8 threads in total)', '2 个 block，每个 4 个线程（共 8 个）'),
    tensors: [
      { name: 'a', values: a, note: L('8 elements, all 1', '8 个元素，全部为 1') },
      { name: 'output', values: range(SIZE).map(() => 0), note: L('8 elements, starts at 0', '8 个元素，初始为 0') },
      { name: 'shared', values: L('4 slots per block', '每个 block 4 个位置'), note: L('allocated inside the kernel, one copy per block', '在 kernel 内分配，每个 block 一份') },
    ],
  },
  pick: { row: 'output', initial: 6, hint: L('Click an output to follow the thread that computes it.', '点击一个输出，跟踪计算它的线程。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['var global_i', 'var local_i', 'shared[local_i] = rebind'],
      scene(sel) {
        const b = blockOf(sel), l = localOf(sel);
        return {
          rows: rows(sel, 0),
          arrows: range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', i !== sel), arrow(at('threads', i), at('shared', i), 'write', i !== sel)]),
          say: L(
            `Every thread copies one element of \`a\` into its block's shared memory. Thread ${l} of block ${b} reads \`a[${sel}]\` from global memory but writes \`shared[${l}]\`: block ${b} has its own shared memory, and it only has ${TPB} slots.`,
            `每个线程把 \`a\` 的一个元素复制到自己 block 的共享内存。block ${b} 的线程 ${l} 从全局内存读 \`a[${sel}]\`，却写入 \`shared[${l}]\`：block ${b} 有自己的共享内存，只有 ${TPB} 个位置。`,
          ),
          math: `global_i = block_dim.x × block_idx.x + thread_idx.x = ${TPB} × ${b} + ${l} = ${sel}\nlocal_i  = thread_idx.x = ${l}`,
        };
      },
    },
    {
      name: L('Wait', '等待'),
      lines: ['barrier()'],
      scene(sel) {
        return {
          rows: rows(sel, 1),
          arrows: [],
          say: L(
            `\`barrier()\` makes the threads of each block wait for one another. Here each thread only reads back its own slot, so nothing would break without it, but it is the habit you will need as soon as threads read each other's slots (Puzzles 11–13).`,
            `\`barrier()\` 让同一个 block 的线程互相等待。这里每个线程只读回自己的位置，所以去掉它也不会出错；但一旦线程要读别人写的位置（第 11–13 题），就必须用它，现在先养成习惯。`,
          ),
        };
      },
    },
    {
      name: L('Add 10', '加 10'),
      lines: ['output[global_i] = shared[local_i] + 10'],
      scene(sel) {
        const l = localOf(sel);
        return {
          rows: rows(sel, 2),
          arrows: [arrow(at('shared', sel), at('threads', sel), 'read'), arrow(at('threads', sel), at('output', sel), 'write')],
          say: L(
            'The thread reads its value back from shared memory, adds 10, and writes the result to global memory at its global position.',
            '线程从共享内存读回自己的值，加 10，再按全局位置写回全局内存。',
          ),
          math: `output[${sel}] = shared[${l}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}`,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p08/p08.mojo', kernel: 'add_10_shared_tile_tensor', buffer: 'output' },
};
