import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  TRANSFORMERS_PKG,
  TRANSFORMERS_SPEC,
  resolveTransformersEntry,
  loadTransformers,
  installTransformers,
  isTransformersMissing,
  formatModelProgress,
  TransformersMissingError,
} from '../transformers-ext.js';
import { resolveEmbedder } from '../index.js';

const localFail = vi.hoisted(() => ({ make: (): Error => new Error('unset') }));
vi.mock('../local.js', () => ({
  createLocalEmbedder: async () => {
    throw localFail.make();
  },
}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctk-ext-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Fake an installed transformers package under <dir>/node_modules with an ESM entry. */
function fakeInstall(body = 'export const pipeline = () => "ok"; export const env = {};'): string {
  const pkgDir = join(dir, 'node_modules', ...TRANSFORMERS_PKG.split('/'));
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: TRANSFORMERS_PKG,
      main: './dist/main.cjs',
      exports: { node: { import: { default: './dist/entry.mjs' }, require: { default: './dist/main.cjs' } } },
    }),
  );
  const entry = join(pkgDir, 'dist', 'entry.mjs');
  writeFileSync(entry, body);
  return entry;
}

describe('resolveTransformersEntry', () => {
  it('returns null when the package is not installed in the ext dir', () => {
    expect(resolveTransformersEntry(dir)).toBeNull();
  });

  it('resolves the ESM (node.import) entry, not the CJS main', () => {
    const entry = fakeInstall();
    expect(resolveTransformersEntry(dir)).toBe(entry);
  });
});

describe('loadTransformers', () => {
  it('imports from the ext dir when installed there', async () => {
    fakeInstall();
    const mod = await loadTransformers(dir, async () => {
      throw new Error('bare import must not be reached');
    });
    expect(mod.pipeline()).toBe('ok');
  });

  it('falls back to a bare import (dev checkout) when the ext dir is empty', async () => {
    const mod = await loadTransformers(dir, async () => ({ pipeline: () => 'bare' }));
    expect(mod.pipeline()).toBe('bare');
  });

  it('throws a recognizable "missing" error when neither source has it', async () => {
    const err = await loadTransformers(dir, async () => {
      throw new Error("Cannot find package '@huggingface/transformers'");
    }).catch((e) => e);
    expect(isTransformersMissing(err)).toBe(true);
    expect(String(err.message)).toMatch(/ctk mem semantic enable/);
  });
});

describe('installTransformers', () => {
  it('runs npm install into the ext dir with the CUDA download skipped and no stdin', async () => {
    const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string }> = [];
    await installTransformers({
      dir,
      run: async (cmd, args, o) => {
        calls.push({ cmd, args, env: o.env, cwd: o.cwd });
        return 0;
      },
    });
    expect(calls).toHaveLength(1);
    const { cmd, args, env, cwd } = calls[0]!;
    expect(cmd).toMatch(/^npm(\.cmd)?$/);
    expect(args).toContain('install');
    expect(args).toContain(TRANSFORMERS_SPEC);
    expect(args).toEqual(expect.arrayContaining(['--prefix', dir]));
    expect(args).toContain('--foreground-scripts');
    expect(env['ONNXRUNTIME_NODE_INSTALL']).toBe('skip');
    expect(cwd).toBe(dir);
    // A private manifest anchors the prefix so npm never walks up into a parent project.
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).private).toBe(true);
  });

  it('creates the ext dir when it does not exist yet', async () => {
    const nested = join(dir, 'a', 'ext');
    await installTransformers({ dir: nested, run: async () => 0 });
    expect(existsSync(join(nested, 'package.json'))).toBe(true);
  });

  it('rejects with the exit code when npm fails', async () => {
    await expect(installTransformers({ dir, run: async () => 7 })).rejects.toThrow(/exit code 7/);
  });
});

describe('resolveEmbedder local failures', () => {
  let warnings: unknown[][];
  let origWarn: typeof console.warn;
  beforeEach(() => {
    warnings = [];
    origWarn = console.warn;
    console.warn = (...a: unknown[]) => warnings.push(a);
  });
  afterEach(() => {
    console.warn = origWarn;
  });

  it('degrades to null SILENTLY when transformers is not installed (opt-in feature)', async () => {
    localFail.make = () => new TransformersMissingError();
    expect(await resolveEmbedder({ kind: 'local' })).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('still warns on a real load failure', async () => {
    localFail.make = () => new Error('model cache corrupt');
    expect(await resolveEmbedder({ kind: 'local' })).toBeNull();
    expect(String(warnings[0])).toMatch(/model cache corrupt/);
  });
});

describe('formatModelProgress', () => {
  it('renders a percentage for progress events', () => {
    expect(formatModelProgress({ status: 'progress', file: 'onnx/model.onnx', progress: 42.4 })).toBe(
      '[ctk] model onnx/model.onnx 42%',
    );
  });

  it('returns null for non-progress events', () => {
    expect(formatModelProgress({ status: 'initiate', file: 'x' })).toBeNull();
    expect(formatModelProgress(undefined)).toBeNull();
  });
});
