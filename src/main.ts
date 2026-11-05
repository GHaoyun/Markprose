import "./styles/tokens.css";
import "./styles/chrome.css";
import "./styles/editor.css";
import "./styles/toolbar.css";
import "./styles/editor2.css";
import "./styles/v2.css";
import "./styles/table-panel.css";
import "katex/dist/katex.min.css";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { moveLineDown, moveLineUp, redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";

import { $, $$, ctxMenu, h, hideCtx, icon, toast } from "./ui/dom";
import {
  IS_TAURI,
  createFile,
  defaultSaveDir,
  deletePath,
  listFonts,
  listTree,
  pathExists,
  pickFolder,
  pickImageFile,
  pickOpenFile,
  pickSaveFile,
  readImageDataUrl,
  readText,
  renamePath,
  revealInExplorer,
  saveImage,
  isDefaultApp,
  registerFileAssoc,
  searchInFolder,
  setDefaultApp,
  startupFiles,
  writeText,
  type SearchHit,
  type TreeNode,
} from "./core/api";
import { basename, countWords, debounce, dirname, extname, norm, stripExt } from "./core/util";
import {
  DEFAULT_SETTINGS,
  THEMES,
  applySettings,
  cycleTheme,
  loadSettings,
  persistSettings,
  settings,
  setTheme,
} from "./core/settings";
import {
  CODE_SNIPPET,
  MERMAID_SNIPPET,
  TABLE_SNIPPET,
  cmdBold,
  cmdCode,
  cmdCodeBlock,
  cmdHeading,
  cmdHr,
  cmdItalic,
  cmdLink,
  cmdList,
  cmdMark,
  cmdUnderline,
  cmdMath,
  cmdQuote,
  cmdStrike,
  cmdToc,
  createState,
  editorHooks,
  findNodeAt,
  insertSnippet,
  setLineNumbers,
  sourceComp,
} from "./editor/setup";
import { buildToolbar, syncToolbar, type ToolbarState } from "./ui/toolbar";
import { alertBox, askRestoreBox, choiceBox, confirmBox, folderSetupBox, mathBox, promptBox, saveChangesBox } from "./ui/dialog";
import { closeTablePanel } from "./ui/tablePanel";
import { livePreview, mathHooks, refreshEffect } from "./editor/livepreview";
import { docCtx } from "./editor/ctx";
import { buildExportHtml } from "./markdown/export";

/* ================= 状态 ================= */
interface Tab {
  id: string;
  path: string | null;
  state: EditorState;
  dirty: boolean;
  savedAt: number;
  savedText: string;
  scrollTop: number;
}

const app = {
  tabs: [] as Tab[],
  activeId: null as string | null,
  workspace: null as string | null,
  tree: null as TreeNode | null,
  untitledSeq: 0,
};

let view: EditorView;

const activeTab = () => app.tabs.find((t) => t.id === app.activeId) || null;
const uid = () => Math.random().toString(36).slice(2, 10);

/* ================= 编辑器 ================= */
function mountEditor() {
  view = new EditorView({
    parent: $("#editor-host"),
    state: createState("", null),
  });
  editorHooks.onChange = (u) => {    const t = activeTab();
    if (!t) return;
    t.state = u.state;
    if (u.docChanged) {
      t.dirty = true;
      scheduleAutosave();
      refreshTabDirty();
    }
    refreshStatus();
    if (u.docChanged) scheduleOutline();
    scheduleBubble();
    if (u.selectionSet || u.docChanged) scheduleToolbarSync();
    if (settings.typewriter && u.selectionSet) typewriter();
    scheduleSessionSave();
  };
  view.dom.addEventListener("dragover", (e) => e.preventDefault());
  view.scrollDOM.addEventListener("scroll", () => scheduleSessionSave(), { passive: true });
  editorHooks.onContextMenu = (x, y) => showEditorMenu(x, y);
  mathHooks.onEdit = (tex, block, from, to) => void editMathAt(tex, block, from, to);
}

function typewriter() {
  const head = view.state.selection.main.head;
  const co = view.coordsAtPos(head);
  if (!co) return;
  const box = view.scrollDOM.getBoundingClientRect();
  const target = co.top - box.top - box.height * 0.42;
  view.scrollDOM.scrollTop += target;
}

/* ================= Tab 管理 ================= */
function syncCurrent() {
  const t = activeTab();
  if (!t) return;
  t.state = view.state;
  t.scrollTop = view.scrollDOM.scrollTop;
}

function renderTabs() {
  const host = $("#tabs");
  host.innerHTML = "";
  for (const t of app.tabs) {
    const title = t.path ? basename(t.path) : `未命名 ${t.id.slice(0, 3)}`;
    const el = h(
      "div",
      {
        class:
          "tab" +
          (t.id === app.activeId ? " active" : "") +
          (t.dirty ? " dirty" : ""),
        "data-id": t.id,
        title: t.path || title,
        onmousedown: (e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(t.id);
          } else if (e.button === 0) activate(t.id);
        },
      },
      h("span", { class: "tname", text: title }),
      h("span", { class: "tdot" }),
      h("span", {
        class: "tclose",
        html: '<svg viewBox="0 0 10 10" width="9" height="9"><line x1="2.5" y1="2.5" x2="7.5" y2="7.5"/><line x1="7.5" y1="2.5" x2="2.5" y2="7.5"/></svg>',
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          closeTab(t.id);
        },
      })
    );
    host.appendChild(el);
  }
  // 常驻的新建按钮：标签多到横向滚动时也钉在右边
  host.appendChild(
    h("button", {
      class: "tab-add",
      title: "新建文档 (Ctrl+N)",
      text: "+",
      onmousedown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        newTab();
      },
    })
  );
}

const refreshTabs = renderTabs;

/** 只更新脏标记，绝不重建标签栏（重建会导致每敲一个字都抖一下） */
function refreshTabDirty() {
  const t = activeTab();
  if (!t) return;
  const el = document.querySelector<HTMLElement>(`.tab[data-id="${t.id}"]`);
  if (el) el.classList.toggle("dirty", t.dirty);
}

/** 欢迎页只由「有没有打开的标签」决定，避免各处手工开关导致状态打架 */
function syncWelcome() {
  const el = $("#welcome");
  if (!el) return;
  el.classList.toggle("hidden", app.tabs.length > 0);
}

function activate(id: string) {
  if (app.activeId === id) {
    syncWelcome();
    return;
  }
  syncCurrent();
  app.activeId = id;
  const t = activeTab();
  if (!t) return;
  docCtx.path = t.path;
  docCtx.dir = t.path ? dirname(t.path) : "";
  view.setState(t.state);
  // CodeMirror 换 state 后要等一次布局测量才能滚，两帧后恢复上次的位置
  const back = t.scrollTop || 0;
  if (back > 0) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (app.activeId === id) view.scrollDOM.scrollTop = back;
      })
    );
  }
  view.focus();
  syncWelcome();
  const host = $("#editor-host");
  host.classList.remove("fade-in");
  void host.offsetWidth;
  host.classList.add("fade-in");
  renderTabs();
  refreshStatus();
  refreshOutline();
  renderTree();
  updateTitlebar();
  setTimeout(syncToolbarNow, 30);
  saveSession();
}

function newTab(content = "", path: string | null = null) {
  syncCurrent();
  const t: Tab = {
    id: uid(),
    path,
    state: createState(content, path),
    dirty: false,
    savedAt: Date.now(),
    savedText: content,
    scrollTop: 0,
  };
  app.tabs.push(t);
  app.activeId = t.id;
  docCtx.path = path;
  docCtx.dir = path ? dirname(path) : "";
  view.setState(t.state);
  view.focus();
  syncWelcome();
  const host = $("#editor-host");
  host.classList.remove("doc-in");
  void host.offsetWidth;
  host.classList.add("doc-in");
  renderTabs();
  refreshStatus();
  refreshOutline();
  updateTitlebar();
  saveSession();
  return t;
}

async function openPath(path: string, silent = false) {
  const exist = app.tabs.find((t) => t.path && norm(t.path) === norm(path));
  if (exist) return activate(exist.id);
  try {
    const r = await readText(path);
    const t = newTab(r.content, path);
    t.savedAt = r.mtime;
    if (!silent) {
      toast(`已打开 ${basename(path)}`);
      // 打开文件后自动切到设置里指定的侧栏
      switchPanel(settings.openPanel);
    }
  } catch (e: any) {
    if (!silent) toast("打开失败：" + (e?.message || e), "err");
  }
}

/* ---------- 会话恢复：标签、光标、滚动位置、未保存草稿 ---------- */
let restoringSession = false;
let draftsDiscarded = false;
let sessionTimer: number | undefined;

/** off / ask / auto；旧配置没这个字段时按 off 处理 */
function sessionEnabled() {
  return (settings.sessionMode || "off") !== "off";
}

function clearSessionData() {
  settings.sessionTabs = [];
  settings.sessionActive = null;
  settings.sessionState = {};
  settings.sessionDrafts = [];
  persistSettings();
}

function saveSession() {
  if (restoringSession) return;
  const onFiles = sessionEnabled();
  const onDrafts = onFiles;
  const paths = onFiles ? app.tabs.filter((t) => t.path).map((t) => t.path as string) : [];
  const act = onFiles ? app.tabs.find((t) => t.id === app.activeId) : undefined;
  const active = onFiles ? act?.path || null : null;

  const nextState: Record<string, { anchor: number; head: number; scrollTop: number }> = {};
  const nextDrafts: { content: string; anchor: number; head: number; scrollTop: number }[] = [];
  if ((onFiles || onDrafts) && !draftsDiscarded) {
    for (const t of app.tabs) {
      const sel = t.state.selection.main;
      const scrollTop = Math.round(
        t.id === app.activeId ? view.scrollDOM.scrollTop : t.scrollTop || 0
      );
      if (t.path) {
        if (onFiles) nextState[norm(t.path)] = { anchor: sel.anchor, head: sel.head, scrollTop };
      } else {
        if (!onDrafts) continue;
        const text = t.state.doc.toString();
        // 空草稿不存；单个最多 200KB、总数最多 20 个，别把配置撑爆
        if (!text || nextDrafts.length >= 20) continue;
        nextDrafts.push({
          content: text.slice(0, 200_000),
          anchor: sel.anchor,
          head: sel.head,
          scrollTop,
        });
      }
    }
  }

  const oldState = settings.sessionState || {};
  const oldDrafts = settings.sessionDrafts || [];
  if (
    JSON.stringify(nextState) === JSON.stringify(oldState) &&
    JSON.stringify(nextDrafts) === JSON.stringify(oldDrafts) &&
    paths.length === settings.sessionTabs.length &&
    paths.every((p, i) => p === settings.sessionTabs[i]) &&
    active === settings.sessionActive
  ) {
    return;
  }
  settings.sessionTabs = paths;
  settings.sessionActive = active;
  settings.sessionState = nextState;
  settings.sessionDrafts = nextDrafts;
  persistSettings();
}

/** 光标移动 / 打字 / 滚动时低频写盘，避免每帧都存 */
function scheduleSessionSave() {
  if (!sessionEnabled() || restoringSession) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => saveSession(), 600);
}

