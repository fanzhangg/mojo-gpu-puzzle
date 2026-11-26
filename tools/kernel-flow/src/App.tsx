import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Cpu } from 'lucide-react';
import { parseProgram, simulate, defaultLaunch, type Run, type Program, type Diag } from '@/engine/engine.js';
import PRESETS from '@/presets.json';
import { derive, tShort, type Derived } from '@/lib/model';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CodePanel } from '@/components/CodePanel';
import { Stage, type Hover } from '@/components/Stage';
import { Transport } from '@/components/Transport';
import { StoryPanel, TickPanel, InspectorPanel, ChecksPanel, TrafficPanel } from '@/components/Panels';

type Preset = { id: string; title: string; code: string; launch: string };
const presets = PRESETS as Preset[];
const STORE = 'kernel-flow:v2';

type Saved = { code: string; launch: string; preset: string; kernelIdx: number };
function loadSaved(): Saved | null {
  try { const raw = localStorage.getItem(STORE); return raw ? (JSON.parse(raw) as Saved) : null; } catch { return null; }
}
function save(s: Saved) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

type Exec = { prog: Program | null; run: Run | null; d: Derived | null; codeErr: string | null; errLine: number | null; launchErr: string | null; warn: string | null };

function execute(code: string, launch: string, kernelIdx: number): Exec & { launch: string } {
  let prog: Program;
  try { prog = parseProgram(code); }
  catch (e) { const err = e as { message: string; line?: number }; return { prog: null, run: null, d: null, codeErr: (err.line ? `Line ${err.line}: ` : '') + err.message, errLine: err.line ?? null, launchErr: null, warn: null, launch }; }
  if (!prog.kernels.length) return { prog, run: null, d: null, codeErr: 'No kernel found. Paste a def that uses thread_idx, block_idx or barrier().', errLine: null, launchErr: null, warn: null, launch };
  const kernel = prog.kernels[Math.min(kernelIdx, prog.kernels.length - 1)];
  if (!launch.trim()) launch = defaultLaunch(prog, kernel);
  const warn = prog.constErrors.length ? `Line ${prog.constErrors[0].line}: ${prog.constErrors[0].message}` : null;
  try {
    const run = simulate(prog, kernel, launch);
    return { prog, run, d: derive(run), codeErr: null, errLine: null, launchErr: null, warn, launch };
  } catch (e) {
    const err = e as { message: string; line?: number; launch?: boolean };
    return { prog, run: null, d: null, codeErr: null, errLine: null, launchErr: (err.launch && err.line ? `Line ${err.line}: ` : '') + err.message, warn, launch };
  }
}

