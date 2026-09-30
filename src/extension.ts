import path from 'node:path';
import * as vscode from 'vscode';
import { addIcon, lucideIconBody } from './core';
import { articleImageDir, articleImageRef, copyImageIn } from './core/images';
import { ConfigProvider } from './configView';
import { PostNode, PostsProvider } from './posts';
import { disposeServer, openPostPreview } from './preview';
import { getProfile, guard, openFile, pickImages } from './util';
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

/** 写作中插图:选图 → 复制到 posts/image/<文章名>/ → 光标处插入相对引用 */
async function insertImageCommand(): Promise<void> {
  const profile = getProfile();
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showInformationMessage('先打开一篇 Markdown 文章');
    return;
  }
  const file = editor.document.fileName;
  const rel = path.relative(profile.postsDir, file);
  if (rel.startsWith('..')) {
    vscode.window.showInformationMessage('当前文件不在文章目录(posts/)里');
    return;
  }
  const slug = path.basename(file, '.md');
  const picked = await pickImages(true);
  if (!picked?.length) return;
  const dir = articleImageDir(profile.postsDir, slug);
  const lines = picked.map((src) => {
    const name = copyImageIn(src, dir);
    const alt = path.basename(name, path.extname(name));
    return `![${alt}](${articleImageRef(slug, name)})`;
  });
  await editor.edit((eb) => eb.insert(editor.selection.active, lines.join('\n') + '\n'));
  vscode.window.showInformationMessage(`已复制 ${lines.length} 张图片到 image/${slug}/ 并插入引用`);
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
    vscode.commands.registerCommand('towardsLight.insertImage', guard(() => insertImageCommand())),
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
