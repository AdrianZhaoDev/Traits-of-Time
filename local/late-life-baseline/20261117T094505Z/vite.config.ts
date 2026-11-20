import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const licensesRoot = fileURLToPath(new URL("./licenses/", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [{
    name: "bundle-licenses",
    apply: "build",
    async generateBundle() {
      const entries = await readdir(licensesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          this.emitFile({
            type: "asset",
            fileName: `licenses/${entry.name}`,
            source: await readFile(join(licensesRoot, entry.name)),
          });
        }
      }
    },
  }],
  server: {
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
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
