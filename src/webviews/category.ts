import * as vscode from 'vscode';
import { addCategory, readIcons } from '../core';
import { getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>新增分类</h1>
<p class="sub">写进 site.ts 的 categoryMeta;文章 frontmatter 里用同名 category 即归入。</p>

<section class="card">
  <label class="f">分类名 <span class="req">*</span></label>
  <input type="text" id="name" placeholder="如:读书" autofocus>

  ${ICON_PICKER_HTML}

  <label class="f">色调 <span class="req">*</span></label>
  <div class="tones">
    <div class="tone sel" data-tone="accent">
      <span class="sw" style="background:linear-gradient(135deg,#bc6353,#8f4a3e)"></span>
      <span><span class="tn">accent</span><span class="th">褐红系</span></span>
    </div>
    <div class="tone" data-tone="contrast">
      <span class="sw" style="background:linear-gradient(135deg,#5d827a,#3f5f58)"></span>
      <span><span class="tn">contrast</span><span class="th">青绿系</span></span>
    </div>
  </div>

  <label class="f">描述 <span class="req">*</span></label>
  <input type="text" id="description" placeholder="一句话说明这个分类装什么">

  <div class="preview-chip" id="previewChip">
    <span id="pcIcon"></span><span class="pc-name" id="pcName">分类名</span>
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
const TONE_COLOR = { accent: '#bc6353', contrast: '#5d827a' };
let tone = 'accent';
function syncPreview() {
  const name = $('name').value.trim() || '分类名';
  $('pcName').textContent = name;
  const body = (icons.find((i) => i.name === selectedIcon) || {}).body;
  $('pcIcon').innerHTML = body ? svgOf(body) : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  $('previewChip').style.borderColor = TONE_COLOR[tone];
  $('previewChip').style.boxShadow = '0 0 0 3px ' + TONE_COLOR[tone] + '22';
  $('previewChip').style.color = TONE_COLOR[tone];
}
function onIconChange() { syncPreview(); }
document.querySelectorAll('.tone').forEach((el) => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tone').forEach((t) => t.classList.remove('sel'));
    el.classList.add('sel');
    tone = el.dataset.tone;
    syncPreview();
  });
});
$('name').addEventListener('input', syncPreview);
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    icons = msg.icons;
    renderIcons();
    restoreState();
    syncPreview();
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
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('新增分类', body(), script(), panel.webview.cspSource);
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
