/**
 * 摘要生成(host 侧,依赖 vscode):
 * 默认走 VS Code 语言模型(借 Copilot 登录态,零配置);
 * 设置里可切到自定义 OpenAI 兼容端点(baseUrl + model + key,key 存 SecretStorage);
 * 两者都不可用/失败时回退到本地提取(首段截取)。
 */
import * as vscode from 'vscode';
import {
  AiSettings,
  buildPrompt,
  DEFAULT_AI_SETTINGS,
  localFallback,
  normalizeSummary,
  prepareSource,
} from './core/ai';
import { stateStore } from './util';

const SETTINGS_KEY = 'towardsLight.aiSettings';
const SECRET_KEY = 'towardsLight.aiApiKey';

let secrets: vscode.SecretStorage | undefined;

/** activate 时调用一次 */
export function initAi(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
}

export function getAiSettings(): AiSettings {
  try {
    return { ...DEFAULT_AI_SETTINGS, ...stateStore().get<Partial<AiSettings>>(SETTINGS_KEY, {}) };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAiSettings(s: AiSettings, apiKey?: string): Promise<void> {
  await stateStore().update(SETTINGS_KEY, s);
  if (apiKey !== undefined && secrets) {
    if (apiKey) await secrets.store(SECRET_KEY, apiKey);
    else await secrets.delete(SECRET_KEY);
  }
}

export async function hasApiKey(): Promise<boolean> {
  return !!(await secrets?.get(SECRET_KEY));
}

export interface SummaryResult {
  text: string;
  /** copilot / openai / local */
  via: 'copilot' | 'openai' | 'local';
  detail: string;
}

async function viaCopilot(source: string): Promise<SummaryResult | null> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const model = models[0];
    if (!model) return null;
    let src = source;
    let prompt = buildPrompt(src);
    const limit = Math.max(256, model.maxInputTokens - 512);
    while ((await model.countTokens(prompt)) > limit && src.length > 1000) {
      src = src.slice(0, Math.floor(src.length * 0.7));
      prompt = buildPrompt(src);
    }
    const res = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: '根据当前文章正文生成 Frontmatter 摘要' },
    );
    let out = '';
    for await (const frag of res.text) out += frag;
    const text = normalizeSummary(out);
    if (text.length < 10) return null;
    return { text, via: 'copilot', detail: model.name };
  } catch {
    return null;
  }
}

async function viaOpenAi(source: string, settings: AiSettings): Promise<SummaryResult | null> {
  const key = await secrets?.get(SECRET_KEY);
  if (!settings.baseUrl || !settings.model || !key) return null;
  try {
    const base = settings.baseUrl.replace(/\/+$/, '');
    const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: buildPrompt(source.slice(0, 12000)) }],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = normalizeSummary(data.choices?.[0]?.message?.content ?? '');
    if (text.length < 10) return null;
    return { text, via: 'openai', detail: settings.model };
  } catch {
    return null;
  }
}

/** 生成文章摘要:按设置走 copilot 或自定义端点,失败回退本地提取 */
export async function generateSummary(markdown: string): Promise<SummaryResult> {
  const source = prepareSource(markdown);
  if (!source) throw new Error('正文里没有可用于生成摘要的文字');
  const settings = getAiSettings();
  const result =
    settings.provider === 'openai' ? await viaOpenAi(source, settings) : await viaCopilot(source);
  if (result) return result;
  const text = localFallback(markdown);
  if (!text) throw new Error('正文里没有可用于生成摘要的文字');
  return { text, via: 'local', detail: '本地提取(模型不可用)' };
}
