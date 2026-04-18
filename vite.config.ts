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
      "/api": "http://localhost:3200",
    },
  },
});
