/**
 * AI 能力(host 侧,依赖 vscode):
 * 默认走 VS Code 语言模型(借 Copilot 登录态,零配置);
 * 设置里可切到自定义 OpenAI 兼容端点(baseUrl + model + key,key 存 SecretStorage);
 * 两者都不可用/失败时回退到本地规则,只降级不弹错。
 * 现有两个能力:文章摘要(generateSummary)、git 提交信息(generateCommitMessage)。
 */
import * as vscode from 'vscode';
import {
  AiSettings,
  buildCommitPrompt,
  buildPrompt,
  CommitContext,
  DEFAULT_AI_SETTINGS,
  localCommitFallback,
  localFallback,
  normalizeCommitMessage,
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

export interface AiResult {
  text: string;
  /** copilot / openai / local */
  via: 'copilot' | 'openai' | 'local';
  detail: string;
}

interface ChatReply {
  text: string;
  via: 'copilot' | 'openai';
  detail: string;
}

async function viaCopilot(prompt: string, justification: string): Promise<ChatReply | null> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const model = models[0];
    if (!model) return null;
    let p = prompt;
    const limit = Math.max(256, model.maxInputTokens - 512);
    // 超长收缩:提示词把正文/diff 放在末尾,截尾保头
    while ((await model.countTokens(p)) > limit && p.length > 2000) {
      p = p.slice(0, Math.floor(p.length * 0.7));
    }
    const res = await model.sendRequest([vscode.LanguageModelChatMessage.User(p)], {
      justification,
    });
    let out = '';
    for await (const frag of res.text) out += frag;
    return { text: out, via: 'copilot', detail: model.name };
  } catch {
    return null;
  }
}

async function viaOpenAi(prompt: string, settings: AiSettings): Promise<ChatReply | null> {
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
        messages: [{ role: 'user', content: prompt.slice(0, 16000) }],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? '', via: 'openai', detail: settings.model };
  } catch {
    return null;
  }
}

/** 按设置走 copilot 或自定义端点;不可用/失败返回 null,由调用方决定本地回退 */
async function chat(prompt: string, justification: string): Promise<ChatReply | null> {
  const settings = getAiSettings();
  return settings.provider === 'openai' ? viaOpenAi(prompt, settings) : viaCopilot(prompt, justification);
}

/** 生成文章摘要:模型优先,失败回退本地提取(首段截取) */
export async function generateSummary(markdown: string): Promise<AiResult> {
  const source = prepareSource(markdown);
  if (!source) throw new Error('正文里没有可用于生成摘要的文字');
  const r = await chat(buildPrompt(source), '根据当前文章正文生成 Frontmatter 摘要');
  if (r) {
    const text = normalizeSummary(r.text);
    if (text.length >= 10) return { text, via: r.via, detail: r.detail };
  }
  const text = localFallback(markdown);
  if (!text) throw new Error('正文里没有可用于生成摘要的文字');
  return { text, via: 'local', detail: '本地提取(模型不可用)' };
}

/** 生成提交信息:工作区状态 + diff + 该仓库历史风格;失败回退本地规则,绝不阻塞提交 */
export async function generateCommitMessage(ctx: CommitContext & { files: string[] }): Promise<AiResult> {
  const r = await chat(buildCommitPrompt(ctx), '根据工作区改动生成 git 提交信息');
  if (r) {
    const text = normalizeCommitMessage(r.text);
    if (text) return { text, via: r.via, detail: r.detail };
  }
  return { text: localCommitFallback(ctx.files), via: 'local', detail: '本地规则(模型不可用)' };
}
