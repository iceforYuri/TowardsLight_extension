import * as vscode from 'vscode';
import { addLink, readIcons, readLinkGroups } from '../core';
import { getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';

function body(): string {
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>新增链接</h1>
<p class="sub">追加到 links.ts 的 techLinks;选「新建分组」会一并补进 linkGroups。</p>

<section class="card">
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
  <div id="newGroupRow" style="display:none;margin-top:8px" class="row">
    <div>
      <input type="text" id="newGroupId" placeholder="分组 id,英文小写,如 reading">
      <div class="hint">id 会进类型定义,只能小写字母/数字/连字符</div>
    </div>
    <div><input type="text" id="newGroupLabel" placeholder="显示名,如 Reading"></div>
  </div>

  ${ICON_PICKER_HTML}
  <div class="hint">图标可选,不选就用默认链接样式</div>

  <label class="f">状态文字</label>
  <input type="text" id="status" placeholder="可选,如:每天使用 / 本站使用">

  <div class="checks">
    <label class="check-card"><input type="checkbox" id="external" checked><span class="box">${CHECK_SVG}</span>外部链接(显示 ↗)</label>
    <label class="check-card"><input type="checkbox" id="featured"><span class="box">${CHECK_SVG}</span>重点链接(首页展示)</label>
  </div>
</section>

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
      o.value = g.id;
      o.textContent = g.label + ' · ' + g.id;
      sel.appendChild(o);
    }
    const create = document.createElement('option');
    create.value = '__new__';
    create.textContent = '＋ 新建分组…';
    sel.appendChild(create);
    restoreState();
    $('newGroupRow').style.display = $('group').value === '__new__' ? 'block' : 'none';
  } else if (msg.type === 'saved') {
    vscode.setState({});
    toast('链接已加入 links.ts');
    showError('');
    $('title').value = '';
    $('href').value = '';
    $('description').value = '';
    $('status').value = '';
    $('featured').checked = false;
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
$('group').addEventListener('change', (e) => {
  $('newGroupRow').style.display = e.target.value === '__new__' ? 'block' : 'none';
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
      group: isNew ? $('newGroupId').value.trim() : $('group').value,
      groupLabel: isNew ? $('newGroupLabel').value.trim() : undefined,
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
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('新增链接', body(), script(), panel.webview.cspSource);
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
        if (v.groupLabel !== undefined) {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(v.group)) {
            throw new Error('分组 id 只能是小写字母、数字和连字符');
          }
          if (!v.groupLabel) throw new Error('新分组需要显示名');
        }
        addLink(profile.linksFile, v);
        panel.webview.postMessage({ type: 'saved' });
        vscode.window.showInformationMessage(`链接「${v.title}」已加入 links.ts`);
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
