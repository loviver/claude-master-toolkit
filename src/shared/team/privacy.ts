/**
 * Blocks secrets and personal data before a memory leaves the machine. A safety net for the
 * reviewer of the promotion PR, not a replacement: unknown formats will get through.
 */

export interface Violation {
  field: string;
  rule: string;
}

const RULES: ReadonlyArray<[rule: string, pattern: RegExp]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['clickup-token', /\bpk_[0-9]+_[A-Z0-9]{20,}/],
  ['api-secret-key', /\bsk-[A-Za-z0-9_-]{24,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@<$]{3,}@/i],
  // A literal value assigned to a secret-looking name; placeholders (<x>, ${X}, ***) are fine.
  [
    'secret-assignment',
    /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["']?(?![<$*{])[^\s"'<>]{8,}/i,
  ],
  // Customer addresses are personal data; example.com and git remotes are not.
  [
    'email',
    /\b(?!git@)[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|test))(?:gmail|hotmail|outlook|yahoo|icloud|live|proton(?:mail)?)\.[A-Za-z.]{2,}\b/i,
  ],
];

export function scanFields(fields: Record<string, string | null | undefined>): Violation[] {
  const found: Violation[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const rules = new Set(RULES.filter(([, pattern]) => pattern.test(value)).map(([rule]) => rule));
    for (const rule of rules) found.push({ field, rule });
  }
  return found;
}

export function redactHome(text: string, home: string): string {
  if (!home || home === '/') return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}(?![A-Za-z0-9_-])`, 'g'), '~');
}
