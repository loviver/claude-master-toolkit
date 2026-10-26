import { pathToFileURL } from 'url';
import { resolveAgentId } from '../shared/agents/resolve.js';
import { dispatch } from './runtime/dispatch.js';
import { readStdin, writeOutput } from './runtime/io.js';
import type { HandlerMap, HookEvent, HookEventName, RenderedOutput } from './runtime/types.js';
import { normalizeClaude } from './normalizers/claude-code.js';
import { normalizeCodex } from './normalizers/codex.js';
import { renderClaude } from './renderers/claude-code.js';
import { renderCodex } from './renderers/codex.js';
import { preToolUseHandler } from './handlers/pre-tool-use.js';
import { postToolUseHandler } from './handlers/post-tool-use.js';
import { userPromptSubmitHandler } from './handlers/user-prompt-submit.js';
import { sessionStartHandler } from './handlers/session-start.js';
import { stopHandler } from './handlers/stop.js';
import { preCompactHandler } from './handlers/pre-compact.js';
import { sessionEndHandler } from './handlers/session-end.js';
import { subagentStartHandler } from './handlers/subagent-start.js';
import { subagentStopHandler } from './handlers/subagent-stop.js';

const SILENT: RenderedOutput = { stdout: '', stderr: '', exitCode: 0 };

const HANDLERS: HandlerMap = {
  SessionStart: [sessionStartHandler],
  UserPromptSubmit: [userPromptSubmitHandler],
  PreToolUse: [preToolUseHandler],
  PostToolUse: [postToolUseHandler],
  Stop: [stopHandler],
  PreCompact: [preCompactHandler],
  SessionEnd: [sessionEndHandler],
  SubagentStart: [subagentStartHandler],
  SubagentStop: [subagentStopHandler],
};

type Normalizer = (raw: unknown) => HookEvent;
type Renderer = (event: HookEventName, results: Parameters<typeof renderClaude>[1]) => RenderedOutput;

// Unknown agents are a silent no-op.
const AGENTS: Record<string, { normalize: Normalizer; render: Renderer }> = {
  'claude-code': { normalize: normalizeClaude, render: renderClaude },
  codex: { normalize: normalizeCodex, render: renderCodex },
};

export interface HookArgs {
  event?: HookEventName;
  agent?: string;
}

const toPascal = (s: string): string =>
  s.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

export function parseArgs(argv: string[]): HookArgs {
  const out: HookArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--agent') out.agent = argv[++i];
    else if (a.startsWith('--agent=')) out.agent = a.slice('--agent='.length);
    else if (!a.startsWith('-') && !out.event) out.event = toPascal(a) as HookEventName;
  }
  return out;
}

/** Never throws: a hook must not break the host agent. */
export async function runHook(args: HookArgs, stdin: string): Promise<RenderedOutput> {
  try {
    const agentId = resolveAgentId(args.agent);
    const spec = AGENTS[agentId];
    if (!spec || !stdin.trim()) return SILENT;

    const event = spec.normalize(JSON.parse(stdin));
    if (args.event) event.event = args.event;
    if (!HANDLERS[event.event]) return SILENT;

    return spec.render(event.event, await dispatch(event, HANDLERS));
  } catch {
    return SILENT;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  writeOutput(await runHook(parseArgs(argv), await readStdin()));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
