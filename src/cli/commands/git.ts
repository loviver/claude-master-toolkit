import { execFileSync } from 'child_process';
import { output, outputError } from '../../shared/output.js';

export function gitLogCommand(count?: string): void {
  const n = count ?? '10';

  try {
    const result = execFileSync('git', ['log', '--oneline', '--decorate', '-n', n], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    output(result.trim());
  } catch {
    outputError('git-log: not a git repo');
  }
}

export function gitChangedCommand(): void {
  try {
    let base: string;
    try {
      base = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().replace('origin/', '');
    } catch {
      base = 'main';
    }

    const result = execFileSync('git', ['diff', '--stat', `${base}...HEAD`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    output(result.trim());
  } catch {
    outputError('git-changed: not a git repo or no base branch');
  }
}
