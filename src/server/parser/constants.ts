export const AGENT_ROLE_PATTERNS: RegExp[] = [
  /Agent\s*\(\s*{[^}]*type\s*:\s*['"]([^'"]+)['"]/i,
  /@sub-agent\s+(\w+)/i,
  /Skill\s*\(\s*{[^}]*skill\s*:\s*['"]([^'"]+)['"]/i,
];

export const KNOWN_AGENT_ROLES = new Set([
  'explorer',
  'implementer',
  'reviewer',
  'orchestrator',
  'general-purpose',
  'plan',
]);
