import { defineConfig } from "vite";

export default defineConfig({
  define: { global: "globalThis" }, // node-style deps (siwe) in the browser
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1600, // Phaser is a large bundle by nature
  },
});
