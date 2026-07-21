import { defineConfig } from "vite";

export default defineConfig({
  define: { global: "globalThis" }, // deps node-style (siwe) no navegador
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1600, // Phaser é um bundle grande por natureza
  },
});
