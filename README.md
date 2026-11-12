# 影栈 CineStack

从发现一部电影，到收进自己的片库。

当前应用版本：**0.2.0**（页面底部与 `/api/health` 显示，版本来源为根目录 `package.json`）。

影栈是一个面向个人自托管的电影管理工具，连接 TMDB、资源站点与夸克网盘，提供电影发现、资源搜索、转存整理和观影记录。

## 主要功能

- **发现电影**：浏览热门、搜索片名、按类型和评分筛选，查看简介与演职员信息。
- **管理片库**：标记看过，分别查看网盘视频与本地 STRM 状态；文件状态以实际目录为准，观影记录独立保存。
- **查找资源**：列出 suenen 搜索的前十条标题，点击后解析夸克分享，浏览文件并手动选择转存；也可打开网盘分享页面。
- **整理收藏**：规范影片命名，生成 NFO，上传海报与背景图，查看任务进度和失败原因。
- **连接 Jellyfin**：选择云盘源目录和本地输出目录，生成 STRM，自动同步转存资源，也可同步已有文件。

“下载”指转存到自己的夸克网盘，不会将电影视频下载到服务器本地。

已有电影可再次选择资源转存，包括改用不同视频格式。新资源先保存在临时目录，确认成功移入电影目录后才将旧资源送入夸克回收站；整理失败可在任务页重试。转存结果尚未确认的任务会要求先核对网盘，避免重复发起不确定的写入。

片库和电影详情会读取网盘目录中的实际视频，以及输出目录中的实际 STRM 文件；页面打开期间每 15 秒刷新一次，也可手动刷新。删除网盘视频不会删除观影记录，也不会把本地仍存在的 STRM 误标为不存在；两项状态分别显示。配置与文件目录持久化后，重启会重新读取这些状态。

带有 `[tmdbid-电影ID]` 的电影目录会被自动发现，即使数据库没有对应记录，也会补录电影信息并显示真实文件状态，无需先收藏或重新下载。TMDB 暂时不可用时仍显示该电影的 ID 和文件状态，后续刷新会重试获取电影信息；只有本地 STRM、没有网盘视频的电影会显示在全部片库中，但不会标记为已下载。

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

## Docker Compose 部署

需要 Docker Engine 和 Docker Compose v2。前后端在镜像中构建，无需在宿主机安装 Node.js。

```sh
cd deploy
cp .env.example .env  # 已有配置时跳过
# 填写上游凭据、网盘目录 ID 和至少 12 字符的 ADMIN_PASSWORD
docker compose build
docker compose up -d
```