async function restoreSession() {
  if (!sessionEnabled()) return;
  const paths = (settings.sessionTabs || []).filter(Boolean);
  const drafts = settings.sessionDrafts || [];
  if (!paths.length && !drafts.length) return;
  restoringSession = true;
  try {
    const saved = settings.sessionState || {};
    for (const p of paths) {
      try {
        await openPath(p, true);
        const t = activeTab();
        const st = saved[norm(p)];
        if (t && st) {
          const len = t.state.doc.length;
          const clamp = (n: number) => Math.max(0, Math.min(n, len));
          view.dispatch({ selection: { anchor: clamp(st.anchor), head: clamp(st.head) } });
          t.state = view.state;
          t.scrollTop = st.scrollTop;
        }
      } catch {}
    }

    // 没有路径的「未命名」标签：内容原样还原，仍然标成未保存
    for (const d of drafts) {
      const t = newTab(d.content);
      t.dirty = true;
      const len = t.state.doc.length;
      const clamp = (n: number) => Math.max(0, Math.min(n, len));
      view.dispatch({ selection: { anchor: clamp(d.anchor), head: clamp(d.head) } });
      t.state = view.state;
      t.scrollTop = d.scrollTop;
    }

    const act = settings.sessionActive;
    if (act) {
      const t = app.tabs.find((x) => x.path && norm(x.path) === norm(act));
      if (t) {
        activate(t.id);
        // 激活的正好是当前标签时 activate 会提前返回，这里兜底滚一次
        const back = t.scrollTop || 0;
        if (back > 0) {
          window.setTimeout(() => {
            if (app.activeId === t.id) view.scrollDOM.scrollTop = back;
          }, 150);
        }
      }
    }
    // 草稿保持 dirty，只有落盘的文件才算已保存
    for (const t of app.tabs) if (t.path) t.dirty = false;
    renderTabs();
    updateTitlebar();
  } finally {
    restoringSession = false;
  }
  // 有文件已经被删掉的话，把失效路径从会话里清掉
  saveSession();
}

/** 「每次询问」模式的开场动画：M 图标淡入 + 一条铜线展开 */
function playBootSplash(): Promise<void> {
  return new Promise((resolve) => {
    const splash = h(
      "div",
      { class: "boot-splash" },
      h(
        "div",
        { class: "boot-inner" },
        h("div", { class: "boot-mark", text: "M" }),
        h("div", { class: "boot-rule" })
      )
    );
    document.body.appendChild(splash);
    window.setTimeout(() => {
      splash.remove();
      resolve();
    }, 900);
  });
}

async function maybeRestoreSession() {
  const mode = settings.sessionMode || "off";
  const fileCount = (settings.sessionTabs || []).filter(Boolean).length;
  const draftCount = (settings.sessionDrafts || []).length;
  if (mode === "off" || (!fileCount && !draftCount)) {
    if (mode === "off") clearSessionData();
    return;
  }
  if (mode === "ask") {
    await playBootSplash();
    const ok = await askRestoreBox({ fileCount, draftCount, seconds: 5 });
    // 这次不打开：数据留着，下次启动再问一遍
    if (!ok) return;
  }
  await restoreSession();
}

async function closeTab(id: string) {
  const idx = app.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const t = app.tabs[idx];
  if (t.dirty) {
    const choice = await saveChangesBox({ name: t.path ? basename(t.path) : "未命名" });
    if (choice === "cancel") return;
    if (choice === "save") {
      if (app.activeId !== id) activate(id);
      const saved = await saveTab(false, true);
      if (!saved) return;
    }
  }
  app.tabs.splice(idx, 1);
  if (app.activeId === id) {
    const next = app.tabs[Math.max(0, idx - 1)];
    if (next) {
      app.activeId = null;
      activate(next.id);
    } else {
      app.activeId = null;
      view.setState(createState("", null));
      syncWelcome();
      renderTabs();
      refreshStatus();
      refreshOutline();
      updateTitlebar();
    }
  } else {
    renderTabs();
  }
  saveSession();
}

/* ================= 保存 ================= */
let autosaveTimer: number | undefined;
function scheduleAutosave() {
  if (!settings.autosave) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    const t = activeTab();
    if (t && t.dirty && t.path) void saveTab(false, true);
  }, 1600);
}

async function saveTab(saveAs = false, silent = false) {
  const t = activeTab();
  if (!t) return false;
  let path = t.path;
  if (!path || saveAs) {
    path = await pickSaveFile(
      t.path || (app.workspace ? norm(app.workspace) + "/未命名.md" : "未命名.md")
    );
    if (!path) return false;
    if (!/\.(md|markdown|txt)$/i.test(path)) path += ".md";
  }
  const content = view.state.doc.toString();
  try {
    const r = await writeText(path, content);
    t.path = path;
    t.dirty = false;
    t.savedAt = r.mtime;
    t.savedText = content;
    docCtx.path = path;
    docCtx.dir = dirname(path);
    renderTabs();
    updateTitlebar();
    refreshOutline();
    saveSession();
    if (!silent) toast("已保存 " + basename(path));
    if (app.workspace && norm(path).startsWith(norm(app.workspace))) void reloadTree();
    return true;
  } catch (e: any) {
    toast("保存失败：" + (e?.message || e), "err");
    return false;
  }
}

/* ================= 标题栏 / 状态栏 ================= */
function updateTitlebar() {
  const t = activeTab();
  const el = $("#tb-doc");
  if (!t) {
    el.innerHTML = "";
    document.title = "Markprose";
    return;
  }
  const name = t.path ? basename(t.path) : "未命名";
  el.innerHTML = (t.dirty ? '<span class="dot"></span>' : "") + name;
  document.title = `${name} — Markprose`;
}

function refreshStatus() {
  const doc = view.state.doc;
  const text = doc.toString();
  const words = countWords(text);
  $("#st-words").textContent = `${words} 字`;
  $("#st-lines").textContent = `${doc.lines} 行`;
  $("#st-read").textContent = `${Math.max(1, Math.round(words / 400))} 分钟`;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head);
  $("#st-cursor").textContent = `行 ${line.number}, 列 ${head - line.from + 1}`;
  const t = activeTab();
  $("#st-file").textContent = t?.path ? norm(t.path) : t ? "未命名文档" : "就绪";
  $("#st-mode").textContent = settings.sourceMode ? "源码" : "实时预览";
}

/* ================= 大纲 ================= */
let outlineTimer: number | undefined;
function scheduleOutline() {
  if (outlineTimer) clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(refreshOutline, 260);
}

function refreshOutline() {
  const host = $("#outline");
  if (!host) return;
  const doc = view.state.doc;
  const items: { level: number; text: string; pos: number }[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const m = /^(#{1,6})\s+(.*)$/.exec(line.text);
    if (m) items.push({ level: m[1].length, text: m[2].trim(), pos: line.from });
  }
  host.innerHTML = "";
  if (!items.length) {
    host.innerHTML = '<div class="ol-empty">此文档暂无大纲</div>';
    return;
  }
  for (const it of items) {
    const b = h("button", {
      class: "ol-item",
      "data-pos": String(it.pos),
      text: it.text || "（空标题）",
      style: { paddingLeft: 8 + (it.level - 1) * 12 + "px" },
      onclick: () => {
        view.dispatch({
          selection: { anchor: it.pos },
          effects: EditorView.scrollIntoView(it.pos, { y: "start", yMargin: 60 }),
        });
        view.focus();
      },
    });
    host.appendChild(b);
  }
  syncOutlineHighlight();
}

function syncOutlineHighlight() {
  const head = view.state.selection.main.head;
  const items = $$(".ol-item");
  let best = -1;
  items.forEach((el, i) => {
    const pos = parseInt((el as any).dataset.pos || "0", 10);
    if (pos <= head) best = i;
  });
  items.forEach((el, i) => el.classList.toggle("current", i === best));
}

/* ================= 文件树 ================= */
async function reloadTree() {
  if (!app.workspace) return;
  try {
    app.tree = await listTree(app.workspace);
  } catch (e: any) {
    toast("读取文件夹失败：" + (e?.message || e), "err");
    app.tree = null;
  }
  renderTree();
}

const openDirs = new Set<string>();

function renderTree() {
  const host = $("#tree");
  if (!host) return;
  host.innerHTML = "";
  if (!app.tree) {
    host.innerHTML =
      '<div class="tree-empty">尚未打开文件夹</div>';
    return;
  }
  const activePath = activeTab()?.path ? norm(activeTab()!.path!) : null;

  const renderNode = (node: TreeNode, depth: number): HTMLElement => {
    const isOpen = openDirs.has(node.path);
    const row = h("div", {
      class:
        "node" +
        (!node.isDir && activePath === norm(node.path) ? " active" : ""),
      style: { paddingLeft: 6 + depth * 13 + "px" },
      title: node.path,
      onmousedown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (node.isDir) {
          if (isOpen) openDirs.delete(node.path);
          else openDirs.add(node.path);
          renderTree();
        } else {
          void openPath(node.path);
        }
      },
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        const dir = node.isDir ? node.path : dirname(node.path);
        ctxMenu(e.clientX, e.clientY, [
          ...(node.isDir
            ? [
                {
                  label: "在此新建文件",
                  onClick: async () => {
                    const name = await promptBox({
                      title: "新建文件",
                      message: "文件名",
                      value: "新文档.md",
                    });
                    if (!name) return;
                    await createFile(norm(dir) + "/" + name);
                    await reloadTree();
                  },
                },
              ]
            : []),
          { label: "重命名", onClick: async () => {
              const name = await promptBox({
                title: "重命名",
                message: "新名称",
                value: node.name,
              });
              if (!name || name === node.name) return;
              await renamePath(node.path, norm(dir) + "/" + name);
              await reloadTree();
              const t = app.tabs.find((x) => x.path && norm(x.path) === norm(node.path));
              if (t) t.path = norm(dir) + "/" + name;
              renderTabs();
            } },
          { label: "在资源管理器中显示", onClick: () => revealInExplorer(node.path) },
          { sep: true, label: "" },
          {
            label: "删除",
            danger: true,
            onClick: async () => {
              const ok = await confirmBox({
                title: "删除文件",
                message: `确定删除「${node.name}」？\n此操作不可撤销。`,
                okText: "删除",
                danger: true,
              });
              if (!ok) return;
              await deletePath(node.path);
              await reloadTree();
            },
          },
        ]);
      },
    });
    if (node.isDir) {
      const caret = h("span", { class: "caret" + (isOpen ? " open" : "") });
      caret.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 4l4 4-4 4"/></svg>';
      row.appendChild(caret);
      row.appendChild(icon(isOpen ? "folderOpen" : "folder", 13));
    } else {
      row.appendChild(h("span", { class: "caret" }));
      row.appendChild(icon("md", 13));
    }
    row.appendChild(h("span", { class: "nm", text: node.name }));
    const wrap = h("div", null, row);
    if (node.isDir && isOpen && node.children?.length) {
      const kids = h("div", { class: "tree-children" });
      for (const c of node.children) kids.appendChild(renderNode(c, depth + 1));
      wrap.appendChild(kids);
    }
    return wrap;
  };

  const root = app.tree;
  if (root.children?.length) {
    for (const c of root.children) host.appendChild(renderNode(c, 0));
  } else {
    host.innerHTML = '<div class="tree-empty">文件夹为空</div>';
  }
}

async function openWorkspace(dir: string) {
  app.workspace = dir;
  settings.lastFolder = dir;
  persistSettings();
  openDirs.add(norm(dir));
  await reloadTree();
  switchPanel("files");
}

/* ================= 搜索 ================= */
const runSearch = debounce(async (q: string) => {
  const host = $("#search-results");
  if (!host) return;
  if (!q.trim()) {
    host.innerHTML = "";
    return;
  }
  if (!app.workspace) {
    host.innerHTML = '<div class="ol-empty">请先打开文件夹</div>';
    return;
  }
  host.innerHTML = '<div class="ol-empty">搜索中…</div>';
  try {
    const hits = await searchInFolder(app.workspace, q, 300);
    host.innerHTML = "";
    if (!hits.length) {
      host.innerHTML = '<div class="ol-empty">没有找到匹配内容</div>';
      return;
    }
    let lastFile = "";
    for (const hit of hits) {
      if (hit.path !== lastFile) {
        lastFile = hit.path;
        host.appendChild(
          h(
            "div",
            { class: "sr-file", title: hit.path },
            h("span", { text: basename(hit.path) }),
            h("span", { class: "p", text: dirname(hit.path) })
          )
        );
      }
      const ql = q.toLowerCase();
      const idx = hit.text.toLowerCase().indexOf(ql);
      const pre = hit.text.slice(0, Math.max(0, idx - 24));
      const mid = hit.text.slice(idx, idx + q.length);
      const post = hit.text.slice(idx + q.length, idx + q.length + 70);
      const lineEl = h("div", {
        class: "sr-line",
        onclick: () => openHit(hit),
      });
      lineEl.appendChild(h("span", { class: "no", text: String(hit.line) }));
      const tx = h("span", { class: "tx" });
      tx.append(document.createTextNode((pre ? "…" : "") + pre));
      tx.appendChild(h("mark", { text: mid }));
      tx.append(document.createTextNode(post));
      lineEl.appendChild(tx);
      host.appendChild(lineEl);
    }
  } catch (e: any) {
    host.innerHTML = `<div class="ol-empty">搜索失败：${e?.message || e}</div>`;
  }
}, 320);

