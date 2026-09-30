import * as vscode from 'vscode';
import { addCategory, readCategories, readIcons, updateCategory } from '../core';
import { getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>管理分类</h1>
<p class="sub">写进 site.ts 的 categoryMeta;文章 frontmatter 里用同名 category 即归入。分类名是文章的归属 key,创建后不可改。</p>

<section class="card">
  <label class="f">选择分类</label>
  <select id="mode">
    <option value="__new__">＋ 新建分类</option>
  </select>

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
let categories = [];
let tone = 'accent';

function setTone(t) {
  tone = t;
  document.querySelectorAll('.tone').forEach((el) => el.classList.toggle('sel', el.dataset.tone === t));
  syncPreview();
}
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

function editing() { return $('mode').value !== '__new__'; }
function applyMode() {
  const isEdit = editing();
  $('name').disabled = isEdit;
  $('submit').textContent = isEdit ? '保存修改' : '添加';
  if (isEdit) {
    const c = categories.find((x) => x.name === $('mode').value);
    if (c) {
      $('name').value = c.name;
      $('description').value = c.description;
      selectedIcon = c.icon;
      $('iconValue').value = c.icon;
      setTone(c.tone || 'accent');
      renderIcons();
    }
  } else {
    $('name').value = '';
    $('description').value = '';
    selectedIcon = '';
    $('iconValue').value = '';
    setTone('accent');
    renderIcons();
  }
  syncPreview();
}

document.querySelectorAll('.tone').forEach((el) => {
  el.addEventListener('click', () => setTone(el.dataset.tone));
});
$('name').addEventListener('input', syncPreview);
$('mode').addEventListener('change', applyMode);

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    icons = msg.icons;
    categories = msg.categories;
    const sel = $('mode');
    sel.querySelectorAll('option[data-cat]').forEach((o) => o.remove());
    for (const c of categories) {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name;
      o.dataset.cat = '1';
      sel.appendChild(o);
    }
    renderIcons();
    restoreState();
    applyMode();
  } else if (msg.type === 'saved') {
    toast(msg.mode === 'edit' ? '分类已更新' : '分类已加入 site.ts');
    showError('');
    if (msg.mode === 'create') {
      $('mode').value = '__new__';
      applyMode();
    }
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});

$('submit').addEventListener('click', () => {
  showError('');
  vscode.postMessage({
    type: 'submit',
    mode: editing() ? 'edit' : 'create',
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
    '管理分类',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('管理分类', body(), script(), panel.webview.cspSource);
  const sendInit = () =>
    panel.webview.postMessage({
      type: 'init',
      icons: readIcons(profile.iconFile),
      categories: readCategories(profile.siteFile),
    });
  panel.webview.onDidReceiveMessage((msg) => {
    try {
      if (msg.type === 'ready') {
        void sendInit();
      } else if (msg.type === 'submit') {
        const v = msg.value;
        if (!v.name) throw new Error('分类名不能为空');
        if (!v.icon) throw new Error('请选一个图标');
        if (!v.description) throw new Error('描述不能为空');
        if (msg.mode === 'edit') {
          updateCategory(profile.siteFile, v.name, {
            icon: v.icon,
            tone: v.tone,
            description: v.description,
          });
        } else {
          addCategory(profile.siteFile, v);
        }
        void sendInit();
        panel.webview.postMessage({ type: 'saved', mode: msg.mode });
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
