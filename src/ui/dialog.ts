import { h } from "./dom";
import { pickFolder } from "../core/api";

interface Base {
  title: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

const ICON_INFO = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r="0.7" fill="currentColor" stroke="none"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 16 16"><path d="M8 2.4L14 13H2z"/><path d="M8 6.4v3"/><circle cx="8" cy="11.2" r="0.7" fill="currentColor" stroke="none"/></svg>';

function host() {
  return document.getElementById("dialog-host")!;
}

function close() {
  const el = host();
  el.classList.remove("show");
  el.innerHTML = "";
}

function mount(opts: Base, body: HTMLElement, actions: HTMLElement[], danger = false) {
  const el = host();
  el.innerHTML = "";
  const box = h(
    "div",
    { class: "dlg", onmousedown: (e: MouseEvent) => e.stopPropagation() },
    h(
      "div",
      { class: "dlg-head" },
      h("div", { class: "dlg-ico" + (danger ? " warn" : ""), html: danger ? ICON_WARN : ICON_INFO }),
      h("div", { class: "dlg-title", text: opts.title })
    ),
    body,
    h("div", { class: "dlg-actions" }, ...actions)
  );
  el.appendChild(box);
  el.classList.add("show");
  el.onmousedown = (e) => {
    if (e.target === el) close();
  };
  return box;
}

export function alertBox(opts: Base): Promise<void> {
  return new Promise((resolve) => {
    const body = h("div", { class: "dlg-body", text: opts.message || "" });
    const ok = h("button", {
      class: "dlg-btn primary",
      text: opts.okText || "知道了",
      onclick: () => {
        close();
        resolve();
      },
    });
    mount(opts, body, [ok]);
    ok.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener("keydown", onKey, true);
        close();
        resolve();
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

export function confirmBox(opts: Base): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      close();
      resolve(v);
    };
    const body = h("div", { class: "dlg-body", text: opts.message || "" });
    const cancel = h("button", {
      class: "dlg-btn",
      text: opts.cancelText || "取消",
      onclick: () => done(false),
    });
    const ok = h("button", {
      class: "dlg-btn " + (opts.danger ? "danger" : "primary"),
      text: opts.okText || "确定",
      onclick: () => done(true),
    });
    mount(opts, body, [cancel, ok], opts.danger);
    ok.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        done(true);
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

export interface ChoiceButton {
  text: string;
  value: string;
  kind?: "primary" | "danger" | "warn" | "ghost";
}

/** 三选一（或 N 选一）对话框，返回按钮的 value，取消/Esc 返回 null */
export function choiceBox(opts: {
  title: string;
  message?: string;
  danger?: boolean;
  buttons: ChoiceButton[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      document.removeEventListener("keydown", onKey, true);
      close();
      resolve(v);
    };
    const body = h("div", { class: "dlg-body", text: opts.message || "" });
    const actions = opts.buttons.map((b) =>
      h("button", {
        class:
          "dlg-btn" +
          (b.kind === "primary"
            ? " primary"
            : b.kind === "danger"
              ? " danger"
              : b.kind === "warn"
                ? " warn"
                : ""),
        text: b.text,
        onclick: () => done(b.value),
      })
    );
    mount({ title: opts.title, danger: opts.danger }, body, actions, opts.danger);
    const primaryIdx = opts.buttons.findIndex((b) => b.kind === "primary");
    const focusIdx = primaryIdx >= 0 ? primaryIdx : actions.length - 1;
    (actions[focusIdx] as HTMLElement)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        done(primaryIdx >= 0 ? opts.buttons[primaryIdx].value : null);
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

export function promptBox(
  opts: Base & { value?: string; placeholder?: string; multiline?: boolean }
): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      document.removeEventListener("keydown", onKey, true);
      close();
      resolve(v);
    };
    const body = h("div", { class: "dlg-body" });
    if (opts.message) body.appendChild(h("div", { text: opts.message }));
    const input = h("input", {
      class: "dlg-input",
      value: opts.value || "",
      placeholder: opts.placeholder || "",
      spellcheck: "false",
    }) as HTMLInputElement;
    body.appendChild(input);
    const cancel = h("button", {
      class: "dlg-btn",
      text: opts.cancelText || "取消",
      onclick: () => done(null),
    });
    const ok = h("button", {
      class: "dlg-btn primary",
      text: opts.okText || "确定",
      onclick: () => done(input.value),
    });
    mount(opts, body, [cancel, ok]);
    setTimeout(() => {
      input.focus();
      const dot = input.value.lastIndexOf(".");
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    }, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        done(input.value);
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

/**
 * 首次启动：让用户确认文档保存位置。
 * 返回选中的目录；点「用默认位置」或按 Esc 返回传入的 defaultDir；返回 null 表示放弃设置。
 */
export function folderSetupBox(opts: {
  title: string;
  message?: string;
  defaultDir: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      document.removeEventListener("keydown", onKey, true);
      close();
      resolve(v);
    };
    let current = opts.defaultDir;

    const pathVal = h("div", { class: "dir-pick-val", text: current || "（未选择）" });
    const browse = h("button", {
      class: "dlg-btn",
      text: "浏览…",
      onclick: async () => {
        const d = await pickFolder();
        if (!d) return;
        current = d;
        pathVal.textContent = d;
      },
    });
    const body = h(
      "div",
      { class: "dlg-body" },
      h("div", { text: opts.message || "" }),
      h("div", { class: "dir-pick" }, pathVal, browse)
    );

    const useDefault = h("button", {
      class: "dlg-btn",
      text: "使用默认位置",
      onclick: () => {
        current = opts.defaultDir;
        pathVal.textContent = current || "（未选择）";
      },
    });
    const ok = h("button", {
      class: "dlg-btn primary",
      text: "确定",
      onclick: () => done(current),
    });

    mount({ title: opts.title }, body, [useDefault, ok]);
    ok.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

/** 关闭文档时的标准三选一：保存 / 不保存 / 取消 */
export function saveChangesBox(opts: { name: string }): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const done = (v: "save" | "discard" | "cancel") => {
      document.removeEventListener("keydown", onKey, true);
      close();
      resolve(v);
    };
    const body = h("div", {
      class: "dlg-body",
      text: `是否将更改保存到「${opts.name}」？`,
    });
    const save = h("button", {
      class: "dlg-btn primary",
      text: "保存",
      onclick: () => done("save"),
    });
    const discard = h("button", {
      class: "dlg-btn",
      text: "不保存",
      onclick: () => done("discard"),
    });
    const cancel = h("button", {
      class: "dlg-btn",
      text: "取消",
      onclick: () => done("cancel"),
    });

    mount({ title: "保存更改" }, body, [save, discard, cancel]);
    save.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done("cancel");
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}
