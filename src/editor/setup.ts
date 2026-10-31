import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  ViewPlugin,
  Decoration,
  DecorationSet,
  ViewUpdate,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { livePreview } from "./livepreview";
import { settings } from "../core/settings";
import { docCtx } from "./ctx";
import { saveImage } from "../core/api";

/* ---------- 代码高亮配色 ---------- */
const mokeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], class: "cm-tok-keyword" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: "cm-tok-string" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "cm-tok-number" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: "cm-tok-comment" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "cm-tok-func" },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.attributeName], class: "cm-tok-type" },
  { tag: [tags.operator, tags.punctuation, tags.separator], class: "cm-tok-op" },
  { tag: [tags.propertyName, tags.variableName, tags.definition(tags.variableName)], class: "cm-tok-var" },
  { tag: [tags.invalid], class: "cm-math-error" },
]);

/* ---------- 格式化命令 ---------- */
function wrapSel(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const outerFrom = Math.max(0, from - before.length);
  const outerTo = Math.min(view.state.doc.length, to + after.length);
  const outer = view.state.sliceDoc(outerFrom, outerTo);
  if (outer === before + sel + after) {
    view.dispatch({
      changes: { from: outerFrom, to: outerTo, insert: sel },
      selection: { anchor: outerFrom, head: outerFrom + sel.length },
    });
  } else if (
    sel.length >= before.length + after.length &&
    sel.startsWith(before) &&
    sel.endsWith(after)
  ) {
    const inner = sel.slice(before.length, sel.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + sel + after },
      selection: { anchor: from + before.length, head: from + before.length + sel.length },
    });
  }
  view.focus();
}

/* ---------- 智能格式化：找得到就取消，找不到就套上 ---------- */

export function findNodeAt(view: EditorView, names: string[]) {
  const pos = view.state.selection.main.from;
  for (const bias of [-1, 1] as const) {
    let node: any = syntaxTree(view.state).resolveInner(pos, bias);
    while (node) {
      if (names.includes(node.name)) return node;
      node = node.parent;
    }
  }
  return null;
}

function toggleWrapped(view: EditorView, names: string[], mark: string, placeholder = "文字") {
  const state = view.state;
  const { from, to } = state.selection.main;

  // 1) 语法树里有包裹节点 → 拆掉
  const node = findNodeAt(view, names);
  if (node && node.to - node.from >= mark.length * 2) {
    const raw = state.sliceDoc(node.from, node.to);
    const inner = raw.slice(mark.length, raw.length - mark.length);
    view.dispatch({
      changes: { from: node.from, to: node.to, insert: inner },
      selection: { anchor: node.from, head: node.from + inner.length },
    });
    view.focus();
    return true;
  }

  // 2) 文本层面：选中范围两侧正好是标记 → 拆掉
  const before = state.sliceDoc(Math.max(0, from - mark.length), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + mark.length));
  if (before === mark && after === mark && from !== to) {
    view.dispatch({
      changes: [
        { from: from - mark.length, to: from },
        { from: to, to: to + mark.length },
      ],
      selection: { anchor: from - mark.length, head: to - mark.length },
    });
    view.focus();
    return true;
  }

  // 3) 没有选区：光标在格式里（或紧跟在闭合标记右边）就取消它，否则什么都不做
  if (from === to) {
    const line = state.doc.lineAt(from);
    const before = state.sliceDoc(line.from, from);

    // A) 光标紧跟在闭合标记右边（刚套完格式的情况）
    if (before.endsWith(mark)) {
      const cut = before.slice(0, before.length - mark.length);
      const openIdx = cut.lastIndexOf(mark);
      if (openIdx >= 0) {
        const inner = cut.slice(openIdx + mark.length);
        if (!inner.includes(mark)) {
          const a = line.from + openIdx;
          view.dispatch({
            changes: { from: a, to: from, insert: inner },
            selection: { anchor: a + inner.length },
          });
          view.focus();
          return true;
        }
      }
    }

    // B) 光标在标记内部
    const cnt = before.split(mark).length - 1;
    if (cnt % 2 === 1) {
      const openIdx = before.lastIndexOf(mark);
      const after = state.sliceDoc(from, line.to);
      const closeIdx = after.indexOf(mark);
      if (openIdx >= 0 && closeIdx >= 0) {
        const a = line.from + openIdx;
        const b = from + closeIdx + mark.length;
        const inner = state.sliceDoc(a + mark.length, b - mark.length);
        if (!inner.includes(mark)) {
          view.dispatch({
            changes: { from: a, to: b, insert: inner },
            selection: { anchor: a + inner.length },
          });
          view.focus();
          return true;
        }
      }
    }
    view.focus();
    return true;
  }
  const text = state.sliceDoc(from, to);

  // 3a) 跨行选区：逐行包裹（行内标记跨行渲染不出来）
  if (text.includes("\n")) {
    const changes: { from: number; to: number; insert: string }[] = [];
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n);
      const a = n === startLine ? from : line.from;
      const b = n === endLine ? to : line.to;
      const t = state.sliceDoc(a, b);
      if (!t.trim()) continue;
      const ld = /^\s*/.exec(t)![0];
      const tr = /\s*$/.exec(t)![0];
      const core = t.slice(ld.length, t.length - tr.length);
      changes.push({ from: a, to: b, insert: ld + mark + core + mark + tr });
    }
    if (changes.length) view.dispatch({ changes });
    view.focus();
    return true;
  }

  // 3b) 去掉选区首尾空白，让标记紧贴文字，否则 ~~ 文字 ~~ 渲染不出来
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) {
    view.focus();
    return true;
  }
  view.dispatch({
    changes: { from, to, insert: lead + mark + core + mark + trail },
    // 光标停在「闭合标记的右边」：这样换行、继续打字都不会把标记拆开
    selection: { anchor: from + lead.length + mark.length + core.length + mark.length },
  });
  view.focus();
  return true;
}

