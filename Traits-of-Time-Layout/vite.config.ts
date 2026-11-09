import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    // WSL's Windows-mounted files do not reliably emit native change events.
    watch: {
      usePolling: process.platform === "linux" && fileURLToPath(new URL(".", import.meta.url)).startsWith("/mnt/"),
      interval: 200,
    },
  },
  build: {
    outDir: "dist-web",
    target: "es2020",
    sourcemap: true,
  },
});
