# 电影管理系统实施计划

日期：2026-10-20。状态：首版业务实现已迁移，实际交付与未完成项见根目录 README；以下保留完整目标方案。

## 1. 首版范围

- 单用户自托管，中文界面，电影类型优先，不包含电视剧季集管理。
- 网盘优先夸克；资源来源优先 suenen.com。
- 发现电影、搜索、详情、标记看过、查看已下载、资源选择、转存、规范命名、NFO 获取。
- 点击电影进入详情；点击“查找资源”启动搜索；展示候选资源，由用户选择后执行转存。
- 产品中的“下载”指转存到自己的夸克网盘，不表示视频已下载到本地。
- 电影状态与观影状态独立：电影可以看过但未下载，也可以已下载但未看过。
- 继续使用已有纯 Node.js 登录实现；不重新引入浏览器登录。

## 2. 已有能力与待验证项

已有纯 Node.js 实测能力：suenen 登录、当前版本极验滑块验证、Cookie 保存、缺口定位、6 项本地测试。

尚未实现：站内搜索、搜索分页、帖子正文解析、分享链接解析、夸克登录状态校验、分享内容浏览、转存、重命名、文件上传。不能把 suenen 登录成功视为这些功能已具备。

夸克的转存、异步任务查询、移动、重命名与小文件上传必须先做接口探测并分别验证。NFO 上传不可用时，任务记录为“已转存，元数据待处理”，并提供 NFO 下载；不能直接报告全部完成。

## 3. Monorepo 与技术选择

使用 npm workspaces，保留现有 package-lock 工作流，首版不引入 Nx/Turborepo。

```text
apps/
  web/                      React + Vite + TypeScript + Tailwind CSS
    src/features/
      discover/             热门、发现筛选、关键词搜索
      movies/               电影详情、资源候选
      library/              我的电影、看过、已下载
      tasks/                任务详情与阶段进度
      settings/             TMDB、站点、夸克连接状态
  api/                      NestJS + TypeScript
    src/modules/
      auth/                 单用户管理会话
      movies/               TMDB 代理、缓存、电影详情
      library/              本地片库、观影状态
      metadata/             命名规则、NFO、海报
      resources/            对接爬虫、候选资源持久化
      transfers/            任务调度、恢复、进度
      integrations/         站点与网盘连接状态
      database/             Prisma + SQLite
packages/
  crawler-engine/           纯 Node.js ESM，初期保留已有 JS
    src/suenen/             登录、会话、搜索、帖子解析
    src/geetest/            参数计算、图片识别、vendor/gct.js
    src/quark/              分享、文件、转存、重命名、上传
    src/cli/                独立登录与诊断入口
  contracts/                API/引擎共用的类型、Zod schema、错误码
docs/
  implementation-plan.md
  reverse-records/           历史证据，迁移时修正路径引用
data/                       SQLite、私有会话、元数据缓存，Git 忽略
```

React Router 管理页面路由；TanStack Query 管理服务端状态与缓存；lucide-react 提供工具图标。前端不直接访问 TMDB、suenen 或夸克。

NestJS 负责 API、任务协调与数据所有权。crawler-engine 是 API 调用的普通包，保留独立 CLI，不负责片库数据库，也不依赖 NestJS。首版任务执行器在 API 进程内运行，SQLite 持久化任务；有明确扩容需求后再拆独立 worker。

SQLite 使用 Prisma migrations。有限并发首版不依赖 Redis；同一个夸克账号的文件写操作串行执行。数据库初始化必须显式迁移，不能在启动时删除重建。

GCT 原始 JS 按原字节复制为运行资源，验证摘要。构建工具不得重写其函数文本，否则其自哈希结果可能变化。

## 4. 前端页面与交互

采用电影管理工作台：固定导航、紧凑工具栏、海报网格、详情页、任务列表。使用 TMDB 真实海报；缺图有固定比例占位。默认展示电影发现，不做营销首页。

| 路由 | 内容与操作 |
|---|---|
| `/discover` | 本周/今日热门；切换发现筛选或关键词搜索；分页 |
| `/movies/:tmdbId` | 海报、简介、年份、评分、演职员、看过状态、NFO 下载、查找资源 |
| `/movies/:tmdbId/resources` | 资源来源、标题、年份匹配、清晰度、大小、提取码状态、可用性、分享内容选择 |
| `/library` | 全部、看过、已下载；排序、搜索、变更观影状态 |
| `/tasks` | 任务列表、当前阶段、重试、取消、阶段结果 |
| `/tasks/:id` | 转存文件、重命名映射、元数据状态、失败原因与可重试阶段 |
| `/settings` | TMDB、suenen、夸克连接状态、目标文件夹、命名预览 |

