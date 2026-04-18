import { execFileSync } from 'child_process';
import { output, outputError } from '../../shared/output.js';

export function findCommand(query: string, path?: string): void {
  const searchPath = path ?? '.';

  try {
    // Try ripgrep first
    const result = execFileSync(
      'rg',
      ['--color=never', '--line-number', '--max-count', '3', '--heading', query, searchPath],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    output(result.trim().split('\n').slice(0, 60).join('\n'));
  } catch {
    try {
      // Fallback to grep
      const result = execFileSync(
        'grep',
        ['-rn', '--max-count=3', query, searchPath],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      output(result.trim().split('\n').slice(0, 60).join('\n'));
    } catch {
      outputError(`find: no matches for '${query}'`);
    }
  }
}
