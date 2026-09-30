import crypto from 'node:crypto';

/**
 * 表单 webview 的公共外壳:CSP + 「拾光集 Studio」设计系统。
 * 视觉 DNA 与博客一致:衬线展示标题、等宽元信息、柔和卡片、低存在感动效;
 * 颜色全部桥接 VS Code 主题变量,跟随编辑器明暗主题。
 */
export function pageShell(title: string, body: string, script: string, cspSource = ''): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const imgSrc = cspSource ? `img-src ${cspSource} data:;` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root {
  --fg: var(--vscode-foreground);
  --bg: var(--vscode-editor-background);
  --muted: color-mix(in srgb, var(--fg) 58%, transparent);
  --faint: color-mix(in srgb, var(--fg) 38%, transparent);
  --line: color-mix(in srgb, var(--fg) 10%, transparent);
  --line-strong: color-mix(in srgb, var(--fg) 18%, transparent);
  --raise: color-mix(in srgb, var(--fg) 3%, transparent);
  --raise-2: color-mix(in srgb, var(--fg) 6%, transparent);
  --accent: var(--vscode-textLink-foreground, #bc6353);
  --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
  --focus: var(--vscode-focusBorder, var(--accent));
  --err: var(--vscode-errorForeground, #e05252);
  --ok: var(--vscode-testing-iconPassed, #3fb950);
  --input-bg: var(--vscode-input-background, var(--raise));
  --serif: 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', Georgia, serif;
  --mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Cascadia Code', Consolas, monospace;
  --sans: var(--vscode-font-family);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  margin: 0; padding: 36px 28px 96px;
  color: var(--fg); background: var(--bg);
  font-family: var(--sans); font-size: 13px; line-height: 1.6;
}
.wrap { max-width: 660px; margin: 0 auto; }

/* ---- 页眉 ---- */
.kicker {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--accent); margin-bottom: 10px;
  display: flex; align-items: center; gap: 10px;
}
.kicker::after { content: ''; flex: 0 0 42px; height: 1px; background: var(--accent); opacity: 0.5; }
h1 {
  font-family: var(--serif); font-size: 30px; font-weight: 600;
  line-height: 1.25; letter-spacing: 0.01em; margin: 0 0 8px;
}
.sub { color: var(--muted); font-size: 12.5px; margin: 0 0 30px; max-width: 52ch; }

/* ---- 卡片分区 ---- */
.card {
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--raise); padding: 20px 22px 22px; margin: 0 0 16px;
  animation: rise 0.55s var(--ease) both;
}
.card:nth-of-type(1) { animation-delay: 0.05s; }
.card:nth-of-type(2) { animation-delay: 0.10s; }
.card:nth-of-type(3) { animation-delay: 0.15s; }
.card:nth-of-type(4) { animation-delay: 0.20s; }
.card:nth-of-type(5) { animation-delay: 0.25s; }
.card:nth-of-type(6) { animation-delay: 0.30s; }
@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
.card-head { display: flex; align-items: baseline; gap: 12px; margin: 0 0 16px; }
.card-idx {
  font-family: var(--mono); font-size: 11px; color: var(--accent);
  letter-spacing: 0.08em; flex: none;
}
.card-title { font-family: var(--serif); font-size: 16.5px; font-weight: 600; margin: 0; }
.card-hint { font-size: 11.5px; color: var(--faint); margin: 2px 0 0; }

/* ---- 字段 ---- */
label.f {
  display: block; margin: 16px 0 6px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
  color: var(--muted); text-transform: uppercase;
}
.card label.f:first-of-type { margin-top: 0; }
label.f .req { color: var(--err); text-transform: none; letter-spacing: 0; }
input[type=text], input[type=url], textarea, select {
  width: 100%; padding: 7px 10px; font: inherit;
  color: var(--vscode-input-foreground, var(--fg));
  background: var(--input-bg);
  border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 7px;
  transition: border-color 0.18s var(--ease), box-shadow 0.18s var(--ease);
}
input:hover, textarea:hover, select:hover { border-color: var(--line-strong); }
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: none; border-color: var(--focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 22%, transparent);
}
textarea { resize: vertical; min-height: 58px; }
select { appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%); background-position: calc(100% - 16px) 55%, calc(100% - 11px) 55%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 30px; }
.row { display: flex; gap: 14px; }
.row > div { flex: 1; min-width: 0; }
.hint { color: var(--faint); font-size: 11.5px; margin-top: 5px; font-family: var(--mono); letter-spacing: 0.01em; }

