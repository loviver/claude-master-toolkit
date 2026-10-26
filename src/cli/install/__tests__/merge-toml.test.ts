import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from 'smol-toml';
import { upsertManagedBlock, removeManagedBlock, TomlConflictError } from '../merge-toml.js';

let tmp: string;
let cfg: string;
let backups: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ctk-toml-'));
  cfg = join(tmp, 'config.toml');
  backups = join(tmp, 'backups');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const BODY = '[mcp_servers.ctk]\ncommand = "node"\nargs = ["/pkg/dist/mcp.js"]\n';
const USER = `# my codex config — keep me
model = "gpt-6-luna"   # trailing comment

[tui]
theme = "dark"

[hooks.state."/home/u/.codex/hooks.json:PreToolUse:0:0"]
trusted_hash = "sha256:abc"
`;

describe('upsertManagedBlock', () => {
  it('creates the file when missing', () => {
    const r = upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    expect(r).toEqual({ changed: true, created: true });
    expect((parse(readFileSync(cfg, 'utf8')) as any).mcp_servers.ctk.command).toBe('node');
  });

  it('keeps every user byte (comments, [hooks.state.*]) and appends the block', () => {
    writeFileSync(cfg, USER);
    upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    const out = readFileSync(cfg, 'utf8');
    expect(out.startsWith(USER)).toBe(true);
    const parsed = parse(out) as any;
    expect(parsed.mcp_servers.ctk.args).toEqual(['/pkg/dist/mcp.js']);
    expect(parsed.hooks.state['/home/u/.codex/hooks.json:PreToolUse:0:0'].trusted_hash).toBe('sha256:abc');
  });

  it('is idempotent and replaces the body on re-run', () => {
    writeFileSync(cfg, USER);
    upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    const once = readFileSync(cfg, 'utf8');
    expect(upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups }).changed).toBe(false);
    expect(readFileSync(cfg, 'utf8')).toBe(once);

    upsertManagedBlock(cfg, 'mcp', BODY.replace('/pkg/', '/other/'), { backupDir: backups });
    const out = readFileSync(cfg, 'utf8');
    expect(out).toContain('/other/dist/mcp.js');
    expect(out).not.toContain('/pkg/dist/mcp.js');
    expect(out.match(/>>> ctk:mcp/g)).toHaveLength(1);
  });

  it('refuses when the user already defines the same table outside the block', () => {
    writeFileSync(cfg, USER + '\n[mcp_servers.ctk]\ncommand = "mine"\n');
    expect(() => upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups })).toThrow(TomlConflictError);
    expect(readFileSync(cfg, 'utf8')).toBe(USER + '\n[mcp_servers.ctk]\ncommand = "mine"\n');
  });

  it('refuses to write if the result would not be valid TOML (file untouched)', () => {
    writeFileSync(cfg, USER);
    expect(() => upsertManagedBlock(cfg, 'bad', '[oops', { backupDir: backups })).toThrow();
    expect(readFileSync(cfg, 'utf8')).toBe(USER);
  });

  it('backs up the original once before first change, keeps mode', () => {
    writeFileSync(cfg, USER);
    chmodSync(cfg, 0o600);
    upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    const files = readdirSync(backups);
    expect(files).toHaveLength(1);
    expect(readFileSync(join(backups, files[0]!), 'utf8')).toBe(USER);
    expect(statSync(cfg).mode & 0o777).toBe(0o600);
  });
});

describe('removeManagedBlock', () => {
  it('restores the exact original bytes', () => {
    writeFileSync(cfg, USER);
    upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    expect(removeManagedBlock(cfg, 'mcp')).toBe(true);
    expect(readFileSync(cfg, 'utf8')).toBe(USER);
  });

  it('deletes the file when we created it and nothing else remains', () => {
    upsertManagedBlock(cfg, 'mcp', BODY, { backupDir: backups });
    removeManagedBlock(cfg, 'mcp', { deleteIfEmpty: true });
    expect(existsSync(cfg)).toBe(false);
  });

  it('no block / no file => false, nothing touched', () => {
    expect(removeManagedBlock(cfg, 'mcp')).toBe(false);
    writeFileSync(cfg, USER);
    expect(removeManagedBlock(cfg, 'mcp')).toBe(false);
    expect(readFileSync(cfg, 'utf8')).toBe(USER);
  });

  it('only removes its own block id', () => {
    upsertManagedBlock(cfg, 'a', '[x]\na = 1\n', { backupDir: backups });
    upsertManagedBlock(cfg, 'b', '[y]\nb = 2\n', { backupDir: backups });
    removeManagedBlock(cfg, 'a');
    const parsed = parse(readFileSync(cfg, 'utf8')) as any;
    expect(parsed.x).toBeUndefined();
    expect(parsed.y.b).toBe(2);
  });
});
