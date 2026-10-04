import * as vscode from 'vscode';
import { getAiSettings, hasApiKey, saveAiSettings } from '../ai';
import { cardHtml, pageShell, SCRIPT_PREAMBLE } from './shared';

function body(): string {
  const main = `
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
  return `
<div class="kicker">Towards Light · Studio</div>
<h1>AI 摘要设置</h1>
<p class="sub">文章编辑表单里「AI 生成」摘要的来源。生成结果只是草稿,确认后才会写进 frontmatter。</p>
${cardHtml('ai', '01', '生成来源', '模型不可用时自动回退到本地提取', main)}
<div class="error" id="error"></div>
<div class="actions"><button class="primary" id="submit">保存</button></div>
`;
}

function script(): string {
  return (
    SCRIPT_PREAMBLE +
    `
// 与站点信息同款的分段选择器:点击写隐藏 input 并同步 UI
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
    $('keyHint').textContent = m.hasKey ? '已保存 key(不显示,输入即覆盖)' : '未设置';
  } else if (m.type === 'saved') {
    toast('已保存');
    $('submit').disabled = false;
  } else if (m.type === 'error') {
    showError(m.message);
    $('submit').disabled = false;
  }
});

$('submit').addEventListener('click', () => {
  const provider = $('providerValue').value;
  if (provider === 'openai') {
    if (!$('baseUrl').value.trim()) return showError('Base URL 不能为空');
    if (!$('model').value.trim()) return showError('模型不能为空');
  }
  $('submit').disabled = true;
  vscode.postMessage({
    type: 'submit',
    values: { provider, baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim() },
    apiKey: $('apiKey').value, // 空串 = 不动已保存的;有值 = 覆盖
  });
});
vscode.postMessage({ type: 'ready' });
`
  );
}

export function openAiSettingsForm(): void {
  const panel = vscode.window.createWebviewPanel(
    'towardsLightAiSettings',
    'AI 摘要设置',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  panel.webview.html = pageShell('AI 摘要设置', body(), script());
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        panel.webview.postMessage({
          type: 'init',
          values: getAiSettings(),
          hasKey: await hasApiKey(),
        });
      } else if (msg.type === 'submit') {
        const key = msg.apiKey?.trim() ? msg.apiKey.trim() : undefined;
        await saveAiSettings(msg.values, key);
        panel.webview.postMessage({ type: 'saved' });
      }
    } catch (e) {
      panel.webview.postMessage({ type: 'error', message: (e as Error).message });
    }
  });
}
