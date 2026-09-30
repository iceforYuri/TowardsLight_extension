import * as vscode from 'vscode';
import {
  addGroup,
  addLink,
  deleteGroup,
  deleteLink,
  moveLink,
  readIcons,
  readLinkGroups,
  readLinks,
  reorderGroups,
  updateGroup,
  updateLink,
} from '../core';
import { getProfile } from '../util';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';

function body(): string {
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>链接管理</h1>
<p class="sub">写回当前档案的 links.ts。顺序即页面展示顺序;URL 是每条链接的 key,不可改,要换地址就删除重建。</p>
<div class="layout">
  <nav class="toc" id="toc"></nav>
  <div class="main" id="main"></div>
</div>
<div class="error" id="error"></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
let groups = [];
let links = [];
let icons = [];
let editing = null; // {kind:'link-edit'|'link-new'|'group-edit'|'group-new', key?, group?}
let armedDel = ''; // 二次确认中的删除目标

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const iconMap = () => Object.fromEntries(icons.map((i) => [i.name, i.body]));
function svgOf(body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}
const LINK_ICON = '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
function domainOf(href) {
  try { return new URL(href).host; } catch { return href; }
}
function groupOf(id) { return groups.find((g) => g.id === id); }
function linksOf(id) { return links.filter((l) => l.group === id); }

// ── 渲染 ──
function render() {
  const toc = $('toc');
  toc.innerHTML = groups.map((g) =>
    '<a href="#g_' + esc(g.id) + '">' + esc(g.label) + '<span class="cnt">' + linksOf(g.id).length + '</span></a>',
  ).join('') + '<button class="toc-new" data-act="group-new">＋ 新建分组</button>';

  const main = $('main');
  main.innerHTML = groups.map((g) => {
    const rows = linksOf(g.id);
    const rowsHtml = rows.length
      ? rows.map((l, i) => rowHtml(l, i, rows.length)).join('')
      : '<div class="lm-empty">还没有链接</div>';
    const gLocked = rows.length > 0;
    return '<section class="lm-section" id="g_' + esc(g.id) + '" data-gid="' + esc(g.id) + '">'
      + '<div class="lm-ghead" draggable="true" title="拖动调整分组顺序"><h2>' + esc(g.label) + '</h2><span class="lm-gid">' + esc(g.id) + '</span>'
      + '<span class="drag-hint">⠿ 拖动排序</span>'
      + '<span class="lm-gops">'
      + '<button class="small" data-act="group-edit" data-id="' + esc(g.id) + '">编辑分组</button>'
      + '<button class="small danger" data-act="group-del" data-id="' + esc(g.id) + '"' + (gLocked ? ' disabled title="组内还有链接,不能删除"' : '') + '>删除</button>'
      + '</span></div>'
      + '<p class="lm-gdesc">' + esc(g.description) + '</p>'
      + (editing?.kind === 'group-edit' && editing.id === g.id ? groupEditorHtml(g) : '')
      + '<div class="lm-rows">' + rowsHtml + '</div>'
      + (editing?.kind === 'link-new' && editing.group === g.id ? linkEditorHtml(null, g.id) : '')
      + '<button class="lm-add" data-act="link-new" data-group="' + esc(g.id) + '">＋ 添加链接到 ' + esc(g.label) + '</button>'
      + '</section>';
  }).join('') + (editing?.kind === 'group-new' ? groupEditorHtml(null) : '');

  bindOps();
  bindDrag();
  bindSpy();
}

function rowHtml(l, i, total) {
  const body = iconMap()[l.icon] || LINK_ICON;
  const ed = editing?.kind === 'link-edit' && editing.key === l.href;
  return '<div class="lm-row">'
    + '<span class="lm-ico">' + svgOf(body) + '</span>'
    + '<div class="lm-main"><div class="lm-title">' + esc(l.title)
    + (l.featured ? '<span class="lm-badge feat">featured</span>' : '')
    + (l.external ? '<span class="lm-badge">↗</span>' : '')
    + '</div><div class="lm-desc">' + esc(l.description) + '</div></div>'
    + '<span class="lm-meta">' + esc(domainOf(l.href)) + (l.status ? ' · ' + esc(l.status) : '') + '</span>'
    + '<span class="lm-ops">'
    + '<button data-act="up" data-key="' + esc(l.href) + '"' + (i === 0 ? ' disabled' : '') + ' title="上移" aria-label="上移">↑</button>'
    + '<button data-act="down" data-key="' + esc(l.href) + '"' + (i === total - 1 ? ' disabled' : '') + ' title="下移" aria-label="下移">↓</button>'
    + '<button data-act="link-edit" data-key="' + esc(l.href) + '" title="编辑" aria-label="编辑">✎</button>'
    + (armedDel === l.href
      ? '<button class="armed" data-act="del2" data-key="' + esc(l.href) + '" aria-label="确认删除">确认删除</button>'
      : '<button data-act="del" data-key="' + esc(l.href) + '" title="删除" aria-label="删除">✕</button>')
    + '</span></div>'
    + (ed ? linkEditorHtml(l, l.group) : '');
}

function linkEditorHtml(l, groupId) {
  const isNew = !l;
  const opts = groups.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === groupId ? ' selected' : '') + '>' + esc(g.label) + ' · ' + esc(g.id) + '</option>').join('');
  return '<div class="lm-editor">'
    + '<div class="row"><div><label class="f">名称 <span class="req">*</span></label><input type="text" id="ed_title" value="' + esc(l?.title) + '"></div>'
    + '<div><label class="f">URL <span class="req">*</span></label><input type="url" id="ed_href" value="' + esc(l?.href) + '"' + (isNew ? '' : ' disabled title="URL 是链接的 key,不可改"') + '></div></div>'
    + '<label class="f">一句话说明 <span class="req">*</span></label><input type="text" id="ed_desc" value="' + esc(l?.description) + '">'
    + '<div class="row"><div><label class="f">分组</label><select id="ed_group">' + opts + '</select></div>'
    + '<div><label class="f">状态文字</label><input type="text" id="ed_status" value="' + esc(l?.status) + '" placeholder="可选"></div></div>'
    + '<label class="f">图标</label>'
    + '<input type="text" id="ed_iconSearch" placeholder="搜索图标名…">'
    + '<input type="hidden" id="ed_iconValue" value="' + esc(l?.icon) + '">'
    + '<div class="icon-grid" id="ed_iconGrid"></div>'
    + '<div class="checks">'
    + '<label class="check-card"><input type="checkbox" id="ed_external"' + (l?.external !== false ? ' checked' : '') + '><span class="box">${CHECK_SVG}</span>外部链接(显示 ↗)</label>'
    + '<label class="check-card"><input type="checkbox" id="ed_featured"' + (l?.featured ? ' checked' : '') + '><span class="box">${CHECK_SVG}</span>重点链接(首页展示)</label>'
    + '</div>'
    + '<div class="actions"><button class="primary" data-act="save-link">' + (isNew ? '添加' : '保存修改') + '</button>'
    + '<button class="small" data-act="cancel">取消</button></div>'
    + '</div>';
}

