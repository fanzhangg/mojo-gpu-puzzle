export type Lang = 'en' | 'zh';
export type Text = string | { en: string; zh: string };
export type Tone = 'read' | 'write' | 'focus' | 'active' | 'wait' | 'idle' | 'muted' | 'ghost';
export type Cell = { v: string | null; tone?: Tone; note?: Text; idx?: string };
export type Row = { id: string; label: Text; kind: 'global' | 'shared' | 'threads'; cells: Cell[]; cols?: number; groups?: number; groupLabel?: (g: number) => Text; dense?: boolean };
export type Arrow = { from: string; to: string; kind: 'read' | 'write' | 'move' | 'ghost'; faint?: boolean };
export type Scene = { rows: Row[]; arrows: Arrow[]; say: Text; math?: Text };
export type Stage = { name: Text; lines: string[]; scene: (sel: number) => Scene };
export type Tensor = { name: string; values: number[] | Text; note: Text };
export type Puzzle = {
  id: string; num: number; title: Text; variant?: Text; stub?: boolean; goal: Text; idea: Text;
  data: { launch: Text; tensors: Tensor[] };
  pick: { row: string; initial: number; hint: Text };
  stages: Stage[];
  result: () => number[];
  // kernel: one kernel; kernels: run in order on the same buffers (multi-kernel pages)
  oracle: { file: string; kernel?: string; kernels?: string[]; buffer: string; launch?: string; inputs?: Record<string, string> };
};
export const PUZZLES: Puzzle[];
