# Jellyfin 网页 STRM 起播慢：诊断记录

日期：2026-11-10。用户症状为浏览器网页版点击播放后长时间转圈，Quark TV 直接播放较快。本轮只定位，不修改应用代码、容器配置或部署；播放信息接口会触发 Jellyfin 自身的常规媒体探测。

后续修复已于同日部署，以下诊断保留为修复前证据。影栈现在将无结束位置/超过 8MiB 的视频请求按 8MiB 读取并连续转发，小范围请求和 HEAD 保留 302。已有 STRM 地址和授权保持有效。

## 修复后验收

- 原同一命令 `python3 /tmp/cine-jellyfin-read8m.py`：`bytes=0-` 读取前 8MiB 从「20.884 秒只取得 2MiB」变为「3.120 秒完整取得 8MiB」。明确范围读取维持 3.164 秒。
- 本机 Chrome 原生 video 访问真实 Jellyfin 静态视频接口：loadedmetadata 3,125ms，首帧及 playing 3,181ms。跳转到 600 秒后，1,197ms 恢复播放。
- 此浏览器验收是用相同 Jellyfin 视频接口的独立测试页，未操作用户 Jellyfin 页面设置；完整 Jellyfin 页面还包含其 PlaybackInfo 远程探测。本次实测该探测仍约 4.8 秒，不将原生 video 的 3.18 秒等同于完整页面全部起播耗时。
- 46 项测试通过，覆盖跨段字节一致性、200/206 与长度、拖动进度、416、错误上游范围、关闭客户端取消上游、截断检测和重定向域名验证。构建通过。
- 起播和跳转已验收，未整片播放。临时浏览器测试页包含的访问凭据仅保留在受限本地临时目录，测试后已删除，临时服务已停止。

## 结论

已复现同一 Quark TV 原画地址对 HTTP Range 请求形式表现出显著的吞吐差异：明确结束位置的请求快，`bytes=0-` 无结束位置请求慢。Jellyfin 网页的静态远程播放路径将浏览器 Range 原样转发给上游，未按固定长度拆分。样本 MP4 开头的 `moov` 媒体头为 8,281,520 字节，浏览器需要取得头部信息才能起播。在约 100KB/s 的无界读取速度下，仅头部读取就接近 80 秒。

这与历史日志中该影片两次约 80 秒的起播间隔吻合。没有证据表明是影栈获取 TV 地址慢或 GPU 转码不足。

此前 `deploy/jellyfin/ffmpeg` 和 `ffprobe` 添加的 `-request_size 1048576` 对 FFmpeg 进程有效，但网页静态播放由 Jellyfin 的 .NET HttpClient 执行，不经过这两个脚本。上一轮验证了探测与视频解码，遗漏网页静态播放链路。

## 测量

样本：网盘影片「希望」，文件 6,035,765,903 字节。所有请求使用同一现有 STRM 和其解析出的 Quark TV 原画地址；签名链接和授权令牌未写入本文。

| 环节 | 测量结果 |
|---|---|
| 影栈获取 TV 链接并返回 302，三次 | 391 / 193 / 130ms |
| CDN 明确范围读取 1MiB，三次 | 505 / 527 / 527ms |
| Jellyfin PlaybackInfo（重复远程探测） | 4.8～5.0 秒 |
| 当前 FFprobe，大探测参数 | 5.012 秒 |
| FFprobe，1MiB 请求、小探测参数 | 4.596 秒 |
| FFprobe，8MiB 请求、小探测参数 | 3.189 秒 |
| Jellyfin 静态视频接口，`bytes=0-8388607`，两次 | 3.219 / 3.138 秒读完 8MiB |
| Jellyfin 静态视频接口，`bytes=0-`，两次 | 20.876 / 20.884 秒各只读到 2MiB，诊断主动结束 |
| 直接 CDN，`bytes=0-8388607` | 2.778 秒读完 8MiB |
| 直接 CDN，`bytes=0-` | 20 秒读取 2,063,428 字节后诊断超时 |
| Jellyfin 静态视频首个 1KB | 约 0.4～0.8 秒；首字节快不代表媒体头已读完 |

服务器当时 Jellyfin CPU 约 0.01%，影栈 API CPU 约 0%。已有 `no_proxy` 包含内网地址和夸克域名。实际 PlaybackInfo 的转码原因为空，视频为 H.264/AAC，且上述静态接口不启动 FFmpeg 转码。

历史日志（UTC；北京时间加 8 小时）：

- 2026-11-09 09:48:55.238 播放策略检查 → 09:50:19.848 started playback，间隔 84.610 秒。
- 2026-11-09 09:51:46.261 播放策略检查 → 09:53:08.525 started playback，间隔 82.264 秒。

## 复现方式

从正在使用的 STRM 获取地址，在同一 Jellyfin 静态视频接口上，仅切换 Range：

```text
GET /Videos/<item-id>/stream.mp4?Static=true&MediaSourceId=<source-id>
Authorization: MediaBrowser ... Token=<现有授权令牌>

A: Range: bytes=0-8388607
B: Range: bytes=0-
```

每次最多读取 8MiB；记录读完耗时，B 在约 20 秒时主动停止。两次 A 均约 3 秒读完，B 均只取得 2MiB。再绕过 Jellyfin 对解析出的同一 CDN 地址做同样 A/B，差异依旧存在，说明并非 Jellyfin 的带宽转发本身导致。

诊断脚本保存在本机 `/tmp/cine-jellyfin-read8m.py`；脚本运行时通过 SSH 只读取得已有会话令牌，凭据仅在进程内存中。运行命令为 `python3 /tmp/cine-jellyfin-read8m.py`。只输出耗时、字节数和状态码，不输出令牌或签名地址。

## 机制与修复方向

实际网页静态播放链路：浏览器 → Jellyfin 静态视频接口 → 影栈 302 → Jellyfin 跟随重定向请求 Quark TV CDN → 视频经 Jellyfin 返回浏览器。影栈的 302 不等于浏览器已直接连接 CDN，也不等于客户端请求自动变成分段请求。

后续应在网页实际取流路径实现带结束位置的分段读取，例如为网页增加可连续拼接范围的播放代理，或明确走使用分段参数的 FFmpeg 转封装。仅扩大 FFprobe 参数、重复扫码、启用 GPU 或继续改 302 响应均不能覆盖当前问题。修复必须保留正确的 Content-Range/Content-Length、取消处理和拖动进度，并通过网页真实起播验证。

本轮未证实夸克内部对该行为的具体限速规则，也未抓取 Quark TV App 自身的网络请求，因此不将其客户端实现方式作为事实；已证实的结论限于本片源、该下载接口及本次 A/B 测量。

参考源码：

- [Jellyfin VideosController：Static remote stream 分支](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/VideosController.cs)
- [Jellyfin FileStreamResponseHelpers：原样转发 Range，以 HttpClient 读取上游](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Helpers/FileStreamResponseHelpers.cs)
- [Jellyfin MediaSourceManager：STRM 远程探测](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Library/MediaSourceManager.cs)

源码来自当前上游 master，具体部署版本行为以真实接口测量为依据。
