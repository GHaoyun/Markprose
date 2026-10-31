import katex from "katex";
import { escapeHtml } from "../core/util";

/* 一个独立、可预测的 Markdown → HTML 转换器，专供导出使用 */

/** 行内白名单标签，其余 HTML 一律按文本转义 */
const INLINE_TAG_RE = /^(?:u|ins|mark|kbd|sub|sup|b|strong|i|em|s|del|code|span|br|summary|details|img)$/;

/** 只放行颜色类样式 */
function safeStyle(style: string): string {
  const out: string[] = [];
  const re = /(?:^|;)\s*(background-color|color)\s*:\s*([^;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(style))) {
    const v = m[2].trim();
    if (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(v)) {
      out.push(`${m[1].toLowerCase()}:${v}`);
    }
  }
  return out.join(";");
}

/** 重建白名单标签，属性只保留安全的几个 */
function rebuildTag(name: string, attrs: string, closing: boolean, selfClose: boolean): string {
  if (closing) return `</${name}>`;
  const parts: string[] = [];
  if (name === "span") {
    const st = /style\s*=\s*"([^"]*)"/i.exec(attrs);
    const safe = st ? safeStyle(st[1]) : "";
    if (safe) parts.push(`style="${safe}"`);
  }
  if (name === "img") {
    const src = /src\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /src\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
    const alt = /alt\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /alt\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
    const w = /width\s*=\s*"?(\d+)/i.exec(attrs)?.[1];
    if (!src) return "";
    parts.push(`src="${escapeHtml(src)}"`, `alt="${escapeHtml(alt)}"`);
    if (w) parts.push(`width="${w}"`);
  }
  if (name === "br") return "<br />";
  return `<${name}${parts.length ? " " + parts.join(" ") : ""}${selfClose ? " /" : ""}>`;
}

interface FnCtx {
  defs: Map<string, string>;
  order: string[];
}

