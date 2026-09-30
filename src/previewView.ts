import path from 'node:path';
import * as vscode from 'vscode';
import { listServers, ServerRec } from './preview';
import { getProfile, getTemplateDir } from './util';

class Row extends vscode.TreeItem {}

export class ServerNode extends vscode.TreeItem {
  constructor(public readonly rec: ServerRec) {
    super(`localhost:${rec.port}`, vscode.TreeItemCollapsibleState.None);
  }
}

/** 「预览」区:模板 / 档案 / 启动预览 + 运行中的 server 列表 */
export class PreviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    let templateDir: string | null = null;
    try {
      templateDir = getTemplateDir();
    } catch {
      /* 未识别,引导用户选择 */
    }
    const tpl = new Row(
      templateDir ? `模板: ${path.basename(templateDir)}` : '选择模板目录…',
      vscode.TreeItemCollapsibleState.None,
    );
    tpl.tooltip = templateDir
      ? new vscode.MarkdownString(`\`${templateDir}\`\n\n点击更换模板目录`)
      : '没认出来模板目录,点击手动选择';
    tpl.iconPath = new vscode.ThemeIcon(templateDir ? 'repo' : 'warning');
    tpl.command = { command: 'towardsLight.selectTemplateDir', title: '选择模板目录' };
    items.push(tpl);

    try {
      const profile = getProfile();
      const profileRow = new Row(
        `档案: ${path.basename(profile.dir)}`,
        vscode.TreeItemCollapsibleState.None,
      );
      profileRow.description = profile.kind;
      profileRow.tooltip = new vscode.MarkdownString(`\`${profile.dir}\`\n\n点击切换档案`);
      profileRow.iconPath = new vscode.ThemeIcon('folder-opened');
      profileRow.command = { command: 'towardsLight.switchProfile', title: '切换档案' };
      items.push(profileRow);
    } catch {
      /* 工作区未打开 */
    }

    const start = new Row('启动预览', vscode.TreeItemCollapsibleState.None);
    start.iconPath = new vscode.ThemeIcon('play');
    start.tooltip = '用当前模板 + 档案启动 dev server 并给出预览地址';
    start.command = { command: 'towardsLight.startPreview', title: '启动预览' };
    items.push(start);

    for (const rec of listServers()) {
      const node = new ServerNode(rec);
      node.label = `localhost:${rec.port}`;
      node.description = path.basename(rec.profileDir);
      node.tooltip = new vscode.MarkdownString(
        `模板:\`${rec.templateDir}\`\n\n档案:\`${rec.profileDir}\`\n\n点击在浏览器打开`,
      );
      node.iconPath = new vscode.ThemeIcon('radio-tower');
      node.contextValue = 'server';
      node.command = {
        command: 'vscode.open',
        title: '在浏览器打开',
        arguments: [vscode.Uri.parse(`http://localhost:${rec.port}/`)],
      };
      items.push(node);
    }
    return items;
  }
}
