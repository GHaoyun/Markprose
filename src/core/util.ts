export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export function throttle<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let last = 0;
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const rest = ms - (now - last);
    if (rest <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = window.setTimeout(() => {
        timer = undefined;
        last = Date.now();
        fn(...args);
      }, rest);
    }
  };
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** 统一成正斜杠，便于显示与比较 */
export const norm = (p: string) => p.replace(/\\/g, "/");

export function basename(p: string) {
  const n = norm(p).replace(/\/+$/, "");
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

export function dirname(p: string) {
  const n = norm(p).replace(/\/+$/, "");
  const i = n.lastIndexOf("/");
  if (i <= 0) return n.slice(0, i + 1) || "/";
  return n.slice(0, i);
}

export function extname(p: string) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function stripExt(p: string) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? b : b.slice(0, i);
}

/** 相对路径：把绝对路径转成相对 base 的形式 */
export function relative(base: string, target: string) {
  const b = norm(base).replace(/\/+$/, "").split("/");
  const t = norm(target).split("/");
  let i = 0;
  while (i < b.length && i < t.length && b[i].toLowerCase() === t[i].toLowerCase()) i++;
  const up = b.length - i;
  return [...Array(up).fill(".."), ...t.slice(i)].join("/") || ".";
}

export function isAbsolutePath(p: string) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");
}

/** 字数统计：中文按字，英文按词 */
export function countWords(text: string) {
  const cjk = (text.match(/[\u3400-\u9fbf\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fbf\u3040-\u30ff\uac00-\ud7af]/g, " ").match(/[A-Za-z0-9_'’-]+/g) || [])
    .length;
  return cjk + latin;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