export const cmdBold = (v: EditorView) => toggleWrapped(v, ["StrongEmphasis"], "**", "粗体");
export const cmdItalic = (v: EditorView) => toggleWrapped(v, ["Emphasis"], "*", "斜体");
export const cmdStrike = (v: EditorView) => toggleWrapped(v, ["Strikethrough"], "~~", "删除线");
export const cmdCode = (v: EditorView) => toggleWrapped(v, ["InlineCode"], "`", "代码");
export const cmdMark = (v: EditorView) => toggleWrapped(v, ["Highlight"], "==", "高亮");
export const cmdMath = (v: EditorView) => toggleWrapped(v, ["InlineMath"], "$", "x");

/* ---------- 代码块 ---------- */
export function cmdCodeBlock(view: EditorView) {
  const state = view.state;
  const pos = state.selection.main.head;
  let node: any = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedCode") {
      const after = Math.min(state.doc.length, node.to + 1);
      view.dispatch({
        selection: { anchor: after },
        effects: EditorView.scrollIntoView(after, { y: "nearest" }),
      });
      view.focus();
      return true;
    }
    node = node.parent;
  }
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  const before = line.text.trim() !== "" ? "\n\n" : "";
  const text = before + "```\n\n```" + "\n";
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + before.length + 4 },
  });
  view.focus();
  return true;
}

/* ---------- 块级：列表 / 引用 ---------- */

const STRIP_PREFIX = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+|>\s?)/;

export function cmdList(view: EditorView, kind: "ul" | "ol" | "task") {
  const state = view.state;
  const sel = state.selection.main;
  const l1 = state.doc.lineAt(sel.from).number;
  const l2 = state.doc.lineAt(sel.to).number;
  const matcher =
    kind === "ul"
      ? /^(\s*)[-*+]\s+(?!\[)/
      : kind === "ol"
        ? /^(\s*)\d{1,9}[.)]\s+/
        : /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
  let allMatch = true;
  for (let n = l1; n <= l2; n++) if (!matcher.test(state.doc.line(n).text)) allMatch = false;

  const changes: { from: number; to: number; insert: string }[] = [];
  let caret = -1;
  let i = 0;
  for (let n = l1; n <= l2; n++) {
    const line = state.doc.line(n);
    const m = STRIP_PREFIX.exec(line.text);
    const indent = m ? m[1] : "";
    const oldPrefixLen = m ? m[0].length : 0;
    const body = m ? line.text.slice(m[0].length) : line.text;
    let prefix = "";
    if (!allMatch) {
      prefix = kind === "ul" ? "- " : kind === "ol" ? `${++i}. ` : "- [ ] ";
    }
    changes.push({ from: line.from, to: line.from + line.text.length, insert: indent + prefix + body });
    if (l1 === l2) {
      // 光标保持在原来的文字位置，落在序号右边而不是左边
      const offset = Math.max(0, sel.head - line.from - oldPrefixLen);
      caret = line.from + indent.length + prefix.length + Math.min(offset, body.length);
    }
  }
  view.dispatch({ changes, ...(caret >= 0 ? { selection: { anchor: caret } } : {}) });
  view.focus();
  return true;
}

export function cmdQuote(view: EditorView) {
  const state = view.state;
  const sel = state.selection.main;
  const l1 = state.doc.lineAt(sel.from).number;
  const l2 = state.doc.lineAt(sel.to).number;
  let allQuoted = true;
  for (let n = l1; n <= l2; n++) if (!/^\s{0,3}>/.test(state.doc.line(n).text)) allQuoted = false;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = l1; n <= l2; n++) {
    const line = state.doc.line(n);
    if (allQuoted) {
      const m = /^(\s{0,3})>\s?/.exec(line.text);
      const cut = m ? m[0].length : 0;
      changes.push({ from: line.from, to: line.from + cut, insert: m ? m[1] : "" });
    } else {
      changes.push({ from: line.from, to: line.from, insert: "> " });
    }
  }
  view.dispatch({ changes });
  view.focus();
  return true;
}

