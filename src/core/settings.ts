import { basename } from "./util";
import { loadSettingsRaw, saveSettingsRaw } from "./api";

export interface Settings {
  theme: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  font: "sans" | "serif" | "kai";
  fontFamily: string;
  saveDir: string;
  /** 用户是否确认过文档保存位置（首次启动的引导弹窗只弹一次） */
  saveDirChosen: boolean;
  autosave: boolean;
  /** 老版本默认开着自动保存，这里记录是否已经做过一次性关闭 */
  autosaveMigrated: boolean;
  typewriter: boolean;
  focusMode: boolean;
  lineNumbers: boolean;
  sourceMode: boolean;
  sidebar: boolean;
  lastFolder: string | null;
  sessionTabs: string[];
  sessionActive: string | null;
  restoreSession: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "pine",
  fontSize: 16.5,
  lineHeight: 1.78,
  contentWidth: 760,
  font: "sans",
  fontFamily: "",
  saveDir: "",
  saveDirChosen: false,
  autosave: false,
  autosaveMigrated: false,
  typewriter: false,
  focusMode: false,
  lineNumbers: false,
  sourceMode: false,
  sidebar: true,
  lastFolder: null,
  sessionTabs: [],
  sessionActive: null,
  restoreSession: true,
};

export const THEMES: { id: string; name: string; sw: string[] }[] = [
  { id: "pine", name: "松绿", sw: ["#fbfcfa", "#dae3d9", "#2f7d5b", "#1d2620"] },
  { id: "paper", name: "纸白", sw: ["#fdfcf9", "#e4ded2", "#b4623a", "#23201b"] },
  { id: "ink", name: "墨黑", sw: ["#17171a", "#2c2c33", "#e08a5c", "#e9e5de"] },
  { id: "sepia", name: "暖阳", sw: ["#f7efdf", "#ddceb1", "#a1612c", "#3b3022"] },
  { id: "midnight", name: "夜蓝", sw: ["#101826", "#233449", "#5aa9e6", "#dde8f4"] },
  { id: "sakura", name: "樱粉", sw: ["#fffbfb", "#efd9df", "#c2547a", "#2b2023"] },
];

export const settings: Settings = { ...DEFAULT_SETTINGS };

/** 本次是不是第一次启动（配置文件还不存在） */
export let isFirstRun = false;

export async function loadSettings() {
  try {
    const raw = await loadSettingsRaw();
    if (raw) {
      Object.assign(settings, JSON.parse(raw));
      isFirstRun = false;
    } else {
      isFirstRun = true;
    }
  } catch {}
  return settings;
}

let saveTimer: number | undefined;
export function persistSettings() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveSettingsRaw(JSON.stringify(settings)).catch(() => {});
  }, 350);
}

export function applySettings() {
  const html = document.documentElement;
  html.dataset.theme = settings.theme;
  html.dataset.font = settings.font;
  const fam = (settings.fontFamily || "").trim();
  if (fam) html.style.setProperty("--font-text", `"${fam}", var(--font-ui)`);
  else html.style.removeProperty("--font-text");
  html.style.setProperty("--editor-size", `${settings.fontSize}px`);
  html.style.setProperty("--editor-lh", String(settings.lineHeight));
  html.style.setProperty("--content-w", `${settings.contentWidth}px`);
  document.getElementById("sidebar")?.classList.toggle("hidden", !settings.sidebar);
  document.getElementById("btn-sidebar")?.classList.toggle("on", settings.sidebar);
  const host = document.getElementById("editor-host");
  if (host) {
    host.classList.toggle("cm-focus-mode", settings.focusMode);
  }
  document.body.dataset.sourceMode = String(settings.sourceMode);
}

export function setTheme(id: string) {
  const html = document.documentElement;
  html.classList.add("theme-anim");
  settings.theme = id;
  applySettings();
  persistSettings();
  window.dispatchEvent(new CustomEvent("moke:theme"));
  window.setTimeout(() => html.classList.remove("theme-anim"), 340);
}

export function cycleTheme() {
  const i = THEMES.findIndex((t) => t.id === settings.theme);
  setTheme(THEMES[(i + 1) % THEMES.length].id);
}

export function docTitle(path: string | null) {
  return path ? basename(path) : "未命名";
}
