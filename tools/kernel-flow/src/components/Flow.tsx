import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtNum, flatToCoordStr, type Run, type Buffer } from '@/engine/engine.js';
import { type Derived, type Frame, cellKey, evKey, memAt } from '@/lib/model';
import { cn } from '@/lib/utils';

type Props = {
  run: Run;
  d: Derived;
  frame: Frame;
  hoverThread: number | null;
  onHoverThread: (tid: number | null) => void;
};

// One diagram: inputs on top, threads (grouped by block, with their shared memory) in the middle,
// outputs at the bottom. Arrows show the reads and writes of the current frame.
export function Flow({ run, d, frame, hoverThread, onHoverThread }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cellEls = useRef(new Map<string, HTMLElement>());
  const threadEls = useRef(new Map<number, HTMLElement>());
  const [wires, setWires] = useState<{ d: string; op: 'r' | 'w' | 'x'; tid: number }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const mem = useMemo(() => memAt(run, frame.tick), [run, frame.tick]);
  const steps = frame.kind === 'data' ? run.ticks[frame.tick].steps.filter(s => s.ev.length || s.xfer?.length) : [];
  const active = new Set(steps.map(s => s.tid));
  const rd = new Set<string>(), wr = new Set<string>();
  for (const s of steps) for (const e of s.ev) (e.op === 'r' ? rd : wr).add(evKey(e));
  const hoverCells = hoverThread != null ? new Set(steps.filter(s => s.tid === hoverThread).flatMap(s => s.ev.map(evKey))) : null;
  const isLast = frame.tick === run.ticks.length - 1;
  const bad = new Set<string>();
  if (isLast) for (const r of run.results) if (!r.ok && r.bad) { const b = run.buffers.find(x => x.name === r.name && x.isParam); if (b) r.bad.forEach(i => bad.add(cellKey(b.id, i))); }

  const globals = run.buffers.filter(b => b.space === 'global');
  const outs = globals.filter(b => b.written || (b.declaredMut && /^out/i.test(b.name)));
  const ins = globals.filter(b => !outs.includes(b));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const draw = () => {
      const rr = root.getBoundingClientRect();
      const out: { d: string; op: 'r' | 'w' | 'x'; tid: number }[] = [];
      // Warp/block exchanges move data between threads' registers: draw thread -> thread arcs.
      // For reductions (many senders per receiver) only draw the hovered thread's, or the first receiver's.
      const bigReceivers = steps.filter(s => (s.xfer?.length ?? 0) > 3);
      const showBig = new Set(bigReceivers.some(s => s.tid === hoverThread) ? [hoverThread] : bigReceivers.slice(0, 1).map(s => s.tid));
      for (const s of steps) {
        if (!s.xfer?.length || ((s.xfer.length > 3) && !showBig.has(s.tid))) continue;
        const to = threadEls.current.get(s.tid);
        if (!to) continue;
        const tr = to.getBoundingClientRect();
        for (const x of s.xfer) {
          const fromEl = threadEls.current.get(x.from);
          if (!fromEl) continue;
          const fr = fromEl.getBoundingClientRect();
          const x1 = fr.left + fr.width / 2 - rr.left, y1 = fr.top - rr.top;
          const x2 = tr.left + tr.width / 2 - rr.left, y2 = tr.top - rr.top - 2;
          const lift = Math.min(60, 14 + Math.abs(x2 - x1) * 0.25 + Math.abs(y2 - y1) * 0.3);
          out.push({ d: `M${x1},${y1} C${x1},${Math.min(y1, y2) - lift} ${x2},${Math.min(y1, y2) - lift} ${x2},${y2}`, op: 'x', tid: s.tid });
        }
      }
      for (const s of steps) {
        const tEl = threadEls.current.get(s.tid);
        if (!tEl) continue;
        const tr = tEl.getBoundingClientRect();
        for (const e of s.ev) {
          const cEl = cellEls.current.get(evKey(e));
          if (!cEl) continue;
          const cr = cEl.getBoundingClientRect();
          const cx = cr.left + cr.width / 2 - rr.left, tx = tr.left + tr.width / 2 - rr.left;
          const above = cr.top + cr.height / 2 < tr.top + tr.height / 2;
          const cy = (above ? cr.bottom : cr.top) - rr.top, ty = (above ? tr.top : tr.bottom) - rr.top;
          const [x1, y1, x2, y2] = e.op === 'r' ? [cx, cy, tx, ty] : [tx, ty, cx, cy];
          const dir = y2 > y1 ? 1 : -1;
          const dy = Math.max(16, Math.abs(y2 - y1) * 0.45) * dir;
          const end = y2 - 3 * dir;
          out.push({ d: `M${x1},${y1} C${x1},${y1 + dy} ${x2},${end - dy} ${x2},${end}`, op: e.op, tid: s.tid });
        }
      }
      setWires(out);
      setBox({ w: root.scrollWidth, h: root.scrollHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, frame]);

  const buf = (b: Buffer) => {
    const cols = b.shape.length >= 2 ? b.shape[b.shape.length - 1] : Math.min(b.shape[0], 16);
    const ghosts = d.oobCells.get(b.id) || [];
    return (
      <div key={b.id} className="flex items-start gap-3">
        <span className="w-14 shrink-0 pt-2.5 text-right font-mono text-[13px] font-semibold">{b.name}</span>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 2.5rem)` }}>
          {Array.from({ length: b.data.length }, (_, i) => {
            const key = cellKey(b.id, i);
            const init = mem.init[b.id][i];
            const isW = wr.has(key), isR = rd.has(key) && !isW;
            const dim = hoverCells && !hoverCells.has(key);
            return (
              <div
                key={i}
                ref={el => { if (el) cellEls.current.set(key, el); else cellEls.current.delete(key); }}
                title={`${b.name}[${flatToCoordStr(b, i)}]`}
                className={cn(
                  'relative grid h-10 w-10 place-items-center rounded-md border bg-card font-mono text-[13px] tabular-nums transition-all duration-300',
                  !init && 'text-muted-foreground/50',
                  isR && 'border-read bg-read-soft text-read',
                  isW && 'border-write bg-write font-semibold text-write-foreground',
                  dim && (isR || isW) && 'opacity-30',
                  bad.has(key) && 'border-2 border-dashed border-destructive',
                )}
              >
                {init ? fmtNum(mem.vals[b.id][i]) : '·'}
              </div>
            );
          })}
        </div>
        {ghosts.map(g => {
          const key = `${b.id}:g:${g}`;
          return (
            <div
              key={g}
              ref={el => { if (el) cellEls.current.set(key, el); else cellEls.current.delete(key); }}
              title={`${b.name}[${g}] is outside the buffer`}
              className={cn('grid h-10 w-10 place-items-center rounded-md border border-dashed border-destructive font-mono text-xs text-destructive', (wr.has(key) || rd.has(key)) && 'bg-destructive text-destructive-foreground')}
            >
              ✕
            </div>
          );
        })}
      </div>
    );
  };

  const twoD = run.block.y > 1;
  return (
    <div ref={rootRef} className="relative mx-auto flex w-max min-w-full flex-col items-center gap-10 px-4 py-8" onMouseLeave={() => onHoverThread(null)}>
      {ins.length > 0 && <div className="flex flex-wrap justify-center gap-x-10 gap-y-3">{ins.map(buf)}</div>}

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${run.grid.x}, max-content)` }}>
        {run.blocks.map(bk => {
          const shared = run.buffers.filter(b => b.space !== 'global' && b.block === bk.id);
          const barrier = frame.kind === 'barrier' && run.ticks[frame.tick].released.includes(bk.id);
          return (
            <div key={bk.id} className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 pb-4 pt-2 transition-colors', barrier && 'border-solid border-wait bg-wait-soft/60')}>
              <span className="text-[11px] text-muted-foreground">{run.blocks.length > 1 ? `block ${twoD || run.grid.y > 1 ? `(${bk.x}, ${bk.y})` : bk.x}` : 'block'}</span>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(run.block.x, 16)}, 2.5rem)` }}>
                {bk.threads.map(th => {
                  const on = active.has(th.id);
                  const masked = d.finalStep[th.id]?.cond === false && !d.threadSteps[th.id].some(x => x.step.ev.length || x.step.xfer?.length);
                  return (
                    <div
                      key={th.id}
                      ref={el => { if (el) threadEls.current.set(th.id, el); else threadEls.current.delete(th.id); }}
                      onMouseEnter={() => onHoverThread(th.id)}
                      title={masked ? 'This thread does no work: its if-condition is False' : `thread_idx ${twoD ? `(${th.x}, ${th.y})` : th.x}`}
                      className={cn(
                        'grid h-8 w-10 cursor-default place-items-center rounded-full border font-mono text-[11px] transition-all duration-300',
                        on ? 'border-run bg-run text-white' : 'text-muted-foreground',
                        masked && 'border-dashed opacity-40',
                        barrier && 'border-wait text-wait',
                        hoverThread === th.id && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                      )}
                    >
                      {twoD ? `${th.x},${th.y}` : th.x}
                    </div>
                  );
                })}
              </div>
              {barrier && <div className="h-0.5 w-full rounded bg-wait" />}
              {shared.length > 0 && <div className="mt-1 flex flex-col gap-2">{shared.map(buf)}</div>}
            </div>
          );
        })}
      </div>

      {outs.length > 0 && <div className="flex flex-wrap justify-center gap-x-10 gap-y-3">{outs.map(buf)}</div>}

      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={box.w} height={box.h} aria-hidden="true">
        <defs>
          <marker id="kf-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: 'hsl(var(--read))' }} /></marker>
          <marker id="kf-x" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: 'hsl(var(--run))' }} /></marker>
          <marker id="kf-w" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: 'hsl(var(--write))' }} /></marker>
        </defs>
        {wires.map((w, i) => (
          <path key={i} d={w.d} className={cn('wire', w.op === 'r' ? 'wire-r' : w.op === 'w' ? 'wire-w' : 'wire-x', hoverThread != null && w.tid !== hoverThread && 'wire-dim')} markerEnd={`url(#${w.op === 'r' ? 'kf-r' : w.op === 'w' ? 'kf-w' : 'kf-x'})`} />
        ))}
      </svg>
    </div>
  );
}
