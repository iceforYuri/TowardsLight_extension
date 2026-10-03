import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  buildPostContent,
  listPosts,
  parsePost,
  readCategories,
  SLUG_PATTERN,
  updatePostMeta,
  type PostMetaPatch,
} from '../core';
import { articleImageDir, articleImageRef, copyImageIn } from '../core/images';
import { listImages, ProfileInfo } from '../core/profile';
import { assertProfileUnchanged, getProfile, pickImages, resolveImageUri } from '../util';
import { cardHtml, pageShell, SCRIPT_PREAMBLE } from './shared';

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';

function body(edit: boolean): string {
  const main = `
<label class="f">标题 <span class="req">*</span></label>
<input type="text" id="title"${edit ? '' : ' autofocus'}>

<div class="row">
  <div>
    <label class="f">文件名(slug)<span class="req">*</span></label>
    <input type="text" id="slug" placeholder="英文小写加连字符"${edit ? ' disabled' : ''}>
    <div class="hint">${edit ? '文件名即地址,锁定不改' : '就是 URL:/posts/<slug>'}</div>
  </div>
  <div>
    <label class="f">分类 <span class="req">*</span></label>
    <input type="text" id="category" list="categoryList">
    <datalist id="categoryList"></datalist>
  </div>
</div>

<label class="f">描述 <span class="req">*</span></label>
<textarea id="description" placeholder="一句话摘要,出现在列表、文章头部和 RSS 里"></textarea>

<label class="f">标签</label>
<input type="text" id="tags" placeholder="用逗号分隔,如 Astro, 写作">
${
  edit
    ? `
<label class="f">发布日期</label>
<input type="date" id="pubDate">`
    : ''
}`;

  const cover = `
<label class="f">封面</label>
<div class="imgrow">
  <div class="thumb" data-thumb-for="cover"></div>
  <div class="grow">
    <select id="cover">
      <option value="">无封面</option>
      <option value="__pick__">从电脑选择…</option>
    </select>
  </div>
</div>
<div class="hint">选本地图片会复制到 posts/image/&lt;slug&gt;/ 并按相对路径引用;选「无封面」只摘字段,不动图片文件</div>
<label class="f">封面描述</label>
<input type="text" id="coverAlt" placeholder="选封面时建议填写">
<label class="f">裁切焦点</label>
<input type="text" id="coverPosition" placeholder="可选,如 center 30%">

<div class="checks${edit ? '' : ' one'}">
  <label class="check-card"><input type="checkbox" id="draft"${edit ? '' : ' checked'}><span class="box">${CHECK_SVG}</span>${edit ? '草稿(不进入构建)' : '存为草稿(不进入构建)'}</label>
  ${
    edit
      ? `<label class="check-card"><input type="checkbox" id="featured"><span class="box">${CHECK_SVG}</span>精选</label>
  <label class="check-card"><input type="checkbox" id="bumpUpdated" checked><span class="box">${CHECK_SVG}</span>同时更新 updatedDate</label>`
      : ''
  }
</div>`;

  return `
<div class="kicker">Towards Light · Studio</div>
<h1>${edit ? '编辑文章信息' : '新建文章'}</h1>
<p class="sub">${edit ? '就地改写 frontmatter 元数据,正文与图片文件不动。' : '生成到当前档案的 posts 目录,归档、标签、分类页自动收录。'}</p>

${cardHtml('c1', '01', '内容', '标题、分类与摘要', main)}
${cardHtml('c2', '02', '封面', '可选;没有封面的文章同样成立', cover)}

<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">${edit ? '保存修改' : '创建并打开'}</button></div>
`;
}

