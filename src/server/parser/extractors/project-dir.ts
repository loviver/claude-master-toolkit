/** Reverse Claude Code's cwd encoding: `-home-user-dir` → `/home/user/dir`. */
export function decodeProjectDir(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  return '/' + encoded.slice(1).replace(/-/g, '/');
}
