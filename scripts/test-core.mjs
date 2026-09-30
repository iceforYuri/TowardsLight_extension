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
assert.equal(cfg.heroBackground, '/images/hero-bg.svg');
assert.equal(cfg.backdrops.archive, '');
assert.equal(cfg.pages.archive.title, '归档');
assert.ok(cfg.pages.notFound.description.length > 0);
ok('readSiteConfig 读取基本字段与嵌套块(currentStatus/homeHero/pageBackdrops/pages)');

const before = fs.readFileSync(siteFile, 'utf8');
const changed = core.updateSiteConfig(siteFile, {
  siteName: '测试站',
  statusMode: 'writing',
  statusText: '正在验证扩展的读写',
  heroBackground: '/images/new-hero.jpg',
  backdrops: { archive: '/images/archive-bg.jpg', tags: '' },
  pages: { links: { title: '宝藏链接', description: '改写后的链接页描述' } },
});
assert.equal(changed, 7);
const cfg2 = core.readSiteConfig(siteFile);
assert.equal(cfg2.siteName, '测试站');
assert.equal(cfg2.statusMode, 'writing');
assert.equal(cfg2.statusText, '正在验证扩展的读写');
assert.equal(cfg2.heroBackground, '/images/new-hero.jpg');
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

const siteText = fs.readFileSync(siteFile, 'utf8');
const catBlock = siteText.match(/读书: \{[\s\S]*?\},/);
assert.ok(catBlock && catBlock[0].includes("\n      icon: 'book-open',"), '新增分类应匹配现有缩进风格');
ok('新增分类的格式与现有条目一致');
console.log('\n新增分类写入效果:\n' + catBlock[0]);

// ── links.ts ──
const groups = core.readLinkGroups(linksFile);
assert.equal(groups.length, 8);
assert.ok(groups.includes('Code'));
ok('readLinkGroups 读出 8 个分组');

core.addLink(linksFile, {
  title: 'Example',
  description: '测试链接',
  href: 'https://example.com',
  group: 'Code',
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
  group: 'Reading',
});
linksText = fs.readFileSync(linksFile, 'utf8');
assert.ok(core.readLinkGroups(linksFile).includes('Reading'), '新分组应补进 linkGroups');
assert.ok(!linksText.includes("title: 'Pinia',\n    icon"), '无图标时不写 icon 行');
assert.ok(!/Pinia[\s\S]*?external/.test(linksText.split('Pinia')[1]?.slice(0, 200) ?? ''), 'external: false 时不写 external 行');
ok('addLink 新建分组 + 可选字段按需输出');
console.log('\n新增链接写入效果:' + linksText.match(/\{\n    title: 'Pinia'[\s\S]*?\},/)[0]);

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
const posts = core.listPosts(path.join(SHOWCASE, 'posts'));
assert.equal(posts.length, 12);
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
