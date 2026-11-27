// ===================== Kernel Flow engine =====================
// Tokenizer -> parser -> lockstep SIMT interpreter for a Mojo subset.
"use strict";

class MojoError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

// ---------- Tokenizer ----------
const OPS = ['...', '**=', '//=', '->', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '<<', '>>',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',', ':', '.', '@', '&', '|', '^', '~'];

function tokenize(src) {
  // Blank out triple-quoted strings (docstrings), keeping their newlines so line numbers stay right.
  const clean = src.replace(/\r/g, '').replace(/\t/g, '    ')
    .replace(/("""|''')[\s\S]*?\1/g, m => '""' + '\n'.repeat((m.match(/\n/g) || []).length));
  const lines = clean.split('\n');
  const toks = [];
  const indents = [0];
  let depth = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const L = ln + 1;
    let i = 0;
    if (depth === 0) {
      const m = line.match(/^( *)(.*)$/);
      const rest = m[2];
      if (rest === '' || rest.startsWith('#')) continue;
      const ind = m[1].length;
      if (ind > indents[indents.length - 1]) { indents.push(ind); toks.push({ t: 'INDENT', line: L }); }
      else {
        while (ind < indents[indents.length - 1]) { indents.pop(); toks.push({ t: 'DEDENT', line: L }); }
        if (ind !== indents[indents.length - 1]) throw new MojoError('Indentation does not match any outer block', L);
      }
      i = ind;
    }
    while (i < line.length) {
      const c = line[i];
      if (c === ' ') { i++; continue; }
      if (c === '#') break;
      const rest = line.slice(i);
      let m;
      if ((m = rest.match(/^(0x[0-9a-fA-F]+|\d+\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|\d+)/))) {
        toks.push({ t: 'num', v: m[0], line: L }); i += m[0].length; continue;
      }
      if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
        toks.push({ t: 'name', v: m[0], line: L }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) { if (line[j] === '\\') j++; j++; }
        toks.push({ t: 'str', v: line.slice(i + 1, j), line: L }); i = j + 1; continue;
      }
      const op = OPS.find(o => rest.startsWith(o));
      if (!op) { toks.push({ t: 'op', v: c, line: L }); i++; continue; } // the parser rejects it where it matters
      if ('([{'.includes(op)) depth++;
      if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
      toks.push({ t: 'op', v: op, line: L }); i += op.length;
    }
    if (depth === 0) toks.push({ t: 'NL', line: L });
  }
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'DEDENT', line: lines.length }); }
  toks.push({ t: 'EOF', line: lines.length });
  return toks;
}

// ---------- Parser ----------
const KERNEL_MARKERS = ['thread_idx', 'block_idx', 'global_idx', 'barrier', 'lane_id'];
const AUG = ['+=', '-=', '*=', '/=', '//=', '%=', '**='];
const CMP = ['<', '>', '<=', '>=', '==', '!='];

class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; }
  peek(o = 0) { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  next() { return this.toks[this.p++]; }
  isOp(v, o = 0) { const t = this.peek(o); return t.t === 'op' && t.v === v; }
  isName(v, o = 0) { const t = this.peek(o); return t.t === 'name' && t.v === v; }
  isT(t) { return this.peek().t === t; }
  fail(msg, t = this.peek()) { throw new MojoError(msg, t.line); }
  expectOp(v) { if (!this.isOp(v)) this.fail(`Expected "${v}" but found ${desc(this.peek())}`); return this.next(); }
  expectName(v) {
    const t = this.peek();
    if (t.t !== 'name' || (v && t.v !== v)) this.fail(`Expected ${v ? '"' + v + '"' : 'a name'} but found ${desc(t)}`);
    return this.next().v;
  }
  skipNL() { while (this.isT('NL')) this.next(); }
  skipLine() {
    while (!this.isT('NL') && !this.isT('EOF')) this.next();
    if (this.isT('NL')) this.next();
    if (this.isT('INDENT')) this.skipIndented();
  }
  skipIndented() {
    let d = 0;
    do {
      const t = this.next();
      if (t.t === 'INDENT') d++;
      else if (t.t === 'DEDENT') d--;
      else if (t.t === 'EOF') return;
    } while (d > 0);
  }
  // collect raw tokens until an op in `stops` at bracket depth 0
  collectUntil(stops) {
    const out = []; let d = 0;
    for (;;) {
      const t = this.peek();
      if (t.t === 'EOF' || (t.t === 'NL' && d === 0)) break;
      if (t.t === 'op') {
        if (d === 0 && stops.includes(t.v)) break;
        if ('([{'.includes(t.v)) d++;
        if (')]}'.includes(t.v)) { if (d === 0) break; d--; }
      }
      out.push(this.next());
    }
    return out;
  }

  module() {
    const items = [];
    for (;;) {
      this.skipNL();
      const t = this.peek();
      if (t.t === 'EOF') break;
      if (t.t === 'INDENT' || t.t === 'DEDENT') { this.next(); continue; }
      if (t.t === 'name' && (t.v === 'comptime' || t.v === 'alias')) {
        const start = this.p;
        try {
        this.next();
        const name = this.expectName();
        if (this.isOp(':')) { this.next(); this.collectUntil(['=']); }
        this.expectOp('=');
        const expr = this.expr();
        items.push({ type: 'const', name, expr, line: t.line });
        this.endStmt();
        } catch (err) { this.p = start; this.skipLine(); }
        continue;
      }
      if (t.t === 'name' && (t.v === 'def' || t.v === 'fn')) {
        // A function the parser cannot handle (main(), or a kernel using unsupported features)
        // is recorded with the reason and skipped, instead of failing the whole file.
        const start = this.p;
        try { items.push(this.funcDef()); }
        catch (err) {
          this.p = start;
          const name = this.peek(1).t === 'name' ? this.peek(1).v : '?';
          this.skipLine();
          const body = this.toks.slice(start, this.p);
          const usesThreads = body.some(x => x.t === 'name' && KERNEL_MARKERS.includes(x.v)) && !/^(test_|benchmark_|main$)/.test(name);
          items.push({ type: 'baddef', name, line: t.line, endLine: this.toks[Math.max(0, this.p - 1)].line, message: err.message, errLine: err.line, usesThreads });
        }
        continue;
      }
      this.skipLine();
    }
    return items;
  }
  endStmt() {
    if (this.isT('NL')) { this.next(); return; }
    if (this.isT('EOF') || this.isT('DEDENT')) return;
    this.fail(`Unexpected ${desc(this.peek())}`);
  }
  funcDef() {
    const kw = this.next();
    const name = this.expectName();
    const startTok = this.p;
    const cparams = [];
    if (this.isOp('[')) {
      this.next();
      while (!this.isOp(']')) {
        const item = this.collectUntil([',', ']']);
        if (item.length && item[0].t === 'name' && item[1] && item[1].t === 'op' && item[1].v === ':') {
          const typeText = item.slice(2).map(t => t.v).join(' ');
          cparams.push({ name: item[0].v, typeText });
        }
        if (this.isOp(',')) this.next(); else break;
      }
      this.expectOp(']');
    }
    this.expectOp('(');
    const params = [];
    while (!this.isOp(')')) {
      while (this.peek().t === 'name' && ['mut', 'owned', 'read', 'out', 'var', 'ref', 'deinit'].includes(this.peek().v) && this.peek(1).t === 'name') this.next();
      if (this.isOp('*') || this.isOp('/')) { this.next(); if (this.isOp(',')) this.next(); continue; }
      const pname = this.expectName();
      let typeToks = [];
      if (this.isOp(':')) { this.next(); typeToks = this.collectUntil([',', '=']); }
      if (this.isOp('=')) { this.next(); this.collectUntil([',']); }
      params.push({ name: pname, typeToks, typeText: typeToks.map(t => t.v).join(' ') });
      if (this.isOp(',')) this.next(); else break;
    }
    this.expectOp(')');
    this.collectUntil([':']);
    this.expectOp(':');
    const body = this.block();
    const bodyToks = this.toks.slice(startTok, this.p);
    const usesThreads = bodyToks.some(t => t.t === 'name' && KERNEL_MARKERS.includes(t.v)) && !/^(test_|benchmark_|main$)/.test(name);
    return { type: 'def', name, params, cparams, body, line: kw.line, endLine: this.toks[this.p - 1].line, usesThreads };
  }
  block() {
    if (!this.isT('NL')) { const s = this.simpleStmt(); return [s]; }
    this.next();
    this.skipNL();
    if (!this.isT('INDENT')) this.fail('Expected an indented block');
    this.next();
    const stmts = [];
    for (;;) {
      this.skipNL();
      if (this.isT('DEDENT')) { this.next(); break; }
      if (this.isT('EOF')) break;
      const s = this.stmt();
      if (s) stmts.push(s);
    }
    return stmts;
  }
  stmt() {
    if (this.isName('comptime') && this.peek(1).t === 'name' && ['for', 'if', 'while'].includes(this.peek(1).v)) this.next();
    const t = this.peek();
    if (t.t === 'op' && t.v === '@') { this.skipLineOnly(); return null; }
    if (t.t === 'name') {
      switch (t.v) {
        case 'if': return this.ifStmt();
        case 'for': {
          this.next();
          const names = [this.expectName()];
          while (this.isOp(',')) { this.next(); names.push(this.expectName()); }
          this.expectName('in');
          const iter = this.expr();
          this.expectOp(':');
          const body = this.block();
          return { type: 'for', names, iter, body, line: t.line };
        }
        case 'while': {
          this.next();
          const cond = this.expr();
          this.expectOp(':');
          return { type: 'while', cond, body: this.block(), line: t.line };
        }
        case 'def': case 'fn': case 'struct':
          this.fail('Nested definitions are not supported inside a kernel');
      }
    }
    return this.simpleStmt();
  }
  skipLineOnly() { while (!this.isT('NL') && !this.isT('EOF')) this.next(); if (this.isT('NL')) this.next(); }
  ifStmt() {
    const t = this.next();
    const branches = [];
    const cond = this.expr(); this.expectOp(':');
    branches.push({ cond, body: this.block(), line: t.line });
    let orelse = null, elseLine = null;
    for (;;) {
      this.skipNL();
      if (this.isName('elif')) {
        const et = this.next();
        const c = this.expr(); this.expectOp(':');
        branches.push({ cond: c, body: this.block(), line: et.line });
      } else if (this.isName('else')) {
        elseLine = this.next().line; this.expectOp(':');
        orelse = this.block();
        break;
      } else break;
    }
    return { type: 'if', branches, orelse, elseLine, line: t.line };
  }
  simpleStmt() {
    const t = this.peek();
    let s;
    if (t.t === 'name' && (t.v === 'var' || t.v === 'comptime' || t.v === 'alias' || t.v === 'let')) {
      this.next();
      const name = this.expectName();
      if (this.isOp(':')) { this.next(); this.collectUntil(['=']); }
      let expr = null;
      if (this.isOp('=')) { this.next(); expr = this.expr(); }
      s = { type: 'var', name, expr, line: t.line };
    } else if (t.t === 'name' && t.v === 'return') {
      this.next();
      const expr = (this.isT('NL') || this.isT('EOF')) ? null : this.expr();
      s = { type: 'return', expr, line: t.line };
    } else if (t.t === 'name' && (t.v === 'break' || t.v === 'continue' || t.v === 'pass')) {
      this.next(); s = { type: t.v, line: t.line };
    } else {
      const e = this.expr();
      if (this.isOp('=')) {
        this.next();
        s = { type: 'assign', target: e, expr: this.expr(), line: t.line };
      } else if (this.peek().t === 'op' && AUG.includes(this.peek().v)) {
        const op = this.next().v.slice(0, -1);
        s = { type: 'aug', op, target: e, expr: this.expr(), line: t.line };
      } else s = { type: 'expr', expr: e, line: t.line };
    }
    this.endStmt();
    return s;
  }
  // ---- expressions ----
  expr() {
    const e = this.orExpr();
    if (this.isName('if')) {
      this.next();
      const cond = this.orExpr();
      this.expectName('else');
      const other = this.expr();
      return { k: 'tern', cond, a: e, b: other };
    }
    return e;
  }
  orExpr() { let l = this.andExpr(); while (this.isName('or')) { this.next(); l = { k: 'bool', op: 'or', l, r: this.andExpr() }; } return l; }
  andExpr() { let l = this.notExpr(); while (this.isName('and')) { this.next(); l = { k: 'bool', op: 'and', l, r: this.notExpr() }; } return l; }
  notExpr() { if (this.isName('not')) { this.next(); return { k: 'not', e: this.notExpr() }; } return this.cmp(); }
  cmp() {
    const first = this.bitor();
    const ops = [], rest = [];
    while (this.peek().t === 'op' && CMP.includes(this.peek().v)) { ops.push(this.next().v); rest.push(this.bitor()); }
    if (!ops.length) return first;
    return { k: 'cmp', first, ops, rest };
  }
  binLevel(sub, ops) {
    let l = sub();
    while (this.peek().t === 'op' && ops.includes(this.peek().v)) { const op = this.next().v; l = { k: 'bin', op, l, r: sub() }; }
    return l;
  }
  bitor() { return this.binLevel(() => this.bitxor(), ['|']); }
  bitxor() { return this.binLevel(() => this.bitand(), ['^']); }
  bitand() { return this.binLevel(() => this.shift(), ['&']); }
  shift() { return this.binLevel(() => this.arith(), ['<<', '>>']); }
  arith() { return this.binLevel(() => this.term(), ['+', '-']); }
  term() { return this.binLevel(() => this.unary(), ['*', '/', '//', '%']); }
  unary() {
    if (this.isOp('-') || this.isOp('+') || this.isOp('~')) { const op = this.next().v; return { k: 'un', op, e: this.unary() }; }
    return this.power();
  }
  power() {
    const b = this.postfix();
    if (this.isOp('**')) { this.next(); return { k: 'bin', op: '**', l: b, r: this.unary() }; }
    return b;
  }
  postfix() {
    let e = this.atom();
    for (;;) {
      if (this.isOp('(')) { const line = this.next().line; const args = this.argList(')'); e = { k: 'call', f: e, args, line }; }
      else if (this.isOp('[')) { const line = this.next().line; const args = this.argList(']'); e = { k: 'sub', base: e, args, line }; }
      else if (this.isOp('.')) { this.next(); e = { k: 'attr', base: e, name: this.expectName() }; }
      else break;
    }
    return e;
  }
  argList(close) {
    const args = [];
    while (!this.isOp(close)) {
      if (this.peek().t === 'name' && this.isOp('=', 1)) {
        const kw = this.next().v; this.next();
        args.push({ kw, e: this.expr() });
      } else if (this.isOp(':')) {
        this.fail('Slices are not supported in this visualizer');
      } else args.push({ e: this.expr() });
      if (this.isOp(',')) this.next(); else break;
    }
    this.expectOp(close);
    return args;
  }
  atom() {
    const t = this.peek();
    if (t.t === 'num') { this.next(); const isF = /[.eE]/.test(t.v) && !t.v.startsWith('0x'); return { k: 'num', v: Number(t.v), f: isF }; }
    if (t.t === 'str') { this.next(); return { k: 'str', v: t.v }; }
    if (t.t === 'name') {
      this.next();
      if (t.v === 'True') return { k: 'const', v: true };
      if (t.v === 'False') return { k: 'const', v: false };
      if (t.v === 'None') return { k: 'const', v: null };
      return { k: 'name', v: t.v, line: t.line };
    }
    if (t.t === 'op') {
      if (t.v === '(') {
        this.next();
        if (this.isOp(')')) { this.next(); return { k: 'tuple', items: [] }; }
        const first = this.expr();
        if (this.isOp(',')) {
          const items = [first];
          while (this.isOp(',')) { this.next(); if (this.isOp(')')) break; items.push(this.expr()); }
          this.expectOp(')');
          return { k: 'tuple', items };
        }
        this.expectOp(')');
        return first;
      }
      if (t.v === '[') {
        this.next();
        const items = [];
        while (!this.isOp(']')) { items.push(this.expr()); if (this.isOp(',')) this.next(); else break; }
        this.expectOp(']');
        return { k: 'list', items };
      }
      if (t.v === '...') { this.next(); return { k: 'const', v: null, ellipsis: true }; }
      if (t.v === '.') { this.next(); return { k: 'sym', v: '.' + this.expectName() }; }
    }
    this.fail(`Unexpected ${desc(t)}`);
  }
}
function desc(t) {
  if (t.t === 'NL') return 'end of line';
  if (t.t === 'EOF') return 'end of code';
  if (t.t === 'INDENT') return 'an indent';
  if (t.t === 'DEDENT') return 'a dedent';
  return `"${t.v}"`;
}

// ---------- Values ----------
const sym = name => ({ k: 'sym', name });
const builtin = (name, params) => ({ k: 'builtin', name, params });
function mkLayout(shape, colMajor) {
  const strides = new Array(shape.length);
  if (colMajor) { let s = 1; for (let i = 0; i < shape.length; i++) { strides[i] = s; s *= shape[i]; } }
  else { let s = 1; for (let i = shape.length - 1; i >= 0; i--) { strides[i] = s; s *= shape[i]; } }
  return { k: 'layout', shape, strides, size: shape.reduce((a, b) => a * b, 1) };
}
function mkArr(data, shape) { return { k: 'arr', data: Array.from(data), shape: shape || [data.length] }; }
function mkDim3(v) {
  if (typeof v === 'number') return { x: v, y: 1, z: 1 };
  if (Array.isArray(v)) {
    const d = { x: v[0] ?? 1, y: v[1] ?? 1, z: v[2] ?? 1 };
    for (const k of ['x', 'y', 'z']) if (typeof d[k] !== 'number') throw new Error(`Grid and block sizes must be numbers; ${showV(d[k])} is not known`);
    return d;
  }
  if (v && v.k === 'dim3') return { x: v.x, y: v.y, z: v.z };
  throw new Error('Grid and block sizes must be a number or a tuple like (4, 1)');
}

const INT_CASTS = ['Int', 'UInt', 'Int32', 'Int64', 'UInt32', 'UInt64', 'Int16', 'Int8', 'UInt8', 'UInt16', 'Idx'];
const FLOAT_CASTS = ['Float32', 'Float64', 'Float16', 'BFloat16'];
const GLOBAL_BUILTINS = new Set([...INT_CASTS, ...FLOAT_CASTS, 'Scalar', 'SIMD', 'rebind', 'row_major', 'col_major', 'stack_allocation',
  'min', 'max', 'abs', 'print', 'range', 'type_of', 'barrier', 'Coord', 'IndexList', 'Index', 'lane_id', 'warp_id', 'shuffle_down', 'shuffle_up', 'shuffle_xor', 'shuffle_idx', 'broadcast', 'prefix_sum', 'warp_sum', 'warp_max', 'warp_min', 'warp', 'block', 'copy_dram_to_sram_async', 'copy_dram_to_sram', 'async_copy_wait_all', 'log2', 'floor', 'ceil', 'Layout', 'LayoutTensor', 'TileTensor', 'Bool', 'len', 'exp', 'sqrt', 'log', 'tanh', 'ceildiv', 'align_up']);

function truthy(v) { return typeof v === 'boolean' ? v : (typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : !!v); }

function arith(op, a, b) {
  if ((a && a.k === 'arr') || (b && b.k === 'arr')) {
    const A = a && a.k === 'arr' ? a : null, B = b && b.k === 'arr' ? b : null;
    const n = A ? A.data.length : B.data.length;
    if (A && B && A.data.length !== B.data.length) throw new Error(`Array lengths differ (${A.data.length} vs ${B.data.length})`);
    const out = [];
    for (let i = 0; i < n; i++) out.push(arith(op, A ? A.data[i] : a, B ? B.data[i] : b));
    return mkArr(out, (A || B).shape);
  }
  if (typeof a === 'boolean') a = +a;
  if (typeof b === 'boolean') b = +b;
  if (typeof a !== 'number' || typeof b !== 'number') throw new Error(`Cannot apply "${op}" to ${showV(a)} and ${showV(b)}`);
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '//': return Math.floor(a / b);
    case '%': { const r = a % b; return (r !== 0 && (r < 0) !== (b < 0)) ? r + b : r; }
    case '**': return a ** b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
  }
  throw new Error('Unknown operator ' + op);
}
function compare(op, a, b) {
  switch (op) {
    case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
    case '==': return a === b || (typeof a !== 'object' && a == b); case '!=': return !(a === b || (typeof a !== 'object' && a == b));
  }
}
function showV(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return '(' + v.map(showV).join(', ') + ')';
  if (v.k === 'tensor') return v.buf.name;
  if (v.k === 'layout') return `layout[${v.shape.join(',')}]`;
  if (v.k === 'sym') return v.name;
  if (v.k === 'builtin') return v.name;
  if (v.k === 'arr') return '[' + v.data.map(fmtNum).join(', ') + ']';
  return String(v.k || v);
}
function fmtNum(n) {
  if (Number.isNaN(n)) return '?';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a >= 1e5 || a < 1e-3) return n.toExponential(2);
  return String(+n.toFixed(a >= 100 ? 1 : 3));
}

// ---------- Evaluator ----------
// ctx: { lookup(name), thread?, onRead, allocShared, comptime }
function evalExpr(e, C) {
  const v = evalExpr0(e, C);
  if (C.cap) C.cap.set(e, v);
  return v;
}
function evalExpr0(e, C) {
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return e.v;
    case 'const': return e.v;
    case 'sym': return sym(e.v);
    case 'name': return C.lookup(e.v, e.line);
    case 'tuple': return e.items.map(x => evalExpr(x, C));
    case 'list': return mkArr(e.items.map(x => evalExpr(x, C)));
    case 'tern': return truthy(evalExpr(e.cond, C)) ? evalExpr(e.a, C) : evalExpr(e.b, C);
    case 'bool': {
      const l = evalExpr(e.l, C);
      if (e.op === 'and') return truthy(l) ? evalExpr(e.r, C) : l;
      return truthy(l) ? l : evalExpr(e.r, C);
    }
    case 'not': return !truthy(evalExpr(e.e, C));
    case 'cmp': {
      let l = evalExpr(e.first, C);
      for (let i = 0; i < e.ops.length; i++) {
        const r = evalExpr(e.rest[i], C);
        if (!compare(e.ops[i], l, r)) return false;
        l = r;
      }
      return true;
    }
    case 'un': {
      const v = evalExpr(e.e, C);
      if (e.op === '-') return arith('*', v, -1);
      if (e.op === '~') return ~v;
      return v;
    }
    case 'bin': return arith(e.op, evalExpr(e.l, C), evalExpr(e.r, C));
    case 'attr': return getAttr(evalExpr(e.base, C), e.name, C);
    case 'sub': {
      const base = evalExpr(e.base, C);
      if (base && base.k === 'tensor') {
        const { flat, coords, oob } = tensorIndex(base, e.args, C);
        return C.onRead(base, flat, coords, oob);
      }
      return subscriptNonTensor(base, e.args.map(a => ({ kw: a.kw, v: evalExpr(a.e, C) })), C);
    }
    case 'call': {
      const f = evalExpr(e.f, C);
      const args = e.args.map(a => ({ kw: a.kw, v: evalExpr(a.e, C) }));
      return callValue(f, args, C, e);
    }
  }
  throw new Error('Unsupported expression');
}

function getAttr(v, name, C) {
  if (v && v.k === 'dim3') {
    if (!(name in v)) throw new Error(`${v.name} has no field "${name}"`);
    return v[name];
  }
  if (v && v.k === 'tensor') {
    if (name === 'dim' || name === 'shape') return builtin('dim', { t: v });
    if (name === 'tile') return builtin('tile', { t: v });
    if (name === 'size') return builtin('tsize', { t: v });
    if (name === 'load' || name === 'store') return builtin('t' + name, { t: v });
    throw new Error(`Tensor "${v.buf.name}" has no attribute "${name}" in this visualizer`);
  }
  if (v && v.k === 'builtin' && v.name === 'Layout' && (name === 'row_major' || name === 'col_major')) return builtin(name);
  if (v && v.k === 'builtin' && (v.name === 'warp' || v.name === 'block')) return builtin(v.name + '.' + name);
  if (v && v.k === 'ttype' && name === 'stack_allocation') return builtin('ttype_alloc', { tt: v });
  if (v && v.k === 'sym') return sym(v.name + '.' + name);
  if (v && v.k === 'layout') {
    if (name === 'size') return builtin('lsize', { l: v });
  }
  throw new Error(`Cannot read attribute "${name}" of ${showV(v)}`);
}

function tensorIndex(t, args, C) {
  if (args.length === 1 && args[0].kw === 'unsafe_offset') {
    const off = evalExpr(args[0].e, C);
    if (typeof off !== 'number') throw new Error('unsafe_offset must be a number');
    const flat = t.offset + off;
    return { flat, coords: [off], oob: !(Number.isInteger(off) && flat >= 0 && flat < t.buf.data.length) };
  }
  const idx = args.map(a => { if (a.kw) throw new Error(`Unexpected keyword "${a.kw}" in index`); return evalExpr(a.e, C); });
  if (idx.length === 1 && Array.isArray(idx[0])) idx.splice(0, 1, ...idx[0]);
  return tensorIndexVals(t, idx);
}
function tensorIndexVals(t, idx) {
  for (const i of idx) if (typeof i !== 'number' || !Number.isInteger(i)) throw new Error(`Index into ${t.buf.name} must be an integer, got ${showV(i)}`);
  if (t.ptr) {
    if (idx.length !== 1) throw new Error(`Pointer ${t.buf.name} takes a single index`);
    const flat = t.offset + idx[0];
    return { flat, coords: idx, oob: !(flat >= 0 && flat < t.buf.data.length) };
  }
  if (idx.length !== t.shape.length) throw new Error(`${t.buf.name} has ${t.shape.length} dimension${t.shape.length > 1 ? 's' : ''} but was indexed with ${idx.length}`);
  let flat = t.offset, oob = false;
  for (let d = 0; d < idx.length; d++) {
    if (idx[d] < 0 || idx[d] >= t.shape[d]) oob = true;
    flat += idx[d] * t.strides[d];
  }
  if (t.view) {
    // report coordinates in the underlying buffer, and check them against its real shape
    const b = t.buf;
    const coords = [];
    let rem = flat, inside = flat >= 0 && flat < b.data.length;
    const order = b.strides.map((st, d) => [st, d]).sort((x, y) => y[0] - x[0]);
    const c = new Array(b.shape.length).fill(0);
    for (const [st, d] of order) { c[d] = Math.floor(rem / st); rem -= c[d] * st; }
    c.forEach((v, d) => { if (v < 0 || v >= b.shape[d]) inside = false; coords.push(v); });
    // a tile that hangs over the buffer edge: map the view index back and check it there
    const viewBase = [];
    let r2 = t.offset;
    const c0 = new Array(b.shape.length).fill(0);
    for (const [st, d] of order) { c0[d] = Math.floor(r2 / st); r2 -= c0[d] * st; }
    for (let d = 0; d < idx.length && d < c0.length; d++) { const g = c0[d] + idx[d]; viewBase.push(g); if (g >= b.shape[d]) inside = false; }
    return { flat, coords: inside ? coords : viewBase, oob: oob || !inside };
  }
  return { flat, coords: idx, oob };
}

function subscriptNonTensor(base, params, C) {
  if (base && base.k === 'builtin') {
    if (base.name === 'dim' && params.length === 1) return builtin('dimk', { t: base.params.t, d: params[0].v });
    if (base.name === 'tload' || base.name === 'tstore') return base;
    if (base.name === 'tile') return builtin('tilek', { t: base.params.t, sizes: params.filter(p => !p.kw).map(p => p.v) });
    if (base.name === 'LayoutTensor' || base.name === 'TileTensor') return { k: 'ttype', params };
    return builtin(base.name, params);
  }
  if (base && base.k === 'sym') return base;
  if (typeof base === 'number' || typeof base === 'boolean') {
    if (params.length === 1 && params[0].v === 0) return base; // a scalar is a SIMD vector of width 1
    throw new Error(`Cannot index the scalar ${showV(base)} at ${showV(params[0].v)}`);
  }
  if (base && base.k === 'arr') {
    const i = params[0].v; return base.data[i];
  }
  if (Array.isArray(base)) return base[params[0].v];
  throw new Error(`Cannot index ${showV(base)}`);
}

function findLayout(params) {
  for (const p of params || []) if (p.v && p.v.k === 'layout') return p.v;
  return null;
}
function isSharedSpace(params) {
  return (params || []).some(p => p.v && p.v.k === 'sym' && /SHARED/.test(p.v.name));
}

function callValue(f, args, C, node) {
  const pos = args.filter(a => !a.kw).map(a => a.v);
  if (!f || f.k !== 'builtin') {
    if (f && f.k === 'layout') return f; // type_of(layout)(...) etc
    if (f && f.k === 'sym') return f;
    throw new Error(`${showV(f)} is not callable here`);
  }
  const n = f.name;
  if (n === 'lane_id' || n === 'warp_id') { if (!C.laneInfo) throw new Error(`${n}() can only run inside a kernel`); return C.laneInfo()[n === 'lane_id' ? 'lane' : 'warp']; }
  if (COLLECTIVES[n]) {
    if (!C.collective) throw new Error(`${n}() can only run inside a kernel`);
    const [scope, kind] = COLLECTIVES[n];
    const kw = name => { const a = args.find(x => x.kw === name) || (f.params || []).find(x => x.kw === name); return a ? a.v : undefined; };
    const val = pos[0] ?? kw('val') ?? kw('value');
    const arg = pos[1] ?? kw('offset') ?? kw('lane_mask') ?? kw('src_lane') ?? kw('src_thread');
    return C.collective(node, scope, kind, val, arg, { exclusive: !!kw('exclusive') });
  }
  if (INT_CASTS.includes(n)) { const v = pos[0]; return typeof v === 'boolean' ? +v : Math.trunc(v); }
  if (FLOAT_CASTS.includes(n) || n === 'Scalar' || n === 'SIMD') { const v = pos[0]; return typeof v === 'boolean' ? +v : Math.fround(v); }
  if (n === 'Bool') return truthy(pos[0]);
  switch (n) {
    case 'rebind': return pos[0];
    case 'type_of': return pos[0];
    case 'min': return pos.length === 1 && pos[0].k === 'arr' ? Math.min(...pos[0].data) : Math.min(...pos);
    case 'max': return pos.length === 1 && pos[0].k === 'arr' ? Math.max(...pos[0].data) : Math.max(...pos);
    case 'abs': return Math.abs(pos[0]);
    case 'exp': return Math.exp(pos[0]);
    case 'sqrt': return Math.sqrt(pos[0]);
    case 'log2': return Math.log2(pos[0]);
    case 'floor': return Math.floor(pos[0]);
    case 'ceil': return Math.ceil(pos[0]);
    case 'log': return Math.log(pos[0]);
    case 'tanh': return Math.tanh(pos[0]);
    case 'ceildiv': return Math.ceil(pos[0] / pos[1]);
    case 'align_up': return Math.ceil(pos[0] / pos[1]) * pos[1];
    case 'len': return pos[0].k === 'arr' ? pos[0].data.length : pos[0].length;
    case 'row_major': case 'col_major': {
      const dims = (f.params && f.params.length ? f.params.map(p => p.v) : pos).flat();
      if (!dims.length || dims.some(d => typeof d !== 'number')) throw new Error(`${n} needs numeric dimensions`);
      return mkLayout(dims, n === 'col_major');
    }
    case 'dim': return f.params.t.shape[pos[0]];
    case 'Coord': case 'IndexList': case 'Index': return pos.length === 1 ? pos[0] : pos;
    case 'tload': case 'tstore': {
      const t = f.params.t;
      const idx = [pos[0]].flat();
      const r = tensorIndexVals(t, idx);
      if (n === 'tload') return C.onRead(t, r.flat, r.coords, r.oob);
      if (!C.writeTensor) throw new Error('store can only run inside a kernel');
      C.writeTensor(t, r, pos[1]);
      return null;
    }
    case 'tilek': {
      // t.tile[s0, s1](c0, c1): a view of shape [s0, s1] starting at (c0*s0, c1*s1)
      const t = f.params.t, sizes = f.params.sizes;
      if (sizes.length !== pos.length || sizes.length !== t.shape.length) throw new Error(`tile needs ${t.shape.length} sizes and ${t.shape.length} tile coordinates`);
      let offset = t.offset;
      for (let d = 0; d < sizes.length; d++) offset += pos[d] * sizes[d] * t.strides[d];
      return { k: 'tensor', buf: t.buf, shape: sizes, strides: t.strides, offset, ptr: false, view: true };
    }
    case 'dimk': return f.params.t.shape[f.params.d];
    case 'tsize': return f.params.t.shape.reduce((a, b) => a * b, 1);
    case 'lsize': return f.params.l.size;
    case 'print': if (C.onPrint) C.onPrint(pos.map(showV).join(' ')); return null;
    case 'barrier': throw new Error('barrier() must be its own statement');
    case 'copy_dram_to_sram_async': case 'copy_dram_to_sram': case 'copy':
      if (!C.copyTile) throw new Error(`${n} can only run inside a kernel`);
      C.copyTile(pos[0], pos[1]);
      return null;
    case 'async_copy_wait_all': return null;
    case 'range': throw new Error('range() can only be used in a for loop');
    case 'stack_allocation': {
      if (!C.allocShared) throw new Error('stack_allocation can only run inside a kernel');
      let layout = findLayout(args) || findLayout(f.params);
      if (!layout) {
        const nPos = (f.params || []).find(p => !p.kw && typeof p.v === 'number');
        if (nPos) layout = mkLayout([nPos.v]);
      }
      if (!layout) throw new Error('Could not work out the size of this stack_allocation');
      const shared = isSharedSpace(f.params) || isSharedSpace(args);
      return C.allocShared(node, layout, shared, !findLayout(args) && !findLayout(f.params));
    }
    case 'ttype_alloc': {
      if (!C.allocShared) throw new Error('stack_allocation can only run inside a kernel');
      const layout = findLayout(f.params.tt.params);
      if (!layout) throw new Error('Could not find the layout of this LayoutTensor');
      return C.allocShared(node, layout, isSharedSpace(f.params.tt.params), false);
    }
  }
  throw new Error(`${n}() is not supported in this visualizer`);
}

// ---------- Substituted expression rendering ----------
const OPSYM = { '*': '×', '/': '/', '//': '//', '%': '%', '+': '+', '-': '−', '**': '**', '<': '<', '>': '>', '<=': '≤', '>=': '≥', '==': '==', '!=': '≠', '<<': '<<', '>>': '>>', '&': '&', '|': '|', '^': '^' };
const PREC = { '|': 5, '^': 6, '&': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '//': 10, '%': 10, '**': 12 };
const IDENTITY_CALLS = new Set([...INT_CASTS, ...FLOAT_CASTS, 'Scalar', 'SIMD', 'rebind', 'type_of', 'Bool']);
function nodePrec(n) {
  switch (n.k) {
    case 'tern': return 0;
    case 'bool': return n.op === 'or' ? 1 : 2;
    case 'not': return 3;
    case 'cmp': return 4;
    case 'bin': return PREC[n.op];
    case 'un': return 11;
  }
  return 99;
}
function calleeName(f) {
  if (f.k === 'name') return f.v;
  if (f.k === 'sub') return calleeName(f.base);
  if (f.k === 'attr') return calleeName(f.base) + '.' + f.name;
  return '?';
}
function attrText(n) { return n.k === 'attr' ? attrText(n.base) + '.' + n.name : n.k === 'name' ? n.v : '…'; }
function isScalar(v) { return typeof v === 'number' || typeof v === 'boolean'; }
// Renders an expression with every variable replaced by its value in this step.
// Segments: {k:'v'} value, {k:'op'} operator, {k:'p'} punctuation, {k:'name'}, {k:'mem', s, val, buf}
function substSegs(e, cap, asTarget) {
  const out = [];
  const push = (k, s, extra) => out.push(Object.assign({ k, s }, extra));
  const wrap = (child, parentP, right) => {
    const p = nodePrec(child);
    const need = p < parentP || (right && p === parentP && p < 99);
    if (need) push('p', '(');
    walk(child);
    if (need) push('p', ')');
  };
  function walk(n) {
    switch (n.k) {
      case 'num': push('v', n.f && Number.isInteger(n.v) ? n.v + '.0' : String(n.v)); return;
      case 'str': push('v', JSON.stringify(n.v)); return;
      case 'const': push('v', n.v === true ? 'True' : n.v === false ? 'False' : 'None'); return;
      case 'sym': push('name', n.v); return;
      case 'name': case 'attr': {
        const v = cap && cap.get(n);
        if (isScalar(v)) push('v', showV(v), { src: n.k === 'name' ? n.v : attrText(n) });
        else push('name', n.k === 'name' ? n.v : attrText(n));
        return;
      }
      case 'bin': { const p = PREC[n.op]; wrap(n.l, p, false); push('op', ' ' + (OPSYM[n.op] || n.op) + ' '); wrap(n.r, p, true); return; }
      case 'cmp': { wrap(n.first, 5, false); n.ops.forEach((op, i) => { push('op', ' ' + (OPSYM[op] || op) + ' '); wrap(n.rest[i], 5, false); }); return; }
      case 'bool': { const p = nodePrec(n); wrap(n.l, p, false); push('op', ' ' + n.op + ' '); wrap(n.r, p, true); return; }
      case 'not': push('op', 'not '); wrap(n.e, 3, false); return;
      case 'un': push('op', n.op === '-' ? '−' : n.op); wrap(n.e, 11, false); return;
      case 'tern': wrap(n.a, 1); push('op', ' if '); wrap(n.cond, 1); push('op', ' else '); wrap(n.b, 1); return;
      case 'tuple': push('p', '('); n.items.forEach((x, i) => { if (i) push('p', ', '); walk(x); }); push('p', ')'); return;
      case 'list': push('p', '['); n.items.forEach((x, i) => { if (i) push('p', ', '); walk(x); }); push('p', ']'); return;
      case 'sub': {
        const base = cap && cap.get(n.base);
        if (base && base.k === 'tensor') {
          const idx = n.args.map(a => { const v = cap.get(a.e); return isScalar(v) ? showV(v) : '?'; });
          const val = cap.get(n);
          push('mem', `${base.buf.name}[${idx.join(', ')}]`, { val: asTarget || !isScalar(val) ? null : showV(val), buf: base.buf.id });
          return;
        }
        push('name', calleeName(n));
        return;
      }
      case 'call': {
        const name = calleeName(n.f);
        const root = name.split('.')[0];
        if (IDENTITY_CALLS.has(root) && n.args.length === 1) { walk(n.args[0].e); return; }
        const v = cap && cap.get(n);
        if (isScalar(v) && /\.(dim|size|shape)$/.test(name)) { push('v', showV(v), { src: name + '()' }); return; }
        push('name', name); push('p', '(');
        n.args.forEach((a, i) => { if (i) push('p', ', '); if (a.kw) push('name', a.kw + '='); walk(a.e); });
        push('p', ')');
        return;
      }
    }
    push('name', '…');
  }
  walk(e);
  return out;
}

// Warp and block collectives: name -> [scope, operation]
const COLLECTIVES = {
  shuffle_down: ['warp', 'down'], shuffle_up: ['warp', 'up'], shuffle_xor: ['warp', 'xor'], shuffle_idx: ['warp', 'idx'],
  broadcast: ['warp', 'broadcast'], prefix_sum: ['warp', 'prefix_sum'],
  warp_sum: ['warp', 'sum'], warp_max: ['warp', 'max'], warp_min: ['warp', 'min'],
  'warp.sum': ['warp', 'sum'], 'warp.max': ['warp', 'max'], 'warp.min': ['warp', 'min'], 'warp.broadcast': ['warp', 'broadcast'],
  'warp.prefix_sum': ['warp', 'prefix_sum'], 'warp.shuffle_down': ['warp', 'down'], 'warp.shuffle_up': ['warp', 'up'], 'warp.shuffle_xor': ['warp', 'xor'], 'warp.shuffle_idx': ['warp', 'idx'],
  'block.sum': ['block', 'sum'], 'block.max': ['block', 'max'], 'block.min': ['block', 'min'], 'block.broadcast': ['block', 'broadcast'], 'block.prefix_sum': ['block', 'prefix_sum'],
};
class NeedCollective { constructor(req) { this.req = req; } }
const COLL_WAIT = { collWait: true };
let NODE_UID = 0;

// ---------- Program ----------
function parseProgram(src) {
  const items = new Parser(tokenize(src)).module();
  const consts = items.filter(i => i.type === 'const');
  const defs = items.filter(i => i.type === 'def');
  const env = new Map([['WARP_SIZE', 32]]);
  const C = {
    lookup(name, line) {
      if (env.has(name)) return env.get(name);
      if (GLOBAL_BUILTINS.has(name)) return builtin(name);
      return sym(name);
    },
    onRead() { throw new Error('Memory reads are not allowed at compile time'); }
  };
  const constErrors = [];
  for (const c of consts) {
    try { env.set(c.name, evalExpr(c.expr, C)); }
    catch (err) { constErrors.push(new MojoError(`comptime ${c.name}: ${err.message}`, c.line)); env.set(c.name, sym(c.name)); }
  }
  const kernels = defs.filter(d => d.name !== 'main' && d.usesThreads);
  const unsupported = items.filter(i => i.type === 'baddef' && i.usesThreads && i.name !== 'main');
  return { items, consts: env, defs, kernels, unsupported, constErrors };
}

function paramKind(p, consts) {
  const tt = p.typeText;
  if (/\b(TileTensor|LayoutTensor)\b/.test(tt)) {
    let layout = null;
    for (const t of p.typeToks) if (t.t === 'name' && consts.has(t.v) && consts.get(t.v) && consts.get(t.v).k === 'layout') { layout = consts.get(t.v); break; }
    return { kind: 'tensor', layout, mut: !/mut\s*=\s*False/.test(tt) && !/ImmutAnyOrigin/.test(tt) };
  }
  if (/\b(Pointer|UnsafePointer)\b/.test(tt)) return { kind: 'ptr', layout: null, mut: !/ImmutAnyOrigin/.test(tt) };
  return { kind: 'scalar' };
}

// ---------- Launch spec ----------
function specHelpers() {
  const H = {
    zeros: (...a) => mkArr(new Array(prod(a)).fill(0)),
    ones: (...a) => mkArr(new Array(prod(a)).fill(1)),
    fill: (n, v) => mkArr(new Array(prod([n])).fill(v)),
    arange: (a, b, s = 1) => { if (b === undefined) { b = a; a = 0; } const o = []; for (let x = a; s > 0 ? x < b : x > b; x += s) o.push(x); return mkArr(o); },
    randint: (n, lo = 0, hi = 10, seed = 1) => { let x = seed * 9301 + 49297; const o = []; for (let i = 0; i < prod([n]); i++) { x = (x * 9301 + 49297) % 233280; o.push(lo + Math.floor(x / 233280 * (hi - lo))); } return mkArr(o); },
    sum: a => a.data.reduce((p, q) => p + q, 0),
    cumsum: a => { let s = 0; return mkArr(a.data.map(v => (s += v))); },
    dot: (a, b) => a.data.reduce((s, v, i) => s + v * b.data[i], 0),
    repeat: (a, n) => mkArr(Array.from({ length: a.data.length * n }, (_, i) => a.data[i % a.data.length])),
    concat: (...xs) => mkArr(xs.flatMap(x => x.k === 'arr' ? x.data : [x])),
  };
  return H;
}
function prod(a) { return a.flat().reduce((p, q) => p * q, 1); }

function parseLaunch(text, consts) {
  const lines = text.replace(/\r/g, '').split('\n');
  const vals = new Map(), expects = [];
  const H = specHelpers();
  const C = {
    lookup(name, line) {
      if (vals.has(name)) return vals.get(name);
      if (consts.has(name)) return consts.get(name);
      if (H[name]) return { k: 'helper', fn: H[name], name };
      if (GLOBAL_BUILTINS.has(name)) return builtin(name);
      throw new MojoError(`Unknown name "${name}"`, line);
    },
    onRead() { throw new Error('no memory here'); }
  };
  const origCall = callValue;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/#.*$/, '').trim();
    if (!line) continue;
    let isExpect = false;
    if (/^expect\s/.test(line)) { isExpect = true; line = line.replace(/^expect\s+/, ''); }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/);
    if (!m) { const me = new MojoError('Write each launch line as  name = value', i + 1); me.launch = true; throw me; }
    let v;
    try {
      const toks = tokenize(m[2]);
      const P = new Parser(toks);
      const e = P.expr();
      v = evalSpec(e, C);
    } catch (err) { const me = new MojoError(err.message, i + 1); me.launch = true; throw me; }
    if (isExpect) expects.push({ name: m[1], v, line: i + 1 });
    else vals.set(m[1], v);
  }
  return { vals, expects };
}
function evalSpec(e, C) {
  // like evalExpr but allows helper calls
  if (e.k === 'call') {
    const f = evalSpec(e.f, C);
    const args = e.args.map(a => evalSpec(a.e, C));
    if (f && f.k === 'helper') return f.fn(...args);
    return callValue(f, args.map(v => ({ v })), C, e);
  }
  if (e.k === 'bin') return arith(e.op, evalSpec(e.l, C), evalSpec(e.r, C));
  if (e.k === 'un' && e.op === '-') return arith('*', evalSpec(e.e, C), -1);
  if (e.k === 'tuple') return e.items.map(x => evalSpec(x, C));
  if (e.k === 'list') return mkArr(e.items.map(x => evalSpec(x, C)).flatMap(x => x && x.k === 'arr' ? x.data : [x]));
  return evalExpr(e, C);
}

function defaultLaunch(prog, kernel) {
  const c = prog.consts;
  const has0 = n => c.has(n) && c.get(n) && c.get(n).k !== 'sym';
  // If the kernel's tensors use e.g. `LayoutTiledType`, prefer SIZE_TILED, BLOCKS_PER_GRID_TILED, ...
  const suffixes = [];
  for (const p of kernel.params) for (const t of p.typeToks || []) {
    const m = t.t === 'name' && t.v.match(/^Layout([A-Z][a-z]+)\w*Type$/);
    if (m) suffixes.push('_' + m[1].toUpperCase());
  }
  const pick = n => { for (const sfx of suffixes) if (has0(n + sfx)) return n + sfx; return n; };
  const has = n => has0(pick(n));
  const out = [];
  for (const cp of kernel.cparams || []) {
    if (!/^(Int|UInt|Int32|Int64)$/.test(cp.typeText.trim())) continue;
    const up = cp.name.toUpperCase();
    out.push(`${cp.name} = ${has(up) ? pick(up) : has('SIZE') ? pick('SIZE') : '4'}   # compile-time parameter`);
  }
  out.push(`grid  = ${has('BLOCKS_PER_GRID') ? pick('BLOCKS_PER_GRID') : '1'}`);
  out.push(`block = ${has('THREADS_PER_BLOCK') ? pick('THREADS_PER_BLOCK') : has('TPB') ? 'TPB' : has('SIZE') ? pick('SIZE') : '4'}`);
  for (const p of kernel.params) {
    const k = paramKind(p, c);
    if (k.kind === 'scalar') {
      out.push(`${p.name} = ${has('SIZE') ? pick('SIZE') : '4'}`);
    } else {
      const n = k.layout ? k.layout.size : (has('SIZE') ? pick('SIZE') : 8);
      const outish = /^(out|output|result|res|c)$/i.test(p.name) || p.name.startsWith('out');
      out.push(`${p.name} = ${outish ? 'zeros' : 'arange'}(${n})`);
    }
  }
  return out.join('\n');
}

// ---------- Simulation ----------
const MAX_TICKS = 4000;
const MAX_THREADS = 1024;

function simulate(prog, kernel, launchText) {
  const consts = prog.consts;
  const { vals, expects } = parseLaunch(launchText, consts);
  if (!vals.has('grid')) vals.set('grid', 1);
  if (!vals.has('block')) throw new MojoError('Set "block = ..." in the launch settings (threads per block)', 1);
  const grid = mkDim3(vals.get('grid')), block = mkDim3(vals.get('block'));
  const nThreads = grid.x * grid.y * grid.z * block.x * block.y * block.z;
  if (nThreads > MAX_THREADS) throw new MojoError(`This launch has ${nThreads} threads; the visualizer handles up to ${MAX_THREADS}. Shrink SIZE or the block size.`, 1);
  if (nThreads <= 0) throw new MojoError('The launch has no threads', 1);

  const buffers = [];
  const args = new Map();
  for (const cp of kernel.cparams || []) {
    if (!/^(Int|UInt|Int32|Int64)$/.test(cp.typeText.trim())) continue;
    const v = vals.has(cp.name) ? vals.get(cp.name) : undefined;
    if (typeof v !== 'number') throw new MojoError(`Set the compile-time parameter "${cp.name} = ..." in the launch settings`, 1);
    args.set(cp.name, v);
  }
  for (const p of kernel.params) {
    const k = paramKind(p, consts);
    let v = vals.get(p.name);
    if (k.kind === 'scalar') {
      if (v === undefined) throw new MojoError(`Set "${p.name} = ..." in the launch settings`, 1);
      if (typeof v !== 'number' && typeof v !== 'boolean') throw new MojoError(`"${p.name}" is a scalar parameter; give it a number`, 1);
      args.set(p.name, v);
      continue;
    }
    if (v === undefined) {
      if (k.layout) v = mkArr(new Array(k.layout.size).fill(0));
      else throw new MojoError(`Set "${p.name} = ..." in the launch settings`, 1);
    }
    if (typeof v === 'number') v = mkArr([v]);
    if (!v || v.k !== 'arr') throw new MojoError(`"${p.name}" is a buffer; give it an array such as arange(8)`, 1);
    let shape = [v.data.length], strides = [1];
    if (k.layout) {
      if (k.layout.size !== v.data.length) throw new MojoError(`"${p.name}" has ${v.data.length} values but its layout [${k.layout.shape.join(', ')}] needs ${k.layout.size}`, 1);
      shape = k.layout.shape; strides = k.layout.strides;
    }
    const buf = {
      id: buffers.length, name: p.name, space: 'global', block: null, shape, strides,
      init: Float64Array.from(v.data.map(x => Math.fround(+x))), data: null, written: false, declaredMut: k.mut, isParam: true,
    };
    buf.data = Float64Array.from(buf.init);
    buf.initMask = new Uint8Array(buf.data.length).fill(1);
    buffers.push(buf);
    args.set(p.name, { k: 'tensor', buf, shape, strides, offset: 0, ptr: k.kind === 'ptr' });
  }

  // threads
  const threads = [];
  const blocks = [];
  for (let bz = 0; bz < grid.z; bz++) for (let by = 0; by < grid.y; by++) for (let bx = 0; bx < grid.x; bx++) {
    const b = { id: blocks.length, x: bx, y: by, z: bz, threads: [], epoch: 0, shared: new Map() };
    blocks.push(b);
    for (let tz = 0; tz < block.z; tz++) for (let ty = 0; ty < block.y; ty++) for (let tx = 0; tx < block.x; tx++) {
      const th = { id: threads.length, block: b, x: tx, y: ty, z: tz, state: 'run', steps: [] };
      threads.push(th); b.threads.push(th);
    }
  }

  const diags = [];
  const diagKeys = new Set();
  function diag(d) { const key = d.key || (d.kind + d.msg); if (diagKeys.has(key)) return; diagKeys.add(key); diags.push(d); }

  const access = new Map(); // `${buf}:${idx}` -> [{tid,op,block,epoch,tick}]
  let tick = 0;
  let cur = null; // current step being built
  let curThread = null;

  function cellName(buf, coords) { return `${buf.name}[${coords.join(', ')}]`; }
  function recordAccess(buf, flat, op, th) {
    const key = buf.id + ':' + flat;
    let list = access.get(key);
    if (!list) { list = []; access.set(key, list); }
    for (const o of list) {
      if (o.tid === th.id) continue;
      if (op !== 'w' && o.op !== 'w') continue;
      if (o.block === th.block.id && o.epoch !== th.block.epoch) continue;
      const other = threads[o.tid];
      const crossBlock = o.block !== th.block.id;
      diag({
        kind: 'race', sev: 'error', tick, tid: th.id, buf: buf.id, idx: flat, key: 'race:' + key,
        msg: `Race on ${buf.name}[${flatToCoordStr(buf, flat)}]: ${threadLabel(other)} ${o.op === 'w' ? 'writes' : 'reads'} it (tick ${o.tick}) and ${threadLabel(th)} ${op === 'w' ? 'writes' : 'reads'} it (tick ${tick}) ${crossBlock ? 'from a different block, with no ordering between blocks' : 'with no barrier() in between'}.`
      });
    }
    if (list.length < 64) list.push({ tid: th.id, op, block: th.block.id, epoch: th.block.epoch, tick });
  }

  function makeCtx(th, env) {
    return {
      lookup(name, line) {
        if (env.has(name)) return env.get(name);
        if (consts.has(name)) return consts.get(name);
        switch (name) {
          case 'thread_idx': return { k: 'dim3', name: 'thread_idx', x: th.x, y: th.y, z: th.z };
          case 'block_idx': return { k: 'dim3', name: 'block_idx', x: th.block.x, y: th.block.y, z: th.block.z };
          case 'block_dim': return { k: 'dim3', name: 'block_dim', x: block.x, y: block.y, z: block.z };
          case 'grid_dim': return { k: 'dim3', name: 'grid_dim', x: grid.x, y: grid.y, z: grid.z };
          case 'global_idx': return { k: 'dim3', name: 'global_idx', x: th.block.x * block.x + th.x, y: th.block.y * block.y + th.y, z: th.block.z * block.z + th.z };
        }
        if (GLOBAL_BUILTINS.has(name)) return builtin(name);
        if (/^(DType|AddressSpace|MutAnyOrigin|ImmutAnyOrigin|MutableAnyOrigin|dtype)$/.test(name)) return sym(name);
        throw new MojoError(`"${name}" is not defined`, line);
      },
      onRead(t, flat, coords, oob) {
        const buf = t.buf;
        if (oob) {
          cur.ev.push({ op: 'r', buf: buf.id, idx: flat, coords, val: NaN, oob: true });
          diag({ kind: 'oob', sev: 'error', tick, tid: th.id, buf: buf.id, key: 'oobr:' + buf.id + ':' + coords, msg: `${threadLabel(th)} reads ${cellName(buf, coords)}, outside its shape [${buf.shape.join(', ')}]. On a GPU this returns garbage or crashes.` });
          return NaN;
        }
        const val = buf.data[flat];
        cur.ev.push({ op: 'r', buf: buf.id, idx: flat, coords, val });
        if (!buf.initMask[flat]) diag({ kind: 'uninit', sev: 'warn', tick, tid: th.id, buf: buf.id, idx: flat, key: 'un:' + buf.id + ':' + flat, msg: `${threadLabel(th)} reads ${cellName(buf, coords)} before any thread wrote it. Shared memory starts with garbage.` });
        recordAccess(buf, flat, 'r', th);
        return val;
      },
      onPrint(s) { cur.log.push(s); },
      writeTensor(t, r, val) { writeMem(t, r.flat, r.coords, r.oob, val, th); },
      laneInfo() {
        const lin = th.x + th.y * block.x + th.z * block.x * block.y;
        return { lane: lin % WARP, warp: Math.floor(lin / WARP), linear: lin };
      },
      collective(node, scope, kind, val, arg, opts) {
        if (node.__uid === undefined) node.__uid = ++NODE_UID;
        const seq = th.collSeq.get(node.__uid) || 0;
        const key = node.__uid + ':' + seq;
        const res = th.collResults.get(key);
        if (res) {
          th.collResults.delete(key);
          th.collSeq.set(node.__uid, seq + 1);
          if (res.sources.length) cur.xfer = (cur.xfer || []).concat(res.sources.map(from => ({ from, to: th.id })));
          return res.value;
        }
        if (typeof val === 'boolean') val = +val;
        if (typeof val !== 'number') throw new Error(`${kind} needs a number, got ${showV(val)}`);
        throw new NeedCollective({ uid: node.__uid, seq, scope, kind, val, arg, opts });
      },
      // Block-wide tile copy (copy_dram_to_sram_async): element e is copied by thread e % threads_in_block.
      copyTile(dst, src) {
        if (!dst || dst.k !== 'tensor' || !src || src.k !== 'tensor') throw new Error('copy needs a destination and a source tensor');
        const nT = block.x * block.y * block.z;
        const me = th.x + th.y * block.x + th.z * block.x * block.y;
        const total = dst.shape.reduce((a, b) => a * b, 1);
        for (let e = me; e < total; e += nT) {
          const c = []; let r = e;
          for (let d = dst.shape.length - 1; d >= 0; d--) { c[d] = r % dst.shape[d]; r = Math.floor(r / dst.shape[d]); }
          const sIdx = tensorIndexVals(src, src.shape.length === c.length ? c : [e]);
          const v = this.onRead(src, sIdx.flat, sIdx.coords, sIdx.oob);
          const dIdx = tensorIndexVals(dst, c);
          writeMem(dst, dIdx.flat, dIdx.coords, dIdx.oob, v, th);
        }
      },
      allocShared(node, layout, shared, isPtr) {
        const key = node.line + ':' + (node.col || 0) + ':' + env.__allocCount;
        let buf;
        if (shared) {
          buf = th.block.shared.get(node.line);
          if (!buf) {
            buf = {
              id: buffers.length, name: (env.__pendingName || 'shared'), space: 'shared', block: th.block.id,
              shape: layout.shape, strides: layout.strides, data: new Float64Array(layout.size).fill(NaN),
              written: false, isParam: false, line: node.line,
            };
            buf.init = Float64Array.from(buf.data);
            buf.initMask = new Uint8Array(layout.size);
            buffers.push(buf);
            th.block.shared.set(node.line, buf);
          }
        } else {
          buf = {
            id: buffers.length, name: (env.__pendingName || 'local') + `@t${th.id}`, space: 'local', block: th.block.id, owner: th.id,
            shape: layout.shape, strides: layout.strides, data: new Float64Array(layout.size).fill(NaN), written: false, isParam: false, line: node.line,
          };
          buf.init = Float64Array.from(buf.data);
          buf.initMask = new Uint8Array(layout.size);
          buffers.push(buf);
        }
        return { k: 'tensor', buf, shape: layout.shape, strides: layout.strides, offset: 0, ptr: isPtr };
      },
    };
  }

  function writeMem(t, flat, coords, oob, val, th) {
    const buf = t.buf;
    if (typeof val === 'boolean') val = +val;
    if (typeof val !== 'number') throw new Error(`Cannot store ${showV(val)} into ${buf.name}`);
    if (oob) {
      cur.ev.push({ op: 'w', buf: buf.id, idx: flat, coords, val, oob: true });
      diag({ kind: 'oob', sev: 'error', tick, tid: th.id, buf: buf.id, key: 'oobw:' + buf.id + ':' + coords, msg: `${threadLabel(th)} writes ${cellName(buf, coords)}, outside its shape [${buf.shape.join(', ')}]. This corrupts memory; add a bounds guard.` });
      return;
    }
    if (buf.isParam && buf.declaredMut === false) diag({ kind: 'immut', sev: 'error', tick, tid: th.id, buf: buf.id, key: 'immut:' + buf.id, msg: `${threadLabel(th)} writes ${buf.name}, which is declared read-only (mut=False).` });
    val = Math.fround(val);
    const prev = buf.data[flat];
    buf.data[flat] = val;
    buf.initMask[flat] = 1;
    buf.written = true;
    cur.ev.push({ op: 'w', buf: buf.id, idx: flat, coords, val, prev });
    recordAccess(buf, flat, 'w', th);
  }

  function snapVars(env) {
    const o = {};
    for (const [k, v] of env) {
      if (k.startsWith('__')) continue;
      if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
      else if (v && v.k === 'tensor' && v.buf.space !== 'global') o[k] = '→ ' + (v.buf.space === 'shared' ? 'shared' : 'local') + ' mem';
    }
    return o;
  }

  const WARP = 32;
  // Runs fn; if it hits a warp/block collective, pause until the other lanes arrive, then run it again.
  function* withCollectives(th, C, line, fn) {
    for (let round = 0; ; round++) {
      const snap = new Map(th.collSeq);
      begin(th, line, C);
      try { return fn(); }
      catch (e) {
        if (!(e instanceof NeedCollective) || round > 16) throw e;
        th.collSeq = snap;
        th.need = e.req;
        yield COLL_WAIT;
      }
    }
  }
  function begin(th, line, C) { cur = { tid: th.id, line, ev: [], log: [], note: '' }; if (C) C.cap = new Map(); }

  function* execBlock(stmts, th, env, C) {
    for (const s of stmts) { const r = yield* execStmt(s, th, env, C); if (r) return r; }
    return null;
  }
  function assignTarget(target, val, th, env, C) {
    if (target.k === 'name') { env.set(target.v, val); return `${target.v} = ${showV(val)}`; }
    if (target.k === 'sub') {
      const base = evalExpr(target.base, C);
      if (!base || base.k !== 'tensor') throw new Error('Can only assign into a buffer or tensor');
      const { flat, coords, oob } = tensorIndex(base, target.args, C);
      writeMem(base, flat, coords, oob, val, th);
      return '';
    }
    throw new Error('Unsupported assignment target');
  }
  function* execStmt(s, th, env, C) {
    switch (s.type) {
      case 'var': {
        const v = yield* withCollectives(th, C, s.line, () => {
          env.__pendingName = s.name;
          try { return s.expr ? evalExpr(s.expr, C) : 0; } finally { env.__pendingName = null; }
        });
        if (v && v.k === 'tensor' && v.buf.space === 'shared' && v.buf.name === 'shared' && s.name !== 'shared') v.buf.name = s.name;
        env.set(s.name, v);
        if (typeof v === 'number' || typeof v === 'boolean') { cur.note = `${s.name} = ${showV(v)}`; if (s.expr) cur.expl = { lhs: [{ k: 'name', s: s.name }], arrow: '=', rhs: substSegs(s.expr, C.cap), val: showV(v) }; }
        else if (v && v.k === 'tensor') cur.note = `${s.name} → ${v.buf.space} [${v.shape.join('×')}]`;
        yield cur; return null;
      }
      case 'assign': {
        yield* withCollectives(th, C, s.line, () => {
          const v = evalExpr(s.expr, C);
          cur.note = assignTarget(s.target, v, th, env, C);
          cur.expl = { lhs: substSegs(s.target, C.cap, true), arrow: s.target.k === 'sub' ? '←' : '=', rhs: substSegs(s.expr, C.cap), val: showV(v) };
        });
        yield cur; return null;
      }
      case 'aug': {
        const v = yield* withCollectives(th, C, s.line, () => {
          const rhs = evalExpr(s.expr, C);
          const old = evalExpr(s.target, C);
          const v = arith(s.op, old, rhs);
          cur.note = assignTarget(s.target, v, th, env, C);
          return v;
        });
        { const oldSegs = substSegs(s.target, C.cap); const r = substSegs(s.expr, C.cap); if (s.expr.k === 'bin' || s.expr.k === 'cmp') { r.unshift({ k: 'p', s: '(' }); r.push({ k: 'p', s: ')' }); }
          cur.expl = { lhs: substSegs(s.target, C.cap, true), arrow: s.target.k === 'sub' ? '←' : '=', rhs: [...oldSegs, { k: 'op', s: ' ' + (OPSYM[s.op] || s.op) + ' ' }, ...r], val: showV(v) }; }
        yield cur; return null;
      }
      case 'expr': {
        const e = s.expr;
        if ((e.k === 'const' && e.ellipsis) || e.k === 'str') return null;
        if (e.k === 'call' && e.f.k === 'name' && e.f.v === 'barrier') {
          begin(th, s.line, C);
          cur.barrier = true; cur.note = 'waits at barrier()';
          yield cur; return null;
        }
        yield* withCollectives(th, C, s.line, () => evalExpr(e, C));
        yield cur; return null;
      }
      case 'pass': return null;
      case 'break': case 'continue': begin(th, s.line, C); cur.note = s.type; yield cur; return { ctl: s.type };
      case 'return': begin(th, s.line, C); cur.note = 'return'; if (s.expr) evalExpr(s.expr, C); yield cur; return { ctl: 'return' };
      case 'if': {
        for (const br of s.branches) {
          const c = yield* withCollectives(th, C, br.line, () => truthy(evalExpr(br.cond, C)));
          cur.note = c ? 'condition true' : 'condition false';
          cur.cond = c;
          cur.expl = { lhs: null, arrow: '', rhs: substSegs(br.cond, C.cap), val: c ? 'True' : 'False' };
          yield cur;
          if (c) return yield* execBlock(br.body, th, env, C);
        }
        if (s.orelse) return yield* execBlock(s.orelse, th, env, C);
        return null;
      }
      case 'while': {
        for (;;) {
          begin(th, s.line, C);
          const c = truthy(evalExpr(s.cond, C));
          cur.note = c ? 'loop continues' : 'loop ends'; cur.cond = c;
          cur.expl = { lhs: null, arrow: '', rhs: substSegs(s.cond, C.cap), val: c ? 'True' : 'False' };
          yield cur;
          if (!c) return null;
          const r = yield* execBlock(s.body, th, env, C);
          if (r && r.ctl === 'break') return null;
          if (r && r.ctl === 'return') return r;
        }
      }
      case 'for': {
        const it = s.iter;
        let seq;
        begin(th, s.line, C);
        if (it.k === 'call' && it.f.k === 'name' && it.f.v === 'range') {
          const a = it.args.map(x => evalExpr(x.e, C));
          let [lo, hi, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] ?? 1];
          if (st === 0) throw new Error('range() step cannot be 0');
          seq = []; for (let x = lo; st > 0 ? x < hi : x > hi; x += st) { seq.push(x); if (seq.length > 100000) break; }
        } else {
          const v = evalExpr(it, C);
          if (v && v.k === 'arr') seq = v.data; else if (Array.isArray(v)) seq = v; else throw new Error('Can only loop over range(...)');
        }
        let first = true;
        for (const x of seq) {
          if (!first) begin(th, s.line, C);
          first = false;
          env.set(s.names[0], x);
          cur.note = `${s.names[0]} = ${showV(x)}`;
          cur.expl = { lhs: [{ k: 'name', s: s.names[0] }], arrow: '=', rhs: null, val: showV(x) };
          yield cur;
          const r = yield* execBlock(s.body, th, env, C);
          if (r && r.ctl === 'break') return null;
          if (r && r.ctl === 'return') return r;
        }
        if (first) { cur.note = 'loop runs 0 times'; yield cur; }
        return null;
      }
    }
    throw new Error('Unsupported statement');
  }

  // All lanes (or block threads) that reached the same collective this tick exchange values here.
  function resolveCollectives(batch) {
    const groups = new Map();
    for (const th of batch) {
      const r = th.need;
      const lin = th.x + th.y * block.x + th.z * block.x * block.y;
      const scopeKey = r.scope === 'block' ? 'b' + th.block.id : 'w' + th.block.id + ':' + Math.floor(lin / WARP);
      const key = scopeKey + '|' + r.uid + '|' + r.seq;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ th, r, lane: r.scope === 'block' ? lin : lin % WARP });
    }
    for (const members of groups.values()) {
      const byLane = new Map(members.map(m => [m.lane, m]));
      members.sort((a, b) => a.lane - b.lane);
      const all = members.map(m => m.r.val);
      for (const m of members) {
        const { kind, val, arg, opts } = m.r;
        let value = val, sources = [];
        const from = src => { const o = byLane.get(src); if (o && o !== m) { value = o.r.val; sources = [o.th.id]; } };
        switch (kind) {
          case 'down': from(m.lane + (arg ?? 1)); break;
          case 'up': from(m.lane - (arg ?? 1)); break;
          case 'xor': from(m.lane ^ (arg ?? 1)); break;
          case 'idx': from(arg ?? 0); break;
          case 'broadcast': from(arg ?? 0); break;
          case 'sum': value = all.reduce((a, b) => a + b, 0); sources = members.filter(o => o !== m).map(o => o.th.id); break;
          case 'max': value = Math.max(...all); sources = members.filter(o => o !== m).map(o => o.th.id); break;
          case 'min': value = Math.min(...all); sources = members.filter(o => o !== m).map(o => o.th.id); break;
          case 'prefix_sum': {
            const upto = members.filter(o => (opts.exclusive ? o.lane < m.lane : o.lane <= m.lane));
            value = upto.reduce((a, o) => a + o.r.val, 0);
            sources = upto.filter(o => o !== m).map(o => o.th.id);
            break;
          }
        }
        m.th.collResults.set(m.r.uid + ':' + m.r.seq, { value: Math.fround(value), sources });
        m.th.need = null;
      }
    }
  }

  // set up generators
  for (const th of threads) {
    const env = new Map(args);
    env.__allocCount = 0;
    const C = makeCtx(th, env);
    th.env = env;
    th.collSeq = new Map();
    th.collResults = new Map();
    th.gen = (function* () { yield* execBlock(kernel.body, th, env, C); })();
  }

  const ticks = [{ steps: [], released: [], states: threads.map(() => 'ready') }];
  let truncated = false;
  while (threads.some(t => t.state === 'run' || t.state === 'wait')) {
    tick++;
    if (tick > MAX_TICKS) { truncated = true; tick--; break; }
    const rec = { steps: [], released: [], states: null };
    const pending = [];
    const advance = th => {
      curThread = th;
      let r;
      try { r = th.gen.next(); }
      catch (err) {
        const line = err.line || (cur && cur.tid === th.id ? cur.line : null);
        const step = { tid: th.id, line, ev: cur && cur.tid === th.id ? cur.ev : [], log: [], note: 'error: ' + err.message, err: err.message };
        rec.steps.push(step); th.steps.push(tick);
        th.state = 'err';
        diag({ kind: 'runtime', sev: 'error', tick, tid: th.id, line, key: 'rt:' + line + err.message, msg: `${threadLabel(th)} stopped on line ${line}: ${err.message}` });
        return;
      }
      if (r.done) { th.state = 'done'; th.doneTick = tick; return; }
      if (r.value === COLL_WAIT) { th.state = 'coll'; pending.push(th); return; }
      const step = r.value;
      step.vars = snapVars(th.env);
      rec.steps.push(step); th.steps.push(tick);
      if (step.barrier) th.state = 'wait';
    };
    for (const th of threads) if (th.state === 'run') advance(th);
    for (let round = 0; pending.length && round < 20; round++) {
      const batch = pending.splice(0);
      resolveCollectives(batch);
      for (const th of batch) { th.state = 'run'; advance(th); }
    }
    for (const b of blocks) {
      const waiting = b.threads.filter(t => t.state === 'wait');
      if (!waiting.length) continue;
      if (b.threads.every(t => t.state !== 'run')) {
        const gone = b.threads.filter(t => t.state === 'done' || t.state === 'err');
        if (gone.length) diag({ kind: 'barrier', sev: 'warn', tick, tid: gone[0].id, key: 'bar:' + b.id, msg: `In block (${b.x}, ${b.y}), ${gone.length} thread${gone.length > 1 ? 's' : ''} exited without reaching barrier(). Every thread in a block must hit the same barrier, or the kernel can hang.` });
        for (const t of waiting) t.state = 'run';
        b.epoch++;
        rec.released.push(b.id);
      }
    }
    rec.states = threads.map(t => t.state);
    if (!rec.steps.length && !rec.released.length) { tick--; break; }
    ticks.push(rec);
  }
  if (truncated) diag({ kind: 'limit', sev: 'warn', tick: MAX_TICKS, msg: `Stopped after ${MAX_TICKS} ticks. Check for a loop that never ends.` });

  // expectations
  const results = [];
  for (const ex of expects) {
    const buf = buffers.find(b => b.name === ex.name && b.isParam);
    if (!buf) { results.push({ name: ex.name, ok: false, msg: `No buffer named "${ex.name}"` }); continue; }
    const want = typeof ex.v === 'number' ? [ex.v] : ex.v.data;
    if (want.length !== buf.data.length) { results.push({ name: ex.name, ok: false, msg: `expected ${want.length} values, buffer has ${buf.data.length}` }); continue; }
    const bad = [];
    for (let i = 0; i < want.length; i++) { const a = buf.data[i], w = Math.fround(want[i]); if (!(Math.abs(a - w) <= 1e-4 * Math.max(1, Math.abs(w)))) bad.push(i); }
    results.push({ name: ex.name, ok: bad.length === 0, bad, want, msg: bad.length ? `${bad.length} of ${want.length} values differ` : 'matches' });
    if (bad.length) diag({ kind: 'expect', sev: 'error', tick: ticks.length - 1, buf: buf.id, idx: bad[0], key: 'ex:' + buf.id, msg: `${ex.name} does not match the expected values at ${bad.length} position${bad.length > 1 ? 's' : ''} (first: index ${flatToCoordStr(buf, bad[0])}, got ${fmtNum(buf.data[bad[0]])}, want ${fmtNum(want[bad[0]])}).` });
  }

  return { grid, block, threads, blocks, buffers, ticks, diags, results, truncated, kernel };

  function threadLabel(th) {
    const tl = block.y > 1 || block.z > 1 ? `(${th.x},${th.y})` : `${th.x}`;
    const multiBlock = grid.x * grid.y * grid.z > 1;
    const bl = grid.y > 1 ? `(${th.block.x},${th.block.y})` : `${th.block.x}`;
    return multiBlock ? `thread ${tl} of block ${bl}` : `thread ${tl}`;
  }
}

function flatToCoordStr(buf, flat) {
  if (buf.shape.length === 1) return String(flat);
  const c = [];
  for (let d = 0; d < buf.shape.length; d++) c.push(Math.floor(flat / buf.strides[d]) % buf.shape[d]);
  return c.join(', ');
}
function flatToCoords(buf, flat) {
  const c = [];
  for (let d = 0; d < buf.shape.length; d++) c.push(Math.floor(flat / buf.strides[d]) % buf.shape[d]);
  return c;
}

// ---------- Launch settings read from main() ----------
// Finds `ctx.enqueue_function[kernel](args..., grid_dim=..., block_dim=...)` in the host code and
// works out each buffer's size and how it was filled. Returns null when the pattern is not found.
function launchFromMain(src, prog, kernel) {
  const text = src.replace(/\r/g, '').replace(/#[^\n]*/g, '');
  const balanced = (str, open) => {
    // returns [inner, endIndex] for the bracket starting at `open`
    const pairs = { '(': ')', '[': ']' };
    const close = pairs[str[open]];
    let d = 0;
    for (let i = open; i < str.length; i++) {
      if (str[i] === '(' || str[i] === '[') d++;
      else if (str[i] === ')' || str[i] === ']') { d--; if (d === 0) return [str.slice(open + 1, i), i]; }
    }
    return [str.slice(open + 1), str.length];
  };
  const splitTop = str => {
    const out = []; let d = 0, cur = '';
    for (const ch of str) {
      if ('([{'.includes(ch)) d++;
      if (')]}'.includes(ch)) d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  // collect every launch
  const launches = [];
  let at = 0;
  for (;;) {
    const i = text.indexOf('enqueue_function', at);
    if (i < 0) break;
    let j = text.indexOf('[', i);
    const [callee, endCallee] = balanced(text, j);
    j = text.indexOf('(', endCallee);
    const [argText, end] = balanced(text, j);
    at = end;
    const m = callee.match(/^\s*([A-Za-z_]\w*)\s*(?:\[([\s\S]*)\])?\s*$/);
    if (!m) continue;
    const args = splitTop(argText);
    // a launch through an alias: `comptime kernel = matmul_tiled[...]` shortly before the call
    let alias = null;
    const before = text.slice(Math.max(0, i - 800), i);
    const am = [...before.matchAll(new RegExp('(?:comptime|alias|var)\\s+' + m[1] + '\\s*=\\s*([A-Za-z_]\\w*)', 'g'))].pop();
    if (am) alias = am[1];
    launches.push({ alias, name: m[1], cargs: m[2] ? splitTop(m[2]) : [], pos: args.filter(a => !/^\w+\s*=[^=]/.test(a)), kw: Object.fromEntries(args.filter(a => /^\w+\s*=[^=]/.test(a)).map(a => [a.split('=')[0].trim(), a.slice(a.indexOf('=') + 1).trim()])) });
  }
  const launch = launches.find(l => l.name === kernel.name) || launches.find(l => l.alias === kernel.name) || launches.find(l => l.pos.length === kernel.params.length && !prog.kernels.some(k => k.name === l.name));
  if (!launch) return null;

  // names defined in host code: `var x = expr`, `comptime x = expr`
  const defs = new Map();
  for (const m of text.matchAll(/^\s*(?:var|comptime|alias|let)\s+(\w+)\s*(?::[^=\n]+)?=\s*([^\n]+)$/gm)) if (!defs.has(m[1])) defs.set(m[1], m[2].trim());
  const consts = prog.consts;
  const resolve = (expr, depth = 0) => expr.replace(/\b[A-Za-z_]\w*\b/g, n => {
    if (consts.has(n) && consts.get(n) && consts.get(n).k !== 'sym') return n;
    if (depth < 4 && defs.has(n) && !/enqueue|TileTensor|mem\.|ctx\./.test(defs.get(n))) return '(' + resolve(defs.get(n), depth + 1) + ')';
    return n;
  });
  const unwrapCast = a => { const m = a.match(/^(?:Int32|Int|UInt|Int64|UInt32|Float32|Scalar\[\w+\])\(([\s\S]*)\)$/); return m ? m[1].trim() : a; };

  const lines = [];
  // compile-time Int parameters passed as kernel[...] arguments
  const intCparams = (kernel.cparams || []).map((cp, i) => ({ ...cp, i })).filter(cp => /^(Int|UInt|Int32|Int64)$/.test(cp.typeText.trim()));
  for (const cp of intCparams) {
    const a = launch.cargs[cp.i];
    if (a && !/\.Engine$|^\w+\.\w+$/.test(a)) lines.push(`${cp.name} = ${resolve(a)}`);
  }
  if (launch.kw.grid_dim) lines.push(`grid  = ${resolve(launch.kw.grid_dim)}`);
  if (launch.kw.block_dim) lines.push(`block = ${resolve(launch.kw.block_dim)}`);
  kernel.params.forEach((p, i) => {
    let a = launch.pos[i];
    if (!a) return;
    const kind = paramKind(p, consts).kind;
    if (kind === 'scalar') { lines.push(`${p.name} = ${resolve(unwrapCast(a))}`); return; }
    // tensor: follow `x = TileTensor(buf, layout)` back to the buffer
    let bufName = a.match(/^\w+$/) ? a : null;
    for (let k = 0; k < 3 && bufName && defs.has(bufName); k++) {
      const d = defs.get(bufName);
      const m = d.match(/^(?:TileTensor|LayoutTensor)(?:\[[^\]]*\])?\(\s*(\w+)/);
      if (m) { bufName = m[1]; continue; }
      break;
    }
    const d = bufName && defs.get(bufName);
    const sizeM = d && (d.match(/enqueue_create_buffer\[[^\]]*\]\(([\s\S]+)\)\s*$/) || d.match(/\.output\(([\s\S]+)\)\s*$/));
    if (!sizeM) return; // let defaults handle it
    const size = resolve(sizeM[1].trim());
    const isOut = /\.output\(/.test(d);
    const hostNames = [bufName + '_host', ...[...text.matchAll(new RegExp('\\b' + bufName + '\\.map_to_host\\(\\)\\s+as\\s+(\\w+)', 'g'))].map(m => m[1])];
    const hostWrite = hostNames.some(h => new RegExp('\\b' + h + '\\[[^\\]]+\\]\\s*=').test(text));
    const fill = text.match(new RegExp('\\b' + bufName + '\\.enqueue_fill\\(([^)]+)\\)'));
    let init;
    if (isOut) init = `zeros(${size})`;
    else if (hostWrite) init = `arange(${size})`;
    else if (fill) init = `fill(${size}, ${fill[1].trim()})`;
    else init = `zeros(${size})`;
    lines.push(`${p.name} = ${init}`);
  });
  if (!lines.length) return null;
  // Keep each line from main() only if it evaluates on its own; otherwise use the guessed default.
  const fromMain = new Map();
  for (const l of lines) {
    const name = l.split('=')[0].trim();
    try {
      const { vals } = parseLaunch(l, consts);
      const v = vals.get(name);
      if (name === 'grid' || name === 'block') mkDim3(v);
      const kp = kernel.params.find(p => p.name === name);
      const lay = kp && paramKind(kp, consts).layout;
      if (lay && v && v.k === 'arr' && v.data.length !== lay.size) continue;
      fromMain.set(name, l);
    } catch { /* fall back */ }
  }
  const merged = defaultLaunch(prog, kernel).split('\n').map(l => fromMain.get(l.split('=')[0].trim()) || l);
  return merged.join('\n');
}

export { launchFromMain, tokenize, Parser, parseProgram, simulate, defaultLaunch, fmtNum, showV, flatToCoordStr, flatToCoords, MojoError };
