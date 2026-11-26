# 更新日志 / Changelog

## 1.1.4 — 2026-11-26

### 中文

**新增**

- 设置里新增「编辑区域」：集中（正文居中，像一页纸，两侧留白）或分散（正文占满整个编辑区），默认分散
- 标签栏宽度自适应：单个标签贴合文件名，标签多时先压缩到最小宽度，还放不下才横向滚动
- 设置里「文档存放位置」的「重置」会先弹确认框

**改进**

- 大文件的输入延迟大幅下降：2MB 文档每个按键从约 114ms 降到约 52ms（不再每次更新都全量重算字数和装饰）
- 导出的 HTML 与编辑器排版同步：正文左右留白 60px（窄屏 36px）、引用条 4px、引用文字与正文左对齐
- README 补充了 1.1.1–1.1.3 的新功能说明

**修复**

- 正文列没有居中：CodeMirror 的主题样式覆盖了居中规则，正文一直贴着侧边栏显示
- 打字机模式下拖选文字时整篇内容上下跳动（现在只在输入时跟随光标）

### English

**New**

- New 编辑区域 (editing area) setting: 集中 (centered, paper-like column) or 分散 (text fills the whole editor area), 分散 by default
- Tabs size to their file names: a single tab hugs its name, many tabs shrink to a minimum before the row scrolls
- Resetting the documents folder in Settings now asks for confirmation

**Improved**

- Much lower typing latency in big documents: per-keystroke latency in a 2MB file dropped from ~114ms to ~52ms (no more full-document recount and rescan on every update)
- Exported HTML matches the editor's layout: 60px body padding (36px on narrow screens), 4px quote bar, quote text aligned with body text
- README now covers the features added in 1.1.1–1.1.3

**Fixed**

- The text column was never centered (CodeMirror's theme overrode the centering rule, so text sat against the sidebar)
- With typewriter mode on, dragging to select text made the whole document jump (it now only follows the caret while typing)

---

## 1.1.3 — 2026-11-15

### 中文

**新增**

- 标签可以拖动。拖到另一个窗口就合并过去；拖到所有窗口外面，会在松手的位置拆出一个新窗口。
- 同时打开两个文件时自动并进同一个窗口，不再各开一个窗口。
- 设置里新增三个开关：启动动画、拖动标签、拖出新建窗口。

**改进**

- 正文左右留白从 44px 加到 60px，不再紧贴侧边栏；窗口窄于 900px 时用 36px，避免正文被挤窄。
- 引用条从 3px 加粗到 4px。引用文字和正文左边界对齐，竖条挂在正文左侧外面。
- 设置里的说明文字重写了一遍，去掉实现细节，改成给用户看的话。
- 未保存的草稿恢复后保留原来的标签名。
- 屏蔽了 WebView2 自带的刷新、打印、开发者工具快捷键。

**修复**

- 分割线下面多出一行空白。原因是分割线所在行被行内 widget 撑到 84px，现在压到 25px，上下间距一致。
- 同时双击两个文件只打开一个。第二个进程转交的文件改成先存队列，等窗口准备好再取。
- 上次没有标签，重开却还问要不要恢复。关窗时没有立即写盘，现在关窗前会先落盘。
- 「启动动画」开关打开后不生效。动画原来挂在会话恢复流程里，没有上次内容就永远走不到，现在独立判断。
- 关闭软件后，上次打开的标签和光标位置丢失。

### English

**New**

- Tabs can be dragged. Drop one on another window to merge it there; drop it outside every window and it tears off into a new window at the cursor.
- Opening two files at once now merges them into one window instead of starting two.
- Three new switches in Settings: boot animation, tab dragging, tear-off to new window.

**Improved**

- Body text now has 60px of side padding instead of 44px, so it no longer sits against the sidebar. Narrow windows (under 900px) use 36px.
- The quote bar is 4px instead of 3px. Quote text lines up with body text while the bar hangs to the left of it.
- Rewrote every settings description as plain user-facing copy.
- Restored drafts keep their original tab name.
- Disabled WebView2's reload, print and devtools shortcuts.

**Fixed**

- Horizontal rules left an extra blank line below them. The row was being stretched to 84px by the inline widget; it is now 25px with even spacing above and below.
- Opening two files at once only opened one. Files forwarded by the second process are now queued and picked up once the window is ready.
- A restore prompt appeared even when nothing was open last time. The session was not flushed before the window closed.
- The boot animation switch had no effect. The animation lived inside the restore flow, which returns early when there is nothing to restore.
- Tabs and cursor positions were lost after closing the app.

---

## 1.1.2 — 2026-11-04

### 中文

**改进**

- 会话恢复不再只记文件路径：每个标签的光标位置和滚动条位置也会一起记住，重开软件回到上次看到的地方。切换标签时各自的滚动位置也独立保留。
- 光标移动、打字、滚动时会低频写盘（600ms 节流），不用等关窗才保存。
- 关掉「恢复上次的标签」时，连光标和滚动记录一起清空，不留脏数据。
- 文件在外部被改短时，恢复的光标位置会自动收进文档范围内，不会越界报错。

### English

**Improved**

- Session restore now remembers each tab's cursor and scroll position, not just its path. Switching tabs keeps each one's own scroll offset.
- Cursor moves, typing and scrolling trigger a throttled save (600 ms) instead of waiting for the window to close.
- Turning off "Restore last tabs" clears the saved cursor/scroll data as well.
- Restored cursor positions are clamped to the document length if the file was shortened outside the editor.

---

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
