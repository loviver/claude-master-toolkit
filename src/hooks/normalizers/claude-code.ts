import type { HookEvent, HookEventName, HookTool, ToolKind } from '../runtime/types.js';

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function toolKind(name: string): ToolKind {
  if (name === 'Bash') return 'shell';
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return 'edit';
  if (name === 'Write') return 'write';
  if (name === 'Agent' || name === 'Task') return 'agent';
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
  const fp = str(input['file_path']) ?? str(input['notebook_path']);
  if ((canonical === 'edit' || canonical === 'write') && fp) tool.filePaths = [fp];
  if (canonical === 'agent') {
    tool.subagent = {
      type: str(input['subagent_type']),
      prompt: str(input['prompt']),
      model: str(input['model']),
    };
  }
  return tool;
}

export function normalizeClaude(input: unknown): HookEvent {
  const raw = (input && typeof input === 'object' ? input : {}) as Raw;
  return {
    agent: 'claude-code',
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
