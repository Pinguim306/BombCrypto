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
        admin: resolve(__dirname, "admin.html"),
        referrals: resolve(__dirname, "referrals.html"),
        migrate: resolve(__dirname, "migrate.html"),
        stats: resolve(__dirname, "stats.html"),
        // Godot v2 host page (parallel to the Phaser client; engine + pck
        // are served verbatim from public/godot, never bundled)
        play2: resolve(__dirname, "play2.html"),
      },
    },
  },
});