function groupEditorHtml(g) {
  const isNew = !g;
  return '<div class="lm-editor">'
    + (isNew ? '<div class="row"><div><label class="f">分组 id <span class="req">*</span></label><input type="text" id="eg_id" placeholder="英文小写,如 reading"></div>'
      + '<div><label class="f">显示名 <span class="req">*</span></label><input type="text" id="eg_label"></div></div>'
      : '<label class="f">显示名 <span class="req">*</span></label><input type="text" id="eg_label" value="' + esc(g?.label) + '">')
    + '<label class="f">分组描述</label><input type="text" id="eg_desc" value="' + esc(g?.description) + '">'
    + '<div class="actions"><button class="primary" data-act="save-group">' + (isNew ? '添加分组' : '保存修改') + '</button>'
    + '<button class="small" data-act="cancel">取消</button></div>'
    + '</div>';
}

// ── 编辑器内图标选择 ──
function renderEditorIcons() {
  const grid = $('ed_iconGrid');
  if (!grid) return;
  const filter = $('ed_iconSearch').value.trim().toLowerCase();
  const cur = $('ed_iconValue').value;
  grid.innerHTML = '';
  const none = document.createElement('div');
  none.className = 'icon-cell' + (!cur ? ' sel' : '');
  none.title = '不选图标';
  none.innerHTML = svgOf(LINK_ICON);
  none.addEventListener('click', () => { $('ed_iconValue').value = ''; renderEditorIcons(); });
  grid.appendChild(none);
  for (const ic of icons) {
    if (filter && !ic.name.includes(filter)) continue;
    const cell = document.createElement('div');
    cell.className = 'icon-cell' + (ic.name === cur ? ' sel' : '');
    cell.title = ic.name;
    cell.innerHTML = svgOf(ic.body);
    cell.addEventListener('click', () => { $('ed_iconValue').value = ic.name; renderEditorIcons(); });
    grid.appendChild(cell);
  }
}

