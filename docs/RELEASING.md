# 发布准备

以下命令在项目根目录执行。脚本只生成本地 ZIP 与 SHA-256 校验文件，不创建远程仓库、不提交代码、不上传文件或发布商店版本。

## 发布前验证

1. 对照 `LICENSE` 确认项目署名和许可，保留 `THIRD-PARTY-NOTICES.md`、`licenses/` 及字体许可。项目自己的 MIT 不替代第三方许可证。
2. 确认 `package.json`、锁文件根版本与 `manifest.json` 的版本一致。项目仓库为 [wangDvp/MarkView](https://github.com/wangDvp/MarkView)，同步核对包元数据中的仓库、主页和问题反馈地址。
3. 从干净源码副本检查安装、编辑/预览切换、保存/另存为、Word/PDF 导出。覆盖入口差异：直接打开本地文件、独立预览页、macOS 助手未安装或拒绝权限时。
4. 执行对应的定向检查，参考 [参与开发](../CONTRIBUTING.md)。macOS 原文件覆盖需实际验证助手和系统授权；Windows/Linux 的助手安装尚未支持。
5. 可执行 `npm audit --registry=https://registry.npmjs.org` 检查锁定依赖。它会向 npm 发送依赖清单；不要自动运行 `npm audit fix` 或未经评估升级依赖。记录审计时间、发现和处理结论。

## 生成发布包

```bash
npm run package
```

该命令使用 Python 3 标准库，直接包装已有运行资源，不安装依赖或构建。修改过源依赖/样式时先按开发说明更新相关构建文件。

输出到被 Git 忽略的 `dist/`：

- `MarkView-v<version>.zip`：解压后根目录即有 `manifest.json`，可通过 Chrome“加载已解压的扩展程序”使用，包含 macOS 助手源码和安装说明。
- `MarkView-v<version>-source.zip`：源码、开发脚本、测试和许可证。包含已构建资源，便于直接加载。
- `SHA256SUMS.txt`：两份 ZIP 的 SHA-256。

发布器使用 `scripts/package-release.py` 中的明确文件清单，不递归打包整个工作目录。缺少运行资源、许可证、版本不一致或清单中的文件是符号链接时拒绝打包。不会包含 `node_modules/`、本地会话记录、测试产物、浏览器资料、已安装的 `.app` 或助手密钥。

输出文件使用独占创建，已有同版本文件时拒绝覆盖。若需重打包，可用 `python3 scripts/package-release.py --output ./dist-repacked`，避免误覆盖已交付的包。

## 人工验收与上传

将扩展 ZIP 解压到新的固定位置，按 README 加载并验证。安装助手时先加载该解压目录的扩展，再执行该目录下的 `native/install.py`；目录变化可能使开发者模式扩展 ID 变化，应重新绑定。

源码包或 Git 首次提交前再检查文件清单与截图。当前个人会话记录由 `.gitignore` 排除但保留本地；不要通过强制添加或整目录压缩重新带入。源码包中保留 `package-lock.json`、本地资源和完整许可证。

对 [wangDvp/MarkView](https://github.com/wangDvp/MarkView) 的提交、推送和 Release 上传是独立的发布操作，需发布者具备仓库写入权限。`npm run package` 不会执行这些操作。上架 Chrome Web Store 也需单独准备，项目不包含商店签名或发布凭据。
