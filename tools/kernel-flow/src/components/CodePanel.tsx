import { useEffect, useMemo, useRef } from 'react';
import { Pencil, Check } from 'lucide-react';
import type { Step } from '@/engine/engine.js';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Breakdown } from '@/components/Breakdown';
import { cn } from '@/lib/utils';

const KW = new Set(['def', 'fn', 'var', 'if', 'elif', 'else', 'for', 'in', 'while', 'return', 'comptime', 'alias', 'and', 'or', 'not', 'from', 'import', 'where', 'break', 'continue', 'pass', 'True', 'False', 'None', 'raises', 'mut', 'struct']);
const BI = new Set(['thread_idx', 'block_idx', 'block_dim', 'grid_dim', 'global_idx', 'barrier', 'stack_allocation', 'row_major', 'col_major', 'TileTensor', 'LayoutTensor', 'Pointer', 'UnsafePointer', 'Scalar', 'Int', 'Int32', 'UInt', 'Float32', 'rebind', 'type_of', 'range', 'min', 'max', 'DType', 'Layout']);

function Highlight({ line }: { line: string }) {
  const parts = useMemo(() => {
    const out: { cls?: string; s: string }[] = [];
    const re = /(#.*$)|("[^"]*"|'[^']*')|(\b\d+(?:\.\d*)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
    let i = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > i) out.push({ s: line.slice(i, m.index) });
      if (m[1]) out.push({ cls: 'tok-cm', s: m[1] });
      else if (m[2]) out.push({ cls: 'tok-str', s: m[2] });
      else if (m[3]) out.push({ cls: 'tok-num', s: m[3] });
      else if (KW.has(m[4])) out.push({ cls: 'tok-kw', s: m[4] });
      else if (BI.has(m[4])) out.push({ cls: 'tok-bi', s: m[4] });
      else out.push({ s: m[4] });
      i = m.index + m[0].length;
    }
    if (i < line.length) out.push({ s: line.slice(i) });
    return out;
  }, [line]);
  return (
    <>
      {parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.s}</span> : p.s))}
      {!line && ' '}
    </>
  );
}

type Props = {
  code: string;
  editing: boolean;
  draft: string;
  onDraft: (s: string) => void;
  onToggleEdit: () => void;
  onRun: () => void;
  lineCounts: Map<number, number> | null;
  focusStep: Step | null;
  focusLabel: string;
  errLine: number | null;
  error: string | null;
  warn: string | null;
  kernelRange: [number, number] | null;
};

export function CodePanel(p: Props) {
  const lines = p.code.replace(/\r/g, '').split('\n');
  const activeRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = activeRef.current, box = boxRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop, bottom = top + el.offsetHeight;
    if (top < box.scrollTop + 8 || bottom > box.scrollTop + box.clientHeight - 8) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
  }, [p.focusStep]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">Kernel source</CardTitle>
          <CardDescription className="text-xs">{p.editing ? 'Paste or edit a kernel, then run it.' : p.focusStep ? `▸ marks the line ${p.focusLabel} is running, with every value filled in.` : 'Lines light up as threads run them.'}</CardDescription>
        </div>
        <Button variant={p.editing ? 'default' : 'outline'} size="sm" onClick={p.onToggleEdit}>
          {p.editing ? <Check /> : <Pencil />}
          {p.editing ? 'Done' : 'Edit'}
        </Button>
      </CardHeader>
      {p.error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{p.error}</AlertDescription>
        </Alert>
      )}
      {p.warn && !p.error && (
        <div className="border-b bg-wait-soft px-4 py-2 text-xs text-wait">{p.warn}</div>
      )}
      {p.editing ? (
        <Textarea
          value={p.draft}
          onChange={e => p.onDraft(e.target.value)}
          spellCheck={false}
          aria-label="Edit kernel source"
          className="min-h-[460px] resize-y rounded-none border-0 bg-muted/40 font-mono text-[12.5px] leading-relaxed shadow-none focus-visible:ring-0 md:text-[12.5px]"
          style={{ tabSize: 4, whiteSpace: 'pre' }}
          onKeyDown={e => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const ta = e.currentTarget, s = ta.selectionStart;
              ta.setRangeText('    ', s, ta.selectionEnd, 'end');
              p.onDraft(ta.value);
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); p.onRun(); }
          }}
        />
      ) : (
        <div ref={boxRef} className="max-h-[64vh] overflow-auto py-2 font-mono text-[12.5px] leading-[1.65]">
          <div className="w-max min-w-full">
          {lines.map((l, i) => {
            const n = i + 1;
            const count = p.lineCounts?.get(n) || 0;
            const mine = p.focusStep?.line === n;
            const inKernel = !p.kernelRange || (n >= p.kernelRange[0] && n <= p.kernelRange[1]);
            return (
              <div key={i} ref={mine ? activeRef : undefined}>
                <div
                  className={cn(
                    'grid grid-cols-[2.25rem_2.25rem_auto] items-center border-l-[3px] border-transparent pr-4',
                    count > 0 && 'bg-run-soft/70',
                    mine && 'border-run bg-run-soft',
                    p.errLine === n && 'border-destructive bg-destructive/10',
                    !inKernel && 'opacity-60',
                  )}
                >
                  <span className="flex justify-center">
                    {count > 0 && (
                      <span className="rounded-full bg-run/15 px-1 font-sans text-[9.5px] font-semibold leading-4 text-run" title={`${count} thread${count > 1 ? 's' : ''} ran this line in this view`}>
                        ×{count}
                      </span>
                    )}
                  </span>
                  <span className={cn('select-none pr-3 text-right text-[11px] text-muted-foreground', mine && 'font-bold text-run')}>
                    {mine ? '▸' : ''}{n}
                  </span>
                  <span className="whitespace-pre"><Highlight line={l} /></span>
                </div>
                {mine && p.focusStep?.expl && (
                  <div className="sticky left-0 max-w-[min(100%,36rem)] border-l-[3px] border-run bg-run-soft/40 py-2 pl-[4.75rem] pr-3">
                    <Breakdown expl={p.focusStep.expl} />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </Card>
  );
}
