// 构建 dist/client.js：内联 dist/presets.js，并包装为 DSH lazy-CJS 客户端模块。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'chuanban-dsh-writingset';

const presets = readFileSync(join(root, 'dist/presets.js'), 'utf8')
  .replace(/^export\s+/gm, '')
  .replace(/^import .*$/gm, '');
const panel = readFileSync(join(root, 'src/client/panel.js'), 'utf8')
  .replace('/*__PRESETS__*/', () => presets);

const body = panel.split('\n').map((l) => (l ? '\t\t' + l : l)).join('\n');
const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/client.js'), out);
console.log('built dist/client.js (' + out.length + ' bytes)');
