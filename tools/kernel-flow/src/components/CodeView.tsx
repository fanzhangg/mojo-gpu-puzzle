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

type Props = {
  code: string;
  kernelRange: [number, number] | null;
  activeLine: number | null;
  focusLine: number | null; // the hovered thread's line, if different
  errorLine: number | null;
};

// Read-only source with the selected kernel emphasised and the running line highlighted.
export function CodeView({ code, kernelRange, activeLine, focusLine, errorLine }: Props) {
  const lines = code.replace(/\r/g, '').split('\n');
  const box = useRef<HTMLDivElement>(null);
  const lineEls = useRef(new Map<number, HTMLDivElement>());

  const scrollTo = (n: number | null, center: boolean) => {
    const el = n ? lineEls.current.get(n) : null, b = box.current;
    if (!el || !b) return;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (center || top < b.scrollTop + 24 || bottom > b.scrollTop + b.clientHeight - 24)
      b.scrollTo({ top: Math.max(0, top - (center ? 16 : b.clientHeight / 3)), behavior: center ? 'auto' : 'smooth' });
  };
  useEffect(() => { scrollTo(kernelRange?.[0] ?? null, true); }, [code, kernelRange?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollTo(focusLine ?? activeLine, false); }, [activeLine, focusLine]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={box} className="absolute inset-0 overflow-auto py-2 font-mono text-[12.5px] leading-[1.7]">
      <div className="w-max min-w-full">
        {lines.map((l, i) => {
          const n = i + 1;
          const inKernel = !kernelRange || (n >= kernelRange[0] && n <= kernelRange[1]);
          const active = n === activeLine;
          const focus = n === focusLine && focusLine !== activeLine;
          return (
            <div
              key={i}
              ref={el => { if (el) lineEls.current.set(n, el); else lineEls.current.delete(n); }}
              className={cn(
                'grid grid-cols-[3rem_auto] border-l-2 border-transparent pr-4',
                !inKernel && 'opacity-40',
                active && 'border-run bg-run-soft',
                focus && 'border-foreground/40 bg-muted',
                n === errorLine && 'border-destructive bg-destructive/10',
              )}
            >
              <span className={cn('select-none pr-4 text-right text-[11px] text-muted-foreground', active && 'font-bold text-run')}>{n}</span>
              <span className="whitespace-pre"><Line text={l} /></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
