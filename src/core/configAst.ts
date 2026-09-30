/**
 * site.ts / links.ts 的 AST 级读写。
 * 这两个文件是纯字面量数据,不执行代码,直接读字符串字面量;
 * 写回用 ts-morph 最小化改写,保留注释、格式和 `as const` / `as Record<…>` 包装。
 */
import fs from 'node:fs';
import {
  Node,
  ObjectLiteralExpression,
  Project,
  PropertyAssignment,
  QuoteKind,
} from 'ts-morph';
import { insertIntoLiteral } from './textEdit';

function newProject(): Project {
  return new Project({ manipulationSettings: { quoteKind: QuoteKind.Single } });
}

/** 剥掉 `as const` / `as Record<…>` 这类断言,拿到真实表达式 */
function unwrapAs(node: Node | undefined): Node | undefined {
  let n = node;
  while (n && (Node.isAsExpression(n) || Node.isSatisfiesExpression(n))) n = n.getExpression();
  return n;
}

function objectLiteralOf(node: Node | undefined, hint: string): ObjectLiteralExpression {
  const n = unwrapAs(node);
  if (!n || !Node.isObjectLiteralExpression(n)) {
    throw new Error(`${hint} 不是对象字面量,文件结构可能已被手动改过`);
  }
  return n;
}

function getProp(obj: ObjectLiteralExpression, name: string): PropertyAssignment | undefined {
  const p = obj.getProperty(name);
  return p && Node.isPropertyAssignment(p) ? p : undefined;
}

/** 读取字符串字面量属性(自动剥 as 断言);读不到返回 undefined */
function readStringProp(obj: ObjectLiteralExpression, name: string): string | undefined {
  const n = unwrapAs(getProp(obj, name)?.getInitializer());
  return n && Node.isStringLiteral(n) ? n.getLiteralValue() : undefined;
}

/** 原地改字符串字面量的值,保留外层 as 断言;字段不存在时静默跳过 */
function writeStringProp(obj: ObjectLiteralExpression, name: string, value: string): boolean {
  const n = unwrapAs(getProp(obj, name)?.getInitializer());
  if (!n || !Node.isStringLiteral(n)) return false;
  n.setLiteralValue(value);
  return true;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 中文等合法标识符直接裸写(与现有风格一致),否则加单引号 */
const propName = (name: string) =>
  /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) ? name : `'${esc(name)}'`;

// ─────────────────────────── site.ts ───────────────────────────

export interface SiteConfigValues {
  siteName: string;
  siteNameEn: string;
  author: string;
  bio: string;
  shortBio: string;
  email: string;
  siteUrl: string;
  avatar: string;
  avatarPosition: string;
  statusMode: string;
  statusText: string;
}

const TOP_STRING_FIELDS = [
  'siteName',
  'siteNameEn',
  'author',
  'bio',
  'shortBio',
  'email',
  'siteUrl',
  'avatar',
  'avatarPosition',
] as const;

function siteObject(sf: import('ts-morph').SourceFile): ObjectLiteralExpression {
  const decl = sf.getVariableDeclaration('site');
  if (!decl) throw new Error('site.ts 里没有找到 export const site');
  return objectLiteralOf(decl.getInitializer(), 'site');
}

export function readSiteConfig(siteFile: string): SiteConfigValues {
  const sf = newProject().addSourceFileAtPath(siteFile);
  const site = siteObject(sf);
  const values = {} as Record<(typeof TOP_STRING_FIELDS)[number], string>;
  for (const f of TOP_STRING_FIELDS) values[f] = readStringProp(site, f) ?? '';
  let statusMode = '';
  let statusText = '';
  const statusInit = getProp(site, 'currentStatus')?.getInitializer();
  try {
    const status = objectLiteralOf(statusInit, 'currentStatus');
    statusMode = readStringProp(status, 'mode') ?? '';
    statusText = readStringProp(status, 'text') ?? '';
  } catch {
    /* currentStatus 缺失时留空 */
  }
  return { ...values, statusMode, statusText };
}

/** 就地更新字段,返回实际改动数量 */
export function updateSiteConfig(siteFile: string, patch: Partial<SiteConfigValues>): number {
  const project = newProject();
  const sf = project.addSourceFileAtPath(siteFile);
  const site = siteObject(sf);
  let changed = 0;
  for (const f of TOP_STRING_FIELDS) {
    if (patch[f] !== undefined && writeStringProp(site, f, patch[f])) changed++;
  }
  if (patch.statusMode !== undefined || patch.statusText !== undefined) {
    const status = objectLiteralOf(getProp(site, 'currentStatus')?.getInitializer(), 'currentStatus');
    if (patch.statusMode !== undefined && writeStringProp(status, 'mode', patch.statusMode)) changed++;
    if (patch.statusText !== undefined && writeStringProp(status, 'text', patch.statusText)) changed++;
  }
  if (changed) sf.saveSync();
  return changed;
}

