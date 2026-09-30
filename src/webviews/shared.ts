import crypto from 'node:crypto';

/** 表单 webview 的公共外壳:CSP + 跟随 VS Code 主题的原生样式 */
export function pageShell(title: string, body: string, script: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body { padding: 20px 24px 32px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h1 { font-size: 1.25em; margin: 0 0 4px; }
.sub { opacity: .6; font-size: .85em; margin-bottom: 18px; }
label.f { display: block; margin: 14px 0 4px; opacity: .85; }
label.f .req { color: var(--vscode-errorForeground); }
input[type=text], input[type=url], textarea, select {
  width: 100%; box-sizing: border-box; padding: 5px 8px; font: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
textarea { resize: vertical; min-height: 56px; }
.row { display: flex; gap: 16px; }
.row > div { flex: 1; min-width: 0; }
.hint { opacity: .6; font-size: .85em; margin-top: 3px; }
.error { color: var(--vscode-errorForeground); margin: 10px 0 0; display: none; }
.ok { color: var(--vscode-testing-iconPassed, #3fb950); margin: 10px 0 0; display: none; }
.actions { margin-top: 24px; display: flex; gap: 10px; align-items: center; }
button.primary {
  padding: 6px 18px; font: inherit; cursor: pointer; border: 0; border-radius: 4px;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
.checks { display: flex; gap: 20px; margin-top: 16px; }
.checks label { display: flex; align-items: center; gap: 6px; margin: 0; cursor: pointer; }
.icon-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 6px;
  margin-top: 8px; max-height: 240px; overflow-y: auto; padding: 8px;
  border: 1px solid var(--vscode-input-border, rgba(127,127,127,.35)); border-radius: 6px;
}
.icon-cell {
  display: flex; align-items: center; justify-content: center; aspect-ratio: 1;
  border-radius: 6px; cursor: pointer; border: 1px solid transparent;
}
.icon-cell:hover { border-color: var(--vscode-focusBorder); }
.icon-cell.sel { border-color: var(--vscode-focusBorder); background: rgba(127,127,127,.18); }
.icon-cell svg { width: 20px; height: 20px; }
.tones { display: flex; gap: 10px; margin-top: 6px; }
.tone {
  flex: 1; padding: 9px 8px; border-radius: 6px; cursor: pointer; text-align: center;
  border: 1px solid var(--vscode-input-border, rgba(127,127,127,.35));
}
.tone.sel { border-color: var(--vscode-focusBorder); background: rgba(127,127,127,.15); }
h2 { font-size: 1.02em; margin: 26px 0 4px; padding-top: 16px; border-top: 1px solid var(--vscode-input-border, rgba(127,127,127,.25)); }
.imgrow { display: flex; gap: 6px; align-items: center; }
.imgrow input { flex: 1; min-width: 0; }
button.small {
  padding: 5px 12px; font: inherit; cursor: pointer; border: 0; border-radius: 4px; white-space: nowrap;
  background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.25));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
}
button.small:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.35)); }
</style>
</head>
<body>
${body}
<script nonce="${nonce}">
${script}
</script>
</body>
</html>`;
}

/** webview 通用脚本头:acquireVsCodeApi + 收发辅助 + 表单状态持久化 */
export const SCRIPT_PREAMBLE = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
function showError(text) {
  const el = $('error');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
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
}
document.addEventListener('input', () => vscode.setState(collectState()));
document.addEventListener('change', () => vscode.setState(collectState()));
restoreState();
`;

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
  for (const ic of icons) {
    if (filter && !ic.name.includes(filter)) continue;
    const cell = document.createElement('div');
    cell.className = 'icon-cell' + (ic.name === selectedIcon ? ' sel' : '');
    cell.title = ic.name;
    cell.innerHTML = svgOf(ic.body);
    cell.addEventListener('click', () => {
      selectedIcon = ic.name;
      $('iconValue').value = ic.name;
      renderIcons();
    });
    grid.appendChild(cell);
  }
}
$('iconSearch').addEventListener('input', renderIcons);
`;

export const ICON_PICKER_HTML = `
<label class="f">图标</label>
<input type="text" id="iconSearch" placeholder="搜索图标名…">
<input type="hidden" id="iconValue">
<div class="icon-grid" id="iconGrid"></div>
`;
