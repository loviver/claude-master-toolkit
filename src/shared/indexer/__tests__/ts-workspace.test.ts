import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { tmpdir } from 'os';
import { openTsWorkspace } from '../ts-workspace.js';

// Real files on disk: the bug this guards (monorepos indexing 0 files) lived in how
// tsconfigs are discovered on disk, which an in-memory FS would not exercise.

let root: string;

function put(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] });

function relFiles(): string[] {
  return openTsWorkspace(root).files.map((f) => relative(root, f)).sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ctk-tsws-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('openTsWorkspace', () => {
  it('indexes every package of a monorepo with no tsconfig at the root', () => {
    put('package.json', '{"private":true}');
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    put('packages/a/tsconfig.json', TSCONFIG);
    put('packages/a/src/util.ts', 'export function helper() { return 1; }');
    put('packages/b/tsconfig.json', TSCONFIG);
    put('packages/b/src/main.ts', "import { helper } from '../../a/src/util';\nexport function run() { return helper(); }");

    expect(relFiles()).toEqual(['packages/a/src/util.ts', 'packages/b/src/main.ts']);
  });

  it('qualifies symbols and cross-package edges relative to the workspace root', () => {
    put('packages/a/tsconfig.json', TSCONFIG);
    put('packages/a/src/util.ts', 'export function helper() { return 1; }');
    put('packages/b/tsconfig.json', TSCONFIG);
    put('packages/b/src/main.ts', "import { helper } from '../../a/src/util';\nexport function run() { return helper(); }");

    const ws = openTsWorkspace(root);
    const run = ws.extract(join(root, 'packages/b/src/main.ts')).find((s) => s.symbol === 'run')!;
    expect(run.file).toBe('packages/b/src/main.ts');
    expect(run.deps).toContain('packages/a/src/util.ts::helper');
  });

  it('follows the references of a solution-style tsconfig (files: [])', () => {
    put('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }));
    put('tsconfig.app.json', JSON.stringify({ include: ['src'] }));
    put('src/app.ts', 'export const app = 1;');

    expect(relFiles()).toEqual(['src/app.ts']);
  });

  it('respects a tsconfig exclude instead of indexing the files it leaves out', () => {
    put('tsconfig.json', TSCONFIG);
    put('src/a.ts', 'export const a = 1;');
    put('scripts/gen.ts', 'export const gen = 1;');

    expect(relFiles()).toEqual(['src/a.ts']);
  });

  it('lists a file once when nested tsconfigs both include it, owned by the closest one', () => {
    put('packages/api/tsconfig.json', JSON.stringify({}));
    put('packages/api/src/a.ts', 'export const a = 1;');
    put('packages/api/test/tsconfig.json', JSON.stringify({}));
    put('packages/api/test/a.test.ts', 'export const t = 1;');

    expect(relFiles()).toEqual(['packages/api/src/a.ts', 'packages/api/test/a.test.ts']);
  });

  it('indexes TS and JS files of a project with no tsconfig at all', () => {
    put('package.json', '{}');
    put('src/a.ts', 'export function a() { return 1; }');
    put('lib/b.js', 'export function b() { return 2; }');

    const ws = openTsWorkspace(root);
    expect(ws.files.map((f) => relative(root, f)).sort()).toEqual(['lib/b.js', 'src/a.ts']);
    expect(ws.extract(join(root, 'lib/b.js')).map((s) => s.symbol)).toContain('b');
  });

  it('still indexes a package without a tsconfig that sits next to TS packages', () => {
    put('packages/a/tsconfig.json', TSCONFIG);
    put('packages/a/src/a.ts', 'export const a = 1;');
    put('packages/js-only/index.js', 'export const j = 1;');

    expect(relFiles()).toEqual(['packages/a/src/a.ts', 'packages/js-only/index.js']);
  });

  it('warns about a tsconfig it cannot load and still indexes that package', () => {
    put('packages/a/tsconfig.json', JSON.stringify({ extends: '@missing/tsconfig-base' }));
    put('packages/a/src/a.ts', 'export const a = 1;');

    const ws = openTsWorkspace(root);
    expect(ws.files.map((f) => relative(root, f))).toEqual(['packages/a/src/a.ts']);
    expect(ws.warnings.join('\n')).toMatch(/packages\/a\/tsconfig\.json/);
  });

  it('skips node_modules, build output and dot dirs such as agent worktrees', () => {
    put('packages/a/tsconfig.json', JSON.stringify({}));
    put('packages/a/src/a.ts', 'export const a = 1;');
    put('packages/a/dist/a.js', 'export const a = 1;');
    put('node_modules/dep/index.js', 'export const d = 1;');
    put('.claude/worktrees/w1/packages/a/tsconfig.json', JSON.stringify({}));
    put('.claude/worktrees/w1/packages/a/src/a.ts', 'export const a = 1;');
    put('coverage/lcov-report/x.js', 'var x = 1;');

    expect(relFiles()).toEqual(['packages/a/src/a.ts']);
  });

  it('reports the tsconfigs it used', () => {
    put('packages/a/tsconfig.json', TSCONFIG);
    put('packages/a/src/a.ts', 'export const a = 1;');
    put('packages/b/tsconfig.json', TSCONFIG);
    put('packages/b/src/b.ts', 'export const b = 1;');

    expect(openTsWorkspace(root).tsconfigs.map((c) => relative(root, c)).sort())
      .toEqual(['packages/a/tsconfig.json', 'packages/b/tsconfig.json']);
  });
});
