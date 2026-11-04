import { spawn } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  /** `null` means the process was killed (timeout) or never exited normally. */
  exitCode: number | null;
}

export interface RunOptions {
  input?: string;
  cwd?: string;
  timeoutMs?: number;
}

/** Runs the `claude` CLI with the given args; the prompt travels through stdin. */
export type CliRunner = (args: string[], opts: RunOptions & { input: string }) => Promise<RunResult>;

/** Runs a shell command line. */
export type ShellRunner = (command: string, opts: Omit<RunOptions, 'input'>) => Promise<RunResult>;

const MAX_CAPTURE_BYTES = 1024 * 1024;

function appendCapped(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return next.length > MAX_CAPTURE_BYTES ? next.slice(next.length - MAX_CAPTURE_BYTES) : next;
}

export function spawnProcess(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: timedOut ? null : exitCode });
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, opts.timeoutMs)
      : undefined;

    child.stdout.on('data', (c: Buffer) => (stdout = appendCapped(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = appendCapped(stderr, c)));
    child.on('error', (e) => {
      stderr += `spawn error: ${e.message}`;
      finish(127);
    });
    child.on('close', (code) => finish(code));

    child.stdin.on('error', () => undefined); // child may exit before reading stdin
    child.stdin.end(opts.input ?? '');
  });
}

export const spawnClaudeCli: CliRunner = (args, opts) => spawnProcess('claude', args, opts);

export const spawnShell: ShellRunner = (command, opts) => spawnProcess('bash', ['-c', command], opts);