看过状态使用可切换控件；下载、NFO、刷新等使用熟悉的图标与 tooltip。详情展示资源前不写入网盘；选择影片文件或包含所需电影的目录后再确认转存。

所有列表实现加载、空结果、网络错误、分页和重试。详情区分电影不存在、配置缺失、上游失败；任务区分可重试与需要重新授权。移动端保持可用，避免工具栏和片名溢出。

## 5. TMDB 与后端接口

TMDB 凭据仅在服务端，从环境变量读取。默认 `zh-CN`，缺失名称/简介时回退原文。缓存热门列表、电影详情、类型与图片配置；遵守 429/Retry-After，有限退避，不把失败当成空片单。

“近期热门”默认 TMDB 本周 trending。它不等同“最近上映”；另提供上映日期范围筛选，不在接口层混用两种含义。

TMDB search/movie 不支持 discover/movie 的全部筛选与排序。首版在界面上分为“关键词搜索”和“分类筛选”，分别暴露真实支持的字段，禁止仅过滤当前页冒充全量筛选。

| 本地 API | 语义 / 上游 |
|---|---|
| `GET /api/movies/trending?window=day|week&page=` | `/trending/movie/{time_window}` |
| `GET /api/movies/search?q=&year=&page=` | `/search/movie`，语言为返回文案语言 |
| `GET /api/movies/discover?...` | `/discover/movie`；类型、上映范围、原始语言、评分下限、评分人数下限、排序 |
| `GET /api/movies/genres` | 类型字典 |
| `GET /api/movies/:id` | 详情，按需附加 credits、external_ids、release_dates、alternative_titles |
| `GET /api/movies/:id/nfo` | XML 附件；调用 metadata 模块生成，不存在所谓 TMDB NFO 接口 |
| `GET /api/movies/:id/artwork` | 海报/背景候选及尺寸，不暴露 TMDB token |
| `GET /api/library?watched=&downloaded=&q=&page=` | 本地片库查询 |
| `PUT /api/library/:tmdbId` | 添加影片，幂等 |
| `PATCH /api/library/:tmdbId` | watchedAt、个人评分、备注 |
| `POST /api/movies/:id/resource-searches` | 新建后台资源搜索，返回 202 + taskId |
| `GET /api/resource-searches/:id/results` | 候选资源、匹配依据和解析结果 |
| `GET /api/resources/:id/files` | 只读浏览夸克分享内容 |
| `POST /api/transfers` | movieId、resourceId、selectedFileIds、目标目录、幂等键 |
| `GET /api/tasks` / `GET /api/tasks/:id` | 任务列表与详情 |
| `GET /api/tasks/:id/events` | SSE 进度；断线后能从详情恢复，必要时轮询兜底 |
| `POST /api/tasks/:id/retry` | 从失败阶段恢复 |
| `POST /api/tasks/:id/cancel` | 协作式取消，报告已经产生的网盘副作用 |
| `GET /api/integrations` | 配置与连接状态，凭据不回传 |
| `POST /api/integrations/:id/check` | 校验配置与会话，站点登录按需刷新 |

API 使用统一分页和结构化错误码；配置缺失、需要授权、限流、会话过期、无匹配、分享失效、转存失败、冲突分别处理。Zod schema 复用在 API 边界与前端调用处，Nest 通过验证 pipe 使用。

## 6. 爬虫引擎契约

登录模块从“导入即运行脚本”改为有显式参数和返回值的函数，CLI 独立包装。API 不通过 shell 拼接凭据或解析控制台输出。凭据、Cookie、验证码票据不进入任务事件或 API 响应。

```text
SuenenClient.ensureSession()
SuenenClient.search({ titles, year, page, signal })
SuenenClient.getPostResources({ postId, signal })

QuarkClient.checkSession()
QuarkClient.inspectShare({ shareId, extractionCode, signal })
QuarkClient.transfer({ share, fileIds, targetFolderId, signal })
QuarkClient.getTransferStatus({ remoteTaskId, signal })
QuarkClient.listFiles({ folderId, signal })
QuarkClient.rename({ fileId, newName, signal })
QuarkClient.upload({ folderId, filename, content, signal })
```

站点搜索使用中文名、原名、别名及年份的有界查询，匹配结果保留标题、年份和来源依据。不仅凭相似片名就确认同一电影；合集与重名作品需要用户选文件。Cheerio 解析 HTML，分享 URL 用 URL API 和域名白名单解析，提取码作为字段保存。

