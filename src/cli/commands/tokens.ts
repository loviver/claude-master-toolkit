import { readFileSync, existsSync } from 'fs';
import { output, outputError, isJsonMode, formatCost } from '../../shared/output.js';
import { getPricing, resolveModelKey } from '../../shared/pricing.js';

export function tokensCommand(file?: string): void {
  let chars: number;

  if (file) {
    if (!existsSync(file)) {
      outputError(`tokens: file not found: ${file}`);
      return;
    }
    chars = readFileSync(file).length;
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    const fd = 0; // stdin
    const buf = Buffer.alloc(65536);
    let bytesRead: number;
    try {
      while ((bytesRead = require('fs').readSync(fd, buf, 0, buf.length, null)) > 0) {
        chunks.push(buf.subarray(0, bytesRead));
      }
    } catch {
      // EOF or pipe closed
    }
    chars = Buffer.concat(chunks).length;
  }

  const rough = Math.floor(chars / 4);

  if (isJsonMode()) {
    output({ tokens: rough, method: 'rough', chars });
  } else {
    console.log(`${rough} tokens (rough — chars/4)`);
  }
}

export async function estimateCommand(file: string): Promise<void> {
  let text: string;

  if (file === '-') {
    const chunks: string[] = [];
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      chunks.push(line);
    }
    text = chunks.join('\n');
  } else if (existsSync(file)) {
    text = readFileSync(file, 'utf-8');
  } else {
    outputError(`estimate: not a file: ${file} (use '-' for stdin)`);
    return;
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];

  if (apiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: text }],
        }),
      });

      const data = await response.json() as { input_tokens?: number };

      if (data.input_tokens) {
        const model = resolveModelKey('sonnet');
        const pricing = getPricing(model);
        const cost = (data.input_tokens * pricing.input) / 1_000_000;

        if (isJsonMode()) {
          output({
            tokens: data.input_tokens,
            method: 'exact',
            model,
            estimatedCostUsd: Number(cost.toFixed(4)),
          });
        } else {
          console.log(
            `${data.input_tokens} tokens (exact, count_tokens API) | est. input cost: ${formatCost(cost)} (${model})`,
          );
        }
        return;
      }
    } catch {
      if (!isJsonMode()) {
        console.error('ctk estimate: API error, falling back to rough estimate');
      }
    }
  }

  // Fallback: rough estimate
  const rough = Math.floor(text.length / 4);

  if (isJsonMode()) {
    output({ tokens: rough, method: 'rough', chars: text.length });
  } else {
    console.log(`${rough} tokens (rough — set ANTHROPIC_API_KEY for exact count)`);
  }
}
