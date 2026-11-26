import { useRef } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { Run } from '@/engine/engine.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

type Props = {
  run: Run;
  t: number;
  playing: boolean;
  speed: string;
  view: 'tick' | 'run';
  scope: 'focus' | 'all';
  focusLabel: string | null;
  onTick: (t: number) => void;
  onPlay: () => void;
  onSpeed: (s: string) => void;
  onView: (v: 'tick' | 'run') => void;
  onScope: (s: 'focus' | 'all') => void;
};

function IconButton({ label, kbd, onClick, children }: { label: string; kbd: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label} <Kbd className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">{kbd}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function Transport(p: Props) {
  const { run, t } = p;
  const n = run.ticks.length;
  const last = n - 1;
  const tl = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const maxAct = Math.max(1, ...run.ticks.map(k => k.steps.length));
  const badTicks = new Set(run.diags.filter(d => d.sev === 'error').map(d => d.tick));
  const tickFromX = (x: number) => {
    const r = tl.current!.getBoundingClientRect();
    return Math.max(0, Math.min(last, Math.floor(((x - r.left) / r.width) * n)));
  };
  const barriers = run.ticks.slice(1, t + 1).reduce((a, k) => a + (k.released.length ? 1 : 0), 0);

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1">
          <IconButton label="First tick" kbd="Home" onClick={() => p.onTick(0)}><ChevronFirst /></IconButton>
          <IconButton label="Previous tick" kbd="←" onClick={() => p.onTick(t - 1)}><ChevronLeft /></IconButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" onClick={p.onPlay} aria-label={p.playing ? 'Pause' : 'Play'}>
                {p.playing ? <Pause /> : <Play />}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">{p.playing ? 'Pause' : 'Play'} <Kbd className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">Space</Kbd></TooltipContent>
          </Tooltip>
          <IconButton label="Next tick" kbd="→" onClick={() => p.onTick(t + 1)}><ChevronRight /></IconButton>
          <IconButton label="Last tick" kbd="End" onClick={() => p.onTick(last)}><ChevronLast /></IconButton>
        </div>
        <div className="min-w-[8.5rem] font-mono text-sm tabular-nums">
          {p.view === 'run' ? (
            <span className="font-semibold">Whole run · {last} ticks</span>
          ) : (
            <>
              tick <span className="text-base font-bold">{t}</span>
              <span className="text-muted-foreground"> / {last}</span>
            </>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.view === 'run' ? 'every read and write at once' : t === 0 ? 'launched, nothing has run yet' : `${run.ticks[t].steps.length} thread${run.ticks[t].steps.length === 1 ? '' : 's'} stepped${barriers ? ` · ${barriers} barrier release${barriers > 1 ? 's' : ''} so far` : ''}`}
        </div>
        <div className="flex-1" />
        <Select value={p.speed} onValueChange={p.onSpeed}>
          <SelectTrigger className="h-8 w-[92px] text-xs" aria-label="Playback speed"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">0.5×</SelectItem>
            <SelectItem value="550">1×</SelectItem>
            <SelectItem value="250">2×</SelectItem>
            <SelectItem value="100">5×</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        ref={tl}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={t}
        className="relative flex h-12 cursor-pointer touch-none select-none items-end gap-[2px] rounded-md pt-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); p.onTick(tickFromX(e.clientX)); }}
        onPointerMove={e => { if (drag.current) { const k = tickFromX(e.clientX); if (k !== t) p.onTick(k); } }}
        onPointerUp={() => { drag.current = false; }}
      >
        {run.ticks.map((k, i) => {
          const w = k.steps.some(s => s.ev.some(e => e.op === 'w'));
          const r = k.steps.some(s => s.ev.some(e => e.op === 'r'));
          const h = i === 0 ? 10 : Math.max(10, Math.round((k.steps.length / maxAct) * 100));
          const cur = p.view === 'tick' && i === t;
          return (
            <div key={i} className={cn('relative flex h-full min-w-[3px] max-w-10 flex-1 items-end rounded-sm', cur && 'bg-muted ring-2 ring-foreground ring-offset-1 ring-offset-card')} title={`tick ${i}: ${k.steps.length} threads`}>
              <i className={cn('block w-full rounded-t-sm', w ? 'bg-write/80' : r ? 'bg-read/75' : 'bg-border', cur && 'opacity-100')} style={{ height: `${h}%` }} />
              {k.released.length > 0 && <span className="absolute -top-2.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-wait" />}
              {badTicks.has(i) && <span className="absolute -bottom-1 left-0 right-0 h-[3px] rounded bg-destructive" />}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-write" />writes memory</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-read" />reads only</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-border" />control flow</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rotate-45 bg-wait" />barrier released</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-[3px] w-3 rounded bg-destructive" />problem</span>
          <span>bar height = threads active</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.scope} onValueChange={v => v && p.onScope(v as 'focus' | 'all')} aria-label="Whose arrows to show">
            <ToggleGroupItem value="focus" className="text-xs">{p.focusLabel ? `Follow ${p.focusLabel}` : 'Follow one'}</ToggleGroupItem>
            <ToggleGroupItem value="all" className="text-xs">All threads</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={p.view} onValueChange={v => v && p.onView(v as 'tick' | 'run')} aria-label="Time range">
            <ToggleGroupItem value="tick" className="text-xs">This tick</ToggleGroupItem>
            <ToggleGroupItem value="run" className="text-xs">Whole run</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </Card>
  );
}
