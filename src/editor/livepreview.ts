import { EditorState, Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import katex from "katex";
import { escapeHtml, isAbsolutePath, norm } from "../core/util";
import { readImageDataUrl } from "../core/api";
import { docCtx } from "./ctx";
import { closeTablePanel, openTablePanel, type TableModel } from "../ui/tablePanel";

export const refreshEffect = StateEffect.define<number>();

/** 公式编辑回调，由外层设置（避免与 setup.ts 形成循环依赖） */
export const mathHooks: {
  onEdit?: (tex: string, block: boolean, from: number, to: number) => void;
} = {};

type Span = [number, number];

/* ================= 缓存 ================= */
const katexCache = new Map<string, string>();
const mermaidCache = new Map<string, string>();
let mermaidMod: any = null;
let mermaidSeq = 0;

function renderKatex(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  const hit = katexCache.get(key);
  if (hit !== undefined) return hit;
  let html = "";
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: true,
    });
  } catch (e: any) {
    html = `<span class="cm-math-error">${escapeHtml(String(e?.message || e))}</span>`;
  }
  if (katexCache.size > 600) katexCache.clear();
  katexCache.set(key, html);
  return html;
}

const isDark = () => /ink|midnight/.test(document.documentElement.dataset.theme || "");

const EMOJI: Record<string, string> = Object.fromEntries(
  "smile 😄|smiley 😃|grin 😁|joy 😂|laughing 😆|laugh 😆|wink 😉|blush 😊|heart_eyes 😍|thinking 🤔|neutral_face 😐|smirk 😏|sweat_smile 😅|sob 😭|disappointed 😞|cry 😢|angry 😠|rage 😡|scream 😱|sleeping 😴|dizzy_face 😵|thumbsup 👍|+1 👍|thumbsdown 👎|-1 👎|ok_hand 👌|clap 👏|pray 🙏|wave 👋|muscle 💪|point_right 👉|point_left 👈|eyes 👀|fire 🔥|star ⭐|sparkles ✨|boom 💥|zap ⚡|sunny ☀️|moon 🌙|cloud ☁️|umbrella ☔|snowflake ❄️|coffee ☕|beer 🍺|cake 🍰|apple 🍎|gift 🎁|bulb 💡|book 📖|books 📚|pencil ✏️|memo 📝|computer 💻|iphone 📱|email ✉️|lock 🔒|key 🔑|check ✅|white_check_mark ✅|x ❌|warning ⚠️|question ❓|exclamation ❗|rocket 🚀|tada 🎉|heart ❤️|broken_heart 💔|100 💯|dog 🐶|cat 🐱|panda 🐼|rose 🌹|evergreen_tree 🌲|musical_note 🎵|movie_camera 🎬|camera 📷|clock 🕐|calendar 📅|chart_with_upwards_trend 📈|moneybag 💰|bug 🐛|gear ⚙️|link 🔗|pushpin 📌|triangular_flag_on_post 🚩|trophy 🏆|medal_sports 🏅|crown 👑|gem 💎|bell 🔔|mega 📣|speech_balloon 💬|hourglass ⏳|ok ✅|no_entry ⛔|seedling 🌱|maple_leaf 🍁|soccer ⚽|basketball 🏀|airplane ✈️|car 🚗|house 🏠|office 🏢"
    .split("|")
    .map((s) => {
      const i = s.indexOf(" ");
      return [s.slice(0, i), s.slice(i + 1)] as [string, string];
    })
);

