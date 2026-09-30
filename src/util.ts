import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { ProfileInfo, resolveProfile } from './core/profile';

export function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('请先打开博客项目文件夹');
  return folder.uri.fsPath;
}

/** 解析当前档案;失败时弹出错误并继续抛出,由调用方决定要不要吞掉 */
export function getProfile(): ProfileInfo {
  const root = workspaceRoot();
  try {
    return resolveProfile(root);
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
