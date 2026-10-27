import type { RenderedOutput } from './types.js';

export async function readStdin(timeoutMs = 2000): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(done, timeoutMs);
    process.stdin.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

export function writeOutput(o: RenderedOutput): void {
  if (o.stdout) process.stdout.write(o.stdout);
  if (o.stderr) process.stderr.write(o.stderr);
  process.exitCode = o.exitCode;
}
