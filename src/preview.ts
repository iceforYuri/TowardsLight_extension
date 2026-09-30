import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import * as vscode from 'vscode';
import { getProfile, getTemplateDir } from './util';

/** 一个运行中的预览 server 的账本记录 */
export interface ServerRec {
  proc: ChildProcess;
  port: number;
  templateDir: string;
  profileDir: string;
  startedAt: number;
}

const servers: ServerRec[] = [];
const panels = new Map<string, vscode.WebviewPanel>();
/** server 列表变化时通知预览区刷新 */
const emitter = new vscode.EventEmitter<void>();
export const onDidChangeServers = emitter.event;

export function listServers(): ServerRec[] {
  return servers;
}

async function ping(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

function kill(rec: ServerRec): void {
  if (process.platform === 'win32' && rec.proc.pid) {
    spawn('taskkill', ['/pid', String(rec.proc.pid), '/t', '/f']);
  } else {
    rec.proc.kill();
  }
}

export function stopServer(rec: ServerRec): void {
  kill(rec);
  const i = servers.indexOf(rec);
  if (i >= 0) servers.splice(i, 1);
  emitter.fire();
}

/**
 * 启动预览:同组合(模板+档案)的 server 还活着就直接复用;
 * 否则从配置端口起向后找空闲端口,在模板目录 spawn npm run dev。
 * 只复用自己记账的 server,不动用户终端里手动起的。
 */
export async function startPreview(): Promise<ServerRec> {
  const templateDir = getTemplateDir();
  const profile = getProfile();

  const existing = servers.find(
    (s) => s.templateDir === templateDir && s.profileDir === profile.dir,
  );
  if (existing && (await ping(existing.port))) return existing;
  if (existing) stopServer(existing);

  const preferred = vscode.workspace
    .getConfiguration('towardsLight')
    .get<number>('devPort', 4321);
  let port = preferred;
  while (await ping(port)) port++; // 被未知进程占用就顺延

  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(cmd, ['run', 'dev', '--', '--port', String(port)], {
    cwd: templateDir,
    env: { ...process.env, SITE_PROFILE_DIR: profile.dir },
  });
  const rec: ServerRec = { proc, port, templateDir, profileDir: profile.dir, startedAt: Date.now() };
  proc.on('exit', () => {
    const i = servers.indexOf(rec);
    if (i >= 0) servers.splice(i, 1);
    emitter.fire();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await ping(port)) {
      servers.push(rec);
      emitter.fire();
      return rec;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  kill(rec);
  throw new Error('dev server 启动超时(30s),请检查终端里的 astro dev 输出');
}

/** 通用 iframe 预览面板 */
function openPanel(key: string, title: string, port: number, route: string): void {
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'towardsLightPreview',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true },
  );
  panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:*; style-src 'unsafe-inline';">
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body><iframe src="http://localhost:${port}${route}"></iframe></body>
</html>`;
  panel.onDidDispose(() => panels.delete(key));
  panels.set(key, panel);
}

/** 预览整站首页 */
export async function openSitePreview(rec: ServerRec): Promise<void> {
  openPanel('site', `预览:${path.basename(rec.profileDir)}`, rec.port, '/');
}

export async function openPostPreview(file: string | undefined): Promise<void> {
  if (!file || !file.endsWith('.md')) {
    vscode.window.showInformationMessage('先在文章树里选一篇文章,或打开一篇 .md');
    return;
  }
  const slug = path.basename(file).replace(/\.md$/, '');
  const rec = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在连接 dev server…' },
    () => startPreview(),
  );
  openPanel(`post:${slug}`, `预览:${slug}`, rec.port, `/posts/${slug}`);
}

/** 扩展停用时回收所有自己拉起的 server */
export function disposeServer(): void {
  for (const rec of [...servers]) kill(rec);
  servers.length = 0;
  emitter.fire();
}
