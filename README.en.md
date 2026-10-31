<p align="center">
  <img src="docs/icon.png" width="112" alt="Markprose">
</p>

<h1 align="center">Markprose</h1>

<p align="center"><b>English</b> | <a href="README.md">简体中文</a></p>

<p align="center">
  <a href="https://github.com/GHaoyun/Markprose/releases"><img src="https://img.shields.io/github/v/release/GHaoyun/Markprose?color=b4623a&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-6b6b6b" alt="Platform">
  <a href="https://github.com/GHaoyun/Markprose/releases"><img src="https://img.shields.io/github/downloads/GHaoyun/Markprose/total?color=2f7d5b" alt="Downloads"></a>
  <a href="https://github.com/GHaoyun/Markprose/stargazers"><img src="https://img.shields.io/github/stars/GHaoyun/Markprose?color=e2a674" alt="Stars"></a>
  <img src="https://visitor-badge.laobi.icu/badge?page_id=GHaoyun.Markprose" alt="Views">
</p>

A free and open-source Markdown editor for Windows x64, available as an installer and a portable build. Very small and simple, but fully featured.

## Features

Open it and start typing. Formatting marks stay hidden until you move the cursor into them; press `Ctrl+/` to see the raw source.

- Headings, bold, italic, strikethrough, underline, highlight, blockquotes, lists, task lists, code, tables, links, images
- Footnotes, math formulas, Mermaid diagrams
- Tables get their own panel — add and remove rows and columns without typing pipes
- Formulas open in a dialog with live preview; right-click one later to edit it again
- Multiple tabs, file tree, outline, full-text search
- Focus mode, typewriter mode, line numbers, zoom
- Paste or drag images straight into the document
- Export to HTML, print to PDF
- Asks before closing a tab or the window with unsaved changes
- Adjustable font size, line height, content width and typeface
- Can register itself as the default handler for `.md`

## Supported syntax

| Syntax | How to write it |
| --- | --- |
| Headings | `#` to `######`, or text underlined with `===` / `---` |
| Bold / italic | `**bold**`, `*italic*`, `***bold italic***` |
| Strikethrough | `~~text~~` |
| Underline | `<u>text</u>` |
| Highlight | `==text==` |
| Lists | `-` `*` `+`, ordered with `1.`, nest with 2–4 spaces |
| Task lists | `- [ ] todo` / `- [x] done` |
| Blockquotes | `>`, nested with `>>` |
| Code | inline backticks, fenced blocks, four-space indented blocks |
| Links | `[text](url "title")`, `<https://…>`, `[text][id]` |
| Images | `![alt](url "title")`, `<img src="…" width="120">` |
| Tables | pipe-separated, align with `:-` `:-:` `-:` |
| Horizontal rules | `---`, `***`, `___` |
| Escapes | `\*` `\_` `\#` and so on |
| Footnotes | `text[^1]` plus `[^1]: note` |
| Math | `$inline$`, `$$block$$` |
| Diagrams | fenced code block tagged `mermaid` |
| HTML | `<u>` `<mark>` `<kbd>` `<sub>` `<sup>` `<span style>` `<details>` |

## Installation

Installer: run `Markprose_1.1.1_x64-setup.exe`. On first launch it asks where to keep your documents.

Portable: run `Markprose-1.1.1-portable.exe` from any folder.

## Keyboard shortcuts

| Action | Shortcut | Action | Shortcut |
| --- | --- | --- | --- |
| New | `Ctrl+N` | Save | `Ctrl+S` |
| Open file | `Ctrl+O` | Save as | `Ctrl+Shift+S` |
| Open folder | `Ctrl+Shift+O` | Close tab | `Ctrl+W` |
| Bold | `Ctrl+B` | Italic | `Ctrl+I` |
| Strikethrough | `Ctrl+U` | Underline | `Ctrl+Shift+U` |
| Inline code | `Ctrl+E` | Highlight | `Ctrl+Shift+H` |
| Link | `Ctrl+K` | Table | `Ctrl+T` |
| Code block | `Ctrl+Shift+K` | Block math | `Ctrl+Shift+M` |
| Heading 1–6 | `Ctrl+1`…`6` | Paragraph | `Ctrl+0` |
| Find | `Ctrl+F` | Replace | `Ctrl+H` |
| Source mode | `Ctrl+/` | Sidebar | `Ctrl+\` |
| Command palette | `Ctrl+Shift+P` | Settings | `Ctrl+,` |
| Move line up / down | `Alt+↑` / `Alt+↓` | Full screen | `F11` |

## Appearance

Six colour themes: Pine, Paper, Ink, Sepia, Midnight, Sakura.

<p><img src="docs/screenshot-welcome.png" width="760" alt="Pine theme, welcome screen"></p>

<p><img src="docs/screenshot-theme-sepia.png" width="760" alt="Sepia theme, welcome screen"></p>

<p><img src="docs/screenshot-editor.png" width="760" alt="Editor"></p>

<p><img src="docs/screenshot-settings.png" width="760" alt="Settings panel"></p>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=GHaoyun/Markprose&type=Date)](https://www.star-history.com/#GHaoyun/Markprose&Date)

## License

AGPL-3.0
