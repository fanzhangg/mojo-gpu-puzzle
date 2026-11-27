/* Types for the JS engine (src/engine/engine.js). */
export type Seg = { k: 'v' | 'op' | 'p' | 'name' | 'mem'; s: string; val?: string | null; buf?: number; src?: string };
export type Expl = { lhs: Seg[] | null; arrow: string; rhs: Seg[] | null; val: string | null };
export type MemEvent = { op: 'r' | 'w'; buf: number; idx: number; coords: number[]; val: number; oob?: boolean; prev?: number };
export type Step = {
  tid: number; line: number; ev: MemEvent[]; log: string[]; note: string; barrier?: boolean; cond?: boolean;
  err?: string; expl?: Expl; xfer?: { from: number; to: number }[]; vars?: Record<string, number | boolean | string>;
};
export type ThreadState = 'ready' | 'run' | 'wait' | 'done' | 'err';
export type Tick = { steps: Step[]; released: number[]; states: ThreadState[] };
export type Block = { id: number; x: number; y: number; z: number; threads: Thread[]; epoch: number };
export type Thread = { id: number; block: Block; x: number; y: number; z: number; state: ThreadState; steps: number[] };
export type Buffer = {
  id: number; name: string; space: 'global' | 'shared' | 'local'; block: number | null; shape: number[]; strides: number[];
  init: Float64Array; data: Float64Array; written: boolean; declaredMut?: boolean; isParam: boolean; line?: number;
};
export type Diag = { kind: string; sev: 'error' | 'warn'; tick: number; tid?: number; buf?: number; idx?: number; line?: number; msg: string };
export type Result = { name: string; ok: boolean; bad?: number[]; want?: number[]; msg: string };
export type Dim3 = { x: number; y: number; z: number };
export type Run = {
  grid: Dim3; block: Dim3; threads: Thread[]; blocks: Block[]; buffers: Buffer[]; ticks: Tick[];
  diags: Diag[]; results: Result[]; truncated: boolean; kernel: KernelDef;
};
export type KernelDef = { name: string; params: { name: string; typeText: string }[]; cparams?: { name: string; typeText: string }[]; line: number; endLine: number };
export type Unsupported = { name: string; line: number; endLine: number; message: string; errLine?: number };
export type Program = { consts: Map<string, unknown>; kernels: KernelDef[]; unsupported: Unsupported[]; constErrors: MojoError[] };
export class MojoError extends Error { line?: number; launch?: boolean }
export function parseProgram(src: string): Program;
export function simulate(prog: Program, kernel: KernelDef, launch: string): Run;
export function defaultLaunch(prog: Program, kernel: KernelDef): string;
export function fmtNum(n: number): string;
export function showV(v: unknown): string;
export function flatToCoordStr(buf: Buffer, flat: number): string;
export function flatToCoords(buf: Buffer, flat: number): number[];
export function launchFromMain(src: string, prog: Program, kernel: KernelDef): string | null;
