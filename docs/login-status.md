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