/* ---- 分段选择器 ---- */
.seg { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 9px; background: color-mix(in srgb, var(--fg) 4%, transparent); width: fit-content; max-width: 100%; flex-wrap: wrap; }
.seg button {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 13px; font: inherit; font-size: 12.5px; cursor: pointer;
  border: 0; border-radius: 6px; background: transparent; color: var(--muted);
  transition: background 0.18s var(--ease), color 0.18s var(--ease), transform 0.12s var(--ease);
}
.seg button:hover { color: var(--fg); }
.seg button:active { transform: scale(0.96); }
.seg button.sel {
  background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--line-strong);
}
.seg .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }

/* ---- check-card ---- */
.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
.checks.one { grid-template-columns: 1fr; }
.check-card {
  display: flex; align-items: center; gap: 10px; padding: 10px 13px;
  border: 1px solid var(--line); border-radius: 9px; cursor: pointer;
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease);
  user-select: none; margin: 0; text-transform: none; letter-spacing: 0; font-size: 12.5px; font-weight: 400; color: var(--fg);
}
.check-card:hover { border-color: var(--line-strong); }
.check-card input { position: absolute; opacity: 0; pointer-events: none; }
.check-card .box {
  width: 16px; height: 16px; border-radius: 5px; flex: none;
  border: 1.5px solid var(--line-strong); display: grid; place-items: center;
  transition: background 0.18s var(--ease), border-color 0.18s var(--ease);
}
.check-card .box svg { width: 11px; height: 11px; stroke: var(--vscode-button-foreground, #fff); stroke-width: 3; fill: none; opacity: 0; transform: scale(0.4); transition: opacity 0.15s var(--ease), transform 0.2s var(--ease); }
.check-card:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.check-card:has(input:checked) .box { background: var(--accent); border-color: var(--accent); }
.check-card:has(input:checked) .box svg { opacity: 1; transform: none; }
.check-card:has(input:focus-visible) { box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 22%, transparent); }

/* ---- 图片字段 + 缩略图 ---- */
.imgrow { display: flex; gap: 8px; align-items: center; }
.imgrow .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.thumb {
  width: 44px; height: 44px; border-radius: 8px; flex: none;
  border: 1px solid var(--line); background: color-mix(in srgb, var(--fg) 5%, transparent);
  display: grid; place-items: center; overflow: hidden;
  transition: border-color 0.18s var(--ease), opacity 0.3s var(--ease);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity 0.3s var(--ease); }
.thumb img.on { opacity: 1; }
.thumb svg { width: 17px; height: 17px; stroke: var(--faint); stroke-width: 1.6; fill: none; }
.thumb.has { border-color: var(--line-strong); }

/* ---- 图标选择器 ---- */
.icon-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 5px;
  margin-top: 8px; max-height: 236px; overflow-y: auto; padding: 8px;
  border: 1px solid var(--line); border-radius: 9px;
  background: color-mix(in srgb, var(--fg) 2%, transparent);
}
.icon-cell {
  display: flex; align-items: center; justify-content: center; aspect-ratio: 1;
  border-radius: 7px; cursor: pointer; border: 1px solid transparent; color: var(--muted);
  transition: transform 0.16s var(--ease), border-color 0.16s var(--ease), background 0.16s var(--ease), color 0.16s var(--ease);
}
.icon-cell:hover { border-color: var(--line-strong); color: var(--fg); transform: scale(1.14); background: var(--raise-2); }
.icon-cell.sel { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); transform: scale(1.06); }
.icon-cell svg { width: 19px; height: 19px; }