async function openHit(hit: SearchHit) {
  await openPath(hit.path);
  const doc = view.state.doc;
  const line = doc.line(Math.min(hit.line, doc.lines));
  const pos = Math.min(line.from + Math.max(0, hit.text.indexOf(hit.text.trim())), line.to);
  view.dispatch({
    selection: { anchor: line.from, head: Math.min(line.to, line.from + hit.text.length) },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  view.focus();
}

/* ================= 侧栏切换 ================= */
function switchPanel(name: string) {
  $$(".sb-tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  $$(".sb-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  if (name === "outline") refreshOutline();
  if (name === "files") renderTree();
}

/* ================= 命令面板 ================= */
interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function commands(): Cmd[] {
  const c: Cmd[] = [
    { id: "new", label: "新建文档", hint: "Ctrl N", run: () => newTab() },
    { id: "open", label: "打开文件…", hint: "Ctrl O", run: () => void openFileDialog() },
    { id: "folder", label: "打开文件夹…", hint: "Ctrl Shift O", run: () => void openFolderDialog() },
    { id: "save", label: "保存", hint: "Ctrl S", run: () => void saveTab() },
    { id: "saveas", label: "另存为…", hint: "Ctrl Shift S", run: () => void saveTab(true) },
    { id: "close", label: "关闭当前标签", hint: "Ctrl W", run: () => app.activeId && closeTab(app.activeId) },
    { id: "src", label: "切换源码 / 预览模式", hint: "Ctrl /", run: toggleSource },
    { id: "focus", label: "专注模式", run: () => toggleSetting("focusMode") },
    { id: "typewriter", label: "打字机模式", run: () => toggleSetting("typewriter") },
    { id: "autosave", label: "自动保存", run: () => toggleSetting("autosave") },
    { id: "lines", label: "显示行号", run: () => toggleSetting("lineNumbers") },
    { id: "theme", label: "切换主题", hint: "", run: cycleTheme },
    { id: "settings", label: "打开设置", hint: "Ctrl ,", run: () => openSettings() },
    { id: "find", label: "查找", hint: "Ctrl F", run: () => openSearchPanel(view) },
    { id: "replace", label: "查找并替换", hint: "Ctrl H", run: () => openSearchPanel(view) },
    { id: "table", label: "插入表格", hint: "Ctrl T", run: () => insertSnippet(view, TABLE_SNIPPET) },
    { id: "code", label: "插入代码块", hint: "Ctrl Shift K", run: () => insertSnippet(view, CODE_SNIPPET) },
    { id: "math", label: "插入公式", run: () => void insertMathDialog() },
    { id: "mermaid", label: "插入流程图", run: () => insertSnippet(view, MERMAID_SNIPPET) },
    { id: "hr", label: "插入分隔线", run: () => insertSnippet(view, "\n---\n") },
    { id: "html", label: "导出 HTML…", run: () => void exportHtml() },
    { id: "pdf", label: "打印 / 导出 PDF…", run: () => void exportPdf() },
    { id: "copyhtml", label: "复制为 HTML", run: () => void copyHtml() },
    { id: "reveal", label: "在资源管理器中显示当前文件", run: () => {
        const p = activeTab()?.path;
        if (p) revealInExplorer(p);
      } },
    { id: "reload", label: "重新加载当前文件", run: () => void reloadCurrent() },
  ];
  return c;
}

let paletteSel = 0;
let paletteItems: Cmd[] = [];

function openPalette() {
  const ov = $("#palette");
  ov.classList.add("show");
  const input = $("#palette-input") as HTMLInputElement;
  input.value = "";
  paletteSel = 0;
  filterPalette("");
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  $("#palette").classList.remove("show");
}

function filterPalette(q: string) {
  const all = commands();
  const lq = q.trim().toLowerCase();
  paletteItems = lq
    ? all.filter((c) => c.label.toLowerCase().includes(lq) || c.id.includes(lq))
    : all;
  if (paletteSel >= paletteItems.length) paletteSel = 0;
  const list = $("#palette-list")!;
  list.innerHTML = "";
  paletteItems.forEach((c, i) => {
    const el = h(
      "div",
      {
        class: "pitem" + (i === paletteSel ? " sel" : ""),
        onmouseenter: () => {
          paletteSel = i;
          $$(".pitem").forEach((e, k) => e.classList.toggle("sel", k === i));
        },
        onclick: () => {
          closePalette();
          c.run();
        },
      },
      h("span", { class: "pico", html: '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M3 8h10M9 4l4 4-4 4"/></svg>' }),
      h("span", { text: c.label }),
      c.hint ? h("span", { class: "k", text: c.hint }) : null
    );
    list.appendChild(el);
  });
}

/* ================= 设置面板 ================= */
function openSettings() {
  const body = $("#settings-body")!;
  body.innerHTML = "";

  const themeRow = h("div", { class: "set-row", style: { flexDirection: "column", alignItems: "stretch", gap: "10px" } });
  themeRow.appendChild(
    h("div", { class: "set-label" }, h("div", { class: "t", text: "主题" }))
  );
  const grid = h("div", { class: "theme-grid" });
  for (const t of THEMES) {
    const card = h("div", {
      class: "theme-card" + (settings.theme === t.id ? " on" : ""),
      onclick: () => {
        setTheme(t.id);
        openSettings();
        view.dispatch({ effects: refreshEffect.of(Date.now()) });
      },
    });
    const sw = h("div", { class: "sw" });
    for (const c of t.sw) sw.appendChild(h("i", { style: { background: c } }));
    card.appendChild(sw);
    card.appendChild(h("div", { class: "tn", text: t.name }));
    grid.appendChild(card);
  }
  themeRow.appendChild(grid);
  body.appendChild(themeRow);

  const slider = (
    label: string,
    desc: string,
    key: "fontSize" | "lineHeight" | "contentWidth",
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string
  ) => {
    const row = h("div", { class: "set-row" });
    row.appendChild(h("div", { class: "set-label" }, h("div", { class: "t", text: label }), h("div", { class: "d", text: desc })));
    const val = h("span", { text: fmt(settings[key]), style: { fontSize: "11px", color: "var(--text-faint)", minWidth: "44px", textAlign: "right" } });
    const inp = h("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(settings[key]),
      oninput: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        (settings as any)[key] = v;
        val.textContent = fmt(v);
        applySettings();
        persistSettings();
      },
    });
    row.appendChild(h("div", { class: "set-ctl" }, inp, val));
    body.appendChild(row);
  };

  slider("正文字号", "编辑区文字大小", "fontSize", 13, 24, 0.5, (v) => v + "px");
  slider("行高", "行间距，越大越松散", "lineHeight", 1.4, 2.4, 0.02, (v) => v.toFixed(2));
  slider("内容宽度", "正文栏的最大宽度", "contentWidth", 560, 1100, 10, (v) => v + "px");

  const fontRow = h("div", {
    class: "set-row",
    style: { flexDirection: "column", alignItems: "stretch", gap: "9px" },
  });
  fontRow.appendChild(
    h(
      "div",
      { class: "set-label" },
      h("div", { class: "t", text: "正文字体" }),
      h("div", {
        class: "d",
        text: "系统已安装的字体",
      })
    )
  );

  let allFonts: string[] | null = null;
  const fontName = h("span", { class: "fp-name" });
  const fontSample = h("span", { class: "fp-sample", text: "Aa 永" });
  const fontCaret = h("span", { class: "fp-caret" });
  const fontTrigger = h("button", { class: "font-pick", type: "button" });
  fontTrigger.append(fontName, fontSample, fontCaret);

  const fontSearch = h("input", {
    class: "font-search",
    placeholder: "搜索字体名称…",
  }) as HTMLInputElement;
  const fontList = h("div", { class: "font-list" });
  const fontPanel = h("div", { class: "font-panel" });
  fontPanel.append(fontSearch, fontList);

  const famOf = (f: string) => (f ? `"${f}"` : "");
  const syncFontTrigger = () => {
    const f = settings.fontFamily || "";
    fontName.textContent = f || "系统默认";
    fontName.style.fontFamily = famOf(f);
    fontSample.style.fontFamily = famOf(f);
  };
  const closeFontPanel = () => {
    fontPanel.classList.remove("open");
    fontTrigger.classList.remove("open");
  };
  const renderFontList = () => {
    const q = fontSearch.value.trim().toLowerCase();
    fontList.replaceChildren();
    const mk = (label: string, value: string) => {
      const item = h("button", {
        class: "font-item" + ((settings.fontFamily || "") === value ? " on" : ""),
        type: "button",
        onclick: () => {
          settings.fontFamily = value;
          syncFontTrigger();
          applySettings();
          persistSettings();
          renderFontList();
          closeFontPanel();
        },
      });
      const n = h("span", { class: "fi-name", text: label });
      const s = h("span", { class: "fi-sample", text: "Aa 永 123" });
      n.style.fontFamily = famOf(value);
      s.style.fontFamily = famOf(value);
      item.append(n, s);
      fontList.appendChild(item);
    };
    if (!q || "系统默认".includes(q)) mk("系统默认", "");
    for (const f of allFonts || []) {
      if (q && !f.toLowerCase().includes(q)) continue;
      mk(f, f);
    }
    if (!fontList.children.length) {
      fontList.appendChild(h("div", { class: "font-empty", text: "没有匹配的字体" }));
    }
  };
  const FALLBACK_FONTS = [
    "微软雅黑",
    "宋体",
    "黑体",
    "楷体",
    "仿宋",
    "等线",
    "思源宋体",
    "霞鹜文楷",
    "Segoe UI",
    "Arial",
    "Calibri",
    "Cambria",
    "Consolas",
    "Georgia",
    "Times New Roman",
    "Verdana",
  ];
  fontTrigger.addEventListener("click", async () => {
    const open = !fontPanel.classList.contains("open");
    fontPanel.classList.toggle("open", open);
    fontTrigger.classList.toggle("open", open);
    if (!open) return;
    if (allFonts === null) {
      fontList.replaceChildren(h("div", { class: "font-empty", text: "正在读取系统字体…" }));
      try {
        allFonts = await listFonts();
      } catch {
        allFonts = [];
      }
      // 读不到系统字体时退回一份常用字体，避免列表空着
      if (!allFonts.length) allFonts = FALLBACK_FONTS;
    }
    fontSearch.value = "";
    renderFontList();
    fontSearch.focus();
  });
  syncFontTrigger();
  fontRow.append(fontTrigger, fontPanel);
  body.appendChild(fontRow);

  // 自动保存位置
  const dirRow = h("div", {
    class: "set-row",
    style: { flexDirection: "column", alignItems: "stretch", gap: "9px" },
  });
  dirRow.appendChild(
    h(
      "div",
      { class: "set-label" },
      h("div", { class: "t", text: "自动保存位置" }),
      h("div", {
        class: "d",
        text: "新文档和图片存放位置",
      })
    )
  );
  const dirVal = h("div", {
    class: "dir-val",
    text: settings.saveDir || "（默认：文档\\Markprose）",
  });
  dirRow.appendChild(dirVal);
  dirRow.appendChild(
    h(
      "div",
      { style: { display: "flex", gap: "6px" } },
      h("button", {
        class: "mini-btn",
        text: "选择文件夹…",
        onclick: async () => {
          const d = await pickFolder();
          if (!d) return;
          settings.saveDir = norm(d);
          dirVal.textContent = settings.saveDir;
          persistSettings();
        },
      }),
      h("button", {
        class: "mini-btn",
        text: "重置",
        onclick: () => {
          settings.saveDir = "";
          dirVal.textContent = "（默认：文档\\Markprose）";
          persistSettings();
        },
      })
    )
  );
  body.appendChild(dirRow);

  const toggle = (label: string, desc: string, key: "autosave" | "typewriter" | "focusMode" | "lineNumbers" | "sidebar") => {
    const row = h("div", { class: "set-row" });
    row.appendChild(h("div", { class: "set-label" }, h("div", { class: "t", text: label }), h("div", { class: "d", text: desc })));
    const sw = h("div", {
      class: "switch" + (settings[key] ? " on" : ""),
      onclick: () => {
        (settings as any)[key] = !settings[key];
        sw.classList.toggle("on", !!(settings as any)[key]);
        // 关掉会话恢复时，顺手把已经记下的标签、光标、滚动位置全清空
        applySettings();
        persistSettings();
      },
    });
    row.appendChild(h("div", { class: "set-ctl" }, sw));
    body.appendChild(row);
  };

  toggle("自动保存", "停止输入约 1.6 秒后自动写回磁盘", "autosave");
  toggle("打字机模式", "光标所在行始终保持在屏幕中部", "typewriter");
  toggle("专注模式", "淡化非当前段落，只看眼前一句", "focusMode");
  toggle("显示行号", "左侧显示行号栏", "lineNumbers");
  toggle("显示侧边栏", "Ctrl + \\ 快速开关", "sidebar");

  // 打开文件后侧边栏自动切到哪一栏
  const panelRow = h("div", { class: "set-row" });
  panelRow.appendChild(
    h("div", { class: "set-label" },
      h("div", { class: "t", text: "打开文件后显示" }),
      h("div", { class: "d", text: "侧边栏自动切到这一栏" })
    )
  );
  const seg = h("div", { class: "seg" });
  for (const [v, label] of [
    ["files", "文件夹"],
    ["outline", "大纲"],
    ["search", "搜索"],
  ] as const) {
    seg.appendChild(
      h("button", {
        class: "seg-btn" + (settings.openPanel === v ? " on" : ""),
        "data-v": v,
        text: label,
        onclick: () => {
          settings.openPanel = v;
          persistSettings();
          seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("on"));
          (seg.querySelector(`.seg-btn[data-v="${v}"]`) as HTMLElement | null)?.classList.add("on");
        },
      })
    );
  }
  panelRow.appendChild(h("div", { class: "set-ctl" }, seg));
  body.appendChild(panelRow);
  // 上次的内容：三态
  const sessRow = h("div", { class: "set-row" });
  sessRow.appendChild(
    h("div", { class: "set-label" },
      h("div", { class: "t", text: "上次的内容" }),
      h("div", { class: "d", text: "重开时如何处理上次的标签和未保存草稿 · 下次启动生效" })
    )
  );
  const sessSeg = h("div", { class: "seg" });
  for (const [v, label] of [
    ["off", "不保留"],
    ["ask", "每次询问"],
    ["auto", "自动打开"],
  ] as const) {
    sessSeg.appendChild(
      h("button", {
        class: "seg-btn" + (settings.sessionMode === v ? " on" : ""),
        "data-v": v,
        text: label,
        onclick: () => {
          settings.sessionMode = v;
          if (v === "off") clearSessionData();
          persistSettings();
          sessSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("on"));
          (sessSeg.querySelector(`.seg-btn[data-v="${v}"]`) as HTMLElement | null)?.classList.add("on");
        },
      })
    );
  }
  sessRow.appendChild(h("div", { class: "set-ctl" }, sessSeg));
  body.appendChild(sessRow);

  const assocRow = h("div", { class: "set-row" });
  const assocDesc = h("div", { class: "d", text: "用 Markprose 打开 .md 文件" });
  assocRow.appendChild(
    h("div", { class: "set-label" },
      h("div", { class: "t", text: "默认打开方式" }),
      assocDesc
    )
  );
  const assocBtn = h("button", {
    class: "mini-btn",
    text: "设为默认",
    onclick: async () => {
      if (!IS_TAURI) return;
      try {
        const r = await setDefaultApp();
        if (r === "set") {
          assocDesc.textContent = "当前已是默认程序";
          toast("已设为默认打开方式");
        } else {
          assocDesc.textContent = "请在打开的设置页里点「设置默认值」";
          toast("已打开设置页，点一下「设置默认值」", "info", 4000);
        }
      } catch (e: any) {
        toast("设置失败：" + (e?.message || e), "err");
      }
    },
  });
  assocRow.appendChild(h("div", { class: "set-ctl" }, assocBtn));
  body.appendChild(assocRow);
  if (IS_TAURI) {
    isDefaultApp()
      .then((yes) => {
        assocDesc.textContent = yes ? "当前已是默认程序" : "当前不是默认程序";
      })
      .catch(() => {});
  }

  const repoRow = h("div", { class: "set-row" });
  repoRow.appendChild(
    h(
      "div",
      { class: "set-label" },
      h("div", { class: "t", text: "GitHub 仓库" }),
      h("div", { class: "d", text: "github.com/GHaoyun/Markprose" })
    )
  );
  repoRow.appendChild(
    h(
      "div",
      { class: "set-ctl" },
      h("button", {
        class: "mini-btn",
        text: "打开",
        onclick: async () => {
          if (!IS_TAURI) return;
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("open_path", { path: "https://github.com/GHaoyun/Markprose" });
        },
      })
    )
  );
  body.appendChild(repoRow);

  const info = h("div", { class: "set-row" });
  info.appendChild(
    h("div", { class: "set-label" },
      h("div", { class: "t", text: "关于Markprose" }),
      h("div", { class: "d", text: "v1.1.0" })
    )
  );
  body.appendChild(info);

  $("#settings").classList.add("show");
}

