import { ClaudeCodeAdapter } from './claude-code.js';
import { StubAdapter } from './stub.js';
import type { AgentAdapter, AgentId } from './interface.js';

export * from './interface.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { StubAdapter } from './stub.js';

const REGISTRY: Record<AgentId, () => AgentAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  opencode: () => new StubAdapter('opencode'),
  cursor: () => new StubAdapter('cursor'),
  codex: () => new StubAdapter('codex'),
};

export function getAdapter(id: AgentId): AgentAdapter {
  const factory = REGISTRY[id];
  if (!factory) throw new Error(`Unknown agent id: ${id}`);
  return factory();
}

export function listAdapters(): AgentAdapter[] {
  return (Object.keys(REGISTRY) as AgentId[]).map((id) => REGISTRY[id]());
}
