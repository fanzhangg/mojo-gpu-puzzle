import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, Pencil, Check, X, Cpu, Loader2 } from 'lucide-react';
import { parseProgram, simulate, defaultLaunch, launchFromMain, type Run, type Program, type Unsupported } from '@/engine/engine.js';
import LIBRARY from '@/library.json';
import { derive, frames, tShort, type Derived } from '@/lib/model';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Breakdown } from '@/components/Breakdown';
import { CodeView } from '@/components/CodeView';
import { Flow } from '@/components/Flow';
import { cn } from '@/lib/utils';

type Entry = { path: string; group: string; puzzle: string; title?: string; code?: string; launch?: string };
const BUNDLED = LIBRARY as Entry[];
const PASTED = '__pasted__';
const STORE = 'kernel-flow:v4';
const GROUP_LABEL: Record<string, string> = { solutions: 'Solutions' };

type Saved = { path: string; kernel: string | null; pasted?: string };
const loadSaved = (): Saved | null => { try { const r = localStorage.getItem(STORE); return r ? JSON.parse(r) : null; } catch { return null; } };
const save = (s: Saved) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* unavailable */ } };

type ServerInfo = { gpu: string | null; tools: string[] };
type GpuResult = { ok: boolean; exitCode?: number; stdout?: string; stderr?: string; seconds?: number; command?: string; error?: string };

type Sim = { prog: Program | null; run: Run | null; d: Derived | null; unsupported: Unsupported | null; error: string | null; errorLine: number | null };

function simulateKernel(code: string, kernelName: string | null, launch: string): Sim {
  let prog: Program;
  try { prog = parseProgram(code); }
  catch (e) { const err = e as { message: string; line?: number }; return { prog: null, run: null, d: null, unsupported: null, error: (err.line ? `Line ${err.line}: ` : '') + err.message, errorLine: err.line ?? null }; }
  const k = prog.kernels.find(x => x.name === kernelName);
  const u = prog.unsupported.find(x => x.name === kernelName);
  if (u && !k) return { prog, run: null, d: null, unsupported: u, error: null, errorLine: null };
  const kernel = k ?? prog.kernels[0];
  if (!kernel) return { prog, run: null, d: null, unsupported: prog.unsupported[0] ?? null, error: prog.unsupported.length ? null : 'No GPU kernel found in this file.', errorLine: null };
  try {
    const run = simulate(prog, kernel, launch);
    return { prog, run, d: derive(run), unsupported: null, error: null, errorLine: null };
  } catch (e) {
    const err = e as { message: string; line?: number; launch?: boolean };
    return { prog, run: null, d: null, unsupported: null, error: (err.launch && err.line ? `Inputs line ${err.line}: ` : '') + err.message, errorLine: null };
  }
}

const launchFor = (code: string, entry: Entry | undefined, kernelName: string | null) => {
  if (entry?.launch) return entry.launch;
  try {
    const prog = parseProgram(code);
    const k = prog.kernels.find(x => x.name === kernelName) ?? prog.kernels[0];
    if (!k) return '';
    return launchFromMain(code, prog, k) ?? defaultLaunch(prog, k);
  } catch { return ''; }
};

// The command-line flag (e.g. --tiled) whose branch in main() launches this kernel.
function flagsFor(code: string, kernel: string | null) {
  const hits = [...code.matchAll(/==\s*"(--[\w-]+)"/g)];
  const flags = [...new Set(hits.map(m => m[1]))];
  let best = flags[0] ?? '';
  if (kernel) for (let i = 0; i < hits.length; i++) {
    const seg = code.slice(hits[i].index, hits[i + 1]?.index ?? code.length);
    if (new RegExp(`\\b${kernel}\\b`).test(seg)) { best = hits[i][1]; break; }
  }
  return { flags, best };
}

