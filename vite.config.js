import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: "src/interfaces/web/client",
  define:
    command === "build"
      ? { "process.env.NODE_ENV": JSON.stringify("production") }
      : {},
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/assets", "/favicon.ico"].map((route) => [
        route,
        {
          target: `http://127.0.0.1:${process.env.WEB_PORT || 3000}`,
        },
      ]),
    ),
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: fileURLToPath(
        new URL("./src/interfaces/web/client/main.jsx", import.meta.url),
      ),
      formats: ["es"],
      fileName: () => "app.js",
      cssFileName: "app",
    },
  },
}));
