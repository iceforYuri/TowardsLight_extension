import * as vscode from 'vscode';
import { getAiSettings, hasApiKey, saveAiSettings } from '../ai';
import { getProfile, getTemplateDir } from '../util';
import { cardHtml, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  const ai = `
<label class="f">摘要生成方式</label>
<div class="seg" id="provider">
  <button type="button" data-value="copilot">VS Code 语言模型</button>
  <button type="button" data-value="openai">自定义 API</button>
</div>
<input type="hidden" id="providerValue">
<div class="hint">默认借 Copilot 登录态,零配置;自定义 API 走 OpenAI 兼容端点</div>

<div id="openaiFields" style="display:none;margin-top:14px">
  <label class="f">Base URL</label>
  <input type="text" id="baseUrl" placeholder="如 https://api.openai.com 或 https://api.deepseek.com">
  <label class="f">模型</label>
  <input type="text" id="model" placeholder="如 gpt-4o-mini / deepseek-chat">
  <label class="f">API Key</label>
  <input type="password" id="apiKey" placeholder="留空则保持已保存的 key">
  <div class="hint" id="keyHint"></div>
</div>
`;
  const preview = `
<label class="f">预览起始端口</label>
<input type="number" id="devPort" min="1024" max="65535" step="1" style="max-width:160px">
<div class="hint">被占用时自动顺延;改动对下次启动生效</div>
`;
  const paths = `
<label class="f">模板目录</label>
<div class="row" style="display:flex;gap:8px;align-items:center">
  <code id="tplPath" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"></code>
  <button class="small" id="changeTpl">更改…</button>
</div>
<label class="f" style="margin-top:12px">档案目录</label>
<div class="row" style="display:flex;gap:8px;align-items:center">
  <code id="profPath" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"></code>
  <button class="small" id="changeProf">切换…</button>
</div>
`;
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>设置</h1>
<p class="sub">扩展级设置;站点与内容配置在「站点信息 / 链接管理 / 分类管理」。</p>
${cardHtml('ai', '01', 'AI 摘要', '生成结果只是草稿,确认后才会写进 frontmatter', ai)}
${cardHtml('preview', '02', '预览', 'dev server 的端口策略', preview)}
${cardHtml('paths', '03', '路径', '当前绑定,只读展示', paths)}
<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">保存</button></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
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
segInit('provider', 'providerValue', 'copilot');
$('providerValue').addEventListener('input', () => {
  $('openaiFields').style.display = $('providerValue').value === 'openai' ? '' : 'none';
});

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'init') {
    $('providerValue').value = m.values.provider || 'copilot';
    $('providerValue').dispatchEvent(new Event('input'));
    $('baseUrl').value = m.values.baseUrl || '';
    $('model').value = m.values.model || '';
    $('devPort').value = m.devPort;
    $('keyHint').textContent = m.hasKey ? '已保存 key(不显示,输入即覆盖)' : '未设置';
    $('tplPath').textContent = m.templateDir || '未识别';
    $('profPath').textContent = m.profileDir || '未绑定';
  } else if (m.type === 'saved') {
    toast('已保存');
    $('submit').disabled = false;
  } else if (m.type === 'error') {
    showError(m.message);
    $('submit').disabled = false;
  }
});

$('changeTpl').addEventListener('click', () => vscode.postMessage({ type: 'selectTemplate' }));
$('changeProf').addEventListener('click', () => vscode.postMessage({ type: 'switchProfile' }));

$('submit').addEventListener('click', () => {
  const provider = $('providerValue').value;
  if (provider === 'openai') {
    if (!$('baseUrl').value.trim()) return showError('Base URL 不能为空');
    if (!$('model').value.trim()) return showError('模型不能为空');
  }
  const port = Number($('devPort').value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return showError('端口需为 1024–65535 的整数');
  $('submit').disabled = true;
  vscode.postMessage({
    type: 'submit',
    values: { provider, baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim() },
    apiKey: $('apiKey').value,
    devPort: port,
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

let panel: vscode.WebviewPanel | undefined;

export function openSettings(): void {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel('towardsLightSettings', '设置', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = pageShell('设置', body(), script());
  panel.onDidDispose(() => {
    panel = undefined;
  });
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel) return;
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({
          type: 'init',
          values: getAiSettings(),
          hasKey: await hasApiKey(),
          devPort: vscode.workspace.getConfiguration('towardsLight').get<number>('devPort', 4321),
          templateDir: safeTemplate(),
          profileDir: safeProfile(),
        });
      } else if (msg.type === 'selectTemplate') {
        await vscode.commands.executeCommand('towardsLight.selectTemplateDir');
      } else if (msg.type === 'switchProfile') {
        await vscode.commands.executeCommand('towardsLight.switchProfile');
      } else if (msg.type === 'submit') {
        const key = msg.apiKey?.trim() ? msg.apiKey.trim() : undefined;
        await saveAiSettings(msg.values, key);
        await vscode.workspace
          .getConfiguration('towardsLight')
          .update('devPort', msg.devPort, vscode.ConfigurationTarget.Workspace);
        panel.webview.postMessage({ type: 'saved' });
      }
    } catch (e) {
      panel?.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}

function safeTemplate(): string {
  try {
    return getTemplateDir();
  } catch {
    return '';
  }
}
function safeProfile(): string {
  try {
    return getProfile().dir;
  } catch {
    return '';
  }
}
