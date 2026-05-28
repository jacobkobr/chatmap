// separate build for the content script — produces a self-contained iife
// that chrome can load as a classic content script (no module imports)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // replace process.env.NODE_ENV — not available in content script context
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // don't wipe dist — the main build runs first
    lib: {
      entry: resolve(__dirname, "src/content/index.tsx"),
      name: "chatmap",
      formats: ["iife"],
      fileName: () => "content/index.js",
    },
    rollupOptions: {
      output: {
        // inline everything — no shared chunks for content scripts
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
