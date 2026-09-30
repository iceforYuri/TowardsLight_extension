import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { addIcon, lucideIconBody } from './core';
import { articleImageDir, articleImageRef, copyImageIn } from './core/images';
import { ConfigProvider } from './configView';
import { PostNode, PostsProvider } from './posts';
import { disposeServer, openPostPreview } from './preview';
import { getProfile, guard, openFile, pickImages, workspaceRoot } from './util';
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

interface ProfilePick extends vscode.QuickPickItem {
  dir?: string;
  browse?: boolean;
}

/** 点击「档案:xxx」→ 快速选择切换当前档案;选择持久化到 workspaceState,重载后仍生效 */
async function switchProfileCommand(
  context: vscode.ExtensionContext,
  refreshAll: () => void,
): Promise<void> {
  const root = workspaceRoot();
  const personal = path.join(root, 'personal');
  const showcase = path.join(root, 'src', 'profiles', 'showcase');
  const items: ProfilePick[] = [];
  if (fs.existsSync(path.join(personal, 'site.ts'))) {
    items.push({ label: '$(account) personal', description: '个人档案', detail: personal, dir: personal });
  }
  items.push({ label: '$(package) showcase', description: '内置示例档案', detail: showcase, dir: showcase });
  const envDir = process.env.SITE_PROFILE_DIR;
  if (envDir && envDir !== personal && envDir !== showcase) {
    items.push({ label: '$(folder-active) 当前自定义目录', detail: envDir, dir: envDir });
  }
  items.push({ label: '$(folder-opened) 选择其他目录…', description: '需要包含 site.ts / links.ts / posts/', browse: true });

  const picked = await vscode.window.showQuickPick(items, {
    title: '切换档案',
    placeHolder: '扩展读写的文章与配置都来自当前档案;dev server 会在下次启动时跟随',
  });
  if (!picked) return;

  let dir = picked.dir;
  if (picked.browse) {
    const res = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '选为档案目录',
    });
    if (!res?.length) return;
    dir = res[0].fsPath;
  }
  if (!dir) return;
  const missing = ['site.ts', 'links.ts', 'posts'].filter((p) => !fs.existsSync(path.join(dir, p)));
  if (missing.length) {
    vscode.window.showErrorMessage(
      `「${dir}」不是有效档案:缺少 ${missing.join('、')}(可用 node scripts/new-profile.mjs 生成骨架)`,
    );
    return;
  }
  process.env.SITE_PROFILE_DIR = dir;
  await context.workspaceState.update('towardsLight.profileDir', dir);
  disposeServer();
  refreshAll();
  const profile = getProfile();
  vscode.window.showInformationMessage(`已切换到档案「${profile.kind}」:${profile.dir}`);
}

export function activate(context: vscode.ExtensionContext): void {
  // 恢复上次选择的档案
  const savedDir = context.workspaceState.get<string>('towardsLight.profileDir');
  if (savedDir && fs.existsSync(path.join(savedDir, 'site.ts'))) {
    process.env.SITE_PROFILE_DIR = savedDir;
  }

  const postsProvider = new PostsProvider();
  const configProvider = new ConfigProvider();
  const refreshAll = () => {
    postsProvider.refresh();
    configProvider.refresh();
    watchPosts();
  };

  let watcher: vscode.FileSystemWatcher | undefined;
  function watchPosts(): void {
    watcher?.dispose();
    watcher = undefined;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(getProfile().postsDir, '**/*.md'),
      );
      watcher.onDidCreate(refreshAll);
      watcher.onDidChange(refreshAll);
      watcher.onDidDelete(refreshAll);
    } catch {
      /* 工作区未打开时不挂监听 */
    }
  }
  watchPosts();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('towardsLightPosts', postsProvider),
    vscode.window.registerTreeDataProvider('towardsLightConfig', configProvider),
    vscode.commands.registerCommand('towardsLight.refreshPosts', () => postsProvider.refresh()),
    vscode.commands.registerCommand('towardsLight.switchProfile', guard(() => switchProfileCommand(context, refreshAll))),
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

  context.subscriptions.push({ dispose: () => watcher?.dispose() });
}

export function deactivate(): void {
  disposeServer();
}
