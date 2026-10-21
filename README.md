# 影栈 CineStack

从发现一部电影，到收进自己的片库。

影栈是一个面向个人自托管的电影管理工具，连接 TMDB、资源站点与夸克网盘，提供电影发现、资源搜索、转存整理和观影记录。

## 主要功能

- **发现电影**：浏览热门、搜索片名、按类型和评分筛选，查看简介与演职员信息。
- **管理片库**：标记看过，查看已转存电影，独立保存观影与下载状态。
- **查找资源**：搜索 suenen 站点，解析夸克分享，浏览文件后手动选择转存。
- **整理收藏**：规范影片命名，生成 NFO，上传海报与背景图，查看任务进度和失败原因。

“下载”指转存到自己的夸克网盘，不会将电影视频下载到服务器本地。

## 快速开始

需要 Node.js 22.12+，推荐 Node.js 24。

```sh
npm install
cp .env.example .env  # 已有配置时跳过
```

填写 `.env` 后执行：

```sh
npm run db:generate
npm run db:migrate
npm run integrations:check
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，使用 `ADMIN_PASSWORD` 登录。后端默认监听 `127.0.0.1:3001`。

## 配置

| 变量 | 用途 |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API Key，也可使用 `TMDB_READ_ACCESS_TOKEN` |
| `SUENEN_USERNAME` / `SUENEN_PASSWORD` | 资源站点账号 |
| `QUARK_COOKIE` | 夸克登录 Cookie |
| `QUARK_ROOT_FOLDER_ID` | 电影目录所在的父目录 ID |
| `QUARK_LIBRARY_FOLDER_NAME` | 独立电影目录名，默认 `MovieLibrary` |
| `ADMIN_PASSWORD` | 首次初始化的管理密码，至少 12 字符 |

`integrations:check` 会校验连接、复用或创建电影目录，并写入 `QUARK_LIBRARY_FOLDER_ID`。凭据保存在被 Git 忽略的 `.env`；数据库、会话和元数据保存在 `data/`。请勿分享这些文件。

管理密码初始化后以摘要保存在 `data/admin.json`；修改 `.env` 不会自动重置已有密码。当前默认面向本机访问，公网部署需要另行配置 HTTPS 与访问策略。

## 项目结构

```text
apps/web/                  React · Vite · Tailwind CSS
apps/api/                  NestJS · Prisma · SQLite
packages/crawler-engine/   纯 Node.js 登录、资源解析、夸克适配
packages/contracts/        共用类型与校验规则
docs/                      实施方案与引擎说明
```

常用命令：`npm test`（Vitest）、`npm run typecheck`、`npm run build`、`npm run login:node`（独立站点登录）。爬虫运行无需浏览器。

## 当前边界

已验证电影查询、站点登录、资源解析、分享浏览和 NFO 上传；完整电影转存流程仍待实际选片验收。多个视频或同格式字幕会保留原名，避免错误整理；极验仅支持当前已适配版本的滑块挑战。

夸克能力适配自 [CloudSaver](https://github.com/jiangrui1994/CloudSaver)，许可见 [CloudSaver-MIT.txt](docs/licenses/CloudSaver-MIT.txt)。本项目使用 TMDB API，但未经 TMDB 认可或认证。请仅处理有权访问和保存的资源。