function toggleSetting(key: keyof typeof DEFAULT_SETTINGS) {
  (settings as any)[key] = !(settings as any)[key];
  applySettings();
  persistSettings();
  if (key === "lineNumbers") rebuildEditorChrome();
}

function rebuildEditorChrome() {
  setLineNumbers(view, settings.lineNumbers);
}

function toggleSource() {
  settings.sourceMode = !settings.sourceMode;
  view.dispatch({
    effects: sourceComp.reconfigure(settings.sourceMode ? [] : livePreview),
  });
  applySettings();
  persistSettings();
  refreshStatus();
  toast(settings.sourceMode ? "已切到源码" : "已切到实时预览");
}

/* ================= 导出 ================= */
async function exportHtml() {
  const t = activeTab();
  if (!t) return;
  const md = view.state.doc.toString();
  const name = t.path ? stripExt(basename(t.path)) : "未命名";
  const path = await pickSaveFile((app.workspace ? norm(app.workspace) + "/" : "") + name + ".html");
  if (!path) return;
  try {
    await writeText(path, buildExportHtml(name, md));
    toast("已导出 " + basename(path));
  } catch (e: any) {
    toast("导出失败：" + (e?.message || e), "err");
  }
}

async function exportPdf() {
  const t = activeTab();
  if (!t) return;
  const md = view.state.doc.toString();
  const name = t.path ? stripExt(basename(t.path)) : "未命名";
  const html = buildExportHtml(name, md);
  const tmp = norm(app.workspace || ".") + `/.moke-print-${Date.now()}.html`;
  try {
    await writeText(tmp, html);
    await openExternal(tmp);
    toast("已在浏览器打开，按 Ctrl+P 可另存为 PDF", "info", 4200);
  } catch (e: any) {
    toast("打开失败：" + (e?.message || e), "err");
  }
}

async function copyHtml() {
  const t = activeTab();
  if (!t) return;
  const md = view.state.doc.toString();
  const name = t.path ? stripExt(basename(t.path)) : "未命名";
  await navigator.clipboard.writeText(buildExportHtml(name, md));
  toast("已复制 HTML");
}

async function openExternal(path: string) {
  if (!IS_TAURI) {
    const w = window.open("", "_blank");
    if (w) w.document.write(buildExportHtml("预览", view.state.doc.toString()));
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_path", { path });
}

async function reloadCurrent() {
  const t = activeTab();
  if (!t?.path) return;
  const r = await readText(t.path);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content } });
  t.dirty = false;
  renderTabs();
  updateTitlebar();
  toast("已重新加载");
}

/* ================= 气泡菜单 ================= */
let bubbleTimer: number | undefined;
let bubbleOff = 0;
/** 用工具栏/快捷键改格式后，短时间内不再弹气泡（否则刚点完按钮就挡住文字） */
function hideBubbleSoon() {
  bubbleOff = Date.now() + 700;
  document.getElementById("bubble")?.classList.remove("show");
}

function scheduleBubble() {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(updateBubble, 90);
}

function updateBubble() {
  const el = $("#bubble");
  if (!el) return;
  if (Date.now() < bubbleOff) {
    el.classList.remove("show");
    return;
  }
  const sel = view.state.selection.main;
  if (sel.empty || document.activeElement?.closest("#bubble")) {
    if (!document.activeElement?.closest("#bubble")) el.classList.remove("show");
    return;
  }
  const text = view.state.sliceDoc(sel.from, sel.to);
  if (!text.trim()) {
    el.classList.remove("show");
    return;
  }
  const co = view.coordsAtPos(sel.from);
  if (!co) return;
  el.classList.add("show");
  const rect = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(co.left, window.innerWidth - rect.width - 8)) + "px";
  el.style.top = Math.max(8, co.top - rect.height - 8) + "px";
}

function buildBubble() {
  const el = $("#bubble")!;
  const btns: [string, string, () => void][] = [
    ["B", "加粗", () => cmdBold(view)],
    ["I", "斜体", () => cmdItalic(view)],
    ["S", "删除线", () => cmdStrike(view)],
    ["<>", "行内代码", () => cmdCode(view)],
    ["H", "高亮", () => cmdMark(view)],
    ["∑", "公式", () => cmdMath(view)],
    ["🔗", "链接", () => cmdLink(view)],
  ];
  el.innerHTML = "";
  btns.forEach(([label, title, fn], i) => {
    if (i === 4 || i === 6) el.appendChild(h("div", { class: "bb-sep" }));
    const b = h("button", {
      class: "bb-btn",
      title,
      onmousedown: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        el.classList.remove("show");
      },
    });
    if (label === "B") b.innerHTML = "<b>B</b>";
    else if (label === "I") b.innerHTML = "<i>I</i>";
    else if (label === "S") b.innerHTML = "<s>S</s>";
    else b.textContent = label;
    el.appendChild(b);
  });
}

/* ================= 文件对话框 ================= */
async function openFileDialog() {
  const p = await pickOpenFile();
  if (p) void openPath(p);
}
async function openFolderDialog() {
  const d = await pickFolder();
  if (d) void openWorkspace(d);
}

