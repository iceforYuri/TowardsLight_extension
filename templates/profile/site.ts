export interface FlipItem {
  icon: string;
  text: string;
  href?: string;
}

export interface FlipPanel {
  label: string;
  items: FlipItem[];
}

export const site = {
  siteName: '我的博客',
  /** 站点完整 URL(影响 RSS/canonical);部署时可用 SITE_URL 环境变量覆盖 */
  siteUrl: 'https://blog.example.com',
  siteNameEn: 'MY BLOG',
  author: '你的名字',
  bio: '一句话介绍自己。',
  shortBio: '写代码,写文字。',
  avatar: '',
  /** 头像裁切焦点(object-position),竖向人像建议 'center 30%' */
  avatarPosition: 'center',
  /** 默认主题:system=跟随系统;light/dark=固定默认(访客手动切换后仍记住其选择) */
  themeDefault: 'system' as 'system' | 'light' | 'dark',
  email: 'hi@example.com',
  navigation: [
    { label: 'Home', href: '/', icon: 'home' },
    { label: 'Archive', href: '/archive', icon: 'archive' },
    { label: 'Tags', href: '/tags', icon: 'tag' },
    { label: 'Categories', href: '/categories', icon: 'folder' },
    { label: 'Links', href: '/links', icon: 'link' },
  ],
  socialLinks: [
    { label: 'GitHub', href: 'https://github.com', icon: 'github' },
    { label: 'RSS', href: '/rss.xml', icon: 'rss' },
    { label: 'Email', href: 'mailto:hi@example.com', icon: 'mail' },
  ],
  homeHero: {
    greeting: '我的博客',
    tagline: '一句话标语',
    intro: '这里写一两句介绍。',
    background: '',
    /** 图上文字模式:auto=按处理后背景亮度自动;on-dark=浅字;on-light=深字(仅影响亮色主题,深色主题一律收暗配浅字) */
    textMode: 'auto' as 'auto' | 'on-dark' | 'on-light',
  },
  pageBackdrops: {
    archive: '',
    tags: '',
    categories: '',
    links: '',
  },

  /** 各内容页文案:标题 + 描述;详情页标题为插值模板,留在代码里 */
  pages: {
    archive: { title: '归档', description: '写过的所有文章，按年份排列。' },
    tags: { title: '标签', description: '文章按主题打的标签，比分类更细一些。' },
    categories: { title: '分类', description: '文章的大致归属，每个分类是一种长期关心的事。' },
    links: { title: '链接', description: '我常用的工具、常去的社区、认可的平台。不是导航站，是个人选择。' },
    notFound: {
      title: '这一页不存在',
      description: '链接可能已经过期，或者地址打错了。文章都还在，从下面回去就能找到。',
    },
  },
  currentStatus: {
    mode: 'writing' as 'writing' | 'building' | 'available' | 'offline',
    text: '正在写点什么',
  },
  stack: ['Astro', 'TypeScript'],
  /** 分类视觉配置:图标 + 色调 + 描述;未配置的分类用 folder + accent 兜底 */
  categoryMeta: {} as Record<
    string,
    { icon: string; tone: 'accent' | 'contrast' | 'steel'; description: string }
  >,
  /** 首页介绍区底部的翻牌栏:两套内容定时滚换 */
  flipRow: {
    interval: 3000,
    panels: [
      {
        label: 'STACK',
        items: [
          { icon: 'omega', text: 'Astro' },
          { icon: 'file-type', text: 'TypeScript' },
        ],
      },
      {
        label: 'CONNECT',
        items: [
          { icon: 'github', text: 'GitHub', href: 'https://github.com' },
          { icon: 'mail', text: 'hi@example.com', href: 'mailto:hi@example.com' },
        ],
      },
    ] as FlipPanel[],
  },
} as const;

export type SiteConfig = typeof site;
