import { L, range, cell, at, arrow, list, listZh, fmt } from './kit.js';

// Puzzle 13 (block boundary): output[i] = sum_j a[i + j] * b[j], 2 blocks of 8, a 3-cell halo per block.
const SIZE = 15, CONV = 4, TPB = 8, BLOCKS = 2;
const SLOTS = TPB + CONV - 1; // shared_a slots per block
const a = range(SIZE); // main(): a_host[i] = i
const b = range(CONV); // main(): b_host[i] = i
const js = i => range(CONV).filter(j => i + j < SIZE);
const result = i => js(i).reduce((s, j) => s + a[i + j] * b[j], 0);
const blockOf = g => Math.floor(g / TPB);
const slotVal = (B, k) => (B * TPB + k < SIZE ? a[B * TPB + k] : 0); // shared_a[k] in block B
const loader = (B, k) => B * TPB + (k < TPB ? k : k - TPB); // thread (global id) that loads slot k
const sa = (B, k) => at('sa', B * SLOTS + k);

function rows(sel, stage) {
  const B = blockOf(sel), l = sel % TPB;
  const winSlots = js(sel).map(j => l + j);
  const inWin = (b, k) => b === B && winSlots.includes(k);
  const loaders = winSlots.map(k => loader(B, k));
  return [
    { id: 'a', label: 'a', kind: 'global', dense: true, cells: a.map((v, i) => cell(v, stage <= 1 ? (js(sel).map(j => sel + j).includes(i) ? 'read' : undefined) : 'muted')) },
    { id: 'b', label: 'b', kind: 'global', cells: b.map(v => cell(v, stage === 1 ? 'read' : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads', dense: true, groups: BLOCKS, groupLabel: g => L(`block ${g}`, `block ${g}`),
      cells: range(TPB * BLOCKS).map(g => {
        const t = g % TPB;
        if (g === sel) return cell(t, 'focus', stage >= 3 ? { note: `Σ${result(sel)}` } : undefined);
        if (stage === 0) return cell(t, g >= SIZE ? 'idle' : loaders.includes(g) ? 'active' : 'muted');
        if (stage === 1) return cell(t, blockOf(g) === B && t < CONV ? 'active' : 'muted');
        if (stage === 2) return cell(t, 'wait');
        return cell(t, g >= SIZE ? 'idle' : stage === 4 ? 'active' : 'muted');
      }),
    },
    {
      id: 'sa', label: 'shared_a', kind: 'shared', dense: true, groups: BLOCKS, groupLabel: g => L(`block ${g}: slots 0–7 own, 8h–10h halo (h = halo)`, `block ${g}：0–7 格是自己的，8h–10h 格是 halo（h 即 halo）`),
      cells: range(BLOCKS * SLOTS).map(x => {
        const g = Math.floor(x / SLOTS), k = x % SLOTS;
        const halo = k >= TPB;
        const shown = stage === 0 ? !halo : true;
        const tone = inWin(g, k) ? (stage === 0 && !halo ? 'write' : stage === 1 && halo ? 'write' : stage === 3 ? 'read' : 'focus') : g === B && (stage === 0 ? !halo : true) ? undefined : 'muted';
        return cell(shown ? slotVal(g, k) : null, tone, { idx: halo ? `${k}h` : String(k) });
      }),
    },
    {
      id: 'sb', label: 'shared_b', kind: 'shared', groups: BLOCKS, groupLabel: g => L(`block ${g}`, `block ${g}`),
      cells: range(BLOCKS * CONV).map(x => cell(stage >= 1 ? b[x % CONV] : null, Math.floor(x / CONV) === B ? (stage === 1 ? 'write' : stage === 3 && js(sel).includes(x % CONV) ? 'read' : undefined) : 'muted', { idx: String(x % CONV) })),
    },
    {
      id: 'output', label: 'output', kind: 'global', dense: true,
      cells: range(SIZE).map(i => cell(stage === 4 ? result(i) : null, i === sel ? (stage === 4 ? 'write' : 'focus') : stage === 4 ? undefined : 'muted')),
    },
  ];
}

export default {
  id: 'p13b',
  num: 13,
  title: L('1D Convolution', '一维卷积'),
  variant: L('Block boundary', '跨 block 边界'),
  goal: L(
    'The same convolution, `output[i] = a[i]·b[0] + … + a[i+3]·b[3]`, but now `a` has 15 elements spread over 2 blocks of 8 threads.',
    '同样的卷积，`output[i] = a[i]·b[0] + … + a[i+3]·b[3]`，但现在 `a` 有 15 个元素，分给 2 个 block，每个 8 个线程。',
  ),
  idea: L(
    'A block can only read its own shared memory. Near the right edge of a block, a window reaches into elements that belong to the next block. So each block also loads the 3 elements just past its end (the "halo") into 3 extra slots: `shared_a` has 8 + 4 − 1 = 11 slots.',
    '一个 block 只能读自己的共享内存。靠近 block 右端时，窗口会伸到属于下一个 block 的元素。所以每个 block 还会把紧接在自己末尾之后的 3 个元素（称为 "halo"）加载到额外的 3 个位置：`shared_a` 有 8 + 4 − 1 = 11 个位置。',
  ),
  data: {
    launch: L('2 blocks of 8 threads (16 threads for 15 elements)', '2 个 block，每个 8 个线程（16 个线程处理 15 个元素）'),
    tensors: [
      { name: 'a', values: '[0, 1, 2, …, 14]', note: L('input, 15 elements, a[i] = i', '输入，15 个元素，a[i] = i') },
      { name: 'b', values: b, note: L('the 4-wide kernel (weights), b[j] = j', '宽度为 4 的卷积核（权重），b[j] = j') },
      { name: 'output', values: L('15 zeros', '15 个 0'), note: L('filled by the kernel', '由 kernel 写入') },
    ],
  },
  pick: { row: 'output', initial: 6, hint: L('Click an output. Outputs 5–7 and 13–14 have windows that reach past their block.', '点击一个输出。输出 5–7 和 13–14 的窗口会伸出自己的 block。') },
  stages: [
    {
      name: L('Load own', '加载自己的'),
      lines: ['if global_i < SIZE_2:', 'shared_a[local_i] = rebind', 'shared_a[local_i] = 0'],
      scene(sel) {
        const B = blockOf(sel), l = sel % TPB;
        const need = js(sel).map(j => l + j).filter(k => k < TPB).map(k => B * TPB + k);
        const arrows = [];
        for (const g of range(TPB * BLOCKS)) {
          const faint = !need.includes(g);
          if (g < SIZE) arrows.push(arrow(at('a', g), at('threads', g), 'read', faint));
          arrows.push(arrow(at('threads', g), sa(blockOf(g), g % TPB), 'write', faint));
        }
        return {
          rows: rows(sel, 0),
          arrows,
          say: L(
            `Every thread copies its own element into its block's \`shared_a\` (thread 7 of block 1 has no element and writes 0). Output ${sel} needs \`a[${sel}..${sel + js(sel).length - 1}]\`, but block ${B} only owns \`a[${B * TPB}..${B * TPB + TPB - 1}]\`.`,
            `每个线程把自己的元素复制到所在 block 的 \`shared_a\`（block 1 的线程 7 没有元素，写入 0）。输出 ${sel} 需要 \`a[${sel}..${sel + js(sel).length - 1}]\`，但 block ${B} 只拥有 \`a[${B * TPB}..${B * TPB + TPB - 1}]\`。`,
          ),
        };
      },
    },
    {
      name: L('Load halo + kernel', '加载 halo 和卷积核'),
      lines: ['if local_i < CONV_2 - 1:', 'var next_idx = global_i + TPB', 'shared_a[TPB + local_i] = rebind', 'shared_a[TPB + local_i] = 0', 'shared_b[local_i] = rebind'],
      scene(sel) {
        const B = blockOf(sel), l = sel % TPB;
        const haloNeed = js(sel).map(j => l + j).filter(k => k >= TPB);
        const arrows = [];
        for (const g of range(BLOCKS)) for (const t of range(CONV - 1)) {
          const k = TPB + t, src = g * TPB + k, th = g * TPB + t;
          const faint = !(g === B && haloNeed.includes(k));
          if (src < SIZE) arrows.push(arrow(at('a', src), at('threads', th), 'read', faint));
          arrows.push(arrow(at('threads', th), sa(g, k), 'write', faint));
        }
        for (const j of range(CONV)) arrows.push(arrow(at('b', j), at('threads', B * TPB + j), 'read', true), arrow(at('threads', B * TPB + j), at('sb', B * CONV + j), 'write', true));
        const loadedBy = haloNeed.map(k => k - TPB);
        return {
          rows: rows(sel, 1),
          arrows,
          say: haloNeed.length
            ? L(
                `Threads 0–2 of each block also load the 3 elements just past the block's end into slots 8h–10h. Output ${sel}'s window needs slots ${list(haloNeed.map(k => `${k}h`))}: threads ${list(loadedBy)} of block ${B} copied \`a[${list(haloNeed.map(k => B * TPB + k))}]\` there, so block ${B} never has to read block ${B + 1}'s shared memory. Threads 0–3 also copy the kernel \`b\`.`,
                `每个 block 的线程 0–2 还会把紧接在 block 末尾之后的 3 个元素加载到第 8h–10h 格。输出 ${sel} 的窗口需要第 ${listZh(haloNeed.map(k => `${k}h`))} 格：block ${B} 的线程 ${listZh(loadedBy)} 把 \`a[${listZh(haloNeed.map(k => B * TPB + k))}]\` 复制到那里，所以 block ${B} 永远不需要读 block ${B + 1} 的共享内存。线程 0–3 还会复制卷积核 \`b\`。`,
              )
            : L(
                `Threads 0–2 of each block also load the 3 elements just past the block's end into slots 8h–10h (block 1's are past the array, so it writes 0). Output ${sel}'s window fits inside its own block, so it does not need the halo. Threads 0–3 also copy the kernel \`b\`.`,
                `每个 block 的线程 0–2 还会把紧接在 block 末尾之后的 3 个元素加载到第 8h–10h 格（block 1 的已经超出数组，写入 0）。输出 ${sel} 的窗口完全在自己的 block 内，用不到 halo。线程 0–3 还会复制卷积核 \`b\`。`,
              ),
        };
      },
    },
    {
      name: L('Wait', '等待'),
      lines: ['barrier()'],
      scene(sel) {
        return {
          rows: rows(sel, 2),
          arrows: [],
          say: L(
            `\`barrier()\` waits until both the own elements and the halo are in shared memory. It only synchronises the threads of one block; that is fine, because thanks to the halo no block reads another block's data.`,
            '`barrier()` 等到自己的元素和 halo 都写进共享内存。它只同步同一个 block 内的线程；这已经足够，因为有了 halo，没有哪个 block 需要读别的 block 的数据。',
          ),
        };
      },
    },
    {
      name: L('Multiply-add', '乘加'),
      lines: ['var local_sum', 'comptime for j in range(CONV_2)', 'if global_i + j < SIZE_2', 'local_sum += shared_a[local_i + j] * shared_b[j]'],
      scene(sel) {
        const B = blockOf(sel), l = sel % TPB;
        const J = js(sel);
        const skipped = range(CONV).filter(j => !J.includes(j));
        return {
          rows: rows(sel, 3),
          arrows: J.flatMap(j => [arrow(sa(B, l + j), at('threads', sel), 'read'), arrow(at('sb', B * CONV + j), at('threads', sel), 'read')]),
          say: L(
            `Thread ${l} of block ${B} reads its window \`shared_a[${l}..${l + J.length - 1}]\` from its own block's shared memory${l + J.length - 1 >= TPB ? ', reaching into the halo slots' : ''}, multiplies by the kernel and adds up the products${skipped.length ? `. The window runs past the end of \`a\`, so j = ${list(skipped)} is skipped` : ''}.`,
            `block ${B} 的线程 ${l} 从自己 block 的共享内存读取窗口 \`shared_a[${l}..${l + J.length - 1}]\`${l + J.length - 1 >= TPB ? '，其中一部分来自 halo 格' : ''}，与卷积核相乘后累加${skipped.length ? `。窗口超出了 \`a\` 的末尾，所以跳过 j = ${listZh(skipped)}` : ''}。`,
          ),
          math: `local_sum = ${J.map(j => `${fmt(slotVal(B, l + j))}·${fmt(b[j])}`).join(' + ')} = ${fmt(result(sel))}`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['output[global_i] = local_sum'],
      scene(sel) {
        return {
          rows: rows(sel, 4),
          arrows: [arrow(at('threads', sel), at('output', sel), 'write')],
          say: L(
            `The thread writes its sum to \`output[${sel}]\` at its global position. Thread 7 of block 1 has no output and does nothing.`,
            `线程按全局位置把和写到 \`output[${sel}]\`。block 1 的线程 7 没有对应的输出，什么也不做。`,
          ),
        };
      },
    },
  ],
  result: () => range(SIZE).map(result),
  oracle: { file: 'p13/p13.mojo', kernel: 'conv_1d_block_boundary', buffer: 'output' },
};
