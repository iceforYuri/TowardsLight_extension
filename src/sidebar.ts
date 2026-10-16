import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { listPosts, parsePost, PostMeta, updatePostMeta } from './core';
import { articleImageDir, articleImageRef, copyImageIn } from './core/images';
import { generateSummary } from './ai';
import { detectRepos } from './git';
import { listServers, onDidChangeServers } from './preview';
import { getProfile, pickImages, getTemplateDir, workspaceRoot } from './util';
import { openPostEditor } from './webviews/newPost';
import { COMBO_CSS, COMBO_SCRIPT } from './webviews/shared';

interface RecentPost {
  file: string;
  title: string;
  draft: boolean;
  valid: boolean;
  /** 最近修改日期(YYYY-MM-DD) */
  mtime: string;
}

/**
 * 侧边栏双模式:无文章激活时是控制台(绑定/预览/管理/最近文章);
 * 编辑器里打开档案内文章时切换为该文章的属性面板(全字段快速修改 + AI 摘要)。
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  /** 当前属性面板绑定的文章(用于保存/AI/选图) */
  private activeFile: string | undefined;
  /** git 可用性按档案目录缓存,不每次 refresh 都跑 git 探测 */
  private repoCache: { dir: string; ok: boolean } | undefined;
  /** 文章目录指纹:没变就复用派生数据(最近修改/分类/标签池),切 Tab 不重解析 */
  private postsFp: string | undefined;
  private postsDerived: { recent: RecentPost[]; categories: string[]; tags: string[] } = {
    recent: [],
    categories: [],
    tags: [],
  };

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = createSidebarHtml();
    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === 'ready') {
          // webview 重建(侧栏隐藏再显示)后主动握手,补发状态
          this.refresh();
          return;
        }
        const cmd = {
          switchProfile: 'towardsLight.switchProfile',
          selectTemplate: 'towardsLight.selectTemplateDir',
          startPreview: 'towardsLight.startPreview',
          showLog: 'towardsLight.showServerLog',
          openCenter: 'towardsLight.openPostsCenter',
          categories: 'towardsLight.addCategory',
          links: 'towardsLight.addLink',
          site: 'towardsLight.editSiteConfig',
          newPost: 'towardsLight.newPost',
          publish: 'towardsLight.publish',
          openSettings: 'towardsLight.openSettings',
        }[msg.type as string];
        if (cmd) {
          await vscode.commands.executeCommand(cmd);
        } else if (msg.type === 'stopServer') {
          await vscode.commands.executeCommand('towardsLight.stopServerAt', msg.port);
        } else if (msg.type === 'openUrl') {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } else if (msg.type === 'openFile') {
          const doc = await vscode.workspace.openTextDocument(msg.file);
          await vscode.window.showTextDocument(doc);
        } else if (msg.type === 'openFull' && this.activeFile) {
          const file = this.activeFile;
          openPostEditor(() => this.refresh(), file);
        } else if (msg.type === 'aiSummary' && this.activeFile) {
          await this.handleAiSummary();
        } else if (msg.type === 'pickCover' && this.activeFile) {
          await this.handlePickCover(msg.slug);
        } else if (msg.type === 'savePost' && this.activeFile) {
          this.handleSave(msg.values);
        }
      } catch (e) {
        void this.view?.webview.postMessage({ type: 'error', message: (e as Error).message });
      }
    });
    this.refresh();
  }

  refresh(): void {
    if (!this.view) return;
    let profile: { name: string; kind: string } | null = null;
    let template: string | null = null;
    let post: PostMeta | null = null;
    try {
      const p = getProfile();
      profile = { name: path.basename(p.dir), kind: p.kind };
      // 「提交更改」入口的可用性:档案或工作区任一侧在 git 仓库里即可
      if (this.repoCache?.dir !== p.dir) {
        this.repoCache = { dir: p.dir, ok: detectRepos([p.dir, workspaceRoot()]).length > 0 };
      }
      // 文章目录指纹不变 → 复用上次解析结果(切编辑器/标签页走的就是这条轻路径);
      // 只在文章真的新建/改动/删除后才全量重解析;指纹含目录路径,切档案必然 bust
      const fp = p.postsDir + '\n' + postsFingerprint(p.postsDir);
      if (fp !== this.postsFp) {
        const posts = listPosts(p.postsDir);
        this.postsDerived = {
          recent: posts
            .map((x) => ({ x, m: fs.statSync(x.file).mtimeMs }))
            .sort((a, b) => b.m - a.m)
            .slice(0, 5)
            .map(({ x, m }) => ({
              file: x.file,
              title: x.title,
              draft: x.draft,
              valid: x.valid,
              mtime: new Date(m).toISOString().slice(0, 10),
            })),
          categories: [...new Set(posts.map((x) => x.category).filter(Boolean))].sort(),
          tags: [...new Set(posts.flatMap((x) => x.tags))].sort(),
        };
        this.postsFp = fp;
      }
      // 属性面板:活动编辑器里的档案内 md。文本编辑器优先;自定义编辑器/预览
      // 标签页(别的插件打开的 md)从 activeTab 的 uri 兜底识别
      let file = vscode.window.activeTextEditor?.document.fileName;
      if (!file?.endsWith('.md')) {
        const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
        const uri =
          input && typeof input === 'object' && 'uri' in input
            ? (input as { uri: vscode.Uri }).uri
            : undefined;
        if (uri?.scheme === 'file' && uri.fsPath.endsWith('.md')) file = uri.fsPath;
      }
      if (file && file.endsWith('.md')) {
        const rel = path.relative(p.postsDir, file);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          this.activeFile = file;
          post = parsePost(file);
        }
      }
    } catch {
      // 未绑定:清空派生数据,别把上一个档案的文章留在控制台
      this.postsFp = undefined;
      this.postsDerived = { recent: [], categories: [], tags: [] };
    }
    if (!post) this.activeFile = undefined;
    try {
      template = path.basename(getTemplateDir());
    } catch {
      /* 未识别 */
    }
    const servers = listServers().map((s) => ({
      port: s.port,
      profile: path.basename(s.profileDir),
    }));
    void this.view.webview.postMessage({
      type: 'state',
      profile,
      template,
      servers,
      recent: this.postsDerived.recent,
      post,
      categories: this.postsDerived.categories,
      tags: this.postsDerived.tags,
      git: this.repoCache?.ok ?? false,
    });
  }

  private async handleAiSummary(): Promise<void> {
    if (!this.activeFile) return;
    void this.view?.webview.postMessage({ type: 'aiBusy', on: true });
    try {
      const text = fs.readFileSync(this.activeFile, 'utf8');
      const res = await generateSummary(text);
      void this.view?.webview.postMessage({ type: 'aiResult', text: res.text, via: res.detail });
    } catch (e) {
      void this.view?.webview.postMessage({ type: 'error', message: (e as Error).message });
      void this.view?.webview.postMessage({ type: 'aiBusy', on: false });
    }
  }

  private async handlePickCover(slug: string): Promise<void> {
    if (!this.activeFile) return;
    const p = getProfile();
    const picked = await pickImages(false);
    if (!picked?.length) return;
    const name = copyImageIn(picked[0], articleImageDir(p.postsDir, slug));
    void this.view?.webview.postMessage({ type: 'coverPicked', ref: articleImageRef(slug, name) });
  }

  private handleSave(values: Record<string, unknown>): void {
    if (!this.activeFile) return;
    updatePostMeta(this.activeFile, {
      title: String(values.title ?? ''),
      description: String(values.description ?? ''),
      category: String(values.category ?? ''),
      tags: Array.isArray(values.tags) ? values.tags.map(String) : [],
      pubDate: values.pubDate ? String(values.pubDate) : undefined,
      draft: !!values.draft,
      featured: !!values.featured,
      cover: values.cover ? String(values.cover) : null,
      coverAlt: values.cover ? String(values.coverAlt ?? '') || null : null,
      coverPosition: values.cover ? String(values.coverPosition ?? '') || null : null,
      updatedDate: new Date().toISOString().slice(0, 10),
    });
    void this.view?.webview.postMessage({ type: 'saved' });
    this.refresh();
  }

  listenServers(): vscode.Disposable {
    return onDidChangeServers(() => this.refresh());
  }
}