/* ================= 快捷键 ================= */
function bindShortcuts() {
  window.addEventListener(
    "keydown",
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      // 命令面板
      if (mod && e.shiftKey && k === "p") {
        e.preventDefault();
        openPalette();
        return;
      }
      if ($("#palette").classList.contains("show")) {
        const list = $$(".pitem");
        if (k === "escape") {
          e.preventDefault();
          closePalette();
        } else if (k === "arrowdown") {
          e.preventDefault();
          paletteSel = Math.min(list.length - 1, paletteSel + 1);
          list.forEach((el, i) => el.classList.toggle("sel", i === paletteSel));
          list[paletteSel]?.scrollIntoView({ block: "nearest" });
        } else if (k === "arrowup") {
          e.preventDefault();
          paletteSel = Math.max(0, paletteSel - 1);
          list.forEach((el, i) => el.classList.toggle("sel", i === paletteSel));
          list[paletteSel]?.scrollIntoView({ block: "nearest" });
        } else if (k === "enter") {
          e.preventDefault();
          const c = paletteItems[paletteSel];
          closePalette();
          c?.run();
        }
        return;
      }
      if (k === "escape") {
        $("#settings").classList.remove("show");
        hideCtx();
        closeTablePanel();
        closeEditorMenu();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (!mod) return;
      if (e.defaultPrevented) return;

      // 快捷键改完格式后，别让气泡菜单立刻跳出来挡住文字
      if (k.length === 1 && "biuehq".includes(k)) hideBubbleSoon();

      switch (k) {
        case "n":
          e.preventDefault();
          newTab();
          break;
        case "o":
          e.preventDefault();
          if (e.shiftKey) void openFolderDialog();
          else void openFileDialog();
          break;
        case "s":
          e.preventDefault();
          void saveTab(e.shiftKey);
          break;
        case "w":
          e.preventDefault();
          if (app.activeId) void closeTab(app.activeId);
          break;
        case "b":
          e.preventDefault();
          cmdBold(view);
          break;
        case "i":
          e.preventDefault();
          cmdItalic(view);
          break;
        case "u":
          e.preventDefault();
          if (e.shiftKey) cmdUnderline(view);
          else cmdStrike(view);
          break;
        case "e":
          e.preventDefault();
          cmdCode(view);
          break;
        case "k":
          e.preventDefault();
          if (e.shiftKey) cmdCodeBlock(view);
          else cmdLink(view);
          break;
        case "t":
          e.preventDefault();
          insertSnippet(view, TABLE_SNIPPET);
          break;
        case "m":
          if (e.shiftKey) {
            e.preventDefault();
            void insertMathDialog();
          }
          break;
        case "/":
          e.preventDefault();
          toggleSource();
          break;
        case "\\":
          e.preventDefault();
          toggleSetting("sidebar");
          break;
        case ",":
          e.preventDefault();
          openSettings();
          break;
        case "h":
          e.preventDefault();
          if (e.shiftKey) cmdMark(view);
          else openSearchPanel(view);
          break;
        case "q":
          if (e.shiftKey) {
            e.preventDefault();
            cmdQuote(view);
          }
          break;
        case "d":
          if (e.shiftKey) {
            e.preventDefault();
            insertDate();
          }
          break;
        case "g":
          e.preventDefault();
          void gotoLine();
          break;
        case "=":
        case "+":
          e.preventDefault();
          zoomBy(0.5);
          break;
        case "-":
          e.preventDefault();
          zoomBy(-0.5);
          break;
        case "0":
          e.preventDefault();
          if (e.shiftKey) {
            settings.fontSize = 16.5;
            applySettings();
            persistSettings();
            toast("字号已重置");
          } else {
            cmdHeading(view, 0);
          }
          break;
        case "p":
          if (e.shiftKey) {
            e.preventDefault();
            openPalette();
          }
          break;
        default:
          if (/^[0-6]$/.test(k)) {
            e.preventDefault();
            cmdHeading(view, parseInt(k, 10));
          }
      }
    },
    true
  );
}

/** 统一的退出流程：只确认一次，并行保存，然后直接销毁窗口 */
async function doClose() {
  const dirty = app.tabs.filter((t) => t.dirty);
  if (dirty.length) {
    const choice = await choiceBox({
      title: "退出Markprose",
      message: `有 ${dirty.length} 个文件还没保存。`,
      buttons: [
        { text: "取消", value: "cancel" },
        { text: "不保存", value: "discard", kind: "warn" },
        { text: "保存并退出", value: "save", kind: "primary" },
      ],
    });
    if (choice === null || choice === "cancel") return;
    if (choice === "discard") {
      draftsDiscarded = true;
      saveSession();
    }
    if (choice === "save") {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      toast("正在保存…", "info", 1500);
      await Promise.all(
        dirty.map(async (t) => {
          if (!t.path) return;
          const content =
            t.id === app.activeId ? view.state.doc.toString() : t.state.doc.toString();
          try {
            await writeText(t.path, content);
            t.dirty = false;
          } catch {}
        })
      );
    }
  }
  if (IS_TAURI) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } else {
    window.close();
  }
}

/* ================= 窗口控制 ================= */
async function bindWindow() {
  if (!IS_TAURI) {
    $("#win-min").onclick = () => {};
    $("#win-max").onclick = () => {};
    $("#win-close").onclick = () => void doClose();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  $("#win-min").onclick = () => w.minimize();
  $("#win-max").onclick = () => w.toggleMaximize();
  $("#win-close").onclick = () => void doClose();
}

/* ================= 格式工具栏 ================= */
const scheduleToolbarSync = debounce(() => syncToolbarNow(), 40);

function syncToolbarNow() {
  if (!app.activeId) return;
  const state = view.state;
  const pos = state.selection.main.head;
  const names = new Set<string>();
  let n: any = syntaxTree(state).resolveInner(pos, -1);
  while (n) {
    names.add(n.name);
    n = n.parent;
  }
  const text = state.doc.lineAt(pos).text;
  const near = (m: string) =>
    state.sliceDoc(Math.max(0, pos - m.length), pos) === m ||
    state.sliceDoc(pos, Math.min(state.doc.length, pos + m.length)) === m;
  const st: ToolbarState = {
    heading: (() => {
      const m = /^(#{1,6})\s/.exec(text);
      return m ? m[1].length : 0;
    })(),
    bold: names.has("StrongEmphasis"),
    italic: names.has("Emphasis"),
    strike: names.has("Strikethrough") || near("~~"),
    code: names.has("InlineCode"),
    link: names.has("Link"),
    quote: /^\s{0,3}>/.test(text),
    ul: /^\s*[-*+]\s+(?!\[)/.test(text),
    ol: /^\s*\d{1,9}[.)]\s+/.test(text),
    task: /^\s*[-*+]\s+\[[ xX]\]/.test(text),
  };
  syncToolbar(st);
}

function execToolbar(cmd: string, arg?: any) {
  switch (cmd) {
    case "undo":
      undo(view);
      break;
    case "redo":
      redo(view);
      break;
    case "heading":
      cmdHeading(view, Number(arg) || 0);
      break;
    case "quote":
      cmdQuote(view);
      break;
    case "bold":
      cmdBold(view);
      break;
    case "italic":
      cmdItalic(view);
      break;
    case "strike":
      cmdStrike(view);
      break;
    case "underline":
      cmdUnderline(view);
      break;
    case "code":
      cmdCode(view);
      break;
    case "highlight":
      cmdMark(view);
      break;
    case "link":
      void insertLink();
      break;
    case "image":
      void insertImageFromDialog();
      break;
    case "ul":
      cmdList(view, "ul");
      break;
    case "ol":
      cmdList(view, "ol");
      break;
    case "task":
      cmdList(view, "task");
      break;
    case "table":
      insertSnippet(view, TABLE_SNIPPET);
      break;
    case "codeblock":
      cmdCodeBlock(view);
      break;
    case "math":
      void insertMathDialog();
      break;
    case "hr":
      cmdHr(view);
      break;
    case "toc":
      cmdToc(view);
      break;
  }
  setTimeout(syncToolbarNow, 0);
  hideBubbleSoon();
}

async function insertLink() {
  const sel = view.state.selection.main;
  const node = findNodeAt(view, ["Link"]);
  if (node) {
    const raw = view.state.sliceDoc(node.from, node.to);
    const m = /^\[([\s\S]*?)\]\(([\s\S]*?)\)$/.exec(raw);
    if (m) {
      view.dispatch({ changes: { from: node.from, to: node.to, insert: m[1] } });
      view.focus();
      return;
    }
  }
  const text = view.state.sliceDoc(sel.from, sel.to) || "链接文字";
  const url = await promptBox({
    title: "插入链接",
    message: `文字：${text}`,
    value: "https://",
    placeholder: "https://example.com",
  });
  if (!url) return;
  const insert = `[${text}](${url})`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
  });
  view.focus();
}

async function uniquePath(dir: string, base = "文档"): Promise<string> {
  for (let i = 1; i < 999; i++) {
    const p = norm(dir) + "/" + base + i + ".md";
    if (!(await pathExists(p))) return p;
  }
  return norm(dir) + "/" + base + Date.now() + ".md";
}

/** 没保存过的文档：自动落到「自动保存位置」，像 Word 一样先有文件再干活 */
async function ensureSaved(): Promise<boolean> {
  const t = activeTab();
  if (!t) return false;
  if (t.path) return true;
  let dir = settings.saveDir;
  if (!dir) {
    try {
      dir = await defaultSaveDir();
    } catch {
      dir = "";
    }
  }
  if (!dir) {
    toast("找不到可用的保存位置，请先在设置里指定自动保存位置", "err", 3400);
    return false;
  }
  try {
    const path = await uniquePath(dir);
    const content = view.state.doc.toString();
    const r = await writeText(path, content);
    t.path = path;
    t.dirty = false;
    t.savedAt = r.mtime;
    docCtx.path = path;
    docCtx.dir = dirname(path);
    renderTabs();
    updateTitlebar();
    refreshOutline();
    toast("已自动保存到 " + basename(path));
    return true;
  } catch (e: any) {
    toast("自动保存失败：" + (e?.message || e), "err", 3600);
    return false;
  }
}

async function insertImageFromDialog() {
  const p = await pickImageFile();
  if (!p) return;
  if (!docCtx.dir) {
    const ok = await ensureSaved();
    if (!ok) return;
  }
  const dataUrl = await readImageDataUrl(p);
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    return toast("读取图片失败：文件可能被占用或没有读取权限", "err", 3200);
  }
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const ext = (p.split(".").pop() || "png").toLowerCase();
  try {
    const rel = await saveImage(docCtx.dir, b64, ext);
    const alt = basename(p).replace(/\.[^.]+$/, "");
    insertSnippet(view, `![${alt}](${rel})`);
    toast("图片已存到 assets/");
  } catch (e: any) {
    toast("写入图片失败：" + (e?.message || e) + "（检查文档所在文件夹的写入权限）", "err", 4200);
  }
}

function zoomBy(delta: number) {
  settings.fontSize = Math.min(28, Math.max(12, settings.fontSize + delta));
  applySettings();
  persistSettings();
  toast(`字号 ${settings.fontSize}px`);
}

async function gotoLine() {
  const r = await promptBox({
    title: "跳转到行",
    message: `共 ${view.state.doc.lines} 行`,
    value: "1",
  });
  if (!r) return;
  const n = parseInt(r, 10);
  if (!Number.isFinite(n)) return;
  const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  view.focus();
}

async function toggleFullscreen() {
  if (!IS_TAURI) {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const full = await w.isFullscreen();
  await w.setFullscreen(!full);
}

function insertDate() {
  insertSnippet(view, new Date().toLocaleString("zh-CN", { hour12: false }));
}

/* ================= 编辑器右键菜单 ================= */
let edMenu: HTMLElement | null = null;
function closeEditorMenu() {
  edMenu?.remove();
  edMenu = null;
}

async function doCopy() {
  const { from, to } = view.state.selection.main;
  if (from === to) return toast("先选中要复制的内容");
  try {
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    toast("已复制");
  } catch {
    toast("复制失败，请用 Ctrl+C", "err");
  }
}
async function doCut() {
  const { from, to } = view.state.selection.main;
  if (from === to) return toast("先选中要剪切的内容");
  try {
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.dispatch({ changes: { from, to, insert: "" } });
    view.focus();
  } catch {
    toast("剪切失败，请用 Ctrl+X", "err");
  }
}
async function doPaste() {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: t }, selection: { anchor: from + t.length } });
    view.focus();
  } catch {
    toast("读取剪贴板失败，请用 Ctrl+V", "err");
  }
}

