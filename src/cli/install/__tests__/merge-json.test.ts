import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setJsonKey, removeJsonKey } from '../merge-json.js';

let tmp: string;
let f: string;
let backups: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ctk-json-'));
  f = join(tmp, '.claude.json');
  backups = join(tmp, 'backups');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('setJsonKey', () => {
  it('creates the file when missing (install used to crash here)', () => {
    const r = setJsonKey(f, ['mcpServers', 'ctk'], { command: 'node' }, { backupDir: backups });
    expect(r.created).toBe(true);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ mcpServers: { ctk: { command: 'node' } } });
    expect(existsSync(backups)).toBe(false);
  });

  it('preserves unrelated keys and backs the original up', () => {
    writeFileSync(f, JSON.stringify({ numStartups: 7, mcpServers: { other: { command: 'x' } } }));
    setJsonKey(f, ['mcpServers', 'ctk'], { command: 'node' }, { backupDir: backups });
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({
      numStartups: 7,
      mcpServers: { other: { command: 'x' }, ctk: { command: 'node' } },
    });
    expect(readdirSync(backups)).toHaveLength(1);
  });

  it('invalid JSON => throws and leaves the file alone', () => {
    writeFileSync(f, '{nope');
    expect(() => setJsonKey(f, ['a'], 1, { backupDir: backups })).toThrow();
    expect(readFileSync(f, 'utf8')).toBe('{nope');
  });

  it('idempotent: same value => changed false', () => {
    setJsonKey(f, ['a', 'b'], 1, { backupDir: backups });
    expect(setJsonKey(f, ['a', 'b'], 1, { backupDir: backups }).changed).toBe(false);
  });
});

describe('removeJsonKey', () => {
  it('removes only that key and prunes emptied parents we created', () => {
    writeFileSync(f, JSON.stringify({ keep: 1, mcpServers: { ctk: { command: 'node' }, other: {} } }));
    expect(removeJsonKey(f, ['mcpServers', 'ctk'])).toBe(true);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ keep: 1, mcpServers: { other: {} } });
  });
  it('missing key/file => false', () => {
    expect(removeJsonKey(f, ['a'])).toBe(false);
    writeFileSync(f, '{}');
    expect(removeJsonKey(f, ['a', 'b'])).toBe(false);
  });
});