class EmojiWidget extends WidgetType {
  constructor(readonly ch: string) {
    super();
  }
  eq(o: EmojiWidget) {
    return o.ch === this.ch;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-emoji";
    s.textContent = this.ch;
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

/* ================= Widgets ================= */

class BulletWidget extends WidgetType {
  constructor(readonly ch: string) {
    super();
  }
  eq(o: BulletWidget) {
    return o.ch === this.ch;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = this.ch;
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }
  eq(o: TaskWidget) {
    return o.checked === this.checked && o.from === this.from && o.to === this.to;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-task-widget" + (this.checked ? " checked" : "");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = view.state.doc.sliceString(this.from, this.to);
      const next = raw.replace(/\[[ xX]\]/, this.checked ? "[ ]" : "[x]");
      if (next !== raw) view.dispatch({ changes: { from: this.from, to: this.to, insert: next } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class HrWidget extends WidgetType {
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-hr-widget";
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
    readonly to: number,
    readonly width: number = 0
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.width === this.width;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-img-widget loading";
    wrap.textContent = this.alt || "加载图片…";
    readImageDataUrl(this.src).then((url) => {
      if (!url) {
        wrap.textContent = `⚠ 图片未找到：${this.alt || this.src}`;
        return;
      }
      const img = document.createElement("img");
      img.src = url;
      img.alt = this.alt;
      if (this.width > 0) {
        img.style.width = `${this.width}px`;
        img.style.height = "auto";
      }
      wrap.classList.remove("loading");
      wrap.textContent = "";
      wrap.appendChild(img);
    });
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from, head: this.to } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class InlineMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }
  eq(o: InlineMathWidget) {
    return o.tex === this.tex;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = "cm-math-inline";
    s.title = "右键或双击编辑公式";
    s.innerHTML = renderKatex(this.tex, false);
    s.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from, head: this.to } });
      view.focus();
    });
    const edit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      mathHooks.onEdit?.(this.tex, false, this.from, this.to);
    };
    s.addEventListener("contextmenu", edit);
    s.addEventListener("dblclick", edit);
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class BlockMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly from: number,
    readonly to: number = from
  ) {
    super();
  }
  eq(o: BlockMathWidget) {
    return o.tex === this.tex;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("div");
    s.className = "cm-math-block";
    s.title = "右键或双击编辑公式";
    s.innerHTML = renderKatex(this.tex, true);
    s.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });
    const edit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      mathHooks.onEdit?.(this.tex, true, this.from, this.to);
    };
    s.addEventListener("contextmenu", edit);
    s.addEventListener("dblclick", edit);
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly from: number,
    readonly dark: boolean
  ) {
    super();
  }
  eq(o: MermaidWidget) {
    return o.code === this.code && o.dark === this.dark;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("div");
    s.className = "cm-mermaid";
    s.textContent = "渲染图表…";
    const key = (this.dark ? "d:" : "l:") + this.code;
    const cached = mermaidCache.get(key);
    if (cached) {
      s.innerHTML = cached;
    } else {
      (async () => {
        try {
          if (!mermaidMod) mermaidMod = (await import("mermaid")).default;
          mermaidMod.initialize({
            startOnLoad: false,
            theme: this.dark ? "dark" : "neutral",
            securityLevel: "loose",
          });
          const { svg } = await mermaidMod.render("mmd" + ++mermaidSeq, this.code);
          if (mermaidCache.size > 80) mermaidCache.clear();
          mermaidCache.set(key, svg);
          s.innerHTML = svg;
        } catch (e: any) {
          s.innerHTML = `<div class="cm-mermaid-err">图表语法错误\n${escapeHtml(
            String(e?.message || e)
          )}</div>`;
        }
      })();
    }
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class CodeLangWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }
  eq(o: CodeLangWidget) {
    return o.lang === this.lang && o.code === this.code && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = "cm-code-lang";
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = this.lang || "text";
    s.appendChild(pill);
    const copy = document.createElement("span");
    copy.className = "cm-copy-code";
    copy.textContent = "复制";
    copy.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copy.textContent = "已复制";
        setTimeout(() => (copy.textContent = "复制"), 1200);
      });
    });
    s.appendChild(copy);
    s.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).classList?.contains("cm-copy-code")) return;
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from, head: this.to } });
      view.focus();
    });
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly model: TableModel,
    readonly from: number
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.html === this.html;
  }
  toDOM(view: EditorView) {
    const block = document.createElement("div");
    block.className = "cm-table-block";
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";
    wrap.innerHTML = this.html;

    const tools = document.createElement("div");
    tools.className = "cm-table-tools";

    const sizeBtn = document.createElement("button");
    sizeBtn.textContent = "行 / 列";
    sizeBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTablePanel({
        anchor: sizeBtn.getBoundingClientRect(),
        model: this.model,
        onChange: (m) => replaceTableBlock(view, this.from, tableToMd(m)),
        onDelete: () => replaceTableBlock(view, this.from, ""),
      });
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = "编辑源码";
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTablePanel();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });

    tools.append(sizeBtn, editBtn);
    block.append(tools, wrap);
    return block;
  }
  ignoreEvent() {
    return true;
  }
}

class TocWidget extends WidgetType {
  constructor(
    readonly items: { level: number; text: string; pos: number }[],
    readonly from: number
  ) {
    super();
  }
  eq(o: TocWidget) {
    return JSON.stringify(o.items) === JSON.stringify(this.items);
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-toc";
    const title = document.createElement("div");
    title.className = "cm-toc-title";
    title.textContent = "目录";
    box.appendChild(title);
    if (!this.items.length) {
      const empty = document.createElement("div");
      empty.style.color = "var(--text-faint)";
      empty.textContent = "（这篇文档还没有标题）";
      box.appendChild(empty);
    }
    for (const it of this.items) {
      const a = document.createElement("a");
      a.className = "l" + it.level;
      a.textContent = it.text || "（空标题）";
      a.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({
          selection: { anchor: it.pos },
          effects: EditorView.scrollIntoView(it.pos, { y: "start", yMargin: 40 }),
        });
        view.focus();
      });
      box.appendChild(a);
    }
    box.addEventListener("mousedown", (e) => {
      if (e.target === box) {
        e.preventDefault();
        view.dispatch({ selection: { anchor: this.from } });
        view.focus();
      }
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class DoneWidget extends WidgetType {
  constructor(readonly pos: number) {
    super();
  }
  eq(o: DoneWidget) {
    return o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = "cm-table-done";
    s.textContent = "✓ 完成";
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = Math.min(view.state.doc.length, this.pos + 1);
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "nearest" }),
      });
      view.focus();
    });
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