function showEditorMenu(x: number, y: number) {
  closeEditorMenu();
  const menu = h("div", { class: "ed-menu" });
  const sep = () => h("div", { class: "ed-sep" });

  const IC: Record<string, string> = {
    copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V4.1A1.6 1.6 0 0 0 8.9 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v4.8a1.6 1.6 0 0 0 1.6 1.6h1.4"/></svg>',
    cut: '<svg viewBox="0 0 16 16"><circle cx="4.2" cy="11.9" r="1.9"/><circle cx="11.8" cy="11.9" r="1.9"/><path d="M5.5 10.5L11 2.2M10.5 10.5L5 2.2"/></svg>',
    paste: '<svg viewBox="0 0 16 16"><rect x="3.6" y="3.4" width="8.8" height="10.1" rx="1.6"/><path d="M6.1 3.4v-.6a1.4 1.4 0 0 1 1.4-1.4h1a1.4 1.4 0 0 1 1.4 1.4v.6"/></svg>',
    mark: '<svg viewBox="0 0 16 16"><path d="M3.2 11.4l7.4-7.4 2.4 2.4-7.4 7.4H3.2z"/><path d="M2.6 14.6h10.8"/></svg>',
    under: '<svg viewBox="0 0 16 16"><path d="M4.2 2.4v4.8a3.8 3.8 0 0 0 7.6 0V2.4"/><path d="M3.2 14.2h9.6"/></svg>',
    strike: '<svg viewBox="0 0 16 16"><path d="M10.4 4.6C9.9 3.7 9 3.2 8 3.2 6.4 3.2 5.2 4.1 5.2 5.5c0 .9.6 1.5 1.7 2"/><path d="M6.1 11.3c.5.9 1.3 1.4 2.4 1.4 1.6 0 2.8-.9 2.8-2.3 0-.5-.2-1-.5-1.3"/><path d="M2.6 7.9h10.8"/></svg>',
    eraser: '<svg viewBox="0 0 16 16"><path d="M6.6 13.4h6.2"/><path d="M9.9 2.9l3.2 3.2a.9.9 0 0 1 0 1.3l-4.7 4.7a.9.9 0 0 1-1.3 0L3.9 9.1a.9.9 0 0 1 0-1.3l4.7-4.9a.9.9 0 0 1 1.3 0z"/></svg>',
  };

  const row = (iconSvg: string, label: string, hint: string, dot: string, fn: () => void) => {
    const el = h("div", {
      class: "ed-mi",
      onmousedown: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeEditorMenu();
        fn();
      },
    });
    if (iconSvg) el.appendChild(h("span", { class: "ed-ic", html: iconSvg }));
    el.appendChild(h("span", { class: "ed-ml", text: label }));
    if (hint) el.appendChild(h("span", { class: "ed-mh", text: hint }));
    if (dot) el.appendChild(h("span", { class: "ed-dot", style: { background: dot } }));
    return el;
  };

  const mi = (label: string, hint: string, fn: () => void) => row("", label, hint, "", fn);

  const sub = (label: string, items: [string, string, () => void][]) => {
    const el = h(
      "div",
      { class: "ed-mi has-sub" },
      h("span", { class: "ed-ml", text: label }),
      h("span", { class: "ed-arrow", text: "\u203a" })
    );
    const panel = h("div", { class: "ed-sub" });
    for (const [l, hint, fn] of items) panel.appendChild(mi(l, hint, fn));
    el.appendChild(panel);
    el.addEventListener("mouseenter", () => {
      const r = el.getBoundingClientRect();
      el.classList.toggle("flip", r.right + 200 > window.innerWidth - 8);
    });
    return el;
  };

  menu.append(
    row(IC.copy, "复制", "Ctrl+C", "", () => void doCopy()),
    row(IC.cut, "剪切", "Ctrl+X", "", () => void doCut()),
    row(IC.paste, "粘贴", "Ctrl+V", "", () => void doPaste())
  );
  menu.appendChild(sep());

  menu.append(
    row(IC.mark, "高亮", "", "", () => cmdMark(view)),
    row(IC.under, "下划线", "", "", () => cmdUnderline(view)),
    row(IC.strike, "删除线", "", "", () => cmdStrike(view)),
    row(IC.eraser, "清除格式", "", "", clearFormat)
  );
  menu.appendChild(sep());

  const quickRow = h("div", { class: "ed-row" });
  const quick: [string, string, () => void][] = [
    ["B", "加粗 (Ctrl+B)", () => cmdBold(view)],
    ["I", "斜体 (Ctrl+I)", () => cmdItalic(view)],
    ["<>", "行内代码 (Ctrl+E)", () => cmdCode(view)],
    ["\u2211", "公式", () => cmdMath(view)],
    ["\u2261", "引用", () => cmdQuote(view)],
  ];
  for (const [label, title, fn] of quick) {
    const b = h("button", {
      class: "ed-ib",
      title,
      onmousedown: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeEditorMenu();
        fn();
      },
    });
    if (label === "B") b.innerHTML = "<b>B</b>";
    else if (label === "I") b.innerHTML = "<i>I</i>";
    else if (label === "\u2211") b.innerHTML = '<span style="font-family:var(--font-serif);font-size:14px">\u2211</span>';
    else b.textContent = label;
    quickRow.appendChild(b);
  }
  menu.appendChild(quickRow);
  menu.appendChild(sep());

  menu.append(
    sub("标题", [
      ["正文", "Ctrl+0", () => cmdHeading(view, 0)],
      ["标题 1", "Ctrl+1", () => cmdHeading(view, 1)],
      ["标题 2", "Ctrl+2", () => cmdHeading(view, 2)],
      ["标题 3", "Ctrl+3", () => cmdHeading(view, 3)],
      ["标题 4", "Ctrl+4", () => cmdHeading(view, 4)],
      ["标题 5", "Ctrl+5", () => cmdHeading(view, 5)],
      ["标题 6", "Ctrl+6", () => cmdHeading(view, 6)],
    ]),
    sub("列表", [
      ["无序列表", "", () => cmdList(view, "ul")],
      ["有序列表", "", () => cmdList(view, "ol")],
      ["任务清单", "", () => cmdList(view, "task")],
    ]),
    sub("插入", [
      ["表格", "Ctrl+T", () => insertSnippet(view, TABLE_SNIPPET)],
      ["代码块", "Ctrl+Shift+K", () => cmdCodeBlock(view)],
      ["链接", "Ctrl+K", () => void insertLink()],
      ["图片", "", () => void insertImageFromDialog()],
      ["行内公式", "", () => void insertMathDialog(false)],
      ["块级公式", "Ctrl+Shift+M", () => void insertMathDialog()],
      ["分隔线", "", () => cmdHr(view)],
      ["目录 [TOC]", "", () => cmdToc(view)],
    ]),
    mi("全选", "Ctrl+A", () => {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      view.focus();
    })
  );
  menu.appendChild(sep());
  menu.append(mi("撤销", "Ctrl+Z", () => undo(view)), mi("重做", "Ctrl+Y", () => redo(view)));

  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
  edMenu = menu;
  setTimeout(() => {
    const off = (e: MouseEvent) => {
      if (edMenu && !edMenu.contains(e.target as Node)) {
        closeEditorMenu();
        document.removeEventListener("mousedown", off, true);
      }
    };
    document.addEventListener("mousedown", off, true);
  }, 0);
}

/* ================= 菜单栏 ================= */interface MItem {
  label?: string;
  key?: string;
  sep?: boolean;
  checked?: () => boolean;
  run?: () => void;
  /** 菜单项左侧的矢量图标 */
  icon?: keyof typeof MICONS;
  /** 没有合适矢量图时用文字标记（B / I / H1 …） */
  glyph?: string;
}
interface MMenu {
  label: string;
  items: () => MItem[];
}

/** 菜单图标：16×16，描边风格，与工具栏保持一致 */
const MICONS = {
  page: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>',
  new: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/><path d="M8 7.4v3.6M6.2 9.2h3.6"/>',
  folder:
    '<path d="M1.8 4.6a1 1 0 0 1 1-1h3.2l1.4 1.6h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>',
  folderOpen:
    '<path d="M1.8 4.6a1 1 0 0 1 1-1h3.2l1.4 1.6h5.8a1 1 0 0 1 1 1v1.2H1.8z"/><path d="M1.8 7.4h12.4l-1.5 5.1a1 1 0 0 1-1 .7H4.3a1 1 0 0 1-1-.7z"/>',
  save: '<path d="M3 2.5h7.6L13.5 5.4v8.1h-10.5z"/><path d="M5.6 2.5v3.2h4.3V2.5"/><path d="M5.6 13.5V9.2h4.8v4.3"/>',
  saveAs:
    '<path d="M2.6 2.5h6.9L12.2 5.2v4.4"/><path d="M4.9 2.5v2.9h3.8V2.5"/><path d="M4.9 13.5V9.3h4v4.2"/><path d="M12.6 3.4v3.4M10.9 5.1h3.4"/>',
  saveAll:
    '<path d="M2 4.6h7.4L11.6 7v6.4H2z"/><path d="M4.6 2.5h7.4L14.2 4.9V11"/>',
  export: '<path d="M8 10.2V2.4M5.2 5.2L8 2.4l2.8 2.8"/><path d="M2.6 9.6v4h10.8v-4"/>',
  print:
    '<path d="M4.6 2.5h6.8V6H4.6z"/><path d="M2.5 6h11v4.6h-2.4"/><path d="M4.6 9h6.8v4.5H4.6z"/>',
  external:
    '<path d="M9.2 2.5h4.3v4.3"/><path d="M13.5 2.5L7.4 8.6"/><path d="M12 9.4v4.1H2.5V4h4.1"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13.2 2.5v3h-3"/>',
  close: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
  power: '<path d="M8 2.4v4.8"/><path d="M5.1 4.2a4.6 4.6 0 1 0 5.8 0"/>',
  undo: '<path d="M4.5 7.5h5.2a3.6 3.6 0 1 1 0 7.2H6.2"/><path d="M7 4.5L4 7.5l3 3"/>',
  redo: '<path d="M11.5 7.5H6.3a3.6 3.6 0 1 0 0 7.2h3.5"/><path d="M9 4.5l3 3-3 3"/>',
  cut: '<path d="M3.4 2.6l7.4 8.2M12.6 2.6L5.2 10.8"/><circle cx="3.4" cy="12.4" r="1.5"/><circle cx="12.6" cy="12.4" r="1.5"/>',
  copy: '<path d="M5.6 5.6h7.9v7.9H5.6z"/><path d="M2.5 10.4V2.5h7.9"/>',
  paste: '<path d="M4.2 3.4h7.6v10.1H4.2z"/><path d="M6.2 2.5h3.6v2.1H6.2z"/>',
  up: '<path d="M8 13V3.4M4.4 7L8 3.4 11.6 7"/>',
  down: '<path d="M8 3v9.6M4.4 9L8 12.6 11.6 9"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/><path d="M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/><path d="M5 7h4"/>',
  zoomReset: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/><path d="M5 7h4M7 5v4"/>',
  selectAll:
    '<path d="M5.4 2.5H2.5v2.9M10.6 2.5h2.9v2.9M13.5 10.6v2.9h-2.9M5.4 13.5H2.5v-2.9"/>',
  quote:
    '<path d="M6.2 5.2c-1.7.9-2.5 2.3-2.5 4.2"/><path d="M10.6 5.2c-1.7.9-2.5 2.3-2.5 4.2"/><circle cx="3.7" cy="10.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.1" cy="10.8" r="1.1" fill="currentColor" stroke="none"/>',
  table:
    '<path d="M2.4 3.4h11.2v9.2H2.4z"/><path d="M2.4 6.7h11.2M6.4 6.7v5.9M9.9 6.7v5.9"/>',
  codeblock:
    '<path d="M5.6 5.4L2.6 8l3 2.6"/><path d="M10.4 5.4L13.4 8l-3 2.6"/>',
  highlight:
    '<path d="M6.2 10.2l4.2-4.2 2.1 2.1-4.2 4.2H6.2z"/><path d="M10.4 6l1.1-1.1 2.1 2.1-1.1 1.1"/><path d="M3 13.4h10"/>',
  link: '<path d="M6.6 9.4a2.9 2.9 0 0 0 4.1 0l1.9-1.9a2.9 2.9 0 0 0-4.1-4.1l-1 1"/><path d="M9.4 6.6a2.9 2.9 0 0 0-4.1 0l-1.9 1.9a2.9 2.9 0 0 0 4.1 4.1l1-1"/>',
  image:
    '<path d="M2.4 3.4h11.2v9.2H2.4z"/><circle cx="5.9" cy="6.5" r="1.05"/><path d="M2.8 11.4l3.1-3 2.4 2.3 2.2-2.1 2.7 2.8"/>',
  eraser: '<path d="M3.4 10.6l5.6-5.6 3.2 3.2-4.6 4.6H4.9z"/><path d="M8.4 13.5h5.2"/>',
  panel: '<path d="M2.5 3.4h11v9.2h-11z"/><path d="M6.4 3.4v9.2"/>',
  doc: '<path d="M4.4 2.5h4.6l2.6 2.6v8.4H4.4z"/><path d="M9 2.5v2.6h2.6"/>',
  list: '<path d="M5.4 4.4h8M5.4 8h8M5.4 11.6h8"/><path d="M2.6 4.4h1M2.6 8h1M2.6 11.6h1"/>',
  code: '<path d="M6 4.4L2.8 8 6 11.6"/><path d="M10 4.4L13.2 8 10 11.6"/>',
  target: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.9"/>',
  cursor: '<path d="M6.2 3.2h3.6M8 3.2v9.6M6.2 12.8h3.6"/>',
  hash: '<path d="M6.4 2.6l-1 10.8M10.6 2.6l-1 10.8M2.6 6.2h10.8M2 9.8h10.8"/>',
  fullscreen:
    '<path d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10"/>',
  palette:
    '<path d="M8 2.4a5.6 5.6 0 0 0 0 11.2c.9 0 1.4-.6 1.4-1.4 0-.9.5-1.4 1.4-1.4h1.1a2 2 0 0 0 2-2A5.6 5.6 0 0 0 8 2.4z"/><circle cx="5.4" cy="6.4" r=".9" fill="currentColor" stroke="none"/><circle cx="8.6" cy="5.2" r=".9" fill="currentColor" stroke="none"/><circle cx="4.6" cy="9.4" r=".9" fill="currentColor" stroke="none"/>',
  settings:
    '<path d="M2.6 5.2h10.8M2.6 10.8h10.8"/><circle cx="6" cy="5.2" r="1.9"/><circle cx="10.4" cy="10.8" r="1.9"/>',
  command: '<path d="M2.6 3.4h10.8v9.2H2.6z"/><path d="M5.2 6.8l2 1.7-2 1.7"/><path d="M9.2 10.2h2.4"/>',
  keyboard:
    '<path d="M2 4.6h12v6.8H2z"/><path d="M4.4 6.6h.01M6.8 6.6h.01M9.2 6.6h.01M11.6 6.6h.01M4.8 9.6h6.4"/>',
  info: '<circle cx="8" cy="8" r="5.4"/><path d="M8 7.2v4"/><path d="M8 4.9h.01"/>',
} as const;


