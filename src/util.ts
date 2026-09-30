import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { ProfileInfo, resolveProfile } from './core/profile';

export function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('请先打开博客项目文件夹');
  return folder.uri.fsPath;
}

let extContext: vscode.ExtensionContext | undefined;

/** activate 时调用一次,让工具层能读写 workspaceState */
export function initUtil(context: vscode.ExtensionContext): void {
  extContext = context;
}

/** workspaceState 存取(供 preview 等模块持久化进程账本) */
export function stateStore(): vscode.Memento {
  if (!extContext) throw new Error('扩展尚未激活');
  return extContext.workspaceState;
}

/** 一个目录是不是 TowardsLight 模板:有 package.json 和档案切换钩子 */
export function isTemplateDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'package.json')) &&
    fs.existsSync(path.join(dir, 'scripts', 'use-profile.mjs'))
  );
}

/**
 * 当前模板目录:用户选择(workspaceState)> 工作区根自动识别。
 * 都认不出来时抛错,由预览区引导用户手动选择。
 */
export function getTemplateDir(): string {
  const saved = extContext?.workspaceState.get<string>('towardsLight.templateDir');
  if (saved && isTemplateDir(saved)) return saved;
  const root = workspaceRoot();
  if (isTemplateDir(root)) return root;
  throw new Error('没认出来模板目录(需要包含 package.json 和 scripts/use-profile.mjs),请在预览区手动选择');
}

export async function setTemplateDir(dir: string): Promise<void> {
  if (!extContext) throw new Error('扩展尚未激活');
  if (!isTemplateDir(dir)) {
    throw new Error(`「${dir}」不是 TowardsLight 模板:缺少 package.json 或 scripts/use-profile.mjs`);
  }
  await extContext.workspaceState.update('towardsLight.templateDir', dir);
}

/** 解析当前档案;失败时弹出错误并继续抛出,由调用方决定要不要吞掉 */
export function getProfile(): ProfileInfo {
  const root = workspaceRoot();
  try {
    const profile = resolveProfile(root);
    // 图标表在模板侧;模板目录被改到别处时跟随
    try {
      const template = getTemplateDir();
      if (template !== root) {
        profile.iconFile = path.join(template, 'src', 'components', 'Icon.astro');
      }
    } catch {
      /* 模板未识别时沿用工作区根的默认路径 */
    }
    return profile;
  } catch (e) {
    vscode.window.showErrorMessage(`档案解析失败:${(e as Error).message}`);
    throw e;
  }
}

export async function openFile(file: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
}

/** 系统原生图片选择框;取消返回 undefined */
export async function pickImages(multi = false): Promise<string[] | undefined> {
  const res = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: multi,
    filters: { 图片: ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] },
    openLabel: '选择图片',
  });
  return res?.map((u) => u.fsPath);
}

/** 包装命令执行,把核心层抛出的中文错误弹给用户 */
export function guard<T extends unknown[]>(fn: (...args: T) => unknown): (...args: T) => void {
  return (...args) => {
    try {
      const r = fn(...args);
      if (r instanceof Promise) {
        r.catch((e) => vscode.window.showErrorMessage((e as Error).message));
      }
    } catch (e) {
      vscode.window.showErrorMessage((e as Error).message);
    }
  };
}

/**
 * 把 site.ts 里的图片引用解析成 webview 可用的 URI(用于表单缩略图)。
 * /images/ 开头 → 档案 imagesDir;image/ 开头 → postsDir 下的文章级相对路径。
 * 解析不到或文件不存在返回 null。
 */
export function resolveImageUri(
  webview: vscode.Webview,
  profile: ProfileInfo,
  ref: string,
): string | null {
  let file: string | null = null;
  if (ref.startsWith('/images/') && profile.imagesDir) {
    const rel = path.resolve(profile.imagesDir, ref.slice('/images/'.length));
    if (rel.startsWith(path.resolve(profile.imagesDir))) file = rel;
  } else if (ref.startsWith('image/')) {
    const abs = path.resolve(profile.postsDir, ref);
    if (abs.startsWith(path.resolve(profile.postsDir))) file = abs;
  }
  if (!file || !fs.existsSync(file)) return null;
  return webview.asWebviewUri(vscode.Uri.file(file)).toString();
}
