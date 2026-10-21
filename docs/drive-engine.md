# 夸克引擎选择与验证

当前采用 CloudSaver 的 MIT 夸克模块作为适配基础，源版本 `672cc48ab656973de2675383c966a5336d9de372`。分享 token、分享文件列表、目录浏览和转存请求契约来自该模块；保留 MIT 许可于 `docs/licenses/CloudSaver-MIT.txt`。项目适配为 Node.js fetch，增加分页、明确错误、目录复用、异步任务确认和小文件上传。

不引入 CloudSaver 的 Express、数据库、用户设置和前端，只复用所需网盘模块。不是部署整套 CloudSaver 服务，也不是依赖名为 CloudSaver 的 npm 包。

评估过 OpenList（AGPL-3.0，Go 服务）和 quark-auto-save（AGPL-3.0，Python）；首版不额外部署服务。`ali-quark-drive` npm 包使用专有许可且强依赖 Playwright，未采用。

上传按夸克分片协议实现：pre → hash → 签名授权 → OSS PUT → commit → finish → 文件列表确认。OSS 请求不附带夸克 Cookie；对象存储主机仅允许 pds.quark.cn 下的服务端指定 bucket。上传只接收不超过 4 MB 的元数据内容，不用于传输电影视频。

2026-10-20 实测：

- 用户指定父目录可读。
- 新建独立目录 `MovieLibrary`，实际目录 ID 仅保存在本地 `.env`。
- suenen 搜索《同甘共苦》取得 4 个直接夸克候选，分享文件可浏览。
- `connection-check.nfo`（84 字节）已上传至 MovieLibrary，随后重查确认可见，再次请求复用已有文件。
- 文件列表存在短暂一致性延迟，加入有界确认轮询。
- 未执行真实电影转存；用户从界面选定文件后才会触发。转存/重命名/海报上传的整条电影任务尚待真实选片验收。

现有同名 NFO/图片不覆盖；保留文件并复用其 ID。媒体目录含多个视频时不自动合并命名，标为需要核对。多个同扩展名字幕保留原名。上传失败后的任务重试使用原远端转存任务 ID，避免再次转存。
