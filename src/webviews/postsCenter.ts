import * as vscode from 'vscode';
import { listPosts, setPostDraft } from '../core';
import { openPostPreview } from '../preview';
import { getProfile, assertProfileUnchanged, openFile, resolveImageUri } from '../util';
import { openNewPostForm } from './newPost';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

let panel: vscode.WebviewPanel | undefined;
let openedProfile: ReturnType<typeof getProfile> | undefined;

const ICONS = {
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function body(): string {
  return `
<style>
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar input[type="search"] { flex: 1; min-width: 160px; background: transparent; border-color: var(--line); }
.toolbar input[type="search"]:hover { border-color: var(--line-strong); }
.toolbar select { min-width: 0; width: auto; }
.toolbar .count { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-left: auto; }
.chip { padding: 5px 11px; border: 1px solid var(--line); border-radius: 99px; background: transparent;
  color: var(--muted); font: inherit; font-size: 11.5px; cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease; }
.chip:hover { border-color: var(--line-strong); color: var(--fg); }
.chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.batchbar { display: none; align-items: center; gap: 6px; padding: 8px 12px; margin-bottom: 10px;
  border: 1px solid var(--accent); border-radius: 9px; background: var(--accent-soft); font-size: 12px; }
.batchbar.on { display: flex; }
.batchbar .n { font-family: var(--mono); font-weight: 600; color: var(--accent); }

.ptable { width: 100%; border-collapse: collapse; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.ptable th { font-family: var(--mono); font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint); text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line);
  background: var(--bg); position: sticky; top: 0; user-select: none; white-space: nowrap; }
.ptable th[data-sort] { cursor: pointer; }
.ptable th[data-sort]:hover { color: var(--fg); }
.ptable th .arr { color: var(--accent); }
.ptable td { padding: 7px 10px; border-top: 1px solid var(--line); vertical-align: middle; }
.ptable tbody tr { transition: background 0.12s ease; }
.ptable tbody tr:hover { background: var(--raise); }
.ptable tbody tr.selected { background: var(--accent-soft); }

.c-ck { width: 28px; }
.c-ck input { width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
.c-thumb { width: 44px; }
.c-date { width: 92px; }
.c-cat { width: 96px; }
.c-status { width: 64px; }
.c-ops { width: 128px; }

.thumb { width: 36px; height: 36px; border-radius: 7px; object-fit: cover; border: 1px solid var(--line);
  background: var(--raise); display: block; }
.thumb.none { display: grid; place-items: center; color: var(--faint); font-family: var(--mono); font-size: 10px; }

.t-title { font-size: 13px; font-weight: 600; display: block; }
.t-slug { font-family: var(--mono); font-size: 10.5px; color: var(--faint); display: block; margin-top: 1px; }
.td-date, .td-cat { font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.td-cat { color: var(--fg); }
.td-tags { font-family: var(--mono); font-size: 11px; color: var(--muted); white-space: nowrap;
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.td-tags .more { color: var(--faint); }

.pstatus { font-family: var(--mono); font-size: 10px; padding: 1px 8px; border-radius: 99px; white-space: nowrap; }
.pstatus.draft { color: #b07a2f; background: color-mix(in srgb, #b07a2f 12%, transparent); border: 1px solid color-mix(in srgb, #b07a2f 40%, transparent); }
.pstatus.pub { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); }
.pstatus.bad { color: var(--err); background: color-mix(in srgb, var(--err) 10%, transparent); border: 1px solid color-mix(in srgb, var(--err) 35%, transparent); }

.td-ops { white-space: nowrap; }
.iop { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease; }
.iop svg { width: 14px; height: 14px; }
.iop:hover { background: var(--raise-2); color: var(--fg); }
.iop.del:hover { color: var(--err); }
.pempty { text-align: center; color: var(--muted); font-size: 12.5px; padding: 40px 0 !important; }
</style>

<div class="kicker">Towards Light · Studio</div>
<h1>文章中心</h1>
<p class="sub">当前档案的全部文章。勾选后可批量发布、转草稿或删除(回收站,可恢复)。列头点击排序。</p>

<div class="toolbar">
  <input type="search" id="q" placeholder="搜索标题 / 描述 / 标签 / slug…" aria-label="搜索文章">
  <select id="fYear" aria-label="按年份筛选"><option value="">全部年份</option></select>
  <select id="fCat" aria-label="按分类筛选"><option value="">全部分类</option></select>
  <select id="fTag" aria-label="按标签筛选"><option value="">全部标签</option></select>
  <select id="fStatus" aria-label="按状态筛选">
    <option value="">全部状态</option><option value="pub">已发布</option><option value="draft">草稿</option>
  </select>
  <select id="fSort" aria-label="排序">
    <option value="pubDate:-1">发布日期 ↓</option><option value="pubDate:1">发布日期 ↑</option>
    <option value="title:1">标题 A→Z</option><option value="title:-1">标题 Z→A</option>
  </select>
  <button class="chip" id="fCover" aria-pressed="false">有封面</button>
  <button class="chip" id="fFeat" aria-pressed="false">精选</button>
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

<table class="ptable">
  <thead><tr>
    <th class="c-ck"><input type="checkbox" id="selAll" aria-label="全选"></th>
    <th class="c-thumb"></th>
    <th data-sort="title">标题 <span class="arr"></span></th>
    <th class="c-date" data-sort="pubDate">日期 <span class="arr"></span></th>
    <th class="c-cat" data-sort="category">分类 <span class="arr"></span></th>
    <th>标签</th>
    <th class="c-status">状态</th>
    <th class="c-ops"></th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
const ICONS = ${JSON.stringify(ICONS)};
let posts = [];
let thumbs = {};
const sel = new Set();
const sort = { key: 'pubDate', dir: -1 };

function escLocal(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>'; }

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const st = $('fStatus').value;
  const cat = $('fCat').value;
  const tag = $('fTag').value;
  const year = $('fYear').value;
  const needCover = $('fCover').classList.contains('on');
  const needFeat = $('fFeat').classList.contains('on');
  const list = posts.filter((p) => {
    if (st && (st === 'draft') !== p.draft) return false;
    if (cat && p.category !== cat) return false;
    if (tag && !p.tags.includes(tag)) return false;
    if (year && !(p.pubDate || '').startsWith(year)) return false;
    if (needCover && !p.cover) return false;
    if (needFeat && !p.featured) return false;
    if (!q) return true;
    const hay = (p.title + ' ' + p.description + ' ' + p.tags.join(' ') + ' ' + p.slug).toLowerCase();
    return q.split(/\\s+/).every((w) => hay.includes(w));
  });
  const { key, dir } = sort;
  return list.sort((a, b) => {
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    return va < vb ? -dir : va > vb ? dir : 0;
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
  const tags = p.tags.slice(0, 3).map((t) => '#' + t).join(' ');
  const more = p.tags.length > 3 ? '<span class="more"> +' + (p.tags.length - 3) + '</span>' : '';
  return '<tr data-file="' + escLocal(p.file) + '"' + (sel.has(p.file) ? ' class="selected"' : '') + '>'
    + '<td class="c-ck"><input type="checkbox" data-act="sel" ' + (sel.has(p.file) ? 'checked' : '') + ' aria-label="选择"></td>'
    + '<td class="c-thumb">' + thumb + '</td>'
    + '<td><span class="t-title" title="' + escLocal(p.description) + '">' + escLocal(p.title) + '</span><span class="t-slug">' + escLocal(p.slug) + (p.updatedDate ? ' · 更 ' + escLocal(p.updatedDate) : '') + '</span></td>'
    + '<td class="td-date">' + escLocal(p.pubDate) + '</td>'
    + '<td class="td-cat">' + escLocal(p.category) + '</td>'
    + '<td class="td-tags">' + escLocal(tags) + more + '</td>'
    + '<td class="c-status">' + statusBadge(p) + '</td>'
    + '<td class="td-ops">'
    + '<button class="iop" data-act="open" title="打开编辑">' + icon('edit') + '</button>'
    + '<button class="iop" data-act="preview" title="预览">' + icon('eye') + '</button>'
    + '<button class="iop" data-act="toggle" title="' + (p.draft ? '发布' : '转为草稿') + '">' + icon(p.draft ? 'up' : 'down') + '</button>'
    + '<button class="iop del" data-act="del" title="删除(回收站)">' + icon('x') + '</button>'
    + '</td></tr>';
}

function render() {
  const list = filtered();
  $('count').textContent = list.length + ' / ' + posts.length + ' 篇';
  $('rows').innerHTML = list.length
    ? list.map(rowHtml).join('')
    : '<tr><td class="pempty" colspan="8">没有匹配的文章</td></tr>';
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.querySelector('.arr').textContent = th.dataset.sort === sort.key ? (sort.dir > 0 ? '↑' : '↓') : '';
  });
  const bar = $('batchbar');
  bar.classList.toggle('on', sel.size > 0);
  $('batchN').textContent = sel.size;
  const visible = list.map((p) => p.file);
  $('selAll').checked = visible.length > 0 && visible.every((f) => sel.has(f));
}

['q', 'fStatus', 'fCat', 'fTag', 'fYear'].forEach((id) => {
  $(id).addEventListener(id === 'q' ? 'input' : 'change', render);
});
$('fSort').addEventListener('change', () => {
  const [k, d] = $('fSort').value.split(':');
  sort.key = k;
  sort.dir = Number(d);
  render();
});
['fCover', 'fFeat'].forEach((id) =>
  $(id).addEventListener('click', () => {
    $(id).classList.toggle('on');
    $(id).setAttribute('aria-pressed', $(id).classList.contains('on'));
    render();
  }),
);
$('newPost').addEventListener('click', () => vscode.postMessage({ type: 'newPost' }));

document.querySelectorAll('th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    if (sort.key === th.dataset.sort) sort.dir = -sort.dir;
    else { sort.key = th.dataset.sort; sort.dir = th.dataset.sort === 'pubDate' ? -1 : 1; }
    $('fSort').value = sort.key + ':' + sort.dir;
    render();
  }),
);

$('selAll').addEventListener('change', (e) => {
  const visible = filtered().map((p) => p.file);
  if (e.target.checked) visible.forEach((f) => sel.add(f));
  else visible.forEach((f) => sel.delete(f));
  render();
});

$('rows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const file = btn.closest('tr').dataset.file;
  const act = btn.dataset.act;
  if (act === 'sel') {
    btn.checked ? sel.add(file) : sel.delete(file);
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
    const curC = $('fCat').value;
    $('fCat').innerHTML = '<option value="">全部分类</option>' + cats.map((c) => '<option' + (c === curC ? ' selected' : '') + '>' + escLocal(c) + '</option>').join('');
    const tagCount = {};
    posts.forEach((p) => p.tags.forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
    const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const curT = $('fTag').value;
    $('fTag').innerHTML = '<option value="">全部标签</option>' + tags.map((t) => '<option' + (t === curT ? ' selected' : '') + '>' + escLocal(t) + '</option>').join('');
    const years = [...new Set(posts.map((p) => (p.pubDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const curY = $('fYear').value;
    $('fYear').innerHTML = '<option value="">全部年份</option>' + years.map((y) => '<option' + (y === curY ? ' selected' : '') + '>' + y + '</option>').join('');
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
      /* 档案已切换:面板留着旧数据,顶部徽章可见 */
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