function script(edit: boolean): string {
  return (
    SCRIPT_PREAMBLE +
    `
const EDIT = ${edit};
function slugify(t) {
  return t.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
let slugTouched = false;
if (!EDIT) {
  $('slug').addEventListener('input', (e) => { if (e.isTrusted) slugTouched = true; });
  $('title').addEventListener('input', (e) => {
    if (e.isTrusted && !slugTouched) $('slug').value = slugify(e.target.value);
  });
}
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const dl = $('categoryList');
    for (const c of msg.categories) {
      const o = document.createElement('option');
      o.value = c;
      dl.appendChild(o);
    }
    const sel = $('cover');
    for (const c of msg.covers) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    }
    if (msg.post) {
      const post = msg.post;
      $('title').value = post.title;
      $('slug').value = post.slug;
      $('category').value = post.category;
      $('description').value = post.description;
      $('tags').value = post.tags.join(', ');
      if ($('pubDate')) $('pubDate').value = post.pubDate || '';
      $('draft').checked = post.draft;
      if ($('featured')) $('featured').checked = !!post.featured;
      $('coverAlt').value = post.coverAlt || '';
      $('coverPosition').value = post.coverPosition || '';
      if (post.cover) {
        const o = document.createElement('option');
        o.value = post.cover;
        o.textContent = post.cover + '(当前)';
        sel.appendChild(o);
        sel.value = post.cover;
        vscode.postMessage({ type: 'resolveImage', field: 'cover', value: post.cover });
      }
    } else {
      restoreState();
    }
    bindThumb('cover');
  } else if (msg.type === 'coverPicked') {
    const sel = $('cover');
    const o = document.createElement('option');
    o.value = msg.ref;
    o.textContent = msg.ref + '(已复制)';
    sel.appendChild(o);
    sel.value = msg.ref;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    if (msg.uri) setThumb('cover', msg.uri);
    showError('');
  } else if (msg.type === 'saved') {
    toast('已保存');
    $('submit').disabled = false;
    $('submit').textContent = '保存修改';
  } else if (msg.type === 'error') {
    showError(msg.message);
    if ($('cover').value === '__pick__') $('cover').value = '';
    $('submit').disabled = false;
    $('submit').textContent = EDIT ? '保存修改' : '创建并打开';
  }
});
$('cover').addEventListener('change', (e) => {
  if (e.target.value === '__pick__') {
    vscode.postMessage({ type: 'pickCover', slug: $('slug').value.trim() });
  }
});
$('submit').addEventListener('click', () => {
  showError('');
  $('submit').disabled = true;
  $('submit').textContent = '保存中…';
  vscode.postMessage({
    type: 'submit',
    value: {
      title: $('title').value.trim(),
      slug: $('slug').value.trim(),
      description: $('description').value.trim(),
      category: $('category').value.trim(),
      tags: $('tags').value.split(/[,\\uFF0C]/).map((s) => s.trim()).filter(Boolean),
      cover: $('cover').value,
      coverAlt: $('coverAlt').value.trim(),
      coverPosition: $('coverPosition').value.trim(),
      draft: $('draft').checked,
      pubDate: $('pubDate') ? $('pubDate').value : undefined,
      featured: $('featured') ? $('featured').checked : undefined,
      bumpUpdated: $('bumpUpdated') ? $('bumpUpdated').checked : false,
    },
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

let panel: vscode.WebviewPanel | undefined;
let profile: ProfileInfo | undefined;
let editFile: string | undefined;
let onSaved: (() => void) | undefined;

function renderShell(): void {
  if (!panel || !profile) return;
  const edit = !!editFile;
  panel.title = edit ? '编辑文章信息' : '新建文章';
  panel.webview.html = pageShell(
    panel.title,
    body(edit),
    script(edit),
    panel.webview.cspSource,
    profile.dir.split(/[\\/]/).pop() ?? '',
  );
}

/**
 * 文章表单:新建 / 编辑双模式(单例)。
 * editFile 传入已有文章路径即编辑模式:预填现值、slug 锁定、就地改写 frontmatter。
 */
export function openPostEditor(refreshPosts: () => void, file?: string): void {
  onSaved = refreshPosts;
  if (panel) {
    if (editFile !== file) {
      editFile = file;
      try {
        profile = getProfile();
      } catch {
        /* 未绑定 */
      }
      renderShell();
    } else {
      try {
        const now = getProfile();
        if (profile && now.dir !== profile.dir) {
          profile = now;
          renderShell();
        }
      } catch {
        /* 未绑定 */
      }
    }
    panel.reveal();
    return;
  }
  editFile = file;
  profile = getProfile();
  panel = vscode.window.createWebviewPanel(
    'towardsLightNewPost',
    file ? '编辑文章信息' : '新建文章',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  renderShell();
  panel.onDidDispose(() => {
    panel = undefined;
    profile = undefined;
    editFile = undefined;
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel || !profile) return;
    const p = panel;
    const prof = profile;
    if (msg.type === 'refresh') {
      profile = getProfile();
      renderShell();
      return;
    }
    if (msg.type === 'ready') {
      const fromMeta = readCategories(prof.siteFile).map((c) => c.name);
      const fromPosts = listPosts(prof.postsDir).map((x) => x.category);
      const categories = [...new Set([...fromMeta, ...fromPosts])].filter(Boolean);
      p.webview.postMessage({
        type: 'init',
        categories,
        covers: listImages(prof.imagesDir),
        post: editFile ? { ...parsePost(editFile), slug: path.basename(editFile, '.md') } : undefined,
      });
      return;
    }
    if (msg.type === 'resolveImage') {
      p.webview.postMessage({
        type: 'imageUri',
        field: msg.field,
        uri: resolveImageUri(p.webview, prof, msg.value),
      });
      return;
    }
    if (msg.type !== 'submit') {
      if (msg.type === 'pickCover') {
        try {
          assertProfileUnchanged(prof);
          if (!SLUG_PATTERN.test(msg.slug ?? '')) {
            throw new Error('先填好 slug(小写字母/数字/连字符),封面要按它归档');
          }
          const picked = await pickImages(false);
          if (!picked?.length) {
            p.webview.postMessage({ type: 'error', message: '' });
            return;
          }
          const name = copyImageIn(picked[0], articleImageDir(prof.postsDir, msg.slug));
          const ref = articleImageRef(msg.slug, name);
          p.webview.postMessage({
            type: 'coverPicked',
            ref,
            uri: resolveImageUri(p.webview, prof, ref),
          });
        } catch (e) {
          p.webview.postMessage({ type: 'error', message: (e as Error).message });
        }
      }
      return;
    }
    const v = msg.value;
    try {
      assertProfileUnchanged(prof);
      if (!v.title) throw new Error('标题不能为空');
      if (!v.description) throw new Error('描述不能为空');
      if (!v.category) throw new Error('分类不能为空');

      if (editFile) {
        // 编辑模式:就地改写 frontmatter,正文与 slug 不动
        const patch: PostMetaPatch = {
          title: v.title,
          description: v.description,
          category: v.category,
          tags: v.tags,
          draft: v.draft,
          featured: v.featured ?? false,
          cover: v.cover || null,
          coverAlt: v.cover ? v.coverAlt || null : null,
          coverPosition: v.cover ? v.coverPosition || null : null,
        };
        if (v.pubDate) patch.pubDate = v.pubDate;
        if (v.bumpUpdated) patch.updatedDate = new Date().toISOString().slice(0, 10);
        updatePostMeta(editFile, patch);
        onSaved?.();
        p.webview.postMessage({ type: 'saved' });
      } else {
        if (!SLUG_PATTERN.test(v.slug)) throw new Error('slug 只能包含小写字母、数字和连字符');
        const file = path.join(prof.postsDir, `${v.slug}.md`);
        if (fs.existsSync(file)) throw new Error(`已存在同名文章:${v.slug}.md`);
        fs.writeFileSync(file, buildPostContent(v), 'utf8');
        onSaved?.();
        p.dispose();
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`已创建 ${v.slug}.md`);
      }
    } catch (e) {
      p.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}

/** 兼容旧入口 */
export function openNewPostForm(refreshPosts: () => void): void {
  openPostEditor(refreshPosts);
}
