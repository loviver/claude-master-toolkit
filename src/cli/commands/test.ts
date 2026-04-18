import { execSync } from 'child_process';
import { output } from '../../shared/output.js';

export function testSummaryCommand(cmd?: string[]): void {
  const command = cmd && cmd.length > 0 ? cmd.join(' ') : 'yarn test';

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = result.split('\n');
    const summary = lines.slice(-20).join('\n');
    output(`${summary}\n---\nexit: 0`);
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    const combined = (error.stdout ?? '') + (error.stderr ?? '');
    const lines = combined.split('\n');
    const summary = lines.slice(-20).join('\n');
    output(`${summary}\n---\nexit: ${error.status ?? 1}`);
  }
}
