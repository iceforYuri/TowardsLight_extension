# TowardsLight 博客工具(VS Code 扩展)

本地写作与配置工具,不进模板库版本控制(根目录 `.gitignore` 已屏蔽 `editor/`)。

## 功能

**文章管理**(左侧活动栏「博客」图标)

- 文章树:按 草稿 / 已发布 分组,显示日期与分类,点击打开
- 新建文章:表单填写标题 / slug / 分类 / 标签 / 封面,日期自动,生成到当前档案;
  封面可直接从电脑选图,自动复制进档案并按相对路径引用
- 预览:文章树内联按钮(或命令面板 `预览文章`),自动复用或拉起 `npm run dev`,
  在旁边开 iframe 显示真实渲染,Astro HMR 保存即刷新
- 插入正文图片:Markdown 编辑器右键菜单,选图(可多选)→ 复制到 `posts/image/<文章名>/`
  → 光标处插入相对引用

**站点配置**(「站点配置」视图)

- 编辑站点信息:基础字段、头像、当前状态、Hero 背景与文字模式、各页背景图、各页文案
  (pages/pageBackdrops),表单写回 site.ts;图片字段带「选择图片…」按钮,自动复制进档案 images/
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
src/preview.ts   dev server 管理(账本制)+ iframe 预览
src/previewView.ts 预览区(模板/档案/启动预览 + 运行中 server)
src/webviews/    四个表单(新建文章 / 站点信息 / 管理分类 / 新增链接)
scripts/test-core.mjs
```

## 二期方向(已记下,未开工)

**文章管理**

- **文章树增强**:现在只有草稿/已发布两组,略显单薄。按分类或标签分组/筛选,快速定位文章
- **已发布文章元数据编辑**:复用新建表单改 frontmatter(标题/标签/分类/封面)
- **草稿 ⇄ 发布切换**:文章树上一键切 draft
- **删除文章**:带确认的删除

**站点配置**

- ~~表单 UI 优化~~(v0.3.0 已完成:卡片分区、分段选择器、图片实时预览、左侧目录)
- ~~分类修改~~(v0.3.0 已完成:管理分类表单双模式);删除分类待做

**三期方向**

- **链接管理**:links.ts 的列表、修改、删除(v1 只做了新增),并做配置体验优化

**明确不做**:重命名 slug、定时发布

## 图片资产约定(v0.2.0 已落地)

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

- 复制不移动源文件;正文图不覆盖;不做大文件提醒和压缩
- 文章页封面双模式(主仓库):`/` 开头走 public junction,否则相对文章文件经 Vite 资产管线解析
- 工作区 `markdown.copyFiles.destination` 已固化为 `${documentDirName}/image/${documentBaseName}`,
  原生粘贴与扩展复制落进同一目录规矩
