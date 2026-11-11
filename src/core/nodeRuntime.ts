import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface NodeRuntime {
  node: string;
  npm: string;
  version: string;
  source: string;
}

export interface NodeRuntimeOptions {
  configured?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  probe?: (nodePath: string) => string | null;
}

interface Candidate {
  node: string;
  source: string;
}

function parseVersion(text: string): [number, number, number] | null {
  const m = text.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersion(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function readJson(file: string): { engines?: { node?: string } } | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as { engines?: { node?: string } };
  } catch {
    return null;
  }
}

function minimumNode(templateDir: string): [number, number, number] | null {
  const ranges = [
    readJson(path.join(templateDir, 'package.json'))?.engines?.node,
    readJson(path.join(templateDir, 'node_modules', 'astro', 'package.json'))?.engines?.node,
  ].filter((v): v is string => !!v);
  const mins = ranges
    .map((r) => r.match(/>=\s*v?(\d+)\.(\d+)\.(\d+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]);
  return mins.sort(compareVersion).at(-1) ?? null;
}

function probeVersion(node: string, probe?: (nodePath: string) => string | null): string | null {
  if (probe) return probe(node);
  const res = spawnSync(node, ['-v'], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
  });
  return res.status === 0 ? res.stdout.trim() : null;
}

function executable(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function fnmCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Candidate[] {
  const roots = [env.FNM_DIR, env.APPDATA && path.join(env.APPDATA, 'fnm'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'fnm')]
    .filter((v): v is string => !!v);
  const out: Candidate[] = [];
  for (const root of new Set(roots)) {
    const versionsDir = path.join(root, 'node-versions');
    let versions: fs.Dirent[] = [];
    try {
      versions = fs.readdirSync(versionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of versions) {
      if (!entry.isDirectory() || !entry.name.startsWith('v')) continue;
      const installation = path.join(versionsDir, entry.name, 'installation');
      const node = platform === 'win32'
        ? path.join(installation, 'node.exe')
        : path.join(installation, 'bin', 'node');
      if (executable(node)) out.push({ node, source: `fnm ${entry.name}` });
    }
  }
  return out.sort((a, b) => compareVersion(parseVersion(b.source.replace(/^fnm /, '')) ?? [0, 0, 0], parseVersion(a.source.replace(/^fnm /, '')) ?? [0, 0, 0]));
}

function candidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, configured?: string): Candidate[] {
  const nodeName = platform === 'win32' ? 'node.exe' : 'node';
  const out: Candidate[] = [];
  const add = (node: string | undefined, source: string) => {
    if (!node) return;
    const resolved = path.resolve(node);
    if (out.some((c) => c.node.toLowerCase() === resolved.toLowerCase())) return;
    out.push({ node: resolved, source });
  };
  if (configured) {
    const p = path.resolve(configured);
    add(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, nodeName) : p, '配置');
  }
  add(env.TOWARDS_LIGHT_NODE, 'TOWARDS_LIGHT_NODE');
  out.push(...fnmCandidates(env, platform));
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    add(path.join(dir, nodeName), 'PATH');
  }
  add(process.execPath, 'VS Code 扩展宿主');
  return out.filter((c) => executable(c.node));
}

/**
 * 找到能满足模板 Node 引擎的 Node/npm 组合。
 * npm.cmd 会优先使用同目录 node.exe;因此 PATH 里的新 node 不能抵消旧 npm 自带的旧 node。
 */
export function resolveNodeRuntime(templateDir: string, options: NodeRuntimeOptions = {}): NodeRuntime {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const minimum = minimumNode(templateDir);
  const npmName = platform === 'win32' ? 'npm.cmd' : 'npm';
  const checked: string[] = [];
  for (const candidate of candidates(env, platform, options.configured)) {
    const version = probeVersion(candidate.node, options.probe);
    const parsed = version ? parseVersion(version) : null;
    checked.push(`${candidate.source}: ${candidate.node}${version ? ` (${version})` : ' (无法执行)'}`);
    if (!parsed || (minimum && compareVersion(parsed, minimum) < 0)) continue;
    const dir = path.dirname(candidate.node);
    const npm = path.join(dir, npmName);
    return {
      node: candidate.node,
      npm: executable(npm) ? npm : npmName,
      version: version!,
      source: candidate.source,
    };
  }
  const need = minimum ? `>=${minimum.join('.')}` : '(未声明)';
  throw new Error(`没有找到满足模板要求的 Node.js ${need}。已检查:\n${checked.join('\n') || '(无)'}`);
}