/* ================= 表格解析 ================= */

function splitRow(l: string): string[] {
  let s = l.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const escCell = (s: string) => s.replace(/\|/g, "\\|");

function inlineMd(s: string): string {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return h;
}

const DELIM_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const FENCE_RE = /^(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;

function parseTable(lines: string[]): TableModel | null {
  if (lines.length < 2 || !DELIM_RE.test(lines[1])) return null;
  const header = splitRow(lines[0]);
  const delims = splitRow(lines[1]);
  if (header.length !== delims.length) return null;
  const aligns = delims.map((d) => {
    const l = d.startsWith(":");
    const r = d.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const rows = lines.slice(2).map(splitRow);
  return { header, aligns, rows };
}

const cellHtml = (s: string) => inlineMd(s) || "&#8203;";

function tableHtml(m: TableModel): string {
  let html = "<table class='md-table'><thead><tr>";
  m.header.forEach((c, i) => {
    html += `<th style="text-align:${m.aligns[i] || "left"}">${cellHtml(c)}</th>`;
  });
  html += "</tr></thead><tbody>";
  for (const r of m.rows) {
    html += "<tr>";
    for (let i = 0; i < m.header.length; i++) {
      html += `<td style="text-align:${m.aligns[i] || "left"}">${cellHtml(r[i] ?? "")}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function tableToMd(m: TableModel): string {
  const row = (cells: string[]) =>
    "| " + m.header.map((_, i) => escCell(cells[i] ?? "")).join(" | ") + " |";
  const delim = m.aligns
    .map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"))
    .join(" | ");
  return [row(m.header), "| " + delim + " |", ...m.rows.map((r) => row(r))].join("\n");
}

/** 用新的 markdown 替换掉从 from 开始的整张表格 */
function replaceTableBlock(view: EditorView, from: number, md: string) {
  const doc = view.state.doc;
  const start = doc.lineAt(from);
  let endLine = start.number;
  while (
    endLine + 1 <= doc.lines &&
    doc.line(endLine + 1).text.includes("|") &&
    doc.line(endLine + 1).text.trim() !== ""
  ) {
    endLine++;
  }
  const end = doc.line(endLine).to;
  if (md === "") {
    let to = end;
    if (to < doc.length && doc.sliceString(to, to + 1) === "\n") to++;
    view.dispatch({ changes: { from: start.from, to, insert: "" } });
  } else {
    view.dispatch({ changes: { from: start.from, to: end, insert: md } });
  }
}

/* ================= 工具 ================= */

function overlaps(list: Span[], from: number, to: number) {
  for (const [a, b] of list) if (from < b && to > a) return true;
  return false;
}

function contained(list: Span[], from: number, to: number) {
  for (const [a, b] of list) if (from >= a && to <= b) return true;
  return false;
}

function resolveSrc(src: string): string {
  const s = src.trim().replace(/^<|>$/g, "");
  if (/^(https?:|data:|file:)/i.test(s)) return s;
  if (isAbsolutePath(s)) return norm(s);
  if (!docCtx.dir) return s;
  return norm(docCtx.dir + "/" + s.replace(/^\.\//, ""));
}

/** 从 HTML 属性串里取一个属性值 */
function attrOf(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}

/** 只放行颜色类样式，其余一律丢弃 */
function safeInlineStyle(style: string): string {
  const out: string[] = [];
  const re = /(?:^|;)\s*(background-color|color)\s*:\s*([^;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(style))) {
    const v = m[2].trim();
    if (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(v)) {
      out.push(`${m[1].toLowerCase()}: ${v}`);
    }
  }
  return out.join("; ");
}

/** Markdown 图片地址后面可以跟 "标题"，解析时要去掉 */
function splitImgSrc(raw: string): string {
  return raw
    .trim()
    .replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/, "")
    .trim();
}

/* ============================================================
   块级 + 行级装饰：必须由 StateField 提供
   （CodeMirror 6：block 装饰不能来自 ViewPlugin，行装饰也属 block 类）
   ============================================================ */

interface BlockState {
  decos: DecorationSet;
  ranges: Span[];
  codeRanges: Span[];
  blocks: { from: number; to: number; kind: "table" | "math" | "mermaid" }[];
}

const lineDeco = (cls: string, pos: number) => Decoration.line({ class: cls }).range(pos);

function scanDoc(state: EditorState): BlockState {
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const ranges: Span[] = [];
  const codeRanges: Span[] = [];
  const blocks: { from: number; to: number; kind: "table" | "math" | "mermaid" }[] = [];
  const empty: BlockState = { decos: Decoration.none, ranges, codeRanges, blocks };
  if (doc.lines > 30000) return empty;

  const sels = state.selection.ranges;
  const touching = (f: number, t: number) => sels.some((r) => r.from <= t && r.to >= f);
  const dark = isDark();

  // YAML 头信息：文档开头 --- ... ---
  let startLine = 1;
  if (doc.lines >= 3 && doc.line(1).text.trim() === "---") {
    for (let k = 2; k <= Math.min(80, doc.lines); k++) {
      const tt = doc.line(k).text.trim();
      if (tt === "---" || tt === "...") {
        for (let j = 1; j <= k; j++) decos.push(lineDeco("cm-frontmatter", doc.line(j).from));
        decos.push(lineDeco("cm-fm-first", doc.line(1).from));
        decos.push(lineDeco("cm-fm-last", doc.line(k).from));
        startLine = k + 1;
        break;
      }
    }
  }

  let n = startLine;
  let fence: { marker: string; start: number } | null = null;

  while (n <= doc.lines) {
    const line = doc.line(n);
    const text = line.text;
    const t = text.trim();

    /* --- 围栏代码块内部 --- */
    if (fence) {
      if (t.startsWith(fence.marker) && new RegExp(`^${fence.marker[0]}{3,}\\s*$`).test(t)) {
        codeRanges.push([doc.line(fence.start).from, line.to]);
        decos.push(lineDeco("cm-fence-line cm-fence-close", line.from));
        if (n - 1 >= fence.start + 1) {
          decos.push(lineDeco("cm-code-first", doc.line(fence.start + 1).from));
          decos.push(lineDeco("cm-code-last", doc.line(n - 1).from));
        }
        fence = null;
        n++;
        continue;
      }
      decos.push(lineDeco("cm-code-line", line.from));
      n++;
      continue;
    }

    /* --- 围栏开始 --- */
    const fm = FENCE_RE.exec(t);
    if (fm) {
      const marker = fm[1];
      const lang = (fm[2] || "").toLowerCase();
      // 找闭合围栏
      let end = -1;
      for (let k = n + 1; k <= Math.min(n + 2000, doc.lines); k++) {
        const tt = doc.line(k).text.trim();
        if (tt.startsWith(marker[0].repeat(3)) && /^(`{3,}|~{3,})\s*$/.test(tt)) {
          end = k;
          break;
        }
      }
      // mermaid → 整块替换
      if (lang === "mermaid" && end > 0) {
        const endLine = doc.line(end);
        blocks.push({ from: line.from, to: endLine.to, kind: "mermaid" });
        if (!touching(line.from, endLine.to)) {
          const code =
            end - 1 >= n + 1 ? doc.sliceString(doc.line(n + 1).from, doc.line(end - 1).to) : "";
          ranges.push([line.from, endLine.to]);
          codeRanges.push([line.from, endLine.to]);
          decos.push(
            Decoration.replace({
              widget: new MermaidWidget(code, line.from, dark),
              block: true,
            }).range(line.from, endLine.to)
          );
          n = end + 1;
          continue;
        }
      }
      decos.push(lineDeco("cm-fence-line cm-fence-open", line.from));
      fence = { marker, start: n };
      n++;
      continue;
    }

    /* --- $$ 块级公式 --- */
    if (t === "$$") {
      let end = -1;
      for (let k = n + 1; k <= Math.min(n + 400, doc.lines); k++) {
        if (doc.line(k).text.trim() === "$$") {
          end = k;
          break;
        }
      }
      if (end > 0) {
        const endLine = doc.line(end);
        blocks.push({ from: line.from, to: endLine.to, kind: "math" });
        if (!touching(line.from, endLine.to)) {
          const tex = doc.sliceString(line.to, endLine.from).trim();
          ranges.push([line.from, endLine.to]);
          decos.push(
            Decoration.replace({
              widget: new BlockMathWidget(tex, line.from, endLine.to),
              block: true,
            }).range(line.from, endLine.to)
          );
          n = end + 1;
          continue;
        }
      }
    }

    /* --- GFM 表格 --- */
    if (text.includes("|") && n + 1 <= doc.lines && DELIM_RE.test(doc.line(n + 1).text)) {
      let end = n + 1;
      while (
        end + 1 <= doc.lines &&
        doc.line(end + 1).text.includes("|") &&
        doc.line(end + 1).text.trim() !== ""
      ) {
        end++;
      }
      const lines: string[] = [];
      for (let k = n; k <= end; k++) lines.push(doc.line(k).text);
      const model = parseTable(lines);
      if (model) {
        const endLine = doc.line(end);
        blocks.push({ from: line.from, to: endLine.to, kind: "table" });
        if (!touching(line.from, endLine.to)) {
          ranges.push([line.from, endLine.to]);
          decos.push(
            Decoration.replace({
              widget: new TableWidget(tableHtml(model), model, line.from),
              block: true,
            }).range(line.from, endLine.to)
          );
          n = end + 1;
          continue;
        }
      }
    }

    /* --- [TOC] 目录 --- */
    if (/^\[toc\]$/i.test(t)) {
      if (!touching(line.from, line.to)) {
        const items: { level: number; text: string; pos: number }[] = [];
        for (let k = 1; k <= doc.lines; k++) {
          const ln = doc.line(k);
          const m = /^(#{1,6})\s+(.*)$/.exec(ln.text);
          if (m) items.push({ level: m[1].length, text: m[2].trim(), pos: ln.from });
        }
        ranges.push([line.from, line.to]);
        decos.push(
          Decoration.replace({
            widget: new TocWidget(items, line.from),
            block: true,
          }).range(line.from, line.to)
        );
      }
      n++;
      continue;
    }

    /* --- 脚注定义 --- */
    if (/^\[\^[^\]]+\]:/.test(text)) {
      decos.push(lineDeco("cm-footnote-def", line.from));
      n++;
      continue;
    }

    /* --- 四空格缩进代码块 --- */
    const prevLine = n > startLine ? doc.line(n - 1) : null;
    const prevBlank = !prevLine || prevLine.text.trim() === "";
    const prevIsList = !!prevLine && /^\s*([-*+]|\d{1,9}[.)])\s/.test(prevLine.text);
    if (/^( {4}|\t)/.test(text) && prevBlank && !prevIsList) {
      let end = n;
      while (end + 1 <= doc.lines) {
        const nt = doc.line(end + 1).text;
        if (/^( {4}|\t)/.test(nt) || nt.trim() === "") end++;
        else break;
      }
      while (end > n && doc.line(end).text.trim() === "") end--;
      const endLine = doc.line(end);
      codeRanges.push([line.from, endLine.to]);
      for (let k = n; k <= end; k++) decos.push(lineDeco("cm-code-line", doc.line(k).from));
      decos.push(lineDeco("cm-code-first", line.from));
      decos.push(lineDeco("cm-code-last", endLine.from));
      n = end + 1;
      continue;
    }

    /* --- 引用式链接定义 [id]: url --- */
    if (/^ {0,3}\[[^\]^][^\]]*\]:\s*\S+/.test(text)) {
      decos.push(lineDeco("cm-footnote-def", line.from));
      n++;
      continue;
    }

    /* --- Setext 标题：下一行是 === 或 --- --- */
    if (
      n + 1 <= doc.lines &&
      t !== "" &&
      !/^(#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|\||```|~~~|\$\$|<)/.test(t)
    ) {
      const under = doc.line(n + 1).text;
      const sm = /^ {0,3}(=+|-{2,})\s*$/.exec(under);
      if (sm) {
        decos.push(lineDeco(sm[1][0] === "=" ? "cm-h1" : "cm-h2", line.from));
        const ul = doc.line(n + 1);
        decos.push(lineDeco("cm-setext-mark", ul.from));
        decos.push(Decoration.replace({}).range(ul.from, ul.to));
        ranges.push([ul.from, ul.to]);
        n += 2;
        continue;
      }
    }

    /* --- 标题 --- */
    const hm = /^(\s{0,3})(#{1,6})(\s|$)/.exec(text);
    if (hm) {
      decos.push(lineDeco(`cm-h${hm[2].length}`, line.from));
      n++;
      continue;
    }

    /* --- 引用 --- */
    if (/^\s{0,3}>/.test(text)) {
      decos.push(lineDeco("cm-quote", line.from));
      n++;
      continue;
    }

    /* --- 列表 --- */
    if (/^[ \t]*([-*+]|\d{1,9}[.)])[ \t]+/.test(text)) {
      decos.push(lineDeco("cm-list-line", line.from));
      n++;
      continue;
    }

    n++;
  }

  // 未闭合的围栏：给最后一行收尾
  if (fence) {
    codeRanges.push([doc.line(fence.start).from, doc.line(doc.lines).to]);
    if (doc.lines >= fence.start + 1) {
      decos.push(lineDeco("cm-code-first", doc.line(fence.start + 1).from));
      decos.push(lineDeco("cm-code-last", doc.line(doc.lines).from));
    }
  }

  let set = Decoration.none;
  try {
    if (decos.length) set = Decoration.set(decos, true);
  } catch (e) {
    console.warn("[moke] 块级装饰失败", e);
    return { decos: Decoration.none, ranges: [], codeRanges: [], blocks: [] };
  }
  return { decos: set, ranges, codeRanges, blocks };
}

