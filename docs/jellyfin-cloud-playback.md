# Jellyfin 播放夸克网盘：当前部署与配置建议

核对日期：2026-11-09。来源为 Jellyfin、OpenList、CloudDrive2、rclone 的官方文档与 Jellyfin 源码；下述结论区分官方能力说明与本项目现场观测。

## 结论

现有的 CineStack STRM 方案已具备网盘访问与播放代理功能，不需要为了让 Jellyfin 播放 STRM 再部署 OpenList、CloudDrive2 或 rclone。Jellyfin 读取本地 STRM，STRM 中的 HTTP 地址由 CineStack 在播放时换取夸克下载地址并代理数据。Jellyfin 自身源码将远程 ShortcutPath 转为远程媒体源，并显式对 `.strm` 进行远程探测。[1][2]

现场只读检查确认：Jellyfin 容器使用 host 网络，已将 `/mnt/user/appdata/compose_projects/cine-stack/strm` 挂载到 `/data/quark`，目录中已有 STRM 文件。父 agent 随后的只读检查也确认：用户已建立名为「夸克」的媒体库，`options.xml` 的路径就是 `/data/quark`，已开启实时监控，配置了 NFO reader，关闭章节提图与 Trickplay。Jellyfin 容器可访问 CineStack 健康接口，STRM 可读，但真实播放日志为 502。目录与媒体库配置已经齐全，主要阻塞为云端下载权限。

## Jellyfin 需要配置什么

1. 当前已经有「夸克」媒体库，不需重复创建；扫描现有媒体库即可。若重建部署，使用管理员账号登录 Jellyfin，进入「控制台 → 媒体库 → 添加媒体库」，类型选择「电影」，媒体路径填写容器内的 `/data/quark`，随后保存并扫描。Jellyfin 官方文档说明媒体库可通过管理面板添加，路径可手工输入。[3]
2. 如果已有电影库包含 `/data/quark`，不必重复添加，只需扫描该库。STRM、NFO、海报目录采用每部电影一个目录的组织方式，符合 Jellyfin 推荐的电影目录组织习惯。[4]
3. 确保 CineStack 持续运行、夸克 Cookie 有效，STRM 中的影栈地址为 Jellyfin 可达的 `http://192.168.1.150:18080`。这里不需要将夸克 Cookie 填到 Jellyfin；Cookie 在 CineStack 服务端使用。这是本项目实现方式，不是 Jellyfin 自带夸克驱动。
4. 若重新配置容器，继续保留该目录映射；可设为只读，以避免媒体库软件改动 STRM。Jellyfin 官方 Docker 安装说明支持多个媒体 bind mount，并提供只读挂载例子。[5]
5. 先用一部账号确实有权下载的小体积影片测试扫描、起播及拖动进度，再验收大体积片源。客户端是否可直接播放视频编码、是否转码，是另一个问题；网盘下载接口拒绝访问时，启用硬件转码无法修复该拒绝。

无需另外安装 STRM 读取插件。Jellyfin 已原生处理远程 STRM 链接。[1][2]

## 当前实际阻塞：夸克下载限制

上一次实际请求约 6GB 的影片时，夸克 `file/download` 接口返回 HTTP 400，业务码 `23018`，消息为 `download file size limit`；CineStack 播放端因此返回 502。这是当前会话的真实请求结果，不能仅靠 Jellyfin 的目录挂载、刮削或转码设置解决。

应先在夸克官方客户端使用同一账号确认该文件能否下载，以及该账号的会员/下载权益是否覆盖所需能力。不要从这个单一错误推断所有账号、接口版本都具有某个固定 GB 阈值；本次查阅未得到夸克官方公布的通用阈值。

OpenList 官方夸克驱动文档同样说明普通夸克下载速度受会员影响，普通 Cookie 驱动强制使用本地代理。因而换成另一层代理本身不能保证消除账号的下载权限或大小限制。[6]

## 其他教程中的服务各自解决什么

| 路线 | 用途 | 对当前部署是否必要 |
|---|---|---|
| CineStack STRM → Jellyfin | 小型本地 STRM 目录指向影栈播放代理，影片仍存云盘 | 现有路线，继续使用即可；先解决上游文件可下载性 |
| OpenList 普通夸克驱动 | 聚合云盘、WebDAV/下载代理；使用 Cookie 和文件夹 ID | 非必需；Unraid 已有 OpenList 时可复用，但不会自动让当前 CineStack STRM 改走 OpenList |
| OpenList Quark TV | 官方文档说明可扫码登录、支持 302，只有访问和下载操作 | 可作为另外验证的接口路线，不能承诺绕过网盘权益限制；当前 CineStack 使用的是普通 file/download，不会因安装 OpenList 自动切换 |
| CloudDrive2 | 把云盘挂成本地目录，供 Jellyfin 当普通文件扫描 | 替代 STRM 的路线；增加 FUSE、挂载传播和容器挂载维护工作，不是 STRM 的前置依赖 |
| rclone mount | 将 rclone 支持的 remote 挂为文件系统；可利用 WebDAV remote 接其他服务 | 替代挂盘路线；需要先配置能工作的 remote，不能把 rclone 当成自动支持夸克所有接口或权益的服务 |

OpenList 的普通夸克驱动与 TV 驱动行为差异、扫码步骤见官方驱动教程。[6] CloudDrive2 官方 Docker 教程要求 `/dev/fuse`、共享挂载传播等配置；这正是挂盘路线比当前 STRM 多出的运维内容。[7] rclone 官方 `mount` 文档要求先用 `rclone config` 配好 remote，并用 `rclone ls` 检查，再进行 FUSE 挂载。[8]

## 建议顺序

Jellyfin 电影库包括 `/data/quark` 这一步已确认完成；当前可扫描现有「夸克」媒体库，然后重点确认夸克同一账号能够下载目标影片。上游权限问题处理后，使用现有 CineStack 路线重新测试播放。只有确实需要多网盘聚合、文件系统挂载，或决定评估 TV 接口时，再复用现有 OpenList 或引入挂盘服务。

## 一手来源与教程

1. [Jellyfin BaseItem.cs：远程 ShortcutPath 作为远程媒体源](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Controller/Entities/BaseItem.cs)（核对 `video.IsShortcut` / `ShortcutPath` 分支）。
2. [Jellyfin MediaSourceManager.cs：STRM 的远程媒体探测](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Library/MediaSourceManager.cs)（核对 `item.Path.EndsWith(".strm"...)` 分支）。
3. [Jellyfin 官方：Libraries／添加媒体库](https://jellyfin.org/docs/general/server/libraries/)。
4. [Jellyfin 官方：Movies／电影目录组织、命名与字幕](https://jellyfin.org/docs/general/server/media/movies/)。
5. [Jellyfin 官方：Container／Docker bind mount](https://jellyfin.org/docs/general/installation/container/)。
6. [OpenList 官方：夸克／TV／Open 驱动](https://doc.oplist.org/guide/drivers/quark.html)。
7. [CloudDrive2 官方：Docker 部署指南](https://www.clouddrive2.com/docker.html)。
8. [rclone 官方：rclone mount](https://rclone.org/commands/rclone_mount/)。

文档没有将搜索引擎摘要作为证据；Jellyfin 官方当前站点未找到独立 STRM 文档页，因此以其源码确认 STRM 行为，添加媒体库与容器挂载操作引用其用户文档。
