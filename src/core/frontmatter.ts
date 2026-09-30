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
  category: string;
  tags: string[];
  draft: boolean;
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
      category: String(data.category ?? ''),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      draft: data.draft === true,
      valid: true,
    };
  } catch {
    return {
      file,
      slug,
      title: slug,
      description: '',
      pubDate: '',
      category: '',
      tags: [],
      draft: false,
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