function inline(s: string, refs: Map<string, string>, fn: FnCtx): string {
  // 1) 行内代码先占位，里面的内容不再做任何解析
  const codes: string[] = [];
  let out = s.replace(/(`+)([\s\S]*?)\1/g, (_m, _t, c) => {
    codes.push(String(c).replace(/^ /, "").replace(/ $/, ""));
    return `\u0000${codes.length - 1}\u0000`;
  });

  // 2) 行内公式
  const maths: string[] = [];
  out = out.replace(/(?<![\\$])\$(?!\s)([^$\n]*?)(?<!\s)\$(?!\$)/g, (_m, tex) => {
    try {
      maths.push(katex.renderToString(tex, { throwOnError: false, strict: false }));
    } catch {
      maths.push(escapeHtml(`$${tex}$`));
    }
    return `\u0001${maths.length - 1}\u0001`;
  });

  // 3) 白名单 HTML 标签占位，属性做安全清洗
  const tags: string[] = [];
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g, (m, close, name, attrs, sc) => {
    const nm = String(name).toLowerCase();
    if (!INLINE_TAG_RE.test(nm)) return m;
    const built = rebuildTag(nm, String(attrs || ""), !!close, !!sc);
    if (!built) return "";
    tags.push(built);
    return `\u0003${tags.length - 1}\u0003`;
  });

  // 4) 反斜杠转义
  const esc: string[] = [];
  out = out.replace(/\\([\\`*_{}\[\]()#+\-.!|>~$<])/g, (_m, c) => {
    esc.push(c);
    return `\u0002${esc.length - 1}\u0002`;
  });

  // 5) 剩下的按文本转义
  out = escapeHtml(out);

  // 6) 图片（可带标题）
  out = out.replace(
    /!\[([^\]]*)\]\(\s*([^)\s]+?)(?:\s+(?:&quot;|["']).*?(?:&quot;|["']))?\s*\)/g,
    (_m, alt, src) => `<img src="${src}" alt="${alt}" />`
  );

  // 7) 行内链接（可带标题）
  out = out.replace(
    /\[([^\]]+)\]\(\s*([^)\s]+?)(?:\s+(?:&quot;|["']).*?(?:&quot;|["']))?\s*\)/g,
    '<a href="$2">$1</a>'
  );

  // 8) 引用式链接 [文字][id] / [文字][]
  out = out.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text, id) => {
    const key = String(id || text).trim().toLowerCase();
    const href = refs.get(key);
    return href ? `<a href="${escapeHtml(href)}">${text}</a>` : m;
  });

  // 8.5) 脚注引用 [^id]
  out = out.replace(/\[\^([^\]\s]+)\]/g, (m, id) => {
    const key = String(id);
    if (!fn.defs.has(key)) return m;
    if (!fn.order.includes(key)) fn.order.push(key);
    const n = fn.order.indexOf(key) + 1;
    return `<sup class="fn-ref"><a href="#fn-${escapeHtml(key)}">${n}</a></sup>`;
  });

  // 9) 尖括号自动链接
  out = out.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>');
  out = out.replace(/&lt;([^\s&@]+@[^\s&]+)&gt;/g, '<a href="mailto:$1">$1</a>');

  // 10) 粗斜体 → 粗体 → 斜体
  out = out.replace(/\*\*\*(?!\s)([^*]+?)(?<!\s)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/___(?!\s)([^_]+?)(?<!\s)___/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<![\w])__(?!\s)([^_]+?)(?<!\s)__(?![\w])/g, "<strong>$1</strong>");
  out = out.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, "<em>$1</em>");
  out = out.replace(/(?<![\w])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w])/g, "<em>$1</em>");

  // 11) 删除线 / 高亮 / 下划线
  out = out.replace(/~~(?!\s)([^~]+?)(?<!\s)~~/g, "<del>$1</del>");
  out = out.replace(/==(?!\s)([^=]+?)(?<!\s)==/g, '<mark class="mk">$1</mark>');
  out = out.replace(/\+\+(?!\s)([^+]+?)(?<!\s)\+\+/g, "<u>$1</u>");

  // 12) 还原占位
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, k) => `<code>${escapeHtml(codes[+k])}</code>`);
  out = out.replace(/\u0001(\d+)\u0001/g, (_m, k) => `<span class="math">${maths[+k]}</span>`);
  out = out.replace(/\u0002(\d+)\u0002/g, (_m, k) => escapeHtml(esc[+k]));
  out = out.replace(/\u0003(\d+)\u0003/g, (_m, k) => tags[+k]);
  return out;
}

