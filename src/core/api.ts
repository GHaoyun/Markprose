import { basename, dirname, norm } from "./util";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  size?: number;
  mtime?: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let _invoke: (<T>(cmd: string, args?: any) => Promise<T>) | null = null;
async function invoke<T>(cmd: string, args?: any): Promise<T> {
  if (!IS_TAURI) return mockInvoke<T>(cmd, args);
  if (!_invoke) {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke as any;
  }
  const fn = _invoke as <T>(cmd: string, args?: any) => Promise<T>;
  return fn<T>(cmd, args);
}

/* ================= 文件系统 API ================= */

export const readText = (path: string) =>
  invoke<{ content: string; mtime: number; size: number }>("read_text", { path });

export const writeText = (path: string, content: string) =>
  invoke<{ mtime: number }>("write_text", { path, content });

export const listTree = (root: string) => invoke<TreeNode>("list_tree", { root });

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

export const createFile = (path: string) => invoke<void>("create_file", { path });

export const createDir = (path: string) => invoke<void>("create_dir", { path });

export const renamePath = (from: string, to: string) => invoke<void>("rename_path", { from, to });

export const deletePath = (path: string) => invoke<void>("delete_path", { path });

export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });

/** 默认自动保存目录（系统「文档」下的「Markprose」） */
export const defaultSaveDir = () => invoke<string>("default_save_dir");

/** 系统已安装的字体族名列表 */
export const listFonts = () => invoke<string[]>("list_fonts");

/** 启动时命令行带进来的文件（拖到 exe 图标上打开） */
export const startupFiles = () => invoke<string[]>("startup_files");

/** 取走「第二个进程转交过来」的文件（取完即清空） */
export const takePendingFiles = () => invoke<string[]>("take_pending_files");

/** 把当前程序注册进「打开方式」列表 */
export const registerFileAssoc = () => invoke<void>("register_file_assoc");

/** 当前是不是 .md 的默认打开程序 */
export const isDefaultApp = () => invoke<boolean>("is_default_app");

/** 尝试设为默认打开程序，返回 set / blocked */
export const setDefaultApp = () => invoke<string>("set_default_app");

export const searchInFolder = (root: string, query: string, limit = 300) =>
  invoke<SearchHit[]>("search_in_folder", { root, query, limit });

/** 把 base64 图片写到 dir/assets/ 下，返回相对路径 */
export const saveImage = (dir: string, base64: string, ext: string) =>
  invoke<string>("save_image", { dir, base64, ext });

/** 读取本地图片为 data URL（带前端缓存） */
const imgCache = new Map<string, string>();
export async function readImageDataUrl(path: string): Promise<string | null> {
  if (imgCache.has(path)) return imgCache.get(path)!;
  try {
    const url = await invoke<string>("read_image_data_url", { path });
    imgCache.set(path, url);
    return url;
  } catch {
    imgCache.set(path, "");
    return null;
  }
}
export function clearImageCache() {
  imgCache.clear();
}

/* ================= 设置持久化 ================= */

export const loadSettingsRaw = () => invoke<string | null>("load_settings");
export const saveSettingsRaw = (json: string) => invoke<void>("save_settings", { json });

/* ================= 对话框 ================= */

export async function pickFolder(): Promise<string | null> {
  if (!IS_TAURI) {
    const p = window.prompt("输入文件夹路径", "/demo");
    return p || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title: "选择文件夹" });
  return typeof r === "string" ? r : null;
}

export async function pickOpenFile(): Promise<string | null> {
  if (!IS_TAURI) {
    const p = window.prompt("输入文件路径", "/demo/欢迎.md");
    return p || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({
    directory: false,
    multiple: false,
    title: "打开 Markdown 文件",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] },
      { name: "全部文件", extensions: ["*"] },
    ],
  });
  return typeof r === "string" ? r : null;
}

