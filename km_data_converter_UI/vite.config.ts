import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), react()],
  optimizeDeps: {
    exclude: ["@rerun-io/web-viewer", "@rerun-io/web-viewer-react"]
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: fileURLToPath(new URL("node_modules/react/index.js", import.meta.url)) },
      { find: /^react\/jsx-runtime$/, replacement: fileURLToPath(new URL("node_modules/react/jsx-runtime.js", import.meta.url)) },
      { find: /^react\/jsx-dev-runtime$/, replacement: fileURLToPath(new URL("node_modules/react/jsx-dev-runtime.js", import.meta.url)) },
      { find: /^react-dom$/, replacement: fileURLToPath(new URL("node_modules/react-dom/index.js", import.meta.url)) },
      { find: /^react-dom\/client$/, replacement: fileURLToPath(new URL("node_modules/react-dom/client.js", import.meta.url)) }
    ],
    dedupe: ["react", "react-dom"]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    target: "esnext",
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    emptyOutDir: true
  }
});
