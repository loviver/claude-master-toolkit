import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');
const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;

describe('version strings stay in sync with package.json', () => {
  it('CLI --version', () => {
    expect(read('src/cli/index.ts').match(/const VERSION = "([^"]+)"/)?.[1]).toBe(pkgVersion);
  });

  it('MCP server handshake version', () => {
    expect(read('src/mcp/server.ts').match(/name: 'ctk', version: '([^']+)'/)?.[1]).toBe(pkgVersion);
  });
});