/** 文章目录指纹:文件名 + mtime + size;变了才需要重新解析 frontmatter */
function postsFingerprint(postsDir: string): string {
  try {
    const files = (fs.readdirSync(postsDir, { recursive: true }) as string[]).filter((f) =>
      f.endsWith('.md'),
    );
    return files
      .map((f) => {
        try {
          const st = fs.statSync(path.join(postsDir, f));
          return `${f}:${st.mtimeMs}:${st.size}`;
        } catch {
          return `${f}:?`;
        }
      })
      .join('|');
  } catch {
    return '';
  }
}

export function sidebarHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root {
  --fg: var(--vscode-foreground);
  --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --muted: color-mix(in srgb, var(--fg) 58%, transparent);
  --faint: color-mix(in srgb, var(--fg) 38%, transparent);
  --line: color-mix(in srgb, var(--fg) 10%, transparent);
  --line-strong: color-mix(in srgb, var(--fg) 18%, transparent);
  --raise: color-mix(in srgb, var(--fg) 4%, transparent);
  --raise-2: color-mix(in srgb, var(--fg) 7%, transparent);
  --accent: var(--vscode-textLink-foreground, #bc6353);
  --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
  --err: var(--vscode-errorForeground, #e05252);
  --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 10px 10px 24px; color: var(--fg); background: var(--bg);
  font-family: var(--vscode-font-family); font-size: 12px; line-height: 1.5; }
.sec { margin-top: 14px; }
.sec-t { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--accent); margin: 0 2px 6px; display: flex; align-items: center; gap: 8px; }
.sec-t::after { content: ''; flex: 1; height: 1px; background: var(--line); }

.row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px;
  cursor: pointer; transition: background 0.15s ease; }
