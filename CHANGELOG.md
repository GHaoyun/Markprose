# 更新日志 / Changelog

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
