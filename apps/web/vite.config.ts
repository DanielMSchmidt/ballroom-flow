import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Ballroom Flow",
        short_name: "Ballroom",
        theme_color: "#2f5d8f",
        background_color: "#e9e6df",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  // Local dev: proxy API calls to `wrangler dev` (default port 8787).
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
