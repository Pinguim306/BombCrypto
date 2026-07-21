import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  define: { global: "globalThis" }, // node-style deps (siwe) in the browser
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1600, // Phaser is a large bundle by nature
    rollupOptions: {
      input: {
        // multi-page: doc pages are Vite-processed so %VITE_*% env
        // placeholders resolve per deployment (testnet beta vs mainnet)
        main: resolve(__dirname, "index.html"),
        whitepaper: resolve(__dirname, "whitepaper.html"),
        guide: resolve(__dirname, "guide.html"),
      },
    },
  },
});
