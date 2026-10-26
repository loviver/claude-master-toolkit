import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ctkPaths } from '../../shared/paths/ctk-home-paths.js';

export type ManifestEntry =
  | { type: 'symlink'; path: string }
  | { type: 'json-key'; file: string; keyPath: string[] }
  /** Deep-merged JSON (e.g. settings.json hooks); uninstall subtracts exactly this patch. */
  | { type: 'json-patch'; file: string; patch: Record<string, unknown>; createdFile?: boolean }
  | { type: 'toml-block'; file: string; id: string; createdFile?: boolean }
  /** A user file we replaced (e.g. CLAUDE.md -> symlink); put `backup` back on uninstall. */
  | { type: 'restore'; path: string; backup: string };

export interface Manifest {
  agent: string;
  pkgRoot: string;
  installedAt: string;
  entries: ManifestEntry[];
}

export const manifestPath = (agent: string): string => join(ctkPaths.installs(), `${agent}.json`);

export function readManifest(agent: string): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(agent), 'utf8')) as Manifest;
    return Array.isArray(m.entries) ? m : null;
  } catch {
    return null;
  }
}

export function writeManifest(m: Manifest): void {
  mkdirSync(ctkPaths.installs(), { recursive: true });
  writeFileSync(manifestPath(m.agent), JSON.stringify(m, null, 2) + '\n');
}

export function deleteManifest(agent: string): void {
  if (existsSync(manifestPath(agent))) rmSync(manifestPath(agent));
}
