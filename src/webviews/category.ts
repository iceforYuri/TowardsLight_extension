import * as vscode from 'vscode';
import { addCategory, deleteCategory, listPosts, readCategories, readIcons, renameCategory, updateCategory } from '../core';
import { assertProfileUnchanged, getProfile } from '../util';
import { ICON_PICKER_HTML, ICON_PICKER_SCRIPT, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>管理分类</h1>
<p class="sub">写进 site.ts 的 categoryMeta;文章 frontmatter 里用同名 category 即归入。文章在用但没登记的分类也会列出,可一键补登记。</p>

<section class="card">
  <label class="f">选择分类</label>
  <select id="mode">
    <option value="__new__">＋ 新建分类</option>
  </select>
  <div class="hint" id="modeHint"></div>

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
    <div class="tone" data-tone="steel">
      <span class="sw" style="background:linear-gradient(135deg,#3472a1,#245380)"></span>
      <span><span class="tn">steel</span><span class="th">钢蓝系</span></span>
    </div>
  </div>

  <label class="f">描述 <span class="req">*</span></label>
  <input type="text" id="description" placeholder="一句话说明这个分类装什么">

  <div id="renameRow" style="display:none">
    <label class="f">改名为</label>
    <input type="text" id="renameTo" placeholder="留空则不改名">
    <div class="hint" id="refHint"></div>
  </div>

  <div class="preview-chip" id="previewChip">
    <span id="pcIcon"></span><span class="pc-name" id="pcName">分类名</span>
  </div>
</section>

<div class="error" id="error"></div>
<div class="actions">
  <button class="primary" id="submit">添加</button>
  <button class="small danger" id="delete" style="display:none">删除分类</button>
</div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    ICON_PICKER_SCRIPT +
    `
const TONE_COLOR = { accent: '#bc6353', contrast: '#5d827a', steel: '#3472a1' };
let categories = [];
let refCounts = {};
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
  const opt = $('mode').selectedOptions[0];
  const isUnreg = !!(opt && opt.dataset.unreg);
  const isEdit = editing() && !isUnreg;
  $('name').disabled = isEdit || isUnreg;
  $('submit').textContent = isEdit ? '保存修改' : isUnreg ? '登记该分类' : '添加';
  $('renameRow').style.display = isEdit ? 'block' : 'none';
  $('delete').style.display = isEdit ? '' : 'none';
  if (isUnreg) {
    // 文章在用但未登记进 site.ts 的分类:锁定名字,补登记后即可配置图标/色调/描述
    $('name').value = $('mode').value;
    $('description').value = '';
    $('renameTo').value = '';
    selectedIcon = '';
    $('iconValue').value = '';
    setTone('accent');
    renderIcons();
    $('modeHint').textContent = '正被 ' + (refCounts[$('mode').value] ?? 0) + ' 篇文章使用,但还没登记进 site.ts';
  } else if (isEdit) {
    $('modeHint').textContent = '';
    const name = $('mode').value;
    const c = categories.find((x) => x.name === name);
    const refs = refCounts[name] ?? 0;
    const locked = refs > 0;
    $('renameTo').disabled = locked;
    $('delete').disabled = locked;
    $('refHint').textContent = locked
      ? refs + ' 篇文章正在引用此分类,改名与删除不可用'
      : '无文章引用,可改名或删除';
    if (c) {
      $('name').value = c.name;
      $('description').value = c.description;
      selectedIcon = c.icon;
      $('iconValue').value = c.icon;
      setTone(c.tone || 'accent');
      renderIcons();
    }
  } else {
    $('modeHint').textContent = '';
    $('name').value = '';
    $('description').value = '';
    $('renameTo').value = '';
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
    refCounts = msg.refCounts ?? {};
    const sel = $('mode');
    sel.querySelectorAll('option[data-cat]').forEach((o) => o.remove());
    for (const c of categories) {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + ((refCounts[c.name] ?? 0) > 0 ? '(' + refCounts[c.name] + ' 篇)' : '');
      o.dataset.cat = '1';
      sel.appendChild(o);
    }
    // 文章在用但没登记进 site.ts 的分类:列出来,选中即进入补登记模式
    for (const name of msg.unregistered || []) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name + '(未登记 · ' + (refCounts[name] ?? 0) + ' 篇)';
      o.dataset.cat = '1';
      o.dataset.unreg = '1';
      sel.appendChild(o);
    }
    renderIcons();
    restoreState();
    applyMode();
  } else if (msg.type === 'saved') {
    vscode.setState({});
    toast(msg.mode === 'edit' ? '分类已更新' : msg.mode === 'delete' ? '分类已删除' : '分类已加入 site.ts');
    showError('');
    if (msg.mode !== 'edit') {
      $('mode').value = '__new__';
    }
    applyMode();
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});

$('submit').addEventListener('click', () => {
  showError('');
  const opt = $('mode').selectedOptions[0];
  // 未登记分类走 create(登记进 site.ts),不是 edit
  const isEdit = editing() && !(opt && opt.dataset.unreg);
  vscode.postMessage({
    type: 'submit',
    mode: isEdit ? 'edit' : 'create',
    value: {
      name: $('name').value.trim(),
      renameTo: $('renameTo').value.trim(),
      icon: $('iconValue').value,
      tone,
      description: $('description').value.trim(),
    },
  });
});
$('delete').addEventListener('click', () => {
  showError('');
  vscode.postMessage({ type: 'submit', mode: 'delete', value: { name: $('mode').value } });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

let panel: vscode.WebviewPanel | undefined;
let profile: ReturnType<typeof getProfile> | undefined;

function renderShell(): void {
  if (!panel || !profile) return;
  panel.webview.html = pageShell(
    '管理分类',
    body(),
    script(),
    panel.webview.cspSource,
    profile.dir.split(/[\\/]/).pop() ?? '',
  );
}

function sendInit(): void {
  if (!panel || !profile) return;
  const refCounts: Record<string, number> = {};
  for (const p of listPosts(profile.postsDir)) {
    if (p.category) refCounts[p.category] = (refCounts[p.category] ?? 0) + 1;
  }
  const categories = readCategories(profile.siteFile);
  // 文章在用但没登记进 site.ts 的分类:也列进面板,让「直接用」与「登记元数据」不脱节
  const registered = new Set(categories.map((c) => c.name));
  const unregistered = Object.keys(refCounts)
    .filter((c) => !registered.has(c))
    .sort();
  void panel.webview.postMessage({
    type: 'init',
    icons: readIcons(profile.iconFile),
    categories,
    refCounts,
    unregistered,
  });
}

export function openCategoryForm(): void {
  if (panel) {
    try {
      const now = getProfile();
      if (profile && now.dir !== profile.dir) {
        profile = now;
        renderShell();
      }
    } catch {
      /* 未绑定 */
    }
    panel.reveal();
    return;
  }
  profile = getProfile();
  panel = vscode.window.createWebviewPanel(
    'towardsLightCategory',
    '管理分类',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  renderShell();
  panel.onDidDispose(() => {
    panel = undefined;
    profile = undefined;
  });
  panel.webview.onDidReceiveMessage((msg) => {
    if (!panel || !profile) return;
    const p = panel;
    const prof = profile;
    try {
      if (msg.type === 'ready') {
        sendInit();
      } else if (msg.type === 'refresh') {
        profile = getProfile();
        renderShell();
      } else if (msg.type === 'submit') {
        assertProfileUnchanged(prof);
        const v = msg.value;
        const countRefs = (name: string) =>
          listPosts(prof.postsDir).filter((x) => x.category === name).length;
        if (msg.mode === 'delete') {
          const refs = countRefs(v.name);
          if (refs > 0) throw new Error(`「${v.name}」还有 ${refs} 篇文章引用,不能删除`);
          deleteCategory(prof.siteFile, v.name);
          sendInit();
          p.webview.postMessage({ type: 'saved', mode: 'delete' });
          return;
        }
        if (!v.name) throw new Error('分类名不能为空');
        if (!v.icon) throw new Error('请选一个图标');
        if (!v.description) throw new Error('描述不能为空');
        if (msg.mode === 'edit') {
          if (v.renameTo && v.renameTo !== v.name) {
            const refs = countRefs(v.name);
            if (refs > 0) throw new Error(`「${v.name}」还有 ${refs} 篇文章引用,不能改名`);
            renameCategory(prof.siteFile, v.name, v.renameTo);
          }
          updateCategory(prof.siteFile, v.renameTo || v.name, {
            icon: v.icon,
            tone: v.tone,
            description: v.description,
          });
        } else {
          addCategory(prof.siteFile, v);
        }
        sendInit();
        p.webview.postMessage({ type: 'saved', mode: msg.mode });
      }
    } catch (e) {
      p.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
