import { useMemo } from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, Footprints } from 'lucide-react';
import { fmtNum, flatToCoordStr, type Run, type Diag } from '@/engine/engine.js';
import { type Derived, narrate, threadView, tLong, tShort, traffic, spaceName } from '@/lib/model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breakdown } from '@/components/Breakdown';
import { cn } from '@/lib/utils';

const STATE_BADGE: Record<string, { text: string; variant: 'default' | 'secondary' | 'warn' | 'destructive' | 'outline' | 'ok' }> = {
  ready: { text: 'ready', variant: 'secondary' },
  run: { text: 'running', variant: 'default' },
  arrive: { text: 'at barrier', variant: 'warn' },
  wait: { text: 'waiting', variant: 'warn' },
  masked: { text: 'masked by if', variant: 'outline' },
  done: { text: 'finished', variant: 'secondary' },
  err: { text: 'error', variant: 'destructive' },
};

type Common = { run: Run; d: Derived; t: number; code: string[] };

export function StoryPanel({ run, d, t, code, focus, onFocus }: Common & { focus: number | null; onFocus: (tid: number) => void }) {
  // What everyone else is doing this tick, grouped.
  const others = useMemo(() => {
    const groups = new Map<string, number[]>();
    if (focus == null) return [];
    for (const o of run.threads) {
      if (o.id === focus) continue;
      const ov = threadView(run, d, o.id, t);
      const key = ov.kind === 'run' || ov.kind === 'arrive' ? `line ${(ov.step.line)}` : STATE_BADGE[ov.kind].text;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o.id);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [run, d, t, focus]);

  if (focus == null) return <p className="p-4 text-sm text-muted-foreground">Click a thread in the grid to follow it.</p>;
  const th = run.threads[focus];
  const v = threadView(run, d, focus, t);
  const step = v.kind === 'run' || v.kind === 'arrive' || v.kind === 'err' ? v.step : undefined;
  const fin = d.finalStep[focus]?.vars || {};
  const idx = d.indexVars.map(n => `${n} = ${typeof fin[n] === 'number' ? fmtNum(fin[n] as number) : '–'}`).join(', ');
  const done = d.threadSteps[focus].filter(x => x.tick <= t).length;
  const total = d.threadSteps[focus].length;


  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Footprints className="h-4 w-4 text-run" />
        <h3 className="font-mono text-sm font-bold">{tLong(run, th)}</h3>
        <Badge variant={STATE_BADGE[v.kind].variant}>{STATE_BADGE[v.kind].text}</Badge>
        {idx && <span className="font-mono text-xs text-muted-foreground">handles {idx}</span>}
        <span className="ml-auto text-xs text-muted-foreground">step {done} of {total}</span>
      </div>

      {step ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 font-mono text-[12px] text-muted-foreground">
            line {step.line}: <span className="text-foreground">{(code[step.line - 1] || '').trim()}</span>
          </div>
          {step.expl ? <Breakdown expl={step.expl} /> : <div className="font-mono text-sm">{step.note}</div>}
        </div>
      ) : (
        <div className={cn('rounded-lg border border-dashed p-3 text-sm', v.kind === 'wait' && 'hatch border-wait', v.kind === 'masked' && 'bg-masked-soft')}>
          {v.kind === 'masked' && v.reason.expl ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[12px] text-muted-foreground">line {v.reason.line}: {(code[v.reason.line - 1] || '').trim()}</span>
              <Breakdown expl={v.reason.expl} />
            </div>
          ) : (
            <span className="text-muted-foreground">{v.kind === 'ready' ? 'Not started.' : v.kind === 'wait' ? 'Paused at barrier().' : 'No more work.'}</span>
          )}
        </div>
      )}

      <p className="max-w-prose text-[13.5px] leading-relaxed">{narrate(run, v, code)}</p>

      {t === 0 && (
        <div className="rounded-lg bg-run-soft/60 p-3 text-[13px] leading-relaxed">
          <p className="font-semibold">How to read this</p>
          <p className="mt-1 text-muted-foreground">
            The GPU starts {run.threads.length} copies of the kernel at once, {run.blocks.length > 1 ? `split into ${run.blocks.length} blocks of ${run.block.x * run.block.y} threads` : 'in one block'}.
            Each copy is a thread, and each tick every thread runs one line in lockstep. Press <b>→</b> to follow this thread; click any other thread to switch.
          </p>
        </div>
      )}

      {t > 0 && others.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Meanwhile, the other {run.threads.length - 1} threads</div>
          <div className="flex flex-col gap-1.5">
            {others.slice(0, 6).map(([k, ids]) => (
              <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-28 shrink-0 text-muted-foreground">{ids.length} {k.startsWith('line') ? `on ${k}` : k}</span>
                {ids.slice(0, 18).map(id => (
                  <button key={id} type="button" onClick={() => onFocus(id)} className="rounded border bg-card px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-accent">
                    {tShort(run, run.threads[id])}
                  </button>
                ))}
                {ids.length > 18 && <span className="text-muted-foreground">+{ids.length - 18}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TickPanel({ run, d, t, code, view, onFocus, focus }: Common & { view: 'tick' | 'run'; onFocus: (tid: number) => void; focus: number | null }) {
  if (view === 'run') return <p className="p-4 text-sm text-muted-foreground">Switch to “This tick” to list what each thread did in one tick. The Traffic tab summarises the whole run.</p>;
  const tk = run.ticks[t];
  if (t === 0) return <p className="p-4 text-sm text-muted-foreground">Nothing has run yet. Step forward to see every thread's statement.</p>;
  const LIMIT = 64;
  return (
    <div className="divide-y">
      {tk.released.map(b => (
        <div key={'r' + b} className="bg-wait-soft px-4 py-2 text-xs text-wait">◆ Block ({run.blocks[b].x}, {run.blocks[b].y}): every thread reached barrier(), so all continue next tick.</div>
      ))}
      {tk.steps.slice(0, LIMIT).map(s => (
        <button key={s.tid} type="button" onClick={() => onFocus(s.tid)} className={cn('grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-2.5 text-left hover:bg-muted/50', focus === s.tid && 'bg-muted/60')}>
          <span className="rounded-full bg-run-soft px-2 py-0.5 font-mono text-[11px] font-bold text-run">{tShort(run, run.threads[s.tid])}</span>
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">{s.line}: {(code[s.line - 1] || '').trim()}</span>
          <span />
          {s.expl ? <Breakdown expl={s.expl} size="sm" /> : <span className="font-mono text-[11.5px]">{s.note}</span>}
        </button>
      ))}
      {tk.steps.length > LIMIT && <p className="px-4 py-2 text-xs text-muted-foreground">+{tk.steps.length - LIMIT} more threads</p>}
      {(() => {
        const idle = run.threads.filter(th => !d.stepAt[t].has(th.id)).length;
        return idle ? <p className="px-4 py-2 text-xs text-muted-foreground">{idle} thread{idle > 1 ? 's' : ''} did not run a statement this tick (waiting, masked, or finished).</p> : null;
      })()}
    </div>
  );
}

export function InspectorPanel({ run, d, t, code, focus, cell, onTick }: Common & { focus: number | null; cell: { buf: number; idx: number } | null; onTick: (t: number) => void }) {
  if (cell) {
    const b = run.buffers[cell.buf];
    const hist: { tick: number; tid: number; op: 'r' | 'w'; val: number; line: number }[] = [];
    run.ticks.forEach((k, ti) => k.steps.forEach(s => s.ev.forEach(e => { if (e.buf === b.id && e.idx === cell.idx && !e.oob) hist.push({ tick: ti, tid: s.tid, op: e.op, val: e.val, line: s.line }); })));
    const res = run.results.find(r => r.name === b.name && b.isParam);
    const where = b.space === 'shared' ? `shared memory of block (${run.blocks[b.block!].x}, ${run.blocks[b.block!].y})` : spaceName(b);
    return (
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="font-mono text-sm font-bold">{b.name}[{flatToCoordStr(b, cell.idx)}]</h3>
          <p className="text-xs text-muted-foreground">
            {where} · starts {b.space === 'global' ? fmtNum(b.init[cell.idx]) : 'uninitialized'} · ends {Number.isNaN(b.data[cell.idx]) ? 'uninitialized' : fmtNum(b.data[cell.idx])}
            {res?.want ? ` · expected ${fmtNum(res.want[cell.idx])}` : ''}
          </p>
        </div>
        {hist.length ? (
          <HistTable rows={hist.map(h => ({ tick: h.tick, now: h.tick === t, cells: [<Badge key="a" variant={h.op === 'r' ? 'read' : 'write'}>{h.op === 'r' ? 'read' : 'write'} {fmtNum(h.val)}</Badge>, <span key="b">{tShort(run, run.threads[h.tid])} · line {h.line}</span>] }))} onTick={onTick} />
        ) : (
          <p className="text-sm text-muted-foreground">No thread touched this cell.</p>
        )}
      </div>
    );
  }
  if (focus == null) return <p className="p-4 text-sm text-muted-foreground">Click a thread or a memory cell to see its full history.</p>;
  const th = run.threads[focus];
  const hist = d.threadSteps[focus];
  const upto = hist.filter(h => h.tick <= t);
  const vars = upto.length ? upto[upto.length - 1].step.vars || {} : {};
  const vk = Object.keys(vars);
  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="font-mono text-sm font-bold">{tLong(run, th)}</h3>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Registers at tick {t}</div>
        {vk.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-4 gap-y-1 font-mono text-xs">
            {vk.map(k => (
              <div key={k} className="flex justify-between gap-2 border-b border-dotted py-0.5">
                <span className="text-muted-foreground">{k}</span>
                <b>{typeof vars[k] === 'number' ? fmtNum(vars[k] as number) : String(vars[k])}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No local variables yet.</p>
        )}
      </div>
      <HistTable
        rows={hist.map(h => ({ tick: h.tick, now: h.tick === t, cells: [<div key="a" className="flex flex-col gap-1"><span className="truncate text-muted-foreground">{h.step.line}: {(code[h.step.line - 1] || '').trim()}</span>{h.step.expl && <Breakdown expl={h.step.expl} size="sm" />}</div>] }))}
        onTick={onTick}
      />
    </div>
  );
}

function HistTable({ rows, onTick }: { rows: { tick: number; now: boolean; cells: React.ReactNode[] }[]; onTick: (t: number) => void }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full border-collapse font-mono text-[11.5px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => onTick(r.tick)} className={cn('cursor-pointer border-b last:border-0 hover:bg-muted/50', r.now && 'bg-run-soft/70')}>
              <td className="w-px whitespace-nowrap px-2 py-1.5 text-right align-top text-muted-foreground">t{r.tick}</td>
              {r.cells.map((c, j) => <td key={j} className="px-2 py-1.5 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChecksPanel({ run, onDiag, onTick }: { run: Run; onDiag: (d: Diag) => void; onTick: (t: number) => void }) {
  const sorted = [...run.diags].sort((a, b) => (a.sev === 'error' ? 0 : 1) - (b.sev === 'error' ? 0 : 1) || a.tick - b.tick);
  return (
    <div className="divide-y">
      {run.results.filter(r => r.ok).map(r => (
        <button key={r.name} type="button" onClick={() => onTick(run.ticks.length - 1)} className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <span><b className="font-mono">{r.name}</b> matches the expected values.</span>
        </button>
      ))}
      {sorted.slice(0, 80).map((dg, i) => (
        <button key={i} type="button" onClick={() => onDiag(dg)} className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50">
          {dg.sev === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-wait" />}
          <span className="min-w-0 flex-1">{dg.msg}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">tick {dg.tick}</span>
        </button>
      ))}
      {sorted.length > 80 && <p className="px-4 py-2 text-xs text-muted-foreground">+{sorted.length - 80} more</p>}
      {!run.diags.length && (
        <div className="flex items-start gap-3 px-4 py-3 text-sm">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <span>No out-of-bounds access, data race, barrier mismatch or uninitialized read.{!run.results.length && ' Add an expect line in Launch to check the output too.'}</span>
        </div>
      )}
    </div>
  );
}

export function TrafficPanel({ run, onFocus }: { run: Run; onFocus: (tid: number) => void }) {
  const per = useMemo(() => traffic(run), [run]);
  const keys = [['gr', 'Global reads'], ['gw', 'Global writes'], ['sr', 'Shared reads'], ['sw', 'Shared writes']] as const;
  const max = (k: (typeof keys)[number][0]) => Math.max(0, ...per.map(p => p[k]));
  const sum = (k: (typeof keys)[number][0]) => per.reduce((a, p) => a + p[k], 0);
  const shBytes = run.buffers.filter(b => b.space === 'shared').reduce<Record<number, number>>((m, b) => { m[b.block!] = (m[b.block!] || 0) + b.data.length * 4; return m; }, {});
  const shPer = Math.max(0, ...Object.values(shBytes));
  const busiest = per.map((p, i) => ({ i, p, tot: p.gr + p.gw + p.sr + p.sw })).sort((a, b) => b.tot - a.tot).slice(0, 24);
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-muted-foreground">Scored like srush/GPU-Puzzles: global memory is slow, so the max global reads and writes per thread are the numbers to keep low.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keys.map(([k, label]) => (
          <div key={k} className="rounded-lg border p-3">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono text-xl font-bold tabular-nums">{max(k)}<span className="ml-1 text-xs font-normal text-muted-foreground">max / thread</span></div>
            <div className="font-mono text-[11px] text-muted-foreground">{sum(k)} total</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Shared memory per block: {shPer} bytes{shPer ? ` (${shPer / 4} × float32)` : ''} · {run.ticks.length - 1} ticks</p>
      <div className="flex flex-wrap gap-1.5">
        {busiest.map(({ i, p }) => (
          <Button key={i} variant="outline" size="sm" className="h-auto flex-col items-start gap-0 px-2 py-1 font-mono text-[10.5px]" onClick={() => onFocus(i)}>
            <span className="font-bold">{tShort(run, run.threads[i])}</span>
            <span className="text-muted-foreground">G {p.gr}r {p.gw}w · S {p.sr}r {p.sw}w</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
