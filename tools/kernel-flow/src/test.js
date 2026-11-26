const E = require('./engine.js'); const P = require('./presets.js');
for (const p of P) {
  try {
    const prog = E.parseProgram(p.code);
    if (prog.constErrors.length) console.log(p.id, 'CONST ERR', prog.constErrors.map(e=>e.message));
    const k = prog.kernels[0];
    const r = E.simulate(prog, k, p.launch);
    const outs = r.buffers.filter(b=>b.written).map(b=>b.name+(b.block!=null?'@b'+b.block:'')+'='+Array.from(b.data).map(E.fmtNum).join(','));
    console.log(p.id, k.name, 'ticks', r.ticks.length-1, 'threads', r.threads.length, outs.join(' | '), r.results.map(x=>x.name+':'+x.msg).join(';'));
    for (const d of r.diags) console.log('   ', d.sev, d.kind, d.msg);
  } catch (e) { console.log(p.id, 'ERROR', e.line, e.message, e.stack.split('\n')[1]); }
}
const prog = E.parseProgram(P[8].code); console.log(E.defaultLaunch(prog, prog.kernels[0]));
