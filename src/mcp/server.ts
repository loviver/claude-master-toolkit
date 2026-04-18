#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'ctk', version: '0.1.5' },
    { capabilities: { tools: {} } },
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[ctk-mcp] fatal:', err);
  process.exit(1);
});
