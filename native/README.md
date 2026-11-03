# macOS 本地保存助手

用于默认通过 Chrome 打开的本地 `file://` Markdown。助手依据当前页面地址写回原文件，编辑与保存无需文件选择器。独立预览页的手动选择文件与另存为仍使用浏览器文件 API。

要求 macOS、Python 3.9+、Xcode Command Line Tools（本机编译启动器所需的 clang/codesign）、已加载本扩展并开启“允许访问文件网址”。无需新增 npm/Python 依赖或管理员权限，不启动网络服务、登录项或常驻守护进程。

```bash
python3 native/install.py
# 如果尚未在 Chrome 中加载此目录，先加载扩展，或明确传入 chrome://extensions 中的 ID：
python3 native/install.py --extension-id '替换为你的32位扩展ID'
```

安装后在 `chrome://extensions` 重新加载扩展，再刷新已打开的 Markdown 页面。扩展新增 `nativeMessaging` 权限。点击“编辑”直接进入分栏，点击“保存”或按 Ctrl/⌘+S 按当前文件路径覆盖；刷新后会读到更新的内容。

桌面、文稿或下载目录可能触发 macOS 的一次性文件夹授权。系统询问“MarkView 本地保存助手”访问相应文件夹时，选择“允许”。拒绝后，可在“系统设置 → 隐私与安全性 → 文件和文件夹”中更改本助手对应的开关，再回原页面重试；无需重新选择文件。Chrome 的文件夹权限与助手的权限分别管理。

旧版 shell 启动器可能被系统识别成 `/bin/sh`，无法弹出正常的文件夹授权。重新执行安装命令即可迁移到专属应用启动器；本次仅更新助手时，当前编辑页可保留并直接重试保存，不必刷新。重复安装会复用未改变的签名启动器，避免无故更换授权身份。

安装文件仅写入当前用户：

- `~/Library/Application Support/MarkView/native/`：Python 助手、带本机签名的 `MarkView Local Save.app` 启动器与仅当前用户可读的主机配置。
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.markview.local_save.json`：Chrome 注册文件。

Chrome 按需启动应用入口，入口保留自身身份并启动 Python，通过标准输入/输出交换消息，每个请求完成后两者都退出，不监听本地端口。配置仅允许指定扩展 ID；扩展更换目录导致 ID 变化时需要重新安装绑定。配置中的本地认证密钥不应复制到日志、Issue 或聊天中。

仅处理顶层本地 Markdown 页面指向的已有普通文件，拒绝远程路径、其他文件类型、无效凭证、超过 5 MB 的数据和内容版本冲突。Service Worker 根据消息 sender 取得路径，不接受内容页面提交任意目标路径。保存先校验原文件字节摘要，再在同目录写临时文件并原子替换，保留原文件模式；外部修改或写入失败时保留草稿。请正常保留重要文档备份。

“另存为”成功后继续保存写入新句柄文件，不再写回地址栏原文件。助手未安装或系统拒绝访问时会提示，文件不会被转存到其他位置。

请将命令中的 `替换为你的32位扩展ID` 替换为 `chrome://extensions` 中显示的完整 ID，不要直接照抄其他用户的 ID。默认安装命令会尝试按当前扩展目录自动识别普通 Google Chrome 中的 ID。

验证用 Chrome for Testing 可通过安装脚本的 `--manifest-dir` 指定其测试用户目录下的 `NativeMessagingHosts/`。公开验证入口在 `tests/native/`，命令见 [参与开发](../CONTRIBUTING.md)。

如需移除：关闭使用本扩展的标签页，删除上述**本助手专属**注册 JSON 与 `MarkView/native/` 安装目录即可；不要删除其他 Native Messaging 注册文件。未注册后原文件直接保存会提示助手未连接。
