import { L, range, cell, at, arrow, fmt } from './kit.js';

// Puzzle 14 (simple): inclusive prefix sum (Hillis–Steele scan), one block of 8 threads.
const TPB = 8, SIZE = 8;
const a = range(SIZE); // main(): a_host[i] = i
const offsets = [1, 2, 4];
// levels[0] = loaded values; levels[r] = after the round with offset offsets[r-1]
const levels = [a.slice()];
for (const off of offsets) {
  const prev = levels[levels.length - 1];
  levels.push(prev.map((v, i) => (i >= off ? v + prev[i - off] : v)));
}
const final = levels[3];
// After round r, cell i holds a[lo..i] with lo = max(0, i - 2^r + 1).
const lo = (i, r) => Math.max(0, i - 2 ** r + 1);
const span = (i, r) => (lo(i, r) === i ? `a[${i}]` : `a[${lo(i, r)}..${i}]`);
// Cells at level k that feed cell `sel` at level `top`.
function feeders(sel, top) {
  const sets = { [top]: new Set([sel]) };
  for (let r = top; r >= 1; r--) {
    const off = offsets[r - 1];
    const s = new Set();
    for (const j of sets[r]) { s.add(j); if (j - off >= 0) s.add(j - off); }
    sets[r - 1] = s;
  }
  return sets;
}

function rows(sel, stage) {
  // stage 0 = load, 1..3 = rounds, 4 = write
  const shown = Math.min(stage, 3);
  const feed = feeders(sel, shown);
  const out = [
    { id: 'a', label: 'a', kind: 'global', cells: a.map((v, i) => cell(v, stage === 0 ? (feed[0].has(i) ? 'read' : undefined) : 'muted')) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads',
      cells: range(TPB).map(t => {
        if (stage === 0 || stage === 4) return cell(t, t === sel ? 'focus' : 'active');
        const off = offsets[stage - 1];
        const busy = t >= off;
        return cell(t, busy ? (t === sel ? 'focus' : 'active') : t === sel ? 'focus' : 'idle', busy ? undefined : { note: L('idle', '空闲') });
      }),
    },
  ];
  for (let k = 0; k <= shown; k++) {
    out.push({
      id: `L${k}`,
      label: k === 0 ? 'shared' : L(`offset ${offsets[k - 1]}`, `偏移 ${offsets[k - 1]}`),
      kind: 'shared',
      cells: levels[k].map((v, i) => {
        const mine = feed[k].has(i);
        let tone;
        if (k === shown && stage <= 3) tone = i === sel ? 'write' : mine ? 'focus' : undefined;
        else tone = mine ? 'focus' : 'muted';
        return cell(v, tone);
      }),
    });
  }
  out.push({
    id: 'output', label: 'output', kind: 'global',
    cells: range(SIZE).map(i => cell(stage === 4 ? final[i] : null, i === sel ? (stage === 4 ? 'write' : 'focus') : stage === 4 ? undefined : 'muted')),
  });
  return out;
}

// arrows for rounds 1..k; the ones that feed the selected cell are solid
function roundArrows(sel, k) {
  const feed = feeders(sel, k);
  const out = [];
  for (let r = 1; r <= k; r++) {
    const off = offsets[r - 1];
    for (const i of range(SIZE)) {
      const on = feed[r].has(i);
      out.push(arrow(at(`L${r - 1}`, i), at(`L${r}`, i), 'move', !on));
      if (i >= off) out.push(arrow(at(`L${r - 1}`, i - off), at(`L${r}`, i), 'move', !on));
    }
  }
  return out;
}

const round = k => ({
  name: L(`Offset ${offsets[k - 1]}`, `偏移 ${offsets[k - 1]}`),
  lines: ['for _ in range', 'if local_i >= offset and local_i < size', 'current_val = shared[local_i - offset]', 'shared[local_i] += current_val', 'offset *= 2'],
  scene(sel) {
    const off = offsets[k - 1];
    const prev = levels[k - 1];
    const workers = L(`Threads ${off}–${TPB - 1} each add the value ${off} place${off > 1 ? 's' : ''} to their left`, `线程 ${off}–${TPB - 1} 各自把左边第 ${off} 格的值加到自己的格子里`);
    const idle = off === 1 ? L('thread 0 has nothing to its left and sits idle', '线程 0 左边没有格子，保持空闲') : L(`threads 0–${off - 1} have nothing that far to their left and sit idle`, `线程 0–${off - 1} 左边没有那么远的格子，保持空闲`);
    const first = k === 1
      ? L(
          ' Each thread first copies its neighbour\'s value into a register, waits at a `barrier()`, and only then adds it. Otherwise a thread could read a cell that its neighbour has already updated in this same round.',
          '每个线程先把邻居的值读进寄存器，在 `barrier()` 处等待，然后才相加；否则它可能读到邻居在这一轮里已经改过的值。',
        )
      : L('', '');
    const doubled = k > 1 ? L(` Each round doubles the distance, so after this round every cell holds the sum of up to ${2 ** k} inputs.`, `每轮把距离翻倍，这一轮之后每格最多包含 ${2 ** k} 个输入的和。`) : L('', '');
    return {
      rows: rows(sel, k),
      arrows: roundArrows(sel, k),
      say: L(`${workers.en}; ${idle.en}.${first.en}${doubled.en}`, `${workers.zh}；${idle.zh}。${first.zh}${doubled.zh}`),
      math: sel >= off
        ? L(
            `shared[${sel}] = ${fmt(prev[sel])} + shared[${sel - off}] (${fmt(prev[sel - off])}) = ${fmt(levels[k][sel])}\n# cell ${sel} now holds ${span(sel, k)}`,
            `shared[${sel}] = ${fmt(prev[sel])} + shared[${sel - off}]（${fmt(prev[sel - off])}）= ${fmt(levels[k][sel])}\n# 第 ${sel} 格现在是 ${span(sel, k)} 的和`,
          )
        : L(
            `shared[${sel}] = ${fmt(prev[sel])}   (thread ${sel} is idle; cell ${sel} already holds ${span(sel, k)})`,
            `shared[${sel}] = ${fmt(prev[sel])}   （线程 ${sel} 空闲；第 ${sel} 格已经是 ${span(sel, k)} 的和）`,
          ),
    };
  },
});

