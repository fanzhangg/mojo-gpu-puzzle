import type { Lang, Text } from '@/puzzles/index';

export const tr = (t: Text | undefined, lang: Lang) => (t == null ? '' : typeof t === 'string' ? t : t[lang]);

export const UI = {
  tagline: { en: "How each Mojo GPU puzzle's solution moves data, one output at a time.", zh: '逐题演示 Mojo GPU 谜题的解法如何搬运数据，一次只看一个输出。' },
  puzzles: { en: 'Puzzles', zh: '题目' },
  book: { en: 'Read the puzzle', zh: '阅读原题' },
  skipped: { en: 'Puzzles about debugging, profiling, MAX and hardware details (09–10, 17–23, 28+) are not about how data moves, so they are not here.', zh: '关于调试、性能分析、MAX 和硬件细节的题目（09–10、17–23、28 以后）不涉及数据如何流动，所以这里没有收录。' },
  puzzle: { en: 'Puzzle', zh: '第' },
  puzzleSuffix: { en: '', zh: '题' },
  task: { en: 'Task', zh: '题目' },
  idea: { en: 'Key idea', zh: '关键思路' },
  data: { en: 'Sample data', zh: '示例数据' },
  dataNote: { en: "Same values as the puzzle's own test in main().", zh: '与题目 main() 里测试用的数据相同。' },
  launch: { en: 'Launch', zh: '启动配置' },
  steps: { en: 'Steps', zh: '步骤' },
  prev: { en: 'Previous step', zh: '上一步' },
  next: { en: 'Next step', zh: '下一步' },
  keys: { en: '← → step through the kernel', zh: '← → 切换步骤' },
  solution: { en: 'Solution kernel', zh: '解答 kernel' },
  legendRead: { en: 'read', zh: '读' },
  legendWrite: { en: 'write', zh: '写' },
  legendMove: { en: 'combine inside shared memory', zh: '在共享内存内合并' },
  legendGhost: { en: 'would go out of bounds', zh: '会越界的访问' },
  legendCell: { en: 'big number = value, [i] = index', zh: '大字是值，[i] 是下标' },
  global: { en: 'global memory', zh: '全局内存' },
  shared: { en: 'shared memory', zh: '共享内存' },
  threads: { en: 'number = thread_idx', zh: '数字是 thread_idx' },
} satisfies Record<string, { en: string; zh: string }>;

export function initialLang(): Lang {
  try {
    const s = localStorage.getItem('kernel-flow:lang');
    if (s === 'en' || s === 'zh') return s;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function saveLang(l: Lang) {
  try { localStorage.setItem('kernel-flow:lang', l); } catch { /* storage unavailable */ }
}
