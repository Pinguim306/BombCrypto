import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1600, // Phaser é um bundle grande por natureza
  },
});
