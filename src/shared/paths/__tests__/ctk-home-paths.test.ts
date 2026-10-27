import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ctkHome, ctkPaths } from '../ctk-home-paths.js';
import * as full from '../ctk-home.js';

describe('ctk-home-paths (light module for hooks)', () => {
  it('does not import better-sqlite3 (hooks must start fast)', () => {
    const src = readFileSync(join(__dirname, '..', 'ctk-home-paths.ts'), 'utf8');
    expect(src).not.toMatch(/better-sqlite3/);
  });

  it('ctk-home re-exports the same ctkHome/ctkPaths', () => {
    expect(full.ctkHome).toBe(ctkHome);
    expect(full.ctkPaths).toBe(ctkPaths);
  });
});
