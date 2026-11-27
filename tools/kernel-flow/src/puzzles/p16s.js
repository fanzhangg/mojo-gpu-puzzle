import { L, range, cell, at, arrow, fmt } from './kit.js';
import { A, B, C, SIZE, TPB, rc, tid, sampleData } from './p16.js';

// Puzzle 16 (shared memory): same 2×2 product, but the block first copies A and B into shared memory.
const sh = (r, c) => r * TPB + c; // a_shared / b_shared are TPB×TPB; only the top-left 2×2 is used
const used = i => Math.floor(i / TPB) < SIZE && i % TPB < SIZE;

function rows(sel, stage) {
  // stage 0 = load, 1 = wait, 2 = row × column from shared, 3 = write
  const [r, c] = rc(sel);
  const shTone = (i, isA) => {
    if (!used(i)) return 'muted';
    const [ir, ic] = [Math.floor(i / TPB), i % TPB];
    if (stage === 0) return ir === r && ic === c ? 'write' : undefined;
    if (stage === 1) return 'focus';
    if (stage === 2) return (isA ? ir === r : ic === c) ? 'read' : 'muted';
    return 'muted';
  };
  return [
    { id: 'a', label: 'a', kind: 'global', cols: SIZE, cells: A.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    { id: 'b', label: 'b', kind: 'global', cols: SIZE, cells: B.map((v, i) => cell(v, stage === 0 ? (i === sel ? 'read' : undefined) : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })) },
    {
      id: 'threads', label: L('threads', '线程'), kind: 'threads', cols: TPB,
      cells: range(TPB * TPB).map(t => {
        const x = t % TPB, y = Math.floor(t / TPB);
        if (!(x < SIZE && y < SIZE)) return cell(`${x},${y}`, 'idle', { note: L('no cell', '无元素') });
        const me = x === c && y === r;
        if (stage === 1) return cell(`${x},${y}`, me ? 'focus' : 'wait');
        return cell(`${x},${y}`, me ? 'focus' : stage === 2 ? 'muted' : 'active', me && stage >= 2 ? { note: `acc = ${fmt(C[sel])}` } : undefined);
      }),
    },
    { id: 'as', label: 'a_shared', kind: 'shared', cols: TPB, cells: range(TPB * TPB).map(i => cell(used(i) ? A[Math.floor(i / TPB) * SIZE + (i % TPB)] : null, shTone(i, true), { idx: `${Math.floor(i / TPB)},${i % TPB}` })) },
    { id: 'bs', label: 'b_shared', kind: 'shared', cols: TPB, cells: range(TPB * TPB).map(i => cell(used(i) ? B[Math.floor(i / TPB) * SIZE + (i % TPB)] : null, shTone(i, false), { idx: `${Math.floor(i / TPB)},${i % TPB}` })) },
    {
      id: 'output', label: 'output', kind: 'global', cols: SIZE,
      cells: range(SIZE * SIZE).map(i => cell(stage === 3 ? C[i] : null, i === sel ? (stage === 3 ? 'write' : 'focus') : stage === 3 ? undefined : 'muted', { idx: `${rc(i)[0]},${rc(i)[1]}` })),
    },
  ];
}

