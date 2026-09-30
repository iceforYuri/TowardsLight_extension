import path from 'node:path';
import * as vscode from 'vscode';
import { addIcon, lucideIconBody } from './core';
import { ConfigProvider } from './configView';
import { PostNode, PostsProvider } from './posts';
import { disposeServer, openPostPreview } from './preview';
import { getProfile, guard, openFile, workspaceRoot } from './util';
import { openCategoryForm } from './webviews/category';
import { openLinkForm } from './webviews/link';
import { openNewPostForm } from './webviews/newPost';
import { openSiteConfigForm } from './webviews/siteConfig';

async function addIconCommand(context: vscode.ExtensionContext): Promise<void> {
  const profile = getProfile();
  const name = await vscode.window.showInputBox({
    title: '新增 Lucide 图标',
    prompt: '输入 lucide.dev 上的图标名(kebab-case),补录进 Icon.astro',
    placeHolder: '如:braces',
    validateInput: (v) =>
      /^[a-z0-9-]+$/.test(v) ? null : '图标名只能是小写字母、数字和连字符',
  });
  if (!name) return;
  const iconsDir = path.join(context.extensionPath, 'dist', 'lucide-icons');
  const body = lucideIconBody(iconsDir, name);
  if (!body) {
    vscode.window.showErrorMessage(`lucide-static 里没有「${name}」,去 https://lucide.dev/icons 核对名字`);
    return;
  }
  addIcon(profile.iconFile, name, body);
  vscode.window.showInformationMessage(`图标 ${name} 已补录进 Icon.astro,分类/链接表单立即可用`);
}

export function activate(context: vscode.ExtensionContext): void {
  const postsProvider = new PostsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('towardsLightPosts', postsProvider),
    vscode.window.registerTreeDataProvider('towardsLightConfig', new ConfigProvider()),
    vscode.commands.registerCommand('towardsLight.refreshPosts', () => postsProvider.refresh()),
    vscode.commands.registerCommand('towardsLight.newPost', guard(() => openNewPostForm(() => postsProvider.refresh()))),
    vscode.commands.registerCommand(
      'towardsLight.openPostPreview',
      guard(async (node?: PostNode) => {
        const file =
          node?.post?.file ??
          (vscode.window.activeTextEditor?.document.fileName.endsWith('.md')
            ? vscode.window.activeTextEditor?.document.fileName
            : undefined);
        await openPostPreview(file);
      }),
    ),
    vscode.commands.registerCommand('towardsLight.editSiteConfig', guard(() => openSiteConfigForm())),
    vscode.commands.registerCommand('towardsLight.addCategory', guard(() => openCategoryForm())),
    vscode.commands.registerCommand('towardsLight.addLink', guard(() => openLinkForm())),
    vscode.commands.registerCommand('towardsLight.addIcon', guard(() => addIconCommand(context))),
    vscode.commands.registerCommand('towardsLight.openSiteFile', guard(() => openFile(getProfile().siteFile))),
    vscode.commands.registerCommand('towardsLight.openLinksFile', guard(() => openFile(getProfile().linksFile))),
  );

  try {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(getProfile().postsDir, '**/*.md'),
    );
    const refresh = () => postsProvider.refresh();
    watcher.onDidCreate(refresh);
    watcher.onDidChange(refresh);
    watcher.onDidDelete(refresh);
    context.subscriptions.push(watcher);
  } catch {
    /* 工作区未打开时不挂监听 */
  }
}

export function deactivate(): void {
  disposeServer();
}
