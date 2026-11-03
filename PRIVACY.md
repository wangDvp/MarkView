# 隐私与本地数据

MarkView 在浏览器本地解析、过滤、预览 Markdown，并生成 Word/PDF。扩展没有账号、统计 SDK、云同步或文件上传后端，不主动向维护者发送正文、文件路径或使用记录。

## 数据在哪里处理

- 预览和编辑：正文保留在当前页面内存中。没有自动持久化草稿；刷新或关闭前请保存。文件选择、另存为使用浏览器提供的文件权限。
- 用户偏好：主题写入 `chrome.storage.local`；预览标签页 ID 写入 `chrome.storage.session`，用于复用标签页。
- Word/PDF：当前内容在本地打包，PDF 引擎和中文字体随扩展分发。下载的文件由浏览器保存到用户指定的位置。
- 本地原文件保存：可选 macOS 助手通过 Chrome Native Messaging 接收当前文件 URL、内容摘要和要写入的内容，在本机核对版本并保存。助手没有网络监听或常驻服务。

## 网络访问

“本地处理”不代表文档永不联网：

- 预览 HTTP(S) Markdown 时，可能向当前页面的同源地址重新请求原文。
- Markdown 中的远程图片会向图片服务器发起请求；点击外部链接会访问目标网站。图片导出也可能请求图片资源。
- 开发时安装 npm 依赖、下载字体或 Chrome for Testing，以及执行依赖漏洞扫描，会连接相应的第三方服务。这些不是扩展运行时的文件上传。

## 本地助手的权限与配置

扩展声明 `storage`、`nativeMessaging` 权限；本地自动预览还需用户开启 Chrome 的“允许访问文件网址”。桌面、文稿或下载目录的访问由 macOS 分别授权给“MarkView 本地保存助手”。

助手配置和随机认证密钥仅在安装时生成，位于当前用户的 `~/Library/Application Support/MarkView/native/`。Chrome 主机注册位于 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 的本助手专属 JSON。它们不属于源码或发布包，请勿上传、截图或粘贴到 Issue。

助手按消息来源和文件版本限制操作：只处理当前顶层本地 Markdown 页面对应的已有普通文件，最多 5 MB；内容冲突或系统拒绝访问时保留页面草稿。具体安装与移除步骤见 [本地助手说明](native/README.md)。

## 清除数据

卸载扩展可移除扩展保存的偏好。助手需要按安装说明单独移除。已保存的 Markdown、下载的 Word/PDF 和用户备份不会因卸载而删除。

反馈问题时，请使用不含个人、业务信息的示例文档；不要附上浏览器用户目录、助手配置、密钥或真实敏感文档。
