import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import * as vscode from 'vscode';
import { getProfile, workspaceRoot } from './util';

let server: ChildProcess | null = null;
let serverPort: number | null = null;
const panels = new Map<string, vscode.WebviewPanel>();

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

/** 已在跑的 dev server 直接复用;否则拉起 npm run dev(predev 会自动切换档案) */
async function ensureServer(root: string, preferredPort: number): Promise<number> {
  if (serverPort && (await ping(serverPort))) return serverPort;
  if (await ping(preferredPort)) {
    serverPort = preferredPort;
    return preferredPort;
  }
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  server = spawn(cmd, ['run', 'dev'], { cwd: root });
  let detected: number | null = null;
  server.stdout?.on('data', (d: Buffer) => {
    const m = String(d).match(/localhost:(\d+)/);
    if (m) detected = Number(m[1]);
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port: number | null = detected;
    if (port && (await ping(port))) {
      serverPort = port;
      return port;
    }
    if (await ping(preferredPort)) {
      serverPort = preferredPort;
      return preferredPort;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev server 启动超时(30s),请检查终端里的 astro dev 输出');
}

export async function openPostPreview(file: string | undefined): Promise<void> {
  const profile = getProfile();
  if (!file || !file.endsWith('.md')) {
    vscode.window.showInformationMessage('先在文章树里选一篇文章,或打开一篇 .md');
    return;
  }
  const slug = path.basename(file).replace(/\.md$/, '');
  const preferredPort = vscode.workspace
    .getConfiguration('towardsLight')
    .get<number>('devPort', 4321);
  const port = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在连接 dev server…' },
    () => ensureServer(workspaceRoot(), preferredPort),
  );

  const existing = panels.get(slug);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'towardsLightPreview',
    `预览:${slug}`,
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
<body><iframe src="http://localhost:${port}/posts/${slug}"></iframe></body>
</html>`;
  panel.onDidDispose(() => panels.delete(slug));
  panels.set(slug, panel);
}

/** 扩展停用时,只回收自己拉起的 dev server;检测到别人在跑就不动 */
export function disposeServer(): void {
  if (!server) return;
  if (process.platform === 'win32' && server.pid) {
    spawn('taskkill', ['/pid', String(server.pid), '/t', '/f']);
  } else {
    server.kill();
  }
  server = null;
  serverPort = null;
}