论坛内容仅作为数据处理；被回复/积分/付费锁定的链接标注为不可直接获取，不自动发帖、回复、购买或扣积分。超时、限流和 SDK 版本变化分别报告。

## 7. 数据模型与状态

| 实体 | 核心内容 |
|---|---|
| Movie | 唯一 tmdbId，标题、年份、元数据快照、更新时间 |
| LibraryEntry | movieId 唯一，watchedAt、个人评分、备注 |
| ResourceSearch | movieId、查询组合、状态、结果时间 |
| ResourceCandidate | 搜索任务、站点帖子、分享 ID、提取码、匹配依据、清晰度、大小 |
| TransferTask | movieId、候选资源、目标目录、阶段、幂等键、远端任务 ID、错误 |
| TaskStep / TaskEvent | 阶段检查点、时间、脱敏事件、重试次数 |
| StoredAsset | 远端文件 ID、原始名、标准名、大小、扩展名、转存与重命名状态 |
| MetadataArtifact | NFO/海报、文件摘要、生成状态、本地位置、网盘上传结果 |
| Integration | 提供方、连接状态、目标目录配置、凭据引用；不存日志明文凭据 |

电影可以存在多个版本/文件。下载状态从转存记录推导，不与“看过”共用一个枚举。

搜索：queued → running → succeeded / empty / failed / cancelled。

转存：queued → validating → transferring → renaming → generating_metadata → uploading_metadata → completed。

失败额外保留 failedStage、retryable、remoteTaskId、已经完成的文件映射。转存完成即为影片可用；重命名/NFO 失败显示“已转存，整理未完成”。全阶段完成才显示任务 completed。

幂等范围：同电影、分享、选中文件集合、目标目录。用户显式要求新版本时可以建立新任务。进程重启恢复前先查询已保存的远端任务和文件 ID；无法判定副作用时标记待核对，不能盲目再次转存。

取消不删除已转存文件，不承诺停止已提交的远端操作。只暂停本地后续步骤，并展示实际状态。

## 8. 命名与 NFO

默认目录：`电影名 (年份) [tmdbid-12345]/`。

默认影片：`电影名 (年份).ext`。多版本增加明确版本标识，多分片使用 `-part01` 等稳定后缀；不能把同文件夹里的多部电影重命名为一部。字幕保留可识别的语言/强制字幕标记，并匹配影片文件名。

规范化处理 Unicode、平台非法字符、尾部空格和点、长度上限与名称冲突。冲突不覆盖，先产生预览映射，保存原文件 ID 与名称供失败恢复。

NFO 默认采用 Kodi 电影 XML：title、originaltitle、year、premiered、plot、runtime、genres、studio、导演、演员与角色、TMDB/IMDb uniqueid、海报与评分来源。使用 XML 序列化库，转义文本；缺失字段省略，不能填造数据。

单影片目录生成 `movie.nfo`，同目录多版本时采用与视频同 basename 的 NFO。转存后将 NFO、poster.jpg、fanart.jpg 上传到目标目录；下载接口允许单独获取 NFO。展示 TMDB 归属说明，遵循其图片与数据使用要求。

默认 NFO 与视频同在夸克目标目录，服务端保留小型元数据副本；首版不把视频拉到服务器本地。

## 9. 配置与运行

- `TMDB_READ_ACCESS_TOKEN`：服务端读取，缺失时接口明确返回配置缺失。
- `SUENEN_USERNAME` / `SUENEN_PASSWORD`：仅后端/引擎进程；会话目录外部可配置。
- `QUARK_COOKIE`：首版使用用户已有登录 Cookie，不实现网盘扫码登录；通过本地环境配置，不在聊天或 URL 传递。
- `QUARK_TARGET_FOLDER_ID`：转存根目录；设置页提供只读状态和命名预览。
- `DATA_DIR` / `DATABASE_URL`：持久化目录与 SQLite。
- `ADMIN_PASSWORD` / `SESSION_SECRET`：单用户应用登录，HttpOnly 管理会话；限制写接口和配置状态接口。

开发时 Vite `/api` 代理到 Nest；生产同源部署，初始绑定本地地址。提供 Docker Compose（API、静态前端、持久化卷），不增加数据库服务或 Redis 服务。

服务端屏蔽日志中的 Authorization、Cookie、密码和验证票据。只允许从已解析的合法分享 ID 发起网盘操作，避免任意 URL 抓取；限制搜索并发、请求体和任务频率。

