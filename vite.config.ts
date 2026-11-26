import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// 应用版本从 package.json 读取，注入到前端代码里（__APP_VERSION__）
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          cm: ["@codemirror/view", "@codemirror/state", "@codemirror/language"],
        },
      },
    },
  },
});
