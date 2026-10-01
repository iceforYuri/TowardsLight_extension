import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { addIcon, lucideIconBody } from './core';
import { articleImageDir, articleImageRef, copyImageIn } from './core/images';
import { ConfigProvider } from './configView';
import { PostNode, PostsProvider } from './posts';
import { disposePreviewLog, disposeServer, onDidChangeServers, openPostPreview, openSitePreview, previewLog, reapOrphanServers, startPreview, stopServer } from './preview';
import { PreviewProvider, ServerNode } from './previewView';
import { getProfile, getTemplateDir, guard, initUtil, openFile, pickImages, setTemplateDir, workspaceRoot } from './util';
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

const PROFILE_REQUIRED = ['site.ts', 'links.ts', 'posts'];

/** 一个目录是不是有效档案:同时包含 site.ts / links.ts / posts/ */
function isProfileDir(dir: string): boolean {
  return PROFILE_REQUIRED.every((p) => fs.existsSync(path.join(dir, p)));
}

/** 扫描工作区根目录往下最多两层,找出所有有效档案目录(跳过依赖/构建/模板内部目录) */
const SCAN_SKIP = new Set(['node_modules', 'dist', 'out', '.git', 'src', 'editor']);
function scanProfiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return;
    if (isProfileDir(dir)) {
      found.push(dir);
      return; // 档案目录不再向下钻
    }
    if (depth === 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

/** 点击「档案:xxx」→ 快速选择切换当前档案;选择持久化到 workspaceState,重载后仍生效 */
async function switchProfileCommand(
  context: vscode.ExtensionContext,
  refreshAll: () => void,
): Promise<void> {
  const root = workspaceRoot();
  let templateDir = root;
  try {
    templateDir = getTemplateDir();
  } catch {
    /* 模板未识别时按工作区根处理 */
  }
  const showcase = path.join(templateDir, 'src', 'profiles', 'showcase');
  const envDir = process.env.SITE_PROFILE_DIR;

  const items: ProfilePick[] = [];
  for (const dir of scanProfiles(root)) {
    const rel = path.relative(root, dir) || '.';
    const isCurrent = dir === envDir;
    items.push({
      label: `${isCurrent ? '$(check) ' : '$(folder) '} ${path.basename(dir)}`,
      description: isCurrent ? '当前档案' : undefined,
      detail: rel,
      dir,
    });
  }
  if (envDir && !items.some((i) => i.dir === envDir) && fs.existsSync(envDir)) {
    items.push({ label: '$(check) 当前自定义目录', description: '当前档案', detail: envDir, dir: envDir });
  }
  items.push({
    label: '$(package) showcase',
    description: '内置示例档案',
    detail: path.relative(templateDir, showcase),
    dir: showcase,
  });
  items.push({
    label: '$(folder-opened) 选择其他目录…',
    description: '需要包含 site.ts / links.ts / posts/',
    browse: true,
  });

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
  refreshAll();
  const profile = getProfile();
  const dirName = profile.dir.split(/[\\/]/).pop();
  vscode.window.showInformationMessage(`已切换到档案「${dirName}」:${profile.dir}`);
}

/** 手动选择模板目录;校验后持久化 */
async function selectTemplateDirCommand(refreshAll: () => void): Promise<void> {
  const res = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: '选为模板目录',
  });
  if (!res?.length) return;
  await setTemplateDir(res[0].fsPath);
  refreshAll();
  vscode.window.showInformationMessage(`模板目录已设为:${res[0].fsPath}`);
}

/** 启动预览:拉起(或复用)当前 模板+档案 组合的 dev server,给出地址 */
async function startPreviewCommand(): Promise<void> {
  const rec = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在启动 dev server…' },
    () => startPreview(),
  );
  const url = `http://localhost:${rec.port}/`;
  const action = await vscode.window.showInformationMessage(
    `预览已启动:${url}`,
    '在面板中打开',
    '在浏览器打开',
    '复制地址',
  );
  if (action === '在面板中打开') await openSitePreview(rec);
  else if (action === '在浏览器打开') await vscode.env.openExternal(vscode.Uri.parse(url));
  else if (action === '复制地址') await vscode.env.clipboard.writeText(url);
}

export function activate(context: vscode.ExtensionContext): void {
  initUtil(context);
  // 上次会话拉起的 dev server 可能已成孤儿,按 PID 账本回收
  reapOrphanServers();
  // 恢复上次选择的档案
  const savedDir = context.workspaceState.get<string>('towardsLight.profileDir');
  if (savedDir && fs.existsSync(path.join(savedDir, 'site.ts'))) {
    process.env.SITE_PROFILE_DIR = savedDir;
  }

  const postsProvider = new PostsProvider();
  const configProvider = new ConfigProvider();
  const previewProvider = new PreviewProvider();
  const refreshAll = () => {
    postsProvider.refresh();
    configProvider.refresh();
    previewProvider.refresh();
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
    vscode.window.registerTreeDataProvider('towardsLightPreview', previewProvider),
    onDidChangeServers(() => previewProvider.refresh()),
    vscode.commands.registerCommand('towardsLight.refreshPosts', () => postsProvider.refresh()),
    vscode.commands.registerCommand('towardsLight.switchProfile', guard(() => switchProfileCommand(context, refreshAll))),
    vscode.commands.registerCommand('towardsLight.selectTemplateDir', guard(() => selectTemplateDirCommand(refreshAll))),
    vscode.commands.registerCommand('towardsLight.startPreview', guard(() => startPreviewCommand())),
    vscode.commands.registerCommand('towardsLight.showServerLog', () => previewLog().show()),
    vscode.commands.registerCommand('towardsLight.stopServer', guard((node?: ServerNode) => {
      if (node) stopServer(node.rec);
    })),
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
  disposePreviewLog();
}
