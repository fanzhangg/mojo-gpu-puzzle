import { useLayoutEffect, useRef, useState } from 'react';
import type { Scene as SceneT, Row, Cell, Lang } from '@/puzzles/index';
import { cn } from '@/lib/utils';
import { tr, UI } from '@/lib/i18n';

function cellClass(c: Cell, kind: Row['kind']) {
  const t = c.tone;
  if (kind === 'threads') {
    return cn(
      'rounded-full border font-mono text-[12px]',
      !t && 'text-muted-foreground',
      t === 'focus' && 'border-run bg-run font-bold text-white shadow-md',
      t === 'active' && 'border-run/50 bg-run-soft font-semibold text-run',
      t === 'wait' && 'hatch border-wait font-semibold text-wait',
      t === 'idle' && 'border-dashed text-muted-foreground opacity-40',
      t === 'muted' && 'text-muted-foreground opacity-35',
    );
  }
  return cn(
    'rounded-md border bg-card font-mono text-[13px] tabular-nums',
    t === 'read' && 'border-read bg-read-soft font-semibold text-read',
    t === 'write' && 'border-write bg-write font-bold text-write-foreground',
    t === 'focus' && 'border-foreground/60 font-semibold ring-1 ring-foreground/40',
    t === 'muted' && 'opacity-30',
    t === 'ghost' && 'border-dashed border-destructive/60 bg-destructive/5 text-destructive/70',
    c.v == null && 'text-muted-foreground',
  );
}

type Props = { scene: SceneT; pickRow: string; onPick: (i: number) => void; lang: Lang };

// Draws one stage: rows of cells (top to bottom), and arrows between cells.
export function Scene({ scene, pickRow, onPick, lang }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<{ d: string; kind: string; faint?: boolean }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const draw = () => {
      const r = el.getBoundingClientRect();
      const out: { d: string; kind: string; faint?: boolean }[] = [];
      for (const a of scene.arrows) {
        const f = els.current.get(a.from), t = els.current.get(a.to);
        if (!f || !t) continue;
        const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
        const down = tr.top > fr.top + 1;
        const x1 = fr.left + fr.width / 2 - r.left, x2 = tr.left + tr.width / 2 - r.left;
        let y1: number, y2: number;
        if (Math.abs(tr.top - fr.top) < 2) {
          // same row: arc above
          y1 = fr.top - r.top; y2 = tr.top - r.top - 3;
          const lift = 18 + Math.abs(x2 - x1) * 0.2;
          out.push({ d: `M${x1},${y1} C${x1},${y1 - lift} ${x2},${y2 - lift} ${x2},${y2}`, kind: a.kind, faint: a.faint });
          continue;
        }
        y1 = (down ? fr.bottom : fr.top) - r.top;
        y2 = (down ? tr.top - 3 : tr.bottom + 3) - r.top;
        const dy = (y2 - y1) * 0.5;
        out.push({ d: `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`, kind: a.kind, faint: a.faint });
      }
      setPaths(out);
      // the layout box, not scrollWidth: scrollWidth would include this arrow layer itself, so it could never shrink
      setBox({ w: el.offsetWidth, h: el.offsetHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene]);

  return (
    // w-fit + max-w-full: as wide as the content, but never wider than the card, so blocks that don't fit side
    // by side wrap onto the next line instead of being cut off
    <div ref={root} className="relative mx-auto flex w-fit max-w-full flex-col gap-7 px-4 py-6">
      {scene.rows.map(row => {
        const groups = row.groups ?? 1;
        const per = Math.ceil(row.cells.length / groups);
        const pickable = row.id === pickRow;
        return (
          <div key={row.id} className="flex min-w-0 items-center gap-4">
            <div className="w-20 shrink-0 text-right">
              <div className="font-mono text-[13px] font-semibold">{tr(row.label, lang)}</div>
              <div className={cn('text-[10px] tracking-wide', row.kind === 'shared' ? 'text-run' : 'text-muted-foreground')}>{tr(UI[row.kind], lang)}</div>
            </div>
            <div className="flex min-w-0 flex-wrap gap-4">
              {Array.from({ length: groups }, (_, g) => (
                <div key={g} className={cn('flex flex-col items-center gap-1', groups > 1 && 'rounded-lg border border-dashed px-2 pb-2 pt-1', row.kind === 'shared' && groups > 1 && 'border-run/40')}>
                  <div className={cn('grid', row.dense ? 'gap-1' : 'gap-1.5')} style={{ gridTemplateColumns: `repeat(${Math.min(per, row.cols ?? per)}, ${row.dense ? '1.85rem' : '2.75rem'})` }}>
                    {row.cells.slice(g * per, (g + 1) * per).map((c, j) => {
                      const i = g * per + j;
                      const key = `${row.id}:${i}`;
                      const Tag = pickable ? 'button' : 'div';
                      return (
                        <div key={i} ref={el => { if (el) els.current.set(key, el); else els.current.delete(key); }} className="relative flex flex-col items-center">
                          {row.kind !== 'threads' && <span className={cn('mb-0.5 font-mono text-[9.5px] leading-none text-muted-foreground', c.tone === 'muted' && 'opacity-40')}>[{c.idx ?? i}]</span>}
                          <Tag
                            {...(pickable ? { type: 'button' as const, onClick: () => onPick(i), 'aria-label': `${tr(row.label, lang)} ${c.idx ?? i}` } : {})}
                            className={cn(
                              'relative grid place-items-center transition-all duration-200',
                              row.dense ? 'h-8 w-[1.85rem] text-[11px]' : 'h-10 w-11',
                              cellClass(c, row.kind),
                              pickable && 'cursor-pointer hover:ring-2 hover:ring-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            )}
                          >
                            <span>{c.v ?? '·'}</span>
                          </Tag>
                          {row.cells.some(x => x.note) && <span className="mt-1 h-3 whitespace-nowrap text-[10px] leading-none text-muted-foreground">{tr(c.note, lang)}</span>}
                        </div>
                      );
                    })}
                  </div>
                  {groups > 1 && <span className="text-[10px] text-muted-foreground">{row.groupLabel ? tr(row.groupLabel(g), lang) : `block ${g}`}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={box.w} height={box.h} aria-hidden="true">
        <defs>
          {[['read', 'var(--read)'], ['write', 'var(--write)'], ['move', 'var(--run)'], ['ghost', 'var(--destructive)']].map(([k, c]) => (
            <marker key={k} id={`m-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: `hsl(${c})` }} />
            </marker>
          ))}
        </defs>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            markerEnd={`url(#m-${p.kind})`}
            style={{
              stroke: `hsl(var(--${p.kind === 'read' ? 'read' : p.kind === 'write' ? 'write' : p.kind === 'move' ? 'run' : 'destructive'}))`,
              strokeWidth: p.faint ? 1.2 : 2,
              strokeDasharray: p.kind === 'ghost' ? '4 4' : undefined,
              opacity: p.faint ? 0.18 : 1,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
