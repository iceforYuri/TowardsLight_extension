import fs from 'node:fs';
import path from 'node:path';

/** 档案骨架:缺什么补什么,已有文件绝不动。返回新建的条目列表 */
export function initProfile(dir: string, templatesDir: string): string[] {
  const created: string[] = [];
  const copyTpl = (name: string) => {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(path.join(templatesDir, name), target);
    created.push(name);
  };
  fs.mkdirSync(dir, { recursive: true });
  copyTpl('site.ts');
  copyTpl('links.ts');
  for (const sub of ['posts', 'images']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(`${sub}/`);
    }
  }
  return created;
}
