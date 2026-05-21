import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync } from "fs";

// copies manifest.json into dist after every build
function copyManifest(): Plugin {
  return {
    name: "copy-manifest",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist/manifest.json")
      );
    },
  };
}

export default defineConfig({
  publicDir: "public",
  plugins: [react(), tailwindcss(), copyManifest()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/index.tsx"),
        background: resolve(__dirname, "src/background/serviceWorker.ts"),
        options: resolve(__dirname, "options/index.html"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "content") return "content/index.js";
          if (chunk.name === "background") return "background/serviceWorker.js";
          return "[name]/[name].js";
        },
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
