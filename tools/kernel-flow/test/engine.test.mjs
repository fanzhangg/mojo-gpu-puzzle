// Runs every preset through the engine and checks the expected outputs and diagnostics.
// Usage: npm test
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { parseProgram, simulate, launchFromMain, defaultLaunch } from '../src/engine/engine.js';

const presets = JSON.parse(readFileSync(new URL('../src/presets.json', import.meta.url)));
const wantDiag = { 'bug-guard': 'oob', 'bug-race': 'race' };
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('  FAIL', msg); } };

for (const p of presets) {
  const prog = parseProgram(p.code);
  const run = simulate(prog, prog.kernels[0], p.launch);
  const kinds = [...new Set(run.diags.map(d => d.kind))];
  console.log(`${p.id.padEnd(10)} ticks=${String(run.ticks.length - 1).padEnd(3)} threads=${String(run.threads.length).padEnd(3)} ${run.results.map(r => r.name + ':' + r.msg).join(' ')} ${kinds.join(',')}`);
  check(run.results.every(r => r.ok), `${p.id}: expected output mismatch`);
  if (wantDiag[p.id]) check(kinds.includes(wantDiag[p.id]), `${p.id}: expected a ${wantDiag[p.id]} diagnostic`);
  else check(kinds.length === 0, `${p.id}: unexpected diagnostics ${kinds}`);
  for (const t of run.ticks) for (const s of t.steps) check(!s.err, `${p.id}: runtime error ${s.err}`);
}

// barrier fixes the race demo
{
  const p = presets.find(x => x.id === 'bug-race');
  const prog = parseProgram(p.code.replace('    # barrier()', '    barrier()'));
  const run = simulate(prog, prog.kernels[0], p.launch);
  check(run.diags.length === 0 && run.results.every(r => r.ok), 'race demo with barrier should be clean');
}

// expression breakdown for p06 (block 1, thread 2)
{
  const p = presets.find(x => x.id === 'p06');
  const prog = parseProgram(p.code);
  const run = simulate(prog, prog.kernels[0], p.launch);
  const tid = run.threads.find(t => t.block.x === 1 && t.x === 2).id;
  const steps = run.ticks.flatMap(t => t.steps.filter(s => s.tid === tid));
  const txt = e => (e.lhs ? e.lhs.map(x => x.s).join('') + ' ' + e.arrow + ' ' : '') + (e.rhs ? e.rhs.map(x => x.s + (x.val != null ? '{' + x.val + '}' : '')).join('') : '') + ' ⇒ ' + e.val;
  const lines = steps.filter(s => s.expl).map(s => txt(s.expl));
  console.log('p06 b1·t2:\n   ' + lines.join('\n   '));
  check(lines.some(l => l.includes('4 × 1 + 2 ⇒ 6')), 'index breakdown 4 × 1 + 2 = 6');
  check(lines.some(l => l.includes('output[6] ← a[6]{6} + 10.0 ⇒ 16')), 'write breakdown');
}
// Every reference solution: how many kernels simulate with inputs read from main(), and spot-check results.
{
  const root = new URL('../../../solutions/', import.meta.url);
  const out = {};
  let ok = 0, total = 0;
  for (const p of readdirSync(root).filter(x => /^p\d+$/.test(x))) for (const f of readdirSync(new URL(p + '/', root)).filter(x => x.endsWith('.mojo'))) {
    const src = readFileSync(new URL(`${p}/${f}`, root), 'utf8');
    const prog = parseProgram(src);
    total += prog.unsupported.length;
    for (const k of prog.kernels) {
      total++;
      try {
        const run = simulate(prog, k, launchFromMain(src, prog, k) ?? defaultLaunch(prog, k));
        if (run.ticks.some(t => t.steps.some(s => s.err))) continue;
        ok++;
        const b = run.buffers.find(x => x.isParam && x.written);
        out[`${p}:${k.name}`] = b ? Array.from(b.data.slice(0, 4)) : [];
      } catch { /* not simulated */ }
    }
  }
  console.log(`solutions: ${ok}/${total} kernels simulate`);
  check(ok >= 41, `expected at least 41 solution kernels to simulate, got ${ok}`);
  const eq = (key, want) => check(JSON.stringify(out[key]) === JSON.stringify(want), `${key}: got ${JSON.stringify(out[key])}, want ${JSON.stringify(want)}`);
  eq('p16:matmul_tiled', [1836, 1872, 1908, 1944]);
  eq('p16:matmul_idiomatic_tiled', [1836, 1872, 1908, 1944]);
  eq('p24:simple_warp_dot_product', [10416, 0, 0, 0]);
  eq('p24:traditional_dot_product_p12_style', [10416, 0, 0, 0]);
  eq('p26:butterfly_pair_swap', [1, 0, 3, 2]);
  eq('p26:warp_inclusive_prefix_sum', [0, 1, 3, 6]);
  check(out['p27:block_sum_dot_product']?.[0] === out['p27:traditional_dot_product']?.[0], 'p27: block.sum and the manual reduction should agree');
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
