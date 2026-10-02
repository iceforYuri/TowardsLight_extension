import * as vscode from 'vscode';
import { listPosts, setPostDraft } from '../core';
import { openPostPreview } from '../preview';
import { getProfile, assertProfileUnchanged, openFile, resolveImageUri } from '../util';
import { openNewPostForm } from './newPost';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

let panel: vscode.WebviewPanel | undefined;
let openedProfile: ReturnType<typeof getProfile> | undefined;

function body(): string {
  return `
<style>
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar input[type="search"] { flex: 1; min-width: 180px; }
.toolbar select { min-width: 108px; }
.toolbar .count { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-left: auto; }

.batchbar { display: none; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 12px;
  border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft);
  font-size: 12.5px; position: sticky; top: 8px; z-index: 20; }
.batchbar.on { display: flex; }
.batchbar .n { font-family: var(--mono); font-weight: 600; color: var(--accent); }

.plist { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.prow { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-top: 1px solid var(--line);
  background: var(--bg); transition: background 0.15s var(--ease); }
.prow:first-child { border-top: 0; }
.prow:hover { background: var(--raise); }
.prow.selected { background: var(--accent-soft); }
.prow .ck { width: 15px; height: 15px; accent-color: var(--accent); flex: none; cursor: pointer; }
.prow .thumb { width: 46px; height: 46px; border-radius: 8px; object-fit: cover; flex: none;
  border: 1px solid var(--line); background: var(--raise); }
.prow .thumb.none { display: grid; place-items: center; color: var(--faint); font-family: var(--mono); font-size: 10px; }
.pmain { flex: 1; min-width: 0; }
.ptitle { font-size: 13.5px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.ptitle .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdesc { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.pmeta { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmeta .cat { color: var(--muted); }
.pstatus { font-family: var(--mono); font-size: 10.5px; padding: 2px 9px; border-radius: 99px; flex: none; }
.pstatus.draft { color: #b07a2f; background: color-mix(in srgb, #b07a2f 12%, transparent); border: 1px solid color-mix(in srgb, #b07a2f 40%, transparent); }
.pstatus.pub { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); }
.pstatus.bad { color: var(--err); background: color-mix(in srgb, var(--err) 10%, transparent); border: 1px solid color-mix(in srgb, var(--err) 35%, transparent); }
.pops { display: flex; gap: 4px; flex: none; }
.pops button { font-size: 11.5px; padding: 4px 10px; }
.pempty { padding: 42px 0; text-align: center; color: var(--muted); font-size: 12.5px; }
</style>

<div class="kicker">Towards Light · Studio</div>
<h1>文章中心</h1>
<p class="sub">当前档案的全部文章。勾选后可批量发布、转草稿或删除(回收站,可恢复)。</p>

<div class="toolbar">
  <input type="search" id="q" placeholder="搜索标题 / 描述 / 标签…" aria-label="搜索文章">
  <select id="fStatus" aria-label="按状态筛选">
    <option value="">全部状态</option><option value="pub">已发布</option><option value="draft">草稿</option>
  </select>
  <select id="fCat" aria-label="按分类筛选"><option value="">全部分类</option></select>
  <span class="count" id="count"></span>
  <button class="primary" id="newPost">新建文章</button>
</div>

<div class="batchbar" id="batchbar">
  <span class="n" id="batchN">0</span> 篇已选
  <button class="small" data-bact="pub">设为发布</button>
  <button class="small" data-bact="draft">转为草稿</button>
  <button class="small danger" data-bact="del">删除</button>
  <button class="small" data-bact="clear" style="margin-left:auto">取消选择</button>
</div>
<div class="error" id="error"></div>

<div class="plist" id="list"></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
let posts = [];
let thumbs = {};
const sel = new Set();

function escLocal(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const st = $('fStatus').value;
  const cat = $('fCat').value;
  return posts.filter((p) => {
    if (st && (st === 'draft') !== p.draft) return false;
    if (cat && p.category !== cat) return false;
    if (!q) return true;
    const hay = (p.title + ' ' + p.description + ' ' + p.tags.join(' ') + ' ' + p.slug).toLowerCase();
    return q.split(/\\s+/).every((w) => hay.includes(w));
  });
}

function statusBadge(p) {
  if (!p.valid) return '<span class="pstatus bad">异常</span>';
  return p.draft ? '<span class="pstatus draft">草稿</span>' : '<span class="pstatus pub">已发布</span>';
}

function rowHtml(p) {
  const thumb = thumbs[p.file]
    ? '<img class="thumb" src="' + thumbs[p.file] + '" alt="">'
    : '<span class="thumb none">—</span>';
  const meta = [p.pubDate, p.updatedDate && '更 ' + p.updatedDate].filter(Boolean).join(' · ');
  const tags = p.tags.slice(0, 4).map((t) => '#' + t).join(' ');
  return '<div class="prow' + (sel.has(p.file) ? ' selected' : '') + '" data-file="' + escLocal(p.file) + '">'
    + '<input type="checkbox" class="ck" data-act="sel" ' + (sel.has(p.file) ? 'checked' : '') + ' aria-label="选择">'
    + thumb
    + '<div class="pmain"><div class="ptitle"><span class="t">' + escLocal(p.title) + '</span>' + statusBadge(p) + '</div>'
    + '<div class="pdesc">' + escLocal(p.description) + '</div>'
    + '<div class="pmeta">' + escLocal(meta) + (p.category ? ' · <span class="cat">' + escLocal(p.category) + '</span>' : '') + (tags ? ' · ' + escLocal(tags) : '') + '</div></div>'
    + '<div class="pops">'
    + '<button data-act="open">打开</button>'
    + '<button data-act="preview">预览</button>'
    + '<button data-act="toggle">' + (p.draft ? '发布' : '转草稿') + '</button>'
    + '<button data-act="del">删除</button>'
    + '</div></div>';
}

function render() {
  const list = filtered();
  $('count').textContent = list.length + ' / ' + posts.length + ' 篇';
  $('list').innerHTML = list.length
    ? list.map(rowHtml).join('')
    : '<div class="pempty">没有匹配的文章</div>';
  const bar = $('batchbar');
  bar.classList.toggle('on', sel.size > 0);
  $('batchN').textContent = sel.size;
}

$('q').addEventListener('input', render);
$('fStatus').addEventListener('change', render);
$('fCat').addEventListener('change', render);
$('newPost').addEventListener('click', () => vscode.postMessage({ type: 'newPost' }));

$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const file = btn.closest('.prow').dataset.file;
  const act = btn.dataset.act;
  if (act === 'sel') {
    btn.checked ? sel.add(file) : sel.delete(file);
    btn.closest('.prow').classList.toggle('selected', btn.checked);
    render();
    return;
  }
  if (act === 'open') vscode.postMessage({ type: 'open', file });
  else if (act === 'preview') vscode.postMessage({ type: 'preview', file });
  else if (act === 'toggle') {
    const p = posts.find((x) => x.file === file);
    vscode.postMessage({ type: 'setDraft', files: [file], draft: !p.draft });
  } else if (act === 'del') vscode.postMessage({ type: 'delete', files: [file] });
});

document.querySelectorAll('[data-bact]').forEach((b) =>
  b.addEventListener('click', () => {
    const act = b.dataset.bact;
    if (act === 'clear') { sel.clear(); render(); return; }
    const files = [...sel];
    if (act === 'pub') vscode.postMessage({ type: 'setDraft', files, draft: false });
    else if (act === 'draft') vscode.postMessage({ type: 'setDraft', files, draft: true });
    else if (act === 'del') vscode.postMessage({ type: 'delete', files });
  }),
);

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    posts = msg.posts;
    thumbs = msg.thumbs || {};
    sel.forEach((f) => { if (!posts.some((p) => p.file === f)) sel.delete(f); });
    const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))].sort();
    const cur = $('fCat').value;
    $('fCat').innerHTML = '<option value="">全部分类</option>' + cats.map((c) => '<option' + (c === cur ? ' selected' : '') + '>' + escLocal(c) + '</option>').join('');
    render();
  } else if (msg.type === 'saved') {
    toast(msg.text || '已保存');
  } else if (msg.type === 'error' && msg.message) {
    showError(msg.message);
  }
});
vscode.postMessage({ type: 'ready' });
`
  );
}