// ── 操作绑定 ──
function bindOps() {
  document.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', onAction);
  });
  const search = $('ed_iconSearch');
  if (search) search.addEventListener('input', renderEditorIcons);
  renderEditorIcons();
}

function onAction(e) {
  const el = e.currentTarget;
  const act = el.dataset.act;
  const key = el.dataset.key;
  showError('');
  if (act === 'link-new') editing = { kind: 'link-new', group: el.dataset.group };
  else if (act === 'link-edit') editing = { kind: 'link-edit', key };
  else if (act === 'group-new') editing = { kind: 'group-new' };
  else if (act === 'group-edit') editing = { kind: 'group-edit', id: el.dataset.id };
  else if (act === 'cancel') editing = null;
  else if (act === 'up' || act === 'down') return doMove(key, act === 'up' ? -1 : 1);
  else if (act === 'del') { armedDel = key; render(); return; }
  else if (act === 'del2') return doDelete(key);
  else if (act === 'group-del') return doDeleteGroup(el.dataset.id);
  else if (act === 'save-link') return doSaveLink();
  else if (act === 'save-group') return doSaveGroup(el);
  armedDel = '';
  render();
}

// ── 乐观更新 + 落盘 ──
function doMove(key, dir) {
  const i = links.findIndex((l) => l.href === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= links.length) return;
  const g = links[i].group;
  // 只与同组相邻项交换(展示顺序按组渲染)
  const groupIdx = links.map((l, idx) => l.group === g ? idx : -1).filter((x) => x >= 0);
  const pos = groupIdx.indexOf(i);
  const target = groupIdx[pos + dir];
  if (target === undefined) return;
  [links[i], links[target]] = [links[target], links[i]];
  vscode.postMessage({ type: 'move', key, dir: target > i ? 1 : -1, steps: Math.abs(target - i) });
  editing = null; armedDel = '';
  render();
}
function doDelete(key) {
  links = links.filter((l) => l.href !== key);
  vscode.postMessage({ type: 'delete', key });
  editing = null; armedDel = '';
  render();
}
function doDeleteGroup(id) {
  if (linksOf(id).length) return;
  groups = groups.filter((g) => g.id !== id);
  vscode.postMessage({ type: 'deleteGroup', id });
  editing = null;
  render();
}
function doSaveLink() {
  const value = {
    title: $('ed_title').value.trim(),
    href: $('ed_href').value.trim(),
    description: $('ed_desc').value.trim(),
    group: $('ed_group').value,
    icon: $('ed_iconValue').value || undefined,
    external: $('ed_external').checked,
    featured: $('ed_featured').checked,
    status: $('ed_status').value.trim() || undefined,
  };
  if (editing?.kind === 'link-edit') {
    const l = links.find((x) => x.href === editing.key);
    if (l) Object.assign(l, value, { href: editing.key });
    vscode.postMessage({ type: 'save', mode: 'edit', key: editing.key, value });
  } else {
    links.push(value);
    vscode.postMessage({ type: 'save', mode: 'create', value });
  }
  editing = null;
  render();
}
function doSaveGroup() {
  const label = $('eg_label').value.trim();
  const description = $('eg_desc').value.trim();
  if (editing?.kind === 'group-edit') {
    const g = groupOf(editing.id);
    if (g) { g.label = label; g.description = description; }
    vscode.postMessage({ type: 'updateGroup', id: editing.id, patch: { label, description } });
  } else {
    const id = $('eg_id').value.trim();
    groups.push({ id, label, description });
    vscode.postMessage({ type: 'addGroup', value: { id, label, description } });
  }
  editing = null;
  render();
}

// ── 分组拖拽排序 ──
let dragId = null;
function bindDrag() {
  document.querySelectorAll('.lm-ghead').forEach((h) => {
    h.addEventListener('dragstart', (e) => {
      dragId = h.closest('.lm-section').dataset.gid;
      e.dataTransfer.effectAllowed = 'move';
      h.closest('.lm-section').classList.add('dragging');
    });
    h.addEventListener('dragend', () => {
      dragId = null;
      document.querySelectorAll('.lm-section').forEach((s) => s.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
  });
  document.querySelectorAll('.lm-section').forEach((sec) => {
    sec.addEventListener('dragover', (e) => {
      if (!dragId || sec.dataset.gid === dragId) return;
      e.preventDefault();
      const rect = sec.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      document.querySelectorAll('.lm-section').forEach((s) => s.classList.remove('drop-before', 'drop-after'));
      sec.classList.add(after ? 'drop-after' : 'drop-before');
    });
    sec.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || sec.dataset.gid === dragId) return;
      const rect = sec.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      const from = groups.findIndex((g) => g.id === dragId);
      let to = groups.findIndex((g) => g.id === sec.dataset.gid) + (after ? 1 : 0);
      if (from < 0 || to < 0) return;
      const [moved] = groups.splice(from, 1);
      if (from < to) to--;
      groups.splice(to, 0, moved);
      vscode.postMessage({ type: 'reorderGroups', ids: groups.map((g) => g.id) });
      render();
    });
  });
}

