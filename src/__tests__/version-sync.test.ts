import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CTK_VERSION } from '../shared/version';

const root = resolve(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');
const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;
const SEMVER_LITERAL = /['"]\d+\.\d+\.\d+['"]/;

describe('version strings come from package.json alone', () => {
  it('CTK_VERSION is the package version', () => {
    expect(CTK_VERSION).toBe(pkgVersion);
  });

  // A hand-written version drifts on the next bump; both entry points must read CTK_VERSION.
  it.each(['src/cli/index.ts', 'src/mcp/server.ts'])('%s has no hardcoded version', (file) => {
    const src = read(file);
    expect(src).toMatch(/\bCTK_VERSION\b/);
    expect(src).not.toMatch(SEMVER_LITERAL);
  });
});
