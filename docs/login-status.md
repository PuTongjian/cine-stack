# 登录检查：2026-11-06

范围：资源站点纯 Node.js 登录及爬虫会话复用。

## 复现与原因

`npm run login:node` 首次返回 `Login page HTTP status: 301`。旧地址 `https://suenen.com/user-login.htm` 现跳转至 `https://www.suenen.com/user-login.htm`，代码使用手动跳转策略并固定旧域名，导致进入验证码前退出。

统一域名后再次运行，返回 `Unsupported Geetest SDK version or challenge mode.`。真实 `/load` 返回 SDK `v1.9.9-53b07e`，而程序仅支持 `v1.9.8-0d53fd`。当前仍为 slide、pt=1、guard=false、lang_reverse=false，GCT 路径未变；新 SDK 的标记、lot 派生字段和环境字段有变化。

## 修复

- 登录、请求与帖子链接共用 `SUENEN_ORIGIN=https://www.suenen.com`。
- 恢复 Cookie 时保持其域名作用范围，接受旧域和 www 域的本站 Cookie，忽略其他域。
- 为两个已核对的 SDK 版本分别处理标记、lot 字段；新增当前版本的触摸能力、时区和环境向量字段。
- 保留未知 SDK、GCT 与其他挑战模式的检查，不盲目接受新版本。

## 实测

`npm run login:node`：2026-11-06 15:16（Asia/Shanghai），极验 success，登录 code="0"，个人中心 HTTP 200、UID 19209，保存新会话。

随后通过 `SuenenClient.ensureSession()` 和 `getHtml()` 复用保存的会话，搜索“同甘共苦”取得 7 个候选帖子，结果链接使用 www 域名；未重新运行验证码。

新增回归测试涵盖规范域名登录全过程、Cookie 保存/复用、当前 SDK 参数及未知 SDK 拒绝。离线测试不能替代未来真实风控状态下的登录验证。

此次未启动前端或后端服务，未检查应用管理密码登录或夸克 Cookie 状态；未推送远端。

## Unraid 故障排查：2026-11-10

症状：资源搜索任务停在 `searching`，显示“上游服务暂时不可用，请稍后重试。”。

远端 `SuenenClient.ensureSession()` 可稳定复现：`Unsupported Geetest SDK version or challenge mode: /v4/static/v1.9.9-11a9a5`。站点 `/my.htm` 匿名请求正常返回 302 登录跳转，账号密码已配置；实际失败点是 SDK 版本检查，尚未发送登录表单。错误不以 `SUENEN_` 开头，因此任务错误处理将它隐藏为通用提示。

另一个独立问题是部署布局发生变化：旧容器使用项目根目录 `data`，新容器却挂载 `deploy/data`，原授权配置没有被读取。已备份两套数据，合并两边不同的片库和任务记录，保留当前管理登录与 STRM 设置、原 Quark TV 授权，将部署脚本改为同步独立 `source/` 目录并固定 `cine-stack` Compose 项目。脚本保持 Git 忽略。

恢复方式：复用经过 `/my.htm` HTTP 200 登录态确认的既有 Suenen 会话，并写入持久化数据目录。远端真实搜索“奥德赛”返回 1 个夸克资源。验证码 SDK 的明确错误提示已加入回归测试。

边界：`v1.9.9-11a9a5` 的自动登录参数尚未适配、未放开版本检查。现有会话失效后，仍需要更新登录适配或恢复有效会话；本次不能据搜索恢复宣称新 SDK 自动登录已修复。

部署后验收：通过实际 API 重试原失败的“奥德赛”任务，最终 `status=completed`、`stage=awaiting_selection`、`error=null`、`count=1`；Quark TV `authorized=true`。容器挂载确认 `/cine-stack/data -> /app/data`、`/cine-stack/strm -> /app/strm`，外部 `/api/health` 返回 `{"status":"ok"}`。49 个离线测试、类型检查和 Docker 构建通过。

## 最新版本兼容策略调整：2026-11-10

取消 SDK `static_path` 与 GCT 路径的版本白名单拦截。每次新登录仍实时请求 `/load`，使用最新挑战参数，沿用现有图片定位、PoW、GCT 和加密登录逻辑；已知旧版保留原字段，新版本尝试当前字段。完整浏览器 SDK 不会被动态下载执行。是否兼容以当次 `/verify` 返回和网站登录、个人中心检查为准。

保留当前不支持的挑战类型/协议/模式检查，以及本地 GCT 文件摘要检查。实际校验失败返回带 `SUENEN_` 前缀和版本信息的明确提示，并说明可能是参数不兼容或风控，避免仅凭一次失败断言版本不兼容。未知新版及校验拒绝分支已加入测试。

部署后在 Unraid 容器内新建独立临时会话，不读取或覆盖原 Cookie：`static_path=/v4/static/v1.9.9-11a9a5`，极验 `status=success,result=success`，Suenen `code=0`，个人中心 HTTP 200。临时会话测试后删除。52 个测试、类型检查、Docker 构建及部署健康检查通过。
