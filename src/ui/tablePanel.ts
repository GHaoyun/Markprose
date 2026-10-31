import { h } from "./dom";

export interface TableModel {
  header: string[];
  aligns: string[];
  rows: string[][];
}

let panel: HTMLElement | null = null;
let outside: ((e: MouseEvent) => void) | null = null;

export function closeTablePanel() {
  panel?.remove();
  panel = null;
  if (outside) {
    document.removeEventListener("mousedown", outside, true);
    outside = null;
  }
}

export function openTablePanel(opts: {
  anchor: DOMRect;
  model: TableModel;
  onChange: (m: TableModel) => void;
  onDelete: () => void;
}) {
  closeTablePanel();
  const model: TableModel = {
    header: [...opts.model.header],
    aligns: [...opts.model.aligns],
    rows: opts.model.rows.map((r) => [...r]),
  };

  const el = h("div", { class: "tpanel" });

  const stepper = (
    label: string,
    get: () => number,
    set: (v: number) => void,
    min: number
  ) => {
    const val = h("span", { class: "tp-val", text: String(get()) });
    const refresh = () => {
      val.textContent = String(get());
      opts.onChange(model);
    };
    const minus = h("button", {
      class: "tp-btn",
      text: "−",
      onclick: () => {
        if (get() <= min) return;
        set(get() - 1);
        refresh();
      },
    });
    const plus = h("button", {
      class: "tp-btn",
      text: "＋",
      onclick: () => {
        set(get() + 1);
        refresh();
      },
    });
    return h(
      "div",
      { class: "tp-row" },
      h("span", { class: "tp-label", text: label }),
      minus,
      val,
      plus
    );
  };

  el.appendChild(h("div", { class: "tp-head", text: "表格大小" }));

  el.appendChild(
    stepper(
      "行",
      () => model.rows.length,
      (v) => {
        if (v > model.rows.length) {
          while (model.rows.length < v) model.rows.push(model.header.map(() => ""));
        } else {
          model.rows.length = v;
        }
      },
      0
    )
  );

  el.appendChild(
    stepper(
      "列",
      () => model.header.length,
      (v) => {
        if (v > model.header.length) {
          while (model.header.length < v) {
            model.header.push("");
            model.aligns.push("");
            model.rows.forEach((r) => r.push(""));
          }
        } else {
          model.header.length = v;
          model.aligns.length = v;
          model.rows.forEach((r) => (r.length = v));
        }
      },
      1
    )
  );

  el.appendChild(h("div", { class: "tp-sep" }));

  el.appendChild(
    h("div", {
      class: "tp-del",
      text: "删除整张表格",
      onclick: () => {
        closeTablePanel();
        opts.onDelete();
      },
    })
  );

  document.body.appendChild(el);
  panel = el;

  // 定位：按钮下方，超出视口就翻到上面
  const r = el.getBoundingClientRect();
  let left = Math.min(opts.anchor.right - r.width, window.innerWidth - r.width - 10);
  left = Math.max(10, left);
  let top = opts.anchor.bottom + 8;
  if (top + r.height > window.innerHeight - 10) top = opts.anchor.top - r.height - 8;
  el.style.left = left + "px";
  el.style.top = Math.max(10, top) + "px";

  outside = (e: MouseEvent) => {
    const t = e.target as Node;
    if (panel && !panel.contains(t)) closeTablePanel();
  };
  setTimeout(() => document.addEventListener("mousedown", outside!, true), 0);
}