function sendInit(): void {
  if (!panel || !openedProfile) return;
  const posts = listPosts(openedProfile.postsDir);
  const thumbs: Record<string, string> = {};
  for (const p of posts) {
    if (!p.cover) continue;
    const uri = resolveImageUri(panel.webview, openedProfile, p.cover);
    if (uri) thumbs[p.file] = uri;
  }
  void panel.webview.postMessage({ type: 'init', posts, thumbs });
}

/** 外部(文件监听、档案切换)通知文章中心刷新;未打开时无操作 */
export function refreshPostsCenter(): void {
  if (panel && openedProfile) {
    try {
      assertProfileUnchanged(openedProfile);
      sendInit();
    } catch {
      /* 档案已切换:面板留着旧数据,用户在顶部徽章能看到 */
    }
  }
}

export function openPostsCenter(): void {
  if (panel) {
    panel.reveal();
    return;
  }
  const profile = getProfile();
  openedProfile = profile;
  panel = vscode.window.createWebviewPanel(
    'towardsLightPostsCenter',
    '文章中心',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell(
    '文章中心',
    body(),
    script(),
    panel.webview.cspSource,
    profile.dir.split(/[\\/]/).pop() ?? '',
  );
  panel.onDidDispose(() => {
    panel = undefined;
    openedProfile = undefined;
  });
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        sendInit();
      } else if (msg.type === 'open') {
        await openFile(msg.file);
      } else if (msg.type === 'preview') {
        await openPostPreview(msg.file);
      } else if (msg.type === 'newPost') {
        openNewPostForm(() => sendInit());
      } else if (msg.type === 'setDraft') {
        assertProfileUnchanged(profile);
        const files: string[] = msg.files ?? [];
        for (const f of files) setPostDraft(f, !!msg.draft);
        sendInit();
        void panel?.webview.postMessage({
          type: 'saved',
          text: msg.draft ? `已转草稿 ${files.length} 篇` : `已发布 ${files.length} 篇`,
        });
      } else if (msg.type === 'delete') {
        assertProfileUnchanged(profile);
        const files: string[] = msg.files ?? [];
        if (!files.length) return;
        const ok = await vscode.window.showWarningMessage(
          `删除 ${files.length} 篇文章?移入系统回收站,可恢复;引用它们的图片不动。`,
          { modal: true },
          '删除',
        );
        if (ok !== '删除') return;
        for (const f of files) {
          await vscode.workspace.fs.delete(vscode.Uri.file(f), { useTrash: true });
        }
        sendInit();
        void panel?.webview.postMessage({ type: 'saved', text: `已删除 ${files.length} 篇` });
      }
    } catch (e) {
      void panel?.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
