// Runs every preset through the engine and checks the expected outputs and diagnostics.
// Usage: npm test
import { readFileSync } from 'node:fs';
import { parseProgram, simulate } from '../src/engine/engine.js';

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
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
