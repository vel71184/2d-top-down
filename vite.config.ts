import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works inside the Android app and on any static host.
  base: "./",
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
