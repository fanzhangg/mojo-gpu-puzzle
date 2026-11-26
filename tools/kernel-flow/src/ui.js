// ===================== Kernel Flow UI =====================
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const S = { code: '', launch: '', preset: 'p08', kernelIdx: 0, prog: null, run: null, t: 0, view: 'tick', selThread: null, selCell: null, timer: null, editing: false, hue: new Map(), dom: null, errLine: null };
  const STORE = 'kernel-flow:v1';

  function loadSaved() { try { const raw = localStorage.getItem(STORE); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ code: S.code, launch: S.launch, preset: S.preset, view: S.view })); } catch (e) { /* storage unavailable */ } }

  // ---------- syntax highlight ----------
  const KW = new Set(['def', 'fn', 'var', 'if', 'elif', 'else', 'for', 'in', 'while', 'return', 'comptime', 'alias', 'and', 'or', 'not', 'from', 'import', 'where', 'break', 'continue', 'pass', 'True', 'False', 'None', 'raises', 'mut', 'struct']);
  const BI = new Set(['thread_idx', 'block_idx', 'block_dim', 'grid_dim', 'global_idx', 'barrier', 'stack_allocation', 'row_major', 'col_major', 'TileTensor', 'LayoutTensor', 'Pointer', 'UnsafePointer', 'Scalar', 'Int', 'Int32', 'UInt', 'Float32', 'rebind', 'type_of', 'range', 'min', 'max', 'DType', 'Layout']);
  function highlight(line) {
    let out = '', i = 0;
    const re = /(#.*$)|("[^"]*"|'[^']*')|(\b\d+(?:\.\d*)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(i, m.index));
      if (m[1]) out += `<span class="tok-cm">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tok-num">${m[3]}</span>`;
      else if (KW.has(m[4])) out += `<span class="tok-kw">${m[4]}</span>`;
      else if (BI.has(m[4])) out += `<span class="tok-bi">${m[4]}</span>`;
      else out += m[4];
      i = m.index + m[0].length;
    }
    return out + esc(line.slice(i));
  }

  // ---------- labels ----------
  function tShort(th) {
    const r = S.run;
    const t2 = r.block.y > 1 || r.block.z > 1;
    const tl = t2 ? `${th.x},${th.y}` : `${th.x}`;
    if (r.grid.x * r.grid.y * r.grid.z === 1) return 't' + tl;
    const bl = r.grid.y > 1 ? `${th.block.x},${th.block.y}` : `${th.block.x}`;
    return `b${bl}·t${tl}`;
  }
  function tLong(th) {
    const r = S.run;
    const two = r.block.y > 1 || r.grid.y > 1;
    const ti = two ? `(${th.x}, ${th.y})` : `${th.x}`;
    const bi = two ? `(${th.block.x}, ${th.block.y})` : `${th.block.x}`;
    const gx = th.block.x * r.block.x + th.x, gy = th.block.y * r.block.y + th.y;
    return { title: `thread_idx ${ti} · block_idx ${bi}`, sub: two ? `global (x=${gx}, y=${gy})` : `global x = ${gx}` };
  }
  function bufLabel(b) {
    if (b.space === 'shared' && S.run.blocks.length > 1) return `${b.name}`;
    return b.name;
  }
  function cellRef(ev) {
    const b = S.run.buffers[ev.buf];
    return `${bufLabel(b)}[${ev.coords.join(', ')}]`;
  }
  const hueOf = line => S.hue.has(line) ? S.hue.get(line) : 220;

  // ---------- run ----------
  function runAll() {
    stopPlay();
    $('#codeErr').hidden = true; $('#launchErr').hidden = true; S.errLine = null;
    let prog;
    try { prog = parseProgram(S.code); }
    catch (e) { return fail('code', e); }
    if (!prog.kernels.length) return fail('code', { message: 'No kernel found. Paste a def that uses thread_idx, block_idx or barrier().' });
    updateKernelSelect(prog);
    const kernel = prog.kernels[Math.min(S.kernelIdx, prog.kernels.length - 1)];
    if (!S.launch.trim()) { S.launch = defaultLaunch(prog, kernel); $('#launch').value = S.launch; }
    let run;
    try { run = simulate(prog, kernel, S.launch); }
    catch (e) { S.prog = prog; return fail(e.launch ? 'launch' : (e.line && !e.launch && e.message.includes('Set') ? 'launch' : 'launch'), e); }
    if (prog.constErrors.length) { const ce = prog.constErrors[0]; $('#codeErr').hidden = false; $('#codeErr').textContent = `Line ${ce.line}: ${ce.message}`; }
    S.prog = prog; S.run = run;
    // hues per source line, in line order
    const lines = new Set();
    run.ticks.forEach(t => t.steps.forEach(s => s.line && lines.add(s.line)));
    S.hue = new Map([...lines].sort((a, b) => a - b).map((l, i) => [l, Math.round((200 + i * 137.508) % 360)]));
    // per-thread step index
    run.threadSteps = run.threads.map(() => []);
    run.ticks.forEach((t, k) => t.steps.forEach(s => run.threadSteps[s.tid].push({ tick: k, step: s })));
    if (S.selThread != null && S.selThread >= run.threads.length) S.selThread = null;
    if (S.selCell && !run.buffers[S.selCell.buf]) S.selCell = null;
    buildStage();
    buildTimeline();
    const firstW = run.ticks.findIndex(t => t.steps.some(s => s.ev.some(e => e.op === 'w')));
    S.t = firstW > 0 ? firstW : Math.min(1, run.ticks.length - 1);
    renderDiags();
    renderChips();
    render();
    save();
  }
  function fail(where, e) {
    S.run = null;
    const box = where === 'code' ? $('#codeErr') : $('#launchErr');
    box.hidden = false;
    box.textContent = (e.line ? (where === 'code' ? `Line ${e.line}: ` : e.launch ? `Launch line ${e.line}: ` : '') : '') + e.message;
    if (where === 'code') S.errLine = e.line || null;
    $('#stage').innerHTML = `<div class="empty">Fix the ${where === 'code' ? 'kernel source' : 'launch settings'} and run again.</div>`;
    $('#timeline').innerHTML = ''; $('#tickList').innerHTML = ''; $('#diagList').innerHTML = ''; $('#chips').innerHTML = '';
    $('#tickLabel').innerHTML = 'tick <b>0</b> / 0'; $('#tickSub').textContent = '';
    renderInspector();
    renderCode();
  }
  function updateKernelSelect(prog) {
    const sel = $('#kernelSel');
    $('#kernelWrap').hidden = prog.kernels.length < 2;
    sel.innerHTML = prog.kernels.map((k, i) => `<option value="${i}">${esc(k.name)}</option>`).join('');
    sel.value = String(Math.min(S.kernelIdx, prog.kernels.length - 1));
  }

  // ---------- stage ----------
  function buildStage() {
    const r = S.run;
    const stage = $('#stage');
    stage.innerHTML = '';
    const cellEls = new Map(), threadEls = [];
    const params = r.buffers.filter(b => b.space === 'global');
    const ins = params.filter(b => !b.written && !(b.declaredMut && /^out/i.test(b.name)));
    const outs = params.filter(b => !ins.includes(b));
    // gather OOB coords per buffer
    const ghosts = new Map();
    r.ticks.forEach(t => t.steps.forEach(s => s.ev.forEach(e => {
      if (!e.oob) return;
      if (!ghosts.has(e.buf)) ghosts.set(e.buf, new Set());
      ghosts.get(e.buf).add(e.coords.join(','));
    })));

    function bufEl(b, tag) {
      const wrap = document.createElement('div');
      wrap.className = 'buf';
      const shape = b.shape.join('×');
      wrap.innerHTML = `<div class="buf-name">${esc(bufLabel(b))}<span>[${shape}] ${tag}</span></div>`;
      const row = document.createElement('div'); row.className = 'buf-row';
      const grid = document.createElement('div'); grid.className = 'cells';
      const cols = b.shape.length >= 2 ? b.shape[b.shape.length - 1] : Math.min(b.shape[0], 16);
      grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell))`;
      const n = b.data.length;
      for (let i = 0; i < n; i++) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'cell';
        const coords = flatToCoordStr(b, i);
        c.innerHTML = `<span class="ix">${b.shape.length > 1 ? coords.replace(', ', ',') : i}</span><span class="v"></span>`;
        c.dataset.key = b.id + ':' + i;
        c.setAttribute('aria-label', `${b.name}[${coords}]`);
        c.addEventListener('click', () => selectCell(b.id, i));
        grid.appendChild(c);
        cellEls.set(b.id + ':' + i, c);
      }
      row.appendChild(grid);
      const g = ghosts.get(b.id);
      if (g && g.size) {
        const gw = document.createElement('div'); gw.className = 'ghosts';
        gw.innerHTML = '<span class="ghost-label">out of bounds</span>';
        [...g].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).slice(0, 24).forEach(k => {
          const c = document.createElement('div');
          c.className = 'cell ghost';
          c.innerHTML = `<span class="ix">${k}</span><span class="v">✕</span>`;
          c.title = `${b.name}[${k}] does not exist`;
          gw.appendChild(c);
          cellEls.set(b.id + ':g:' + k, c);
        });
        row.appendChild(gw);
      }
      wrap.appendChild(row);
      return wrap;
    }

    const zIn = document.createElement('div');
    zIn.innerHTML = `<div class="zone-label">Global memory · read <em>(${ins.length ? 'buffers the kernel only reads' : 'no read-only buffers'})</em></div>`;
    const inBufs = document.createElement('div'); inBufs.className = 'bufs';
    ins.forEach(b => inBufs.appendChild(bufEl(b, b.declaredMut === false ? 'read-only' : 'input')));
    zIn.appendChild(inBufs);
    if (ins.length) stage.appendChild(zIn);

    const zG = document.createElement('div');
    const nb = r.blocks.length, tpb = r.block.x * r.block.y * r.block.z;
    zG.innerHTML = `<div class="zone-label">Grid · ${r.grid.x}×${r.grid.y} block${nb > 1 ? 's' : ''} of ${r.block.x}×${r.block.y} threads <em>(${r.threads.length} threads total)</em></div>`;
    const blocks = document.createElement('div'); blocks.className = 'blocks';
    blocks.style.gridTemplateColumns = `repeat(${r.grid.x}, max-content)`;
    const blkHeads = [];
    r.blocks.forEach(bk => {
      const el = document.createElement('div'); el.className = 'blk';
      const head = document.createElement('div'); head.className = 'blk-head';
      head.innerHTML = `<span>block_idx (${bk.x}, ${bk.y})</span><span class="ep"></span>`;
      blkHeads.push(head.lastChild);
      el.appendChild(head);
      const tg = document.createElement('div'); tg.className = 'threads';
      tg.style.gridTemplateColumns = `repeat(${Math.min(r.block.x, 16)}, var(--cell))`;
      bk.threads.forEach(th => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'th';
        b.textContent = r.block.y > 1 ? `${th.x},${th.y}` : th.x;
        b.setAttribute('aria-label', tLong(th).title);
        b.addEventListener('click', () => selectThread(th.id));
        tg.appendChild(b);
        threadEls[th.id] = b;
      });
      el.appendChild(tg);
      const sh = r.buffers.filter(b => b.space !== 'global' && b.block === bk.id);
      if (sh.length) {
        const z = document.createElement('div'); z.className = 'shared-zone';
        z.innerHTML = `<div class="zone-label">Shared memory · this block only</div>`;
        const bb = document.createElement('div'); bb.className = 'bufs';
        sh.forEach(b => bb.appendChild(bufEl(b, b.space === 'shared' ? 'shared' : 'local')));
        z.appendChild(bb);
        el.appendChild(z);
      }
      blocks.appendChild(el);
    });
    zG.appendChild(blocks);
    stage.appendChild(zG);

    const zOut = document.createElement('div');
    zOut.innerHTML = `<div class="zone-label">Global memory · written</div>`;
    const outBufs = document.createElement('div'); outBufs.className = 'bufs';
    outs.forEach(b => outBufs.appendChild(bufEl(b, 'output')));
    zOut.appendChild(outBufs);
    if (outs.length) stage.appendChild(zOut);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'wires';
    svg.innerHTML = `<defs>
      <marker id="mkR" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="mk-r" d="M0,0 L10,5 L0,10 z"/></marker>
      <marker id="mkW" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="mk-w" d="M0,0 L10,5 L0,10 z"/></marker>
    </defs><g id="wireG"></g>`;
    stage.appendChild(svg);
    S.dom = { cellEls, threadEls, svg, blkHeads };
  }

  function memAt(t) {
    const r = S.run;
    const vals = r.buffers.map(b => Float64Array.from(b.init));
    const mask = r.buffers.map(b => new Uint8Array(b.data.length).fill(b.space === 'global' ? 1 : 0));
    for (let k = 1; k <= t; k++) for (const s of r.ticks[k].steps) for (const e of s.ev) if (e.op === 'w' && !e.oob) { vals[e.buf][e.idx] = e.val; mask[e.buf][e.idx] = 1; }
    return { vals, mask };
  }
  function evKey(e) { return e.oob ? e.buf + ':g:' + e.coords.join(',') : e.buf + ':' + e.idx; }
  function viewSteps() {
    const r = S.run;
    if (S.view === 'all') { const o = []; for (let k = 1; k < r.ticks.length; k++) o.push(...r.ticks[k].steps); return o; }
    return r.ticks[S.t].steps;
  }

  function render() {
    if (!S.run) return;
    const r = S.run, t = S.t, tk = r.ticks[t];
    const { cellEls, threadEls, blkHeads } = S.dom;
    const { vals, mask } = memAt(S.view === 'all' ? r.ticks.length - 1 : t);
    const last = t === r.ticks.length - 1 || S.view === 'all';
    const badSet = new Set();
    if (last) r.results.forEach(res => { if (!res.ok && res.bad) { const b = r.buffers.find(x => x.name === res.name && x.isParam); res.bad.forEach(i => badSet.add(b.id + ':' + i)); } });
    const rd = new Set(), wr = new Set();
    const steps = viewSteps();
    steps.forEach(s => s.ev.forEach(e => (e.op === 'r' ? rd : wr).add(evKey(e))));
    for (const [key, el] of cellEls) {
      const ghost = key.includes(':g:');
      if (!ghost) {
        const [b, i] = key.split(':').map(Number);
        const v = el.lastChild;
        const init = mask[b][i];
        v.textContent = init ? fmtNum(vals[b][i]) : '·';
        el.classList.toggle('uninit', !init);
        el.title = `${r.buffers[b].name}[${flatToCoordStr(r.buffers[b], i)}] = ${init ? fmtNum(vals[b][i]) : 'uninitialized'}`;
        el.classList.toggle('bad', badSet.has(key));
        el.classList.toggle('sel', !!S.selCell && S.selCell.buf === b && S.selCell.idx === i);
      }
      el.classList.toggle('rd', rd.has(key) && !wr.has(key));
      el.classList.toggle('wr', wr.has(key));
    }
    // threads
    const stepBy = new Map(tk.steps.map(s => [s.tid, s]));
    r.threads.forEach(th => {
      const el = threadEls[th.id];
      el.className = 'th';
      if (S.view === 'all') {
        const ts = r.threadSteps[th.id];
        const did = ts.some(x => x.step.ev.length);
        if (did) { el.classList.add('active'); el.style.setProperty('--h', hueOf(ts.filter(x => x.step.ev.some(e => e.op === 'w')).pop()?.step.line ?? ts[0].step.line)); }
        else el.classList.add('done');
      } else {
        const s = stepBy.get(th.id);
        if (s) {
          el.classList.add(s.err ? 'err' : 'active');
          el.style.setProperty('--h', hueOf(s.line));
          if (s.barrier) el.classList.add('bar');
        } else if (t > 0) {
          const st = tk.states[th.id];
          if (st === 'wait') el.classList.add('wait');
          else if (st === 'done') el.classList.add('done');
          else if (st === 'err') el.classList.add('err');
        }
      }
      if (S.selThread === th.id) el.classList.add('sel');
    });
    // epochs per block
    r.blocks.forEach((bk, i) => {
      let n = 0;
      for (let k = 1; k <= t; k++) if (r.ticks[k].released.includes(bk.id)) n++;
      blkHeads[i].textContent = n ? `◆ past ${n} barrier${n > 1 ? 's' : ''}` : '';
    });
    // transport
    $('#tickLabel').innerHTML = S.view === 'all' ? `<b>whole run</b> · ${r.ticks.length - 1} ticks` : `tick <b>${t}</b> / ${r.ticks.length - 1}`;
    const nAct = tk.steps.length;
    $('#tickSub').textContent = S.view === 'all' ? 'every read and write at once' : t === 0 ? 'launch: nothing has run yet' : `${nAct} thread${nAct === 1 ? '' : 's'} stepped${tk.released.length ? ' · barrier released' : ''}`;
    $('#bPlay').textContent = S.timer ? '❚❚' : '▶';
    $('#bPlay').setAttribute('aria-label', S.timer ? 'Pause' : 'Play');
    document.querySelectorAll('#timeline .tl-bar').forEach((b, k) => b.classList.toggle('cur', S.view !== 'all' && k === t));
    $('#timeline').setAttribute('aria-valuenow', String(t));
    $('#timeline').setAttribute('aria-valuemax', String(r.ticks.length - 1));
    document.querySelectorAll('.vtab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.view)));
    renderCode();
    renderTickList();
    renderInspector();
    requestAnimationFrame(drawWires);
  }

  function drawWires() {
    if (!S.run || !S.dom) return;
    const { svg, cellEls, threadEls } = S.dom;
    const stage = $('#stage');
    const sr = stage.getBoundingClientRect();
    svg.setAttribute('width', stage.scrollWidth);
    svg.setAttribute('height', stage.scrollHeight);
    const g = svg.querySelector('#wireG');
    const steps = viewSteps();
    const seen = new Set();
    let html = '', count = 0;
    for (const s of steps) {
      const tEl = threadEls[s.tid];
      if (!tEl) continue;
      const tr = tEl.getBoundingClientRect();
      for (const e of s.ev) {
        const k = s.tid + '|' + e.op + '|' + evKey(e);
        if (seen.has(k)) continue; seen.add(k);
        const cEl = cellEls.get(evKey(e));
        if (!cEl) continue;
        if (++count > 900) break;
        const cr = cEl.getBoundingClientRect();
        const cx = cr.left + cr.width / 2 - sr.left, tx = tr.left + tr.width / 2 - sr.left;
        const cAbove = cr.top + cr.height / 2 < tr.top + tr.height / 2;
        const cy = (cAbove ? cr.bottom : cr.top) - sr.top;
        const ty = (cAbove ? tr.top : tr.bottom) - sr.top;
        let x1, y1, x2, y2;
        if (e.op === 'r') { x1 = cx; y1 = cy; x2 = tx; y2 = ty; } else { x1 = tx; y1 = ty; x2 = cx; y2 = cy; }
        const dy = Math.max(18, Math.abs(y2 - y1) * 0.45) * (y2 > y1 ? 1 : -1);
        const dim = S.selThread != null && S.selThread !== s.tid ? ' dim' : '';
        html += `<path class="${e.op === 'r' ? 'rd' : 'wr'}${dim}" d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${(y1 + dy).toFixed(1)} ${x2.toFixed(1)},${(y2 - dy).toFixed(1)} ${x2.toFixed(1)},${(y2 - (y2 > y1 ? 2 : -2)).toFixed(1)}" marker-end="url(#${e.op === 'r' ? 'mkR' : 'mkW'})"/>`;
      }
    }
    g.innerHTML = html;
  }

  // ---------- code view ----------
  function renderCode() {
    const box = $('#codeView');
    const lines = S.code.replace(/\r/g, '').split('\n');
    const counts = new Map();
    let mine = null;
    if (S.run) {
      viewSteps().forEach(s => counts.set(s.line, (counts.get(s.line) || 0) + 1));
      if (S.selThread != null && S.view !== 'all') { const s = S.run.ticks[S.t].steps.find(x => x.tid === S.selThread); if (s) mine = s.line; }
    }
    if (box.childElementCount !== lines.length || box.dataset.src !== S.code) {
      box.innerHTML = lines.map((l, i) => `<div class="ln" data-line="${i + 1}"><span class="no">${i + 1}</span><span class="src">${highlight(l) || ' '}</span><span class="badge"></span></div>`).join('');
      box.dataset.src = S.code;
    }
    box.querySelectorAll('.ln').forEach(el => {
      const n = +el.dataset.line;
      const c = counts.get(n);
      el.classList.toggle('hot', !!c);
      el.classList.toggle('mine', mine === n);
      el.classList.toggle('errline', S.errLine === n);
      if (c) { el.style.setProperty('--h', hueOf(n)); el.lastChild.textContent = S.view === 'all' ? `${c} steps` : `×${c}`; }
    });
  }

  // ---------- tick list ----------
  function flowHtml(s) {
    const parts = [];
    const reads = s.ev.filter(e => e.op === 'r'), writes = s.ev.filter(e => e.op === 'w');
    if (reads.length) parts.push(reads.map(e => e.oob ? `<span class="x">${esc(cellRef(e))} out of bounds</span>` : `<span class="r">${esc(cellRef(e))}</span>=${fmtNum(e.val)}`).join(', '));
    if (writes.length) parts.push(writes.map(e => e.oob ? `<span class="x">${esc(cellRef(e))} ← ${fmtNum(e.val)} (out of bounds)</span>` : `<span class="w">${esc(cellRef(e))}</span> ← ${fmtNum(e.val)}`).join(', '));
    let html = parts.join(' → ');
    if (s.note && !(writes.length && !s.note)) html += (html ? ' · ' : '') + `<span class="n">${esc(s.note)}</span>`;
    if (s.log && s.log.length) html += ` · print: ${esc(s.log.join(' | '))}`;
    return html;
  }
  function renderTickList() {
    const r = S.run, box = $('#tickList');
    if (S.view === 'all') {
      $('#tickTitle').textContent = 'Memory traffic';
      $('#tickCount').textContent = 'per thread, like GPU-Puzzles scores';
      box.innerHTML = trafficHtml();
      return;
    }
    $('#tickTitle').textContent = S.t === 0 ? 'Launch' : `Tick ${S.t}`;
    const tk = r.ticks[S.t];
    const lines = S.code.split('\n');
    if (S.t === 0) {
      $('#tickCount').textContent = '';
      box.innerHTML = `<div class="more">${r.threads.length} threads in ${r.blocks.length} block${r.blocks.length > 1 ? 's' : ''} are ready. In each tick, every running thread executes one statement in lockstep. Press ▶ or →.</div>`;
      return;
    }
    $('#tickCount').textContent = `${tk.steps.length} step${tk.steps.length === 1 ? '' : 's'}`;
    let html = '';
    tk.released.forEach(bid => { const b = r.blocks[bid]; html += `<div class="sysrow">◆ block (${b.x}, ${b.y}): all threads reached barrier(), so they continue next tick.</div>`; });
    const ordered = [...tk.steps].sort((a, b) => (S.selThread === b.tid) - (S.selThread === a.tid) || a.tid - b.tid);
    const LIMIT = 60;
    ordered.slice(0, LIMIT).forEach(s => {
      const th = r.threads[s.tid];
      html += `<div class="row${S.selThread === s.tid ? ' on' : ''}" data-tid="${s.tid}" style="--h:${hueOf(s.line)}"><span class="who">${esc(tShort(th))}</span><code>${s.line ? `${s.line}: ` : ''}${esc((lines[s.line - 1] || '').trim())}</code><span class="flow">${flowHtml(s)}</span></div>`;
    });
    if (ordered.length > LIMIT) html += `<div class="more">+${ordered.length - LIMIT} more threads this tick</div>`;
    if (!tk.steps.length) html += `<div class="more">No thread executed a statement this tick.</div>`;
    box.innerHTML = html;
    box.querySelectorAll('.row').forEach(el => el.addEventListener('click', () => selectThread(+el.dataset.tid)));
  }
  function traffic() {
    const r = S.run;
    const per = r.threads.map(() => ({ gr: 0, gw: 0, sr: 0, sw: 0 }));
    r.ticks.forEach(t => t.steps.forEach(s => s.ev.forEach(e => {
      const b = r.buffers[e.buf]; const g = b.space === 'global';
      const k = (g ? 'g' : 's') + e.op; per[s.tid][k]++;
    })));
    return per;
  }
  function trafficHtml() {
    const r = S.run, per = traffic();
    const keys = [['gr', 'Global reads'], ['gw', 'Global writes'], ['sr', 'Shared reads'], ['sw', 'Shared writes']];
    const max = k => Math.max(0, ...per.map(p => p[k])), sum = k => per.reduce((a, p) => a + p[k], 0);
    const shBytes = r.buffers.filter(b => b.space === 'shared').reduce((m, b) => { m[b.block] = (m[b.block] || 0) + b.data.length * 4; return m; }, {});
    const shPer = Math.max(0, ...Object.values(shBytes));
    let html = `<div class="insp"><table class="hist"><tr><td></td>${keys.map(k => `<td><b>${k[1]}</b></td>`).join('')}</tr>
      <tr><td>max / thread</td>${keys.map(k => `<td>${max(k[0])}</td>`).join('')}</tr>
      <tr><td>total</td>${keys.map(k => `<td>${sum(k[0])}</td>`).join('')}</tr></table>
      <div class="sub">Shared memory per block: ${shPer} bytes${shPer ? ` (${shPer / 4} × float32)` : ''} · ${r.ticks.length - 1} ticks</div>
      <div class="sub">Busiest threads:</div><div class="hist-wrap"><table class="hist">`;
    const order = per.map((p, i) => ({ i, p, tot: p.gr + p.gw + p.sr + p.sw })).sort((a, b) => b.tot - a.tot).slice(0, 40);
    order.forEach(({ i, p }) => { html += `<tr data-tid="${i}"><td>${esc(tShort(r.threads[i]))}</td><td>G ${p.gr}r ${p.gw}w</td><td>S ${p.sr}r ${p.sw}w</td></tr>`; });
    html += `</table></div></div>`;
    setTimeout(() => document.querySelectorAll('#tickList tr[data-tid]').forEach(el => el.addEventListener('click', () => selectThread(+el.dataset.tid))));
    return html;
  }

  // ---------- inspector ----------
  function renderInspector() {
    const box = $('#insp');
    $('#clearSel').hidden = S.selThread == null && !S.selCell;
    if (!S.run) { box.innerHTML = '<div class="sub">Run a kernel to inspect threads and memory.</div>'; return; }
    const r = S.run, lines = S.code.split('\n');
    if (S.selThread != null) {
      const th = r.threads[S.selThread];
      const L = tLong(th);
      const hist = r.threadSteps[th.id];
      const upto = hist.filter(h => h.tick <= S.t);
      const vars = upto.length ? upto[upto.length - 1].step.vars || {} : {};
      const st = S.t === 0 ? 'ready' : (r.ticks[S.t].steps.some(s => s.tid === th.id) ? 'running' : r.ticks[S.t].states[th.id] === 'wait' ? 'waiting at barrier' : r.ticks[S.t].states[th.id] === 'done' ? 'finished' : r.ticks[S.t].states[th.id]);
      let html = `<div><h3>${esc(L.title)}</h3><div class="sub">${esc(L.sub)} · ${esc(st)} · ${hist.length} steps</div></div>`;
      const vk = Object.keys(vars);
      html += vk.length ? `<div class="vars">${vk.map(k => `<div><span>${esc(k)}</span><b>${esc(typeof vars[k] === 'number' ? fmtNum(vars[k]) : String(vars[k]))}</b></div>`).join('')}</div>` : `<div class="sub">No local variables yet.</div>`;
      html += `<div class="hist-wrap"><table class="hist">${hist.map(h => `<tr data-tick="${h.tick}" class="${h.tick === S.t ? 'now' : ''}"><td>t${h.tick}</td><td><b>${h.step.line}</b> ${esc((lines[h.step.line - 1] || '').trim())}<br><span class="flow">${flowHtml(h.step)}</span></td></tr>`).join('')}</table></div>`;
      box.innerHTML = html;
    } else if (S.selCell) {
      const b = r.buffers[S.selCell.buf], i = S.selCell.idx;
      const ref = `${b.name}[${flatToCoordStr(b, i)}]`;
      const hist = [];
      r.ticks.forEach((t, k) => t.steps.forEach(s => s.ev.forEach(e => { if (e.buf === b.id && e.idx === i && !e.oob) hist.push({ tick: k, s, e }); })));
      const where = b.space === 'shared' ? `shared memory of block (${r.blocks[b.block].x}, ${r.blocks[b.block].y})` : 'global memory';
      const res = r.results.find(x => x.name === b.name && b.isParam);
      let html = `<div><h3>${esc(ref)}</h3><div class="sub">${where} · initial ${b.space === 'global' ? fmtNum(b.init[i]) : 'uninitialized'} · final ${Number.isNaN(b.data[i]) ? 'uninitialized' : fmtNum(b.data[i])}${res && res.want ? ` · expected ${fmtNum(res.want[i])}` : ''}</div></div>`;
      html += hist.length ? `<div class="hist-wrap"><table class="hist">${hist.map(h => `<tr data-tick="${h.tick}" class="${h.tick === S.t ? 'now' : ''}"><td>t${h.tick}</td><td><span class="flow"><span class="${h.e.op === 'r' ? 'r' : 'w'}">${h.e.op === 'r' ? 'read' : 'write'}</span> ${fmtNum(h.e.val)}</span> by ${esc(tShort(r.threads[h.s.tid]))} · line ${h.s.line}</td></tr>`).join('')}</table></div>` : `<div class="sub">No thread touched this cell.</div>`;
      box.innerHTML = html;
    } else {
      box.innerHTML = `<div class="sub">Click a thread or a memory cell to follow it through the run. Its history lists each step with the values it read and wrote.</div>
        <div class="sub">Keys: ← → step, Space play, Home / End jump.</div>`;
    }
    box.querySelectorAll('tr[data-tick]').forEach(el => el.addEventListener('click', () => { setView('tick'); goTo(+el.dataset.tick); }));
  }

  // ---------- timeline ----------
  function buildTimeline() {
    const r = S.run, tl = $('#timeline');
    const maxAct = Math.max(1, ...r.ticks.map(t => t.steps.length));
    const badTicks = new Set(r.diags.filter(d => d.sev === 'error').map(d => d.tick));
    tl.innerHTML = r.ticks.map((t, k) => {
      const w = t.steps.some(s => s.ev.some(e => e.op === 'w')), rr = t.steps.some(s => s.ev.some(e => e.op === 'r'));
      const h = k === 0 ? 8 : Math.max(8, Math.round(t.steps.length / maxAct * 100));
      return `<div class="tl-bar${w ? ' w' : rr ? ' r' : ''}${t.released.length ? ' rel' : ''}${badTicks.has(k) ? ' bad' : ''}" title="tick ${k}: ${t.steps.length} active"><i style="height:${h}%"></i></div>`;
    }).join('');
  }
  function tickFromX(clientX) {
    const tl = $('#timeline'), rc = tl.getBoundingClientRect();
    const n = S.run.ticks.length;
    return Math.max(0, Math.min(n - 1, Math.floor((clientX - rc.left) / rc.width * n)));
  }

  // ---------- diagnostics ----------
  function renderDiags() {
    const r = S.run, box = $('#diagList');
    let html = '';
    r.results.filter(x => x.ok).forEach(x => { html += `<div class="diag" data-tick="${r.ticks.length - 1}"><span class="sev ok">pass</span><span>${esc(x.name)} matches the expected values.</span><span class="at">end</span></div>`; });
    const sorted = [...r.diags].sort((a, b) => (a.sev === 'error' ? 0 : 1) - (b.sev === 'error' ? 0 : 1) || a.tick - b.tick);
    sorted.slice(0, 80).forEach((d, i) => {
      html += `<div class="diag" data-i="${r.diags.indexOf(d)}"><span class="sev ${d.sev}">${d.sev === 'error' ? 'error' : 'warn'}</span><span>${esc(d.msg)}</span><span class="at">tick ${d.tick}</span></div>`;
    });
    if (sorted.length > 80) html += `<div class="more">+${sorted.length - 80} more</div>`;
    if (!r.diags.length) html += `<div class="diag"><span class="sev ok">clean</span><span>No out-of-bounds access, data race, barrier mismatch or uninitialized read.${r.results.length ? '' : ' Add an <code>expect</code> line to the launch settings to check the output too.'}</span><span class="at"></span></div>`;
    box.innerHTML = html;
    box.querySelectorAll('.diag[data-i]').forEach(el => el.addEventListener('click', () => {
      const d = r.diags[+el.dataset.i];
      setView('tick');
      if (d.tid != null) S.selThread = d.tid, S.selCell = null;
      else if (d.buf != null && d.idx != null) S.selCell = { buf: d.buf, idx: d.idx }, S.selThread = null;
      goTo(Math.min(d.tick, r.ticks.length - 1));
    }));
    box.querySelectorAll('.diag[data-tick]').forEach(el => el.addEventListener('click', () => { setView('tick'); goTo(+el.dataset.tick); }));
  }
  function renderChips() {
    const r = S.run;
    const errs = r.diags.filter(d => d.sev === 'error').length, warns = r.diags.filter(d => d.sev === 'warn').length;
    let h = '';
    r.results.forEach(x => { h += `<span class="chip ${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✕'} ${esc(x.name)}</span>`; });
    if (errs) h += `<span class="chip bad">${errs} error${errs > 1 ? 's' : ''}</span>`;
    if (warns) h += `<span class="chip warn">${warns} warning${warns > 1 ? 's' : ''}</span>`;
    if (!errs && !warns && !r.results.length) h += `<span class="chip ok">no issues</span>`;
    $('#chips').innerHTML = h;
  }

  // ---------- interaction ----------
  function goTo(t) { if (!S.run) return; S.t = Math.max(0, Math.min(S.run.ticks.length - 1, t)); render(); }
  function selectThread(id) { S.selCell = null; S.selThread = S.selThread === id ? null : id; render(); }
  function selectCell(buf, idx) { S.selThread = null; S.selCell = S.selCell && S.selCell.buf === buf && S.selCell.idx === idx ? null : { buf, idx }; render(); }
  function setView(v) { if (S.view === v) return; S.view = v; save(); render(); }
  function stopPlay() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
  function togglePlay() {
    if (!S.run) return;
    if (S.timer) { stopPlay(); render(); return; }
    setView('tick');
    if (S.t >= S.run.ticks.length - 1) S.t = 0;
    S.timer = setInterval(() => {
      if (S.t >= S.run.ticks.length - 1) { stopPlay(); render(); return; }
      goTo(S.t + 1);
    }, +$('#speed').value);
    render();
  }

  function setEditing(on) {
    S.editing = on;
    $('#codeEdit').hidden = !on; $('#codeView').hidden = on;
    $('#editBtn').textContent = on ? 'Done' : 'Edit';
    if (on) { $('#codeEdit').value = S.code; $('#codeEdit').focus(); }
    else { S.code = $('#codeEdit').value; }
  }

  function loadPreset(id) {
    const p = PRESETS.find(x => x.id === id);
    if (!p) return;
    S.preset = id; S.code = p.code; S.launch = p.launch; S.kernelIdx = 0; S.selThread = null; S.selCell = null;
    $('#launch').value = S.launch;
    if (S.editing) $('#codeEdit').value = S.code;
    runAll();
  }

  function init() {
    // view toggle into transport row
    const vt = document.createElement('div');
    vt.className = 'tp-btns';
    vt.innerHTML = `<button class="btn vtab" data-v="tick" type="button" aria-pressed="true">This tick</button><button class="btn vtab" data-v="all" type="button" aria-pressed="false">Whole run</button>`;
    $('#chips').before(vt);
    vt.querySelectorAll('.vtab').forEach(b => b.addEventListener('click', () => { stopPlay(); setView(b.dataset.v); }));
    const st = document.createElement('style');
    st.textContent = `.vtab[aria-pressed="true"]{background:var(--ink);color:var(--panel);border-color:var(--ink)}`;
    document.head.appendChild(st);

    const sel = $('#preset');
    sel.innerHTML = PRESETS.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('') + `<option value="custom">Your own code</option>`;
    const saved = loadSaved();
    if (saved && saved.code) {
      S.code = saved.code; S.launch = saved.launch || ''; S.preset = saved.preset || 'custom'; S.view = saved.view === 'all' ? 'all' : 'tick';
      sel.value = PRESETS.some(p => p.id === S.preset) ? S.preset : 'custom';
      $('#launch').value = S.launch;
      runAll();
    } else { sel.value = 'p08'; loadPreset('p08'); }

    sel.addEventListener('change', () => {
      if (sel.value === 'custom') { S.preset = 'custom'; setEditing(true); save(); return; }
      if (S.editing) setEditing(false);
      loadPreset(sel.value);
    });
    $('#kernelSel').addEventListener('change', e => { S.kernelIdx = +e.target.value; if (S.prog) { S.launch = defaultLaunch(S.prog, S.prog.kernels[S.kernelIdx]); $('#launch').value = S.launch; } runAll(); });
    $('#runBtn').addEventListener('click', () => {
      if (S.editing) setEditing(false);
      S.launch = $('#launch').value;
      if (S.preset !== 'custom') { const p = PRESETS.find(x => x.id === S.preset); if (p && (p.code !== S.code || p.launch !== S.launch)) { S.preset = 'custom'; sel.value = 'custom'; } }
      runAll();
    });
    $('#editBtn').addEventListener('click', () => { if (S.editing) { setEditing(false); S.launch = $('#launch').value; S.preset = 'custom'; sel.value = 'custom'; runAll(); } else setEditing(true); });
    $('#codeEdit').addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const ta = e.target, s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#runBtn').click(); }
    });
    $('#launch').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#runBtn').click(); } });
    $('#resetLaunch').addEventListener('click', () => {
      try {
        const code = S.editing ? $('#codeEdit').value : S.code;
        const prog = parseProgram(code);
        if (!prog.kernels.length) throw new Error('No kernel found in the source.');
        $('#launch').value = defaultLaunch(prog, prog.kernels[Math.min(S.kernelIdx, prog.kernels.length - 1)]);
        $('#launchErr').hidden = true;
      } catch (e) { $('#launchErr').hidden = false; $('#launchErr').textContent = e.message; }
    });
    $('#bFirst').addEventListener('click', () => { stopPlay(); setView('tick'); goTo(0); });
    $('#bPrev').addEventListener('click', () => { stopPlay(); setView('tick'); goTo(S.t - 1); });
    $('#bNext').addEventListener('click', () => { stopPlay(); setView('tick'); goTo(S.t + 1); });
    $('#bLast').addEventListener('click', () => { stopPlay(); setView('tick'); goTo(Infinity); });
    $('#bPlay').addEventListener('click', togglePlay);
    $('#speed').addEventListener('change', () => { if (S.timer) { stopPlay(); togglePlay(); } });
    $('#clearSel').addEventListener('click', () => { S.selThread = null; S.selCell = null; render(); });
    const tl = $('#timeline');
    let drag = false;
    tl.addEventListener('pointerdown', e => { if (!S.run) return; drag = true; tl.setPointerCapture(e.pointerId); stopPlay(); setView('tick'); goTo(tickFromX(e.clientX)); });
    tl.addEventListener('pointermove', e => { if (drag) { const k = tickFromX(e.clientX); if (k !== S.t) goTo(k); } });
    tl.addEventListener('pointerup', () => { drag = false; });
    document.addEventListener('keydown', e => {
      if (e.target.closest('textarea, select, input')) return;
      if (!S.run) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stopPlay(); setView('tick'); goTo(S.t + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); setView('tick'); goTo(S.t - 1); }
      else if (e.key === 'Home') { e.preventDefault(); stopPlay(); setView('tick'); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); stopPlay(); setView('tick'); goTo(Infinity); }
      else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); }
    });
    let rq = 0;
    const redraw = () => { cancelAnimationFrame(rq); rq = requestAnimationFrame(drawWires); };
    window.addEventListener('resize', redraw);
    if (window.ResizeObserver) new ResizeObserver(redraw).observe($('#stage'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
  }
  init();
})();
