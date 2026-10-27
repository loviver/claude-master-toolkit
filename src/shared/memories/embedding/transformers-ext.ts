import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { ctkPaths } from '../../paths/ctk-home.js';

/**
 * transformers.js lives OUTSIDE the toolkit's dependency tree, in `~/.ctk/ext`.
 *
 * Shipping it as an (optional) dependency made `npm i -g` pull onnxruntime-node, whose postinstall
 * silently downloads ~236MB of CUDA binaries on linux/x64 — the install looked frozen. Semantic
 * recall is opt-in instead: `ctk mem semantic enable` installs it here (CPU only, visible progress,
 * no stdin, bounded by a timeout). Until then recall stays keyword-only.
 */

export const TRANSFORMERS_PKG = '@huggingface/transformers';
export const TRANSFORMERS_SPEC = `${TRANSFORMERS_PKG}@4.3.1`;

const MISSING_CODE = 'CTK_TRANSFORMERS_MISSING';
const DEFAULT_INSTALL_TIMEOUT_MS = 15 * 60_000;

export class TransformersMissingError extends Error {
  readonly code = MISSING_CODE;
  constructor() {
    super(`${TRANSFORMERS_PKG} is not installed — run \`ctk mem semantic enable\` for semantic recall`);
  }
}

/** Code check, not instanceof: bundles may hold more than one copy of this module. */
export function isTransformersMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === MISSING_CODE;
}

/** Absolute ESM entry of the package installed under `dir`, or null if it is not there. */
export function resolveTransformersEntry(dir: string): string | null {
  const pkgDir = join(dir, 'node_modules', ...TRANSFORMERS_PKG.split('/'));
  const manifest = join(pkgDir, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf-8'));
    const rel: string | undefined = pkg.exports?.node?.import?.default ?? pkg.module ?? pkg.main;
    if (!rel) return null;
    const entry = join(pkgDir, rel);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

type Importer = (specifier: string) => Promise<any>;

// Variable specifier: keeps bundlers from trying to resolve the package at build time.
const bareImport: Importer = (specifier) => import(specifier);

/** Load transformers.js: `~/.ctk/ext` first, then a bare import (dev checkout). Throws TransformersMissingError. */
export async function loadTransformers(dir: string = ctkPaths.ext(), importBare: Importer = bareImport): Promise<any> {
  const entry = resolveTransformersEntry(dir);
  if (entry) return import(pathToFileURL(entry).href);
  try {
    return await importBare(TRANSFORMERS_PKG);
  } catch {
    throw new TransformersMissingError();
  }
}

export type RunCommand = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<number>;

/** stdin ignored (npm can never wait on a prompt); npm output goes to stderr so stdout stays JSON-clean. */
const spawnRun: RunCommand = (cmd, args, { cwd, env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 2, 2],
      shell: process.platform === 'win32',
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`npm install timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

export interface InstallOpts {
  dir?: string;
  run?: RunCommand;
  timeoutMs?: number;
}

/** `npm install` transformers.js into `dir` (default `~/.ctk/ext`), CPU-only. Rejects on failure. */
export async function installTransformers(opts: InstallOpts = {}): Promise<void> {
  const dir = opts.dir ?? ctkPaths.ext();
  const run = opts.run ?? spawnRun;
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(manifest, JSON.stringify({ name: 'ctk-ext', private: true }, null, 2) + '\n');
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'install',
    TRANSFORMERS_SPEC,
    '--prefix', dir,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--foreground-scripts',
  ];
  // Only the CPU binaries bundled in onnxruntime-node are used; skip its ~236MB CUDA download.
  const env = { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' };
  const code = await run(npm, args, { cwd: dir, env, timeoutMs: opts.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS });
  if (code !== 0) throw new Error(`npm install ${TRANSFORMERS_SPEC} failed (exit code ${code})`);
}

/** One stderr line for a transformers.js model-download progress event, or null to skip it. */
export function formatModelProgress(ev: unknown): string | null {
  const e = ev as { status?: string; file?: string; progress?: number } | undefined;
  if (e?.status !== 'progress' || typeof e.progress !== 'number') return null;
  return `[ctk] model ${e.file ?? ''} ${Math.round(e.progress)}%`;
}
