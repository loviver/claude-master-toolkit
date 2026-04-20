import { AGENT_ROLE_PATTERNS, KNOWN_AGENT_ROLES } from '../constants.js';

export function extractAgentRole(content: string | null): string | null {
  if (!content) return null;
  for (const pattern of AGENT_ROLE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const role = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (KNOWN_AGENT_ROLES.has(role)) return role;
    }
  }
  return null;
}
