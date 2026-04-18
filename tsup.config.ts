import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
    external: ["ts-morph", "typescript", "better-sqlite3"],
  },
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
  },
  {
    entry: { mcp: "src/mcp/server.ts" },
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
    external: ["@modelcontextprotocol/sdk", "better-sqlite3", "ts-morph", "typescript"],
  },
]);
