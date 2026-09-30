import * as vscode from 'vscode';
import { readSiteConfig, updateSiteConfig } from '../core';
import { copyImageIn, siteImageRef } from '../core/images';
import { getProfile, pickImages } from '../util';
import { pageShell, SCRIPT_PREAMBLE } from './shared';

const PAGE_LABELS: [string, string][] = [
  ['archive', '归档'],
  ['tags', '标签'],
  ['categories', '分类'],
  ['links', '链接'],
  ['notFound', '404'],
];

const TEXT_MODES = ['auto', 'on-dark', 'on-light'] as const;

function body(): string {
  return `
<h1>站点信息</h1>
<div class="sub">写回当前档案的 site.ts,保留注释与格式;dev server 会热更新</div>

<h2>基本</h2>
<label class="f">站点名称</label><input type="text" id="siteName">
<div class="row">
  <div><label class="f">站点英文名</label><input type="text" id="siteNameEn"></div>
  <div><label class="f">作者</label><input type="text" id="author"></div>
</div>
<label class="f">签名(长)</label><textarea id="bio"></textarea>
<label class="f">简介(短)</label><textarea id="shortBio"></textarea>
<div class="hint">出现在页脚和首页介绍</div>
<div class="row">
  <div><label class="f">邮箱</label><input type="text" id="email"></div>
  <div><label class="f">站点 URL</label><input type="text" id="siteUrl"></div>
</div>

<h2>头像</h2>
<label class="f">头像路径</label>
<div class="imgrow">
  <input type="text" id="avatar" placeholder="/images/avatar.svg">
  <button class="small pick" data-field="avatar">选择图片…</button>
</div>
<label class="f">裁切焦点</label>
<input type="text" id="avatarPosition" placeholder="object-position,竖向人像建议 center 30%">

<h2>当前状态</h2>
<div class="row">
  <div>
    <select id="statusMode">
      <option value="writing">writing</option>
      <option value="building">building</option>
      <option value="available">available</option>
      <option value="offline">offline</option>
    </select>
  </div>
  <div><input type="text" id="statusText" placeholder="状态描述"></div>
</div>

<h2>首页 Hero</h2>
<label class="f">背景图</label>
<div class="imgrow">
  <input type="text" id="heroBackground" placeholder="留空则用主题背景色">
  <button class="small pick" data-field="heroBackground">选择图片…</button>
</div>
<label class="f">图上文字模式</label>
<select id="heroTextMode">
  ${TEXT_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}
</select>
<div class="hint">auto = 按图片亮度自动;on-dark = 浅字;on-light = 深字</div>

<h2>页面背景</h2>
${PAGE_LABELS.map(
  ([key, label]) => `
<label class="f">${label}页</label>
<div class="imgrow">
  <input type="text" id="bd_${key}" placeholder="留空则无背景图">
  <button class="small pick" data-field="bd_${key}">选择图片…</button>
</div>`,
).join('')}

<h2>页面文案</h2>
${PAGE_LABELS.map(
  ([key, label]) => `
<label class="f">${label}页标题 / 描述</label>
<input type="text" id="pg_${key}_title" placeholder="标题">
<textarea id="pg_${key}_description" placeholder="描述" style="margin-top:6px"></textarea>`,
).join('')}

<div class="error" id="error"></div>
<div class="ok" id="ok">已写回 site.ts</div>
<div class="actions"><button class="primary" id="submit">保存</button></div>
`;
}

function script(): string {
  const plainFields = [
    'siteName',
    'siteNameEn',
    'author',
    'bio',
    'shortBio',
    'email',
    'siteUrl',
    'avatar',
    'avatarPosition',
    'statusMode',
    'statusText',
    'heroBackground',
    'heroTextMode',
  ];
  return (
    SCRIPT_PREAMBLE +
    `
const PLAIN = ${JSON.stringify(plainFields)};
const PAGES = ${JSON.stringify(PAGE_LABELS.map(([k]) => k))};
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const v = msg.values;
    for (const f of PLAIN) $(f).value = v[f] ?? '';
    for (const k of PAGES) {
      if (k !== 'notFound' && $('bd_' + k)) $('bd_' + k).value = (v.backdrops ?? {})[k] ?? '';
      const pg = (v.pages ?? {})[k];
      if (pg) {
        $('pg_' + k + '_title').value = pg.title ?? '';
        $('pg_' + k + '_description').value = pg.description ?? '';
      }
    }
  } else if (msg.type === 'imagePicked') {
    $(msg.field).value = msg.ref;
  } else if (msg.type === 'saved') {
    $('ok').style.display = 'block';
    setTimeout(() => { $('ok').style.display = 'none'; }, 2500);
    showError('');
  } else if (msg.type === 'error') {
    showError(msg.message);
  }
});
document.querySelectorAll('button.pick').forEach((b) => {
  b.addEventListener('click', () => vscode.postMessage({ type: 'pickImage', field: b.dataset.field }));
});
$('submit').addEventListener('click', () => {
  const values = {};
  for (const f of PLAIN) values[f] = $(f).value.trim();
  values.backdrops = {};
  values.pages = {};
  for (const k of PAGES) {
    if (k !== 'notFound' && $('bd_' + k)) values.backdrops[k] = $('bd_' + k).value.trim();
    values.pages[k] = {
      title: $('pg_' + k + '_title').value.trim(),
      description: $('pg_' + k + '_description').value.trim(),
    };
  }
  vscode.postMessage({ type: 'submit', values });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openSiteConfigForm(): void {
  const profile = getProfile();
  const panel = vscode.window.createWebviewPanel(
    'towardsLightSiteConfig',
    '站点信息',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  panel.webview.html = pageShell('站点信息', body(), script());
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({ type: 'init', values: readSiteConfig(profile.siteFile) });
      } else if (msg.type === 'pickImage') {
        if (!profile.imagesDir) throw new Error('当前档案没有 images/ 目录');
        const picked = await pickImages(false);
        if (!picked?.length) return;
        const name = copyImageIn(picked[0], profile.imagesDir);
        panel.webview.postMessage({ type: 'imagePicked', field: msg.field, ref: siteImageRef(name) });
      } else if (msg.type === 'submit') {
        const changed = updateSiteConfig(profile.siteFile, msg.values);
        panel.webview.postMessage({ type: 'saved' });
        vscode.window.showInformationMessage(`site.ts 已更新(${changed} 个字段)`);
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
