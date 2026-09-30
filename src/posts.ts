import * as vscode from 'vscode';
import { listPosts, PostMeta } from './core/frontmatter';
import { getProfile } from './util';

type Node = GroupNode | PostNode;

class GroupNode extends vscode.TreeItem {
  constructor(
    public readonly kind: 'draft' | 'published',
    public readonly posts: PostMeta[],
  ) {
    super(kind === 'draft' ? '草稿' : '已发布', vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(posts.length);
    this.iconPath = new vscode.ThemeIcon(kind === 'draft' ? 'edit' : 'checklist');
  }
}

export class PostNode extends vscode.TreeItem {
  constructor(public readonly post: PostMeta) {
    super(post.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'post';
    this.description = [post.pubDate.slice(5), post.category].filter(Boolean).join(' · ');
    this.tooltip = new vscode.MarkdownString(
      `**${post.title}**\n\n${post.description}\n\n\`${post.slug}.md\``,
    );
    this.iconPath = new vscode.ThemeIcon(
      !post.valid ? 'warning' : post.draft ? 'pencil' : 'file-text',
    );
    this.command = {
      command: 'vscode.open',
      title: '打开文章',
      arguments: [vscode.Uri.file(post.file)],
    };
  }
}

export class PostsProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (element) {
      return element instanceof GroupNode ? element.posts.map((p) => new PostNode(p)) : [];
    }
    let posts: PostMeta[];
    try {
      posts = listPosts(getProfile().postsDir);
    } catch {
      return [];
    }
    const drafts = posts.filter((p) => p.draft);
    const published = posts.filter((p) => !p.draft);
    const groups: Node[] = [];
    if (drafts.length) groups.push(new GroupNode('draft', drafts));
    groups.push(new GroupNode('published', published));
    return groups;
  }
}
