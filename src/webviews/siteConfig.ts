import * as vscode from 'vscode';
import { readSiteConfig, updateSiteConfig } from '../core';
import { getProfile } from '../util';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

const FIELDS: { id: string; label: string; hint?: string; textarea?: boolean }[] = [
  { id: 'siteName', label: '站点名称' },
  { id: 'siteNameEn', label: '站点英文名', hint: '用于页脚等处的小字' },
  { id: 'author', label: '作者' },
  { id: 'bio', label: '签名(长)', textarea: true },
  { id: 'shortBio', label: '简介(短)', textarea: true, hint: '出现在页脚和首页介绍' },
  { id: 'email', label: '邮箱' },
  { id: 'siteUrl', label: '站点 URL', hint: '影响 RSS / canonical' },
  { id: 'avatar', label: '头像路径', hint: '如 /images/avatar.svg' },
  { id: 'avatarPosition', label: '头像裁切焦点', hint: 'object-position,竖向人像建议 center 30%' },
];

const MODES = ['writing', 'building', 'available', 'offline'] as const;

function body(): string {
  const parts = FIELDS.map((f) => {
    const input = f.textarea
      ? `<textarea id="${f.id}"></textarea>`
      : `<input type="text" id="${f.id}">`;
    return `<label class="f">${f.label}</label>${input}${f.hint ? `<div class="hint">${f.hint}</div>` : ''}`;
  });
  return `
<h1>站点信息</h1>
<div class="sub">写回当前档案的 site.ts,保留注释与格式;dev server 会热更新</div>
${parts.join('\n')}
<label class="f">当前状态</label>
<div class="row">
  <div>
    <select id="statusMode">
      ${MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}
    </select>
  </div>
  <div><input type="text" id="statusText" placeholder="状态描述,如:正在把这个博客迁到 Astro"></div>
</div>
<div class="error" id="error"></div>
<div class="ok" id="ok">已写回 site.ts</div>
<div class="actions"><button class="primary" id="submit">保存</button></div>
`;
}

function script(): string {
  const fieldIds = [...FIELDS.map((f) => f.id), 'statusMode', 'statusText'];
  return (
    SCRIPT_PREAMBLE +
    `
const FIELDS = ${JSON.stringify(fieldIds)};
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    for (const f of FIELDS) $(f).value = msg.values[f] ?? '';
  } else if (msg.type === 'saved') {
    $('ok').style.display = 'block';
    setTimeout(() => { $('ok').style.display = 'none'; }, 2500);
    showError('');
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
$('submit').addEventListener('click', () => {
  const values = {};
  for (const f of FIELDS) values[f] = $(f).value.trim();
  vscode.postMessage({ type: 'submit', values });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openSiteConfigForm(): void {
  const profile = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightSiteConfig',
    '站点信息',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  panel.webview.html = pageShell('站点信息', body(), script());
  panel.webview.onDidReceiveMessage((msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({ type: 'init', values: readSiteConfig(profile.siteFile) });
      } else if (msg.type === 'submit') {
        const changed = updateSiteConfig(profile.siteFile, msg.values);
        panel.webview.postMessage({ type: 'saved' });
        vscode.window.showInformationMessage(`site.ts 已更新(${changed} 个字段)`);
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
