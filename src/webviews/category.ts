import * as vscode from 'vscode';
import { addCategory, readIcons } from '../core';
import { getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<h1>新增分类</h1>
<div class="sub">写进 site.ts 的 categoryMeta;文章 frontmatter 里用同名 category 即归入</div>

<label class="f">分类名 <span class="req">*</span></label>
<input type="text" id="name" placeholder="如:读书" autofocus>

${ICON_PICKER_HTML}

<label class="f">色调 <span class="req">*</span></label>
<div class="tones">
  <div class="tone sel" data-tone="accent">accent<span class="hint" style="display:block">褐红系</span></div>
  <div class="tone" data-tone="contrast">contrast<span class="hint" style="display:block">青绿系</span></div>
</div>

<label class="f">描述 <span class="req">*</span></label>
<input type="text" id="description" placeholder="一句话说明这个分类装什么">

<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">添加</button></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    ICON_PICKER_SCRIPT +
    `
let tone = 'accent';
document.querySelectorAll('.tone').forEach((el) => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tone').forEach((t) => t.classList.remove('sel'));
    el.classList.add('sel');
    tone = el.dataset.tone;
  });
});
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    icons = msg.icons;
    renderIcons();
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
$('submit').addEventListener('click', () => {
  showError('');
  vscode.postMessage({
    type: 'submit',
    value: {
      name: $('name').value.trim(),
      icon: $('iconValue').value,
      tone,
      description: $('description').value.trim(),
    },
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openCategoryForm(): void {
  const profile = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightCategory',
    '新增分类',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  panel.webview.html = pageShell('新增分类', body(), script());
  panel.webview.onDidReceiveMessage((msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({ type: 'init', icons: readIcons(profile.iconFile) });
      } else if (msg.type === 'submit') {
        const v = msg.value;
        if (!v.name) throw new Error('分类名不能为空');
        if (!v.icon) throw new Error('请选一个图标');
        if (!v.description) throw new Error('描述不能为空');
        addCategory(profile.siteFile, v);
        panel.dispose();
        vscode.window.showInformationMessage(`分类「${v.name}」已加入 site.ts`);
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
