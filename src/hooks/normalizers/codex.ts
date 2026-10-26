import type { HookEvent, HookEventName, HookTool, ToolKind } from '../runtime/types.js';

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Only tool shapes verified against real captures are interpreted:
 *  - `Bash` (tool_input.command)
 *  - the subagent spawn tool (`collaborationspawn_agent`): its `message` is encrypted, so no brief/prompt is exposed
 * `apply_patch` and MCP calls are classified but NOT parsed (no verified payload yet): they stay
 * 'other' / 'mcp' with no command or file paths, so every guard treats them as a noop.
 */
function toolKind(name: string): ToolKind {
  if (name === 'Bash') return 'shell';
  if (name === 'Agent' || name.endsWith('spawn_agent')) return 'agent';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function normalizeTool(raw: Raw): HookTool | undefined {
  const rawName = str(raw['tool_name']);
  if (!rawName) return undefined;
  const input = (raw['tool_input'] ?? {}) as Record<string, unknown>;
  const canonical = toolKind(rawName);
  const tool: HookTool = { canonical, rawName, input };
  if (canonical === 'shell') tool.command = str(input['command']);
  return tool;
}

export function normalizeCodex(input: unknown): HookEvent {
  const raw = (input && typeof input === 'object' ? input : {}) as Raw;
  return {
    agent: 'codex',
    event: (str(raw['hook_event_name']) ?? 'Stop') as HookEventName,
    sessionId: str(raw['session_id']) ?? 'default',
    cwd: str(raw['cwd']) ?? process.cwd(),
    transcriptPath: str(raw['transcript_path']),
    model: str(raw['model']),
    source: str(raw['source']),
    reason: str(raw['reason']),
    trigger: str(raw['trigger']),
    prompt: str(raw['prompt']),
    agentType: str(raw['agent_type']),
    tool: normalizeTool(raw),
    raw: input,
  };
}
