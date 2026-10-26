import type { HookEvent, HookResult } from '../runtime/types.js';

const GIT_COMMIT = /(^|[\s|;&(])git\s+commit\b/;

// Aligned with the global rule: never embed AI attribution in commits.
const BLOCKED: Array<{ label: string; re: RegExp }> = [
  { label: 'Co-Authored-By', re: /Co-Authored-By/i },
  { label: 'Generated with \\[Claude Code\\]', re: /Generated with \[Claude Code\]/i },
  { label: '🤖 Generated', re: /🤖 Generated/i },
  { label: 'noreply@anthropic\\.com', re: /noreply@anthropic\.com/i },
];

export function bashGuard(event: HookEvent): HookResult {
  const command = event.tool?.canonical === 'shell' ? event.tool.command : undefined;
  if (!command || !GIT_COMMIT.test(command)) return { kind: 'noop' };

  for (const { label, re } of BLOCKED) {
    if (re.test(command)) {
      return {
        kind: 'block',
        reason: [
          '✗ Blocked: git commit contains AI attribution.',
          '',
          `Matched pattern: /${label}/`,
          '',
          'Rule: "Never add Co-Authored-By or AI attribution to commits."',
          'Rewrite the commit message without that trailer and retry.',
        ].join('\n'),
      };
    }
  }
  return { kind: 'noop' };
}