## 10. Vitest 测试策略

- 迁移已有 node:test 用例到 Vitest，先保持 6 项行为不变，再扩展。
- 引擎：HTML 搜索/帖子样本、分页、分享链接与提取码、Cookie 失效、验证码版本变化、资源去重；本地 HTTP 模拟网盘请求。
- 后端：TMDB 请求参数、缓存失效、429/错误响应、缺失配置、XML 可解析、命名冲突、幂等任务、重启恢复、阶段重试与取消。Nest 测试模块配合 Supertest，由 Vitest 执行。
- 前端：Vitest + Testing Library + jsdom，MSW 模拟 API；验证搜索/筛选切换、分页、看过状态、资源选择、失败任务和 NFO 下载。
- 真实联网测试独立 opt-in，不加入默认 `npm test`；CI 不依赖凭据，不触发真实转存。
- 页面实际浏览验证另做桌面/移动端截图和交互检查；浏览器只用于前端 QA，不进入爬虫登录运行链。

根命令目标：`npm run dev`、`npm run build`、`npm test`、`npm run typecheck`、`npm run login:node`。原登录命令通过 workspace 转发保留。

## 11. 分阶段交付与验收

### M1：Monorepo 与引擎迁移

建立 workspaces、TypeScript/Vitest 配置、Nest/React 骨架；移动现有引擎与 GCT，抽离 CLI，配置数据目录。所有 import 与运行资源路径以模块位置解析，避免依赖当前工作目录。

验收：根目录与 workspace 执行命令均可工作，6 项原有测试迁移通过，构建/类型检查通过；有凭据时可显式运行真实 Node.js 登录冒烟。

### M2：TMDB、NFO 与发现页面

接入热门、搜索、发现、详情、类型、缓存、NFO 和规范命名模块。完成发现页、搜索/筛选和详情页，使用真实 TMDB 海报。

验收：token 缺失有明确状态；真实 token 下热门/搜索/筛选分页可用；XML 正确解析，TMDB/IMDb ID 对应影片；前端无全量搜索筛选误导。

### M3：本地电影管理

持久化 Movie/LibraryEntry，提供看过标记、个人评分、片库筛选和本地元数据记录，加入单用户管理会话。

验收：刷新/重启不丢状态；看过与下载独立；未认证访问受保护 API 被拒绝。

### M4：站内资源搜索

实现会话复用、站点搜索、分页、帖子解析、夸克候选链接和匹配解释，完成资源选择页面。

验收：真实目标电影能查找并展示可用候选；无结果/同名/合集/锁定链接有明确状态，不自动回复或转存。

### M5：夸克转存与任务流程

先独立验证网盘接口，再接入任务编排；转存、远端轮询、整理命名、NFO/图片上传与错误恢复逐步接通。

验收：用户选定资源后仅执行一次转存；视频、NFO 和图像位置与名称可核对；重试元数据不重复转存；模拟中断可恢复；真实转存需要配置自己的网盘会话与目标目录。

### M6：完整工作流与部署

任务 SSE、失败恢复 UI、设置状态、Docker、README、移动适配和回归测试。

验收：从热门电影 → 详情 → 查资源 → 选择 → 转存 → 命名/NFO → 已下载片库完整闭环；无结果和各阶段失败可恢复；构建、Vitest、类型检查全部通过。

每阶段交付可运行版本及验证结果，不把模拟网盘成功当作真实转存成功。实施优先 M1 → M2 → M3 → M4 → M5 → M6。

## 12. 实施前提与来源

已确认：夸克网盘、单用户自托管、人工选择候选资源。

待配置：TMDB token、夸克 Cookie、目标文件夹。凭据缺失不阻塞骨架、契约、模拟测试和前端开发，但会阻塞相应真实集成验收。

默认采用：NFO 上传夸克影片目录并保留服务端副本、中文片名优先、Kodi 电影 NFO、多版本分别记录。后续可调整，不需要提前停下等待。

核对来源：

- TMDB trending：https://developer.themoviedb.org/reference/trending-movies
- TMDB discover：https://developer.themoviedb.org/reference/discover-movie
- TMDB search：https://developer.themoviedb.org/reference/search-movie
- 当前项目 README、node-login.mjs、geetest-node.mjs 和 suenen 搜索页 HTML。
- Kodi NFO 官方页面本次访问返回 403；NFO 具体兼容字段将在 M2 对照目标播放器样本和可访问规范继续验证。