let mbPanel: HTMLElement | null = null;
let mbBtn: HTMLElement | null = null;

function closeMenuBar() {
  mbPanel?.remove();
  mbBtn?.classList.remove("open");
  mbPanel = null;
  mbBtn = null;
}

function showMenuBar(btn: HTMLElement, menu: MMenu) {
  const same = mbBtn === btn;
  closeMenuBar();
  if (same) return;
  const panel = h("div", { class: "mb-panel" });
  for (const it of menu.items()) {
    if (it.sep) {
      panel.appendChild(h("div", { class: "mb-sep" }));
      continue;
    }
    const row = h("div", {
      class: "mb-row" + (it.checked?.() ? " checked" : ""),
      onmousedown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        // 菜单项在 mousedown 就执行：面板一旦被移出文档，click 永远不会到达
        e.preventDefault();
        e.stopPropagation();
        closeMenuBar();
        it.run?.();
      },
    });
    row.appendChild(h("span", { class: "mb-check" }));
    const slot = h("span", { class: "mb-ico" });
    if (it.icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.innerHTML = MICONS[it.icon] || "";
      slot.appendChild(svg);
    } else if (it.glyph) {
      slot.classList.add("g");
      slot.textContent = it.glyph;
    }
    row.appendChild(slot);
    row.appendChild(h("span", { class: "mb-label", text: it.label || "" }));
    if (it.key) row.appendChild(h("span", { class: "mb-key", text: it.key }));
    panel.appendChild(row);
  }
  document.body.appendChild(panel);
  const r = btn.getBoundingClientRect();
  panel.style.left = Math.round(r.left) + "px";
  panel.style.top = Math.round(r.bottom + 4) + "px";
  const pr = panel.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) {
    panel.style.left = Math.max(8, window.innerWidth - pr.width - 8) + "px";
  }
  mbPanel = panel;
  mbBtn = btn;
  btn.classList.add("open");
}

/** 去掉选区里的 Markdown 标记，得到纯文本 */
function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/(\*\*|__|~~|==)(.*?)\1/g, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1");
}

async function copyAsPlainText() {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    toast("先选中一段内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(stripMarkdown(view.state.sliceDoc(from, to)));
    toast("已复制为纯文本");
  } catch {
    toast("写入剪贴板失败", "err");
  }
}

function clearFormat() {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    toast("先选中一段内容");
    return;
  }
  const plain = stripMarkdown(view.state.sliceDoc(from, to));
  view.dispatch({
    changes: { from, to, insert: plain },
    selection: { anchor: from, head: from + plain.length },
  });
  view.focus();
}

async function pastePlain() {
  try {
    const txt = await navigator.clipboard.readText();
    if (!txt) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: txt },
      selection: { anchor: from + txt.length },
    });
    view.focus();
  } catch {
    toast("读取剪贴板失败", "err");
  }
}

async function editMathAt(tex: string, block: boolean, from: number, to: number) {
  const res = await mathBox(tex, block);
  if (!res || !res.tex) return;
  let insert: string;
  if (res.block === block) {
    insert = res.block ? `$$\n${res.tex}\n$$` : `$${res.tex}$`;
  } else if (res.block) {
    insert = `\n$$\n${res.tex}\n$$\n`;
  } else {
    insert = `$${res.tex}$`;
  }
  const after = from + insert.length;
  const newLen = view.state.doc.length - (to - from) + insert.length;
  // 块级公式：光标停进公式范围会切成源码态，往后挪一位让渲染结果保持可见
  const anchor = Math.min(newLen, after + (res.block ? 1 : 0));
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor },
  });
  view.focus();
}

async function insertMathDialog(block = true) {
  const raw = view.state
    .sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    .trim();
  let tex = raw;
  let mode = block;
  // 选中的已经是公式时，去掉外层标记并沿用它的形式
  const bm = /^\$\$([\s\S]*?)\$\$$/.exec(raw);
  const im = /^\$([^$\n]+?)\$$/.exec(raw);
  if (bm) {
    tex = bm[1].trim();
    mode = true;
  } else if (im) {
    tex = im[1].trim();
    mode = false;
  }
  const res = await mathBox(tex, mode);
  if (!res || !res.tex) return;
  const snippet = res.block ? `\n$$\n${res.tex}\n$$\n` : `$${res.tex}$`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + snippet.length },
  });
  view.focus();
}

async function saveAllTabs() {
  const dirty = app.tabs.filter((t) => t.dirty);
  if (!dirty.length) {
    toast("没有需要保存的修改");
    return;
  }
  for (const t of dirty) {
    if (app.activeId !== t.id) activate(t.id);
    await saveTab(false, true);
  }
  toast(`已保存 ${dirty.length} 个文件`);
}

function resetZoom() {
  settings.fontSize = 16.5;
  applySettings();
  persistSettings();
}

