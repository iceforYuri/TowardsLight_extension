import crypto from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { listServers, onDidChangeServers } from './preview';
import { getProfile, getTemplateDir } from './util';

/**
 * 侧边栏控制台:自绘 WebviewView,取代原生 TreeView。
 * 承载:当前档案/模板、预览控制(启动/停止/日志)、管理入口、新建文章。
 * 数据变化(server 启停、档案切换、文章增删)由 refresh() 重发状态。
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly onStateChanged?: () => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = createSidebarHtml();
    view.webview.onDidReceiveMessage((msg) => {
      const cmd = {
        switchProfile: 'towardsLight.switchProfile',
        selectTemplate: 'towardsLight.selectTemplateDir',
        startPreview: 'towardsLight.startPreview',
        showLog: 'towardsLight.showServerLog',
        openCenter: 'towardsLight.openPostsCenter',
        categories: 'towardsLight.addCategory',
        links: 'towardsLight.addLink',
        site: 'towardsLight.editSiteConfig',
        newPost: 'towardsLight.newPost',
      }[msg.type as string];
      if (cmd) void vscode.commands.executeCommand(cmd);
      else if (msg.type === 'stopServer') {
        void vscode.commands.executeCommand('towardsLight.stopServerAt', msg.port);
      } else if (msg.type === 'openUrl') {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });
    this.refresh();
  }

  refresh(): void {
    if (!this.view) return;
    let profile: { name: string; kind: string } | null = null;
    let template: string | null = null;
    try {
      const p = getProfile();
      profile = { name: path.basename(p.dir), kind: p.kind };
    } catch {
      /* 未绑定 */
    }
    try {
      template = path.basename(getTemplateDir());
    } catch {
      /* 未识别 */
    }
    const servers = listServers().map((s) => ({
      port: s.port,
      profile: path.basename(s.profileDir),
    }));
    void this.view.webview.postMessage({ type: 'state', profile, template, servers });
  }

  /** 订阅 server 变化(在 extension activate 里调用一次) */
  listenServers(): vscode.Disposable {
    return onDidChangeServers(() => this.refresh());
  }
}

export function sidebarHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root {
  --fg: var(--vscode-foreground);
  --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --muted: color-mix(in srgb, var(--fg) 58%, transparent);
  --faint: color-mix(in srgb, var(--fg) 38%, transparent);
  --line: color-mix(in srgb, var(--fg) 10%, transparent);
  --raise: color-mix(in srgb, var(--fg) 4%, transparent);
  --accent: var(--vscode-textLink-foreground, #bc6353);
  --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
  --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 10px 10px 24px; color: var(--fg); background: var(--bg);
  font-family: var(--vscode-font-family); font-size: 12px; line-height: 1.5; }
.sec { margin-top: 14px; }
.sec-t { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--accent); margin: 0 2px 6px; display: flex; align-items: center; gap: 8px; }
.sec-t::after { content: ''; flex: 1; height: 1px; background: var(--line); }

.row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px;
  cursor: pointer; transition: background 0.15s ease; }
.row:hover { background: var(--raise); }
.row .k { color: var(--muted); flex: none; }
.row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.row .tag { font-family: var(--mono); font-size: 10px; color: var(--faint); flex: none; }
.row .arr { color: var(--faint); flex: none; opacity: 0; transition: opacity 0.15s ease, transform 0.15s ease; }
.row:hover .arr { opacity: 1; transform: translateX(2px); }

.play { width: 100%; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px; border-radius: 9px; border: 1px solid var(--accent); background: var(--accent-soft);
  color: var(--accent); font: inherit; font-weight: 600; cursor: pointer;
  transition: filter 0.15s ease, transform 0.12s ease; }
.play:hover { filter: brightness(1.08); }
.play:active { transform: scale(0.98); }

.srv { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px;
  background: var(--raise); margin-top: 6px; font-family: var(--mono); font-size: 11px; }
.srv .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #3fb950); flex: none; }
.srv .p { font-weight: 600; }
.srv .pf { color: var(--faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srv button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font: inherit; padding: 2px 5px; border-radius: 5px; }
.srv button:hover { background: var(--raise); color: var(--fg); }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.grid button { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; font-size: 12px;
  cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; text-align: left; }
.grid button:hover { border-color: var(--accent); background: var(--accent-soft); }
.grid button .ic { color: var(--muted); flex: none; }
.grid button:hover .ic { color: var(--accent); }

.ghost { width: 100%; margin-top: 6px; padding: 7px; border: 1px dashed var(--line); border-radius: 8px;
  background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.ghost:hover { color: var(--accent); border-color: var(--accent); }
</style>
</head>
<body>
<div class="sec">
  <p class="sec-t">绑定</p>
  <div class="row" data-m="switchProfile"><span class="k">档案</span><span class="v" id="profileName">…</span><span class="tag" id="profileKind"></span><span class="arr">→</span></div>
  <div class="row" data-m="selectTemplate"><span class="k">模板</span><span class="v" id="templateName">…</span><span class="arr">→</span></div>
</div>

<div class="sec">
  <p class="sec-t">预览</p>
  <button class="play" data-m="startPreview">▶ 启动预览</button>
  <div id="servers"></div>
  <button class="ghost" data-m="showLog">查看日志</button>
</div>

<div class="sec">
  <p class="sec-t">管理</p>
  <div class="grid">
    <button data-m="openCenter"><span class="ic">▤</span>文章中心</button>
    <button data-m="categories"><span class="ic">▦</span>分类管理</button>
    <button data-m="links"><span class="ic">↗</span>链接管理</button>
    <button data-m="site"><span class="ic">⚙</span>站点信息</button>
  </div>
</div>

<div class="sec">
  <button class="play" data-m="newPost">＋ 新建文章</button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.querySelectorAll('[data-m]').forEach((el) =>
  el.addEventListener('click', () => vscode.postMessage({ type: el.dataset.m })),
);
window.addEventListener('message', (e) => {
  const { profile, template, servers } = e.data;
  document.getElementById('profileName').textContent = profile ? profile.name : '未绑定,点击选择';
  document.getElementById('profileKind').textContent = profile ? profile.kind : '';
  document.getElementById('templateName').textContent = template ?? '未识别,点击选择';
  document.getElementById('servers').innerHTML = (servers || [])
    .map((s) => '<div class="srv"><span class="dot"></span><span class="p">:' + s.port + '</span>'
      + '<span class="pf">' + s.profile + '</span>'
      + '<button data-open="' + s.port + '" title="在浏览器打开">打开</button>'
      + '<button data-stop="' + s.port + '" title="停止">✕</button></div>')
    .join('');
  document.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'openUrl', url: 'http://localhost:' + b.dataset.open + '/' }); }));
  document.querySelectorAll('[data-stop]').forEach((b) =>
    b.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'stopServer', port: Number(b.dataset.stop) }); }));
});
</script>
</body>
</html>`;
}

export function createSidebarHtml(): string {
  return sidebarHtml(crypto.randomBytes(16).toString('hex'));
}