export interface CategoryMeta {
  name: string;
  icon: string;
  tone: string;
  description: string;
}

function categoryMetaObject(siteFile: string, project: Project) {
  const sf = project.addSourceFileAtPath(siteFile);
  const site = siteObject(sf);
  const meta = objectLiteralOf(getProp(site, 'categoryMeta')?.getInitializer(), 'categoryMeta');
  return { sf, meta };
}

export function readCategories(siteFile: string): CategoryMeta[] {
  const { meta } = categoryMetaObject(siteFile, newProject());
  const out: CategoryMeta[] = [];
  for (const p of meta.getProperties()) {
    if (!Node.isPropertyAssignment(p)) continue;
    try {
      const o = objectLiteralOf(p.getInitializer(), p.getName());
      out.push({
        name: p.getName().replace(/^['"]|['"]$/g, ''),
        icon: readStringProp(o, 'icon') ?? '',
        tone: readStringProp(o, 'tone') ?? 'accent',
        description: readStringProp(o, 'description') ?? '',
      });
    } catch {
      /* 跳过形态异常的条目 */
    }
  }
  return out;
}

export function addCategory(siteFile: string, cat: CategoryMeta): void {
  const project = newProject();
  const { sf, meta } = categoryMetaObject(siteFile, project);
  if (meta.getProperty(cat.name) || meta.getProperty(`'${cat.name}'`)) {
    throw new Error(`分类「${cat.name}」已存在`);
  }
  const entry = `${propName(cat.name)}: {\n      icon: '${esc(cat.icon)}',\n      tone: '${esc(cat.tone)}',\n      description: '${esc(cat.description)}',\n    }`;
  const text = insertIntoLiteral(sf.getFullText(), meta, `    ${entry}`);
  fs.writeFileSync(siteFile, text, 'utf8');
}

// ─────────────────────────── links.ts ───────────────────────────

export interface NewLink {
  title: string;
  description: string;
  href: string;
  group: string;
  icon?: string;
  external?: boolean;
  featured?: boolean;
  status?: string;
}

export function readLinkGroups(linksFile: string): string[] {
  const sf = newProject().addSourceFileAtPath(linksFile);
  const decl = sf.getVariableDeclaration('linkGroups');
  if (!decl) return [];
  const arr = unwrapAs(decl.getInitializer());
  if (!arr || !Node.isArrayLiteralExpression(arr)) return [];
  return arr.getElements().filter(Node.isStringLiteral).map((e) => e.getLiteralValue());
}

/** 追加一条链接;分组名是新的时,一并补进 linkGroups */
export function addLink(linksFile: string, link: NewLink): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);

  let text = sf.getFullText();

  const groupsDecl = sf.getVariableDeclarationOrThrow('linkGroups');
  const groupsArr = unwrapAs(groupsDecl.getInitializer());
  if (!groupsArr || !Node.isArrayLiteralExpression(groupsArr)) {
    throw new Error('linkGroups 不是数组字面量,文件结构可能已被手动改过');
  }
  const groups = groupsArr.getElements().filter(Node.isStringLiteral).map((e) => e.getLiteralValue());
  if (!groups.includes(link.group)) {
    text = insertIntoLiteral(text, groupsArr, `  '${esc(link.group)}'`);
  }

  // linkGroups 可能改动了文本,基于新文本重新解析再定位 techLinks
  const sf2 = project.createSourceFile('links-new.ts', text, { overwrite: true });
  const linksDecl = sf2.getVariableDeclarationOrThrow('techLinks');
  const linksArr = unwrapAs(linksDecl.getInitializer());
  if (!linksArr || !Node.isArrayLiteralExpression(linksArr)) {
    throw new Error('techLinks 不是数组字面量,文件结构可能已被手动改过');
  }
  const lines = [
    `    title: '${esc(link.title)}',`,
    `    description: '${esc(link.description)}',`,
    `    href: '${esc(link.href)}',`,
    `    group: '${esc(link.group)}',`,
  ];
  if (link.icon) lines.push(`    icon: '${esc(link.icon)}',`);
  if (link.external) lines.push(`    external: true,`);
  if (link.featured) lines.push(`    featured: true,`);
  if (link.status) lines.push(`    status: '${esc(link.status)}',`);
  text = insertIntoLiteral(text, linksArr, `  {\n${lines.join('\n')}\n  }`);
  fs.writeFileSync(linksFile, text, 'utf8');
}