function menuDefs(): MMenu[] {
  const F = (cmd: string, arg?: any) => () => execToolbar(cmd, arg);
  return [
    {
      label: "文件",
      items: () => [
        { label: "新建", key: "Ctrl+N", icon: "new", run: () => newTab() },
        { label: "打开文件…", key: "Ctrl+O", icon: "page", run: () => void openFileDialog() },
        { label: "打开文件夹…", key: "Ctrl+Shift+O", icon: "folderOpen", run: () => void openFolderDialog() },
        { sep: true },
        { label: "保存", key: "Ctrl+S", icon: "save", run: () => void saveTab() },
        { label: "另存为…", key: "Ctrl+Shift+S", icon: "saveAs", run: () => void saveTab(true) },
        { label: "保存全部", icon: "saveAll", run: () => void saveAllTabs() },
        { sep: true },
        { label: "导出 HTML…", icon: "export", run: () => void exportHtml() },
        { label: "打印 / 导出 PDF…", icon: "print", run: () => void exportPdf() },
        { sep: true },
        {
          label: "在资源管理器中显示",
          icon: "external",
          run: () => {
            const p = activeTab()?.path;
            if (p) revealInExplorer(p);
          },
        },
        { label: "重新加载当前文件", icon: "reload", run: () => void reloadCurrent() },
        { sep: true },
        { label: "关闭标签", key: "Ctrl+W", icon: "close", run: () => app.activeId && void closeTab(app.activeId) },
        { label: "退出", icon: "power", run: () => void doClose() },
      ],
    },
    {
      label: "编辑",
      items: () => [
        { label: "撤销", key: "Ctrl+Z", icon: "undo", run: () => undo(view) },
        { label: "重做", key: "Ctrl+Y", icon: "redo", run: () => redo(view) },
        { sep: true },
        { label: "剪切", key: "Ctrl+X", icon: "cut", run: () => document.execCommand("cut") },
        { label: "复制", key: "Ctrl+C", icon: "copy", run: () => document.execCommand("copy") },
        { label: "粘贴", key: "Ctrl+V", icon: "paste", run: () => void pastePlain() },
        { label: "复制为纯文本", glyph: "T", run: () => void copyAsPlainText() },
        { sep: true },
        { label: "上移该行", key: "Alt+↑", icon: "up", run: () => moveLineUp(view) },
        { label: "下移该行", key: "Alt+↓", icon: "down", run: () => moveLineDown(view) },
        { sep: true },
        { label: "查找", key: "Ctrl+F", icon: "search", run: () => openSearchPanel(view) },
        { label: "查找并替换", key: "Ctrl+H", glyph: "⇄", run: () => openSearchPanel(view) },
        { sep: true },
        {
          label: "全选",
          key: "Ctrl+A",
          icon: "selectAll",
          run: () => {
            view.focus();
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
          },
        },
      ],
    },
    {
      label: "格式",
      items: () => [
        { label: "正文", key: "Ctrl+0", glyph: "T", run: F("heading", 0) },
        { label: "标题 1", key: "Ctrl+1", glyph: "H1", run: F("heading", 1) },
        { label: "标题 2", key: "Ctrl+2", glyph: "H2", run: F("heading", 2) },
        { label: "标题 3", key: "Ctrl+3", glyph: "H3", run: F("heading", 3) },
        { label: "标题 4", key: "Ctrl+4", glyph: "H4", run: F("heading", 4) },
        { label: "标题 5", key: "Ctrl+5", glyph: "H5", run: F("heading", 5) },
        { label: "标题 6", key: "Ctrl+6", glyph: "H6", run: F("heading", 6) },
        { sep: true },
        { label: "加粗", key: "Ctrl+B", glyph: "B", run: F("bold") },
        { label: "斜体", key: "Ctrl+I", glyph: "I", run: F("italic") },
        { label: "删除线", key: "Ctrl+U", glyph: "S", run: F("strike") },
        { label: "下划线", key: "Ctrl+Shift+U", glyph: "U", run: F("underline") },
        { label: "行内代码", key: "Ctrl+E", glyph: "</>", run: F("code") },
        { label: "高亮", key: "Ctrl+Shift+H", icon: "highlight", run: F("highlight") },
        { sep: true },
        { label: "引用", key: "Ctrl+Shift+Q", icon: "quote", run: F("quote") },
        { label: "无序列表", glyph: "•", run: F("ul") },
        { label: "有序列表", glyph: "1.", run: F("ol") },
        { label: "任务清单", glyph: "☑", run: F("task") },
        { sep: true },
        { label: "表格", key: "Ctrl+T", icon: "table", run: F("table") },
        { label: "代码块", key: "Ctrl+Shift+K", icon: "codeblock", run: F("codeblock") },
        { label: "公式", glyph: "∑", run: F("math") },
        { label: "分隔线", glyph: "—", run: F("hr") },
        { label: "目录", glyph: "TOC", run: F("toc") },
        { sep: true },
        { label: "链接", key: "Ctrl+K", icon: "link", run: F("link") },
        { label: "图片", icon: "image", run: F("image") },
        { sep: true },
        { label: "清除格式", icon: "eraser", run: clearFormat },
      ],
    },
    {
      label: "视图",
      items: () => [
        {
          label: "侧边栏",
          key: "Ctrl+\\",
          icon: "panel",
          checked: () => settings.sidebar,
          run: () => toggleSetting("sidebar"),
        },
        { label: "文件列表", icon: "doc", checked: () => $(".sb-tab.active")?.getAttribute("data-panel") === "files", run: () => switchPanel("files") },
        { label: "大纲", icon: "list", checked: () => $(".sb-tab.active")?.getAttribute("data-panel") === "outline", run: () => switchPanel("outline") },
        { label: "搜索", icon: "search", checked: () => $(".sb-tab.active")?.getAttribute("data-panel") === "search", run: () => switchPanel("search") },
        { sep: true },
        { label: "源码模式", key: "Ctrl+/", icon: "code", checked: () => settings.sourceMode, run: toggleSource },
        { label: "专注模式", icon: "target", checked: () => settings.focusMode, run: () => toggleSetting("focusMode") },
        { label: "打字机模式", icon: "cursor", checked: () => settings.typewriter, run: () => toggleSetting("typewriter") },
        { label: "显示行号", icon: "hash", checked: () => settings.lineNumbers, run: () => toggleSetting("lineNumbers") },
        { sep: true },
        { label: "放大", key: "Ctrl+=", icon: "zoomIn", run: () => zoomBy(0.5) },
        { label: "缩小", key: "Ctrl+-", icon: "zoomOut", run: () => zoomBy(-0.5) },
        { label: "实际大小", key: "Ctrl+Shift+0", icon: "zoomReset", run: resetZoom },
        { label: "全屏", key: "F11", icon: "fullscreen", run: () => void toggleFullscreen() },
        { sep: true },
        ...THEMES.map((t) => ({
          label: t.name,
          icon: "palette" as const,
          checked: () => settings.theme === t.id,
          run: () => setTheme(t.id),
        })),
        { sep: true },
        { label: "设置…", key: "Ctrl+,", icon: "settings", run: () => openSettings() },
        { label: "命令面板…", key: "Ctrl+Shift+P", icon: "command", run: () => openPalette() },
      ],
    },
    {
      label: "帮助",
      items: () => [
        {
          label: "快捷键一览",
          icon: "keyboard",
          run: () =>
            void alertBox({
              title: "快捷键",
              message:
                "新建 Ctrl+N　　打开 Ctrl+O　　保存 Ctrl+S\n" +
                "加粗 Ctrl+B　　斜体 Ctrl+I　　删除线 Ctrl+U　　下划线 Ctrl+Shift+U\n" +
                "行内代码 Ctrl+E　　高亮 Ctrl+Shift+H\n" +
                "链接 Ctrl+K　　表格 Ctrl+T　　代码块 Ctrl+Shift+K\n" +
                "标题 1–6 Ctrl+1…6　　正文 Ctrl+0\n" +
                "查找 Ctrl+F　　替换 Ctrl+H　　跳转行 Ctrl+G\n" +
                "源码模式 Ctrl+/　　侧边栏 Ctrl+\\　　设置 Ctrl+,\n" +
                "命令面板 Ctrl+Shift+P　　全屏 F11",
            }),
        },
        {
          label: "GitHub 仓库",
          icon: "external",
          run: async () => {
            if (!IS_TAURI) return;
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("open_path", { path: "https://github.com/GHaoyun/Markprose" });
          },
        },
        { sep: true },
        { label: "关于 Markprose", icon: "info", run: () => void alertBox({ title: "关于 Markprose", message: "v1.1.0" }) },
      ],
    },
  ];
}

function buildMenuBar() {
  const root = $("#menubar");
  if (!root) return;
  root.innerHTML = "";
  for (const m of menuDefs()) {
    const btn = h("button", { class: "mb-item", text: m.label });
    // 和系统菜单一致：按下鼠标就展开，不依赖 click
    btn.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      showMenuBar(btn, m);
    });
    btn.addEventListener("mouseenter", () => {
      if (mbPanel && mbBtn !== btn) showMenuBar(btn, m);
    });
    root.appendChild(btn);
  }
  document.addEventListener("mousedown", (e) => {
    if (!mbPanel) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("#menubar") || t?.closest(".mb-panel")) return;
    closeMenuBar();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && mbPanel) {
        e.preventDefault();
        closeMenuBar();
      }
    },
    true
  );
}

/* ================= 右键菜单 ================= */
function bindContextMenu() {
  // WebView2 自带的「返回 / 刷新 / 另存为 / 打印」一律屏蔽
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // 编辑区里任意位置右键都出自家菜单，正文下方的留白也算
  $("#editor-host")?.addEventListener("contextmenu", (e) => {
    // CodeMirror 已经在正文上处理过并阻止了默认行为
    if (e.defaultPrevented) return;
    e.preventDefault();
    showEditorMenu(e.clientX, e.clientY);
  });
}

/* ================= 启动 ================= */
async function boot() {
  await loadSettings();
  // 还没确认过保存位置的老用户，也走一次引导（只弹一次）
  const needDirSetup = IS_TAURI && !settings.saveDirChosen;
  // 自动保存改为默认关闭：关窗口/关标签时改成明确问「保存 / 不保存 / 取消」
  if (!settings.autosaveMigrated) {
    settings.autosave = false;
    settings.autosaveMigrated = true;
    persistSettings();
  }
  // 先把「文档\Markprose」定下来并建好，之后新文档直接落在这里
  let defaultDir = "";
  if (!settings.saveDir) {
    try {
      defaultDir = norm(await defaultSaveDir());
      settings.saveDir = defaultDir;
      persistSettings();
    } catch {
      // 定位不到系统文档目录时，保持「留空即用默认」的老行为
    }
  }
  applySettings();
  mountEditor();
  buildToolbar($("#toolbar"), execToolbar);
  buildBubble();
  bindShortcuts();
  await bindWindow();
  buildMenuBar();
  bindContextMenu();

  // 启动时把当前侧栏面板渲染一次，否则「文件」底下是空的，切一次面板才出来
  switchPanel(($(".sb-tab.active") as HTMLElement | null)?.dataset.panel || "files");

  // 注册进系统「打开方式」列表（每次启动刷新一次路径，免安装版换了位置也能对上）
  if (IS_TAURI) void registerFileAssoc().catch(() => {});

  // 把 .md 拖到 exe / 快捷方式图标上启动时，直接打开那个文件
  // 必须 await：否则文件还在读，下面的 syncWelcome 会以为一个标签都没有，
  // 于是把欢迎页盖在刚打开的文件上面（双击 .md 打不开就是这个原因）
  if (IS_TAURI) {
    try {
      for (const f of await startupFiles()) await openPath(f);
    } catch {}
  }

  // 装完第一次启动：问一句文档存哪儿，可以点「浏览」用系统的文件夹选择器
  if (needDirSetup) {
    void folderSetupBox({
      title: "文档保存位置",
      message: "新文档和图片默认保存在：",
      defaultDir: defaultDir || settings.saveDir,
    }).then((picked) => {
      const dir = picked ? norm(picked) : "";
      if (dir) settings.saveDir = dir;
      settings.saveDirChosen = true;
      persistSettings();
    });
  }

  $("#editor-host").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy((e as WheelEvent).deltaY < 0 ? 0.5 : -0.5);
    },
    { passive: false }
  );

  $("#btn-sidebar").onclick = () => toggleSetting("sidebar");
  $("#btn-theme").onclick = () => {
    cycleTheme();
    view.dispatch({ effects: refreshEffect.of(Date.now()) });
  };
  $("#btn-settings").onclick = () => openSettings();
  $("#btn-palette").onclick = () => openPalette();
  $("#settings-close").onclick = () => $("#settings").classList.remove("show");
  $("#settings").addEventListener("mousedown", (e) => {
    if (e.target === $("#settings")) $("#settings").classList.remove("show");
  });
  $("#palette").addEventListener("mousedown", (e) => {
    if (e.target === $("#palette")) closePalette();
  });
  ($("#palette-input") as HTMLInputElement).addEventListener("input", (e) =>
    filterPalette((e.target as HTMLInputElement).value)
  );

  $$(".sb-tab").forEach((b) => (b.onclick = () => switchPanel(b.dataset.panel!)));
  $("#btn-open-folder").onclick = () => void openFolderDialog();
  $("#btn-new-file").onclick = async () => {
    if (!app.workspace) return openFolderDialog();
    const name = await promptBox({
      title: "新建文件",
      message: `在「${basename(app.workspace)}」下新建`,
      value: "新文档.md",
    });
    if (!name) return;
    const p = norm(app.workspace) + "/" + name;
    await createFile(p);
    await reloadTree();
    void openPath(p);
  };
  $("#search-input").addEventListener("input", (e) =>
    runSearch((e.target as HTMLInputElement).value)
  );
  $("#st-mode").onclick = () => toggleSource();

  $("#wc-new").onclick = () => newTab();
  $("#wc-open").onclick = () => void openFileDialog();
  $("#wc-folder").onclick = () => void openFolderDialog();

  window.addEventListener("beforeunload", () => {
    saveSession();
    persistSettings();
  });

  // 拖动打开文件
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) {
      if (!/\.(md|markdown|txt)$/i.test(f.name)) continue;
      const p = (f as any).path as string | undefined;
      if (p) {
        void openPath(p);
      } else {
        try {
          const text = await f.text();
          newTab(text);
        } catch {
          toast("读取拖入的文件失败", "err");
        }
      }
    }
  });

  // 恢复上次的文件夹
  if (settings.lastFolder) {
    try {
      await openWorkspace(settings.lastFolder);
    } catch {}
  }

  // 按设置决定：不保留 / 询问后打开 / 直接打开
  try {
    await maybeRestoreSession();
  } catch {}

  // 欢迎页：按当前是否已有标签决定，避免把刚打开的文件盖住
  syncWelcome();
  refreshStatus();
  renderTabs();

  if (IS_TAURI) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    // 统一走 doClose：点 × 只弹一次确认，Alt+F4 / 任务栏关闭也走同一条路
    w.onCloseRequested((e) => {
      e.preventDefault();
      doClose().catch(() => w.destroy());
    });
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#c00">启动失败：${e?.message || e}</div>`;
});

export {};
