import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openSqlite } from '../open.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('openSqlite on an unwritable directory (e.g. an agent sandbox)', () => {
  it('explains what to do instead of a bare "unable to open database file"', () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-ro-'));
    mkdirSync(join(dir, 'home'));
    chmodSync(join(dir, 'home'), 0o555);
    expect(() => openSqlite(join(dir!, 'home', 'ctk.sqlite'))).toThrow(/writable|sandbox/i);
  });
});
