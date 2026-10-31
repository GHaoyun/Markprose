<p align="center">
  <img src="docs/icon.png" width="112" alt="Markprose">
</p>

<h1 align="center">Markprose</h1>

<p align="center"><a href="README.en.md">English</a> | <b>简体中文</b></p>

<p align="center">
  <a href="https://github.com/GHaoyun/Markprose/releases"><img src="https://img.shields.io/github/v/release/GHaoyun/Markprose?color=b4623a&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-6b6b6b" alt="Platform">
  <a href="https://github.com/GHaoyun/Markprose/releases"><img src="https://img.shields.io/github/downloads/GHaoyun/Markprose/total?color=2f7d5b" alt="Downloads"></a>
  <a href="https://github.com/GHaoyun/Markprose/stargazers"><img src="https://img.shields.io/github/stars/GHaoyun/Markprose?color=e2a674" alt="Stars"></a>
  <img src="https://visitor-badge.laobi.icu/badge?page_id=GHaoyun.Markprose" alt="Views">
</p>

一个免费开源的 Markdown 编辑器。Windows x64，包含便携版和安装包。非常非常小巧简洁，但是功能全面。

## 功能

打开就能写。格式标记平时不显示，光标移进去才露出来，想看原文按 `Ctrl+/` 切到源码模式。

- 标题、加粗、斜体、删除线、下划线、高亮、引用、列表、任务清单、代码、表格、链接、图片
- 脚注、数学公式、Mermaid 流程图
- 表格有独立面板，按行列增删，不用手敲竖线
- 公式带实时预览的输入框，插好之后右键还能再改
- 多标签、文件树、大纲、全文搜索
- 专注模式、打字机模式、行号、缩放
- 图片可以直接粘贴或拖进来
- 导出 HTML、打印成 PDF
- 关标签和关窗口会问要不要保存
- 正文字号、行高、内容宽度、正文字体都能调
- 可以把 `.md` 关联成默认打开方式

## 支持的语法

| 语法 | 写法 |
| --- | --- |
| 标题 | `#` ~ `######`，或文字下面跟 `===` / `---` |
| 粗体 / 斜体 | `**粗体**`、`*斜体*`、`***粗斜体***` |
| 删除线 | `~~删除~~` |
| 下划线 | `<u>下划线</u>` |
| 高亮 | `==高亮==` |
| 列表 | `-` `*` `+`，有序用 `1.`，缩进 2–4 空格嵌套 |
| 任务清单 | `- [ ] 未完成` / `- [x] 已完成` |
| 引用 | `>`，支持 `>>` 嵌套 |
| 代码 | 行内反引号、围栏代码块、四空格缩进块 |
| 链接 | `[文字](url "标题")`、`<https://…>`、`[文字][id]` |
| 图片 | `![替代文字](url "标题")`、`<img src="…" width="120">` |
| 表格 | 竖线分隔，`:-` `:-:` `-:` 控制对齐 |
| 分隔线 | `---`、`***`、`___` |
| 转义 | `\*` `\_` `\#` 等 |
| 脚注 | `文字[^1]` + `[^1]: 说明` |
| 公式 | `$行内$`、`$$块级$$` |
| 图表 | 围栏代码块标注 `mermaid` |
| HTML | `<u>` `<mark>` `<kbd>` `<sub>` `<sup>` `<span style>` `<details>` |

## 安装

安装包：运行 `Markprose_1.1.1_x64-setup.exe`，装完首次启动会让你选文档保存位置。

便携版：`Markprose-1.1.1-portable.exe` 放到任意目录直接运行。

## 快捷键

| 操作 | 快捷键 | 操作 | 快捷键 |
| --- | --- | --- | --- |
| 新建 | `Ctrl+N` | 保存 | `Ctrl+S` |
| 打开文件 | `Ctrl+O` | 另存为 | `Ctrl+Shift+S` |
| 打开文件夹 | `Ctrl+Shift+O` | 关闭标签 | `Ctrl+W` |
| 加粗 | `Ctrl+B` | 斜体 | `Ctrl+I` |
| 删除线 | `Ctrl+U` | 下划线 | `Ctrl+Shift+U` |
| 行内代码 | `Ctrl+E` | 高亮 | `Ctrl+Shift+H` |
| 链接 | `Ctrl+K` | 表格 | `Ctrl+T` |
| 代码块 | `Ctrl+Shift+K` | 块级公式 | `Ctrl+Shift+M` |
| 标题 1–6 | `Ctrl+1`…`6` | 正文 | `Ctrl+0` |
| 查找 | `Ctrl+F` | 替换 | `Ctrl+H` |
| 源码模式 | `Ctrl+/` | 侧边栏 | `Ctrl+\` |
| 命令面板 | `Ctrl+Shift+P` | 设置 | `Ctrl+,` |
| 上移 / 下移该行 | `Alt+↑` / `Alt+↓` | 全屏 | `F11` |

## 外观

六套配色：松绿、纸白、墨黑、暖阳、夜蓝、樱粉。

<p><img src="docs/screenshot-welcome.png" width="760" alt="松绿主题首页"></p>

<p><img src="docs/screenshot-theme-sepia.png" width="760" alt="暖阳主题首页"></p>

<p><img src="docs/screenshot-editor.png" width="760" alt="编辑区"></p>

<p><img src="docs/screenshot-settings.png" width="760" alt="设置面板"></p>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=GHaoyun/Markprose&type=Date)](https://www.star-history.com/#GHaoyun/Markprose&Date)

## 许可证

AGPL-3.0