/* ---- 色板 ---- */
.tones { display: flex; gap: 10px; margin-top: 6px; }
.tone {
  flex: 1; display: flex; align-items: center; gap: 11px; padding: 11px 13px;
  border-radius: 9px; cursor: pointer; border: 1px solid var(--line);
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease), transform 0.12s var(--ease);
}
.tone:hover { border-color: var(--line-strong); }
.tone:active { transform: scale(0.98); }
.tone.sel { border-color: var(--accent); background: var(--accent-soft); }
.tone .sw { width: 26px; height: 26px; border-radius: 8px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); }
.tone .tn { font-family: var(--mono); font-size: 12px; }
.tone .th { display: block; font-size: 11px; color: var(--faint); font-family: var(--sans); }

/* ---- 实时预览胶囊 ---- */
.preview-chip {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 14px;
  padding: 7px 14px 7px 9px; border-radius: 999px;
  border: 1px solid var(--line-strong); background: var(--vscode-editor-background, var(--bg));
  font-size: 12.5px; transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.preview-chip svg { width: 15px; height: 15px; }
.preview-chip .pc-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- 反馈与动作 ---- */
.error {
  color: var(--err); margin: 14px 0 0; display: none; font-size: 12.5px;
  padding: 9px 13px; border: 1px solid color-mix(in srgb, var(--err) 35%, transparent);
  border-radius: 8px; background: color-mix(in srgb, var(--err) 8%, transparent);
}
.error.shake { animation: shake 0.4s var(--ease); }
@keyframes shake {
  0%, 100% { transform: none; }
  25% { transform: translateX(-5px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}
.actions { margin-top: 26px; display: flex; gap: 12px; align-items: center; }
button.primary {
  position: relative; padding: 9px 26px; font: inherit; font-weight: 600; cursor: pointer;
  border: 0; border-radius: 8px; overflow: hidden;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  transition: transform 0.15s var(--ease), box-shadow 0.2s var(--ease), background 0.18s var(--ease), opacity 0.2s;
}
button.primary:hover { background: var(--vscode-button-hoverBackground); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22); }
button.primary:active { transform: translateY(0) scale(0.98); box-shadow: none; }
button.primary:disabled { opacity: 0.55; cursor: default; transform: none; box-shadow: none; }
button.small {
  padding: 6px 13px; font: inherit; font-size: 12px; cursor: pointer; border: 0; border-radius: 7px; white-space: nowrap;
  background: var(--vscode-button-secondaryBackground, var(--raise-2));
  color: var(--vscode-button-secondaryForeground, var(--fg));
  transition: background 0.18s var(--ease), transform 0.12s var(--ease);
}
button.small:hover { background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--fg) 12%, transparent)); }
button.small:active { transform: scale(0.96); }
.toast {
  position: fixed; right: 18px; bottom: 18px; z-index: 9;
  display: flex; align-items: center; gap: 9px;
  padding: 10px 17px 10px 12px; border-radius: 10px; font-size: 12.5px;
  background: var(--vscode-editor-background, var(--bg)); color: var(--fg);
  border: 1px solid color-mix(in srgb, var(--ok) 45%, transparent);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.3);
  opacity: 0; transform: translateY(12px) scale(0.97); pointer-events: none;
  transition: opacity 0.3s var(--ease), transform 0.35s var(--ease);
}
.toast.on { opacity: 1; transform: none; }
.toast svg { width: 15px; height: 15px; stroke: var(--ok); stroke-width: 2.4; fill: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<div class="toast" id="toast"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg><span id="toastText"></span></div>
<script nonce="${nonce}">
${script}
</script>
</body>
</html>`;
}

/** webview 通用脚本头:acquireVsCodeApi + 收发辅助 + 表单状态持久化 + 缩略图/反馈工具 */
export const SCRIPT_PREAMBLE = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let toastTimer = 0;
function toast(text) {
  $('toastText').textContent = text;
  $('toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2400);
}
function showError(text) {
  const el = $('error');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
  el.classList.remove('shake');
  if (text) requestAnimationFrame(() => el.classList.add('shake'));
}
// 表单状态持久化:输入即存,面板被重建(Reload Window 等)后恢复
function collectState() {
  const state = {};
  document.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => {
    state[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return state;
}
function restoreState() {
  const state = vscode.getState();
  if (!state) return;
  for (const [id, val] of Object.entries(state)) {
    const el = $(id);
    if (el) el[el.type === 'checkbox' ? 'checked' : 'value'] = val;
  }
  document.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
document.addEventListener('input', () => vscode.setState(collectState()));
document.addEventListener('change', () => vscode.setState(collectState()));
restoreState();

// 图片缩略图:输入防抖 300ms 后请宿主解析为 webview URI
const THUMB_PLACEHOLDER = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
const thumbTimers = {};
function setThumb(field, uri) {
  const t = document.querySelector('[data-thumb-for="' + field + '"]');
  if (!t) return;
  if (uri) {
    t.innerHTML = '';
    const img = document.createElement('img');
    img.alt = '';
    img.onload = () => { img.classList.add('on'); t.classList.add('has'); };
    img.onerror = () => { t.innerHTML = THUMB_PLACEHOLDER; t.classList.remove('has'); };
    img.src = uri;
    t.appendChild(img);
  } else {
    t.innerHTML = THUMB_PLACEHOLDER;
    t.classList.remove('has');
  }
}
function bindThumb(field) {
  const el = $(field);
  if (!el) return;
  const ask = () => {
    const v = el.value.trim();
    if (v) vscode.postMessage({ type: 'resolveImage', field, value: v });
    else setThumb(field, null);
  };
  el.addEventListener('input', () => {
    clearTimeout(thumbTimers[field]);
    thumbTimers[field] = setTimeout(ask, 300);
  });
  ask();
}
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'imageUri') setThumb(msg.field, msg.uri);
});
`;

/** 图片输入行:输入框 + 「选择图片…」按钮 + 缩略图(data-thumb-for 与 field 对应) */
export function imageRowHtml(field: string, placeholder: string, pickable = true): string {
  return `
<div class="imgrow">
  <div class="thumb" data-thumb-for="${field}"></div>
  <div class="grow"><input type="text" id="${field}" placeholder="${placeholder}"></div>
  ${pickable ? `<button class="small pick" data-field="${field}">选择图片…</button>` : ''}
</div>`;
}

/**
 * 图标选择器:需要页面里有 #iconSearch(输入框)、#iconGrid(容器)、#iconValue(隐藏 input),
 * 图标数据通过 init 消息的 icons 字段([{name, body}])注入。
 */
export const ICON_PICKER_SCRIPT = `
let icons = [];
let selectedIcon = '';
function svgOf(body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}
function renderIcons() {
  const filter = $('iconSearch').value.trim().toLowerCase();
  const grid = $('iconGrid');
  grid.innerHTML = '';
  let shown = 0;
  for (const ic of icons) {
    if (filter && !ic.name.includes(filter)) continue;
    shown++;
    const cell = document.createElement('div');
    cell.className = 'icon-cell' + (ic.name === selectedIcon ? ' sel' : '');
    cell.title = ic.name;
    cell.innerHTML = svgOf(ic.body);
    cell.addEventListener('click', () => {
      selectedIcon = ic.name;
      $('iconValue').value = ic.name;
      $('iconValue').dispatchEvent(new Event('input', { bubbles: true }));
      renderIcons();
      if (typeof onIconChange === 'function') onIconChange();
    });
    grid.appendChild(cell);
  }
  const count = $('iconCount');
  if (count) count.textContent = filter ? shown + ' / ' + icons.length : icons.length + ' 个图标';
}
$('iconSearch').addEventListener('input', renderIcons);
`;

export const ICON_PICKER_HTML = `
<label class="f">图标</label>
<div class="imgrow">
  <div class="grow"><input type="text" id="iconSearch" placeholder="搜索图标名…"></div>
  <span class="hint" id="iconCount" style="margin:0;align-self:center"></span>
</div>
<input type="hidden" id="iconValue">
<div class="icon-grid" id="iconGrid"></div>
`;

/** 卡片分区外壳:序号 + 标题 + 可选说明 */
export function cardHtml(idx: string, title: string, hint: string, inner: string): string {
  return `
<section class="card">
  <div class="card-head">
    <span class="card-idx">${idx}</span>
    <div>
      <h2 class="card-title">${title}</h2>
      ${hint ? `<p class="card-hint">${hint}</p>` : ''}
    </div>
  </div>
  ${inner}
</section>`;
}