// ── scrollspy ──
let io = null;
function bindSpy() {
  if (io) io.disconnect();
  const tocLinks = [...document.querySelectorAll('.toc a')];
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) tocLinks.forEach((a) => a.classList.toggle('on', a.hash === '#' + en.target.id));
    }
  }, { rootMargin: '-10% 0px -75% 0px' });
  tocLinks.forEach((a) => {
    const sec = document.querySelector(a.hash);
    if (sec) io.observe(sec);
  });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    groups = msg.groups;
    links = msg.links;
    icons = msg.icons;
    editing = null; armedDel = '';
    render();
  } else if (msg.type === 'saved') {
    toast(msg.text);
    showError('');
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openLinkForm(): void {
  const profile = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightLink',
    '链接管理',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('链接管理', body(), script(), panel.webview.cspSource);

  const sendInit = () =>
    panel.webview.postMessage({
      type: 'init',
      icons: readIcons(profile.iconFile),
      groups: readLinkGroups(profile.linksFile),
      links: readLinks(profile.linksFile),
    });
  /** 落盘失败:报错 + 重新下发真实数据,纠正前端的乐观更新 */
  const fail = (e: unknown) => {
    panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    void sendInit();
  };

  panel.webview.onDidReceiveMessage((msg) => {
    try {
      if (msg.type === 'ready') {
        void sendInit();
        return;
      }
      if (msg.type === 'move') {
        for (let s = 0; s < (msg.steps ?? 1); s++) moveLink(profile.linksFile, msg.key, msg.dir);
        panel.webview.postMessage({ type: 'saved', text: '顺序已更新' });
      } else if (msg.type === 'reorderGroups') {
        reorderGroups(profile.linksFile, msg.ids);
        panel.webview.postMessage({ type: 'saved', text: '分组顺序已更新' });
      } else if (msg.type === 'delete') {
        deleteLink(profile.linksFile, msg.key);
        panel.webview.postMessage({ type: 'saved', text: '链接已删除' });
      } else if (msg.type === 'deleteGroup') {
        const links = readLinks(profile.linksFile).filter((l) => l.group === msg.id);
        if (links.length) throw new Error(`分组里还有 ${links.length} 条链接,不能删除`);
        deleteGroup(profile.linksFile, msg.id);
        panel.webview.postMessage({ type: 'saved', text: '分组已删除' });
      } else if (msg.type === 'updateGroup') {
        if (!msg.patch?.label) throw new Error('显示名不能为空');
        updateGroup(profile.linksFile, msg.id, msg.patch);
        panel.webview.postMessage({ type: 'saved', text: '分组已更新' });
      } else if (msg.type === 'addGroup') {
        const g = msg.value;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(g.id)) throw new Error('分组 id 只能是小写字母、数字和连字符');
        if (!g.label) throw new Error('显示名不能为空');
        addGroup(profile.linksFile, g);
        panel.webview.postMessage({ type: 'saved', text: '分组已添加' });
      } else if (msg.type === 'save') {
        const v = msg.value;
        if (!v.title) throw new Error('名称不能为空');
        if (!v.href) throw new Error('URL 不能为空');
        if (!v.description) throw new Error('说明不能为空');
        if (!v.group) throw new Error('分组不能为空');
        if (msg.mode === 'edit') {
          updateLink(profile.linksFile, msg.key, {
            title: v.title,
            description: v.description,
            group: v.group,
            icon: v.icon ?? '',
            status: v.status ?? '',
            external: v.external,
            featured: v.featured,
          });
        } else {
          if (readLinks(profile.linksFile).some((l) => l.href === v.href)) {
            throw new Error('已存在同 URL 的链接(URL 是 key,不可重复)');
          }
          addLink(profile.linksFile, v);
        }
        panel.webview.postMessage({ type: 'saved', text: msg.mode === 'edit' ? '链接已更新' : '链接已添加' });
      }
    } catch (e) {
      fail(e);
    }
  });
}
