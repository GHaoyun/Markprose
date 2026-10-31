import { h } from "./dom";

export interface ToolbarState {
  heading: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  quote: boolean;
  ul: boolean;
  ol: boolean;
  task: boolean;
}

const ICONS: Record<string, string> = {
  undo: '<path d="M4.5 7.5h5.2a3.6 3.6 0 1 1 0 7.2H6.2"/><path d="M7 4.5L4 7.5l3 3"/>',
  redo: '<path d="M11.5 7.5H6.3a3.6 3.6 0 1 0 0 7.2h3.5"/><path d="M9 4.5l3 3-3 3"/>',
  quote:
    '<path d="M6 5.2c-1.6.9-2.4 2.3-2.4 4.2"/><path d="M10.4 5.2c-1.6.9-2.4 2.3-2.4 4.2"/><circle cx="3.6" cy="10.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="10.6" r="1.1" fill="currentColor" stroke="none"/>',
  link: '<path d="M6.6 9.4a2.9 2.9 0 0 0 4.1 0l1.9-1.9a2.9 2.9 0 0 0-4.1-4.1l-1 1"/><path d="M9.4 6.6a2.9 2.9 0 0 0-4.1 0l-1.9 1.9a2.9 2.9 0 0 0 4.1 4.1l1-1"/>',
  image:
    '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6"/><circle cx="5.9" cy="6.5" r="1.05"/><path d="M2.8 11.4l3.1-3 2.4 2.3 2.2-2.1 2.7 2.8"/>',
  table:
    '<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4"/><path d="M2.2 6.6h11.6M6.6 6.6v6.2M10.4 6.6v6.2"/>',
  codeblock:
    '<path d="M5.6 5.4L2.6 8l3 2.6"/><path d="M10.4 5.4L13.4 8l-3 2.6"/><path d="M9.2 4.2l-2.4 7.6"/>',
};

export function buildToolbar(root: HTMLElement, exec: (cmd: string, arg?: any) => void) {
  root.innerHTML = "";

  const btn = (
    cmd: string,
    label: string,
    title: string,
    opts: { svg?: string; html?: string; arg?: any } = {}
  ) => {
    const b = h("button", {
      class: "tb2",
      title,
      "data-cmd": cmd,
      onmousedown: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        exec(cmd, opts.arg);
      },
    });
    if (opts.svg) b.innerHTML = `<svg viewBox="0 0 16 16">${ICONS[opts.svg] || ""}</svg>`;
    else if (opts.html) b.innerHTML = opts.html;
    else b.textContent = label;
    return b;
  };

  const sep = () => h("div", { class: "tb2-sep" });

  root.appendChild(btn("undo", "", "撤销 (Ctrl+Z)", { svg: "undo" }));
  root.appendChild(btn("redo", "", "重做 (Ctrl+Y)", { svg: "redo" }));
  root.appendChild(sep());

  const hWrap = h("div", { class: "tb2-dd" });
  const hBtn = h("button", {
    class: "tb2-dd-btn",
    id: "tb-heading-btn",
    title: "段落样式",
    "data-value": "0",
    onmousedown: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openHeadingMenu(hBtn, exec);
    },
  });
  hBtn.innerHTML =
    '<span class="dd-label">正文</span><svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3"/></svg>';
  hWrap.appendChild(hBtn);
  root.appendChild(hWrap);

  root.appendChild(btn("quote", "", "引用 (Ctrl+Shift+Q)", { svg: "quote" }));
  root.appendChild(sep());

  root.appendChild(btn("bold", "", "加粗 (Ctrl+B)", { html: "<b>B</b>" }));
  root.appendChild(btn("italic", "", "斜体 (Ctrl+I)", { html: "<i>I</i>" }));
  root.appendChild(btn("strike", "", "删除线 (Ctrl+U)", { html: "<s>S</s>" }));
  root.appendChild(btn("code", "", "行内代码 (Ctrl+E)", { html: '<span style="font-family:var(--font-mono);font-size:11px">&lt;/&gt;</span>' }));
  root.appendChild(
    btn("highlight", "", "高亮 (Ctrl+Shift+H)", {
      html: '<span style="background:color-mix(in srgb,#f2c14e 55%,transparent);border-radius:3px;padding:0 4px;font-size:11px;font-weight:700">H</span>',
    })
  );
  root.appendChild(sep());

  root.appendChild(btn("link", "", "插入链接 (Ctrl+K)", { svg: "link" }));
  root.appendChild(btn("image", "", "插入图片", { svg: "image" }));
  root.appendChild(sep());

  root.appendChild(btn("ul", "", "无序列表", { html: '<span style="font-size:15px;line-height:1">•</span>' }));
  root.appendChild(btn("ol", "", "有序列表", { html: '<span style="font-size:11px;font-weight:700">1.</span>' }));
  root.appendChild(btn("task", "", "任务清单", { html: '<span style="font-size:12px">☑</span>' }));
  root.appendChild(sep());

  root.appendChild(btn("table", "", "插入表格 (Ctrl+T)", { svg: "table" }));
  root.appendChild(btn("codeblock", "", "插入代码块 (Ctrl+Shift+K)", { svg: "codeblock" }));
  root.appendChild(btn("math", "", "插入公式", { html: '<span style="font-family:var(--font-serif);font-size:15px">∑</span>' }));
  root.appendChild(btn("hr", "", "插入分隔线", { html: '<span style="font-size:14px">—</span>' }));
  root.appendChild(btn("toc", "", "插入目录 [TOC]", { html: '<span style="font-size:10.5px;font-weight:700">TOC</span>' }));

  root.appendChild(h("div", { class: "tb2-spacer" }));
}

