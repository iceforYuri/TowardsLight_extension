import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface PostMeta {
  file: string;
  slug: string;
  title: string;
  description: string;
  /** YYYY-MM-DD,解析失败为空串 */
  pubDate: string;
  updatedDate: string;
  category: string;
  tags: string[];
  draft: boolean;
  featured: boolean;
  cover?: string;
  /** frontmatter 解析失败时为 false */
  valid: boolean;
}

function toDateString(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(+v)) return v.toISOString().slice(0, 10);
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

export function parsePost(file: string): PostMeta {
  const slug = path.basename(file).replace(/\.md$/, '');
  try {
    const { data } = matter.read(file);
    return {
      file,
      slug,
      title: String(data.title ?? slug),
      description: String(data.description ?? ''),
      pubDate: toDateString(data.pubDate),
      updatedDate: toDateString(data.updatedDate),
      category: String(data.category ?? ''),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      draft: data.draft === true,
      featured: data.featured === true,
      cover: typeof data.cover === 'string' ? data.cover : undefined,
      valid: true,
    };
  } catch {
    return {
      file,
      slug,
      title: slug,
      description: '',
      pubDate: '',
      updatedDate: '',
      category: '',
      tags: [],
      draft: false,
      featured: false,
      valid: false,
    };
  }
}

/** 按发布日期倒序列出档案下全部文章 */
export function listPosts(postsDir: string): PostMeta[] {
  if (!fs.existsSync(postsDir)) return [];
  const files = fs.readdirSync(postsDir, { recursive: true }) as string[];
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => parsePost(path.join(postsDir, f)))
    .sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
}

/** 纯文本可安全裸写则裸写,否则用 YAML 双引号(与 JSON 转义兼容) */
export function yamlScalar(s: string): string {
  const needsQuote =
    s === '' ||
    /^\s|\s$/.test(s) ||
    /:\s|:\s*$/.test(s) ||
    /[#'"\n\r\t\[\]{},&*?|>%@`]/.test(s) ||
    /^[-?:!]/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[-+]?[\d.]+([\s:]|$)/.test(s);
  return needsQuote ? JSON.stringify(s) : s;
}

export interface NewPostInput {
  title: string;
  description: string;
  category: string;
  tags: string[];
  slug: string;
  draft: boolean;
  cover?: string;
  coverAlt?: string;
  coverPosition?: string;
  /** YYYY-MM-DD,缺省取今天 */
  date?: string;
}

export function buildPostContent(input: NewPostInput): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const tags = input.tags.map((t) => t.trim()).filter(Boolean);
  const lines = [
    '---',
    `title: ${yamlScalar(input.title)}`,
    `description: ${yamlScalar(input.description)}`,
    `pubDate: ${date}`,
    `category: ${yamlScalar(input.category)}`,
    `tags: [${tags.map(yamlScalar).join(', ')}]`,
    `draft: ${input.draft}`,
  ];
  if (input.cover) {
    lines.push(`cover: ${yamlScalar(input.cover)}`);
    if (input.coverAlt) lines.push(`coverAlt: ${yamlScalar(input.coverAlt)}`);
    if (input.coverPosition) lines.push(`coverPosition: ${yamlScalar(input.coverPosition)}`);
  }
  lines.push('---', '', '在这里开始写正文。', '');
  return lines.join('\n');
}

/** 标题 → 文件名建议;中文等非 ASCII 会被剥掉,留给用户手填 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * 就地切换 draft 字段:只动 frontmatter 里那一行,其余字节原样保留。
 * 缺 draft 字段时插到 frontmatter 末尾。
 */
export function setPostDraft(file: string, draft: boolean): void {
  const text = fs.readFileSync(file, 'utf8');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`${path.basename(file)}: frontmatter 缺失`);
  let fm = m[1];
  if (/^draft:.*$/m.test(fm)) {
    fm = fm.replace(/^draft:.*$/m, `draft: ${draft}`);
  } else {
    fm = `${fm.trimEnd()}${nl}draft: ${draft}`;
  }
  fs.writeFileSync(file, text.replace(m[0], `---${nl}${fm}${nl}---`), 'utf8');
}
