import * as vscode from 'vscode';
import { addLink, readIcons, readLinkGroups } from '../core';
import { getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<h1>新增链接</h1>
<div class="sub">追加到 links.ts 的 techLinks;选「新建分组」会一并补进 linkGroups</div>

<div class="row">
  <div>
    <label class="f">名称 <span class="req">*</span></label>
    <input type="text" id="title" placeholder="如:GitHub" autofocus>
  </div>
  <div>
    <label class="f">URL <span class="req">*</span></label>
    <input type="url" id="href" placeholder="https://…">
  </div>
</div>

<label class="f">一句话说明 <span class="req">*</span></label>
<input type="text" id="description">

<label class="f">分组 <span class="req">*</span></label>
<select id="group"></select>
<input type="text" id="newGroup" placeholder="新分组名,如:Reading" style="display:none;margin-top:6px">

${ICON_PICKER_HTML}
<div class="hint">图标可选,不选就用默认链接样式</div>

<label class="f">状态文字</label>
<input type="text" id="status" placeholder="可选,如:每天使用 / 本站使用">

<div class="checks">
  <label><input type="checkbox" id="external" checked> 外部链接(显示 ↗)</label>
  <label><input type="checkbox" id="featured"> 重点链接(首页展示)</label>
</div>

<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">添加</button></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    ICON_PICKER_SCRIPT +
    `
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    icons = [{ name: '', body: '' }].concat(msg.icons);
    renderIcons();
    const sel = $('group');
    for (const g of msg.groups) {
      const o = document.createElement('option');
      o.value = g;
      o.textContent = g;
      sel.appendChild(o);
    }
    const create = document.createElement('option');
    create.value = '__new__';
    create.textContent = '＋ 新建分组…';
    sel.appendChild(create);
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
$('group').addEventListener('change', (e) => {
  $('newGroup').style.display = e.target.value === '__new__' ? 'block' : 'none';
});
$('submit').addEventListener('click', () => {
  showError('');
  const isNew = $('group').value === '__new__';
  vscode.postMessage({
    type: 'submit',
    value: {
      title: $('title').value.trim(),
      href: $('href').value.trim(),
      description: $('description').value.trim(),
      group: isNew ? $('newGroup').value.trim() : $('group').value,
      icon: $('iconValue').value || undefined,
      external: $('external').checked,
      featured: $('featured').checked,
      status: $('status').value.trim() || undefined,
    },
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openLinkForm(): void {
  const profile = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightLink',
    '新增链接',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  panel.webview.html = pageShell('新增链接', body(), script());
  panel.webview.onDidReceiveMessage((msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({
          type: 'init',
          icons: readIcons(profile.iconFile),
          groups: readLinkGroups(profile.linksFile),
        });
      } else if (msg.type === 'submit') {
        const v = msg.value;
        if (!v.title) throw new Error('名称不能为空');
        if (!v.href) throw new Error('URL 不能为空');
        if (!v.description) throw new Error('说明不能为空');
        if (!v.group) throw new Error('分组不能为空');
        addLink(profile.linksFile, v);
        panel.dispose();
        vscode.window.showInformationMessage(`链接「${v.title}」已加入 links.ts`);
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
