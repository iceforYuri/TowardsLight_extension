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

/* ── 提交信息生成 ── */

/** 提交信息生成的输入:工作区状态 + diff + 该仓库近期提交标题(作为风格样例) */
export interface CommitContext {
  /** git status --porcelain 的行(M/A/D/?? + 路径) */
  status: string;
  /** git diff HEAD,可截断 */
  diff: string;
  /** git log 最近若干条 subject;仓库风格(语言/type 前缀/长度)由它传递 */
  recentLog: string[];
}

export function buildCommitPrompt(ctx: CommitContext): string {
  const logLines = ctx.recentLog.length
    ? ctx.recentLog.map((s) => `- ${s}`).join('\n')
    : '(该仓库还没有提交记录)';
  return `你是资深开发者,正在为一个 git 仓库写提交信息。

下面是这个仓库最近的提交标题,请延续它们的风格(语言、是否带 type 前缀、详略):
${logLines}

要求:
- 只输出提交信息本身,不要解释、引号、代码块围栏或「提交信息:」之类的前缀。
- 第一行是标题,不超过 72 个字符;确有必要时空一行写正文要点,否则只写标题。
- 准确概括这次改动,不虚构改动里没有的内容。

工作区状态(git status):
${ctx.status || '(无)'}

改动内容(git diff,可能已截断):
${ctx.diff || '(无)'}`;
}

/** 清洗模型返回的提交信息:去代码围栏/首尾引号/「提交信息:」前缀,保留标题+正文结构 */
export function normalizeCommitMessage(text: string): string {
  let s = text.trim();
  const fence = s.match(/^```[a-z]*\s*\n([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  const lines = s.split(/\r?\n/);
  if (lines[0]) {
    lines[0] = lines[0]
      .replace(/^(commit message|提交信息|提交说明)[:：]\s*/i, '')
      .replace(/^["'「『“”‘’]+|["'」』“”‘’]+$/g, '')
      .trim();
  }
  return lines
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 本地兜底提交信息:模型都不可用时给一条不失礼的保底,绝不阻塞提交 */
export function localCommitFallback(files: string[]): string {
  const n = files.length;
  if (!n) return 'chore: 更新';
  const base = (f: string) => f.split('/').pop() ?? f;
  const posts = files.filter((f) => /(^|\/)posts?\/[^/]+\.mdx?$/i.test(f)).length;
  if (posts === n) return n === 1 ? `更新 ${base(files[0])}` : `更新 ${n} 篇文章`;
  if (n === 1) return `更新 ${base(files[0])}`;
  return `chore: 更新 ${n} 个文件`;
}