const HEADING_ITEMS: [number, string][] = [
  [0, "正文"],
  [1, "标题 1"],
  [2, "标题 2"],
  [3, "标题 3"],
  [4, "标题 4"],
  [5, "标题 5"],
  [6, "标题 6"],
];

let headingMenu: HTMLElement | null = null;
export function closeHeadingMenu() {
  headingMenu?.remove();
  headingMenu = null;
}

function openHeadingMenu(anchor: HTMLElement, exec: (cmd: string, arg?: any) => void) {
  closeHeadingMenu();
  const cur = Number(anchor.dataset.value || 0);
  const menu = h("div", { class: "tb2-menu" });
  for (const [v, label] of HEADING_ITEMS) {
    const it = h(
      "div",
      {
        class: "tb2-mi" + (v === cur ? " on" : ""),
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          closeHeadingMenu();
          exec("heading", v);
        },
      },
      h("span", { class: "mi-label", text: label }),
      v > 0 ? h("span", { class: "mi-hint", text: "Ctrl+" + v }) : null
    );
    menu.appendChild(it);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 8)) + "px";
  menu.style.top = r.bottom + 6 + "px";
  headingMenu = menu;
  setTimeout(() => {
    const off = (e: MouseEvent) => {
      if (headingMenu && !headingMenu.contains(e.target as Node) && e.target !== anchor) {
        closeHeadingMenu();
        document.removeEventListener("mousedown", off, true);
      }
    };
    document.addEventListener("mousedown", off, true);
  }, 0);
}

export function syncToolbar(st: ToolbarState) {
  const root = document.getElementById("toolbar");
  if (!root) return;
  const set = (cmd: string, on: boolean) => {
    root.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)?.classList.toggle("on", on);
  };
  set("bold", st.bold);
  set("italic", st.italic);
  set("strike", st.strike);
  set("code", st.code);
  set("link", st.link);
  set("quote", st.quote);
  set("ul", st.ul);
  set("ol", st.ol);
  set("task", st.task);
  const btn = document.getElementById("tb-heading-btn");
  if (btn) {
    btn.dataset.value = String(st.heading);
    const label = btn.querySelector(".dd-label");
    if (label) label.textContent = st.heading === 0 ? "正文" : `标题 ${st.heading}`;
  }
}
