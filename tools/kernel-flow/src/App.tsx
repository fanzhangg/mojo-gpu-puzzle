import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, Database, Cpu } from 'lucide-react';
import { PUZZLES, type Puzzle, type Lang, type Tensor } from '@/puzzles/index';
import KERNELS from '@/kernels.json';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Code } from '@/components/Code';
import { Scene } from '@/components/Scene';
import { tr, UI, initialLang, saveLang } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const kernels = KERNELS as Record<string, { file: string; kernel: string; code: string }>;

// `text` with `code` spans
function Rich({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') ? <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]">{part.slice(1, -1)}</code> : part,
      )}
    </span>
  );
}

const fromHash = () => PUZZLES.find(p => `#${p.id}` === location.hash) ?? PUZZLES[0];

function Values({ t, lang }: { t: Tensor; lang: Lang }) {
  if (Array.isArray(t.values)) return <span>[{t.values.join(', ')}]</span>;
  return <span>{tr(t.values, lang)}</span>;
}

function Legend({ lang }: { lang: Lang }) {
  const line = (color: string, label: string, dashed = false) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} style={{ stroke: `hsl(var(--${color}))` }} /></svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
      {line('read', tr(UI.legendRead, lang))}
      {line('write', tr(UI.legendWrite, lang))}
      {line('run', tr(UI.legendMove, lang))}
      {line('destructive', tr(UI.legendGhost, lang), true)}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex flex-col items-center leading-none"><span className="font-mono text-[8.5px]">[2]</span><span className="grid h-4 w-5 place-items-center rounded-sm border font-mono text-[9px] text-foreground">7</span></span>
        {tr(UI.legendCell, lang)}
      </span>
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [puzzle, setPuzzle] = useState<Puzzle>(fromHash);
  const [stage, setStage] = useState(0);
  const [sel, setSel] = useState(puzzle.pick.initial);

  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; saveLang(lang); }, [lang]);

  const open = (p: Puzzle) => {
    setPuzzle(p); setStage(0); setSel(p.pick.initial);
    if (location.hash !== `#${p.id}`) history.replaceState(null, '', `#${p.id}`);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onHash = () => { const p = fromHash(); if (p.id !== puzzle.id) open(p); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const last = puzzle.stages.length - 1;
  const st = puzzle.stages[stage];
  const scene = useMemo(() => st.scene(sel), [st, sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setStage(s => Math.min(last, s + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setStage(s => Math.max(0, s - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const k = kernels[puzzle.id];
  const t = (x: Parameters<typeof tr>[0]) => tr(x, lang);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      {/* top bar */}
      <header className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Cpu className="h-4 w-4" /></div>
        <div className="mr-auto min-w-0">
          <div className="font-semibold leading-tight tracking-tight">Kernel Flow</div>
          <div className="truncate text-xs text-muted-foreground">{t(UI.tagline)}</div>
        </div>
        <div className="flex rounded-lg border bg-card p-0.5 text-sm" role="group" aria-label="Language">
          {(['en', 'zh'] as const).map(l => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={cn('whitespace-nowrap rounded-md px-3 py-1 transition-colors', lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {l === 'en' ? 'EN' : '中文'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* puzzle list */}
        <nav className="shrink-0 lg:sticky lg:top-4 lg:w-48" aria-label={t(UI.puzzles)}>
          <div className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t(UI.puzzles)}</div>
          <ol className="flex flex-wrap gap-1 lg:flex-col">
            {PUZZLES.map(p => (
              <li key={p.id}>
                <a
                  href={`#${p.id}`}
                  onClick={e => { e.preventDefault(); open(p); }}
                  className={cn('flex items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent', p.id === puzzle.id ? 'bg-card font-medium shadow-sm ring-1 ring-border' : 'text-muted-foreground')}
                  aria-current={p.id === puzzle.id ? 'page' : undefined}
                >
                  <span className="font-mono text-xs tabular-nums opacity-70">{String(p.num).padStart(2, '0')}</span>
                  <span className="min-w-0">{t(p.title)}{p.variant && <span className="block text-[11px] font-normal opacity-70">{t(p.variant)}</span>}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-5">
          {/* puzzle header */}
          <section className="flex flex-col gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-run">
                {lang === 'zh' ? `第 ${puzzle.num} 题` : `Puzzle ${puzzle.num}`}
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t(puzzle.title)}{puzzle.variant && <span className="ml-3 align-middle text-lg font-normal text-muted-foreground">{t(puzzle.variant)}</span>}</h1>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted-foreground"><Rich text={t(puzzle.goal)} /></p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex gap-3 rounded-xl border bg-run-soft/50 p-4">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-run" />
                <div>
                  <div className="mb-1 text-sm font-semibold">{t(UI.idea)}</div>
                  <p className="text-sm leading-relaxed"><Rich text={t(puzzle.idea)} /></p>
                </div>
              </div>
              <div className="flex gap-3 rounded-xl border bg-card p-4">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold">{t(UI.data)}</span>
                    <span className="text-xs text-muted-foreground">{t(UI.dataNote)}</span>
                  </div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[auto_auto_minmax(0,1fr)]">
                    {puzzle.data.tensors.map(x => (
                      <div key={x.name} className="contents">
                        <span className="font-mono text-[13px] font-semibold">{x.name}</span>
                        <span className="min-w-0 break-words font-mono text-[12.5px]"><Values t={x} lang={lang} /></span>
                        <span className="col-start-2 mb-1 text-xs text-muted-foreground sm:col-start-auto sm:mb-0">{t(x.note)}</span>
                      </div>
                    ))}
                    <span className="pt-1 text-xs text-muted-foreground">{t(UI.launch)}</span>
                    <span className="pt-1 text-xs sm:col-span-2">{t(puzzle.data.launch)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* workspace: diagram + code */}
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
            <Card className="flex min-w-0 flex-col overflow-hidden">
              <div className="flex items-start gap-3 border-b px-4 py-3">
                <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5" aria-label={t(UI.steps)}>
                  {puzzle.stages.map((s, i) => (
                    <li key={i} className="flex items-center gap-1">
                      {i > 0 && <span className={cn('h-px w-3', i <= stage ? 'bg-run/60' : 'bg-border')} />}
                      <button
                        type="button"
                        onClick={() => setStage(i)}
                        aria-current={i === stage ? 'step' : undefined}
                        className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors', i === stage ? 'border-primary bg-primary text-primary-foreground' : i < stage ? 'border-run/40 text-run hover:bg-run-soft' : 'text-muted-foreground hover:bg-accent')}
                      >
                        <span className="font-mono text-xs opacity-80">{i + 1}</span>{t(s.name)}
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="icon-sm" onClick={() => setStage(s => Math.max(0, s - 1))} disabled={stage === 0} aria-label={t(UI.prev)}><ChevronLeft /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => setStage(s => Math.min(last, s + 1))} disabled={stage === last} aria-label={t(UI.next)}><ChevronRight /></Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Scene scene={scene} pickRow={puzzle.pick.row} onPick={setSel} lang={lang} />
              </div>

              <div className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-4">
                <p className="text-[15px] leading-relaxed"><Rich text={t(scene.say)} /></p>
                {scene.math && <pre className="w-fit max-w-full overflow-x-auto whitespace-pre rounded-md border bg-card px-3 py-2 font-mono text-[13px] leading-relaxed">{t(scene.math)}</pre>}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Legend lang={lang} />
                  <span className="text-[11.5px] text-muted-foreground">{t(puzzle.pick.hint)} {t(UI.keys)}</span>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]">
              {k ? <Code code={k.code} lines={st.lines} file={`${k.file}`} title={`${t(UI.solution)} · ${k.kernel}`} /> : null}
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
