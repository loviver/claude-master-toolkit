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
    // true: wf_* tools load via dynamic import into a separate chunk, keeping drizzle-orm
    // (~250 ms) off the MCP cold-start path. Chunks land next to mcp.js in dist/.
    splitting: true,
    sourcemap: false,
    external: ["@modelcontextprotocol/sdk", "better-sqlite3", "ts-morph", "typescript"],
  },
  {
    // Light entry for agent hooks: no commander, drizzle or ts-morph.
    entry: { hook: "src/hooks/entry.ts" },
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
    external: ["better-sqlite3"],
  },
]);
