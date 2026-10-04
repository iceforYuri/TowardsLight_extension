/**
 * AI 摘要的纯函数部分(不依赖 vscode,可单测):
 * 正文清洗、提示词、结果归一化、本地回退提取。
 */

/** 从 Markdown 正文提取适合喂给模型的纯文本:去 frontmatter/图片/代码块,收敛空白 */
export function prepareSource(markdown: string): string {
  let s = markdown.replace(/^---[\s\S]*?---/, ''); // frontmatter
  s = s.replace(/```[\s\S]*?```/g, ' '); // 代码块
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // 链接留文字
  s = s.replace(/^#{1,6}\s+.*$/gm, ' '); // 标题整行(摘要不该混入标题文本)
  s = s.replace(/[>*`-]{1,}/g, (m) => (m.startsWith('>') ? '' : m)); // 引用符号
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 清洗模型输出:先取第一行,再去引号/前缀/Markdown 记号,截到 100 字 */
export function normalizeSummary(text: string): string {
  let s = text.trim().split(/\r?\n/)[0].trim();
  s = s.replace(/^(摘要|描述|description)[:：]\s*/i, '');
  s = s.replace(/^["'「『“”‘’]+|["'」』“”‘’]+$/g, '');
  s = s.replace(/[*_`#]/g, '').trim();
  if (s.length > 100) return s.slice(0, 99) + '…';
  return s;
}

/** 本地回退:取第一段正文,截 100 字 */
export function localFallback(markdown: string): string {
  const src = prepareSource(markdown);
  const firstPara = src.split(/(?<=。)\s*/)[0] || src;
  const s = firstPara.trim();
  if (!s) return '';
  return s.length > 100 ? s.slice(0, 99) + '…' : s;
}

export function buildPrompt(source: string): string {
  return `你是博客编辑。请根据下面的文章正文,为 Frontmatter 的 description 生成摘要。

要求:
- 只输出摘要正文,不要标题、引号、前缀或 Markdown。
- 10–100 个中文字符或等价长度,优先控制在 40–80 字。
- 准确概括文章主题、核心内容和读者收益,不虚构正文没有的信息。
- 使用与正文一致的主要语言。

文章正文:
${source}`;
}

export interface AiSettings {
  /** copilot=VS Code 语言模型(零配置);openai=自定义 OpenAI 兼容端点 */
  provider: 'copilot' | 'openai';
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'copilot',
  baseUrl: '',
  model: '',
};
