import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

const KW = new Set(['def', 'fn', 'var', 'if', 'elif', 'else', 'for', 'in', 'while', 'return', 'comptime', 'alias', 'and', 'or', 'not', 'from', 'import', 'where', 'break', 'continue', 'pass', 'True', 'False', 'None', 'raises', 'mut', 'struct', 'with', 'as']);
const BI = new Set(['thread_idx', 'block_idx', 'block_dim', 'grid_dim', 'global_idx', 'barrier', 'stack_allocation', 'row_major', 'col_major', 'TileTensor', 'LayoutTensor', 'Pointer', 'UnsafePointer', 'Scalar', 'Int', 'Int32', 'UInt', 'Float32', 'rebind', 'type_of', 'range', 'min', 'max', 'DType', 'Layout', 'lane_id', 'warp_sum', 'shuffle_down', 'shuffle_xor']);

function Line({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { cls?: string; s: string }[] = [];
    const re = /(#.*$)|("[^"]*"|'[^']*')|(\b\d+(?:\.\d*)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
    let i = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > i) out.push({ s: text.slice(i, m.index) });
      if (m[1]) out.push({ cls: 'tok-cm', s: m[1] });
      else if (m[2]) out.push({ cls: 'tok-str', s: m[2] });
      else if (m[3]) out.push({ cls: 'tok-num', s: m[3] });
      else if (KW.has(m[4])) out.push({ cls: 'tok-kw', s: m[4] });
      else if (BI.has(m[4])) out.push({ cls: 'tok-bi', s: m[4] });
      else out.push({ s: m[4] });
      i = m.index + m[0].length;
    }
    if (i < text.length) out.push({ s: text.slice(i) });
    return out;
  }, [text]);
  return <>{parts.length ? parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.s}</span> : p.s)) : ' '}</>;
}

// The solution kernel, read-only, with the lines of the current stage highlighted.
export function Code({ code, lines, file, title }: { code: string; lines: string[]; file: string; title: string }) {
  const rows = code.replace(/\r/g, '').split('\n');
  const hot = rows.map(l => lines.some(s => l.includes(s)));
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = first.current, b = box.current;
    if (!el || !b) return;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < b.scrollTop + 16 || bottom > b.scrollTop + b.clientHeight - 16) b.scrollTo({ top: Math.max(0, top - b.clientHeight / 3), behavior: 'smooth' });
  }, [lines]);
  const firstHot = hot.indexOf(true);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{file}</span>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-auto py-3 font-mono text-[12.5px] leading-[1.65]">
        <div>
          {rows.map((l, i) => (
            <div
              key={i}
              ref={i === firstHot ? first : undefined}
              className={cn('grid grid-cols-[2.5rem_minmax(0,1fr)] border-l-2 border-transparent pr-4 transition-colors', hot[i] ? 'border-run bg-run-soft' : firstHot >= 0 && 'opacity-50')}
            >
              <span className="select-none pr-3 text-right text-[11px] text-muted-foreground">{i + 1}</span>
              {/* long lines wrap, with the continuation indented to the line's own indentation */}
              <span className="whitespace-pre-wrap break-words" style={{ paddingLeft: `${(l.match(/^ */)?.[0].length ?? 0) + 4}ch`, textIndent: `-${4}ch` }}><Line text={l.trimStart() || ' '} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
