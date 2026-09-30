import fs from 'node:fs';
import path from 'node:path';

export interface ProfileInfo {
  /** 工作区根目录(博客项目) */
  root: string;
  /** 当前档案目录绝对路径 */
  dir: string;
  kind: 'env' | 'personal' | 'showcase';
  postsDir: string;
  imagesDir: string | null;
  siteFile: string;
  linksFile: string;
  /** 图标表组件,始终在模板侧 */
  iconFile: string;
}

/** 与 scripts/use-profile.mjs 同一套解析顺序:SITE_PROFILE_DIR > ./personal/ > 内置 showcase */
export function resolveProfile(root: string, envDir = process.env.SITE_PROFILE_DIR): ProfileInfo {
  let dir: string;
  let kind: ProfileInfo['kind'];
  if (envDir) {
    dir = path.resolve(envDir);
    kind = 'env';
  } else if (fs.existsSync(path.join(root, 'personal', 'site.ts'))) {
    dir = path.join(root, 'personal');
    kind = 'personal';
  } else {
    dir = path.join(root, 'src', 'profiles', 'showcase');
    kind = 'showcase';
  }
  const missing = ['site.ts', 'links.ts', 'posts'].filter((p) => !fs.existsSync(path.join(dir, p)));
  if (missing.length) {
    throw new Error(`档案目录缺少 ${missing.join('、')}: ${dir}(可用 node scripts/new-profile.mjs 生成骨架)`);
  }
  const imagesDir = path.join(dir, 'images');
  return {
    root,
    dir,
    kind,
    postsDir: path.join(dir, 'posts'),
    imagesDir: fs.existsSync(imagesDir) ? imagesDir : null,
    siteFile: path.join(dir, 'site.ts'),
    linksFile: path.join(dir, 'links.ts'),
    iconFile: path.join(root, 'src', 'components', 'Icon.astro'),
  };
}

/** 档案下可供选择的封面图,返回 ['/images/covers/wide.svg', …] 形式的站点路径 */
export function listImages(imagesDir: string | null): string[] {
  if (!imagesDir) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(svg|png|jpe?g|webp|avif|gif)$/i.test(entry.name)) {
        out.push('/images/' + path.relative(imagesDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(imagesDir);
  return out.sort();
}
