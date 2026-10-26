export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionEnd'
  | 'SubagentStart'
  | 'SubagentStop';

export type ToolKind = 'shell' | 'edit' | 'write' | 'patch' | 'agent' | 'mcp' | 'other';

export interface HookTool {
  canonical: ToolKind;
  rawName: string;
  input: Record<string, unknown>;
  command?: string;
  filePaths?: string[];
  subagent?: { type?: string; prompt?: string; model?: string };
}

/** Agent-neutral view of a hook payload. Guards and handlers only ever see this. */
export interface HookEvent {
  agent: string;
  event: HookEventName;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  model?: string;
  source?: string;
  reason?: string;
  trigger?: string;
  prompt?: string;
  agentType?: string;
  tool?: HookTool;
  raw: unknown;
}

export type HookResult =
  | { kind: 'noop' }
  | { kind: 'context'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'block'; reason: string }
  | { kind: 'ask'; reason: string };

export type HookHandler = (event: HookEvent) => HookResult | Promise<HookResult>;

export type HandlerMap = Partial<Record<HookEventName, HookHandler[]>>;

export interface RenderedOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}
