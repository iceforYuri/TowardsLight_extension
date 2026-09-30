import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { buildPostContent, listPosts, readCategories, SLUG_PATTERN } from '../core';
import { articleImageDir, articleImageRef, copyImageIn } from '../core/images';
import { listImages, ProfileInfo } from '../core/profile';
import { getProfile, pickImages } from '../util';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  return `
<h1>新建文章</h1>
<div class="sub">生成到当前档案的 posts 目录,归档、标签、分类页自动收录</div>

<label class="f">标题 <span class="req">*</span></label>
<input type="text" id="title" autofocus>

<div class="row">
  <div>
    <label class="f">文件名(slug)<span class="req">*</span></label>
    <input type="text" id="slug" placeholder="英文小写加连字符">
    <div class="hint">就是 URL:/posts/&lt;slug&gt;</div>
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

<div class="row">
  <div>
    <label class="f">封面</label>
    <select id="cover">
      <option value="">无封面</option>
      <option value="__pick__">从电脑选择…</option>
    </select>
    <div class="hint">选本地图片会复制到 posts/image/&lt;slug&gt;/ 并按相对路径引用</div>
  </div>
  <div>
    <label class="f">封面描述</label>
    <input type="text" id="coverAlt" placeholder="选封面时建议填写">
  </div>
</div>

<div class="checks">
  <label><input type="checkbox" id="draft" checked> 存为草稿(不进入构建)</label>
</div>

<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">创建并打开</button></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
function slugify(t) {
  return t.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
let slugTouched = false;
$('slug').addEventListener('input', () => { slugTouched = true; });
$('title').addEventListener('input', (e) => {
  if (!slugTouched) $('slug').value = slugify(e.target.value);
});
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
    restoreState();
  } else if (msg.type === 'coverPicked') {
    const sel = $('cover');
    const o = document.createElement('option');
    o.value = msg.ref;
    o.textContent = msg.ref + '(已复制)';
    sel.appendChild(o);
    sel.value = msg.ref;
    showError('');
  } else if (msg.type === 'error') {
    showError(msg.message);
    $('cover').value = '';
  }
});
$('cover').addEventListener('change', (e) => {
  if (e.target.value === '__pick__') {
    vscode.postMessage({ type: 'pickCover', slug: $('slug').value.trim() });
  }
});
$('submit').addEventListener('click', () => {
  showError('');
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
      draft: $('draft').checked,
    },
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openNewPostForm(refreshPosts: () => void): void {
  const profile: ProfileInfo = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightNewPost',
    '新建文章',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('新建文章', body(), script());

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'ready') {
      const fromMeta = readCategories(profile.siteFile).map((c) => c.name);
      const fromPosts = listPosts(profile.postsDir).map((p) => p.category);
      const categories = [...new Set([...fromMeta, ...fromPosts])].filter(Boolean);
      panel.webview.postMessage({ type: 'init', categories, covers: listImages(profile.imagesDir) });
      return;
    }
    if (msg.type !== 'submit') {
      if (msg.type === 'pickCover') {
        try {
          if (!SLUG_PATTERN.test(msg.slug ?? '')) {
            throw new Error('先填好 slug(小写字母/数字/连字符),封面要按它归档');
          }
          const picked = await pickImages(false);
          if (!picked?.length) {
            panel.webview.postMessage({ type: 'error', message: '' });
            return;
          }
          const name = copyImageIn(picked[0], articleImageDir(profile.postsDir, msg.slug));
          panel.webview.postMessage({ type: 'coverPicked', ref: articleImageRef(msg.slug, name) });
        } catch (e) {
          panel.webview.postMessage({ type: 'error', message: (e as Error).message });
        }
      }
      return;
    }
    const v = msg.value;
    try {
      if (!v.title) throw new Error('标题不能为空');
      if (!v.description) throw new Error('描述不能为空');
      if (!v.category) throw new Error('分类不能为空');
      if (!SLUG_PATTERN.test(v.slug)) throw new Error('slug 只能包含小写字母、数字和连字符');
      const file = path.join(profile.postsDir, `${v.slug}.md`);
      if (fs.existsSync(file)) throw new Error(`已存在同名文章:${v.slug}.md`);
      fs.writeFileSync(file, buildPostContent(v), 'utf8');
      refreshPosts();
      panel.dispose();
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`已创建 ${v.slug}.md`);
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
