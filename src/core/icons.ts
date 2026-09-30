/**
 * Icon.astro 图标表读写:lucide-static 按名取 SVG → 提取内部 path → 追加进 icons 表。
 * .astro 文件只解析 --- frontmatter --- 之间的 TS 部分,其余原样保留。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Node, ObjectLiteralExpression, Project } from 'ts-morph';
import { insertIntoLiteral } from './textEdit';

export interface IconEntry {
  name: string;
  body: string;
}

interface AstroSplit {
  /** frontmatter 文本(不含 --- 栅栏) */
  fm: string;
  /** fm 在原文件中的起止偏移 */
  start: number;
  end: number;
}

function splitFrontmatter(text: string): AstroSplit {
  const m = text.match(/^---\r?\n/);
  if (!m) throw new Error('Icon.astro 缺少 frontmatter 起始栅栏');
  const start = m[0].length;
  const close = text.slice(start).search(/\r?\n---/);
  if (close < 0) throw new Error('Icon.astro 缺少 frontmatter 结束栅栏');
  return { fm: text.slice(start, start + close), start, end: start + close };
}

function iconsObjectFromFm(fm: string): { sf: import('ts-morph').SourceFile; obj: ObjectLiteralExpression } {
  const project = new Project();
  const sf = project.createSourceFile('icon-frontmatter.ts', fm);
  const decl = sf.getVariableDeclaration('icons');
  if (!decl) throw new Error('Icon.astro 里没有找到 icons 表');
  const init = decl.getInitializer();
  if (!init || !Node.isObjectLiteralExpression(init)) {
    throw new Error('icons 表不是对象字面量,文件结构可能已被手动改过');
  }
  return { sf, obj: init };
}

/** 读出图标表 [{ name, body }],body 是 SVG 内部标签串 */
export function readIcons(iconFile: string): IconEntry[] {
  const { fm } = splitFrontmatter(fs.readFileSync(iconFile, 'utf8'));
  const { obj } = iconsObjectFromFm(fm);
  const out: IconEntry[] = [];
  for (const p of obj.getProperties()) {
    if (!Node.isPropertyAssignment(p)) continue;
    const init = p.getInitializer();
    if (!init || !Node.isStringLiteral(init)) continue;
    out.push({ name: p.getName().replace(/^['"]|['"]$/g, ''), body: init.getLiteralValue() });
  }
  return out;
}

/** 把新图标写进 icons 表;重名直接报错 */
export function addIcon(iconFile: string, name: string, body: string): void {
  const text = fs.readFileSync(iconFile, 'utf8');
  const { fm, start, end } = splitFrontmatter(text);
  const { sf, obj } = iconsObjectFromFm(fm);
  if (obj.getProperty(name) || obj.getProperty(`'${name}'`)) {
    throw new Error(`图标 ${name} 已存在`);
  }
  const key = /^[a-zA-Z_$][\w$]*$/.test(name) ? name : `'${name}'`;
  const value = body.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const newFm = insertIntoLiteral(sf.getFullText(), obj, `  ${key}: '${value}'`).replace(/\s+$/, '');
  fs.writeFileSync(iconFile, text.slice(0, start) + newFm + text.slice(end), 'utf8');
}

/** 从 dist/lucide-icons/<name>.svg 提取内部标签;不存在返回 null */
export function lucideIconBody(iconsDir: string, name: string): string | null {
  const file = path.join(iconsDir, `${name}.svg`);
  if (!fs.existsSync(file)) return null;
  const svg = fs.readFileSync(file, 'utf8');
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!m) return null;
  return m[1].replace(/>\s+</g, '><').trim();
}
