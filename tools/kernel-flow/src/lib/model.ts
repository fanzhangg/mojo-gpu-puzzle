// Derived views over a simulation run: memory at a tick, per-thread semantics, linked-highlight maps.
import { fmtNum, flatToCoordStr, type Run, type Step, type Thread, type MemEvent, type Buffer } from '@/engine/engine.js';

export type ThreadView =
  | { kind: 'ready' }
  | { kind: 'run'; step: Step }
  | { kind: 'arrive'; step: Step } // executed barrier() this tick
  | { kind: 'wait'; arrived: number; total: number }
  | { kind: 'masked'; reason: Step }
  | { kind: 'done' }
  | { kind: 'err'; step?: Step };

export type Derived = {
  threadSteps: { tick: number; step: Step }[][];
  stepAt: Map<number, Step>[]; // per tick: tid -> step
  finalStep: (Step | undefined)[];
  indexVars: string[];
  touches: Map<string, 'r' | 'w' | 'rw'>[]; // per thread: cell key -> access
  touchers: Map<string, Set<number>>; // cell key -> threads
  oobCells: Map<number, string[]>; // buffer -> out-of-bounds coordinate keys
  lineCount: Map<number, number>[]; // per tick: line -> threads
};

export const evKey = (e: MemEvent) => (e.oob ? `${e.buf}:g:${e.coords.join(',')}` : `${e.buf}:${e.idx}`);
export const cellKey = (buf: number, idx: number) => `${buf}:${idx}`;

export function derive(run: Run): Derived {
  const threadSteps: Derived['threadSteps'] = run.threads.map(() => []);
  const stepAt: Derived['stepAt'] = [];
  const lineCount: Derived['lineCount'] = [];
  const touches: Derived['touches'] = run.threads.map(() => new Map());
  const touchers: Derived['touchers'] = new Map();
  const oob = new Map<number, Set<string>>();
  run.ticks.forEach((t, k) => {
    const m = new Map<number, Step>();
    const lc = new Map<number, number>();
    for (const s of t.steps) {
      m.set(s.tid, s);
      threadSteps[s.tid].push({ tick: k, step: s });
      lc.set(s.line, (lc.get(s.line) || 0) + 1);
      for (const e of s.ev) {
        const key = evKey(e);
        const prev = touches[s.tid].get(key);
        touches[s.tid].set(key, !prev ? e.op : prev === e.op ? prev : 'rw');
        if (!touchers.has(key)) touchers.set(key, new Set());
        touchers.get(key)!.add(s.tid);
        if (e.oob) {
          if (!oob.has(e.buf)) oob.set(e.buf, new Set());
          oob.get(e.buf)!.add(e.coords.join(','));
        }
      }
    }
    stepAt.push(m);
    lineCount.push(lc);
  });
  const finalStep = threadSteps.map(s => s[s.length - 1]?.step);
  const oobCells = new Map<number, string[]>();
  for (const [b, set] of oob) oobCells.set(b, [...set].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).slice(0, 24));
  return { threadSteps, stepAt, finalStep, indexVars: findIndexVars(run, threadSteps), touches, touchers, oobCells, lineCount };
}

// Variables whose value differs between threads: these are the thread's "which element am I" indices.
function findIndexVars(run: Run, threadSteps: Derived['threadSteps']): string[] {
  const order: string[] = [];
  for (const { step } of threadSteps[0] || []) {
    if (step.expl?.lhs?.length === 1 && step.expl.lhs[0].k === 'name' && !order.includes(step.expl.lhs[0].s)) order.push(step.expl.lhs[0].s);
  }
  const finals = threadSteps.map(s => s[s.length - 1]?.step.vars || {});
  const varies = order.filter(n => {
    const vals = new Set(finals.map(v => v[n]));
    return vals.size > 1 && finals.every(v => typeof v[n] === 'number');
  });
  const preferred = varies.filter(n => /^(global_i|i|idx|row|col|gi|tid|x|y|global_row|global_col)$/.test(n));
  const pick = (preferred.length ? preferred : varies).slice(0, run.block.y > 1 || run.grid.y > 1 ? 2 : 1);
  return pick;
}

export function threadView(run: Run, d: Derived, tid: number, t: number): ThreadView {
  if (t === 0) return { kind: 'ready' };
  const s = d.stepAt[t].get(tid);
  if (s) return s.err ? { kind: 'err', step: s } : s.barrier ? { kind: 'arrive', step: s } : { kind: 'run', step: s };
  const st = run.ticks[t].states[tid];
  if (st === 'wait') {
    const blk = run.threads[tid].block;
    const arrived = blk.threads.filter(x => run.ticks[t].states[x.id] === 'wait').length;
    return { kind: 'wait', arrived, total: blk.threads.length };
  }
  if (st === 'err') return { kind: 'err' };
  const fin = d.finalStep[tid];
  if (fin && fin.cond === false) return { kind: 'masked', reason: fin };
  return { kind: 'done' };
}

