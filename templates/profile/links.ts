/** 链接分组的整色色调:不配=中性;配了组内组件归入该色。纪律:彩色分组不超过 3 个 */
export type LinkGroupTone = 'accent' | 'contrast' | 'steel';

export interface LinkGroupDef {
  /** 供链接的 group 字段引用,构建期类型校验 */
  id: string;
  /** 页面显示名 */
  label: string;
  description: string;
  tone?: LinkGroupTone;
}

/** 链接分组:id 供链接的 group 字段引用;tone 给整组浸染色调 */
export const linkGroups = [
  { id: 'code', label: 'Code', description: '代码托管与开源项目' },
  { id: 'tools', label: 'Tools', description: '日常在用的软件' },
  { id: 'elsewhere', label: 'Elsewhere', description: '其他地方也能找到我' },
] as const satisfies readonly LinkGroupDef[];

export type LinkGroupId = (typeof linkGroups)[number]['id'];

export interface TechLink {
  title: string;
  description: string;
  href: string;
  /** 必须是 linkGroups 里声明过的 id;拼错会在类型检查和构建期同时报错 */
  group: LinkGroupId;
  icon?: string;
  external?: boolean;
  /** Links 页卡片形态(大图标卡片),数量不限 */
  featured?: boolean;
  /** 首页「常用去处」展示,最多 3 个 */
  home?: boolean;
  status?: string;
}

export const techLinks: TechLink[] = [
  {
    title: 'GitHub',
    description: '代码、实验和一些开源小项目',
    href: 'https://github.com',
    group: 'code',
    icon: 'github',
    external: true,
    featured: true,
    home: true,
  },
];

export function linksByGroup() {
  return linkGroups.map((g) => ({ ...g, links: techLinks.filter((l) => l.group === g.id) }));
}
