/**
 * git 执行层(host 侧,child_process 同步调用):
 * 探测目录所属仓库、读工作区状态/diff/提交记录、执行选择性提交与推送。
 * 所有命令带超时并禁用凭据交互(GIT_TERMINAL_PROMPT=0)——要密码就失败,绝不挂死。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TIMEOUT = 15_000;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[], input?: string, timeout = DEFAULT_TIMEOUT): GitResult {
  try {
    const res = spawnSync('git', args, {
      cwd,
      input,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (res.error) return { ok: false, stdout: '', stderr: res.error.message };
    return { ok: res.status === 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: (e as Error).message };
  }
}

/** dir 向上所属的 git 仓库根;不在任何仓库里返回 null */
export function findRepoRoot(dir: string): string | null {
  const res = runGit(dir, ['rev-parse', '--show-toplevel']);
  if (!res.ok) return null;
  const root = res.stdout.trim();
  return root ? path.normalize(root) : null;
}

export interface RepoInfo {
  root: string;
  /** 显示名:仓库目录 basename */
  name: string;
  branch: string;
  hasRemote: boolean;
}

export function repoInfo(root: string): RepoInfo {
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = runGit(root, ['remote']);
  return {
    root,
    name: path.basename(root),
    branch: branch.ok ? branch.stdout.trim() : '',
    hasRemote: remote.ok && !!remote.stdout.trim(),
  };
}

/** 从候选目录探测不重复的 git 仓库,保持传入顺序(调用方把档案目录放最前) */
export function detectRepos(dirs: (string | null | undefined)[]): RepoInfo[] {
  const seen = new Set<string>();
  const out: RepoInfo[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const root = findRepoRoot(dir);
    if (!root || seen.has(root.toLowerCase())) continue;
    seen.add(root.toLowerCase());
    out.push(repoInfo(root));
  }
  return out;
}

export interface ChangedFile {
  /** 相对仓库根的路径(git 输出即正斜杠) */
  file: string;
  /** porcelain 两字母状态:' M'=未暂存修改,'M '=已暂存,'??'=未跟踪,' D'=已删除… */
  xy: string;
}

/** 工作区变更清单;关掉 rename 识别,保证每条记录都是「XY path」单路径 */
export function statusFiles(root: string): ChangedFile[] {
  const res = runGit(root, ['-c', 'status.renames=false', 'status', '--porcelain', '-z']);
  if (!res.ok) return [];
  const out: ChangedFile[] = [];
  for (const rec of res.stdout.split('\0')) {
    if (rec.length < 4) continue;
    out.push({ xy: rec.slice(0, 2), file: rec.slice(3) });
  }
  return out;
}

/** 喂给模型的 diff:相对 HEAD(含未暂存),截断到 max 字符;空仓库(无 HEAD)退化到已暂存区 */
export function diffForPrompt(root: string, max = 8000): string {
  let res = runGit(root, ['diff', 'HEAD', '--']);
  if (!res.ok) res = runGit(root, ['diff', '--cached', '--']);
  let diff = res.ok ? res.stdout.trim() : '';
  if (diff.length > max) diff = diff.slice(0, max) + '\n…(diff 过长,已截断)';
  return diff;
}

/** 最近 n 条提交标题,作为 AI 生成提交信息的风格样例;空仓库返回 [] */
export function recentLog(root: string, n = 10): string[] {
  const res = runGit(root, ['log', `-${n}`, '--pretty=%s']);
  if (!res.ok) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 选择性提交:未跟踪文件先 add 让 git 认识,再用 pathspec 提交(git commit -F - -- <files>)。
 * pathspec 提交只取选中文件的工作区内容,别处在暂存区里的改动不会被卷进来;
 * message 走 stdin,多行与引号无需转义。失败抛中文错。
 */
export function commit(root: string, files: string[], message: string): string {
  const selected = statusFiles(root).filter((f) => files.includes(f.file));
  if (!selected.length) throw new Error('选中的文件已不在变更列表里,请刷新后重试');
  const untracked = selected.filter((f) => f.xy === '??').map((f) => f.file);
  if (untracked.length) {
    const add = runGit(root, ['add', '--', ...untracked]);
    if (!add.ok) throw new Error(`git add 失败:${add.stderr.trim() || '未知原因'}`);
  }
  const res = runGit(root, ['commit', '-F', '-', '--', ...selected.map((f) => f.file)], message);
  if (!res.ok) {
    throw new Error(`git commit 失败:${res.stderr.trim() || res.stdout.trim() || '未知原因'}`);
  }
  return res.stdout.trim();
}

/** 推送当前分支;网络较慢,超时放宽到 60s。失败把 stderr 抛给用户 */
export function push(root: string): string {
  const res = runGit(root, ['push'], undefined, 60_000);
  if (!res.ok) {
    throw new Error(`git push 失败:${res.stderr.trim() || '远端拒绝或需要登录凭据'}`);
  }
  return res.stderr.trim() || res.stdout.trim(); // push 的进度信息走 stderr
}
