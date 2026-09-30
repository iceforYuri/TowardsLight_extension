import * as vscode from 'vscode';
import { readSiteConfig, updateSiteConfig } from '../core';
import { copyImageIn, siteImageRef } from '../core/images';
import { getProfile, pickImages, resolveImageUri } from '../util';
import { cardHtml, imageRowHtml, pageShell, SCRIPT_PREAMBLE } from './shared';

const PAGE_LABELS: [string, string][] = [
  ['archive', '归档'],
  ['tags', '标签'],
  ['categories', '分类'],
  ['links', '链接'],
  ['notFound', '404'],
];

const STATUS_MODES: [string, string, string][] = [
  ['writing', '写作中', '#5b8def'],
  ['building', '构建中', '#d6a36a'],
  ['available', '有空', '#3fb950'],
  ['offline', '离线', '#8b949e'],
];

const TEXT_MODES: [string, string][] = [
  ['auto', '自动'],
  ['on-dark', '浅字'],
  ['on-light', '深字'],
];

function body(): string {
  const basic = `
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
</div>`;

  const avatar = `
<label class="f">头像路径</label>
${imageRowHtml('avatar', '/images/avatar.svg')}
<label class="f">裁切焦点</label>
<input type="text" id="avatarPosition" placeholder="object-position,竖向人像建议 center 30%">`;

  const status = `
<input type="hidden" id="statusMode">
<div class="seg" id="statusSeg">
  ${STATUS_MODES.map(
    ([v, label, color]) =>
      `<button type="button" data-value="${v}"><span class="dot" style="background:${color}"></span>${label}</button>`,
  ).join('')}
</div>
<label class="f">状态描述</label>
<input type="text" id="statusText" placeholder="如:正在把这个博客迁到 Astro">`;

  const hero = `
<label class="f">背景图</label>
${imageRowHtml('heroBackground', '留空则用主题背景色')}
<label class="f">图上文字模式</label>
<input type="hidden" id="heroTextMode">
<div class="seg" id="heroTextModeSeg">
  ${TEXT_MODES.map(([v, label]) => `<button type="button" data-value="${v}">${label}</button>`).join('')}
</div>
<div class="hint">auto = 按图片亮度自动;on-dark = 浅字;on-light = 深字</div>`;

  const backdrops = PAGE_LABELS.filter(([k]) => k !== 'notFound')
    .map(
      ([key, label]) => `
<label class="f">${label}页</label>
${imageRowHtml(`bd_${key}`, '留空则无背景图')}`,
    )
    .join('');

  const pages = PAGE_LABELS.map(
    ([key, label]) => `
<label class="f">${label}页标题 / 描述</label>
<input type="text" id="pg_${key}_title" placeholder="标题">
<textarea id="pg_${key}_description" placeholder="描述" style="margin-top:6px"></textarea>`,
  ).join('');

  return `
<div class="kicker">Towards Light · Studio</div>
<h1>站点信息</h1>
<p class="sub">写回当前档案的 site.ts,保留注释与格式;dev server 会热更新,保存后即可在预览里看到效果。</p>

${cardHtml('01', '基本', '站点名称、作者与对外展示的签名', basic)}
${cardHtml('02', '头像', '出现在首页 Hero 与页脚', avatar)}
${cardHtml('03', '当前状态', '首页 Hero 上方的状态徽章', status)}
${cardHtml('04', '首页 Hero', '背景图与图上文字的明暗处理', hero)}
${cardHtml('05', '页面背景', '各内容页顶部视觉区域的背景图', backdrops)}
${cardHtml('06', '页面文案', '各内容页的标题与描述', pages)}

<div class="error" id="error"></div>
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
  const thumbFields = ['avatar', 'heroBackground', ...PAGE_LABELS.filter(([k]) => k !== 'notFound').map(([k]) => `bd_${k}`)];
  return (
    SCRIPT_PREAMBLE +
    `
const PLAIN = ${JSON.stringify(plainFields)};
const PAGES = ${JSON.stringify(PAGE_LABELS.map(([k]) => k))};
const THUMBS = ${JSON.stringify(thumbFields)};

// 分段选择器:点击写隐藏 input 并触发 input(供状态持久化);input 变化时同步 UI
function segInit(segId, inputId, fallback) {
  const seg = $(segId);
  const input = $(inputId);
  const sync = () => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.value === input.value));
  };
  seg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = b.dataset.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  input.addEventListener('input', sync);
  if (!input.value) input.value = fallback;
  sync();
}
segInit('statusSeg', 'statusMode', 'building');
segInit('heroTextModeSeg', 'heroTextMode', 'auto');

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const v = msg.values;
    for (const f of PLAIN) $(f).value = v[f] ?? '';
    $('statusMode').dispatchEvent(new Event('input', { bubbles: true }));
    $('heroTextMode').dispatchEvent(new Event('input', { bubbles: true }));
    for (const k of PAGES) {
      if (k !== 'notFound' && $('bd_' + k)) $('bd_' + k).value = (v.backdrops ?? {})[k] ?? '';
      const pg = (v.pages ?? {})[k];
      if (pg) {
        $('pg_' + k + '_title').value = pg.title ?? '';
        $('pg_' + k + '_description').value = pg.description ?? '';
      }
    }
    restoreState();
    THUMBS.forEach(bindThumb);
  } else if (msg.type === 'imagePicked') {
    $(msg.field).value = msg.ref;
    $(msg.field).dispatchEvent(new Event('input', { bubbles: true }));
    if (msg.uri) setThumb(msg.field, msg.uri);
  } else if (msg.type === 'saved') {
    $('submit').disabled = false;
    $('submit').textContent = '保存';
    toast('已写回 site.ts(' + msg.changed + ' 个字段)');
    showError('');
  } else if (msg.type === 'error') {
    $('submit').disabled = false;
    $('submit').textContent = '保存';
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
  $('submit').disabled = true;
  $('submit').textContent = '保存中…';
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
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = pageShell('站点信息', body(), script(), panel.webview.cspSource);
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({ type: 'init', values: readSiteConfig(profile.siteFile) });
      } else if (msg.type === 'resolveImage') {
        panel.webview.postMessage({
          type: 'imageUri',
          field: msg.field,
          uri: resolveImageUri(panel.webview, profile, msg.value),
        });
      } else if (msg.type === 'pickImage') {
        if (!profile.imagesDir) throw new Error('当前档案没有 images/ 目录');
        const picked = await pickImages(false);
        if (!picked?.length) return;
        const name = copyImageIn(picked[0], profile.imagesDir);
        const ref = siteImageRef(name);
        panel.webview.postMessage({
          type: 'imagePicked',
          field: msg.field,
          ref,
          uri: resolveImageUri(panel.webview, profile, ref),
        });
      } else if (msg.type === 'submit') {
        const changed = updateSiteConfig(profile.siteFile, msg.values);
        panel.webview.postMessage({ type: 'saved', changed });
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
