import type { Expl, Seg } from '@/engine/engine.js';
import { cn } from '@/lib/utils';

// Renders a statement with every variable replaced by its value, e.g.
//   i = 4 × 1 + 2 = 6     (with "block_dim.x", "block_idx.x", "thread_idx.x" written under the numbers)
export function Breakdown({ expl, size = 'md', className }: { expl: Expl; size?: 'sm' | 'md'; className?: string }) {
  const showVal = expl.val != null && !(expl.rhs && expl.rhs.length === 1 && expl.rhs[0].k === 'v' && expl.rhs[0].s === expl.val && !expl.rhs[0].src);
  const isCond = !expl.lhs && (expl.val === 'True' || expl.val === 'False');
  return (
    <div className={cn('flex flex-wrap items-start gap-x-0.5 gap-y-1 font-mono leading-tight', size === 'sm' ? 'text-[11.5px]' : 'text-[13px]', className)}>
      {expl.lhs && <Segs segs={expl.lhs} target />}
      {expl.lhs && <span className={cn('px-1 pt-0.5', expl.arrow === '←' ? 'font-bold text-write' : 'text-muted-foreground')}>{expl.arrow}</span>}
      {expl.rhs && <Segs segs={expl.rhs} />}
      {showVal && (
        <>
          <span className="px-1 pt-0.5 text-muted-foreground">{isCond ? '→' : '='}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-bold',
              isCond ? (expl.val === 'True' ? 'bg-ok-soft text-ok' : 'bg-destructive/10 text-destructive') : 'bg-run-soft text-run',
            )}
          >
            {expl.val}
          </span>
        </>
      )}
    </div>
  );
}

function Segs({ segs, target }: { segs: Seg[]; target?: boolean }) {
  return (
    <>
      {segs.map((s, i) => (
        <SegView key={i} seg={s} target={target} />
      ))}
    </>
  );
}

function SegView({ seg, target }: { seg: Seg; target?: boolean }) {
  switch (seg.k) {
    case 'v':
      if (seg.src)
        return (
          <span className="inline-flex flex-col items-center px-px" title={`${seg.src} = ${seg.s}`}>
            <span className="rounded bg-secondary px-1 py-0.5 font-semibold text-foreground">{seg.s}</span>
            <span className="mt-0.5 max-w-[9rem] truncate font-sans text-[9.5px] leading-none text-muted-foreground">{seg.src}</span>
          </span>
        );
      return <span className="py-0.5">{seg.s}</span>;
    case 'op':
      return <span className="whitespace-pre py-0.5 text-muted-foreground">{seg.s}</span>;
    case 'p':
      return <span className="py-0.5 text-muted-foreground">{seg.s}</span>;
    case 'name':
      return <span className="py-0.5 text-muted-foreground">{seg.s}</span>;
    case 'mem':
      return (
        <span className="inline-flex flex-col items-center px-px">
          <span className={cn('rounded px-1 py-0.5 font-semibold', target ? 'bg-write-soft text-write' : 'bg-read-soft text-read')}>{seg.s}</span>
          {seg.val != null && <span className="mt-0.5 font-sans text-[9.5px] leading-none text-read">= {seg.val}</span>}
          {target && <span className="mt-0.5 font-sans text-[9.5px] leading-none text-write">write</span>}
        </span>
      );
  }
}
