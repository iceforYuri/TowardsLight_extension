/**
 * Commit-context regression: selected files only, including untracked text.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const assert = (ok, message) => {
  if (!ok) {
    console.error(`  ✗ ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
};

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'towardslight-git-context-'));
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'towardslight-git-bundle-'));
try {
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  fs.mkdirSync(path.join(repo, 'posts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'posts/gramma-reading-notes.md'), '# GraMMA\n\nold\n');
  git(['add', '.']);
  git(['commit', '-qm', 'init']);

  fs.writeFileSync(path.join(repo, 'posts/gramma-reading-notes.md'), '# GraMMA\n\nGRAMMA_UNRELATED_EDIT\n');
  fs.writeFileSync(
    path.join(repo, 'posts/memgpt-reading-notes.md'),
    '---\ntitle: MemGPT memory hierarchy\n---\n\nMEMGPT_NEW_ARTICLE_CONTENT\n',
  );

  const outfile = path.join(bundleDir, 'git-context.mjs');
  await esbuild.build({
    entryPoints: [path.resolve(import.meta.dirname, '../src/git.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  const { diffForPrompt } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

  const selected = diffForPrompt(repo, ['posts/memgpt-reading-notes.md']);
  assert(selected.includes('MEMGPT_NEW_ARTICLE_CONTENT'), '未跟踪的新文章正文进入提示上下文');
  assert(!selected.includes('GRAMMA_UNRELATED_EDIT'), '未勾选的已跟踪改动不会混入提示上下文');

  const both = diffForPrompt(repo, [
    'posts/memgpt-reading-notes.md',
    'posts/gramma-reading-notes.md',
  ]);
  assert(both.includes('MEMGPT_NEW_ARTICLE_CONTENT') && both.includes('GRAMMA_UNRELATED_EDIT'), '同时勾选时两类改动都会纳入');
  console.log('\n提交上下文测试通过');
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
}