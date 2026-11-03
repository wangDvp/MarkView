# MarkView · Markdown 预览

[源码仓库](https://github.com/wangDvp/MarkView) · [下载发布包](https://github.com/wangDvp/MarkView/releases) · [问题反馈](https://github.com/wangDvp/MarkView/issues)

一个在本地运行的 Chrome Markdown 预览与编辑扩展。打开本地 `.md` / `.markdown` 文件时（需开启文件网址访问）自动进入渲染预览；按 `Ctrl + M` 在预览层与原始文本之间切换。解析、安全过滤、渲染和 Word/PDF 生成都在本地完成，不上传正文，不依赖远程 CDN 或后端服务。文档引用的远程图片仍可能联网，详见 [隐私说明](PRIVACY.md)。

项目代码采用 [MIT License](LICENSE)，版权署名 `wangchaocn1`。第三方代码和字体保留各自许可证，见 [第三方声明](THIRD-PARTY-NOTICES.md)。

## 功能

- **GFM 渲染**：标题、段落、粗体/斜体/删除线、有序/无序/任务列表、代码块、表格、引用、分割线、链接、图片、行内代码、自动链接。
- **代码高亮与复制**：打包 highlight.js，常见 30+ 语言；每个代码块都有“复制”按钮。
- **本地自动预览**：开启文件网址访问后，打开本地 `.md` / `.markdown` 即自动渲染，无需点击或按快捷键；在 `document_start` 阶段隐藏原始文本，避免原文闪烁。
- **预览 / 原文切换**：`Ctrl + M` 在渲染预览与原始文本之间切换；`Esc` 或右上角关闭按钮退出预览。刷新页面会重新自动预览。
- **本地文件选择**：点击扩展图标或按 `Ctrl + M` 打开独立预览页，支持文件选择、拖拽、重新选择。相对路径图片可通过同时选择 Markdown 与图片来解析。
- **主题**：默认跟随系统，支持浅色/深色/跟随系统三态切换，选择会持久化。
- **编辑与保存**：编辑模式左侧 Markdown 源码、右侧实时预览；可切回单栏纯预览，支持保存原文件、另存为和未保存修改提醒。
- **Word / PDF**：一键离线下载标准 `.docx` / `.pdf` 文件；PDF 包含可搜索的中文文字、表格、图片和自动分页。
- **稳健性**：Shadow DOM 样式隔离（严格 CSP 页面也可用）、HTML 白名单净化（防 XSS）、UTF-8/UTF-16 解码、非 UTF-8 警告、空文件/超大文件/无效类型/读取失败提示、重复开关不产生重复 DOM。

## 安装

无需 `npm install` 或构建——`lib/` 中已包含打包后的本地依赖与样式。

1. 打开 `chrome://extensions`。
2. 打开右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择本项目根目录，或扩展 ZIP 解压后包含 `manifest.json` 的目录。
4. 建议在工具栏固定 **Markdown 预览 · Ctrl+M** 图标。
5. 如需打开本地 `file://` Markdown 时自动预览，在扩展的 **详情** 中开启 **允许访问文件网址**（Chrome 要求用户显式授权；未开启时不会自动预览）。
6. 如需在 `file://` 页面上编辑并直接覆盖原文件，安装一次 macOS 本地保存助手：`python3 native/install.py`，然后重新加载扩展并刷新页面。安装与移除说明见 [native/README.md](native/README.md)。无需文件选择窗口，不启动本地网络服务。

最低 Chrome 版本为 **123**（预览样式使用 `light-dark()`）。

本地助手的原文件路径保存目前仅支持 **macOS**，需要 Python 3.9+ 和 Xcode Command Line Tools；它是可选安装项。预览、导出和独立页的浏览器文件保存不依赖助手。Windows/Linux 尚未完成完整验收，也不提供对应的原文件路径保存助手。

开发者可在完整源码目录执行 `npm run package` 生成可直接加载的扩展 ZIP 和独立源码 ZIP；普通使用者无需打包或构建。不要直接压缩整个工作目录，具体文件范围与发布步骤见 [发布说明](docs/RELEASING.md)。

## 快捷键

| 动作 | 默认快捷键 |
| --- | --- |
| 切换 Markdown 预览 / 原始文本 | Windows/Linux: `Ctrl + M`；macOS: `Control + M` |
| 保存当前编辑内容 | Windows/Linux: `Ctrl + S`；macOS: `⌘ + S`（也支持 `Control + S`） |
| 另存为 Markdown | 保存快捷键加 `Shift` |

- 打开已授权的本地 Markdown：自动进入渲染预览；按 `Ctrl + M` 退出预览并显示原始文本；再次按下恢复预览。
- 在远程 Markdown 页面：首次按下打开预览层；再次按下关闭。
- 在普通网页中按下：打开/聚焦独立预览页（可拖拽或选择本地文件）。
- 在独立预览页中按下：关闭该预览标签页。
- `Esc` 与右上角关闭按钮同样可退出预览；本地文件页显示原文，预览标签页则关闭标签页。

自定义快捷键：打开 `chrome://extensions/shortcuts`，在“Markdown 预览 · Ctrl+M”下修改。预览页底部也提供了“自定义 / 检查冲突”入口。

> macOS 上 `Ctrl` 是 Control 键，不是 ⌘。Chrome 会把快捷键显示为 `⌃M`。

如果快捷键被其他扩展或 Chrome 占用，Chrome 不会静默覆盖，扩展会显示“快捷键未绑定（可能与 Chrome 或其他扩展冲突）”。请换一个组合，例如 `Ctrl + Shift + M`。快捷键只在 Chrome 窗口获得焦点时生效。

## 本地文件与 `file://` 访问

Chrome 对本地 `.md` / `.markdown` 的处理取决于版本与平台：可能展示为文本，也可能直接下载。扩展无法拦截下载并重定向。因此提供两条路径：

1. **自动预览（推荐，需文件网址权限）**：在 `chrome://extensions` → 本扩展的“详情”中开启 **允许访问文件网址**（Allow access to file URLs）。之后打开 `file:///.../README.md` 会自动渲染，无需任何操作；`Ctrl + M` 切换到原始文本，再按一次恢复预览；刷新页面会重新自动预览。相对路径图片也会按本地文件路径加载。
   未开启该权限时，Chrome 不会在 `file://` 页面运行内容脚本，扩展无法自动预览；此时使用下面的独立预览页。
2. **被下载或不想授权文件网址时（独立预览）**：点击工具栏扩展图标，或按 `Ctrl + M` 打开独立预览页，再选择/拖入 `.md` 文件。文件通过浏览器 File API 在本地读取，无需任何文件网址权限。

> 文件网址访问是 Chrome 的用户级安全开关，扩展无法绕过或自动开启。若 Chrome 直接把 `.md` 下载为文件，也不会产生可预览的页面，请使用独立预览页。

> 本地 `file://` 与 `chrome-extension://` 之间的任意文件读取受浏览器安全限制。独立预览页无法自动读取 Markdown 旁边未被用户选择的图片。需要显示相对路径图片时，请在文件选择器中同时选择图片，或把它们一起拖入预览页。

## 使用说明

### 页面内预览

- 本地 `file://` Markdown（已开启文件网址访问）：打开即自动预览；`Ctrl + M` 显示原始文本，再次按下恢复；刷新后重新自动预览。
- 远程 Markdown 页面：按 `Ctrl + M` 打开预览；再次按下关闭。
- 自动预览在 `document_start` 阶段先隐藏原始文本，待预览层就绪后恢复页面可见性，避免原文闪烁。
- 右上角：编辑、保存、另存为、下载 Word、下载 PDF、主题切换、关闭。代码块右上角：复制。
- 表格和长代码行可横向滚动；图片自适应宽度。
- 退出预览后页面滚动位置保持不变；预览期间页面滚动被锁定。

### 独立预览页

- 点击工具栏图标或 `Ctrl + M` 打开；会复用已存在的预览标签页，不重复新建。
- 支持拖拽文件到页面任意位置、选择文件、重新选择文件。
- 可一次选择多个文件：其中一个 `.md`/`.markdown` 为正文，其余图片用于解析相对路径（例如 `pics/dot.png`）。
- 可一次选择 UTF-8、UTF-16 LE/BE（含 BOM 或无 BOM 的 UTF-16）文件；非 UTF-8 的字节会以替换字符渲染并显示警告。
- 错误状态：不允许的文件类型、空文件、超过 5 MB、二进制内容、读取/解析失败，都会显示明确提示与“重新选择文件”。

### 主题

- 默认“跟随系统”，切换顺序为 跟随系统 → 浅色 → 深色。
- 选择保存在 `chrome.storage.local` 的 `mdTheme` 键中，页面内预览与独立预览页共享。
- 代码高亮色板随主题切换；在严格 CSP 页面上使用 constructed stylesheet + Shadow DOM，不依赖页面样式权限。

### 编辑、保存与导出

- 点击“编辑”，进入左右分栏：左侧修改 Markdown，右侧约 180 ms 后刷新渲染效果；点击“纯预览”回到单栏，编辑内容会保留。两个预览入口均支持。
- **保存原文件**：在独立预览页通过“选择文件”打开时，保留浏览器返回的文件句柄，保存会写回该文件；Chrome 可能要求确认写入权限。拖入文件时，浏览器支持返回文件句柄的情况下也会保留。
- **直接打开的 `file://` 文件**：安装本地保存助手后，点击“编辑”直接进入左右分栏，“保存”或 `Ctrl/⌘+S` 按当前地址写回原文件，全程不选择文件。后台核对真实页面来源与文档版本，由助手在原目录原子写回。刷新/重新打开后仍可直接保存。
- 首次保存桌面、文稿或下载目录中的文件时，macOS 可能询问“MarkView 本地保存助手”的文件夹访问权限，选择“允许”后即可继续。该权限与 Chrome 的权限分别管理；已拒绝时在系统“隐私与安全性 → 文件和文件夹”中检查本助手。
- 助手只接受已绑定扩展的请求；远程网页、子框架、非 Markdown 文件、无效来源、超过 5 MB 的内容和外部修改冲突会被拒绝。助手未连接或系统权限不足时明确提示并保留草稿，不自动打开另存窗口。
- 独立预览页通过“选择文件”或拖入打开时仍使用浏览器文件句柄。缺少句柄时首次编辑需要选择已有原文件授权；刷新后可能需要重新授权。此入口无法从浏览器 File 对象取得完整系统路径，因此本地路径直写适用于地址栏为 `file://` 的页面。
- **另存为**：选择新的保存位置；成功后，后续“保存”写入新文件。取消或失败不会丢弃编辑内容。原有 UTF-16 编码及 CRLF 换行会保留，其他编码保存为 UTF-8。
- 编辑状态显示“未保存”。关闭、切换文件或用 `Ctrl+M` 退出时会提醒；刷新或关闭标签页由浏览器提示。修改没有自动备份到云端。
- 若检测到原文件在外部被修改，会暂停保存；请重新打开文件，或另存为保留当前修改。
- **下载 Word**：导出当前编辑内容，生成 `.docx`，包括标题、文本格式、列表、任务列表、表格、代码块、链接和可读取的图片。图片受读取权限、CORS、大小限制约束；无法嵌入时保留替代说明并提示。Word 排版与网页显示可能不同。
- **下载 PDF**：点击后直接生成并下载 `.pdf`，无需打印窗口。使用独立的浅色 A4 排版，支持中文可搜索文字、标题、列表、任务列表、表格、代码、链接、可读取图片与自动分页。导出当前编辑内容，无需先保存 Markdown；生成期间继续编辑不会混入已经开始的导出。无法读取的图片保留替代说明并提示。
- PDF 生成库及中文字体随插件离线打包，仅在首次点击“下载 PDF”时加载；增加约 17 MB 运行资源。PDF 是独立文档排版，和网页显示可能不同；部分特殊符号、表情及字体变体不保证完整还原。
- 普通 HTTP 页面可能不提供文件写入 API：可使用“另存为”下载副本，或在扩展独立预览页打开本地文件后编辑保存。远程 Markdown 不会写回服务器。

## 支持范围与限制

- **Markdown**：GitHub Flavored Markdown。表格对齐、任务列表、自动链接均支持。标题不自动生成锚点。
- **代码高亮**：highlight.js，本地打包，不上 CDN。
- **单文件上限**：5 MB（`renderer.js` 中的 `MAX_FILE_BYTES`）。超过时直接提示，不进行解析。
- **编码**：默认 UTF-8；识别 UTF-8 BOM、UTF-16 BOM 与常见无 BOM UTF-16；非 UTF-8 以替换字符预览并警告。
- **HTML 安全**：Markdown 中的原始 HTML 经 DOMPurify 白名单过滤；`script`、`iframe`、`style`、事件属性、`javascript:` 链接等被移除。外部链接添加 `rel="noopener noreferrer"` 并在新标签页打开。
- **可选图表/公式未打包**：Mermaid 与 KaTeX 的运行时代码体积较大（Mermaid 单文件约 3 MB，KaTeX 还需字体），与“轻量”目标冲突，因此没有默认包含；对应的围栏代码块仍会作为普通代码块显示。核心渲染依赖打包后约 238 KiB。
- **目录拖拽**：不支持直接拖入文件夹；请选择文件或一次拖入 Markdown + 图片。
- **无扩展名 URL**：内容脚本只匹配 `.md` / `.markdown` 路径，不会自动注入。此类内容可下载后通过独立预览页打开。
- **文件写入**：`file://` 页面通过用户安装并绑定扩展的本地助手按路径保存；独立预览页使用浏览器文件句柄。助手只修改已有本地 Markdown，不创建任意目标文件。
- **平台**：本地路径保存助手仅提供 macOS 安装器。未安装助手时仍可使用独立预览页的文件选择、编辑保存和导出。
- 不提供目录/TOC、搜索、云同步、远程服务器写入等功能。

## 权限与隐私

请求的权限仅：

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存主题偏好与预览标签页 ID（`chrome.storage.session`） |
| `nativeMessaging` | 与用户安装的本地保存助手通信，写回当前 `file://` Markdown 原文件 |

- 不申请 `tabs`、`downloads`、`<all_urls>` 等宽泛权限。
- 内容脚本分别声明在 `http(s)` 与 `file://` 的 `.md` / `.markdown` 路径上；`file://` 脚本在 `document_start` 初始化，用于自动预览，并需用户开启文件网址访问。
- 页内预览读取当前 Markdown URL 的源文本（同源请求）；本地独立预览通过用户选择的 File 对象读取。
- 不收集、不上传、不分析文件内容；没有远程代码、CDN、账户或后端。
- Markdown 中引用的远程图片/链接仍会按正常浏览器行为访问对应服务器，这是文档内容本身的行为。

数据存放、网络请求和移除方式见 [PRIVACY.md](PRIVACY.md)。

## 项目结构

```text
manifest.json            MV3 清单、快捷键、内容脚本匹配规则
background.js            Service Worker：命令路由、预览标签页复用/关闭
native-bridge.js         校验本地顶层文档来源，代理 Native Messaging
native-file.js           本地保存适配器与原文摘要
native/                 macOS Python 保存助手及安装脚本
content.js               页内预览层 + file:// 自动启动/防闪烁：Shadow DOM、主题、Esc、焦点与滚动
renderer.js              共享渲染器：marked、DOMPurify、highlight.js、编码/文件处理
preview.html             独立预览页
preview.js               独立预览页交互：选择、拖拽、错误状态、主题
document-editor.js       共享分栏编辑、实时预览、文件保存与未保存保护
document-export.js       本地 DOCX 打包与 PDF 直接下载入口
pdf-export.js            按需加载 PDF 引擎、中文字体及图片
pdf-content.js           将净化后的预览正文转换为 PDF 排版
preview.css              共享样式（页面与 Shadow DOM）
lib/markdown-vendor.js   marked + DOMPurify + highlight.js 的本地打包
lib/content-styles.js    由 preview.css 生成的注入样式（构建产物）
lib/pdf-vendor.js        按需加载的 pdfmake 本地构建
fonts/                  PDF 使用的 Noto Sans SC 中文字体
icons/                   16/32/48/128 图标及 SVG 源文件
scripts/build.mjs        构建本地依赖与注入样式
scripts/sync-styles.mjs  仅同步注入样式，无需安装构建依赖
scripts/icons.mjs        由 SVG 生成 PNG 图标（macOS sips）
tests/                   Chrome 端到端验证与夹具
licenses/                第三方许可证全文
```

### 命令路由

```text
Ctrl+M (commands API)
  └─ active tab
       ├─ 预览标签页 ──────────────→ 关闭标签页
       ├─ 有内容脚本的 Markdown 页面 → 发送 MD_TOGGLE，打开/关闭 Shadow DOM 预览层
       └─ 其他页面 ─────────────────→ 打开/聚焦独立预览页
```

## 开发

要求 Node.js **22.12+**（与已锁定的开发依赖匹配）和可加载扩展的 Chrome。扩展本身无需构建即可使用，以下仅用于修改源码后重建/验证。完整贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
npm ci
npm run check     # 只读静态检查，不构建、不启动浏览器
npm run test:package # 检查发布内容与本地配置隔离
npm run build     # 重建 lib/markdown-vendor.js 与 lib/content-styles.js
npm run icons     # 可选：重新生成 PNG 图标（macOS，需要 sips）
npm test          # 构建 + 启动 Chrome 端到端验证
```

- 修改 `preview.css` 后必须执行 `npm run build`，否则页内预览的注入样式不会更新。
- 仅修改样式时，也可运行 `node scripts/sync-styles.mjs` 同步 `lib/content-styles.js`，无需重建依赖。
- 修改 `src/vendor.js` 或依赖版本后执行 `npm run build`。
- 仅重建 PDF 依赖可执行 `node scripts/build-pdf.mjs`；字体已随项目提供，需要重新下载时执行 `node scripts/fetch-pdf-fonts.mjs`。
- 手动安装仍直接加载项目根目录，无需构建。

### 端到端验证

`npm test` 使用 Puppeteer + Chrome for Testing，在真实浏览器中加载扩展，覆盖 95 项断言：命令注册、页内预览渲染、XSS 净化、严格 CSP/Trusted Types、本地 `file://` 自动预览、`Ctrl+M` 原文/预览切换、刷新自动恢复、防闪烁初始化、相对图片、滚动恢复、重复开关、普通网页不受影响、标签页路由、文件选择/拖拽、UTF-16/非 UTF-8、空文件/超大文件、主题持久化、Esc/关闭按钮、标签页清理等。

Chrome 137+ 的正式版已移除 `--load-extension` 命令行参数（手动“加载已解压”不受影响）。测试脚本因此使用 Chrome for Testing：

```bash
npx @puppeteer/browsers install chrome@stable --path .cache/browsers
npm test
# 或指定可执行文件：
CHROME_PATH="/path/to/Google Chrome for Testing" npm test
```

测试默认以有头模式启动（扩展在 headless 模式下不可用），会短暂打开一个隔离配置的 Chrome 窗口。截图输出到 `tests/artifacts/`（已忽略）。

本地助手的定向检查使用 `npm run test:native`；真实 Chrome 到助手的完整保存检查使用 `npm run test:native:browser`，需 macOS 和已安装的 `agent-browser`。该脚本动态读取测试扩展 ID，不依赖维护者本机目录或 ID。历史运行结果不代替当前版本的发布验证。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 按 `Ctrl + M` 无反应 | 打开 `chrome://extensions/shortcuts` 检查是否绑定或冲突；换用 `Ctrl+Shift+M`。macOS 使用 Control，不是 ⌘。 |
| 打开本地 `.md` 没有自动预览 | 在扩展详情中开启“允许访问文件网址”，然后刷新页面；未开启时 Chrome 不允许内容脚本运行于 `file://`。 |
| 打开 `.md` 后变成下载 | Chrome 默认行为，无法拦截；点击扩展图标/按 `Ctrl+M` 后在预览页选择该文件。 |
| 自动预览后按 `Ctrl+M` 没切回原文 | 确认快捷键仍绑定；也可按 `Esc` 或点击预览右上角关闭按钮。 |
| 相对路径图片裂图 | 页内预览会基于源 URL 解析；独立预览需同时选择/拖入图片文件。 |
| 中文乱码 | 文件可能是 GBK/GB18030 等非 UTF-8 编码。当前会显示警告；请转存为 UTF-8。 |
| 修改 CSS 后页面内样式没变 | 执行 `npm run build`，然后在 `chrome://extensions` 点击扩展的刷新按钮。 |
| 提示“快捷键未绑定” | Chrome 未分配默认快捷键（冲突），请在快捷键页面手动指定。 |
| 超大文件无法预览 | 上限 5 MB；拆分文件或使用专门的大型 Markdown 阅读器。 |

## 第三方

渲染依赖均为本地打包：marked（MIT）、DOMPurify（Apache-2.0 / MPL-2.0 双许可，本项目按 Apache-2.0 使用）、highlight.js（BSD-3-Clause）。PDF 使用本地 pdfmake（MIT）和 Noto Sans SC（SIL OFL 1.1）。完整许可证文本见 `licenses/`，汇总见 `THIRD-PARTY-NOTICES.md`。
