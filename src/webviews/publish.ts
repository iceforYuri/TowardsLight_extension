/**
 * 「提交更改」面板(单例 WebviewPanel):
 * 自动检测档案所属的 git 仓库(可切换),列出工作区变更供勾选,
 * 提交信息可手写也可 AI 生成(Copilot 优先,风格跟随该仓库最近提交),
 * 确认后选择性提交(不卷入别处在暂存区的改动),可选推送。
 */
import path from 'node:path';
import * as vscode from 'vscode';
import { generateCommitMessage } from '../ai';
import { ProfileInfo } from '../core';
import { commit, detectRepos, diffForPrompt, push, recentLog, statusFiles } from '../git';
import { assertProfileUnchanged, getProfile, getTemplateDir, workspaceRoot } from '../util';
import { cardHtml, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  const repo = `
<select id="repoSel"></select>
<div class="hint" id="repoMeta"></div>
`;
  const files = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
  <span class="hint" id="fileCount" style="margin:0"></span>
  <button class="small" id="toggleAll" type="button">全不选</button>
</div>
<div class="hint" id="focusHint" style="display:none;margin:0 0 8px"></div>
<div class="flist" id="fileList"></div>
`;
  const message = `
<textarea id="message" rows="4" placeholder="提交信息,如 fix(home): 修复卡片重叠"></textarea>
<div style="display:flex;gap:10px;align-items:center;margin-top:10px">
  <button class="small" id="aiBtn" type="button">✨ AI 生成</button>
  <span class="hint" id="aiHint" style="margin:0"></span>
</div>
`;
  return `
<style>
/* 变更文件清单 */
.flist { border: 1px solid var(--line); border-radius: 10px; max-height: 320px; overflow-y: auto; }
.frow { display: flex; align-items: center; gap: 9px; padding: 6px 12px; border-top: 1px solid var(--line);
  cursor: pointer; font-size: 12.5px; user-select: none; }
.frow:first-child { border-top: 0; }
.frow:hover { background: var(--raise-2); }
.frow input { accent-color: var(--accent); flex: none; margin: 0; }
.fchip { font-family: var(--mono); font-size: 10px; width: 18px; text-align: center; flex: none;
  border-radius: 4px; padding: 1px 0; }
.fchip.M { color: #b07a2f; background: color-mix(in srgb, #b07a2f 12%, transparent); }
.fchip.A { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.fchip.D { color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); }
.fchip.U { color: var(--accent); background: var(--accent-soft); }
.fpath { font-family: var(--mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.frow.off .fpath { color: var(--faint); text-decoration: line-through; }
.fempty { padding: 18px; text-align: center; color: var(--faint); font-size: 12px; }
.push { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted);
  cursor: pointer; user-select: none; }
.push input { accent-color: var(--accent); margin: 0; }
.push.disabled { opacity: 0.45; cursor: default; }
</style>
<div class="kicker">Towards Light · Studio</div>
<h1>提交更改</h1>
<p class="sub">AI 生成只是草稿,确认后才会提交;推送默认关闭,由你显式勾选。</p>
${cardHtml('repo', '01', '仓库', '自动检测档案所属仓库,可切换', repo)}
${cardHtml('files', '02', '变更文件', '默认全选,取消勾选的文件不进这次提交', files)}
${cardHtml('message', '03', '提交信息', 'AI 风格跟随该仓库的最近提交', message)}
<div class="error" id="error"></div>
<div class="actions">
  <button class="primary" id="submit">提交</button>
  <label class="push" id="pushWrap"><input type="checkbox" id="push"> 提交后推送到远端</label>
</div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
let repos = [];
let currentRoot = '';
let files = [];
// 文章级提交的预选范围:{ file: 文章的仓库相对路径, dir: 图片目录前缀 };空为全局面板
let currentFocus = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
function chipOf(xy) {
  if (xy === '??') return 'U';
  return (xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M');
}
function chipTitle(xy) {
  if (xy === '??') return '未跟踪';
  const s = chipOf(xy);
  return s === 'A' ? '新增' : s === 'D' ? '删除' : '修改';
}
function isFocused(f) {
  if (!currentFocus) return true; // 无预选范围时默认全选
  return f.file === currentFocus.file || (currentFocus.dir && f.file.startsWith(currentFocus.dir));
}
function renderRepos() {
  const sel = $('repoSel');
  sel.innerHTML = repos
    .map((r) => '<option value="' + esc(r.root) + '">' + esc(r.name) + (r.branch ? ' · ' + esc(r.branch) : '') + '</option>')
    .join('');
  sel.value = currentRoot;
  syncRepoMeta();
}
function syncRepoMeta() {
  const r = repos.find((x) => x.root === currentRoot);
  $('repoMeta').textContent = r ? r.root + (r.hasRemote ? '' : '(无远端,推送不可用)') : '';
  const push = $('push');
  push.disabled = !r || !r.hasRemote;
  if (push.disabled) push.checked = false;
  $('pushWrap').classList.toggle('disabled', push.disabled);
}
function renderFiles() {
  const list = $('fileList');
  if (!files.length) {
    list.innerHTML = '<div class="fempty">工作区干净,没有要提交的变更</div>';
    $('fileCount').textContent = '';
    $('toggleAll').style.display = 'none';
    $('focusHint').style.display = 'none';
    $('submit').disabled = true;
    return;
  }
  $('toggleAll').style.display = '';
  let focusedCount = 0;
  list.innerHTML = files
    .map((f) => {
      const c = chipOf(f.xy);
      const on = isFocused(f);
      if (on && currentFocus) focusedCount++;
      return '<label class="frow"><input type="checkbox" data-file="' + esc(f.file) + '"' + (on ? ' checked' : '') + '>'
        + '<span class="fchip ' + c + '" title="' + chipTitle(f.xy) + '">' + c + '</span>'
        + '<span class="fpath">' + esc(f.file) + '</span></label>';
    })
    .join('');
  const fh = $('focusHint');
  if (currentFocus) {
    fh.style.display = '';
    fh.textContent = focusedCount
      ? '已勾选当前文章与其图片,其余变更未选'
      : '当前文章没有未提交的变更,可手动勾选其他文件';
  } else {
    fh.style.display = 'none';
  }
  updateCount();
}
function checkedFiles() {
  return [...document.querySelectorAll('#fileList input[type=checkbox]:checked')].map((el) => el.dataset.file);
}
function updateCount() {
  const n = checkedFiles().length;
  $('fileCount').textContent = files.length + ' 个变更 · 已选 ' + n;
  $('submit').disabled = n === 0;
  $('toggleAll').textContent = n === files.length ? '全不选' : '全选';
  document.querySelectorAll('#fileList .frow').forEach((row) => {
    row.classList.toggle('off', !row.querySelector('input').checked);
  });
}

$('fileList').addEventListener('change', updateCount);
$('toggleAll').addEventListener('click', () => {
  const all = checkedFiles().length === files.length;
  document.querySelectorAll('#fileList input[type=checkbox]').forEach((el) => { el.checked = !all; });
  updateCount();
});
$('repoSel').addEventListener('change', () => {
  currentRoot = $('repoSel').value;
  $('message').value = '';
  showError('');
  syncRepoMeta();
  vscode.postMessage({ type: 'selectRepo', root: currentRoot });
});
$('aiBtn').addEventListener('click', () => {
  if (!currentRoot) return;
  $('aiBtn').disabled = true;
  $('aiHint').textContent = '生成中…';
  vscode.postMessage({ type: 'ai', root: currentRoot });
});
$('submit').addEventListener('click', () => {
  const picked = checkedFiles();
  if (!picked.length) return showError('没有选中要提交的文件');
  const message = $('message').value.trim();
  if (!message) return showError('提交信息不能为空');
  $('submit').disabled = true;
  showError('');
  vscode.postMessage({ type: 'submit', root: currentRoot, files: picked, message, push: $('push').checked });
});

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'init') {
    repos = m.repos || [];
    currentRoot = m.selected || '';
    $('message').value = '';
    showError('');
    if (!repos.length) {
      renderRepos();
      files = [];
      renderFiles();
      $('fileList').innerHTML = '<div class="fempty">档案与工作区都不在 git 仓库中,先在仓库里打开项目</div>';
      $('submit').disabled = true;
      return;
    }
    renderRepos();
  } else if (m.type === 'status') {
    if (m.root !== currentRoot) return;
    currentFocus = m.focus || null;
    files = m.files || [];
    renderFiles();
  } else if (m.type === 'aiDone') {
    $('aiBtn').disabled = false;
    if (m.error) {
      $('aiHint').textContent = m.error;
    } else {
      $('message').value = m.text;
      $('message').dispatchEvent(new Event('input', { bubbles: true }));
      $('aiHint').textContent = '已生成(' + (m.via || '') + '),检查后提交';
    }
  } else if (m.type === 'committed') {
    $('message').value = '';
    showError('');
    toast(m.pushed ? '已提交并推送' : '已提交');
  } else if (m.type === 'error') {
    showError(m.message);
    $('submit').disabled = false;
  }
});
vscode.postMessage({ type: 'ready' });
`
  );
}

let panel: vscode.WebviewPanel | undefined;
/** 表单打开那一刻锁定的档案,提交前校验未切换(与其他表单同一守卫) */
let openedProfile: ProfileInfo | undefined;
/** 文章级提交的预选范围(当前文章 + 它的图片目录);从控制台进入为空 */
export interface PublishFocus {
  file: string;
  imageDir: string;
}
let pendingFocus: PublishFocus | undefined;

export function openPublish(focus?: PublishFocus): void {
  if (panel) {
    const p = panel;
    // 档案变了就整个重开(徽章与守卫都锚定在打开时的档案上)
    try {
      const now = getProfile();
      if (openedProfile && now.dir !== openedProfile.dir) {
        p.dispose(); // onDidDispose 会清掉模块级 panel
        openPublish(focus);
        return;
      }
      pendingFocus = focus;
      sendInit(p, now.dir);
    } catch {
      /* 未绑定时沿用现有面板 */
    }
    p.reveal();
    return;
  }
  const profile = getProfile(); // 未绑定时抛错,由命令层 guard 弹出
  openedProfile = profile;
  pendingFocus = focus;
  panel = vscode.window.createWebviewPanel('towardsLightPublish', '提交更改', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.onDidDispose(() => {
    panel = undefined;
    openedProfile = undefined;
  });
  panel.webview.html = pageShell('提交更改', body(), script(), '', path.basename(profile.dir));
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel) return;
    try {
      if (msg.type === 'ready' || msg.type === 'refresh') {
        sendInit(panel, profile.dir);
      } else if (msg.type === 'selectRepo') {
        sendStatus(panel, String(msg.root ?? ''));
      } else if (msg.type === 'ai') {
        const root = String(msg.root ?? '');
        const changed = statusFiles(root);
        const res = await generateCommitMessage({
          status: changed.map((f) => `${f.xy} ${f.file}`).join('\n'),
          diff: diffForPrompt(root),
          recentLog: recentLog(root),
          files: changed.map((f) => f.file),
        });
        panel.webview.postMessage({ type: 'aiDone', text: res.text, via: res.detail });
      } else if (msg.type === 'submit') {
        assertProfileUnchanged(openedProfile!);
        const files = Array.isArray(msg.files) ? msg.files.map(String) : [];
        const message = String(msg.message ?? '').trim();
        if (!files.length) throw new Error('没有选中要提交的文件');
        if (!message) throw new Error('提交信息不能为空');
        const root = String(msg.root ?? '');
        commit(root, files, message);
        let pushed = false;
        if (msg.push) {
          push(root);
          pushed = true;
        }
        pendingFocus = undefined; // 文章级提交完成后回到全局面板
        panel.webview.postMessage({ type: 'committed', pushed });
        sendStatus(panel, root);
      }
    } catch (e) {
      const message = (e as Error).message;
      panel?.webview.postMessage({ type: 'error', message });
      if (msg.type === 'ai') panel?.webview.postMessage({ type: 'aiDone', error: message });
    }
  });
}

/** 候选仓库:档案目录优先,然后工作区根与模板目录(detectRepos 内部去重) */
function sendInit(p: vscode.WebviewPanel, profileDir: string): void {
  let root: string | undefined;
  let template: string | undefined;
  try {
    root = workspaceRoot();
  } catch {
    /* 工作区未打开 */
  }
  try {
    template = getTemplateDir();
  } catch {
    /* 模板未识别 */
  }
  const repos = detectRepos([profileDir, root, template]);
  p.webview.postMessage({ type: 'init', repos, selected: repos[0]?.root ?? '' });
  if (repos[0]) sendStatus(p, repos[0].root);
}

function sendStatus(p: vscode.WebviewPanel, root: string): void {
  if (!root) return;
  // 文章级提交:把文章与其图片目录换算成该仓库的相对路径,交给面板做预选;
  // 目标仓库不包含这些路径时(用户切到了别的仓库)自然落空,退回全选
  let focus: { file: string | null; dir: string | null } | null = null;
  if (pendingFocus) {
    const relFile = relInRepo(root, pendingFocus.file);
    const relDir = relInRepo(root, pendingFocus.imageDir);
    if (relFile || relDir) focus = { file: relFile, dir: relDir ? relDir + '/' : null };
  }
  p.webview.postMessage({ type: 'status', root, files: statusFiles(root), focus });
}

/** target 在仓库 root 内则返回正斜杠相对路径,否则 null */
function relInRepo(root: string, target: string): string | null {
  const rel = path.relative(root, target).split(path.sep).join('/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}
