/**
 * 核心层测试:在 Node 下直接跑(dist/core.mjs,不依赖 VS Code)。
 * 把 showcase 的 site.ts / links.ts / Icon.astro 复制到临时目录,
 * 跑一遍真实的读写操作并断言结果,不碰真实档案。
 *
 * 用法:先 npm run build,再 npm test
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../dist/core.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHOWCASE = path.join(ROOT, 'src', 'profiles', 'showcase');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-editor-test-'));
const siteFile = path.join(tmp, 'site.ts');
const linksFile = path.join(tmp, 'links.ts');
const iconFile = path.join(tmp, 'Icon.astro');
fs.copyFileSync(path.join(SHOWCASE, 'site.ts'), siteFile);
fs.copyFileSync(path.join(SHOWCASE, 'links.ts'), linksFile);
fs.copyFileSync(path.join(ROOT, 'src', 'components', 'Icon.astro'), iconFile);

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── site.ts 读写 ──
const cfg = core.readSiteConfig(siteFile);
assert.equal(cfg.siteName, '拾光集');
assert.equal(cfg.statusMode, 'building');
assert.equal(cfg.heroBackground, '/images/hero-bg-2.svg');
assert.equal(cfg.backdrops.archive, '');
assert.equal(cfg.pages.archive.title, '归档');
assert.ok(cfg.pages.notFound.description.length > 0);
assert.equal(cfg.themeDefault, 'system');
ok('readSiteConfig 读取基本字段与嵌套块(currentStatus/homeHero/pageBackdrops/pages)');

const before = fs.readFileSync(siteFile, 'utf8');
const changed = core.updateSiteConfig(siteFile, {
  siteName: '测试站',
  statusMode: 'writing',
  statusText: '正在验证扩展的读写',
  heroBackground: '/images/new-hero.jpg',
  themeDefault: 'dark',
  backdrops: { archive: '/images/archive-bg.jpg', tags: '' },
  pages: { links: { title: '宝藏链接', description: '改写后的链接页描述' } },
});
assert.equal(changed, 8);
const cfg2 = core.readSiteConfig(siteFile);
assert.equal(cfg2.siteName, '测试站');
assert.equal(cfg2.statusMode, 'writing');
assert.equal(cfg2.statusText, '正在验证扩展的读写');
assert.equal(cfg2.heroBackground, '/images/new-hero.jpg');
assert.equal(cfg2.themeDefault, 'dark');
assert.equal(cfg2.backdrops.archive, '/images/archive-bg.jpg');
assert.equal(cfg2.backdrops.tags, '');
assert.equal(cfg2.pages.links.title, '宝藏链接');
assert.equal(cfg2.pages.links.description, '改写后的链接页描述');
assert.equal(cfg2.pages.archive.title, '归档', '未触碰的页面文案不应变化');
ok('updateSiteConfig 写回顶层字段与嵌套块并可重读');

const after = fs.readFileSync(siteFile, 'utf8');
assert.ok(after.includes('/** 头像裁切焦点'), '注释应保留');
assert.ok(after.includes('} as const'), 'as const 应保留');
assert.ok(after.includes("'writing' | 'building' | 'available' | 'offline'"), 'mode 的 as 断言应保留');
assert.ok(after.includes("'system' | 'light' | 'dark'"), 'themeDefault 的 as 断言应保留');
ok('写回保留注释与 as 断言');

// ── categoryMeta ──
const cats = core.readCategories(siteFile);
assert.equal(cats.length, 5);
assert.equal(cats[0].name, '前端');
assert.equal(cats[0].icon, 'code');
ok('readCategories 读出 5 个分类');

core.addCategory(siteFile, { name: '读书', icon: 'book-open', tone: 'accent', description: '读过的书和笔记' });
const cats2 = core.readCategories(siteFile);
assert.equal(cats2.length, 6);
assert.deepEqual(cats2.at(-1), { name: '读书', icon: 'book-open', tone: 'accent', description: '读过的书和笔记' });
assert.throws(() => core.addCategory(siteFile, cats2.at(-1)), /已存在/);
ok('addCategory 追加且拒绝重名');

const siteTextEarly = fs.readFileSync(siteFile, 'utf8');
const catBlock = siteTextEarly.match(/读书: \{[\s\S]*?\},/);
assert.ok(catBlock && catBlock[0].includes("\n      icon: 'book-open',"), '新增分类应匹配现有缩进风格');
ok('新增分类的格式与现有条目一致');
console.log('\n新增分类写入效果:\n' + catBlock[0]);

const catChanged = core.updateCategory(siteFile, '读书', { description: '改写后的描述', tone: 'contrast' });
assert.equal(catChanged, 2);
const cats3 = core.readCategories(siteFile);
const edited = cats3.find((c) => c.name === '读书');
assert.equal(edited.description, '改写后的描述');
assert.equal(edited.tone, 'contrast');
assert.equal(edited.icon, 'book-open', '未触碰的 icon 不应变化');
assert.throws(() => core.updateCategory(siteFile, '不存在的分类', { icon: 'x' }), /不存在/);
ok('updateCategory 修改已有分类并可重读');

core.renameCategory(siteFile, '读书', '阅读');
assert.ok(core.readCategories(siteFile).some((c) => c.name === '阅读'), '改名后新 key 可读');
assert.ok(!core.readCategories(siteFile).some((c) => c.name === '读书'), '旧 key 应消失');
assert.throws(() => core.renameCategory(siteFile, '阅读', '前端'), /已存在/);
core.deleteCategory(siteFile, '阅读');
assert.ok(!core.readCategories(siteFile).some((c) => c.name === '阅读'), '删除后条目应消失');
assert.equal(core.readCategories(siteFile).length, 5);
ok('renameCategory / deleteCategory 迁移与删除 key');

// ── links.ts ──
const groups = core.readLinkGroups(linksFile);
assert.equal(groups.length, 8);
assert.deepEqual(groups[0], { id: 'code', label: 'Code', description: '代码托管与开源项目', tone: 'steel' });
ok('readLinkGroups 读出 8 个对象化分组(id/label/description)');

core.addLink(linksFile, {
  title: 'Example',
  description: '测试链接',
  href: 'https://example.com',
  group: 'code',
  icon: 'github',
  external: true,
  featured: true,
  status: '偶尔用',
});
let linksText = fs.readFileSync(linksFile, 'utf8');
assert.ok(linksText.includes("title: 'Example',"));
assert.ok(linksText.includes("status: '偶尔用',"));
ok('addLink 追加到已有分组');

core.addLink(linksFile, {
  title: 'Pinia',
  description: '状态管理',
  href: 'https://pinia.vuejs.org',
  group: 'reading',
  groupLabel: 'Reading',
});
linksText = fs.readFileSync(linksFile, 'utf8');
const groups2 = core.readLinkGroups(linksFile);
assert.ok(groups2.some((g) => g.id === 'reading' && g.label === 'Reading'), '新分组应以对象形式补进 linkGroups');
assert.ok(!linksText.includes("title: 'Pinia',\n    icon"), '无图标时不写 icon 行');
assert.ok(!/Pinia[\s\S]*?external/.test(linksText.split('Pinia')[1]?.slice(0, 200) ?? ''), 'external: false 时不写 external 行');
ok('addLink 新建分组 + 可选字段按需输出');
console.log('\n新增链接写入效果:' + linksText.match(/\{\n    title: 'Pinia'[\s\S]*?\},/)[0]);

// ── 链接管理:读全量 / 修改 / 排序 / 删除 / 分组 CRUD ──
const all = core.readLinks(linksFile);
assert.equal(all.length, 16, 'showcase 14 条 + 测试新增 2 条');
assert.equal(all[0].title, 'GitHub');
assert.equal(all[0].external, true);
assert.equal(all.at(-1).title, 'Pinia');
assert.equal(all.at(-1).external, false, '未写 external 的应读为 false');
ok('readLinks 读全量(顺序/布尔/可选字段)');

core.updateLink(linksFile, 'https://pinia.vuejs.org', {
  title: 'PiniaX', icon: 'star', featured: true, status: '', group: 'tools',
});
const pinia = core.readLinks(linksFile).find((l) => l.href === 'https://pinia.vuejs.org');
assert.equal(pinia.title, 'PiniaX');
assert.equal(pinia.icon, 'star', 'icon 从无到有应补行');
assert.equal(pinia.featured, true, 'featured 从无到有应补行');
assert.equal(pinia.status, undefined, 'status 传空应删除(原本就没有)');
assert.equal(pinia.group, 'tools', '跨组移动 = 改 group 字段');
core.updateLink(linksFile, 'https://example.com', { external: false, status: '不再常用' });
const ex = core.readLinks(linksFile).find((l) => l.href === 'https://example.com');
assert.equal(ex.external, false, 'external 转 false 应移除该字段');
assert.equal(ex.status, '不再常用');
ok('updateLink 字段增删改');

// updateLink 改 URL:key 是原 href,新 URL 去重校验
core.updateLink(linksFile, 'https://example.com', { href: 'https://example.org' });
assert.ok(core.readLinks(linksFile).some((l) => l.href === 'https://example.org'), 'URL 应改成功');
assert.ok(!core.readLinks(linksFile).some((l) => l.href === 'https://example.com'), '旧 URL 应消失');
assert.throws(
  () => core.updateLink(linksFile, 'https://example.org', { href: 'https://pinia.vuejs.org' }),
  /已存在同 URL/,
);
ok('updateLink 改 URL + 重复拦截');

// home 标志(首页展示,与 featured 独立):读、写、关
const gh = core.readLinks(linksFile).find((l) => l.href === 'https://github.com');
assert.equal(gh.home, true, 'showcase GitHub 应有 home: true');
assert.equal(gh.featured, true, 'featured 与 home 独立');
core.updateLink(linksFile, 'https://github.com', { home: false });
assert.equal(core.readLinks(linksFile).find((l) => l.href === 'https://github.com').home, false, 'home 关闭后字段应移除');
core.updateLink(linksFile, 'https://github.com', { home: true });
ok('home 标志读/写/关(featured 独立)');

const before1 = core.readLinks(linksFile).map((l) => l.href);
core.moveLink(linksFile, before1[1], -1);
const after1 = core.readLinks(linksFile).map((l) => l.href);
assert.equal(after1[0], before1[1]);
assert.equal(after1[1], before1[0]);
core.moveLink(linksFile, after1[0], -1); // 已在顶部,应无操作
assert.equal(core.readLinks(linksFile)[0].href, after1[0]);
ok('moveLink 相邻交换 + 边界无操作');

core.deleteLink(linksFile, 'https://pinia.vuejs.org');
assert.ok(!core.readLinks(linksFile).some((l) => l.href === 'https://pinia.vuejs.org'));
ok('deleteLink 按 href 删除');

core.addGroup(linksFile, { id: 'podcast', label: 'Podcast', description: '常听的播客' });
assert.ok(core.readLinkGroups(linksFile).some((g) => g.id === 'podcast'));
assert.throws(() => core.addGroup(linksFile, { id: 'podcast', label: 'x', description: 'x' }), /已存在/);
core.updateGroup(linksFile, 'podcast', { label: '播客', description: '通勤时听' });
const pg = core.readLinkGroups(linksFile).find((g) => g.id === 'podcast');
assert.equal(pg.label, '播客');
core.deleteGroup(linksFile, 'podcast');
assert.ok(!core.readLinkGroups(linksFile).some((g) => g.id === 'podcast'));
ok('分组 addGroup / updateGroup / deleteGroup');

// 分组 tone:读 showcase 已有示范;新增带 tone;update 设置/修改/清除;非法值报错
const codeGroup = core.readLinkGroups(linksFile).find((g) => g.id === 'code');
assert.equal(codeGroup.tone, 'steel', 'showcase code 组应读出演示 tone');
core.addGroup(linksFile, { id: 'books', label: 'Books', description: '在读的书', tone: 'contrast' });
assert.equal(core.readLinkGroups(linksFile).find((g) => g.id === 'books').tone, 'contrast');
core.updateGroup(linksFile, 'books', { tone: 'steel' });
assert.equal(core.readLinkGroups(linksFile).find((g) => g.id === 'books').tone, 'steel');
core.updateGroup(linksFile, 'books', { tone: '' });
assert.equal(core.readLinkGroups(linksFile).find((g) => g.id === 'books').tone, undefined);
assert.throws(() => core.updateGroup(linksFile, 'books', { tone: 'purple' }), /色调只能是/);
core.deleteGroup(linksFile, 'books');
ok('分组 tone 读/写/改/清 + 非法值拦截');

const gids = core.readLinkGroups(linksFile).map((g) => g.id);
const reordered = [gids.at(-1), ...gids.slice(0, -1)];
core.reorderGroups(linksFile, reordered);
assert.deepEqual(core.readLinkGroups(linksFile).map((g) => g.id), reordered);
assert.throws(() => core.reorderGroups(linksFile, [...reordered, 'ghost']), /不一致/);
core.reorderGroups(linksFile, gids); // 还原
ok('reorderGroups 整组重排 + 集合校验');

// ── Icon.astro ──
const icons = core.readIcons(iconFile);
assert.ok(icons.length > 30);
assert.ok(icons.find((i) => i.name === 'sun')?.body.includes('<circle'));
assert.ok(icons.find((i) => i.name === 'arrow-up-right'));
ok(`readIcons 解析出 ${icons.length} 个图标`);

const lucideDir = path.join(ROOT, 'editor', 'dist', 'lucide-icons');
const body = core.lucideIconBody(lucideDir, 'braces');
assert.ok(body && body.includes('<path'), 'braces 应能从 lucide-static 提取');
assert.equal(core.lucideIconBody(lucideDir, 'not-a-real-icon'), null);
ok('lucideIconBody 提取存在图标,未知图标返回 null');

core.addIcon(iconFile, 'braces', body);
const icons2 = core.readIcons(iconFile);
assert.ok(icons2.find((i) => i.name === 'braces'));
assert.throws(() => core.addIcon(iconFile, 'braces', body), /已存在/);
const iconText = fs.readFileSync(iconFile, 'utf8');
assert.ok(iconText.includes('set:html={body}'), 'frontmatter 之外的模板部分应原样保留');
ok('addIcon 追加进 Icon.astro 且模板部分完好');

// ── frontmatter ──
const postsDir = path.join(SHOWCASE, 'posts');
const posts = core.listPosts(postsDir);
// 篇数随 showcase 内容增长,与目录里的 .md 实际数对账,不硬编码
const mdCount = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).length;
assert.equal(posts.length, mdCount);
assert.equal(posts[0].pubDate >= posts[1].pubDate, true);
assert.ok(posts.every((p) => p.valid));
ok(`listPosts 解析 ${posts.length} 篇文章`);

const md = core.buildPostContent({
  title: '测试:带冒号的标题',
  description: '描述里有 "引号" 和: 冒号空格',
  category: '博客搭建',
  tags: ['Astro', '测试 tag'],
  slug: 'test-post',
  draft: true,
  cover: '/images/covers/wide.svg',
  coverAlt: '封面',
  date: '2026-09-29',
});
const tmpPost = path.join(tmp, 'test-post.md');
fs.writeFileSync(tmpPost, md);
const parsed = core.parsePost(tmpPost);
assert.equal(parsed.title, '测试:带冒号的标题');
assert.equal(parsed.description, '描述里有 "引号" 和: 冒号空格');
assert.deepEqual(parsed.tags, ['Astro', '测试 tag']);
assert.equal(parsed.draft, true);
assert.equal(parsed.pubDate, '2026-09-29');
ok('buildPostContent → parsePost 往返一致(特殊字符安全)');
console.log('\n新建文章 frontmatter 效果:\n' + md.split('---')[1].trim());

assert.equal(core.slugify('Hello World 2026!'), 'hello-world-2026');
assert.equal(core.slugify('中文标题'), '');
ok('slugify 只留 ASCII,中文返回空交给用户手填');

// setPostDraft:就地翻转 draft 行,其余字节不动;缺字段时插入
core.setPostDraft(tmpPost, false);
assert.equal(core.parsePost(tmpPost).draft, false, 'draft true→false');
core.setPostDraft(tmpPost, true);
assert.equal(core.parsePost(tmpPost).draft, true, 'draft false→true');
const noDraft = path.join(tmp, 'no-draft.md');
fs.writeFileSync(noDraft, '---\ntitle: 没有 draft 字段\ndescription: 测试\npubDate: 2026-10-01\ncategory: 随笔\ntags: []\n---\n\n正文\n');
core.setPostDraft(noDraft, true);
const ndText = fs.readFileSync(noDraft, 'utf8');
assert.equal(core.parsePost(noDraft).draft, true, '缺字段时插入');
assert.ok(ndText.includes('正文'), '正文不受影响');
ok('setPostDraft 翻转/插入/保留正文');

// updatePostMeta:就地改写多字段,正文与未知字段原样保留;null 删字段
const metaPost = path.join(tmp, 'meta-post.md');
fs.writeFileSync(
  metaPost,
  '---\ntitle: 原标题\ndescription: 旧描述\npubDate: 2026-09-01\ncategory: 随笔\ntags: [旧]\ndraft: true\ncover: image/meta-post/a.jpg\ncoverAlt: 旧图\ncustomField: 别动我\n---\n\n正文内容不要动\n',
);
core.updatePostMeta(metaPost, {
  title: '新标题:带冒号',
  tags: ['新', '标签'],
  draft: false,
  featured: true,
  cover: null,
  coverAlt: null,
  updatedDate: '2026-10-03',
});
const afterMeta = core.parsePost(metaPost);
assert.equal(afterMeta.title, '新标题:带冒号');
assert.deepEqual(afterMeta.tags, ['新', '标签']);
assert.equal(afterMeta.draft, false);
assert.equal(afterMeta.featured, true);
assert.equal(afterMeta.cover, undefined, 'cover 传 null 应删除');
assert.equal(afterMeta.updatedDate, '2026-10-03');
const afterText = fs.readFileSync(metaPost, 'utf8');
assert.ok(afterText.includes('customField: 别动我'), '未知字段保留');
assert.ok(afterText.includes('正文内容不要动'), '正文保留');
ok('updatePostMeta 就地改写 + 删字段 + 保留正文与未知字段');

// ── profile 解析 ──
const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-root-'));
fs.mkdirSync(path.join(fakeRoot, 'src', 'profiles', 'showcase', 'posts'), { recursive: true });
fs.writeFileSync(path.join(fakeRoot, 'src', 'profiles', 'showcase', 'site.ts'), '');
fs.writeFileSync(path.join(fakeRoot, 'src', 'profiles', 'showcase', 'links.ts'), '');
let p = core.resolveProfile(fakeRoot, '');
assert.equal(p.kind, 'showcase');
fs.mkdirSync(path.join(fakeRoot, 'personal', 'posts'), { recursive: true });
fs.writeFileSync(path.join(fakeRoot, 'personal', 'site.ts'), '');
fs.writeFileSync(path.join(fakeRoot, 'personal', 'links.ts'), '');
p = core.resolveProfile(fakeRoot, '');
assert.equal(p.kind, 'personal', 'personal/ 存在时自动命中');
ok('resolveProfile 解析顺序:env > personal > showcase');

const covers = core.listImages(path.join(SHOWCASE, 'images'));
assert.ok(covers.includes('/images/covers/wide.svg'));
assert.ok(covers.includes('/images/avatar.svg'));
ok('listImages 递归列出站点路径');

// ── 图片复制 ──
const imgTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-img-'));
const src = path.join(imgTmp, 'photo.jpg');
fs.writeFileSync(src, 'fake-jpg');
const destDir = path.join(imgTmp, 'posts', 'image', 'my-post');
assert.equal(core.copyImageIn(src, destDir), 'photo.jpg');
assert.equal(core.copyImageIn(src, destDir), 'photo-2.jpg', '撞名应加 -2 后缀');
assert.equal(core.copyImageIn(src, destDir), 'photo-3.jpg', '再次撞名应加 -3 后缀');
assert.equal(fs.readFileSync(src, 'utf8'), 'fake-jpg', '源文件应保留(复制不移动)');
assert.equal(core.articleImageRef('my-post', 'photo-2.jpg'), 'image/my-post/photo-2.jpg');
assert.equal(core.siteImageRef('a.png'), '/images/a.png');
assert.equal(core.articleImageDir('/x/posts', 'my-post'), path.join('/x/posts', 'image', 'my-post'));
ok('copyImageIn 撞名加后缀、源文件保留、引用路径正确');
fs.rmSync(imgTmp, { recursive: true, force: true });

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(fakeRoot, { recursive: true, force: true });
console.log(`\n全部通过:${passed} 项`);

// ── AI 摘要纯函数 ──
const mdAi = `---
title: 测试
---
# 标题
![img](image/x/y.png)
\`\`\`js
const x = 1;
\`\`\`
这是第一段正文,讲清楚了一件事。这是第二句。
第二段[链接](https://a.b)文字。`;
assert.ok(core.prepareSource(mdAi).includes('这是第一段正文'), '正文应保留');
assert.ok(!core.prepareSource(mdAi).includes('const x'), '代码块应剔除');
assert.ok(!core.prepareSource(mdAi).includes('title:'), 'frontmatter 应剔除');
assert.ok(core.prepareSource(mdAi).includes('链接'), '链接保留文字');
assert.equal(core.normalizeSummary('摘要:「这是一次测试。」\n第二行'), '这是一次测试。', '归一化去前缀引号换行');
assert.equal(core.normalizeSummary('短'), '短');
assert.ok(core.localFallback(mdAi).startsWith('这是第一段正文'), '本地回退取首段');
assert.ok(core.buildPrompt('正文').includes('正文'), '提示词含正文');
ok('AI 摘要:正文清洗/归一化/本地回退/提示词');
