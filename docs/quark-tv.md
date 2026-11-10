# Quark TV 授权与 302 播放

视频播放使用 Quark TV，网盘转存、目录读取和小型元数据同步继续使用夸克 Cookie。现有 STRM 的签名地址保持不变，每次播放获取 Quark TV 原画下载地址。小范围读取与 HEAD 返回 HTTP 302；网页无结束位置或大范围读取由影栈按 8MiB 分段转发。不需要在 Jellyfin 填写夸克 Cookie。

## 授权步骤

1. 在影栈「连接设置」打开「Quark TV · 播放授权」。
2. 点击「扫码授权 Quark TV」，使用夸克手机 App 中与转存相同的账号扫码并确认。
3. 页面每 3 秒检查一次结果；显示「已授权」后即可在 Jellyfin 播放已有 STRM。二维码过期时重新获取。
4. 授权状态和刷新令牌保存在持久化数据目录的 `quark-tv.json`，权限为 `600`。不要分享或提交该文件。重启后自动复用授权，播放时刷新过期的访问令牌。
5. 「解除授权」会删除本机保存的访问与刷新令牌；如需在账号侧撤销设备授权，请同时在夸克 App 管理已登录设备。

扫码授权接口仅对影栈管理员开放，二维码查询令牌和 OAuth 令牌不会返回给浏览器。二维码由后端取得，浏览器不会接收刷新令牌。

## 数据流与依赖

播放流程：Jellyfin 读取 STRM → 影栈验证播放签名 → Quark TV 获取原画地址 → 小范围请求返回 302，无结束位置/超过 8MiB 的请求按固定范围读取云盘后连续返回。影栈会保持客户端请求对应的 Content-Range 与总 Content-Length，支持拖动进度，并在客户端关闭连接时取消上游读取。单个上游范围限时 30 秒，仅一个范围在途，按下游速度读取；不会将整片下载到本地。

Quark TV 的扫码接口为 `https://open-api-drive.quark.cn/oauth/authorize`，确认结果查询接口为 `/oauth/code`，下载地址通过 `/file?method=download` 获取。请求的设备信息与签名协议参考 OpenList 的 Quark TV 驱动。

与 OpenList 当前实现相同，授权码交换及令牌刷新依赖 ExtScreen 中转服务。本实现使用 **HTTPS** 的 `https://api.extscreen.com/quarkdrive/token`。该服务会收到授权码或刷新令牌和 TV 设备信息，服务不可用时新授权与令牌刷新会失败。普通夸克 Cookie 不会发送给该服务。

TV 授权是独立登录，原有 Cookie 不会自动变成 TV 授权。302 仅改变取流链路，账号权限、上游接口可用性仍以实际请求结果为准。Jellyfin 播放设备是否能原生解码、是否转码由 Jellyfin 决定；302 不等于保证 Jellyfin 各客户端均无需转码。

如果 Jellyfin 容器已有 `http_proxy` / `https_proxy`，应同时配置 `no_proxy` 和 `NO_PROXY`，包含影栈内网地址和 `quark.cn,.quark.cn,quarkcdn.com,.quarkcdn.com`。否则 FFmpeg 可能把影栈的内网请求也交给代理。当前 Unraid 的 Jellyfin 模板已加入这些直连规则。

本次 6GB MP4 的媒体头约 8MB，默认无界 HTTP 请求会导致 FFprobe 探测超时。`deploy/jellyfin/` 提供 FFmpeg/FFprobe 启动脚本，仅针对影栈 `/api/strm/stream/` 输入添加 `-request_size 1048576`，以 1MB 分段读取，其余本地媒体参数原样转发。当前 Unraid 将这些脚本保存到 `/mnt/user/appdata/jellyfin/cinestack-ffmpeg/`，并设置容器变量 `JELLYFIN_FFMPEG=/config/cinestack-ffmpeg/ffmpeg`。脚本依赖 Jellyfin 自带的 FFmpeg 支持 `request_size`（本次验证版本为 8.1.3）。

## 本次部署验证

2026-11-09 已在 Unraid 完成扫码授权；重启影栈后授权仍保留，令牌文件权限为 `600`。已有 6,035,765,903 字节的影片由原 STRM 地址返回 302，实际云盘地址的首段及 1MB 偏移段均返回 206。Jellyfin 容器内使用已配置入口的 FFprobe 成功识别 H.264、AAC、1920×800 和 9,421.216 秒时长；FFmpeg 成功解码 1 秒真实视频，本地生成视频输入也通过检查。未做整片播放验收。

## 协议参考

- [OpenList Quark TV 源码](https://github.com/OpenListTeam/OpenList/tree/25da9901f50fecc6cb417193680f0f3cfe2ffcdd/drivers/quark_uc_tv)：核对扫码路径、设备参数、签名字段、刷新与原画下载协议。本项目按接口协议独立实现，不引入 OpenList 源码或运行时。
- [OpenList 官方驱动说明](https://doc.oplist.org/guide/drivers/quark.html)：Quark TV 扫码授权与 302 能力。