.row:hover { background: var(--raise); }
.row .k { color: var(--muted); flex: none; }
.row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.row .tag { font-family: var(--mono); font-size: 10px; color: var(--faint); flex: none; }
.row .arr { color: var(--faint); flex: none; opacity: 0; transition: opacity 0.15s ease, transform 0.15s ease; }
.row:hover .arr { opacity: 1; transform: translateX(2px); }

.play { width: 100%; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px; border-radius: 9px; border: 1px solid var(--accent); background: var(--accent-soft);
  color: var(--accent); font: inherit; font-weight: 600; cursor: pointer;
  transition: filter 0.15s ease, transform 0.12s ease; }
.play:hover { filter: brightness(1.08); }
.play:active { transform: scale(0.98); }

.srv { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px;
  background: var(--raise); margin-top: 6px; font-family: var(--mono); font-size: 11px; }
.srv .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #3fb950); flex: none; }
.srv .p { font-weight: 600; }
.srv .pf { color: var(--faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srv button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font: inherit; padding: 2px 5px; border-radius: 5px; }
.srv button:hover { background: var(--raise-2); color: var(--fg); }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.grid button { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; font-size: 12px;
  cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; text-align: left; }
.grid button:hover { border-color: var(--accent); background: var(--accent-soft); }
.grid button .ic { color: var(--muted); flex: none; }
.grid button:hover .ic { color: var(--accent); }

.ghost { width: 100%; margin-top: 6px; padding: 7px; border: 1px dashed var(--line); border-radius: 8px;
  background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.ghost:hover { color: var(--accent); border-color: var(--accent); }
.ghost:disabled { opacity: 0.45; cursor: default; }
.ghost:disabled:hover { color: var(--muted); border-color: var(--line); }

/* 最近文章 */
.recent .row { padding: 5px 10px; }
.rdot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.rdot.draft { background: #b07a2f; }
.rdot.pub { background: var(--vscode-testing-iconPassed, #3fb950); }
.rdot.bad { background: var(--err); }

/* 文章属性面板 */
#postView { display: none; }
body.mode-post #postView { display: block; }
body.mode-post #consoleView { display: none; }
#postView label.f { display: block; font-size: 11px; color: var(--muted); margin: 10px 0 3px; }
#postView input[type=text], #postView input[type=date], #postView textarea, #postView select {
  width: 100%; padding: 5px 8px; font: inherit; font-size: 12px;
  color: var(--fg); background: var(--raise);
  border: 1px solid var(--line); border-radius: 7px;
}
#postView input:focus-visible, #postView textarea:focus-visible, #postView select:focus-visible {
  outline: none; border-color: var(--accent);
}
#postView textarea { resize: vertical; min-height: 44px; }
.p-head { padding: 2px 2px 0; }
.p-slug { font-family: var(--mono); font-size: 10.5px; color: var(--faint); }
.p-checks { display: flex; gap: 14px; margin-top: 10px; }
.p-checks label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }
.p-checks input { accent-color: var(--accent); }
.p-actions { display: flex; gap: 6px; margin-top: 14px; }
.p-actions .play { flex: 1; }
.ai-btn { font-size: 10.5px; padding: 1px 8px; border: 1px solid var(--line); border-radius: 99px;
  background: transparent; color: var(--muted); cursor: pointer; }
.ai-btn:hover { color: var(--accent); border-color: var(--accent); }
.p-hint { font-size: 10.5px; color: var(--faint); margin-top: 8px; }
${COMBO_CSS}
</style>
</head>
<body>

<div id="consoleView">
  <div class="row" id="activePostRow" style="display:none;border:1px solid var(--line);margin-bottom:2px">
    <span class="k">正在读</span><span class="v" id="activePostName"></span><span class="arr">→</span>
  </div>
  <div class="sec">
    <p class="sec-t">绑定</p>
    <div class="row" data-m="switchProfile"><span class="k">档案</span><span class="v" id="profileName">…</span><span class="tag" id="profileKind"></span><span class="arr">→</span></div>
    <div class="row" data-m="selectTemplate"><span class="k">模板</span><span class="v" id="templateName">…</span><span class="arr">→</span></div>
  </div>

  <div class="sec recent" id="recentSec" style="display:none">
    <p class="sec-t">最近修改</p>
    <div id="recent"></div>
  </div>

  <div class="sec">
    <p class="sec-t">预览</p>
    <button class="play" data-m="startPreview">▶ 启动预览</button>
    <div id="servers"></div>
    <button class="ghost" data-m="showLog">查看日志</button>
  </div>

  <div class="sec">
    <p class="sec-t">管理</p>
    <div class="grid">
      <button data-m="openCenter"><span class="ic">▤</span>文章中心</button>
      <button data-m="categories"><span class="ic">▦</span>分类管理</button>
      <button data-m="links"><span class="ic">↗</span>链接管理</button>
      <button data-m="site"><span class="ic">⚙</span>站点信息</button>
    </div>
  </div>

  <div class="sec">
    <button class="play" data-m="newPost">＋ 新建文章</button>
    <button class="ghost" data-m="publish" id="publishBtn">提交更改</button>
    <button class="ghost" data-m="openSettings">设置</button>
  </div>
</div>

<div id="postView">
  <div class="sec" style="margin-top:0">
    <p class="sec-t">当前文章 <button type="button" class="ai-btn" id="backConsole" style="margin-left:auto">← 控制台</button></p>
    <div class="p-head"><span class="p-slug" id="pSlug"></span></div>
  </div>
  <label class="f">标题</label>
  <input type="text" id="p_title">
  <label class="f">描述 <button type="button" class="ai-btn" id="aiBtn" title="根据正文生成摘要">✨ AI</button></label>
  <textarea id="p_desc"></textarea>
  <div class="p-hint" id="aiHint"></div>
  <label class="f">分类</label>
  <div class="combo">
    <input type="text" id="p_category" placeholder="选择或输入新分类…">
    <div class="combo-drop" id="p_categoryDrop"></div>
  </div>
  <label class="f">标签</label>
  <div class="combo">
    <div class="combo-box" id="p_tagsBox"><input type="text" class="combo-in" id="p_tagsIn" placeholder="选择或输入新标签…"></div>
    <div class="combo-drop" id="p_tagsDrop"></div>
  </div>
  <input type="hidden" id="p_tags">
  <label class="f">发布日期</label>
  <input type="date" id="p_pubDate">
  <label class="f">封面</label>
  <select id="p_cover"><option value="">无封面</option><option value="__pick__">从电脑选择…</option></select>
  <label class="f">封面描述</label>
  <input type="text" id="p_coverAlt">
  <label class="f">裁切焦点</label>
  <input type="text" id="p_coverPosition" placeholder="如 center 30%">
  <div class="p-checks">
    <label><input type="checkbox" id="p_draft">草稿</label>
    <label><input type="checkbox" id="p_featured">精选</label>
  </div>
  <div class="p-actions">
    <button class="play" id="pSave">保存</button>
    <button class="ghost" id="pFull" style="width:auto;margin-top:0">完整编辑…</button>
  </div>
  <div class="p-hint">保存会同时更新 updatedDate;正文请在编辑器里写。</div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let currentPost = null;
let lastPostFile = null;
let pinConsole = false;
// 脏守卫:属性面板字段被手动改过且未保存时,后台刷新不覆盖正在编辑的内容
let dirty = false;
let filling = false;

function applyMode(post) {
  // 「返回控制台」钉住控制台,直到切到另一篇文章
  document.body.classList.toggle('mode-post', !!post && !pinConsole);
  $('activePostRow').style.display = post && pinConsole ? '' : 'none';
  if (post && pinConsole) $('activePostName').textContent = post.title || post.slug;
}

$('backConsole').addEventListener('click', () => { pinConsole = true; applyMode(currentPost); });
$('activePostRow').addEventListener('click', () => { pinConsole = false; applyMode(currentPost); });

document.querySelectorAll('[data-m]').forEach((el) =>
  el.addEventListener('click', () => vscode.postMessage({ type: el.dataset.m })),
);

$('pSave').addEventListener('click', () => {
  if (!currentPost) return;
  vscode.postMessage({
    type: 'savePost',
    values: {
      title: $('p_title').value.trim(),
      description: $('p_desc').value.trim(),
      category: $('p_category').value.trim(),
      tags: $('p_tags').value.split(/[,\\uFF0C]/).map((s) => s.trim()).filter(Boolean),
      pubDate: $('p_pubDate').value,
      draft: $('p_draft').checked,
      featured: $('p_featured').checked,
      cover: $('p_cover').value,
      coverAlt: $('p_coverAlt').value.trim(),
      coverPosition: $('p_coverPosition').value.trim(),
    },
  });
});
$('pFull').addEventListener('click', () => vscode.postMessage({ type: 'openFull' }));
$('aiBtn').addEventListener('click', () => {
  $('aiHint').textContent = '生成中…';
  vscode.postMessage({ type: 'aiSummary' });
});
$('p_cover').addEventListener('change', (e) => {
  if (e.target.value === '__pick__' && currentPost) {
    vscode.postMessage({ type: 'pickCover', slug: currentPost.slug });
  }
});

// 分类/标签下拉选择器(替代原生 datalist):分类单选、标签多选 chips,值镜像到 #p_tags
${COMBO_SCRIPT}
let allTags = [];
let allCategories = [];
const tagCombo = comboMulti($('p_tagsBox'), $('p_tagsIn'), $('p_tagsDrop'), $('p_tags'), () => allTags);
comboSingle($('p_category'), $('p_categoryDrop'), () => allCategories);

// 任何字段被改动(含标签 chips 写回的 hidden 镜像)即置脏;fillPost 填充期间除外
$('postView').addEventListener('input', () => { if (!filling) dirty = true; });
$('postView').addEventListener('change', () => { if (!filling) dirty = true; });

function fillPost(p) {
  filling = true;
  currentPost = p;
  $('pSlug').textContent = p.slug + '.md';
  $('p_title').value = p.title;
  $('p_desc').value = p.description;
  $('p_category').value = p.category;
  tagCombo.set(p.tags || []);
  $('p_pubDate').value = p.pubDate || '';
  $('p_draft').checked = !!p.draft;
  $('p_featured').checked = !!p.featured;
  $('p_coverAlt').value = p.coverAlt || '';
  $('p_coverPosition').value = p.coverPosition || '';
  const sel = $('p_cover');
  sel.querySelectorAll('option[data-cur]').forEach((o) => o.remove());
  if (p.cover) {
    const o = document.createElement('option');
    o.value = p.cover;
    o.textContent = p.cover;
    o.dataset.cur = '1';
    sel.appendChild(o);
    sel.value = p.cover;
  } else {
    sel.value = '';
  }
  filling = false;
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'state') {
    $('profileName').textContent = m.profile ? m.profile.name : '未绑定,点击选择';
    $('profileKind').textContent = m.profile ? m.profile.kind : '';
    $('templateName').textContent = m.template ?? '未识别,点击选择';
    $('servers').innerHTML = (m.servers || [])
      .map((s) => '<div class="srv"><span class="dot"></span><span class="p">:' + s.port + '</span>'
        + '<span class="pf">' + s.profile + '</span>'
        + '<button data-open="' + s.port + '" title="在浏览器打开">打开</button>'
        + '<button data-stop="' + s.port + '" title="停止">✕</button></div>')
      .join('');
    document.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'openUrl', url: 'http://localhost:' + b.dataset.open + '/' }); }));
    document.querySelectorAll('[data-stop]').forEach((b) =>
      b.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'stopServer', port: Number(b.dataset.stop) }); }));
    // 最近修改
    const recent = m.recent || [];
    $('recentSec').style.display = recent.length ? '' : 'none';
    $('recent').innerHTML = recent
      .map((r) => '<div class="row" data-file="' + r.file.replace(/"/g, '&quot;') + '">'
        + '<span class="rdot ' + (!r.valid ? 'bad' : r.draft ? 'draft' : 'pub') + '"></span>'
        + '<span class="v">' + (r.title || r.file).replace(/</g, '&lt;') + '</span>'
        + '<span class="tag">' + r.mtime + '</span></div>')
      .join('');
    document.querySelectorAll('#recent .row').forEach((el) =>
      el.addEventListener('click', () => vscode.postMessage({ type: 'openFile', file: el.dataset.file })));
    // 分类/标签下拉候选池
    allCategories = m.categories || [];
    allTags = m.tags || [];
    // 提交入口:档案/工作区都不在 git 仓库里时禁用
    $('publishBtn').disabled = !m.git;
    $('publishBtn').title = m.git ? '把档案的改动提交进 git 仓库' : '档案与工作区都不在 git 仓库中';
    // 模式切换:有激活文章时填属性面板;换文章解除控制台钉住并清脏
    const newFile = m.post ? m.post.file : null;
    if (newFile !== lastPostFile) {
      lastPostFile = newFile;
      pinConsole = false;
      dirty = false;
    }
    if (m.post) {
      currentPost = m.post;
      // 脏守卫:正在编辑的表单不被后台刷新覆盖
      if (!dirty) fillPost(m.post);
    } else {
      currentPost = null;
      dirty = false;
    }
    applyMode(m.post);
  } else if (m.type === 'aiResult') {
    $('p_desc').value = m.text;
    dirty = true; // AI 草稿也是未保存的改动,别被刷新冲掉
    $('aiHint').textContent = '已生成(' + (m.via || '') + '),检查后保存';
  } else if (m.type === 'aiBusy' && !m.on) {
    $('aiHint').textContent = '';
  } else if (m.type === 'coverPicked') {
    const sel = $('p_cover');
    const o = document.createElement('option');
    o.value = m.ref;
    o.textContent = m.ref + '(已复制)';
    o.dataset.cur = '1';
    sel.appendChild(o);
    sel.value = m.ref;
  } else if (m.type === 'saved') {
    dirty = false;
    $('aiHint').textContent = '已保存';
    setTimeout(() => { $('aiHint').textContent = ''; }, 1600);
  } else if (m.type === 'error') {
    $('aiHint').textContent = m.message || '';
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

export function createSidebarHtml(): string {
  return sidebarHtml(crypto.randomBytes(16).toString('hex'));
}