function splitRow(l: string) {
  let s = l.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
const DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const SETEXT = /^ {0,3}(=+|-{2,})\s*$/;
const HR_RE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;

/** 这一行会不会打断段落 */
function isBlockStart(t: string): boolean {
  return (
    /^#{1,6}\s/.test(t) ||
    /^>/.test(t) ||
    /^([-*+]|\d{1,9}[.)])\s+/.test(t) ||
    /^(`{3,}|~{3,})/.test(t) ||
    t === "$$" ||
    t.startsWith("|") ||
    HR_RE.test(t) ||
    /^<(?:div|details|summary|table|section|figure|p|ul|ol|blockquote)\b/i.test(t)
  );
}

export function mdToHtml(md: string, ctx?: FnCtx): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const fn: FnCtx = ctx ?? { defs: new Map(), order: [] };
  // 引用式链接定义表
  const refs = new Map<string, string>();
  for (const l of lines) {
    const m = /^ {0,3}\[([^\]^][^\]]*)\]:\s*(\S+)/.exec(l);
    if (m) refs.set(m[1].trim().toLowerCase(), m[2].replace(/^<|>$/g, ""));
  }
  // 脚注定义表
  for (const l of lines) {
    const m = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(l);
    if (m) fn.defs.set(m[1], m[2].trim());
  }

  // 列表栈：按缩进嵌套
  const stack: { indent: number; tag: string }[] = [];
  const closeAll = () => {
    while (stack.length) out.push(`</li></${stack.pop()!.tag}>`);
  };
  const openItem = (indent: number, tag: string, ulClass = "", liAttr = "") => {
    while (stack.length && indent < stack[stack.length - 1].indent) {
      out.push(`</li></${stack.pop()!.tag}>`);
    }
    const top = stack[stack.length - 1];
    const openTag = `<${tag}${ulClass ? ` class="${ulClass}"` : ""}>`;
    if (!top) {
      out.push(openTag);
      stack.push({ indent, tag });
    } else if (indent > top.indent) {
      out.push(openTag);
      stack.push({ indent, tag });
    } else if (tag !== top.tag) {
      out.push(`</li></${stack.pop()!.tag}>${openTag}`);
      stack.push({ indent, tag });
    } else {
      out.push("</li>");
    }
    out.push(`<li${liAttr}>`);
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // 空行
    if (t === "") {
      closeAll();
      i++;
      continue;
    }
    // 引用式链接定义行 / 脚注定义行：不输出内容
    if (/^ {0,3}\[[^\]^][^\]]*\]:\s*\S+/.test(line) || /^ {0,3}\[\^[^\]\s]+\]:/.test(line)) {
      i++;
      continue;
    }
    // 围栏代码
    const fence = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      closeAll();
      const marker = fence[2];
      const lang = fence[3];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      if (lang.toLowerCase() === "mermaid") {
        out.push(
          `<pre class="mermaid-src" data-lang="mermaid"><code>${escapeHtml(buf.join("\n"))}</code></pre>`
        );
      } else {
        out.push(
          `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(
            buf.join("\n")
          )}</code></pre>`
        );
      }
      continue;
    }
    // 四空格缩进代码块
    if (/^( {4}|\t)/.test(line) && (i === 0 || lines[i - 1].trim() === "")) {
      const prevList = i > 0 && /^([ \t]*)([-*+]|\d{1,9}[.)])\s+/.test(lines[i - 1]);
      if (!prevList) {
        closeAll();
        const buf: string[] = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || lines[i].trim() === "")) {
          buf.push(lines[i].replace(/^( {4}|\t)/, ""));
          i++;
        }
        while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
        out.push(`<pre class="code"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
        continue;
      }
    }
    // 块级公式
    if (t === "$$") {
      closeAll();
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        buf.push(lines[i]);
        i++;
      }
      i++;
      let html = "";
      try {
        html = katex.renderToString(buf.join("\n"), {
          displayMode: true,
          throwOnError: false,
          strict: false,
        });
      } catch {
        html = `<pre>${escapeHtml(buf.join("\n"))}</pre>`;
      }
      out.push(`<div class="math-block">${html}</div>`);
      continue;
    }
    // 注释块：整行只有 HTML 注释时直接跳过
    if (/^<!--[\s\S]*-->$/.test(t)) {
      closeAll();
      i++;
      continue;
    }
    // 独占一行的块级 HTML 标签（details / summary 等），原样输出
    if (
      /^<\/?(?:details|summary|div|section|figure|table|ul|ol|blockquote|p|hr)\b[^>]*>$/i.test(t) ||
      /^<summary\b[^>]*>[\s\S]*<\/summary>$/i.test(t)
    ) {
      closeAll();
      out.push(inline(t, refs, fn));
      i++;
      continue;
    }
    // Setext 标题
    if (i + 1 < lines.length && !isBlockStart(t) && SETEXT.test(lines[i + 1])) {
      closeAll();
      const lv = lines[i + 1].trim()[0] === "=" ? 1 : 2;
      out.push(`<h${lv}>${inline(t, refs, fn)}</h${lv}>`);
      i += 2;
      continue;
    }
    // ATX 标题
    const atx = /^(#{1,6})\s+(.*)$/.exec(t);
    if (atx) {
      closeAll();
      const lv = atx[1].length;
      out.push(`<h${lv}>${inline(atx[2].replace(/\s+#+\s*$/, ""), refs, fn)}</h${lv}>`);
      i++;
      continue;
    }
    // 分隔线
    if (HR_RE.test(t)) {
      closeAll();
      out.push("<hr />");
      i++;
      continue;
    }
    // 表格
    if (t.includes("|") && i + 1 < lines.length && DELIM.test(lines[i + 1])) {
      closeAll();
      const header = splitRow(line);
      const delims = splitRow(lines[i + 1]);
      const aligns = delims.map((d) => {
        const l = d.startsWith(":");
        const r = d.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : "";
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let tb = "<table><thead><tr>";
      header.forEach(
        (c, k) => (tb += `<th style="text-align:${aligns[k] || "left"}">${inline(c, refs, fn)}</th>`)
      );
      tb += "</tr></thead><tbody>";
      for (const r of rows) {
        tb += "<tr>";
        for (let k = 0; k < header.length; k++)
          tb += `<td style="text-align:${aligns[k] || "left"}">${inline(r[k] ?? "", refs, fn)}</td>`;
        tb += "</tr>";
      }
      tb += "</tbody></table>";
      out.push(tb);
      continue;
    }
    // 引用（支持嵌套）
    if (/^>\s?/.test(t)) {
      closeAll();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join("\n"), fn)}</blockquote>`);
      continue;
    }
    // 任务列表
    const task = /^([ \t]*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const checked = /[xX]/.test(task[2]);
      openItem(
        task[1].replace(/\t/g, "    ").length,
        "ul",
        "tasks",
        checked ? ' class="task done"' : ' class="task"'
      );
      out.push(`<span class="box">${checked ? "✓" : ""}</span>${inline(task[3], refs, fn)}`);
      i++;
      continue;
    }
    // 无序列表
    const ul = /^([ \t]*)[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      openItem(ul[1].replace(/\t/g, "    ").length, "ul");
      out.push(inline(ul[2], refs, fn));
      i++;
      continue;
    }
    // 有序列表
    const ol = /^([ \t]*)(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (ol) {
      openItem(ol[1].replace(/\t/g, "    ").length, "ol");
      out.push(inline(ol[3], refs, fn));
      i++;
      continue;
    }
    // 段落（行内硬换行：行尾两个空格或反斜杠）
    closeAll();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !SETEXT.test(lines[i]) &&
      !isBlockStart(lines[i].trim())
    ) {
      buf.push(lines[i]);
      i++;
    }
    // 多行段落下面紧跟 === / --- 时，整段升级为 Setext 标题
    if (i < lines.length && SETEXT.test(lines[i])) {
      const lv = lines[i].trim()[0] === "=" ? 1 : 2;
      out.push(`<h${lv}>${inline(buf.join(" "), refs, fn)}</h${lv}>`);
      i++;
      continue;
    }
    const parts = buf.map((l) => {
      let hard = false;
      if (/ {2,}$/.test(l)) {
        hard = true;
        l = l.replace(/ +$/, "");
      } else if (/\\$/.test(l)) {
        hard = true;
        l = l.replace(/\\$/, "");
      }
      return inline(l, refs, fn) + (hard ? "<br />" : "");
    });
    out.push(`<p>${parts.join("\n")}</p>`);
  }
  closeAll();
  if (fn.order.length && !ctx) {
    out.push('<section class="footnotes"><hr /><ol>');
    for (const id of fn.order) {
      out.push(
        `<li id="fn-${escapeHtml(id)}">${inline(fn.defs.get(id) || "", refs, fn)}</li>`
      );
    }
    out.push("</ol></section>");
  }
  return out.join("\n");
}

const CSS = `
:root{--fg:#23201b;--dim:#6d6559;--bg:#fff;--line:#e4ded2;--accent:#b4623a;--code:#f4f0e7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.78 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased}
.page{max-width:760px;margin:0 auto;padding:64px 32px 120px}
h1,h2,h3,h4,h5,h6{font-weight:650;line-height:1.35;letter-spacing:-.012em;margin:1.5em 0 .6em}
h1{font-size:1.92em;margin-top:.6em}
h2{font-size:1.5em;border-bottom:1px solid var(--line);padding-bottom:.24em}
h3{font-size:1.24em}h4{font-size:1.1em}
h5{font-size:1em;color:var(--dim)}h6{font-size:.9em;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
p{margin:.85em 0}
a{color:var(--accent);text-decoration:underline;text-underline-offset:2.5px}
strong{font-weight:700}em{font-style:italic}
del{opacity:.65}
mark.mk{background:#f7dfa5;color:inherit;border-radius:3px;padding:.05em .18em}
kbd{font-family:"Cascadia Code",Consolas,monospace;font-size:.86em;padding:.1em .4em;border:1px solid var(--line);
 border-bottom-width:2px;border-radius:5px;background:#f7f4ee;color:var(--dim)}
code{font-family:"Cascadia Code",Consolas,monospace;font-size:.87em;background:var(--code);
 border:1px solid #e8e2d5;border-radius:5px;padding:.1em .36em;color:#a8552f}
pre.code{background:var(--code);border:1px solid #e8e2d5;border-radius:10px;padding:14px 18px;
 overflow-x:auto;font-size:.86em;line-height:1.65}
pre.code code{background:none;border:none;padding:0;color:#2c2720}
pre.mermaid-src{background:#f7f4ee;border:1px dashed var(--line);border-radius:10px;padding:14px 18px;
 font-size:.82em;color:var(--dim);white-space:pre-wrap}
blockquote{margin:1em 0;padding:.1em 0 .1em 18px;border-left:3px solid #d9c9b4;color:var(--dim)}
ul,ol{padding-left:1.6em;margin:.8em 0}
li{margin:.28em 0}
ul.tasks{padding-left:.2em}
li.task{display:flex;gap:.55em;align-items:flex-start}
li.task .box{flex:none;width:16px;height:16px;margin-top:.34em;border:1.6px solid #b9ae9c;border-radius:4px;
 display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#fff}
li.task.done .box{background:var(--accent);border-color:var(--accent)}
li.task.done{opacity:.55;text-decoration:line-through}
table{border-collapse:collapse;width:100%;margin:1.1em 0;font-size:.93em;border:1px solid var(--line);
 border-radius:9px;overflow:hidden}
th,td{padding:8px 14px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}
th:last-child,td:last-child{border-right:none}
tr:last-child td{border-bottom:none}
th{background:#f7f4ee;font-weight:650;text-align:left}
hr{border:none;border-top:1px solid var(--line);margin:2em 0}
img{max-width:100%;border-radius:10px}
.math-block{text-align:center;margin:1.2em 0;overflow-x:auto}
.katex{font-size:1.02em}
details{border:1px solid var(--line);border-radius:9px;padding:10px 14px;margin:1em 0}
summary{cursor:pointer;font-weight:650}
sup.fn-ref{font-size:.72em;line-height:0}
sup.fn-ref a{text-decoration:none;font-weight:650}
section.footnotes{margin-top:2.4em;font-size:.9em;color:var(--dim)}
section.footnotes ol{padding-left:1.4em}
section.footnotes li{margin:.4em 0}
@media print{
 body{font-size:11.5pt}
 .page{max-width:none;padding:0}
 pre,blockquote,table,img{page-break-inside:avoid}
 h1,h2,h3{page-break-after:avoid}
 a{color:inherit;text-decoration:none}
}
`;

export function buildExportHtml(title: string, md: string): string {  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head><body><div class="page">
${mdToHtml(md)}
</div></body></html>`;
}

/* 调试用：开发期可在控制台直接调用 __mdToHtml 验证导出结果 */
if (typeof window !== "undefined") {
  (window as any).__mdToHtml = mdToHtml;
}
