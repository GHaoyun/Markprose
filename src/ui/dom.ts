export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, any> | null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k === "text") el.textContent = String(v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as any);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

export const $$ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll(sel)) as T[];

/* ---------- Toast ---------- */
export function toast(msg: string, kind: "info" | "err" = "info", ms = 2200) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: "toast" + (kind === "err" ? " err" : ""), text: msg });
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 240);
  }, ms);
}

/* ---------- 右键菜单 ---------- */
export interface MenuItem {
  label: string;
  danger?: boolean;
  sep?: boolean;
  onClick?: () => void;
}
export function ctxMenu(x: number, y: number, items: MenuItem[]) {
  const m = document.getElementById("ctxmenu")!;
  m.innerHTML = "";
  for (const it of items) {
    if (it.sep) {
      m.appendChild(h("div", { class: "ctx-sep" }));
      continue;
    }
    m.appendChild(
      h("div", {
        class: "ctx-item" + (it.danger ? " danger" : ""),
        text: it.label,
        onclick: () => {
          hideCtx();
          it.onClick?.();
        },
      })
    );
  }
  m.classList.add("show");
  const rect = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}
export function hideCtx() {
  document.getElementById("ctxmenu")?.classList.remove("show");
}
document.addEventListener("mousedown", (e) => {
  const m = document.getElementById("ctxmenu");
  if (m && !m.contains(e.target as Node)) hideCtx();
});

/* ---------- 图标 ---------- */
const ICONS: Record<string, string> = {
  folder: '<path d="M1.5 4.2a1 1 0 0 1 1-1h3l1.3 1.5h5.7a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"/>',
  folderOpen:
    '<path d="M1.5 4.2a1 1 0 0 1 1-1h3l1.3 1.5h5.7a1 1 0 0 1 1 1v1.1H1.5z"/><path d="M1.5 6.8h12.3l-1.3 5.2a1 1 0 0 1-1 .8h-9a1 1 0 0 1-1-.8z"/>',
  md: '<rect x="1.5" y="3" width="13" height="10" rx="1.6"/><path d="M4 10V6.2l1.8 2.2 1.8-2.2V10M10.6 6.2V10M10.6 10l1.6-1.6M10.6 10L9 8.4"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
};

export function icon(name: keyof typeof ICONS, size = 14) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("class", "ico");
  s.innerHTML = ICONS[name] || "";
  return s;
}
