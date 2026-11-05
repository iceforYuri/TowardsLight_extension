import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_EXTS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] as const;

/**
 * 复制图片进目标目录;撞名自动加 -2/-3 后缀(不覆盖,正文可能正引用旧图)。
 * 返回落盘后的文件名(不含目录)。
 */
export function copyImageIn(srcFile: string, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(srcFile);
  const base = path.basename(srcFile, ext);
  let name = path.basename(srcFile);
  let n = 1;
  while (fs.existsSync(path.join(destDir, name))) {
    n++;
    name = `${base}-${n}${ext}`;
  }
  fs.copyFileSync(srcFile, path.join(destDir, name));
  return name;
}

/** 文章级图片目录:posts/image/<文章名>/ */
export function articleImageDir(postsDir: string, slug: string): string {
  return path.join(postsDir, 'image', slug);
}

function resolveArticleImageDir(articleFile: string, ref: string): string | null {
  let target = ref.trim();
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  target = target.split(/[?#]/, 1)[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  return path.dirname(path.resolve(path.dirname(articleFile), target));
}

/**
 * Directories that can contain assets for one article.
 * The conventional <slug> directory is retained, and directories referenced by
 * Markdown/HTML images are added so legacy or shortened folder names still work.
 */
export function articleImageDirs(postsDir: string, articleFile: string, cover?: string): string[] {
  const imageRoot = path.resolve(postsDir, 'image');
  const slug = path.basename(articleFile).replace(/\.md$/i, '');
  const dirs = new Set<string>([articleImageDir(postsDir, slug)]);
  let text = '';
  try {
    text = fs.readFileSync(articleFile, 'utf8');
  } catch {
    return [...dirs];
  }
  const refs: string[] = [];
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    if (m[1] || m[2]) refs.push(m[1] ?? m[2]);
  }
  for (const m of text.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    if (m[1] || m[2]) refs.push(m[1] ?? m[2]);
  }
  if (cover) refs.push(cover);
  for (const ref of refs) {
    const dir = resolveArticleImageDir(articleFile, ref);
    if (!dir) continue;
    const rel = path.relative(imageRoot, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    dirs.add(dir);
  }
  return [...dirs];
}

/** 文章级引用(相对文章 .md):image/<文章名>/<文件> */
export function articleImageRef(slug: string, fileName: string): string {
  return `image/${slug}/${fileName}`;
}

/** 站点级引用(junction 服务):/images/<文件> */
export function siteImageRef(fileName: string): string {
  return `/images/${fileName}`;
}
