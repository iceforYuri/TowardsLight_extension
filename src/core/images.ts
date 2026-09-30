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

/** 文章级引用(相对文章 .md):image/<文章名>/<文件> */
export function articleImageRef(slug: string, fileName: string): string {
  return `image/${slug}/${fileName}`;
}

/** 站点级引用(junction 服务):/images/<文件> */
export function siteImageRef(fileName: string): string {
  return `/images/${fileName}`;
}
