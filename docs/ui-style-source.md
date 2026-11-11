# Plotwist 样式来源

参考项目：[plotwist-app/plotwist](https://github.com/plotwist-app/plotwist)。本次复制固定在提交 `5d15dc3e9702e3663d1e01d623430b938f849462`（2026-11-10 获取）。

## 直接复制的部分

- `packages/ui/src/globals.css` 中的完整浅色 / 深色 Zinc HSL 变量，保存到 `apps/web/src/styles/tokens.css`，保留 `--radius: 0.5rem`。
- `packages/ui/components.json` 的 `new-york`、`zinc`、CSS variables 配置；将 RSC 关闭并改为本项目的 Vite 路径与别名。
- `packages/ui/src/components/ui/` 的 Button、Input、Tabs、Checkbox、Select、DropdownMenu、Card、Badge、Skeleton，以及 `lib/utils.ts`；只调整本地导入路径和统一格式。
- `Space Grotesk` 字体；通过 `@fontsource/space-grotesk` 在构建时打包，无需运行时连接 Google Fonts。

## 适配当前项目的部分

原项目使用 Tailwind 3；影栈保留 Tailwind 4，通过 `@theme inline` 将原始 HSL 变量映射到 Tailwind 工具类，使用 `@custom-variant dark` 保持 class 主题切换，并用 `tw-animate-css` 支持 Radix 动画。

布局参考 `layout-wrapper.tsx`、`header.tsx`、`movies/discover/page.tsx` 和 `poster-card.tsx`：桌面圆角横向导航，`max-w-6xl`（1152px）内容区，手机 3 列 / 桌面 6 列海报，16px 列间距，2:3 海报与 8px 海报圆角。原 Tailwind 配置的 `max-w-app` 1080px 也保留为自定义尺寸变量。

现有电影发现、片库、资源搜索、夸克转存、任务、STRM 与 Quark TV 功能继续使用本项目 API。影栈名称、中文文案、业务入口、海报状态和评分保留；未复制 Plotwist 商标、账号体系、付费或社交业务。

## 格式化与检查

`npm run format` 顺序执行 Biome 格式化和 ESLint 自动修复。Biome 使用上游的 2 空格、80 列、单引号、无需分号与 ES5 尾逗号。ESLint 使用 TypeScript 推荐规则、React Hooks 规则以及与 Biome 一致的引号 / 分号修复；`eslint-config-biome` 关闭冲突规则。

`npm run lint` 执行两套检查，`npm run check` 还包含类型检查、独立 `tests/` 下的测试和生产构建。第三方验证码 vendor、构建产物和本地分析记录不参与格式化。

## 许可

复制部分适用 [Plotwist Source Available License](licenses/Plotwist-Source-Available.txt)。该许可允许个人、学术或内部评估用途，限制商业服务使用。许可全文已随复制内容保留。

## 网盘文件浏览器

资源列表参考 [shadcn.io File Explorer Table](https://www.shadcn.io/blocks/tables-file-tree) 的公开交互说明，使用本项目 shadcn Table、Checkbox、Button 实现：逐层目录、面包屑、返回上级、目录优先、名称和大小排序、手动勾选转存。未使用该站付费源码。文件大小按上游字节值显示为 B / KiB / MiB / GiB；未提供的大小显示为“—”，不递归请求所有子文件夹计算大小。

Suenen 原帖为“回复可见”时，页面显示该要求并提供原帖与重试入口；应用不自动发布回复。需要使用与服务器资源站点配置相同的账号按站点要求操作，之后重新读取分享。
