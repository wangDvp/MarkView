# 参与开发

欢迎提交问题和改进。请先阅读 [README](README.md)、[隐私说明](PRIVACY.md) 和 [发布说明](docs/RELEASING.md)。项目代码采用 [MIT](LICENSE)，第三方代码和字体保留各自的许可。

## 准备环境

- Node.js 22.12+，使用 `npm ci` 按 `package-lock.json` 安装依赖。
- Chrome；自动化扩展测试使用 Chrome for Testing，可通过 `CHROME_PATH` 指定其可执行文件。
- 助手相关开发需要 macOS、Python 3.9+、Xcode Command Line Tools。真实 native 浏览器测试另外使用 `agent-browser` CLI。

普通使用者可直接加载项目根目录或解压后的扩展包，无需安装 Node.js。独立预览与浏览器文件句柄保存不要求安装本地助手。

## 修改与验证

```bash
npm run check          # 不构建、不启动浏览器的静态检查
npm run test:package   # 临时目录中检查发布包隔离与完整性
npm run test:native    # macOS：真实文件 IO/安装器，以及 worker API 契约检查
```

按改动范围选择验证，不要将没有执行的检查写为通过。`test:native` 使用自有临时目录，不注册用户普通 Chrome；桥接层测试使用 Chrome API 替身，文件系统测试保留真实 IO。

需要重新生成依赖或样式时：

```bash
npm run build                  # 重建本地 JS 依赖与注入样式
node scripts/sync-styles.mjs    # 只更新 preview.css 对应的注入样式
node scripts/build-pdf.mjs      # 只重建 PDF 引擎与第三方声明
```

浏览器验证按需执行：

```bash
# 首次准备测试浏览器，需网络；也可以使用已安装的 Chrome for Testing。
npx @puppeteer/browsers install chrome@stable --path .cache/browsers
npm test                       # 构建并运行原有浏览器回归
npm run test:native:browser     # macOS：agent-browser 隔离会话验证实际本地保存
```

真实 native 浏览器测试动态读取扩展 ID，在自有临时 Chrome 配置中注册助手并写入测试 Markdown，结束时关闭测试会话并清理自有数据。它不接管用户日常 Chrome。测试产物、浏览器缓存和本地会话记录不会进入公开发布包。

## 提交内容

- 说明改动前后的行为及实际执行的验证。
- 不提交 `node_modules/`、`dist/`、浏览器配置、助手安装数据或包含私人信息的截图/文档。
- 修改运行依赖后同步锁文件、本地构建和第三方声明；新增依赖前检查用途及许可证。
- 本地文件写入必须保留来源校验、版本冲突检查、大小限制与失败后草稿保留。
- 问题反馈请附浏览器版本、操作系统、复现步骤及最小脱敏示例。不要在公开 Issue 中粘贴密钥、Cookie、真实敏感文件或未修复漏洞的利用细节。
