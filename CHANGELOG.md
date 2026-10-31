# 更新日志 / Changelog

## 1.1.1 — 2026-10-31

### 中文

**新增**

- 会话恢复：下次打开软件时，上次没关掉的标签会自动重新打开，并停在当时正在看的那一个。文件被删掉或移走的会自动跳过，不会报错。
- 设置里新增「恢复上次的标签」开关，不想要这个行为可以关掉。
- 设置里新增「打开文件后显示」，可选文件夹 / 大纲 / 搜索，打开文件后侧边栏自动切到这一栏，默认大纲。
- 标签栏改为常驻：没有打开文件时也显示，右侧的「+」按钮一直都在，随时可以新建。

**修复**

- 双击 `.md` 文件启动时，界面停在欢迎页，看不到刚打开的文件。原因是启动文件是「发出去就不管」的异步打开，而欢迎页在它读完之后才被无条件显示，于是盖在了文件上面。现在改成等文件真正打开再决定欢迎页去留。

**改进**

- 欢迎页不再盖住标签栏和工具栏，只占编辑区。
- 欢迎页的显示状态改由「当前有没有打开的标签」统一决定，不再由各个入口手工开关，避免状态打架。
- 「关于」一栏只保留版本号。

### English

**Added**

- Session restore: tabs left open last time are reopened on launch, with the previously active one focused. Files that have been deleted or moved are skipped silently.
- Setting "Restore last tabs" to turn that behaviour off.
- Setting "Show after opening a file": folder / outline / search. The sidebar switches to it whenever a file is opened; defaults to outline.
- The tab bar is always visible, including on the welcome screen, with a persistent "+" button.

**Fixed**

- Launching by double-clicking a `.md` left the welcome screen covering the file that had just opened. Startup files were opened fire-and-forget while the welcome screen was shown unconditionally afterwards. Startup files are now awaited before deciding whether to show it.

**Improved**

- The welcome screen no longer covers the tab bar and toolbar; it only fills the editor area.
- Welcome screen visibility is derived from the tab count instead of being toggled by hand in several places.
- The About row shows the version number only.

---

## 1.1.0 — 2026-10-31

### 中文

**新增**

- 顶部菜单栏：文件、编辑、格式、视图、帮助，各项带图标，支持键盘快捷键提示
- 命令面板（`Ctrl+Shift+P`）
- 公式插入弹窗：浅灰输入区 + 实时预览，可切换行内 / 块级，`Ctrl+Enter` 直接插入
- 公式插入后支持右键再次编辑，行内、块级都能改
- 下划线语法 `<u>文字</u>`，工具栏与格式菜单均有入口
- 文件关联：可注册为 `.md` 默认打开程序，设置页可直达系统「默认应用」
- 编辑命令：上移 / 下移该行、复制为纯文本、清除格式、保存全部

**语法**

- 补齐 Setext 标题（`===` / `---`）
- 补齐四空格缩进代码块
- 支持多级嵌套引用 `>>`
- 支持反斜杠转义 `\*` `\_` `\#` 等
- 支持行尾反斜杠硬换行
- 支持行内 HTML：`<u>` `<mark>` `<kbd>` `<sub>` `<sup>` `<b>` `<i>` `<s>` `<code>`，以及 `<span style="color:…">`
- 支持 HTML 注释、`<details>` 折叠块、`<img width>`
- 支持引用式链接 `[文字][id]` 与定义行
- 支持脚注
- 图片标题 `![alt](url "标题")` 不再被当成地址
- 尖括号自动链接 `<https://…>`
- 导出渲染器重写，导出的 HTML / PDF 与编辑器内显示保持一致

**改进**

- 统一圆角与过渡动画，去掉彩色发光阴影
- 右键菜单改为分组列表样式
- `.md` 文件图标改为黑白单色版
- 编辑区内任意位置右键都弹出自定义菜单，不再出现浏览器菜单
- 编辑区外右键不再弹出任何菜单

**修复**

- 菜单栏点击无响应（面板在 mousedown 时被移除，click 永远不触发）
- 下划线始终不渲染（行内规则的过滤条件把它挡掉了）
- 启动时侧边栏面板内容为空，切换一次面板才出现
- 文件图标不更新

### English

**Added**

- Menu bar: File, Edit, Format, View, Help, with icons and shortcut hints
- Command palette (`Ctrl+Shift+P`)
- Math input dialog: light-grey input with live preview, inline / block toggle, `Ctrl+Enter` to insert
- Right-click any inserted formula to edit it again, inline or block
- Underline via `<u>text</u>`, available from the toolbar and Format menu
- File association: register as the default `.md` handler, with a shortcut to Windows Default Apps
- Editing commands: move line up / down, copy as plain text, clear formatting, save all

**Syntax**

- Setext headings (`===` / `---`)
- Four-space indented code blocks
- Nested blockquotes `>>`
- Backslash escapes `\*` `\_` `\#` and friends
- Hard line breaks with a trailing backslash
- Inline HTML: `<u>` `<mark>` `<kbd>` `<sub>` `<sup>` `<b>` `<i>` `<s>` `<code>`, plus `<span style="color:…">`
- HTML comments, `<details>` blocks, `<img width>`
- Reference links `[text][id]` with definition lines
- Footnotes
- Image titles `![alt](url "title")` are no longer treated as part of the URL
- Angle-bracket autolinks `<https://…>`
- Export renderer rewritten; exported HTML / PDF now matches what the editor shows

**Improved**

- Consistent corner radii and transitions, removed the coloured glow shadows
- Context menus regrouped into labelled sections
- `.md` file icon switched to a monochrome design
- Right-clicking anywhere inside the editor area opens the custom menu instead of the browser menu
- Right-clicking outside the editor area opens no menu at all

**Fixed**

- Menu bar clicks did nothing (the panel was removed on mousedown, so `click` never fired)
- Underline never rendered (an inline-rule filter skipped the line entirely)
- Sidebar panel was empty on startup until you switched tabs
- File icon did not update

---

## 1.0.0 — 2026-10-31

首个版本。

First release.
