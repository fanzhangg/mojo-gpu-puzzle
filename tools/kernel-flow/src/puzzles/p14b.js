import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 14 (complete): prefix sum over 15 elements with 2 blocks of 8 threads, in two kernels.
//   kernel 1 (prefix_sum_local_phase): each block scans its own 8 elements; thread 7 of each block
//            also writes its block's total past the end of output (output[15], output[16]).
//   kernel 2 (prefix_sum_block_sum_phase): block 1 adds block 0's total to each of its elements.
const TPB = 8, SIZE = 15, BLOCKS = 2, EXT = SIZE + BLOCKS;
const a = range(SIZE); // main(): a_host[i] = i
const blockOf = i => Math.floor(i / TPB);
const localOf = i => i % TPB;
// shared memory after the local scan, per block (block 1's tail slot is zero-filled)
const shared = range(BLOCKS * TPB).map(g => {
  const b = blockOf(g), start = b * TPB;
  let s = 0;
  for (let j = start; j <= g; j++) s += j < SIZE ? a[j] : 0;
  return s;
});
const blockSum = b => shared[b * TPB + TPB - 1];
const phase1 = range(EXT).map(i => (i < SIZE ? shared[i] : blockSum(i - SIZE)));
const phase2 = phase1.map((v, i) => (i < SIZE && blockOf(i) > 0 ? v + phase1[SIZE + blockOf(i) - 1] : v));

function rows(sel, stage) {
  // stage 0 = local scan, 1 = write local + block sums, 2 = add previous block's total, 3 = result
  const isSum = sel >= SIZE;
  const B = isSum ? sel - SIZE : blockOf(sel);
  const inMine = i => i < SIZE && blockOf(i) === B;
  const outVals = stage === 0 ? null : stage === 1 ? phase1 : phase2;
  return [
    {
      id: 'a', label: 'a', kind: 'global', dense: true,
      cells: range(SIZE).map(i => cell(a[i], stage === 0 ? (!isSum && blockOf(i) === B && i <= sel ? 'read' : inMine(i) ? undefined : 'muted') : 'muted')),
    },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads', groups: BLOCKS, groupLabel: g => L(`block ${g}`, `block ${g}`), dense: true, cols: 4,
      cells: range(BLOCKS * TPB).map(g => {
        const t = localOf(g), b = blockOf(g);
        const me = isSum ? b === B && t === TPB - 1 : g === sel;
        if (stage === 2) return cell(t, b === 0 ? 'idle' : me ? 'focus' : g < SIZE ? 'active' : 'idle');
        if (stage === 3) return cell(t, me ? 'focus' : 'muted');
        return cell(t, me ? 'focus' : b === B ? 'active' : 'muted');
      }),
    },
    {
      id: 'shared', label: 'shared', kind: 'shared', groups: BLOCKS, groupLabel: g => L(`block ${g}'s shared memory`, `block ${g} 的共享内存`), dense: true, cols: 4,
      cells: range(BLOCKS * TPB).map(g => {
        const mine = isSum ? g === B * TPB + TPB - 1 : g === sel;
        const tone = stage <= 1 ? (mine ? (stage === 0 ? 'write' : 'read') : blockOf(g) === B ? undefined : 'muted') : 'muted';
        return cell(shared[g], tone, { idx: String(localOf(g)) });
      }),
    },
    {
      id: 'output', label: 'output', kind: 'global', dense: true,
      cells: range(SIZE).map(i => {
        const v = outVals ? outVals[i] : null;
        let tone;
        if (i === sel) tone = stage === 0 ? 'focus' : 'write';
        else if (stage === 2 && isSum && B === 0 && blockOf(i) === 1) tone = 'write';
        else tone = outVals ? undefined : 'muted';
        return cell(v, tone);
      }),
    },
    {
      id: 'sums', label: 'output[15..16]', kind: 'global',
      cells: range(BLOCKS).map(b => {
        const i = SIZE + b;
        let tone;
        if (i === sel) tone = stage === 0 ? 'focus' : stage === 2 && b === 0 ? 'read' : 'write';
        else if (stage === 2 && !isSum && B > 0 && b === 0) tone = 'read';
        else tone = outVals ? 'focus' : 'muted';
        return cell(outVals ? outVals[i] : null, tone, { idx: String(i), note: L(`total ${b}`, `块和 ${b}`) });
      }),
    },
  ];
}