const blockField = StateField.define<BlockState>({
  create: (state) => scanDoc(state),
  update: (val, tr) =>
    tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshEffect))
      ? scanDoc(tr.state)
      : val,
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

/* ============================================================
   行内装饰：ViewPlugin（只产生 mark 与单行 replace）
   ============================================================ */

export function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const replaced: Span[] = [];
  const hidden: Span[] = [];
  const inlineCode: Span[] = [];
  const sels = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const touching = (from: number, to: number) => sels.some((r) => r.from <= to && r.to >= from);
  // 关键：只有「选中」这段内容时才露出源码；光标停在里面也保持渲染结果。
  // 这样用户永远不需要看到 ** ~~ ` 这些符号，加粗靠按钮/快捷键完成。
  const reveal = (from: number, to: number) =>
    sels.some((r) => r.from !== r.to && r.from <= from && r.to >= to);

  const bs = state.field(blockField, false);
  const codeRanges = bs ? bs.codeRanges : [];
  if (bs) for (const s of bs.ranges) replaced.push(s);

  const vis = view.visibleRanges;
  if (!vis.length) return Decoration.none;
  const vFrom = vis[0].from;
  const vTo = vis[vis.length - 1].to;
  const firstLine = doc.lineAt(vFrom).number;
  const lastLine = doc.lineAt(vTo).number;

  const hide = (from: number, to: number) => {
    if (to > from) {
      decos.push(Decoration.replace({}).range(from, to));
      hidden.push([from, to]);
    }
  };

  /* ---- 语法树：行内元素 ---- */
  try {
    syntaxTree(state).iterate({
      from: vFrom,
      to: vTo,
      enter: (node) => {
        const name = node.name;
        const from = node.from;
        const to = node.to;
        if (contained(replaced, from, to) || contained(codeRanges, from, to)) return false;
        // 祖先节点只是部分重叠：继续下钻，但自身不做装饰
        if (overlaps(replaced, from, to) || overlaps(codeRanges, from, to)) return true;

        if (name === "StrongEmphasis") {
          if (!reveal(from, to) && to - from > 4) {
            decos.push(Decoration.mark({ class: "cm-strong" }).range(from + 2, to - 2));
            hide(from, from + 2);
            hide(to - 2, to);
          }
          return true;
        }
        if (name === "Emphasis") {
          if (!reveal(from, to) && to - from > 2) {
            decos.push(Decoration.mark({ class: "cm-em" }).range(from + 1, to - 1));
            hide(from, from + 1);
            hide(to - 1, to);
          }
          return true;
        }
        if (name === "Strikethrough") {
          // 由行内正则统一处理，这里跳过避免重复装饰
          return false;
        }
        if (name === "InlineCode") {
          const raw = doc.sliceString(from, to);
          const m = /^(`+)([\s\S]*)\1$/.exec(raw);
          inlineCode.push([from, to]);
          if (m && !reveal(from, to)) {
            const k = m[1].length;
            decos.push(Decoration.mark({ class: "cm-inline-code" }).range(from + k, to - k));
            hide(from, from + k);
            hide(to - k, to);
          }
          return false;
        }
        if (name === "Image") {
          const raw = doc.sliceString(from, to);
          const m = /^!\[([\s\S]*?)\]\(\s*([\s\S]*?)\s*\)$/.exec(raw);
          if (m && !reveal(from, to)) {
            replaced.push([from, to]);
            decos.push(
              Decoration.replace({
                widget: new ImageWidget(resolveSrc(splitImgSrc(m[2])), m[1], from, to),
              }).range(from, to)
            );
            return false;
          }
          return false;
        }
        if (name === "Link") {
          const raw = doc.sliceString(from, to);
          const m = /^\[([\s\S]*?)\]\(\s*([\s\S]*?)\s*\)$/.exec(raw);
          if (m && !reveal(from, to)) {
            const labelFrom = from + 1;
            const labelTo = labelFrom + m[1].length;
            decos.push(Decoration.mark({ class: "cm-link" }).range(labelFrom, labelTo));
            hide(from, labelFrom);
            hide(labelTo, to);
            return false;
          }
          // 引用式链接：[文字][id] / [文字][]
          const ref = /^\[([\s\S]*?)\]\[([^\]]*)\]$/.exec(raw);
          if (ref && !reveal(from, to)) {
            const labelFrom = from + 1;
            const labelTo = labelFrom + ref[1].length;
            decos.push(Decoration.mark({ class: "cm-link" }).range(labelFrom, labelTo));
            hide(from, labelFrom);
            hide(labelTo, to);
            return false;
          }
          return true;
        }
        if (name === "Autolink") {
          if (!reveal(from, to)) {
            decos.push(Decoration.mark({ class: "cm-link" }).range(from + 1, to - 1));
            hide(from, from + 1);
            hide(to - 1, to);
          }
          return false;
        }
        if (name === "URL") {
          decos.push(Decoration.mark({ class: "cm-url" }).range(from, to));
          return false;
        }
        if (name === "HorizontalRule") {
          if (!touching(from, to)) {
            replaced.push([from, to]);
            decos.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
          }
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    console.warn("[moke] 语法树装饰失败", e);
  }

  /* ---- 行级细节：列表符号 / 任务框 / 围栏标签 ---- */
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    if (overlaps(replaced, line.from, line.to)) continue;
    const text = line.text;
    const inCode = overlaps(codeRanges, line.from, line.to);

    // 围栏行 → 语言胶囊 + 复制；闭合围栏行 → 收起；选中整行则露出源码
    if (inCode) {
      if (reveal(line.from, line.to)) continue;
      const span = codeRanges.find(([a, b]) => line.from >= a && line.to <= b);
      const isOpen = !!span && span[0] === line.from;
      const isClose = !!span && span[1] === line.to;
      if (isOpen) {
        const fm = FENCE_RE.exec(text.trim());
        if (fm) {
          const parts: string[] = [];
          for (let k = line.number + 1; k <= doc.lines; k++) {
            const tt = doc.line(k).text;
            if (/^(`{3,}|~{3,})\s*$/.test(tt.trim())) break;
            parts.push(tt);
          }
          decos.push(
            Decoration.replace({
              widget: new CodeLangWidget(
                (fm[2] || "").toLowerCase(),
                parts.join("\n"),
                line.from,
                line.to
              ),
            }).range(line.from, line.to)
          );
        }
      } else if (isClose && FENCE_RE.test(text.trim())) {
        hide(line.from, line.to);
      }
      continue;
    }

    // 先剥掉引用标记，后面的标题 / 列表判断都基于剩下的正文
    const qmk = /^(\s{0,3}(?:>[ \t]*)+)/.exec(text);
    const qlen = qmk ? qmk[1].length : 0;
    if (qlen) hide(line.from, line.from + qlen);
    const body = text.slice(qlen);
    const bFrom = line.from + qlen;

    // 标题标记永远收起（改标题用工具栏下拉或 Ctrl+1..6）
    const hmk = /^(\s{0,3})(#{1,6})(\s+)/.exec(body);
    if (hmk) {
      hide(bFrom + hmk[1].length, bFrom + hmk[1].length + hmk[2].length + hmk[3].length);
      continue;
    }

    // 行尾反斜杠 = 硬换行标记，收起（连续两个则是转义出来的反斜杠本身）
    const tailBs = /(\\+)$/.exec(text);
    if (tailBs && tailBs[1].length % 2 === 1) {
      hide(line.to - 1, line.to);
    }

    const task = /^([ \t]*)([-*+])[ \t]+(\[[ xX]\])[ \t]+/.exec(body);
    if (task) {
      const s = bFrom + task[1].length;
      const e = bFrom + task[0].length;
      const checked = /[xX]/.test(task[3]);
      decos.push(Decoration.replace({ widget: new TaskWidget(checked, s, e) }).range(s, e));
      if (checked && e < line.to)
        decos.push(Decoration.mark({ class: "cm-task-done" }).range(e, line.to));
      continue;
    }

    const bullet = /^([ \t]*)([-*+])([ \t]+)/.exec(body);
    if (bullet) {
      const s = bFrom + bullet[1].length;
      const ch = bullet[2] === "-" ? "•" : bullet[2] === "*" ? "◦" : "▪";
      decos.push(Decoration.replace({ widget: new BulletWidget(ch) }).range(s, s + 1));
      continue;
    }

    const ord = /^([ \t]*)(\d{1,9}[.)])([ \t]+)/.exec(body);
    if (ord) {
      const s = bFrom + ord[1].length;
      decos.push(Decoration.mark({ class: "cm-list-num" }).range(s, s + ord[2].length));
      continue;
    }
  }

  /* ---- 行内：公式 / 高亮 ---- */
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    if (overlaps(replaced, line.from, line.to)) continue;
    if (overlaps(codeRanges, line.from, line.to)) continue;
    const text = line.text;
    // 每条规则自带 includes 快检，这里不再统一过滤，避免新语法被前置条件挡住

    if (text.includes("~~")) {
      const re = /~~(?!\s)([^~\n]+?)(?<!\s)~~/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.mark({ class: "cm-strike" }).range(s + 2, e - 2));
        hide(s, s + 2);
        hide(e - 2, e);
      }
    }

    if (text.includes("$")) {
      const re = /(?<![\\$])\$(?!\s)([^$\n]*?)(?<!\s)\$(?!\$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.replace({ widget: new InlineMathWidget(m[1], s, e) }).range(s, e));
      }
    }

    /* 脚注引用 [^1] */
    if (text.includes("[^")) {
      const re = /\[\^([^\]\n]+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.mark({ class: "cm-footnote-ref" }).range(s + 2, e - 1));
        hide(s, s + 2);
        hide(e - 1, e);
      }
    }

    /* 上标 ^x^ */
    if (text.includes("^")) {
      const re = /\^([^\^\s][^\^\n]*?)\^/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        if (text[s - line.from - 1] === "^" || text[e - line.from] === "^") continue;
        decos.push(Decoration.mark({ class: "cm-sup" }).range(s + 1, e - 1));
        hide(s, s + 1);
        hide(e - 1, e);
      }
    }

    /* 下标 ~x~ */
    if (text.includes("~")) {
      const re = /~([^~\s][^~\n]*?)~/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        if (text[s - line.from - 1] === "~" || text[e - line.from] === "~") continue;
        decos.push(Decoration.mark({ class: "cm-sub" }).range(s + 1, e - 1));
        hide(s, s + 1);
        hide(e - 1, e);
      }
    }

    /* :emoji: */
    if (text.includes(":")) {
      const re = /:([a-z0-9_+\-]{2,32}):/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const ch = EMOJI[m[1].toLowerCase()];
        if (!ch) continue;
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.replace({ widget: new EmojiWidget(ch) }).range(s, e));
      }
    }

    /* 反斜杠转义：只收起反斜杠，保留字符本身 */
    if (text.includes("\\")) {
      const re = /\\([\\`*_{}\[\]()#+\-.!|>~$<])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        if (overlaps(inlineCode, s, s + 2) || overlaps(replaced, s, s + 2)) continue;
        hide(s, s + 1);
      }
    }

    /* 行内 HTML：白名单标签 */
    if (text.includes("<")) {
      const TAG_CLASS: Record<string, string> = {
        u: "cm-underline",
        ins: "cm-underline",
        mark: "cm-mark",
        b: "cm-strong",
        strong: "cm-strong",
        i: "cm-em",
        em: "cm-em",
        s: "cm-strike",
        del: "cm-strike",
        kbd: "cm-kbd",
        code: "cm-inline-code",
        sub: "cm-sub",
        sup: "cm-sup",
        summary: "cm-strong",
      };
      const re = /<(u|ins|mark|b|strong|i|em|s|del|kbd|code|sub|sup|summary)>([^<\n]*?)<\/\1>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || overlaps(hidden, s, e) || reveal(s, e))
          continue;
        const openLen = m[1].length + 2;
        const closeLen = m[1].length + 3;
        decos.push(Decoration.mark({ class: TAG_CLASS[m[1]] }).range(s + openLen, e - closeLen));
        hide(s, s + openLen);
        hide(e - closeLen, e);
      }

      // <span style="color:…">文字</span>
      const sre = /<span\s+style="([^"]*)"\s*>([^<\n]*?)<\/span>/g;
      while ((m = sre.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || overlaps(hidden, s, e) || reveal(s, e))
          continue;
        const style = safeInlineStyle(m[1]);
        if (!style) continue;
        const openLen = m[0].indexOf(">") + 1;
        const inner = m[2].length;
        decos.push(
          Decoration.mark({ attributes: { style } }).range(s + openLen, s + openLen + inner)
        );
        hide(s, s + openLen);
        hide(s + openLen + inner, e);
      }

      // <br> / <br/>
      const bre = /<br\s*\/?>/gi;
      while ((m = bre.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e)) continue;
        hide(s, e);
      }

      // <img src="…" alt="…" width="…">
      const imre = /<img\s+([^>]*?)\/?>/gi;
      while ((m = imre.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        const src = attrOf(m[1], "src");
        if (!src) continue;
        const alt = attrOf(m[1], "alt") || "";
        const w = parseInt(attrOf(m[1], "width") || "", 10);
        replaced.push([s, e]);
        decos.push(
          Decoration.replace({
            widget: new ImageWidget(resolveSrc(src), alt, s, e, Number.isFinite(w) ? w : 0),
          }).range(s, e)
        );
      }

      // <!-- 注释 -->
      const cre = /<!--[\s\S]*?-->/g;
      while ((m = cre.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e)) continue;
        hide(s, e);
      }

      // <details> / </details> 这类块标签，标签本身不显示
      const dre = /<\/?(?:details|summary)\b[^>]*>/gi;
      while ((m = dre.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || overlaps(hidden, s, e)) continue;
        hide(s, e);
      }
    }

    if (text.includes("++")) {
      const re = /\+\+(?!\s)([^+\n]+?)(?<!\s)\+\+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.mark({ class: "cm-underline" }).range(s + 2, e - 2));
        hide(s, s + 2);
        hide(e - 2, e);
      }
    }

    if (text.includes("==")) {
      const re = /==(?!\s)([^=\n]+?)(?<!\s)==/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (overlaps(inlineCode, s, e) || overlaps(replaced, s, e) || reveal(s, e)) continue;
        decos.push(Decoration.mark({ class: "cm-mark" }).range(s + 2, e - 2));
        hide(s, s + 2);
        hide(e - 2, e);
      }
    }
  }

  /* ---- 表格源码编辑中：末尾放一个「完成」按钮 ---- */
  const cur = state.selection.main.head;
  for (const b of bs?.blocks || []) {
    if (b.kind !== "table") continue;
    if (cur >= b.from && cur <= b.to) {
      const endLine = doc.lineAt(Math.min(b.to, doc.length));
      decos.push(Decoration.widget({ widget: new DoneWidget(b.to), side: 1 }).range(endLine.to));
    }
  }

  try {
    return decos.length ? Decoration.set(decos, true) : Decoration.none;
  } catch (e) {
    console.warn("[moke] 装饰集构建失败，降级为纯源码", e);
    return Decoration.none;
  }
}

/* ================= 插件 ================= */

const livePreviewBase = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      const forced = update.transactions.some((t) =>
        t.effects.some((e) => e.is(refreshEffect))
      );
      const treeGrew = syntaxTree(update.startState) !== syntaxTree(update.state);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        forced ||
        treeGrew
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none),
  }
);

export const livePreview = [blockField, livePreviewBase];