export default function App() {
  const initial = useMemo(() => {
    const s = loadSaved();
    if (s?.code) return s;
    const p = presets.find(x => x.id === 'p08') || presets[0];
    return { code: p.code, launch: p.launch, preset: p.id, kernelIdx: 0 };
  }, []);
  const [code, setCode] = useState(initial.code);
  const [draft, setDraft] = useState(initial.code);
  const [launch, setLaunch] = useState(initial.launch);
  const [preset, setPreset] = useState(initial.preset);
  const [kernelIdx, setKernelIdx] = useState(initial.kernelIdx || 0);
  const [editing, setEditing] = useState(false);
  const [ex, setEx] = useState<Exec>(() => execute(initial.code, initial.launch, initial.kernelIdx || 0));
  const [t, setT] = useState(0);
  const [view, setView] = useState<'tick' | 'run'>('tick');
  const [scope, setScope] = useState<'focus' | 'all'>('focus');
  const [focus, setFocus] = useState<number | null>(0);
  const [cell, setCell] = useState<{ buf: number; idx: number } | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('550');
  const [tab, setTab] = useState('story');

  const { run, d } = ex;
  const last = run ? run.ticks.length - 1 : 0;

  const runNow = useCallback((c: string, l: string, k: number, p: string) => {
    const r = execute(c, l, k);
    setEx(r);
    if (r.launch !== l) setLaunch(r.launch);
    setT(0);
    setPlaying(false);
    setCell(null);
    setFocus(f => (r.run && f != null && f < r.run.threads.length ? f : r.run ? 0 : null));
    save({ code: c, launch: r.launch, preset: p, kernelIdx: k });
  }, []);

  const loadPreset = (id: string) => {
    const p = presets.find(x => x.id === id);
    if (!p) { setPreset('custom'); setEditing(true); setDraft(code); return; }
    setPreset(id); setCode(p.code); setDraft(p.code); setLaunch(p.launch); setKernelIdx(0); setEditing(false); setFocus(0); setView('tick');
    runNow(p.code, p.launch, 0, id);
  };

  const onRun = () => {
    const c = editing ? draft : code;
    if (editing) { setCode(c); setEditing(false); }
    let p = preset;
    const pr = presets.find(x => x.id === preset);
    if (pr && (pr.code !== c || pr.launch !== launch)) { p = 'custom'; setPreset('custom'); }
    runNow(c, launch, kernelIdx, p);
  };

  const goTo = useCallback((k: number) => { setView('tick'); setT(Math.max(0, Math.min(last, k))); }, [last]);
  const stepTo = (k: number) => { setPlaying(false); goTo(k); };

  // playback
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (tRef.current >= last) { setPlaying(false); return; }
      setT(tRef.current + 1);
    }, +speed);
    return () => clearInterval(id);
  }, [playing, speed, last]);
  const togglePlay = () => {
    if (!run) return;
    if (playing) { setPlaying(false); return; }
    setView('tick');
    if (t >= last) setT(0);
    setPlaying(true);
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('textarea, input, [role="listbox"], [role="combobox"]')) return;
      if (!run) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepTo(t + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepTo(t - 1); }
      else if (e.key === 'Home') { e.preventDefault(); stepTo(0); }
      else if (e.key === 'End') { e.preventDefault(); stepTo(last); }
      else if (e.key === ' ' && !el.closest('button')) { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onThread = (tid: number) => { setFocus(tid); setCell(null); if (scope === 'all') setScope('focus'); };
  const onCell = (buf: number, idx: number) => { setCell(c => (c && c.buf === buf && c.idx === idx ? null : { buf, idx })); setTab('inspect'); };
  const onDiag = (dg: Diag) => {
    if (dg.tid != null) { setFocus(dg.tid); setCell(null); setTab('story'); }
    else if (dg.buf != null && dg.idx != null) { setCell({ buf: dg.buf, idx: dg.idx }); setTab('inspect'); }
    stepTo(Math.min(dg.tick, last));
  };

  const codeLines = code.split('\n');
  const focusStep = run && d && focus != null && view === 'tick' ? d.stepAt[t].get(focus) ?? null : null;
  const lineCounts = useMemo(() => {
    if (!run || !d) return null;
    if (view === 'run') { const m = new Map<number, number>(); d.lineCount.forEach(lc => lc.forEach((v, k) => m.set(k, (m.get(k) || 0) + v))); return m; }
    return d.lineCount[t];
  }, [run, d, t, view]);
  const focusLabel = run && focus != null ? tShort(run, run.threads[focus]) : null;
  const errs = run ? run.diags.filter(x => x.sev === 'error').length : 0;
  const warns = run ? run.diags.filter(x => x.sev === 'warn').length : 0;
  const kernel = ex.prog?.kernels[Math.min(kernelIdx, (ex.prog?.kernels.length || 1) - 1)];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Cpu className="h-5 w-5" /></div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">Kernel Flow</h1>
              <p className="text-xs text-muted-foreground">Follow a Mojo GPU kernel one thread and one tick at a time</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={preset} onValueChange={loadPreset}>
              <SelectTrigger className="w-[260px]" aria-label="Example kernel"><SelectValue placeholder="Choose an example" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Solved puzzles</SelectLabel>
                  {presets.filter(p => !p.id.startsWith('bug')).map(p => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Bug demos</SelectLabel>
                  {presets.filter(p => p.id.startsWith('bug')).map(p => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectGroup>
                <SelectSeparator />
                <SelectItem value="custom">Your own code</SelectItem>
              </SelectContent>
            </Select>
            {ex.prog && ex.prog.kernels.length > 1 && (
              <Select value={String(kernelIdx)} onValueChange={v => { const k = +v; setKernelIdx(k); const l = defaultLaunch(ex.prog!, ex.prog!.kernels[k]); setLaunch(l); runNow(code, l, k, 'custom'); setPreset('custom'); }}>
                <SelectTrigger className="w-[220px]" aria-label="Kernel"><SelectValue /></SelectTrigger>
                <SelectContent>{ex.prog.kernels.map((k, i) => <SelectItem key={i} value={String(i)}>{k.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button onClick={onRun}><Play />Run kernel</Button>
          </div>
        </header>

        <main className="grid items-start gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
          <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1 lg:sticky lg:top-4">
            <CodePanel
              code={editing ? draft : code}
              editing={editing}
              draft={draft}
              onDraft={setDraft}
              onToggleEdit={() => { if (editing) onRun(); else { setDraft(code); setEditing(true); } }}
              onRun={onRun}
              lineCounts={lineCounts}
              focusStep={focusStep}
              focusLabel={focusLabel || 'the thread'}
              errLine={ex.errLine}
              error={ex.codeErr}
              warn={ex.warn}
              kernelRange={kernel ? [kernel.line, kernel.endLine] : null}
            />
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
                <div>
                  <CardTitle className="text-sm">Launch</CardTitle>
                  <CardDescription className="text-xs">Grid size, block size and the input buffers.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { if (ex.prog && kernel) setLaunch(defaultLaunch(ex.prog, kernel)); }}><RotateCcw />Reset</Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-4 pb-4">
                <Textarea value={launch} onChange={e => setLaunch(e.target.value)} spellCheck={false} aria-label="Launch settings" className="min-h-[150px] font-mono text-[12.5px] leading-relaxed md:text-[12.5px]" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onRun(); } }} />
                {ex.launchErr && <Alert variant="destructive" className="py-2"><AlertDescription className="text-xs">{ex.launchErr}</AlertDescription></Alert>}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  One <code className="rounded bg-muted px-1">name = value</code> per line. Names from <code className="rounded bg-muted px-1">comptime</code> lines work. Helpers: <code className="rounded bg-muted px-1">zeros(n)</code> <code className="rounded bg-muted px-1">ones(n)</code> <code className="rounded bg-muted px-1">arange(n)</code> <code className="rounded bg-muted px-1">fill(n, v)</code> <code className="rounded bg-muted px-1">cumsum(x)</code> <code className="rounded bg-muted px-1">sum(x)</code>. Start a line with <code className="rounded bg-muted px-1">expect</code> to check a buffer after the run.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
            {run && d ? (
              <>
                <Transport run={run} t={t} playing={playing} speed={speed} view={view} scope={scope} focusLabel={focusLabel} onTick={stepTo} onPlay={togglePlay} onSpeed={setSpeed} onView={v => { setPlaying(false); setView(v); }} onScope={s => { setScope(s); if (s === 'focus' && focus == null) setFocus(0); }} />
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                    {run.results.map(r => <Badge key={r.name} variant={r.ok ? 'ok' : 'destructive'}>{r.ok ? '✓' : '✕'} {r.name} {r.ok ? 'correct' : 'wrong'}</Badge>)}
                    {errs > 0 && <Badge variant="destructive">{errs} error{errs > 1 ? 's' : ''}</Badge>}
                    {warns > 0 && <Badge variant="warn">{warns} warning{warns > 1 ? 's' : ''}</Badge>}
                    {!errs && !warns && <Badge variant="ok">no problems found</Badge>}
                    {run.results.some(r => r.ok) && run.diags.some(x => x.kind === 'race') && (
                      <span className="basis-full text-xs text-destructive">The output matched here only because this simulator runs threads in a fixed order. On real hardware a race can give a different answer on every run.</span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">Hover a thread to see every cell it touches; hover a cell to see which threads touch it.</span>
                  </div>
                  <div className="overflow-x-auto">
                    <Stage run={run} d={d} t={t} view={view} scope={scope} focus={focus} cell={cell} hover={hover} onHover={setHover} onThread={onThread} onCell={onCell} />
                  </div>
                  <Legend />
                </Card>
                <Card>
                  <Tabs value={tab} onValueChange={setTab}>
                    <div className="overflow-x-auto border-b px-3 py-2">
                      <TabsList>
                        <TabsTrigger value="story">Story</TabsTrigger>
                        <TabsTrigger value="tick">All threads</TabsTrigger>
                        <TabsTrigger value="inspect">Inspector</TabsTrigger>
                        <TabsTrigger value="checks">Checks{(errs + warns) > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{errs + warns}</span>}</TabsTrigger>
                        <TabsTrigger value="traffic">Traffic</TabsTrigger>
                      </TabsList>
                    </div>
                    <div className="max-h-[460px] overflow-auto">
                      <TabsContent value="story" className="mt-0"><StoryPanel run={run} d={d} t={view === 'run' ? last : t} code={codeLines} focus={focus} onFocus={onThread} /></TabsContent>
                      <TabsContent value="tick" className="mt-0"><TickPanel run={run} d={d} t={t} code={codeLines} view={view} focus={focus} onFocus={tid => { onThread(tid); setTab('story'); }} /></TabsContent>
                      <TabsContent value="inspect" className="mt-0"><InspectorPanel run={run} d={d} t={t} code={codeLines} focus={focus} cell={cell} onTick={stepTo} /></TabsContent>
                      <TabsContent value="checks" className="mt-0"><ChecksPanel run={run} onDiag={onDiag} onTick={stepTo} /></TabsContent>
                      <TabsContent value="traffic" className="mt-0"><TrafficPanel run={run} onFocus={tid => { onThread(tid); setTab('story'); }} /></TabsContent>
                    </div>
                  </Tabs>
                </Card>
              </>
            ) : (
              <Card className="grid min-h-[320px] place-items-center p-8 text-center text-sm text-muted-foreground">
                {ex.codeErr || ex.launchErr ? 'Fix the error on the left, then press Run kernel.' : 'Pick an example or paste a kernel, then press Run kernel.'}
              </Card>
            )}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function Legend() {
  const item = (swatch: React.ReactNode, text: string) => <span className="inline-flex items-center gap-1.5">{swatch}{text}</span>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
      {item(<i className="h-3 w-3 rounded-sm border border-read bg-read-soft" />, 'read this tick')}
      {item(<i className="h-3 w-3 rounded-sm bg-write" />, 'written this tick')}
      {item(<i className="h-3 w-4 rounded border border-run/60 bg-run-soft" />, 'thread running')}
      {item(<i className="hatch h-3 w-4 rounded border border-wait" />, 'waiting at barrier')}
      {item(<i className="h-3 w-4 rounded border border-dashed border-masked bg-masked-soft" />, 'masked: its if was False')}
      {item(<i className="h-3 w-4 rounded border border-dashed opacity-60" />, 'finished')}
      {item(<i className="h-3 w-3 rounded-sm border border-dashed border-destructive bg-destructive/10" />, 'out of bounds')}
      {item(<span className="font-mono">·</span>, 'uninitialized')}
      {item(<span className="font-mono text-[10px]">↦6</span>, 'the index a thread computes')}
    </div>
  );
}
