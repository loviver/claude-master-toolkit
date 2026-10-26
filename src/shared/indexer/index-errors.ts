import { relative } from 'path';

export interface IndexErrorEntry {
  file: string;
  message: string;
}

const MESSAGE_MAX = 200;

/**
 * Collects per-file extraction failures during `ctk index build`. A failed file is dropped
 * from the index, which silently shrinks callers/deps results — so every failure must be
 * traceable to a file and a cause instead of surfacing as a bare count.
 */
export class IndexErrors {
  private entries: IndexErrorEntry[] = [];
  private messages = new Map<string, number>();
  count = 0;

  constructor(
    private readonly projectPath: string,
    private readonly cap = 20,
  ) {}

  add(absFile: string, err: unknown): void {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.slice(0, MESSAGE_MAX);
    this.count++;
    this.messages.set(message, (this.messages.get(message) ?? 0) + 1);
    if (this.entries.length < this.cap) {
      this.entries.push({ file: relative(this.projectPath, absFile), message });
    }
  }

  /** First `cap` failures. */
  report(): IndexErrorEntry[] {
    return this.entries;
  }

  /** Distinct messages with their counts, most frequent first. */
  byMessage(): Array<{ message: string; count: number }> {
    return [...this.messages.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count);
  }
}
