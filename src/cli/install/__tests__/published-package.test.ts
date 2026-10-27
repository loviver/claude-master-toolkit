import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { installClaude } from '../claude.js';
import { installCodex } from '../codex.js';

// The other install tests point pkgRoot at the repo, where every file exists. This one
// installs from exactly what `npm pack` would publish, so a file missing from
// package.json "files" (persona.md in 0.5.0) fails here instead of on users' machines.

const REPO = join(__dirname, '..', '..', '..', '..');
let root: string;
let saved: string | undefined;

function packedFiles(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0].files.map((f) => f.path);
}

function danglingLinks(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) { if (!existsSync(p)) out.push(p); }
    else if (e.isDirectory()) danglingLinks(p, out);
  }
  return out;
}

beforeAll(() => {
  saved = process.env['CTK_HOME'];
  root = mkdtempSync(join(tmpdir(), 'ctk-pkg-'));
  process.env['CTK_HOME'] = join(root, 'home', '.ctk');
  const pkg = join(root, 'pkg');
  for (const f of packedFiles()) {
    mkdirSync(dirname(join(pkg, f)), { recursive: true });
    cpSync(join(REPO, f), join(pkg, f));
  }
  for (const d of ['.claude', '.codex']) mkdirSync(join(root, 'home', d), { recursive: true });
}, 60_000);
afterAll(() => {
  if (saved === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = saved;
  rmSync(root, { recursive: true, force: true });
});

describe('install from the published package', () => {
  it('ships every file the Claude and Codex installs link to (no dangling symlinks, no skips)', () => {
    const ctx = { home: join(root, 'home'), pkgRoot: join(root, 'pkg') };
    const claude = installClaude(ctx);
    const codex = installCodex(ctx);
    expect(danglingLinks(ctx.home)).toEqual([]);
    expect([...claude.warnings, ...codex.warnings].filter((w) => /not in the package/.test(w))).toEqual([]);
    expect(lstatSync(join(ctx.home, '.claude', 'persona.md')).isSymbolicLink()).toBe(true);
  });
});
