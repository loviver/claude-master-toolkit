#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { closeSharedDb } from './handlers.js';
import { ensureMigrated } from '../shared/paths/ctk-home.js';

async function main(): Promise<void> {
  ensureMigrated();
  const server = new McpServer(
    { name: 'ctk', version: '0.3.0' },
    { capabilities: { tools: {} } },
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The shared SQLite connection must not outlive the client: close it and exit when the
  // client goes away (stdin closed) or the process is asked to stop.
  const shutdown = (): void => {
    closeSharedDb();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[ctk-mcp] fatal:', err);
  process.exit(1);
});