export function memAt(run: Run, t: number) {
  const vals = run.buffers.map(b => Float64Array.from(b.init));
  const init = run.buffers.map(b => new Uint8Array(b.data.length).fill(b.space === 'global' ? 1 : 0));
  for (let k = 1; k <= t; k++)
    for (const s of run.ticks[k].steps)
      for (const e of s.ev)
        if (e.op === 'w' && !e.oob) {
          vals[e.buf][e.idx] = e.val;
          init[e.buf][e.idx] = 1;
        }
  return { vals, init };
}

export function tShort(run: Run, th: Thread) {
  const t2 = run.block.y > 1 || run.block.z > 1;
  const tl = t2 ? `${th.x},${th.y}` : `${th.x}`;
  if (run.grid.x * run.grid.y * run.grid.z === 1) return `t${tl}`;
  const bl = run.grid.y > 1 ? `${th.block.x},${th.block.y}` : `${th.block.x}`;
  return `b${bl}·t${tl}`;
}

export function tLong(run: Run, th: Thread) {
  const two = run.block.y > 1 || run.grid.y > 1;
  const multi = run.grid.x * run.grid.y * run.grid.z > 1;
  const ti = two ? `(${th.x}, ${th.y})` : `${th.x}`;
  const bi = two ? `(${th.block.x}, ${th.block.y})` : `${th.block.x}`;
  return multi ? `Thread ${ti} of block ${bi}` : `Thread ${ti}`;
}

export function cellName(b: Buffer, idx: number) {
  return `${b.name}[${flatToCoordStr(b, idx)}]`;
}

export function spaceName(b: Buffer) {
  return b.space === 'global' ? 'global memory' : b.space === 'shared' ? 'shared memory' : 'local memory';
}

// One plain-language sentence for what a thread did (or is doing) this tick.
export function narrate(run: Run, v: ThreadView, code: string[]): string {
  switch (v.kind) {
    case 'ready':
      return 'Ready to start. Every thread runs the same kernel code; only thread_idx and block_idx differ.';
    case 'wait':
      return `Waiting at barrier(): ${v.arrived} of ${v.total} threads in this block have arrived. Nobody continues until all of them do.`;
    case 'arrive':
      return 'Reaches barrier() and stops here until every thread in its block arrives.';
    case 'masked': {
      const e = v.reason.expl;
      const cond = e?.rhs ? e.rhs.map(x => x.s).join('') : (code[v.reason.line - 1] || '').trim();
      return `Idle. Its if-condition ${cond} was False, so this thread skipped the block. On a GPU it sits masked off while the other threads run.`;
    }
    case 'done':
      return 'Finished: this thread has run the whole kernel.';
    case 'err':
      return `Stopped with an error: ${v.step?.err || 'see Checks'}.`;
    case 'run': {
      const s = v.step;
      const parts: string[] = [];
      const reads = s.ev.filter(e => e.op === 'r');
      const writes = s.ev.filter(e => e.op === 'w');
      if (s.cond !== undefined) {
        const line = (code[s.line - 1] || '').trim();
        if (/^(if|elif)\b/.test(line)) parts.push(s.cond ? 'The condition is True, so it enters this block.' : 'The condition is False, so it skips this block.');
        else if (/^while\b/.test(line)) parts.push(s.cond ? 'The loop condition is True; it runs the loop body again.' : 'The loop condition is False; the loop ends.');
      }
      for (const e of reads) {
        const b = run.buffers[e.buf];
        parts.push(e.oob ? `Reads ${b.name}[${e.coords.join(', ')}], which is outside the buffer.` : `Reads ${b.name}[${e.coords.join(', ')}] = ${fmtNum(e.val)} from ${spaceName(b)}.`);
      }
      for (const e of writes) {
        const b = run.buffers[e.buf];
        parts.push(e.oob ? `Tries to write ${fmtNum(e.val)} to ${b.name}[${e.coords.join(', ')}], outside the buffer.` : `Writes ${fmtNum(e.val)} to ${b.name}[${e.coords.join(', ')}] in ${spaceName(b)}.`);
      }
      if (!reads.length && !writes.length && s.cond === undefined && s.expl?.lhs?.[0]?.k === 'name')
        parts.push(`Computes ${s.expl.lhs[0].s} = ${s.expl.val} in a register. No memory is touched.`);
      if (s.log.length) parts.push(`Prints “${s.log.join(' ')}”.`);
      return parts.join(' ') || s.note || 'Runs this line.';
    }
  }
}

export function traffic(run: Run) {
  const per = run.threads.map(() => ({ gr: 0, gw: 0, sr: 0, sw: 0 }));
  run.ticks.forEach(t =>
    t.steps.forEach(s =>
      s.ev.forEach(e => {
        const g = run.buffers[e.buf].space === 'global';
        const k = ((g ? 'g' : 's') + e.op) as 'gr' | 'gw' | 'sr' | 'sw';
        per[s.tid][k]++;
      }),
    ),
  );
  return per;
}