打开 [http://localhost:8080](http://localhost:8080)。容器启动时自动应用数据库迁移；API 通过健康检查后启动前端。部署配置集中在 `deploy/`，包括 `Dockerfile`、`compose.yml`、Nginx 配置和环境变量模板。数据库、登录会话与 STRM 签名配置持久化到 `deploy/data/`，STRM 输出默认挂载到宿主机 `deploy/strm/`。Compose 命令均在 `deploy/` 下执行，部署凭据填写到 `deploy/.env`。

新账号尚未设置独立电影目录时，可用容器执行连接检查：

```sh
docker compose run --rm api node scripts/check-integrations.mjs
```

检查会将 `QUARK_LIBRARY_FOLDER_ID` 写入容器内的 `.env`，该临时文件不保留。将命令输出的目录 `id` 填入宿主机 `deploy/.env` 的 `QUARK_LIBRARY_FOLDER_ID`，再执行 `docker compose up -d --force-recreate api`。

局域网访问时，将 `deploy/.env` 的 `APP_BIND_ADDRESS` 改为 `0.0.0.0`，`APP_ORIGIN` 改为实际访问地址，例如 `http://192.168.1.10:8080`。修改 `WEB_PORT` 时也要更新 `APP_ORIGIN`。公网访问需配置 HTTPS，并将 `APP_ORIGIN` 设置为实际 HTTPS 地址。

更新代码后执行 `docker compose up -d --build`；查看日志使用 `docker compose logs -f`，停止服务使用 `docker compose down`。不要删除 `data/`，否则管理密码、数据库和 STRM 签名将被重新初始化。

### Unraid 部署

项目目录：`/mnt/user/appdata/compose_projects/cine-stack`。该目录保存 `compose.yml`、`compose.override.yml`、`.env`，`source/` 保存构建源码，`data/` 保存应用数据，`strm/` 用于本地 STRM 输出。远端 `.env` 设置 `BUILD_CONTEXT=./source`。Unraid 无法直连 Docker Hub 时，通过 `NODE_IMAGE` 和 `NGINX_IMAGE` 为当前项目指定可访问的镜像源，不修改全局 Docker 设置。`OUTBOUND_PROXY` 可为 TMDB 配置 HTTP 代理；已使用现有局域网代理 `http://192.168.1.254:7890`，夸克和资源站点保持直连。

```sh
ssh root@192.168.1.150
cd /mnt/user/appdata/compose_projects/cine-stack
docker compose up -d --build
```

本地更新完成后运行 `bash ./deploy-unraid.sh`，脚本同步源码、构建镜像，并等待服务健康检查通过。

访问地址为 [http://192.168.1.150:18080](http://192.168.1.150:18080)。已按同级项目配置 Compose Manager 标签及开机自动启动。管理密码复用本地 `.env` 的 `ADMIN_PASSWORD`；远端凭据保存在权限为 `600` 的项目 `.env` 中。

STRM 宿主机目录为 `/mnt/user/appdata/compose_projects/cine-stack/strm`，容器内目录为 `/app/strm`。Jellyfin 需要将此宿主机目录只读挂载为媒体目录，再添加电影库并扫描。

## STRM 与 Jellyfin

1. 在「连接设置 → Jellyfin · STRM 映射」开启功能，浏览并选择云盘源目录，默认是影栈的独立电影目录。
2. 填写本地输出目录。Docker 默认使用 `/app/strm`；宿主机位置由 `deploy/.env` 的 `STRM_HOST_DIR` 控制，默认 `deploy/strm/`。其他容器内路径需要自行添加对应的持久化挂载。
3. 填写 **Jellyfin 可访问的影栈地址**，例如 `http://192.168.1.10:8080`。Jellyfin 容器中的 `localhost` 指向它自己，请使用服务器 IP、域名或可访问的容器地址。
4. 保存配置，点击「立即同步已有资源」。之后每次影栈转存完成都会同步所选目录，即使转存后的元数据上传失败，仍会尝试生成 STRM。
5. 把宿主机 STRM 目录只读挂载给 Jellyfin，例如 `/srv/cine-stack/strm:/media/cine-stack:ro`，在 Jellyfin 添加「电影」媒体库，目录选择 `/media/cine-stack`，然后扫描媒体库。

映射会递归保留云盘目录结构。通常生成 `影片名.strm`；同目录存在同名、不同格式的视频时生成 `影片名.mkv.strm`、`影片名.mp4.strm`，避免覆盖。已有云盘 NFO、图片和字幕会同步到本地，单文件限制 4MB；本地已有的这些文件会保留。

STRM 中保存的是带签名的固定播放地址。先在「连接设置 → Quark TV · 播放授权」使用与转存相同的夸克账号扫码。播放时获取 Quark TV 原画地址：小范围读取与 HEAD 返回 302；网页常用的无结束位置或大范围读取由影栈按 8MiB 分段转发，避免大文件起播缓慢，此时视频流量会经过影栈服务器。转存与目录同步继续使用夸克 Cookie。请将 STRM 链接视为私有播放凭证。

TV 授权令牌保存在 `data/quark-tv.json`，重启后自动复用并按需刷新。授权与刷新使用和 OpenList 相同的 ExtScreen 令牌交换服务，本实现通过 HTTPS 访问该服务。详细说明见 [Quark TV 配置与数据流](docs/quark-tv.md)。

同步会新增或更新 STRM，并在完整读取云盘目录成功后清理已删除、改名或被替换的视频对应的旧映射；云盘目录已不存在时，也会清理该目录中的旧元数据和空目录。仍存在的目录会保留本地元数据及字幕。输出目录应专用于本应用的 STRM 映射，请勿混放其他媒体库；更换源目录后的下次同步也会清理旧映射。删除本地 STRM 后状态会随刷新更新，再次同步会为云盘中仍存在的视频重新生成映射。更改播放地址后请重新同步；关闭映射会停止签名链接播放，但已有文件仍显示为已映射。映射最多遍历 32 层、10,000 个目录。

## 配置

| 变量 | 用途 |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API Key，也可使用 `TMDB_READ_ACCESS_TOKEN` |
| `SUENEN_USERNAME` / `SUENEN_PASSWORD` | 资源站点账号 |
| `QUARK_COOKIE` | 夸克登录 Cookie |
| `QUARK_ROOT_FOLDER_ID` | 电影目录所在的父目录 ID |
| `QUARK_LIBRARY_FOLDER_NAME` | 独立电影目录名，默认 `MovieLibrary` |
| `ADMIN_PASSWORD` | 首次初始化的管理密码，至少 12 字符 |
| `APP_ORIGIN` | 允许页面写入请求的部署地址 |
| `APP_BIND_ADDRESS` / `WEB_PORT` | Compose 前端监听地址和端口，默认 `127.0.0.1:8080` |
| `OUTBOUND_PROXY` / `OUTBOUND_NO_PROXY` | 镜像构建及容器出站 HTTP 代理与直连例外列表，默认不使用代理 |
| `STRM_HOST_DIR` | Compose 中与 Jellyfin 共享的宿主机目录，默认 `./strm` |

`integrations:check` 会校验连接、复用或创建电影目录，并写入 `QUARK_LIBRARY_FOLDER_ID`。凭据保存在被 Git 忽略的 `.env`；数据库、会话和元数据保存在 `data/`。请勿分享这些文件。

管理密码初始化后以摘要保存在 `data/admin.json`；修改 `.env` 不会自动重置已有密码。STRM 映射配置和签名密钥保存在 `data/strm.json`。当前默认面向本机访问，公网部署需要另行配置 HTTPS 与访问策略。

## 项目结构

```text
apps/web/src/
  app/                     应用入口、路由与布局
  components/ui/           Plotwist 的 shadcn 基础组件
  components/layout/       顶部导航与主题切换
  features/                discover、movies、library、resources、tasks、settings、auth
  domain/                  电影图片地址、任务阶段等业务规则
  infrastructure/http/     HTTP 请求
  styles/                  主题变量、布局、电影目录、业务页面样式
apps/api/src/
  app/                     模块装配与服务初始化
  modules/                 movies、library、resources、tasks、integrations、strm
  infrastructure/          配置、数据库、认证、类型声明
packages/crawler-engine/   geetest、quark、suenen、cli 适配模块
packages/contracts/src/    movies、library、tasks、integrations 共用契约
tests/
  web/                     按页面功能分组的 React 交互测试
  api/                     按 API 业务模块分组的测试
  crawler-engine/          按引擎适配模块分组的测试
  helpers/                 浏览器测试环境支持
deploy/                    Docker Compose、镜像构建与 Unraid 部署配置
docs/                      实施方案与引擎说明
```

前端采用 shadcn `new-york` + Zinc 主题、Space Grotesk 字体，支持深浅色切换。复制来源、适配说明与上游许可见 [样式来源](docs/ui-style-source.md)。

常用命令：`npm run format`（Biome 格式化 + ESLint 修复）、`npm run lint`（两套静态检查）、`npm test`（Vitest）、`npm run test:node`（引擎测试）、`npm run typecheck`、`npm run build`、`npm run check`（完整检查）、`npm run login:node`（独立站点登录）。测试仅放在根目录 `tests/`，不与源码混放。爬虫运行无需浏览器。

## 当前边界

已验证电影查询、站点登录、资源解析、分享浏览和 NFO 上传；完整电影转存流程仍待实际选片验收。多个视频或同格式字幕会保留原名，避免错误整理；极验仅支持当前已适配版本的滑块挑战。

2026-11-06 已修复站点切换至 `www.suenen.com` 和极验 SDK 升级导致的登录失效，真实登录与保存会话的搜索复用均验证通过。当前支持 `v1.9.8-0d53fd`、`v1.9.9-53b07e` 的滑块分支，未知版本仍会停止并提示重新适配。

夸克能力适配自 [CloudSaver](https://github.com/jiangrui1994/CloudSaver)，许可见 [CloudSaver-MIT.txt](docs/licenses/CloudSaver-MIT.txt)。本项目使用 TMDB API，但未经 TMDB 认可或认证。请仅处理有权访问和保存的资源。
