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
  SyntaxKind,
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

/** 原地改字符串字面量的值,保留外层 as 断言;字段不存在或值未变化时跳过 */
function writeStringProp(obj: ObjectLiteralExpression, name: string, value: string): boolean {
  const n = unwrapAs(getProp(obj, name)?.getInitializer());
  if (!n || !Node.isStringLiteral(n) || n.getLiteralValue() === value) return false;
  n.setLiteralValue(value);
  return true;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 中文等合法标识符直接裸写(与现有风格一致),否则加单引号 */
const propName = (name: string) =>
  /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) ? name : `'${esc(name)}'`;

// ─────────────────────────── site.ts ───────────────────────────

export interface SitePageCopy {
  title: string;
  description: string;
}

export interface SiteConfigValues {
  siteName: string;
  siteNameEn: string;
  author: string;
  bio: string;
  shortBio: string;
  email: string;
  siteUrl: string;
  /** 默认主题:system / light / dark */
  themeDefault: string;
  avatar: string;
  avatarPosition: string;
  statusMode: string;
  statusText: string;
  /** homeHero.background / textMode */
  heroBackground: string;
  heroTextMode: string;
  /** pageBackdrops.<页面> */
  backdrops: Record<string, string>;
  /** pages.<页面>.{title,description} */
  pages: Record<string, SitePageCopy>;
}

const TOP_STRING_FIELDS = [
  'siteName',
  'siteNameEn',
  'author',
  'bio',
  'shortBio',
  'email',
  'siteUrl',
  'themeDefault',
  'avatar',
  'avatarPosition',
] as const;

function siteObject(sf: import('ts-morph').SourceFile): ObjectLiteralExpression {
  const decl = sf.getVariableDeclaration('site');
  if (!decl) throw new Error('site.ts 里没有找到 export const site');
  return objectLiteralOf(decl.getInitializer(), 'site');
}

const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '');

/** 容错读取嵌套对象;缺失时返回 undefined 而不是抛错 */
function nestedObject(site: ObjectLiteralExpression, name: string): ObjectLiteralExpression | undefined {
  try {
    return objectLiteralOf(getProp(site, name)?.getInitializer(), name);
  } catch {
    return undefined;
  }
}

export function readSiteConfig(siteFile: string): SiteConfigValues {
  const sf = newProject().addSourceFileAtPath(siteFile);
  const site = siteObject(sf);
  const values = {} as Record<(typeof TOP_STRING_FIELDS)[number], string>;
  for (const f of TOP_STRING_FIELDS) values[f] = readStringProp(site, f) ?? '';

  const status = nestedObject(site, 'currentStatus');
  const hero = nestedObject(site, 'homeHero');

  const backdrops: Record<string, string> = {};
  const bd = nestedObject(site, 'pageBackdrops');
  if (bd) {
    for (const p of bd.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      backdrops[unquote(p.getName())] = readStringProp(bd, unquote(p.getName())) ?? '';
    }
  }

  const pages: Record<string, SitePageCopy> = {};
  const pg = nestedObject(site, 'pages');
  if (pg) {
    for (const p of pg.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      try {
        const o = objectLiteralOf(p.getInitializer(), p.getName());
        pages[unquote(p.getName())] = {
          title: readStringProp(o, 'title') ?? '',
          description: readStringProp(o, 'description') ?? '',
        };
      } catch {
        /* 跳过形态异常的条目 */
      }
    }
  }

  return {
    ...values,
    statusMode: status ? (readStringProp(status, 'mode') ?? '') : '',
    statusText: status ? (readStringProp(status, 'text') ?? '') : '',
    heroBackground: hero ? (readStringProp(hero, 'background') ?? '') : '',
    heroTextMode: hero ? (readStringProp(hero, 'textMode') ?? '') : '',
    backdrops,
    pages,
  };
}

