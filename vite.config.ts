import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/public",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@client": resolve(__dirname, "src/client"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3200",
        changeOrigin: true,
        // SSE requires no buffering + no compression
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
        },
      },
    },
  },
});
