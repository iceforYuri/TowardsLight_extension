/**
 * 扩展构建:esbuild 打包两个产物。
 * - dist/extension.js  扩展入口(CJS,external: vscode)
 * - dist/core.mjs      纯逻辑层(ESM,不依赖 vscode,供 scripts/test-core.mjs 在 Node 下直接测)
 * 另把 lucide-static 的 SVG 复制到 dist/lucide-icons/,供「新增图标」命令按名读取。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');

const srcIcons = path.join('node_modules', 'lucide-static', 'icons');
const destIcons = path.join('dist', 'lucide-icons');
if (fs.existsSync(srcIcons)) {
  fs.rmSync(destIcons, { recursive: true, force: true });
  fs.mkdirSync(destIcons, { recursive: true });
  for (const f of fs.readdirSync(srcIcons)) {
    if (f.endsWith('.svg')) fs.copyFileSync(path.join(srcIcons, f), path.join(destIcons, f));
  }
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
};

const builds = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', format: 'cjs', external: ['vscode'] },
  {
    ...common,
    entryPoints: ['src/core/index.ts'],
    outfile: 'dist/core.mjs',
    format: 'esm',
    // CJS 依赖(gray-matter / ts-morph)打进 ESM 产物时需要 CJS 运行时环境
    banner: {
      js: [
        "import { createRequire } from 'node:module';",
        "import { fileURLToPath } from 'node:url';",
        "import path from 'node:path';",
        'const require = createRequire(import.meta.url);',
        'const __filename = fileURLToPath(import.meta.url);',
        'const __dirname = path.dirname(__filename);',
      ].join('\n'),
    },
  },
];

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[build] watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log('[build] done');
}
