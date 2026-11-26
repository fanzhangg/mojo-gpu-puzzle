// Copies the single-file build to kernel-flow.html (open directly in a browser) and writes
// dist/artifact.html, the same page without the <html>/<head>/<body> wrapper, for hosts that add their own.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
writeFileSync(new URL('../kernel-flow.html', import.meta.url), html);

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(new URL('../dist/artifact.html', import.meta.url), head.trim() + '\n' + body.trim() + '\n');
console.log('wrote kernel-flow.html and dist/artifact.html (' + Math.round(html.length / 1024) + ' KB)');