export default {
  id: 'p14',
  num: 14,
  title: L('Prefix Sum', '前缀和'),
  goal: L(
    'Replace every element with the sum of itself and everything before it: `output[i] = a[0] + a[1] + … + a[i]`.',
    '把每个元素换成它和它前面所有元素的和：`output[i] = a[0] + a[1] + … + a[i]`。',
  ),
  idea: L(
    'One thread per element, all working in shared memory. In round 1 every thread adds its left neighbour, in round 2 the value 2 places left, then 4. Each round doubles how far back a cell reaches, so 8 elements take log₂ 8 = 3 rounds instead of 7 sequential additions.',
    '每个线程负责一个元素，都在共享内存里计算。第 1 轮每个线程加上左边相邻的值，第 2 轮加上左边第 2 格的值，然后是第 4 格。每轮让每格能覆盖的范围翻倍，所以 8 个元素只要 log₂ 8 = 3 轮，而不是依次相加 7 次。',
  ),
  data: {
    launch: L('1 block of 8 threads', '1 个 block，8 个线程'),
    tensors: [
      { name: 'a', values: a, note: L('8 elements, a[i] = i', '8 个元素，a[i] = i') },
      { name: 'output', values: range(SIZE).map(() => 0), note: L('8 elements, starts at 0', '8 个元素，初始为 0') },
      { name: 'shared', values: L('8 slots', '8 个位置'), note: L('allocated inside the kernel; the scan happens here', '在 kernel 内分配，扫描在这里进行') },
    ],
  },
  pick: { row: 'output', initial: 6, hint: L('Click an output to see which inputs end up in it.', '点击一个输出，看哪些输入最终被加进了它。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['shared[local_i] = rebind', 'barrier()'],
      scene(sel) {
        return {
          rows: rows(sel, 0),
          arrows: range(SIZE).flatMap(i => [arrow(at('a', i), at('threads', i), 'read', i !== sel), arrow(at('threads', i), at('L0', i), 'write', i !== sel)]),
          say: L(
            `Every thread copies one element of \`a\` into shared memory, where all threads of the block can read it. \`output[${sel}]\` will end up as the sum of \`a[0..${sel}]\`, highlighted in \`a\`.`,
            `每个线程把 \`a\` 的一个元素复制到共享内存，block 里的所有线程都能读到。\`output[${sel}]\` 最终是 \`a[0..${sel}]\` 的和，在 \`a\` 里已高亮。`,
          ),
          math: `shared[${sel}] = a[${sel}] = ${fmt(a[sel])}`,
        };
      },
    },
    round(1),
    round(2),
    round(3),
    {
      name: L('Write', '写回'),
      lines: ['output[global_i] = shared[local_i]'],
      scene(sel) {
        return {
          rows: rows(sel, 4),
          arrows: [...roundArrows(sel, 3), ...range(SIZE).flatMap(i => [arrow(at('L3', i), at('output', i), 'write', i !== sel)])],
          say: L(
            `Every thread writes its cell back to global memory. The solid arrows are the additions that built \`output[${sel}]\`: ${sel + 1} input${sel ? 's' : ''} combined in only 3 rounds.`,
            `每个线程把自己的格子写回全局内存。实线箭头就是组成 \`output[${sel}]\` 的那些加法：${sel + 1} 个输入只用 3 轮就合并完成。`,
          ),
          math: `output[${sel}] = ${range(sel + 1).map(i => fmt(a[i])).join(' + ')} = ${fmt(final[sel])}`,
        };
      },
    },
  ],
  result: () => final.slice(),
  oracle: { file: 'p14/p14.mojo', kernel: 'prefix_sum_simple', buffer: 'output' },
};
