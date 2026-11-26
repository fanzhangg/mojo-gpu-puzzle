import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ban, Hourglass, Check, TriangleAlert } from 'lucide-react';
import { fmtNum, flatToCoordStr, type Run, type Buffer, type Step } from '@/engine/engine.js';
import { type Derived, cellKey, evKey, memAt, threadView, tLong } from '@/lib/model';
import { cn } from '@/lib/utils';

export type Hover = { kind: 'thread'; tid: number } | { kind: 'cell'; key: string } | null;

type Props = {
  run: Run;
  d: Derived;
  t: number;
  view: 'tick' | 'run';
  scope: 'focus' | 'all';
  focus: number | null;
  cell: { buf: number; idx: number } | null;
  hover: Hover;
  onHover: (h: Hover) => void;
  onThread: (tid: number) => void;
  onCell: (buf: number, idx: number) => void;
};

export function visibleSteps(run: Run, t: number, view: 'tick' | 'run', scope: 'focus' | 'all', focus: number | null): Step[] {
  const all: Step[] = view === 'run' ? run.ticks.slice(1).flatMap(k => k.steps) : run.ticks[t].steps;
  return scope === 'focus' && focus != null ? all.filter(s => s.tid === focus) : all;
}

export function Stage(p: Props) {
  const { run, d, t } = p;
  const stageRef = useRef<HTMLDivElement>(null);
  const cellEls = useRef(new Map<string, HTMLElement>());
  const threadEls = useRef(new Map<number, HTMLElement>());
  const [paths, setPaths] = useState<{ d: string; op: 'r' | 'w'; dim: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const memT = p.view === 'run' ? run.ticks.length - 1 : t;
  const mem = useMemo(() => memAt(run, memT), [run, memT]);
  const steps = useMemo(() => visibleSteps(run, t, p.view, p.scope, p.focus), [run, t, p.view, p.scope, p.focus]);
  const contextSteps = useMemo(() => (p.scope === 'focus' ? visibleSteps(run, t, p.view, 'all', null) : steps), [run, t, p.view, p.scope, steps]);

  const { rd, wr } = useMemo(() => {
    const rd = new Set<string>(), wr = new Set<string>();
    for (const s of steps) for (const e of s.ev) (e.op === 'r' ? rd : wr).add(evKey(e));
    return { rd, wr };
  }, [steps]);
  const ctxTouched = useMemo(() => {
    const s = new Set<string>();
    for (const st of contextSteps) for (const e of st.ev) s.add(evKey(e));
    return s;
  }, [contextSteps]);

  const bad = useMemo(() => {
    const s = new Set<string>();
    if (memT !== run.ticks.length - 1) return s;
    for (const r of run.results) if (!r.ok && r.bad) { const b = run.buffers.find(x => x.name === r.name && x.isParam); if (b) r.bad.forEach(i => s.add(cellKey(b.id, i))); }
    return s;
  }, [run, memT]);

  // linked highlighting
  const hoverCells = p.hover?.kind === 'thread' ? d.touches[p.hover.tid] : null;
  const hoverThreads = p.hover?.kind === 'cell' ? d.touchers.get(p.hover.key) : null;

  const params = run.buffers.filter(b => b.space === 'global');
  const outs = params.filter(b => b.written || (b.declaredMut && /^out/i.test(b.name)));
  const ins = params.filter(b => !outs.includes(b));

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const draw = () => {
      const sr = stage.getBoundingClientRect();
      const out: { d: string; op: 'r' | 'w'; dim: boolean }[] = [];
      const seen = new Set<string>();
      const drawSet = p.scope === 'focus' ? steps : contextSteps;
      for (const s of drawSet) {
        const tEl = threadEls.current.get(s.tid);
        if (!tEl) continue;
        const tr = tEl.getBoundingClientRect();
        for (const e of s.ev) {
          const k = s.tid + e.op + evKey(e);
          if (seen.has(k)) continue;
          seen.add(k);
          const cEl = cellEls.current.get(evKey(e));
          if (!cEl || out.length > 900) continue;
          const cr = cEl.getBoundingClientRect();
          const cx = cr.left + cr.width / 2 - sr.left, tx = tr.left + tr.width / 2 - sr.left;
          const above = cr.top + cr.height / 2 < tr.top + tr.height / 2;
          const cy = (above ? cr.bottom : cr.top) - sr.top, ty = (above ? tr.top : tr.bottom) - sr.top;
          const [x1, y1, x2, y2] = e.op === 'r' ? [cx, cy, tx, ty] : [tx, ty, cx, cy];
          const dy = Math.max(18, Math.abs(y2 - y1) * 0.45) * (y2 > y1 ? 1 : -1);
          const end = y2 - (y2 > y1 ? 3 : -3);
          out.push({
            d: `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${(y1 + dy).toFixed(1)} ${x2.toFixed(1)},${(end - dy).toFixed(1)} ${x2.toFixed(1)},${end.toFixed(1)}`,
            op: e.op,
            dim: false,
          });
        }
      }
      setPaths(out);
      setSize({ w: stage.scrollWidth, h: stage.scrollHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(stage);
    window.addEventListener('resize', draw);
    return () => { ro.disconnect(); window.removeEventListener('resize', draw); };
  }, [steps, contextSteps, p.scope, p.focus, run]);

  const bufView = (b: Buffer, tag: string) => {
    const cols = b.shape.length >= 2 ? b.shape[b.shape.length - 1] : Math.min(b.shape[0], 16);
    const ghosts = d.oobCells.get(b.id) || [];
    return (
      <div key={b.id} className="min-w-0">
        <div className="mb-1.5 flex items-baseline gap-2 font-mono text-[12.5px]">
          <span className="font-bold">{b.name}</span>
          <span className="text-[11px] text-muted-foreground">[{b.shape.join('×')}] · {tag}</span>
        </div>
        <div className="flex items-start gap-2">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 2.5rem)` }}>
            {Array.from({ length: b.data.length }, (_, i) => {
              const key = cellKey(b.id, i);
              const init = mem.init[b.id][i];
              const coords = flatToCoordStr(b, i);
              const isW = wr.has(key), isR = rd.has(key) && !isW;
              const hv = hoverCells?.get(key);
              const sel = p.cell?.buf === b.id && p.cell.idx === i;
              return (
                <button
                  key={i}
                  type="button"
                  ref={el => { if (el) cellEls.current.set(key, el); else cellEls.current.delete(key); }}
                  onClick={() => p.onCell(b.id, i)}
                  onMouseEnter={() => p.onHover({ kind: 'cell', key })}
                  onMouseLeave={() => p.onHover(null)}
                  aria-label={`${b.name}[${coords}] = ${init ? fmtNum(mem.vals[b.id][i]) : 'uninitialized'}`}
                  title={`${b.name}[${coords}] = ${init ? fmtNum(mem.vals[b.id][i]) : 'uninitialized'}`}
                  className={cn(
                    'relative grid h-10 w-10 place-items-center rounded-md border bg-muted/50 font-mono text-[11.5px] tabular-nums transition-colors',
                    !init && 'text-muted-foreground',
                    ctxTouched.has(key) && !isR && !isW && 'border-foreground/25',
                    isR && 'border-read bg-read-soft shadow-[inset_0_0_0_1.5px_hsl(var(--read))]',
                    isW && 'border-write bg-write font-bold text-write-foreground animate-pulsew',
                    hv && 'ring-2 ring-offset-1 ring-offset-card',
                    hv === 'r' && 'ring-read', hv && hv !== 'r' && 'ring-write',
                    sel && 'outline outline-2 outline-offset-2 outline-foreground',
                  )}
                >
                  <span className={cn('absolute left-1 top-0.5 text-[8.5px] text-muted-foreground', isW && 'text-write-foreground/80')}>
                    {b.shape.length > 1 ? coords.replace(', ', ',') : i}
                  </span>
                  <span className="mt-1.5">{init ? fmtNum(mem.vals[b.id][i]) : '·'}</span>
                  {bad.has(key) && <span className="pointer-events-none absolute -inset-1 rounded-lg border-2 border-dashed border-destructive" />}
                </button>
              );
            })}
          </div>
          {ghosts.length > 0 && (
            <div className="flex items-center gap-[3px] border-l border-dashed border-destructive pl-2">
              <span className="text-[10px] font-medium text-destructive [writing-mode:vertical-rl] rotate-180">outside</span>
              {ghosts.map(g => {
                const key = `${b.id}:g:${g}`;
                const hot = wr.has(key) || rd.has(key);
                return (
                  <div
                    key={g}
                    ref={el => { if (el) cellEls.current.set(key, el); else cellEls.current.delete(key); }}
                    title={`${b.name}[${g}] does not exist`}
                    className={cn('relative grid h-10 w-10 place-items-center rounded-md border-[1.5px] border-dashed border-destructive bg-destructive/10 font-mono text-[11px] text-destructive', hot && 'bg-destructive text-destructive-foreground')}
                  >
                    <span className="absolute left-1 top-0.5 text-[8.5px]">{g}</span>
                    <span className="mt-1.5">✕</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const multiBlock = run.blocks.length > 1;
  const zone = (label: string, hint: string, children: React.ReactNode) => (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        <span className="font-normal normal-case tracking-normal">{hint}</span>
      </div>
      {children}
    </section>
  );

  return (
    <div ref={stageRef} className="relative flex w-max min-w-full flex-col gap-7 p-4 pb-5" onMouseLeave={() => p.onHover(null)}>
      {ins.length > 0 && zone('Global memory · inputs', 'visible to every thread in every block', <div className="flex flex-wrap items-start gap-x-8 gap-y-4">{ins.map(b => bufView(b, b.declaredMut === false ? 'read-only' : 'input'))}</div>)}

      {zone(
        `Grid · ${run.grid.x}×${run.grid.y} block${multiBlock ? 's' : ''} × ${run.block.x}×${run.block.y} threads`,
        `${run.threads.length} threads, all running the same code${d.indexVars.length ? ` · ↦ = the ${d.indexVars.join(', ')} each thread computes` : ''}`,
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: `repeat(${run.grid.x}, max-content)` }}>
          {run.blocks.map(bk => {
            let passed = 0;
            for (let k = 1; k <= t; k++) if (run.ticks[k].released.includes(bk.id)) passed++;
            const shared = run.buffers.filter(b => b.space !== 'global' && b.block === bk.id);
            return (
              <div key={bk.id} className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm">
                <div className="flex items-center justify-between gap-4 font-mono text-[11.5px] text-muted-foreground">
                  <span>block_idx = ({bk.x}, {bk.y})</span>
                  {passed > 0 && <span className="text-wait">◆ {passed} barrier{passed > 1 ? 's' : ''} passed</span>}
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(run.block.x, 16)}, 3rem)` }}>
                  {bk.threads.map(th => {
                    const v = p.view === 'run' ? null : threadView(run, d, th.id, t);
                    const fin = d.finalStep[th.id]?.vars || {};
                    const idxText = d.indexVars.map(n => (typeof fin[n] === 'number' ? fmtNum(fin[n] as number) : '–')).join(',');
                    const idxTitle = d.indexVars.map(n => `${n} = ${typeof fin[n] === 'number' ? fmtNum(fin[n] as number) : '–'}`).join(', ');
                    const focused = p.focus === th.id;
                    const linked = hoverThreads?.has(th.id);
                    const kind = v?.kind ?? (d.threadSteps[th.id].some(x => x.step.ev.length) ? 'run' : 'done');
                    const label = run.block.y > 1 ? `${th.x},${th.y}` : `${th.x}`;
                    const stateText: Record<string, string> = { ready: 'ready', run: 'running', arrive: 'at barrier', wait: 'waiting at barrier', masked: 'masked by if', done: 'finished', err: 'error' };
                    return (
                      <button
                        key={th.id}
                        type="button"
                        ref={el => { if (el) threadEls.current.set(th.id, el); else threadEls.current.delete(th.id); }}
                        onClick={() => p.onThread(th.id)}
                        onMouseEnter={() => p.onHover({ kind: 'thread', tid: th.id })}
                        onMouseLeave={() => p.onHover(null)}
                        aria-label={`${tLong(run, th)}, ${stateText[kind]}`}
                        title={`${tLong(run, th)} · ${stateText[kind]}${idxTitle ? ' · ' + idxTitle : ''}`}
                        className={cn(
                          'relative flex h-11 w-12 flex-col items-center justify-center rounded-lg border font-mono text-[11px] leading-none transition-colors',
                          kind === 'ready' && 'bg-muted/60 text-muted-foreground',
                          (kind === 'run' || kind === 'arrive') && 'border-run/60 bg-run-soft font-bold text-run',
                          kind === 'wait' && 'hatch border-wait text-wait',
                          kind === 'masked' && 'border-dashed border-masked bg-masked-soft text-masked',
                          kind === 'done' && 'border-dashed text-muted-foreground opacity-55',
                          kind === 'err' && 'border-destructive bg-destructive/10 text-destructive',
                          focused && 'outline outline-2 outline-offset-2 outline-foreground',
                          linked && 'ring-2 ring-read ring-offset-1 ring-offset-card',
                        )}
                      >
                        <span>{label}</span>
                        {idxText && <span className="mt-1 max-w-full truncate px-0.5 text-[9.5px] font-medium opacity-80">↦{idxText}</span>}
                        <span className="absolute -right-1.5 -top-1.5">
                          {kind === 'wait' && <Hourglass className="h-3.5 w-3.5 rounded-full bg-card text-wait" />}
                          {kind === 'arrive' && <Hourglass className="h-3.5 w-3.5 rounded-full bg-card text-wait" />}
                          {kind === 'masked' && <Ban className="h-3.5 w-3.5 rounded-full bg-card text-masked" />}
                          {kind === 'done' && p.view === 'tick' && <Check className="h-3.5 w-3.5 rounded-full bg-card text-muted-foreground" />}
                          {kind === 'err' && <TriangleAlert className="h-3.5 w-3.5 rounded-full bg-card text-destructive" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {shared.length > 0 && (
                  <div className="rounded-md border border-dashed bg-muted/30 p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shared memory · only this block can see it</div>
                    <div className="flex flex-wrap gap-4">{shared.map(b => bufView(b, b.space === 'shared' ? 'shared' : 'local'))}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>,
      )}

      {outs.length > 0 && zone('Global memory · outputs', 'results the host reads back', <div className="flex flex-wrap items-start gap-x-8 gap-y-4">{outs.map(b => bufView(b, 'output'))}</div>)}

      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={size.w} height={size.h} aria-hidden="true">
        <defs>
          <marker id="kf-mr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'hsl(var(--read))' }} />
          </marker>
          <marker id="kf-mw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'hsl(var(--write))' }} />
          </marker>
        </defs>
        {paths.map((w, i) => (
          <path key={i} d={w.d} className={cn('wire', w.op === 'r' ? 'wire-r' : 'wire-w', w.dim && 'wire-dim')} style={p.view === 'run' && p.scope === 'all' && paths.length > 24 ? { opacity: 0.4 } : undefined} markerEnd={`url(#${w.op === 'r' ? 'kf-mr' : 'kf-mw'})`} />
        ))}
      </svg>
    </div>
  );
}