export default {
  id: 'p16s',
  num: 16,
  title: L('Matrix Multiplication', '矩阵乘法'),
  variant: L('Shared memory', '共享内存'),
  goal: L(
    'The same product, `output[row][col] = Σₖ a[row][k] · b[k][col]`, but loading `a` and `b` into shared memory first.',
    '同样的矩阵乘法 `output[row][col] = Σₖ a[row][k] · b[k][col]`，但先把 `a` 和 `b` 加载到共享内存。',
  ),
  idea: L(
    'In the naive version, every value of `a` and `b` is read from slow global memory by several threads. Here each thread copies just one value of `a` and one of `b` into shared memory; after a `barrier()`, all threads do their row × column from the fast copy. Each value now leaves global memory once and is reused from shared memory.',
    '在朴素版本里，`a` 和 `b` 的每个值都被好几个线程从较慢的全局内存重复读取。这里每个线程只把 `a` 的一个值和 `b` 的一个值复制到共享内存；`barrier()` 之后，所有线程都从这份高速副本里做行 × 列。每个值只从全局内存读一次，之后在共享内存里被重复使用。',
  ),
  data: {
    ...sampleData,
    tensors: [
      ...sampleData.tensors,
      { name: 'shared', values: L('a_shared, b_shared: 3×3 each, top-left 2×2 used', 'a_shared、b_shared：各 3×3，只用左上角 2×2'), note: L('allocated inside the kernel', '在 kernel 内分配') },
    ],
  },
  pick: { row: 'output', initial: 3, hint: L('Click an output cell to see which shared values it reuses.', '点击一个输出元素，看它重复使用了哪些共享内存中的值。') },
  stages: [
    {
      name: L('Load', '加载'),
      lines: ['var local_row', 'var local_col', 'a_shared[local_row, local_col] = rebind', 'b_shared[local_row, local_col] = rebind'],
      scene(sel) {
        const [r, c] = rc(sel);
        const arrows = [];
        for (const i of range(SIZE * SIZE)) {
          const [ir, ic] = rc(i);
          const t = tid(ic, ir), faint = i !== sel;
          arrows.push(arrow(at('a', i), at('threads', t), 'read', faint), arrow(at('b', i), at('threads', t), 'read', faint));
          arrows.push(arrow(at('threads', t), at('as', sh(ir, ic)), 'write', faint), arrow(at('threads', t), at('bs', sh(ir, ic)), 'write', faint));
        }
        return {
          rows: rows(sel, 0),
          arrows,
          say: L(
            `Each thread copies the one value of \`a\` and the one value of \`b\` at its own position. Thread (${c}, ${r}) copies \`a[${r}][${c}]\` and \`b[${r}][${c}]\`, not the row and column it will need later: those are loaded by its neighbours.`,
            `每个线程只复制自己位置上的那一个 \`a\` 值和一个 \`b\` 值。线程 (${c}, ${r}) 复制的是 \`a[${r}][${c}]\` 和 \`b[${r}][${c}]\`，而不是它之后要用的那一行和一列：那些由它的邻居加载。`,
          ),
          math: `a_shared[${r}][${c}] = a[${r}][${c}] = ${fmt(A[sel])}\nb_shared[${r}][${c}] = b[${r}][${c}] = ${fmt(B[sel])}`,
        };
      },
    },
    {
      name: L('Wait', '等待'),
      lines: ['barrier()'],
      scene(sel) {
        const [r, c] = rc(sel);
        const others = [...new Set([...range(SIZE).map(k => `(${k}, ${r})`), ...range(SIZE).map(k => `(${c}, ${k})`)])].filter(x => x !== `(${c}, ${r})`);
        return {
          rows: rows(sel, 1),
          arrows: [],
          say: L(
            `\`barrier()\` waits until all four values of each matrix are in shared memory. Thread (${c}, ${r}) needs values that threads ${others.join(', ')} loaded, so it must not start earlier.`,
            `\`barrier()\` 等到两个矩阵的四个值都进入共享内存。线程 (${c}, ${r}) 需要线程 ${others.join('、')} 加载的值，所以不能提前开始。`,
          ),
        };
      },
    },
    {
      name: L('Row × column', '行 × 列'),
      lines: ['var acc', 'comptime for k in range(size)', 'acc += a_shared[local_row, k] * b_shared[k, local_col]'],
      scene(sel) {
        const [r, c] = rc(sel);
        const me = tid(c, r);
        return {
          rows: rows(sel, 2),
          arrows: range(SIZE).flatMap(k => [arrow(at('as', sh(r, k)), at('threads', me), 'read'), arrow(at('bs', sh(k, c)), at('threads', me), 'read')]),
          say: L(
            `Thread (${c}, ${r}) does the same row × column as before, but reads from shared memory. Row ${r} of \`a_shared\` is also read by the other thread in row ${r}: one global read, ${SIZE} uses. Each thread now makes 2 global reads instead of ${2 * SIZE}.`,
            `线程 (${c}, ${r}) 做和之前一样的行 × 列，但改为从共享内存读取。\`a_shared\` 的第 ${r} 行也会被同一行的另一个线程读取：一次全局读取，用了 ${SIZE} 次。每个线程现在只读 2 次全局内存，而不是 ${2 * SIZE} 次。`,
          ),
          math: `acc = ${range(SIZE).map(k => `a_shared[${r}][${k}]·b_shared[${k}][${c}]`).join(' + ')}\n    = ${range(SIZE).map(k => `${fmt(A[r * SIZE + k])}·${fmt(B[k * SIZE + c])}`).join(' + ')} = ${fmt(C[sel])}`,
        };
      },
    },
    {
      name: L('Write', '写回'),
      lines: ['output[row, col] = acc'],
      scene(sel) {
        const [r, c] = rc(sel);
        return {
          rows: rows(sel, 3),
          arrows: [arrow(at('threads', tid(c, r)), at('output', sel), 'write')],
          say: L(`Thread (${c}, ${r}) writes \`output[${r}][${c}]\`, the same result as the naive version with fewer slow reads.`, `线程 (${c}, ${r}) 写出 \`output[${r}][${c}]\`：结果与朴素版本相同，但慢速读取更少。`),
          math: `output[${r}][${c}] = ${fmt(C[sel])}`,
        };
      },
    },
  ],
  result: () => C.slice(),
  oracle: { file: 'p16/p16.mojo', kernel: 'single_block_matmul', buffer: 'output', inputs: { b: 'arange(SIZE * SIZE) * 2' } },
};
