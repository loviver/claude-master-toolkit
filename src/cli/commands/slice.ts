import { readFileSync, existsSync } from 'fs';
import { output, outputError } from '../../shared/output.js';

/**
 * Extract a symbol's block from a file.
 * Ports the AWK brace-counting logic from bash ctk.
 * Works for JS/TS/Go/Python/Rust with common patterns.
 */
export function sliceCommand(file: string, symbol: string): void {
  if (!existsSync(file)) {
    outputError(`slice: file not found: ${file}`);
  }

  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  // Match symbol definition patterns across languages
  const defPattern = new RegExp(
    `(function|const|let|var|class|func|def|fn|type|interface|export)\\s+${escapeRegex(symbol)}[\\s(<:=]`,
  );

  let inside = false;
  let depth = 0;
  let startLine = -1;
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inside && defPattern.test(line)) {
      inside = true;
      startLine = i;
      depth = 0;
    }

    if (inside) {
      result.push(`${i + 1}: ${line}`);

      // Brace counting for C-like languages
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0 && i > startLine) {
            output(result.join('\n'));
            return;
          }
        }
      }

      // Python/indent-based: blank line after non-empty inside def = end
      if (line.trim() === '' && i > startLine + 1 && depth === 0) {
        result.pop(); // Remove the blank line
        output(result.join('\n'));
        return;
      }
    }
  }

  if (result.length > 0) {
    output(result.join('\n'));
  } else {
    outputError(`slice: symbol '${symbol}' not found in ${file}`);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