export default {
  id: 'p14b',
  num: 14,
  title: L('Prefix Sum', '前缀和'),
  variant: L('Multiple blocks', '多个 block'),
  goal: L(
    'The same prefix sum, `output[i] = a[0] + … + a[i]`, but for 15 elements, more than one block can hold.',
    '同样是前缀和 `output[i] = a[0] + … + a[i]`，但有 15 个元素，一个 block 放不下。',
  ),
  idea: L(
    'Threads in different blocks cannot wait for each other with `barrier()`, so the work is split into two kernel launches. Kernel 1: each block scans its own part (as in the simple version) and writes its total after the end of `output`. Kernel 2 starts only after kernel 1 has finished, so it can safely add block 0\'s total to every element of block 1. Note that kernel 2 adds only the previous block\'s total: that is enough for exactly 2 blocks. With 3 or more blocks, each block would need the sum of all the block totals before it.',
    '不同 block 的线程无法用 `barrier()` 互相等待，所以计算拆成两次 kernel 启动。第 1 个 kernel：每个 block 扫描自己负责的部分（和简单版一样），并把本块的总和写在 `output` 的末尾之后。第 2 个 kernel 要等第 1 个完全结束才开始，所以可以放心地把 block 0 的总和加到 block 1 的每个元素上。注意第 2 个 kernel 只加上前一个 block 的总和，这只对正好 2 个 block 成立；有 3 个或更多 block 时，每个 block 需要的是它之前所有块和的总和。',
  ),
  data: {
    launch: L('2 blocks of 8 threads, launched twice (two kernels)', '2 个 block，每个 8 个线程，启动两次（两个 kernel）'),
    tensors: [
      { name: 'a', values: a, note: L('15 elements, a[i] = i', '15 个元素，a[i] = i') },
      { name: 'output', values: range(EXT).map(() => 0), note: L('17 elements: 15 results + 1 slot per block for its total', '17 个元素：15 个结果，加上每个 block 存总和的 1 个位置') },
    ],
  },
  pick: { row: 'output', initial: 12, hint: L('Click an output in block 1 (8–14), then one in block 0 (0–7).', '先点 block 1 的一个输出（8–14），再点 block 0 的一个（0–7）。') },
  stages: [
    {
      name: L('Scan each block', '块内扫描'),
      lines: ['shared[local_i] = rebind', 'shared[local_i] = 0', 'for _ in range', 'shared[local_i] += current_val'],
      scene(sel) {
        const isSum = sel >= SIZE;
        const B = isSum ? sel - SIZE : blockOf(sel);
        const g = isSum ? B * TPB + TPB - 1 : sel;
        const start = B * TPB;
        const ins = range(g - start + 1, start).filter(j => j < SIZE);
        return {
          rows: rows(sel, 0),
          arrows: ins.map(j => arrow(at('a', j), at('shared', g), 'move')),
          say: L(
            `Kernel 1. Each block loads its 8 elements into its own shared memory and scans them in 3 rounds, exactly like the single-block version (block 1 has only 7, so its last slot is set to 0). The scan only sees its own block: block ${B}'s cell ${localOf(g)} holds the sum of ${ins.length === 1 ? `\`a[${ins[0]}]\`` : `\`a[${ins[0]}..${ins[ins.length - 1]}]\``}, nothing from the other block.`,
            `第 1 个 kernel。每个 block 把自己的 8 个元素加载到自己的共享内存，用 3 轮完成扫描，做法和单 block 版本完全一样（block 1 只有 7 个元素，最后一格补 0）。扫描只看得到本块：block ${B} 的第 ${localOf(g)} 格是 ${ins.length === 1 ? `\`a[${ins[0]}]\`` : `\`a[${ins[0]}..${ins[ins.length - 1]}]\``} 的和，不含另一个 block 的数据。`,
          ),
          math: `shared[${localOf(g)}] (block ${B}) = ${ins.map(j => fmt(a[j])).join(' + ')} = ${fmt(shared[g])}`,
        };
      },
    },
    {
      name: L('Block totals', '写出块和'),
      lines: ['output[global_i] = shared[local_i]', 'if local_i == TPB - 1', 'output[size + block_idx.x] = shared[local_i]'],
      scene(sel) {
        const arrows = [];
        for (const g of range(SIZE)) arrows.push(arrow(at('shared', g), at('output', g), 'write', g !== sel));
        for (const b of range(BLOCKS)) arrows.push(arrow(at('shared', b * TPB + TPB - 1), at('sums', b), 'write', sel !== SIZE + b && !(sel < SIZE && blockOf(sel) === 1 && b === 0)));
        return {
          rows: rows(sel, 1),
          arrows,
          say: L(
            `Every thread writes its local result. In addition, the last thread of each block writes the block's total after the end: \`output[15]\` = block 0's total (${fmt(blockSum(0))}), \`output[16]\` = block 1's total (${fmt(blockSum(1))}). ${sel < SIZE && blockOf(sel) === 1 ? `\`output[${sel}]\` = ${fmt(phase1[sel])} is not finished yet: it is still missing everything in block 0.` : ''}`,
            `每个线程写出本块内的结果。此外，每个 block 的最后一个线程把本块总和写在末尾之后：\`output[15]\` 是 block 0 的总和（${fmt(blockSum(0))}），\`output[16]\` 是 block 1 的总和（${fmt(blockSum(1))}）。${sel < SIZE && blockOf(sel) === 1 ? `\`output[${sel}]\` = ${fmt(phase1[sel])} 还没算完：它还缺 block 0 的全部数据。` : ''}`,
          ),
          math: sel < SIZE ? `output[${sel}] = shared[${localOf(sel)}] = ${fmt(phase1[sel])}` : `output[${sel}] = shared[7] (block ${sel - SIZE}) = ${fmt(phase1[sel])}`,
        };
      },
    },
    {
      name: L('Kernel 2: add totals', '第 2 个 kernel'),
      lines: ['if block_idx.x > 0 and global_i < size', 'var prev_block_sum = output[size + block_idx.x - 1]', 'output[global_i] += prev_block_sum'],
      scene(sel) {
        const arrows = range(SIZE).filter(i => blockOf(i) === 1).map(i => arrow(at('sums', 0), at('output', i), 'move', i !== sel && sel !== SIZE));
        const B = sel >= SIZE ? sel - SIZE : blockOf(sel);
        let say;
        if (sel >= SIZE) say = B === 0
          ? L(`Kernel 2. Every thread of block 1 reads block 0's total from \`output[15]\` and adds it to its element.`, `第 2 个 kernel。block 1 的每个线程从 \`output[15]\` 读出 block 0 的总和，加到自己的元素上。`)
          : L('Kernel 2. Block 1 is the last block, so nothing reads its total in `output[16]`: it is written but not needed.', '第 2 个 kernel。block 1 是最后一个 block，没有人读它在 `output[16]` 里的总和：写了，但用不到。');
        else if (B === 0) say = L(`Kernel 2. Block 0 has no blocks before it, so \`output[${sel}]\` is already final; its threads do nothing. Block 1's threads each add \`output[15]\`.`, `第 2 个 kernel。block 0 前面没有别的 block，所以 \`output[${sel}]\` 已经是最终结果，它的线程什么也不做。block 1 的线程各自加上 \`output[15]\`。`);
        else say = L(
          `Kernel 2. This is a new launch, so all of kernel 1, including block 0's total in \`output[15]\`, is guaranteed to be written. Thread ${localOf(sel)} of block 1 reads it and adds it to \`output[${sel}]\`.`,
          `第 2 个 kernel。这是一次新的启动，所以第 1 个 kernel 的所有结果（包括 \`output[15]\` 里 block 0 的总和）一定都已写好。block 1 的线程 ${localOf(sel)} 读出它，加到 \`output[${sel}]\` 上。`,
        );
        return {
          rows: rows(sel, 2),
          arrows,
          say,
          math: sel < SIZE && blockOf(sel) > 0 ? `output[${sel}] = ${fmt(phase1[sel])} + output[15] (${fmt(phase1[SIZE])}) = ${fmt(phase2[sel])}` : sel < SIZE ? `output[${sel}] = ${fmt(phase2[sel])}   (unchanged)` : undefined,
        };
      },
    },
    {
      name: L('Result', '结果'),
      lines: ['output[global_i] += prev_block_sum'],
      scene(sel) {
        const i = sel < SIZE ? sel : SIZE - 1;
        return {
          rows: rows(sel, 3),
          arrows: [],
          say: L(
            `Every one of the 15 outputs is now the sum of all elements up to it, across both blocks. The two extra cells only carried block totals from kernel 1 to kernel 2.`,
            `现在 15 个输出都是从头到它为止所有元素的和，跨越了两个 block。末尾的两个额外格子只是把块的总和从第 1 个 kernel 传给第 2 个 kernel。`,
          ),
          math: `output[${i}] = a[0] + … + a[${i}] = ${fmt(phase2[i])}`,
        };
      },
    },
  ],
  result: () => phase2.slice(),
  // inputs: launch lines that main() decides at run time (argv), which the test's launch reader cannot resolve
  oracle: { file: 'p14/p14.mojo', kernels: ['prefix_sum_local_phase', 'prefix_sum_block_sum_phase'], buffer: 'output', inputs: { size_dev: 'SIZE_2' } },
};
