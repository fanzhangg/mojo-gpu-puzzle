import { L, range, cell, at, arrow } from './kit.js';

// Puzzle 06: output[i] = a[i] + 10 with 3 blocks of 4 threads for 9 elements.
const SIZE = 9, TPB = 4, BLOCKS = 3, N = TPB * BLOCKS;
const a = range(SIZE); // main(): a_host[i] = i
const ghost = i => cell('✕', 'ghost', { idx: String(i) });

function rows(sel, stage) {
  const b = Math.floor(sel / TPB);
  return [
    { id: 'a', label: 'a', kind: 'global', dense: true, cells: range(N).map(i => (i < SIZE ? cell(a[i], stage === 1 && i === sel ? 'read' : stage === 1 ? undefined : 'muted') : ghost(i))) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads', dense: true, groups: BLOCKS, groupLabel: g => L(`block ${g}`, `block ${g}`),
      cells: range(N).map(i => {
        const t = i % TPB, pass = i < SIZE;
        if (i === sel) return cell(t, 'focus', { note: `i=${i}` });
        if (!pass) return cell(t, 'idle', { note: `i=${i}` });
        return cell(t, stage === 0 && Math.floor(i / TPB) !== b ? 'muted' : 'active', { note: `i=${i}` });
      }),
    },
    { id: 'output', label: 'output', kind: 'global', dense: true, cells: range(N).map(i => (i < SIZE ? cell(stage === 1 ? a[i] + 10 : null, stage === 1 && i === sel ? 'write' : stage === 1 ? undefined : 'muted') : ghost(i))) },
  ];
}

export default {
  id: 'p06',
  num: 6,
  title: L('Blocks', '多个 Block'),
  goal: L(
    'Add 10 to 9 elements, `output[i] = a[i] + 10`, using 3 blocks of 4 threads.',
    '给 9 个元素加 10：`output[i] = a[i] + 10`，使用 3 个 block，每个 4 个线程。',
  ),
  idea: L(
    'A block has a size limit, so big arrays are split across many blocks. Inside a block, `thread_idx.x` restarts at 0, so a thread finds its element with `block_dim.x × block_idx.x + thread_idx.x`: skip the earlier blocks, then count within this one. 3 × 4 = 12 threads cover 9 elements, so the last block has 3 threads to spare, and the guard keeps them idle.',
    'block 的大小有上限，所以大数组要分给多个 block。在每个 block 内 `thread_idx.x` 都从 0 重新开始，所以线程用 `block_dim.x × block_idx.x + thread_idx.x` 找到自己的元素：先跳过前面的 block，再在本 block 内计数。3 × 4 = 12 个线程覆盖 9 个元素，最后一个 block 多出 3 个线程，由边界检查让它们空闲。',
  ),
  data: {
    launch: L('3 blocks × 4 threads = 12 threads for 9 elements', '3 个 block × 4 个线程 = 12 个线程，处理 9 个元素'),
    tensors: [
      { name: 'a', values: a, note: L('9 elements, a[i] = i', '9 个元素，a[i] = i') },
      { name: 'output', values: range(SIZE).map(() => 0), note: L('9 elements, starts at 0', '9 个元素，初始为 0') },
      { name: 'size', values: 'Int = 9', note: L('number of elements', '元素个数') },
    ],
  },
  pick: { row: 'threads', initial: 6, hint: L('Click a thread, including one of the spare threads in the last block.', '点击一个线程，也试试最后一个 block 里多出来的线程。') },
  stages: [
    {
      name: L('Global index', '全局下标'),
      lines: ['var i = block_dim.x * block_idx.x + thread_idx.x'],
      scene(sel) {
        const b = Math.floor(sel / TPB), t = sel % TPB;
        return {
          rows: rows(sel, 0),
          arrows: sel < SIZE ? [] : [arrow(at('threads', sel), at('a', sel), 'ghost')],
          say: sel < SIZE
            ? L(
                `Thread ${t} of block ${b} ${b === 0 ? `is in the first block, so nothing comes before it: it lands on element ${sel}.` : `is not element ${t}: ${b === 1 ? 'block 0 already covers' : `blocks 0–${b - 1} already cover`} ${b * TPB} elements, so it counts on from there and lands on element ${sel}.`}`,
                `block ${b} 的线程 ${t} 并不处理第 ${t} 个元素：${b === 0 ? '它在第一个 block，前面没有元素' : `前面的 block 已经覆盖了 ${b * TPB} 个元素`}，所以它从那里接着数，落在第 ${sel} 个元素上。`,
              )
            : L(
                `Thread ${t} of block ${b} computes i = ${sel}, but there are only ${SIZE} elements. The dashed arrow is the read it would make past the end of \`a\`.`,
                `block ${b} 的线程 ${t} 算出 i = ${sel}，但只有 ${SIZE} 个元素。虚线是它会越过 \`a\` 末尾去做的读取。`,
              ),
          math: `i = block_dim.x × block_idx.x + thread_idx.x = ${TPB} × ${b} + ${t} = ${sel}`,
        };
      },
    },
    {
      name: L('Guard and add 10', '检查并加 10'),
      lines: ['if i < size', 'output[unsafe_offset=i] = a[unsafe_offset=i] + 10.0'],
      scene(sel) {
        const arrows = range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', i !== sel), arrow(at('threads', i), at('output', i), 'write', i !== sel)]);
        if (sel >= SIZE) arrows.push(arrow(at('a', sel), at('threads', sel), 'ghost'), arrow(at('threads', sel), at('output', sel), 'ghost'));
        return {
          rows: rows(sel, 1),
          arrows,
          say: sel < SIZE
            ? L(
                'All 9 threads with an element add 10 at the same time, across all three blocks. The three spare threads in the last block fail `i < size` and do nothing.',
                '9 个有元素的线程同时加 10，它们分布在三个 block 中。最后一个 block 里的 3 个多余线程没有通过 `i < size`，什么也不做。',
              )
            : L(
                `Thread ${sel % TPB} of block ${Math.floor(sel / TPB)} fails \`i < size\` (${sel} ≥ ${SIZE}) and stays idle, so it never touches memory past the end of \`a\` or \`output\`.`,
                `block ${Math.floor(sel / TPB)} 的线程 ${sel % TPB} 没有通过 \`i < size\`（${sel} ≥ ${SIZE}），保持空闲，所以不会碰到 \`a\` 或 \`output\` 末尾之外的内存。`,
              ),
          math: sel < SIZE ? `output[${sel}] = a[${sel}] + 10 = ${a[sel]} + 10 = ${a[sel] + 10}` : `if i < size:   ${sel} < ${SIZE}  →  False`,
        };
      },
    },
  ],
  result: () => a.map(v => v + 10),
  oracle: { file: 'p06/p06.mojo', kernel: 'add_10_blocks', buffer: 'output' },
};
