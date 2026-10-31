import katex from "katex";
import { escapeHtml } from "../core/util";

/* 一个独立、可预测的 Markdown → HTML 转换器，专供导出使用 */

function inline(s: string): string {
  let out = escapeHtml(s);
  // 行内代码先占位，避免被其它规则改写
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 行内公式
  const maths: string[] = [];
  out = out.replace(/(?<![\\$])\$(?!\s)([^$\n]*?)(?<!\s)\$(?!\$)/g, (_m, tex) => {
    try {
      maths.push(katex.renderToString(tex, { throwOnError: false, strict: false }));
    } catch {
      maths.push(escapeHtml(`$${tex}$`));
    }
    return `\u0001${maths.length - 1}\u0001`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/==([^=\n]+)==/g, '<mark class="mk">$1</mark>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);
  out = out.replace(/\u0001(\d+)\u0001/g, (_m, i) => `<span class="math">${maths[+i]}</span>`);
  return out;
}

function splitRow(l: string) {
  let s = l.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
const DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const closeList = (stack: string[]) => {
    while (stack.length) out.push(`</${stack.pop()}>`);
  };
  const listStack: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // 空行
    if (t === "") {
      closeList(listStack);
      i++;
      continue;
    }
    // 围栏代码
    const fence = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      closeList(listStack);
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
    // 块级公式
    if (t === "$$") {
      closeList(listStack);
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
    // 标题
    const atx = /^(#{1,6})\s+(.*)$/.exec(t);
    if (atx) {
      closeList(listStack);
      const lv = atx[1].length;
      out.push(`<h${lv}>${inline(atx[2])}</h${lv}>`);
      i++;
      continue;
    }
    // 分隔线
    if (/^(\*\s*){3,}$/.test(t) || /^(-\s*){3,}$/.test(t) || /^(_\s*){3,}$/.test(t)) {
      closeList(listStack);
      out.push("<hr />");
      i++;
      continue;
    }
    // 表格
    if (t.includes("|") && i + 1 < lines.length && DELIM.test(lines[i + 1])) {
      closeList(listStack);
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
      header.forEach((c, k) => (tb += `<th style="text-align:${aligns[k] || "left"}">${inline(c)}</th>`));
      tb += "</tr></thead><tbody>";
      for (const r of rows) {
        tb += "<tr>";
        for (let k = 0; k < header.length; k++)
          tb += `<td style="text-align:${aligns[k] || "left"}">${inline(r[k] ?? "")}</td>`;
        tb += "</tr>";
      }
      tb += "</tbody></table>";
      out.push(tb);
      continue;
    }
    // 引用
    if (/^>\s?/.test(t)) {
      closeList(listStack);
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // 任务列表
    const task = /^([ \t]*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const kind = "ul";
      if (listStack[listStack.length - 1] !== kind) {
        closeList(listStack);
        out.push('<ul class="tasks">');
        listStack.push(kind);
      }
      const checked = /[xX]/.test(task[2]);
      out.push(
        `<li class="task${checked ? " done" : ""}"><span class="box">${
          checked ? "✓" : ""
        }</span>${inline(task[3])}</li>`
      );
      i++;
      continue;
    }
    // 无序列表
    const ul = /^([ \t]*)[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (listStack[listStack.length - 1] !== "ul") {
        closeList(listStack);
        out.push("<ul>");
        listStack.push("ul");
      }
      out.push(`<li>${inline(ul[2])}</li>`);
      i++;
      continue;
    }
    // 有序列表
    const ol = /^([ \t]*)(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (ol) {
      if (listStack[listStack.length - 1] !== "ol") {
        closeList(listStack);
        out.push("<ol>");
        listStack.push("ol");
      }
      out.push(`<li>${inline(ol[3])}</li>`);
      i++;
      continue;
    }
    // 段落
    closeList(listStack);
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^(\s*)(```+|~~~+)/.test(lines[i]) &&
      !/^([ \t]*)[-*+]\s+/.test(lines[i]) &&
      !/^([ \t]*)\d{1,9}[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join("\n").trim())}</p>`);
  }
  closeList(listStack);
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
ul.tasks{list-style:none;padding-left:.2em}
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
@media print{
 body{font-size:11.5pt}
 .page{max-width:none;padding:0}
 pre,blockquote,table,img{page-break-inside:avoid}
 h1,h2,h3{page-break-after:avoid}
 a{color:inherit;text-decoration:none}
}
`;

export function buildExportHtml(title: string, md: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head><body><div class="page">
${mdToHtml(md)}
</div></body></html>`;
}
