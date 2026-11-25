/** Which projects may feed a team vault, based on the owner in their git `origin`. */
import { execFileSync } from 'child_process';

/** Lower-cased owner of a hosted remote; null for local paths and file URLs. */
export function ownerFromRemote(url: string): string | null {
  const match =
    url.match(/^(?:https?|ssh|git):\/\/[^/]+\/([^/]+)\/[^/]+/i) ?? url.match(/^[\w.-]+@[\w.-]+:([^/]+)\/[^/]+/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function originUrl(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() || null;
  } catch {
    return null;
  }
}

export function projectOwner(projectPath: string | null): string | null {
  const url = projectPath ? originUrl(projectPath) : null;
  return url ? ownerFromRemote(url) : null;
}
