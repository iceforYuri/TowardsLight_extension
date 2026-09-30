import * as vscode from 'vscode';
import { getProfile } from './util';

interface Entry {
  label: string;
  description?: string;
  icon: string;
  command?: string;
}

/** 「站点配置」视图:当前档案提示 + 配置命令的静态入口 */
export class ConfigProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    try {
      const profile = getProfile();
      const head = new vscode.TreeItem(`档案:${profile.kind}`, vscode.TreeItemCollapsibleState.None);
      head.tooltip = profile.dir;
      head.description = profile.dir.split(/[\\/]/).pop();
      head.iconPath = new vscode.ThemeIcon('folder-opened');
      items.push(head);
    } catch {
      /* 工作区未打开时只显示命令入口 */
    }
    const entries: Entry[] = [
      { label: '编辑站点信息', description: 'siteName / author / bio / 状态…', icon: 'gear', command: 'towardsLight.editSiteConfig' },
      { label: '新增分类', description: '名称 + 图标 + 色调', icon: 'folder', command: 'towardsLight.addCategory' },
      { label: '新增链接', description: '写入 links.ts', icon: 'link', command: 'towardsLight.addLink' },
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