export default function App() {
  const saved = useMemo(loadSaved, []);
  const [files, setFiles] = useState<Entry[]>(BUNDLED);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [path, setPath] = useState(saved?.path ?? 'solutions/p08/p08.mojo');
  const [code, setCode] = useState('');
  const [original, setOriginal] = useState(''); // file content as loaded, to tell if it was edited
  const [kernel, setKernel] = useState<string | null>(saved?.kernel ?? null);
  const [launch, setLaunch] = useState('');
  const [sim, setSim] = useState<Sim>({ prog: null, run: null, d: null, unsupported: null, error: null, errorLine: null });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ code: '', launch: '' });
  const [f, setF] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [flag, setFlag] = useState('');
  const [tool, setTool] = useState('none');
  const [gpu, setGpu] = useState<{ busy: boolean; result: GpuResult | null }>({ busy: false, result: null });

  const entry = files.find(x => x.path === path);

  const apply = useCallback((c: string, k: string | null, l: string) => {
    const s = simulateKernel(c, k, l);
    setSim(s); setF(0); setPlaying(false); setHover(null);
    const name = s.run?.kernel.name ?? s.unsupported?.name ?? k;
    setKernel(name);
    const fl = flagsFor(c, name);
    setFlag(fl.best);
  }, []);

  const open = useCallback(async (p: string, list: Entry[], srv: ServerInfo | null, preferKernel: string | null) => {
    let c = '';
    const e = list.find(x => x.path === p);
    if (p === PASTED) c = loadSaved()?.pasted ?? '';
    else if (srv && e && e.group !== 'demos') {
      const r = await fetch(`/api/file?path=${encodeURIComponent(p)}`).then(x => x.json()).catch(() => null);
      c = r?.code ?? '';
    } else c = e?.code ?? BUNDLED.find(x => x.path === p)?.code ?? '';
    if (!c && p !== PASTED) { const fb = list.find(x => x.path === 'solutions/p08/p08.mojo') ?? list[0]; if (fb && fb.path !== p) return open(fb.path, list, srv, null); }
    setPath(p); setCode(c); setOriginal(c); setGpu({ busy: false, result: null }); setEditing(false);
    let k = preferKernel;
    try { const prog = parseProgram(c); if (!k || ![...prog.kernels, ...prog.unsupported].some(x => x.name === k)) k = prog.kernels[0]?.name ?? prog.unsupported[0]?.name ?? null; } catch { k = null; }
    const l = launchFor(c, e, k);
    setLaunch(l);
    apply(c, k, l);
    save({ path: p, kernel: k, pasted: p === PASTED ? c : loadSaved()?.pasted });
  }, [apply]);

  // Startup: use the local server if this page was opened from it, otherwise the bundled files.
  useEffect(() => {
    let done = false;
    (async () => {
      let srv: ServerInfo | null = null, list = BUNDLED;
      if (location.protocol.startsWith('http')) {
        try {
          const info = await fetch('/api/info', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
          if (info?.server) {
            const fl: Entry[] = await fetch('/api/files').then(r => r.json());
            srv = { gpu: info.gpu, tools: info.tools };
            list = fl;
          }
        } catch { /* no server */ }
      }
      if (done) return;
      setServer(srv); setFiles(list);
      open(saved?.path ?? 'solutions/p08/p08.mojo', list, srv, saved?.kernel ?? null);
    })();
    return () => { done = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { run, d, prog } = sim;
  const fr = useMemo(() => (run ? frames(run) : []), [run]);
  const last = Math.max(0, fr.length - 1);
  const frame = fr[Math.min(f, last)];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setF(x => { if (x >= last) { setPlaying(false); return x; } return x + 1; }), 1100);
    return () => clearInterval(id);
  }, [playing, last]);
  const togglePlay = () => { if (playing) setPlaying(false); else { if (f >= last) setF(0); setPlaying(true); } };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, [role="listbox"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setF(x => Math.min(last, x + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); setF(x => Math.max(0, x - 1)); }
      if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickKernel = (k: string) => {
    const l = launchFor(code, entry, k);
    setLaunch(l); apply(code, k, l); setGpu(g => ({ ...g, result: null }));
    save({ path, kernel: k, pasted: loadSaved()?.pasted });
  };
  const startEdit = () => { setDraft({ code, launch }); setEditing(true); };
  const applyEdit = () => {
    setCode(draft.code); setLaunch(draft.launch); setEditing(false);
    let k = kernel;
    try { const p = parseProgram(draft.code); if (![...p.kernels, ...p.unsupported].some(x => x.name === k)) k = p.kernels[0]?.name ?? null; } catch { /* shown by apply */ }
    const l = draft.code !== code && draft.launch === launch ? launchFor(draft.code, entry, k) : draft.launch;
    setLaunch(l);
    apply(draft.code, k, l);
    if (path === PASTED) save({ path, kernel: k, pasted: draft.code });
  };

  const runOnGpu = async () => {
    setGpu({ busy: true, result: null });
    const edited = code !== original || path === PASTED || entry?.group === 'demos';
    const body = { path: path === PASTED || entry?.group === 'demos' ? null : path, code: edited ? code : null, args: flag ? [flag] : [], tool: tool === 'none' ? null : tool };
    try {
      const r: GpuResult = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kernel-Flow': '1' }, body: JSON.stringify(body) }).then(x => x.json());
      setGpu({ busy: false, result: r });
    } catch (e) { setGpu({ busy: false, result: { ok: false, error: `Could not reach the local server: ${(e as Error).message}` } }); }
  };

  const lines = code.split('\n');
  const kernels = prog ? [...prog.kernels.map(k => ({ name: k.name, ok: true, line: k.line })), ...prog.unsupported.map(u => ({ name: u.name, ok: false, line: u.line }))].sort((a, b) => a.line - b.line) : [];
  const kdef = prog?.kernels.find(k => k.name === kernel);
  const udef = prog?.unsupported.find(k => k.name === kernel);
  const range: [number, number] | null = kdef ? [kdef.line, kdef.endLine] : udef ? [udef.line, udef.endLine] : null;
  const moving = frame?.kind === 'data' && run ? run.ticks[frame.tick].steps.filter(s => s.ev.length || s.xfer?.length) : [];
  const example = moving.find(s => s.tid === hover) ?? moving[0];
  const errors = run ? run.diags.filter(x => x.sev === 'error') : [];
  const anyMasked = run && d ? run.threads.some(t => d.finalStep[t.id]?.cond === false && !d.threadSteps[t.id].some(x => x.step.ev.length || x.step.xfer?.length)) : false;
  const { flags } = flagsFor(code, kernel);
  const groups = ['solutions'].map(g => ({ g, items: files.filter(x => x.group === g) })).filter(x => x.items.length);
  const label = (e: Entry) => e.title ?? (e.path.split('/').pop()!.replace('.mojo', '') === e.puzzle ? e.puzzle : `${e.puzzle} · ${e.path.split('/').pop()!.replace('.mojo', '')}`);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">Kernel Flow</h1>
        <Select value={path} onValueChange={p => open(p, files, server, null)}>
          <SelectTrigger className="w-[210px]" aria-label="Puzzle file"><SelectValue placeholder="Choose a file" /></SelectTrigger>
          <SelectContent>
            {groups.map(({ g, items }, gi) => (
              <SelectGroup key={g}>
                {gi > 0 && <SelectSeparator />}
                <SelectLabel>{GROUP_LABEL[g] ?? g}</SelectLabel>
                {items.map(e => <SelectItem key={e.path} value={e.path}>{label(e)}</SelectItem>)}
              </SelectGroup>
            ))}
            <SelectSeparator />
            <SelectItem value={PASTED}>Paste your own code</SelectItem>
          </SelectContent>
        </Select>
        {kernels.length > 1 && (
          <Select value={kernel ?? ''} onValueChange={pickKernel}>
            <SelectTrigger className="w-[250px]" aria-label="Kernel"><SelectValue /></SelectTrigger>
            <SelectContent>
              {kernels.map(k => <SelectItem key={k.name} value={k.name}>{k.name}{k.ok ? '' : ' (not simulated)'}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="order-2 flex flex-col overflow-hidden lg:order-1 lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="mr-auto truncate font-mono text-xs text-muted-foreground">{path === PASTED ? 'pasted code' : path}{code !== original && path !== PASTED ? ' · edited' : ''}</span>
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X />Cancel</Button>
                <Button size="sm" onClick={applyEdit}><Check />Apply</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}><Pencil />Edit</Button>
            )}
          </div>
          {editing ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              <Textarea value={draft.code} onChange={e => setDraft(x => ({ ...x, code: e.target.value }))} spellCheck={false} aria-label="Kernel code" className="min-h-[320px] flex-1 font-mono text-[12.5px] leading-relaxed md:text-[12.5px]" style={{ whiteSpace: 'pre', tabSize: 4 }} />
              <label className="text-xs text-muted-foreground" htmlFor="kf-launch">Inputs: grid, block and each kernel argument (read from main() when possible)</label>
              <Textarea id="kf-launch" value={draft.launch} onChange={e => setDraft(x => ({ ...x, launch: e.target.value }))} spellCheck={false} className="min-h-[120px] font-mono text-[12px] leading-relaxed md:text-[12px]" />
            </div>
          ) : (
            <div className="relative h-[55vh] min-h-0 flex-1 lg:h-auto">
              {code ? (
                <CodeView code={code} kernelRange={range} activeLine={frame?.kind === 'data' ? frame.line ?? null : null} focusLine={example && hover === example.tid ? example.line : null} errorLine={sim.errorLine} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Click Edit and paste a Mojo file with a GPU kernel.</p>
              )}
            </div>
          )}
        </Card>

        <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          {run && d && frame ? (
            <>
              <Card className="overflow-x-auto">
                <Flow run={run} d={d} frame={frame} hoverThread={hover} onHoverThread={setHover} />
              </Card>
              <div className="flex items-center gap-4">
                <Button size="icon" variant="outline" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</Button>
                <Slider disabled={last === 0} value={[Math.min(f, last)]} min={0} max={Math.max(1, last)} step={1} onValueChange={([v]) => { setPlaying(false); setF(v); }} aria-label="Step" />
                <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">{Math.min(f, last)} / {last}</span>
              </div>
              <div className="flex min-h-[4.5rem] flex-col gap-2">
                {frame.kind === 'start' && (
                  <p className="text-[15px]">
                    {run.threads.length} threads{run.blocks.length > 1 ? ` in ${run.blocks.length} blocks` : ''} run <code className="text-run">{run.kernel.name}</code> at the same time. Each one uses its <code className="text-run">thread_idx</code> to pick which data it moves.
                    {anyMasked && <span className="text-muted-foreground"> Faded threads do no work: their if-condition is False.</span>}
                  </p>
                )}
                {frame.kind === 'barrier' && (
                  <p className="text-[15px]"><code className="text-wait">barrier()</code>: every thread in the block waits here until all of them arrive, so the shared memory they just filled is complete before anyone reads it.</p>
                )}
                {frame.kind === 'data' && (
                  <>
                    <p className="text-[15px]">
                      <span className="text-muted-foreground">{frame.threads} thread{frame.threads > 1 ? 's' : ''} run line {frame.line}: </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">{(lines[(frame.line ?? 1) - 1] || '').trim()}</code>
                    </p>
                    {frame.exchange && <p className="text-sm text-muted-foreground">Values pass directly between threads' registers inside a warp (32 threads), without going through memory.</p>}
                    {example?.expl && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">{hover === example.tid ? '' : 'e.g. '}{tShort(run, run.threads[example.tid])}:</span>
                        <Breakdown expl={example.expl} size="sm" />
                      </div>
                    )}
                  </>
                )}
                {errors.length > 0 && <p className="text-sm text-destructive">{errors[0].msg}{errors.length > 1 ? ` (+${errors.length - 1} more like this)` : ''}</p>}
              </div>
            </>
          ) : (
            <Card className="p-6 text-sm leading-relaxed">
              {sim.unsupported ? (
                <>
                  <p className="font-medium"><code>{sim.unsupported.name}</code> can't be stepped through in the browser yet.</p>
                  <p className="mt-1 text-muted-foreground">It uses something the simulator doesn't model (line {sim.unsupported.errLine}: {sim.unsupported.message}). Nested functions, vectorized SIMD loads, mbarriers, clusters and tensor cores are not simulated. {server ? 'You can still run it on your GPU below.' : 'Start the local server to run it on your GPU.'}</p>
                </>
              ) : (
                <p className="text-destructive">{sim.error ?? 'Loading…'}</p>
              )}
              {sim.run === null && sim.error && <Button variant="link" className="px-0" onClick={startEdit}>Edit the code or inputs</Button>}
            </Card>
          )}

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="mr-auto text-sm font-medium">{server ? `Run on your GPU${server.gpu ? ` · ${server.gpu}` : ''}` : 'Run on your GPU'}</span>
              {server && flags.length > 0 && (
                <Select value={flag || '__none'} onValueChange={v => setFlag(v === '__none' ? '' : v)}>
                  <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Command-line flag"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">no flag</SelectItem>
                    {flags.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {server && (
                <Select value={tool} onValueChange={setTool}>
                  <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Sanitizer check"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">plain run</SelectItem>
                    {server.tools.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {server && <Button size="sm" onClick={runOnGpu} disabled={gpu.busy || !code}>{gpu.busy ? <Loader2 className="animate-spin" /> : <Play />}{gpu.busy ? 'Running…' : 'Run'}</Button>}
            </div>
            {!server && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                The diagram is simulated in your browser. To run the real kernel on your GPU, start the local server from the repo: <code className="rounded bg-muted px-1">python3 tools/kernel-flow/server.py</code>, then open <code className="rounded bg-muted px-1">http://127.0.0.1:8765</code>.
              </p>
            )}
            {gpu.result && (
              <div className="flex flex-col gap-2">
                <p className={cn('text-sm', gpu.result.ok ? 'text-ok' : 'text-destructive')}>
                  {gpu.result.error ?? (gpu.result.ok ? `✓ Finished in ${gpu.result.seconds} s` : `✕ Exited with code ${gpu.result.exitCode} after ${gpu.result.seconds} s`)}
                  {gpu.result.command && <span className="ml-2 font-mono text-xs text-muted-foreground">{gpu.result.command}</span>}
                </p>
                {(gpu.result.stdout || gpu.result.stderr) && (
                  <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-[11.5px] leading-relaxed">{[gpu.result.stdout, gpu.result.stderr].filter(Boolean).join('\n').trim()}</pre>
                )}
              </div>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">Blue arrows read memory, orange arrows write it, purple arrows pass values between threads (warp shuffles and reductions). Hover a thread to follow it. ← → to step.</p>
        </div>
      </div>
    </div>
  );
}