/** 就地更新字段,返回实际改动数量;档案缺少某个嵌套块时该块静默跳过 */
export function updateSiteConfig(siteFile: string, patch: Partial<SiteConfigValues>): number {
  const project = newProject();
  const sf = project.addSourceFileAtPath(siteFile);
  const site = siteObject(sf);
  let changed = 0;
  for (const f of TOP_STRING_FIELDS) {
    if (patch[f] !== undefined && writeStringProp(site, f, patch[f])) changed++;
  }
  if (patch.statusMode !== undefined || patch.statusText !== undefined) {
    const status = nestedObject(site, 'currentStatus');
    if (status) {
      if (patch.statusMode !== undefined && writeStringProp(status, 'mode', patch.statusMode)) changed++;
      if (patch.statusText !== undefined && writeStringProp(status, 'text', patch.statusText)) changed++;
    }
  }
  if (patch.heroBackground !== undefined || patch.heroTextMode !== undefined) {
    const hero = nestedObject(site, 'homeHero');
    if (hero) {
      if (patch.heroBackground !== undefined && writeStringProp(hero, 'background', patch.heroBackground)) changed++;
      if (patch.heroTextMode !== undefined && writeStringProp(hero, 'textMode', patch.heroTextMode)) changed++;
    }
  }
  if (patch.backdrops) {
    const bd = nestedObject(site, 'pageBackdrops');
    if (bd) {
      for (const [k, v] of Object.entries(patch.backdrops)) {
        if (writeStringProp(bd, k, v)) changed++;
      }
    }
  }
  if (patch.pages) {
    const pg = nestedObject(site, 'pages');
    if (pg) {
      for (const [k, copy] of Object.entries(patch.pages)) {
        const o = nestedObject(pg, k);
        if (!o) continue;
        if (copy.title !== undefined && writeStringProp(o, 'title', copy.title)) changed++;
        if (copy.description !== undefined && writeStringProp(o, 'description', copy.description)) changed++;
      }
    }
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

/** 修改已有分类的图标/色调/描述;名称是 key,不可改。返回实际改动数量 */
export function updateCategory(
  siteFile: string,
  name: string,
  patch: Partial<Omit<CategoryMeta, 'name'>>,
): number {
  const project = newProject();
  const { sf, meta } = categoryMetaObject(siteFile, project);
  const p = meta.getProperty(name) ?? meta.getProperty(`'${name}'`);
  if (!p || !Node.isPropertyAssignment(p)) throw new Error(`分类「${name}」不存在`);
  const o = objectLiteralOf(p.getInitializer(), name);
  let changed = 0;
  if (patch.icon !== undefined && writeStringProp(o, 'icon', patch.icon)) changed++;
  if (patch.tone !== undefined && writeStringProp(o, 'tone', patch.tone)) changed++;
  if (patch.description !== undefined && writeStringProp(o, 'description', patch.description)) changed++;
  if (changed) sf.saveSync();
  return changed;
}

/** 删除分类条目(调用方负责确保没有文章引用) */
export function deleteCategory(siteFile: string, name: string): void {
  const project = newProject();
  const { sf, meta } = categoryMetaObject(siteFile, project);
  const p = meta.getProperty(name) ?? meta.getProperty(`'${name}'`);
  if (!p || !Node.isPropertyAssignment(p)) throw new Error(`分类「${name}」不存在`);
  p.remove();
  sf.saveSync();
}

/** 分类改名(迁移 meta 的 key;调用方负责确保没有文章引用旧名) */
export function renameCategory(siteFile: string, oldName: string, newName: string): void {
  const project = newProject();
  const { sf, meta } = categoryMetaObject(siteFile, project);
  const p = meta.getProperty(oldName) ?? meta.getProperty(`'${oldName}'`);
  if (!p || !Node.isPropertyAssignment(p)) throw new Error(`分类「${oldName}」不存在`);
  if (meta.getProperty(newName) ?? meta.getProperty(`'${newName}'`)) {
    throw new Error(`分类「${newName}」已存在`);
  }
  p.getNameNode().replaceWithText(propName(newName));
  sf.saveSync();
}

export interface NewLink {
  title: string;
  description: string;
  href: string;
  /** linkGroups 里声明过的 id */
  group: string;
  /** 新建分组时的显示名(缺省用 id) */
  groupLabel?: string;
  icon?: string;
  external?: boolean;
  featured?: boolean;
  status?: string;
}

// ─────────────────────────── links.ts ───────────────────────────

export interface LinkGroup {
  id: string;
  label: string;
  description: string;
}

export interface LinkItem {
  title: string;
  description: string;
  href: string;
  group: string;
  icon?: string;
  external: boolean;
  featured: boolean;
  status?: string;
}

function techLinksArray(sf: import('ts-morph').SourceFile): import('ts-morph').ArrayLiteralExpression {
  const decl = sf.getVariableDeclarationOrThrow('techLinks');
  const arr = unwrapAs(decl.getInitializer());
  if (!arr || !Node.isArrayLiteralExpression(arr)) {
    throw new Error('techLinks 不是数组字面量,文件结构可能已被手动改过');
  }
  return arr;
}

function readBoolProp(obj: ObjectLiteralExpression, name: string): boolean {
  const n = unwrapAs(getProp(obj, name)?.getInitializer());
  return !!n && n.getKind() === SyntaxKind.TrueKeyword;
}

/** 读全量 techLinks(按文件顺序,即页面展示顺序) */
export function readLinks(linksFile: string): LinkItem[] {
  const sf = newProject().addSourceFileAtPath(linksFile);
  const arr = techLinksArray(sf);
  const out: LinkItem[] = [];
  for (const el of arr.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) continue;
    out.push({
      title: readStringProp(el, 'title') ?? '',
      description: readStringProp(el, 'description') ?? '',
      href: readStringProp(el, 'href') ?? '',
      group: readStringProp(el, 'group') ?? '',
      icon: readStringProp(el, 'icon') || undefined,
      external: readBoolProp(el, 'external'),
      featured: readBoolProp(el, 'featured'),
      status: readStringProp(el, 'status') || undefined,
    });
  }
  return out;
}

function findLink(arr: import('ts-morph').ArrayLiteralExpression, href: string): ObjectLiteralExpression {
  const el = arr.getElements().find(
    (e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'href') === href,
  );
  if (!el || !Node.isObjectLiteralExpression(el)) {
    throw new Error(`没找到链接:${href}(文件可能已被手动改过)`);
  }
  return el;
}

/** 在对象字面量收尾前文本级插入多行(每行自带尾逗号),保持仓库缩进风格 */
function insertLinesBeforeClose(text: string, node: Node, lines: string[]): string {
  const end = node.getEnd() - 1;
  let p = end;
  while (p > 0 && /\s/.test(text[p - 1])) p--;
  const prevChar = text[p - 1];
  const needsComma = prevChar !== ',' && prevChar !== '{' && prevChar !== '[';
  return text.slice(0, p) + (needsComma ? ',' : '') + '\n' + lines.join('\n') + text.slice(p);
}

/** 就地修改链接(href 是 key,不可改);icon/status 传空串=删除该字段,布尔 false=移除 */
export function updateLink(linksFile: string, href: string, patch: Partial<Omit<LinkItem, 'href'>>): number {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const obj = findLink(techLinksArray(sf), href);
  let changed = 0;

  for (const f of ['title', 'description', 'group'] as const) {
    if (patch[f] !== undefined && writeStringProp(obj, f, patch[f])) changed++;
  }
  const insertLines: string[] = [];
  for (const f of ['icon', 'status'] as const) {
    const v = patch[f];
    if (v === undefined) continue;
    const existing = getProp(obj, f);
    if (v) {
      if (existing) {
        if (writeStringProp(obj, f, v)) changed++;
      } else {
        insertLines.push(`    ${f}: '${esc(v)}',`);
        changed++;
      }
    } else if (existing && Node.isPropertyAssignment(existing)) {
      existing.remove();
      changed++;
    }
  }
  for (const f of ['external', 'featured'] as const) {
    const v = patch[f];
    if (v === undefined) continue;
    const existing = getProp(obj, f);
    if (v && !existing) {
      insertLines.push(`    ${f}: true,`);
      changed++;
    } else if (!v && existing && Node.isPropertyAssignment(existing)) {
      existing.remove();
      changed++;
    }
  }
  if (!changed) return 0;
  let text = sf.getFullText();
  if (insertLines.length) text = insertLinesBeforeClose(text, obj, insertLines);
  fs.writeFileSync(linksFile, text, 'utf8');
  return changed;
}

/** 删除链接(按 href 定位) */
export function deleteLink(linksFile: string, href: string): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const arr = techLinksArray(sf);
  const i = arr.getElements().findIndex(
    (e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'href') === href,
  );
  if (i < 0) throw new Error(`没找到链接:${href}`);
  arr.removeElement(i);
  sf.saveSync();
}

