// Checks every puzzle visualization against the real solution.
//  1. The numbers a puzzle shows match a simulation of the kernel in solutions/ (test/oracle/engine.js).
//  2. Every stage, for every selectable cell, only draws arrows between cells that exist.
//  3. Every code line a stage highlights exists in the solution kernel.
// Usage: npm test            (all pages)
//        ONLY=p14,p14b npm test   (some pages)
import { readFileSync } from 'node:fs';
import { parseProgram, simulate, launchFromMain, defaultLaunch } from './oracle/engine.js';
import { PUZZLES } from '../src/puzzles/index.js';

const kernels = JSON.parse(readFileSync(new URL('../src/kernels.json', import.meta.url)));
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('  FAIL', msg); } };

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const p of PUZZLES.filter(x => !only || only.includes(x.id))) {
  // 1. numbers match the real kernel
  const src = readFileSync(new URL(`../../../solutions/${p.oracle.file}`, import.meta.url), 'utf8');
  const prog = parseProgram(src);
  // Multi-kernel pages run each kernel in order; buffers written by one kernel feed the next.
  let carried = new Map();
  let real = null;
  for (const name of p.oracle.kernels ?? [p.oracle.kernel]) {
    const k = prog.kernels.find(x => x.name === name);
    check(!!k, `${p.id}: kernel ${name} not found`);
    if (!k) break;
    // A page may state its exact inputs when main() fills them in a way the launch reader can't follow.
    let launch = p.oracle.launch ?? launchFromMain(src, prog, k) ?? defaultLaunch(prog, k);
    launch = launch.split('\n').map(l => { const n = l.split('=')[0].trim(); return carried.has(n) ? `${n} = [${carried.get(n).join(', ')}]` : l; }).join('\n');
    const run = simulate(prog, k, launch);
    for (const b of run.buffers) if (b.isParam && b.written) carried.set(b.name, Array.from(b.data));
    real = Array.from(run.buffers.find(b => b.name === p.oracle.buffer && b.isParam).data);
  }
  const shown = p.result();
  check(JSON.stringify(real) === JSON.stringify(shown), `${p.id}: shows ${JSON.stringify(shown)} but the solution computes ${JSON.stringify(real)}`);

  // 2. scenes are well-formed for every selectable unit
  const pickRow = p.stages[0].scene(p.pick.initial).rows.find(r => r.id === p.pick.row);
  check(!!pickRow, `${p.id}: pick row ${p.pick.row} missing`);
  const n = pickRow ? pickRow.cells.length : 0;
  for (const [si, st] of p.stages.entries()) {
    for (let sel = 0; sel < n; sel++) {
      const sc = st.scene(sel);
      const ids = new Map(sc.rows.map(r => [r.id, r.cells.length]));
      for (const a of sc.arrows) for (const end of [a.from, a.to]) {
        const [row, i] = end.split(':');
        check(ids.has(row) && +i < ids.get(row), `${p.id} stage ${si} sel ${sel}: arrow end ${end} does not exist`);
      }
      for (const lang of ['en', 'zh']) {
        const pick = x => (x == null ? '' : typeof x === 'string' ? x : x[lang]);
        const say = pick(sc.say), math = pick(sc.math);
        check(typeof say === 'string' && say.length > 0 && !/undefined|NaN|\[object/.test(say + math), `${p.id} stage ${si} sel ${sel} (${lang}): bad caption "${say}" / "${math}"`);
      }
      for (const r of sc.rows) for (const c of r.cells) if (c.note && typeof c.note !== 'string') check(c.note.en && c.note.zh, `${p.id}: note missing a language`);
    }
    for (const lang of ['en', 'zh']) check(typeof st.name === 'string' || st.name[lang], `${p.id}: stage name missing ${lang}`);
    // 3. highlighted lines exist
    for (const l of st.lines) check(kernels[p.id].code.includes(l), `${p.id} stage "${st.name}": line "${l}" not in the kernel`);
  }
  for (const f of ['title', 'goal', 'idea']) for (const lang of ['en', 'zh']) check(p[f]?.[lang], `${p.id}: ${f} missing ${lang}`);
  check(p.data?.tensors?.length > 0, `${p.id}: sample data missing`);
  check(!!kernels[p.id], `${p.id}: no kernel in src/kernels.json (add it to scripts/gen_kernels.py)`);
  console.log(`${p.id} ${p.title.en.padEnd(16)} ${p.stages.length} stages · output ${JSON.stringify(shown).slice(0, 40)} matches the solution`);
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
