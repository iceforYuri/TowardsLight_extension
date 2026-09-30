# TowardsLight 博客工具(VS Code 扩展)

本地写作与配置工具,不进模板库版本控制(根目录 `.gitignore` 已屏蔽 `editor/`)。

## 功能

**文章管理**(左侧活动栏「博客」图标)

- 文章树:按 草稿 / 已发布 分组,显示日期与分类,点击打开
- 新建文章:表单填写标题 / slug / 分类 / 标签 / 封面,日期自动,生成到当前档案
- 预览:文章树内联按钮(或命令面板 `预览文章`),自动复用或拉起 `npm run dev`,
  在旁边开 iframe 显示真实渲染,Astro HMR 保存即刷新

**站点配置**(「站点配置」视图)

- 编辑站点信息:siteName / author / bio / 邮箱 / 头像 / currentStatus 等,表单写回 site.ts
- 新增分类:名称 + 图标选择器(带搜索)+ accent/contrast 色调,写进 categoryMeta
- 新增链接:分组下拉(可新建组)+ 图标 + featured,追加进 links.ts
- 新增 Lucide 图标:输入 lucide.dev 上的图标名,自动提取 SVG 补录进 Icon.astro

所有写回都是 AST 定位 + 文本级插入,保留文件原有注释、格式和 `as const` 断言。

## 档案解析

和 `scripts/use-profile.mjs` 同一套顺序:`SITE_PROFILE_DIR` 环境变量 > `./personal/` > 内置 `showcase`。
「站点配置」视图顶部显示当前命中的档案。

## 使用

```bash
cd editor
npm install
npm run build      # esbuild 打包到 dist/
```

调试:在 VS Code 里打开 `editor/` 目录,按 `F5` —— 会启动扩展开发宿主窗口并自动打开博客项目。

安装到日常 VS Code:

```bash
npm run package    # 产出 towards-light-editor-0.1.0.vsix
code --install-extension towards-light-editor-0.1.0.vsix
```

## 测试

```bash
npm test           # 核心读写逻辑(17 项断言,跑在 showcase 副本上,不碰真实档案)
```

## 结构

```
src/core/        纯逻辑层(不依赖 vscode,可在 Node 下测试)
  profile.ts     档案解析 + 图片列表
  frontmatter.ts 文章解析 / 新建文章 frontmatter 生成
  configAst.ts   site.ts / links.ts 的 AST 读写
  icons.ts       Icon.astro 图标表读写 + lucide-static 提取
  textEdit.ts    文本级插入助手
src/posts.ts     文章树
src/preview.ts   dev server 管理 + iframe 预览
src/webviews/    四个表单(新建文章 / 站点信息 / 新增分类 / 新增链接)
scripts/test-core.mjs
```

## 二期方向(已记下,未开工)

**文章管理**

- **文章树增强**:现在只有草稿/已发布两组,略显单薄。按分类或标签分组/筛选,快速定位文章
- **已发布文章元数据编辑**:复用新建表单改 frontmatter(标题/标签/分类/封面)
- **草稿 ⇄ 发布切换**:文章树上一键切 draft
- **删除文章**:带确认的删除

**站点配置**

- **表单 UI 优化**:分组排版更精致;头像等图片字段加实时预览
- **链接管理**:links.ts 的列表、修改、删除(v1 只做了新增)
- **分类管理**:已有分类的修改、删除(v1 只做了新增)

**明确不做**:重命名 slug、定时发布

## 图片资产管理(设计已定,待开工)

**背景**:表单里选图目前只能选"已在 images/ 里的图"。要支持从电脑任意位置选图(VS Code 原生选择框),复制进档案并自动把 `/images/...` 引用填回表单。

**目录规矩(修订:跟随 personal/ 现有约定)**

```
personal/
├── images/                     ← 站点级:头像、Hero/页面背景;junction 服务,绝对路径 /images/...
└── posts/
    ├── my-post.md
    └── image/                  ← 文章级:封面与正文插图统一放这
        └── my-post/            ← 按文章名归目录,文件名保留原名,撞名自动加 -2 后缀
            ├── cover.jpg       ← frontmatter: cover: image/my-post/cover.jpg(相对路径)
            └── benchmark.png   ← 正文: ![描述](image/my-post/benchmark.png)
```

正文图走相对引用(astro:assets 优化,现有粘贴约定已验证可用);封面也用相对路径,与正文图同一套规矩。
**前置依赖(主仓库改动)**:文章页封面目前只认 `/images/...` 绝对路径(`src={u(cover)}`),需支持相对路径解析(cover 以 `/` 开头照旧走 public;否则按相对文章文件解析,import.meta.glob 资产映射),同时兼容 showcase 现有的绝对路径封面;届时同步更新 personal/posts/模板.md 里的注释示例。

**行为决策(已拍板)**:复制不移动源文件;封面覆盖式更新;正文图不覆盖;不做大文件提醒和压缩。

**三个入口(一次做完)**

1. 新建文章表单:封面下拉加「从电脑选择…」→ 复制到 `posts/image/<slug>/` → frontmatter 写相对路径
2. 站点配置表单:头像及各页背景图字段加选择按钮 → 复制到 `images/`(站点级);表单范围同时扩到 `site.pages`(各页标题/描述)与 `pageBackdrops`——目前各内容页文案与背景都已配置化,表单要跟上
3. 写作中:命令「插入正文图片」→ 复制到 `posts/image/<当前文章名>/` → 光标处插入 `![描述](image/<文章名>/xxx.png)`

**配套**:工作区 `markdown.copyFiles.destination` 目标固化为 `image/${documentBaseName}/`(与现有粘贴约定一致;目前该约定不在仓库设置里,换机器会丢,建议落进博客项目的 `.vscode/settings.json`)。