export function cmdHr(view: EditorView) {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const atEnd = line.to === sel.from;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: (atEnd ? "\n\n---\n" : "\n\n---\n\n") },
    selection: { anchor: sel.from + (atEnd ? 5 : 6) },
  });
  view.focus();
  return true;
}

export function cmdToc(view: EditorView) {
  insertSnippet(view, "\n[TOC]\n");
  return true;
}

export function cmdHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = /^(\s{0,3})(#{1,6})(\s*)/.exec(line.text);
  const strip = m ? m[0].length : 0;
  const cur = m ? m[2].length : 0;
  const prefix = level === cur ? "" : level > 0 ? "#".repeat(level) + " " : "";
  view.dispatch({ changes: { from: line.from, to: line.from + strip, insert: prefix } });
  view.focus();
  return true;
}

export function cmdLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to) || "链接文字";
  const insert = `[${sel}](https://)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + sel.length + 3, head: from + insert.length - 1 },
  });
  view.focus();
  return true;
}

export function insertSnippet(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

export const TABLE_SNIPPET = `\n| 列 1 | 列 2 | 列 3 |\n| --- | :---: | ---: |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n`;
export const CODE_SNIPPET = "```\n\n```";
export const MATH_SNIPPET = "\n$$\n\n$$\n";
export const MERMAID_SNIPPET = "```mermaid\ngraph LR\n  A[开始] --> B{判断}\n  B -->|是| C[结束]\n```";

/* ---------- 图片粘贴 / 拖入 ---------- */
async function insertImageFile(view: EditorView, file: File, pos?: number) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as any);
  }
  const b64 = btoa(bin);
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const rel = await saveImage(docCtx.dir || ".", b64, ext);
  const alt = file.name.replace(/\.[^.]+$/, "");
  const snippet = `![${alt}](${rel})`;
  const at = pos ?? view.state.selection.main.head;
  view.dispatch({
    changes: { from: at, insert: snippet },
    selection: { anchor: at + snippet.length },
  });
  view.focus();
}

const imageHandlers = EditorView.domEventHandlers({
  contextmenu(e) {
    if (!editorHooks.onContextMenu) return false;
    e.preventDefault();
    editorHooks.onContextMenu(e.clientX, e.clientY);
    return true;
  },
  paste(e, view) {
    const items = Array.from(e.clipboardData?.items || []);
    const img = items.find((i) => i.type.startsWith("image/"));
    if (!img) return false;
    const file = img.getAsFile();
    if (!file) return false;
    e.preventDefault();
    insertImageFile(view, file).catch((err) => console.error(err));
    return true;
  },
  drop(e, view) {
    const files = Array.from(e.dataTransfer?.files || []);
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    (async () => {
      let at = pos;
      for (const f of imgs) {
        await insertImageFile(view, f, at);
        at = view.state.selection.main.head;
      }
    })();
    return true;
  },
});

/* ---------- 专注模式高亮当前行 ---------- */
const focusModePlugin = ViewPlugin.fromClass(
  class {
    decos: DecorationSet;
    constructor(view: EditorView) {
      this.decos = this.build(view);
    }
    build(view: EditorView) {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const arr = [Decoration.line({ class: "cm-focus-active" }).range(line.from)];
      if (line.number > 1)
        arr.push(Decoration.line({ class: "cm-focus-near" }).range(view.state.doc.line(line.number - 1).from));
      if (line.number < view.state.doc.lines)
        arr.push(Decoration.line({ class: "cm-focus-near" }).range(view.state.doc.line(line.number + 1).from));
      return Decoration.set(arr, true);
    }
    update(u: any) {
      if (u.selectionSet || u.docChanged) this.decos = this.build(u.view);
    }
  },
  { decorations: (v: any) => v.decos }
);

/* ---------- 状态 ---------- */
export const sourceComp = new Compartment();
export const gutterComp = new Compartment();
export const editorHooks: { onChange?: (u: ViewUpdate) => void; onContextMenu?: (x: number, y: number) => void } = {};

export function setLineNumbers(view: EditorView, on: boolean) {
  view.dispatch({
    effects: gutterComp.reconfigure(on ? lineNumbers() : []),
  });
}

export function createState(doc: string, path: string | null): EditorState {
  docCtx.path = path;
  docCtx.dir = path ? path.replace(/[\\/][^\\/]+$/, "") : "";
  return EditorState.create({
    doc,
    extensions: [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(mokeHighlight),
      sourceComp.of(settings.sourceMode ? [] : livePreview),
      gutterComp.of(settings.lineNumbers ? lineNumbers() : []),
      focusModePlugin,
      imageHandlers,
      EditorView.updateListener.of((u) => editorHooks.onChange?.(u)),
      keymap.of([
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...markdownKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
    ],
  });
}

export { insertImageFile };