/** 组内/全局顺序调整:与相邻元素交换位置(文本互换,格式无损) */
export function moveLink(linksFile: string, href: string, dir: -1 | 1): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const arr = techLinksArray(sf);
  const els = arr.getElements();
  const i = els.findIndex(
    (e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'href') === href,
  );
  if (i < 0) throw new Error(`没找到链接:${href}`);
  const j = i + dir;
  if (j < 0 || j >= els.length) return;
  const ti = els[i].getText();
  const tj = els[j].getText();
  const elj = els[j];
  if (!Node.isObjectLiteralExpression(elj)) throw new Error('相邻元素不是对象字面量');
  const hj = readStringProp(elj, 'href');
  if (!hj) throw new Error('相邻元素缺少 href,无法交换');
  els[i].replaceWithText(tj);
  // 第一次替换后旧节点失效,按 href 重新定位再换回
  const el2 = findLink(techLinksArray(sf), hj);
  el2.replaceWithText(ti);
  sf.saveSync();
}

/** 读取链接分组(linkGroups 是对象数组:{id, label, description}) */
export function readLinkGroups(linksFile: string): LinkGroup[] {
  const sf = newProject().addSourceFileAtPath(linksFile);
  const decl = sf.getVariableDeclaration('linkGroups');
  if (!decl) return [];
  const arr = unwrapAs(decl.getInitializer());
  if (!arr || !Node.isArrayLiteralExpression(arr)) return [];
  const out: LinkGroup[] = [];
  for (const el of arr.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) continue;
    out.push({
      id: readStringProp(el, 'id') ?? '',
      label: readStringProp(el, 'label') ?? '',
      description: readStringProp(el, 'description') ?? '',
    });
  }
  return out.filter((g) => g.id);
}

