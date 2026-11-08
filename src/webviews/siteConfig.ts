import * as vscode from 'vscode';
import { readIcons, readSiteConfig, updateSiteConfig } from '../core';
import { copyImageIn, siteImageRef } from '../core/images';
import { getProfile, assertProfileUnchanged, pickImages, resolveImageUri } from '../util';
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

const THEME_MODES: [string, string, string][] = [
  ['system', '跟随系统', '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'],
  ['light', '明亮', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'],
  ['dark', '深色', '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>'],
];

function body(): string {
  const basic = `
<label class="f">站点名称</label><input type="text" id="siteName">
<div class="row">
  <div><label class="f">站点英文名</label><input type="text" id="siteNameEn"></div>
  <div><label class="f">作者</label><input type="text" id="author"></div>
</div>
<label class="f">签名(长)</label><textarea id="bio"></textarea>
<div class="hint">首页 Hero 的个人介绍,可以写两三句</div>
<label class="f">站点签名(短)</label><input type="text" id="shortBio">
<div class="hint">一句话,用在浏览器标题后缀和页脚署名</div>
<div class="row">
  <div><label class="f">邮箱</label><input type="text" id="email"></div>
  <div><label class="f">站点 URL</label><input type="text" id="siteUrl"></div>
</div>
<label class="f">默认主题</label>
<input type="hidden" id="themeDefault">
<div class="seg" id="themeSeg">
  ${THEME_MODES.map(([v, label, icon]) => `<button type="button" data-value="${v}">${icon}${label}</button>`).join('')}
</div>
<div class="hint">访客的本地选择优先;此处只决定新访客首屏</div>`;

  const avatar = `
<label class="f">头像路径</label>
${imageRowHtml('avatar', '/images/avatar.svg')}
<div class="hint">图片会复制到档案的 images/ 目录,按 /images/… 引用</div>
<label class="f">裁切焦点</label>
<input type="text" id="avatarPosition" placeholder="默认 center center">
<div class="hint">头像以正方形裁切显示。人物照如果脸偏上,填 center 20% 让焦点上移;横向图片填 left center / right center 决定保留哪一侧。语法同 CSS object-position</div>`;

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

  const navActions = `
<div class="navlink-list" id="navActions"></div>
<input type="hidden" id="socialLinksJson">
<button class="small" id="navAdd" type="button">＋ 添加导航按钮</button>
<div class="hint">写入 site.ts 的 socialLinks:顶部导航功能区显示这些入口;桌面端隐藏 RSS,移动端与页脚显示全部。图标名需要存在于 Icon.astro。</div>`;

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
<style>
.navlink-list { display: grid; gap: 7px; margin-bottom: 10px; }
.navlink-row { display: grid; grid-template-columns: 34px minmax(90px, 0.85fr) minmax(170px, 1.45fr) minmax(120px, 0.7fr) auto; gap: 7px; align-items: center; }
.navlink-ico { width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 8px; display: grid; place-items: center; color: var(--muted); background: var(--input-bg); }
.navlink-ico svg { width: 16px; height: 16px; }
.navlink-ops { display: flex; gap: 4px; }
.navlink-ops .small { padding: 2px 7px; }
.navlink-empty { color: var(--faint); border: 1px dashed var(--line); border-radius: 9px; padding: 13px; text-align: center; }
@media (max-width: 760px) {
  .navlink-row { grid-template-columns: 34px 1fr auto; }
  .navlink-row input, .navlink-row select { grid-column: 2; }
  .navlink-ops { grid-row: 1; grid-column: 3; }
}
</style>
<div class="kicker">Towards Light · Studio</div>
<h1>站点信息</h1>
<p class="sub">写回当前档案的 site.ts,保留注释与格式;dev server 会热更新,保存后即可在预览里看到效果。</p>

<div class="layout">
<nav class="toc">
  <a href="#c1"><span class="ti">01</span>基本</a>
  <a href="#c2"><span class="ti">02</span>头像</a>
  <a href="#c3"><span class="ti">03</span>当前状态</a>
  <a href="#c4"><span class="ti">04</span>导航按钮</a>
  <a href="#c5"><span class="ti">05</span>首页 Hero</a>
  <a href="#c6"><span class="ti">06</span>页面背景</a>
  <a href="#c7"><span class="ti">07</span>页面文案</a>
</nav>
<div class="main">
${cardHtml('c1', '01', '基本', '站点名称、作者与对外展示的签名', basic)}
${cardHtml('c2', '02', '头像', '出现在首页 Hero 与页脚', avatar)}
${cardHtml('c3', '03', '当前状态', '首页 Hero 上方的状态徽章', status)}
${cardHtml('c4', '04', '导航按钮', '顶部导航功能区的 GitHub、RSS 与模板入口', navActions)}
${cardHtml('c5', '05', '首页 Hero', '背景图与图上文字的明暗处理', hero)}
${cardHtml('c6', '06', '页面背景', '各内容页顶部视觉区域的背景图', backdrops)}
${cardHtml('c7', '07', '页面文案', '各内容页的标题与描述', pages)}

<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">保存</button></div>
</div>
</div>
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
    'themeDefault',
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
segInit('themeSeg', 'themeDefault', 'system');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let navLinks = [];
let navIcons = [];
function svgOf(body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}
function navIconBody(name) {
  return (navIcons.find((i) => i.name === name) || {}).body || '<circle cx="12" cy="12" r="8"/>';
}
function syncNavJson() {
  const next = JSON.stringify(navLinks);
  if ($('socialLinksJson').value !== next) {
    $('socialLinksJson').value = next;
    $('socialLinksJson').dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function renderNavLinks() {
  const wrap = $('navActions');
  if (!navLinks.length) {
    wrap.innerHTML = '<div class="navlink-empty">还没有导航按钮</div>';
    syncNavJson();
    return;
  }
  wrap.innerHTML = navLinks.map((l, i) => {
    const options = navIcons.map((ic) => '<option value="' + esc(ic.name) + '"' + (ic.name === l.icon ? ' selected' : '') + '>' + esc(ic.name) + '</option>').join('');
    return '<div class="navlink-row" data-i="' + i + '">'
      + '<span class="navlink-ico">' + svgOf(navIconBody(l.icon)) + '</span>'
      + '<input type="text" id="navLabel_' + i + '" data-nav-field="label" value="' + esc(l.label) + '" placeholder="名称">'
      + '<input type="text" id="navHref_' + i + '" data-nav-field="href" value="' + esc(l.href) + '" placeholder="https://... 或 /rss.xml">'
      + '<select id="navIcon_' + i + '" data-nav-field="icon">' + options + '</select>'
      + '<span class="navlink-ops">'
      + '<button class="small" type="button" data-nav-move="-1" title="上移">↑</button>'
      + '<button class="small" type="button" data-nav-move="1" title="下移">↓</button>'
      + '<button class="small danger" type="button" data-nav-del title="删除">×</button>'
      + '</span></div>';
  }).join('');
  syncNavJson();
}
function setNavLinks(next) {
  navLinks = Array.isArray(next) ? next.map((l) => ({ label: l.label || '', href: l.href || '', icon: l.icon || 'link' })) : [];
  renderNavLinks();
}
function navError() {
  const seen = new Set();
  for (const l of navLinks) {
    if (!l.label.trim()) return '导航按钮名称不能为空';
    if (!l.href.trim()) return '导航按钮 URL 不能为空';
    if (!l.icon.trim()) return '导航按钮图标不能为空';
    if (seen.has(l.href.trim())) return '导航按钮 URL 重复:' + l.href.trim();
    seen.add(l.href.trim());
  }
  return '';
}
$('navActions').addEventListener('input', (e) => {
  const row = e.target.closest('.navlink-row');
  if (!row) return;
  const i = Number(row.dataset.i);
  const field = e.target.dataset.navField;
  if (!navLinks[i] || !field) return;
  navLinks[i][field] = e.target.value;
  if (field === 'icon') {
    const ico = row.querySelector('.navlink-ico');
    if (ico) ico.innerHTML = svgOf(navIconBody(e.target.value));
  }
  syncNavJson();
});
$('navActions').addEventListener('change', (e) => {
  if (e.target.matches('[data-nav-field]')) e.target.dispatchEvent(new Event('input', { bubbles: true }));
});
$('navActions').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const row = e.target.closest('.navlink-row');
  if (!btn || !row) return;
  const i = Number(row.dataset.i);
  if (!navLinks[i]) return;
  if (btn.dataset.navMove) {
    const j = i + Number(btn.dataset.navMove);
    if (j < 0 || j >= navLinks.length) return;
    const tmp = navLinks[i];
    navLinks[i] = navLinks[j];
    navLinks[j] = tmp;
    renderNavLinks();
  } else if (btn.hasAttribute('data-nav-del')) {
    navLinks.splice(i, 1);
    renderNavLinks();
  }
});
$('navAdd').addEventListener('click', () => {
  navLinks.push({ label: '新入口', href: 'https://', icon: 'link' });
  renderNavLinks();
});

// 左侧目录 scrollspy
const tocLinks = [...document.querySelectorAll('.toc a')];
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) {
      tocLinks.forEach((a) => a.classList.toggle('on', a.hash === '#' + en.target.id));
    }
  }
}, { rootMargin: '-15% 0px -70% 0px' });
tocLinks.forEach((a) => {
  const sec = document.querySelector(a.hash);
  if (sec) io.observe(sec);
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const v = msg.values;
    navIcons = msg.icons || [];
    setNavLinks(v.socialLinks || []);
    for (const f of PLAIN) $(f).value = v[f] ?? '';
    $('statusMode').dispatchEvent(new Event('input', { bubbles: true }));
    $('heroTextMode').dispatchEvent(new Event('input', { bubbles: true }));
    $('themeDefault').dispatchEvent(new Event('input', { bubbles: true }));
    for (const k of PAGES) {
      if (k !== 'notFound' && $('bd_' + k)) $('bd_' + k).value = (v.backdrops ?? {})[k] ?? '';
      const pg = (v.pages ?? {})[k];
      if (pg) {
        $('pg_' + k + '_title').value = pg.title ?? '';
        $('pg_' + k + '_description').value = pg.description ?? '';
      }
    }
    // 文件值打底;草稿只在文件没变过时恢复,否则以文件为准
    const restored = restoreStateIfFresh(JSON.stringify(v));
    if (restored && $('socialLinksJson').value) {
      try { setNavLinks(JSON.parse($('socialLinksJson').value)); } catch { /* 保持文件值 */ }
    }
    THUMBS.forEach(bindThumb);
  } else if (msg.type === 'imagePicked') {
    $(msg.field).value = msg.ref;
    $(msg.field).dispatchEvent(new Event('input', { bubbles: true }));
    if (msg.uri) setThumb(msg.field, msg.uri);
  } else if (msg.type === 'saved') {
    $('submit').disabled = false;
    $('submit').textContent = '保存';
    vscode.setState({});
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
  showError('');
  const navIssue = navError();
  if (navIssue) return showError(navIssue);
  const values = {};
  for (const f of PLAIN) values[f] = $(f).value.trim();
  values.socialLinks = navLinks.map((l) => ({ label: l.label.trim(), href: l.href.trim(), icon: l.icon.trim() }));
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

let panel: vscode.WebviewPanel | undefined;
let profile: ReturnType<typeof getProfile> | undefined;

function renderShell(): void {
  if (!panel || !profile) return;
  panel.webview.html = pageShell(
    '站点信息',
    body(),
    script(),
    panel.webview.cspSource,
    profile.dir.split(/[\\/]/).pop() ?? '',
  );
}

export function openSiteConfigForm(): void {
  if (panel) {
    // 绑定被切过就重载到新档案,否则保留现场(未保存的草稿不丢)
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
    'towardsLightSiteConfig',
    '站点信息',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  renderShell();
  panel.onDidDispose(() => {
    panel = undefined;
    profile = undefined;
  });
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel || !profile) return;
    const p = panel;
    try {
      if (msg.type === 'ready') {
        p.webview.postMessage({ type: 'init', values: readSiteConfig(profile.siteFile), icons: readIcons(profile.iconFile) });
      } else if (msg.type === 'refresh') {
        profile = getProfile();
        renderShell();
      } else if (msg.type === 'resolveImage') {
        p.webview.postMessage({
          type: 'imageUri',
          field: msg.field,
          uri: resolveImageUri(p.webview, profile, msg.value),
        });
      } else if (msg.type === 'pickImage') {
        if (!profile.imagesDir) throw new Error('当前档案没有 images/ 目录');
        const picked = await pickImages(false);
        if (!picked?.length) return;
        const name = copyImageIn(picked[0], profile.imagesDir);
        const ref = siteImageRef(name);
        p.webview.postMessage({
          type: 'imagePicked',
          field: msg.field,
          ref,
          uri: resolveImageUri(p.webview, profile, ref),
        });
      } else if (msg.type === 'submit') {
        assertProfileUnchanged(profile);
        const changed = updateSiteConfig(profile.siteFile, msg.values);
        p.webview.postMessage({ type: 'saved', changed });
      }
    } catch (e) {
      p.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
