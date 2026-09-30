import * as vscode from 'vscode';
import { getProfile } from './util';

interface Entry {
  label: string;
  description?: string;
  icon: string;
  command?: string;
}

/** 「站点配置」视图:当前档案(可点击切换) + 配置命令的静态入口 */
export class ConfigProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    try {
      const profile = getProfile();
      const dirName = profile.dir.split(/[\\/]/).pop();
      const head = new vscode.TreeItem(`档案:${dirName}`, vscode.TreeItemCollapsibleState.None);
      head.tooltip = new vscode.MarkdownString(`\`${profile.dir}\`\n\n来源:${profile.kind} · 点击切换档案`);
      head.description = profile.kind;
      head.iconPath = new vscode.ThemeIcon('folder-opened');
      head.command = { command: 'towardsLight.switchProfile', title: '切换档案' };
      items.push(head);
    } catch {
      /* 工作区未打开时只显示命令入口 */
    }
    const entries: Entry[] = [
      { label: '编辑站点信息', description: 'siteName / author / bio / 状态…', icon: 'gear', command: 'towardsLight.editSiteConfig' },
      { label: '管理分类', description: '新增 / 修改图标、色调与描述', icon: 'folder', command: 'towardsLight.addCategory' },
      { label: '管理链接', description: '列表、排序、编辑、分组', icon: 'link', command: 'towardsLight.addLink' },
      { label: '新增 Lucide 图标', description: '补录进 Icon.astro', icon: 'symbol-misc', command: 'towardsLight.addIcon' },
      { label: '打开 site.ts', icon: 'go-to-file', command: 'towardsLight.openSiteFile' },
      { label: '打开 links.ts', icon: 'go-to-file', command: 'towardsLight.openLinksFile' },
    ];
    for (const e of entries) {
      const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
      item.description = e.description;
      item.iconPath = new vscode.ThemeIcon(e.icon);
      if (e.command) item.command = { command: e.command, title: e.label };
      items.push(item);
    }
    return items;
  }
}
