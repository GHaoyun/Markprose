import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
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
