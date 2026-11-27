// Small helpers for writing puzzle scenes.
//
// A scene is what the page draws for one stage of one puzzle, for the output (or thread) the reader
// selected:
//   rows:   [{ id, label, kind: 'global' | 'shared' | 'threads', cells, groups?, groupLabel? }]
//   cells:  [{ v, tone?, note?, idx? }]   tone: read | write | focus | active | wait | idle | muted | ghost
//   arrows: [{ from: 'rowId:i', to: 'rowId:i', kind: 'read' | 'write' | 'move' | 'ghost', faint? }]
//   say:    one or two plain sentences, in both languages (`code` in backticks)
//   math:   optional worked line(s) with the selected unit's real numbers (code, not translated)
//
// Any user-visible text is either a plain string (same in both languages) or L(en, zh).

export const L = (en, zh) => ({ en, zh });
export const range = (n, from = 0) => Array.from({ length: n }, (_, i) => i + from);
export const fmt = n => (n == null ? '·' : Number.isInteger(n) ? String(n) : String(+n.toFixed(3)));
export const cell = (v, tone, extra) => ({ v: v == null ? null : typeof v === 'number' ? fmt(v) : v, tone, ...extra });
export const at = (row, i) => `${row}:${i}`;
export const arrow = (from, to, kind, faint = false) => ({ from, to, kind, faint });
export const list = xs => (xs.length <= 1 ? String(xs[0] ?? '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const listZh = xs => xs.join('、');