function linkGroupsArray(sf: import('ts-morph').SourceFile): import('ts-morph').ArrayLiteralExpression {
  const decl = sf.getVariableDeclarationOrThrow('linkGroups');
  const arr = unwrapAs(decl.getInitializer());
  if (!arr || !Node.isArrayLiteralExpression(arr)) {
    throw new Error('linkGroups 不是数组字面量,文件结构可能已被手动改过');
  }
  return arr;
}

/** 新增分组(对象形式);id 重名报错 */
export function addGroup(linksFile: string, group: LinkGroup): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const arr = linkGroupsArray(sf);
  const dup = arr.getElements().some(
    (e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'id') === group.id,
  );
  if (dup) throw new Error(`分组「${group.id}」已存在`);
  const text = insertIntoLiteral(
    sf.getFullText(),
    arr,
    `  { id: '${esc(group.id)}', label: '${esc(group.label)}', description: '${esc(group.description)}' }`,
  );
  fs.writeFileSync(linksFile, text, 'utf8');
}

/** 修改分组显示名/描述;id 是引用 key,不可改 */
export function updateGroup(
  linksFile: string,
  id: string,
  patch: Partial<Pick<LinkGroup, 'label' | 'description'>>,
): number {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const el = linkGroupsArray(sf)
    .getElements()
    .find((e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'id') === id);
  if (!el || !Node.isObjectLiteralExpression(el)) throw new Error(`分组「${id}」不存在`);
  let changed = 0;
  if (patch.label !== undefined && writeStringProp(el, 'label', patch.label)) changed++;
  if (patch.description !== undefined && writeStringProp(el, 'description', patch.description)) changed++;
  if (changed) sf.saveSync();
  return changed;
}

/** 删除分组(调用方负责确保组内没有链接) */
export function deleteGroup(linksFile: string, id: string): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const arr = linkGroupsArray(sf);
  const i = arr
    .getElements()
    .findIndex((e) => Node.isObjectLiteralExpression(e) && readStringProp(e, 'id') === id);
  if (i < 0) throw new Error(`分组「${id}」不存在`);
  arr.removeElement(i);
  sf.saveSync();
}

/** 整组重排:ids 给定的顺序即文件顺序(也是页面展示顺序);元素文本原样搬运,只换顺序 */
export function reorderGroups(linksFile: string, ids: string[]): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);
  const arr = linkGroupsArray(sf);
  const items = new Map<string, string>();
  for (const el of arr.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) continue;
    const id = readStringProp(el, 'id');
    if (id) items.set(id, el.getText());
  }
  const same = ids.length === items.size && ids.every((id) => items.has(id));
  if (!same) throw new Error('重排请求的 id 集合与文件不一致,可能已被手动改过');
  const inner = '\n' + ids.map((id) => `  ${items.get(id)},`).join('\n') + '\n';
  const text = sf.getFullText();
  fs.writeFileSync(linksFile, text.slice(0, arr.getStart() + 1) + inner + text.slice(arr.getEnd() - 1), 'utf8');
}

/** 追加一条链接;分组 id 是新的时,一并补进 linkGroups(对象形式) */
export function addLink(linksFile: string, link: NewLink): void {
  const project = newProject();
  const sf = project.addSourceFileAtPath(linksFile);

  let text = sf.getFullText();

  const groupsDecl = sf.getVariableDeclarationOrThrow('linkGroups');
  const groupsArr = unwrapAs(groupsDecl.getInitializer());
  if (!groupsArr || !Node.isArrayLiteralExpression(groupsArr)) {
    throw new Error('linkGroups 不是数组字面量,文件结构可能已被手动改过');
  }
  const groups = readLinkGroups(linksFile).map((g) => g.id);
  if (!groups.includes(link.group)) {
    const label = link.groupLabel || link.group;
    text = insertIntoLiteral(
      text,
      groupsArr,
      `  { id: '${esc(link.group)}', label: '${esc(label)}', description: '${esc(label)}' }`,
    );
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