export async function pickImageFile(): Promise<string | null> {
  if (!IS_TAURI) {
    const p = window.prompt("输入图片路径", "/demo/pic.png");
    return p || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({
    directory: false,
    multiple: false,
    title: "选择图片",
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
  });
  return typeof r === "string" ? r : null;
}

export async function pickSaveFile(defaultPath?: string): Promise<string | null> {
  if (!IS_TAURI) {
    const p = window.prompt("保存到", defaultPath || "/demo/未命名.md");
    return p || null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const r = await save({
    title: "另存为",
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  return r || null;
}

export async function askConfirm(msg: string, title = "Markprose"): Promise<boolean> {
  if (!IS_TAURI) return window.confirm(msg);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return await ask(msg, { title, kind: "warning" });
}

export async function showError(msg: string) {
  if (!IS_TAURI) {
    console.error(msg);
    return;
  }
  const { message } = await import("@tauri-apps/plugin-dialog");
  await message(msg, { title: "出错了", kind: "error" });
}

/* ================= 浏览器内的模拟后端 =================
   用于不编译 Rust 时直接跑前端预览 / 调试。 */

const VFS_KEY = "moke.vfs.v1";
type VFS = Record<string, string>;

function vfsLoad(): VFS {
  try {
    const raw = localStorage.getItem(VFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const seed: VFS = {
    "/demo/欢迎使用Markprose.md": `# 欢迎使用Markprose

这是一个**所见即所得**的 Markdown 编辑器。光标所在的地方显示源码，光标一离开就变成排版结果。

## 试试这些

- **粗体**、*斜体*、~~删除线~~、\`行内代码\`
- [链接](https://example.com)
- ==高亮文字==
- 数学公式：$E = mc^2$，行内就能渲染

### 任务清单

- [x] 写一个 Markdown 编辑器
- [x] 让它比 Typora 好看
- [ ] 每天用它写点东西

### 代码

\`\`\`rust
fn main() {
    let greeting = "你好，Markprose";
    println!("{}", greeting);
}
\`\`\`

### 表格

| 功能 | 状态 | 备注 |
| --- | :---: | --- |
| 所见即所得 | 完成 | 光标进入还原源码 |
| 数学公式 | 完成 | KaTeX |
| 流程图 | 完成 | Mermaid |

### 引用

> 写作是把思考变清晰的过程。
> 工具应该消失在文字后面。

---

### 块级公式

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

### 流程图

\`\`\`mermaid
graph LR
  A[想法] --> B(草稿)
  B --> C{满意?}
  C -->|否| B
  C -->|是| D[发布]
\`\`\`
`,
    "/demo/读书笔记/深度工作.md": `# 深度工作

## 核心论点

高质量的知识工作产出 = **时间 × 专注度**。

> 注意力残留（attention residue）：切换任务后，上一件事仍占用认知资源。

## 我的实践

1. 上午 8:00–10:00 断网写作
2. 下午处理沟通类事务
3. 晚上只读不写

| 时段 | 活动 | 干扰源 |
| --- | --- | --- |
| 上午 | 写作 | 无 |
| 下午 | 会议 | 微信 |
| 晚上 | 阅读 | 无 |
`,
    "/demo/读书笔记/如何阅读一本书.md": `# 如何阅读一本书

## 四个层次

1. 基础阅读
2. 检视阅读
3. 分析阅读
4. 主题阅读

**检视阅读**的关键：先看目录、序言、索引，用 15 分钟判断这本书值不值得精读。
`,
    "/demo/随手记.md": `# 随手记

- 买牛奶
- 还书
- 给妈妈打电话

公式备忘：$a^2 + b^2 = c^2$
`,
  };
  localStorage.setItem(VFS_KEY, JSON.stringify(seed));
  return seed;
}

function vfsSave(v: VFS) {
  localStorage.setItem(VFS_KEY, JSON.stringify(v));
}

function mockTree(v: VFS, root: string): TreeNode {
  const rootN = norm(root).replace(/\/+$/, "");
  const node: TreeNode = { name: basename(rootN) || rootN, path: rootN, isDir: true, children: [] };
  const map = new Map<string, TreeNode>();
  map.set(rootN, node);
  const ensure = (dir: string): TreeNode => {
    if (map.has(dir)) return map.get(dir)!;
    const parent = ensure(dirname(dir));
    const n: TreeNode = { name: basename(dir), path: dir, isDir: true, children: [] };
    parent.children!.push(n);
    map.set(dir, n);
    return n;
  };
  for (const p of Object.keys(v)) {
    if (!norm(p).startsWith(rootN + "/")) continue;
    const parent = ensure(dirname(p));
    parent.children!.push({ name: basename(p), path: p, isDir: false, size: v[p].length, mtime: Date.now() });
  }
  const sortRec = (n: TreeNode) => {
    if (!n.children) return;
    n.children.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, "zh")
    );
    n.children.forEach(sortRec);
  };
  sortRec(node);
  return node;
}

async function mockInvoke<T>(cmd: string, args: any): Promise<T> {
  const v = vfsLoad();
  const out = (x: any) => x as T;
  switch (cmd) {
    case "read_text": {
      const p = norm(args.path);
      if (!(p in v)) throw new Error("文件不存在: " + p);
      return out({ content: v[p], mtime: Date.now(), size: v[p].length });
    }
    case "write_text": {
      v[norm(args.path)] = args.content;
      vfsSave(v);
      return out({ mtime: Date.now() });
    }
    case "list_tree":
      return out(mockTree(v, args.root));
    case "path_exists":
      return out(norm(args.path) in v);
    case "create_file":
      v[norm(args.path)] = "";
      vfsSave(v);
      return out(undefined);
    case "create_dir":
      return out(undefined);
    case "rename_path": {
      const from = norm(args.from);
      const to = norm(args.to);
      for (const k of Object.keys(v)) {
        if (k === from) {
          v[to] = v[k];
          delete v[k];
        } else if (k.startsWith(from + "/")) {
          v[to + k.slice(from.length)] = v[k];
          delete v[k];
        }
      }
      vfsSave(v);
      return out(undefined);
    }
    case "delete_path": {
      const p = norm(args.path);
      for (const k of Object.keys(v)) {
        if (k === p || k.startsWith(p + "/")) delete v[k];
      }
      vfsSave(v);
      return out(undefined);
    }
    case "reveal_in_explorer":
      return out(undefined);
    case "search_in_folder": {
      const q = String(args.query || "").toLowerCase();
      const hits: SearchHit[] = [];
      for (const [p, c] of Object.entries(v)) {
        if (!q) continue;
        c.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(q) && hits.length < (args.limit || 300))
            hits.push({ path: p, line: i + 1, text: line });
        });
      }
      return out(hits);
    }
    case "save_image": {
      const name = `image-${Date.now()}.${args.ext || "png"}`;
      return out(`assets/${name}`);
    }
    case "read_image_data_url":
      return out(
        "data:image/svg+xml;utf8," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300"><rect width="100%" height="100%" fill="#e9e2d6"/><text x="50%" y="50%" font-family="sans-serif" font-size="18" fill="#9a8f7d" text-anchor="middle">图片预览（浏览器模式）</text></svg>`
          )
      );
    case "load_settings":
      return out(localStorage.getItem("moke.settings"));
    case "save_settings":
      localStorage.setItem("moke.settings", args.json);
      return out(undefined);
    case "default_save_dir":
      return out("/demo");
    case "startup_files":
      return out(JSON.parse(localStorage.getItem("moke.startup") || "[]"));
    case "take_pending_files": {
      const pending = JSON.parse(localStorage.getItem("moke.pending") || "[]");
      localStorage.removeItem("moke.pending");
      return out(pending);
    }
    case "register_file_assoc":
      return out(undefined);
    case "is_default_app":
      return out(false);
    case "set_default_app":
      return out("blocked");
    case "list_fonts":
      return out([
        "Georgia",
        "Times New Roman",
        "微软雅黑",
        "宋体",
        "楷体",
        "霞鹜文楷",
        "思源宋体",
      ]);
    default:
      throw new Error("未知命令: " + cmd);
  }
}
