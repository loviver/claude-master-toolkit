import { spawnClaudeCli, type CliRunner } from './runners.js';

export interface AgentInvocation {
  subagent_type?: string;
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku' | 'inherit';
  toolWhitelist?: string[];
  run_in_background?: boolean;
  /** Working directory for the agent process (repo the node operates on). */
  cwd?: string;
  /** Hard time limit for the agent; the process is killed when exceeded. */
  timeoutMs?: number;
  /** Claude Code permission mode for headless runs (e.g. `acceptEdits`). */
  permissionMode?: string;
  // Execution context — passed so sub-agent can call wf_mutate on the right target
  execution_id: string;
  plan_id: string;
  current_node_id: string;
}

export interface AgentResult {
  output: unknown;
  error?: string;
}

export interface AgentBridge {
  invoke(inv: AgentInvocation): Promise<AgentResult>;
}

// Default bridge: DRY RUN. It never launches anything, and it says so, so a
// graph can no longer look executed when nothing ran. Use ClaudeCliAgentBridge
// (wf_execute `live: true`) to actually run agent nodes.
export class NullAgentBridge implements AgentBridge {
  async invoke(inv: AgentInvocation): Promise<AgentResult> {
    return {
      output: {
        status: 'dry-run',
        invoked: false,
        subagent_type: inv.subagent_type,
        prompt: inv.prompt.slice(0, 120),
      },
    };
  }
}

const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const ERROR_TAIL_CHARS = 500;

function tail(text: string): string {
  const t = text.trim();
  return t.length > ERROR_TAIL_CHARS ? `...${t.slice(t.length - ERROR_TAIL_CHARS)}` : t;
}

/**
 * Runs each agent node as a headless `claude -p` process. The prompt goes over
 * stdin (not argv) so long briefs are not visible in the process list and do
 * not hit argv limits. Permissions are explicit: without a `permissionMode` or
 * `toolWhitelist` that covers a tool, the run fails visibly instead of hanging.
 */
export class ClaudeCliAgentBridge implements AgentBridge {
  private readonly run: CliRunner;

  constructor(opts: { run?: CliRunner } = {}) {
    this.run = opts.run ?? spawnClaudeCli;
  }

  async invoke(inv: AgentInvocation): Promise<AgentResult> {
    const args = ['-p', '--output-format', 'json'];
    if (inv.model && inv.model !== 'inherit') args.push('--model', inv.model);
    if (inv.subagent_type) args.push('--agent', inv.subagent_type);
    if (inv.toolWhitelist?.length) args.push('--allowedTools', inv.toolWhitelist.join(','));
    if (inv.permissionMode) args.push('--permission-mode', inv.permissionMode);

    const res = await this.run(args, {
      input: inv.prompt,
      cwd: inv.cwd,
      timeoutMs: inv.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    });

    if (res.exitCode === null) {
      return { output: { status: 'failed' }, error: 'agent timed out and was killed' };
    }
    if (res.exitCode !== 0) {
      return {
        output: { status: 'failed' },
        error: `agent exited with exit code ${res.exitCode}: ${tail(res.stderr || res.stdout)}`,
      };
    }

    let parsed: { result?: string; is_error?: boolean; total_cost_usd?: number };
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      return { output: { status: 'failed' }, error: `could not parse agent output: ${tail(res.stdout)}` };
    }
    if (parsed.is_error) {
      return { output: { status: 'failed' }, error: `agent reported an error: ${tail(parsed.result ?? '')}` };
    }
    return {
      output: { status: 'completed', result: parsed.result, costUsd: parsed.total_cost_usd },
    };
  }
}

export function buildAgentPromptPreamble(inv: AgentInvocation): string {
  const lines = [
    '## Workflow execution context',
    `- execution_id: ${inv.execution_id}`,
    `- plan_id: ${inv.plan_id}`,
    `- current_node_id: ${inv.current_node_id}`,
    '',
    'You are running inside a workflow graph. You MAY call `wf_mutate` to adapt',
    'the graph (addNode / redirectEdge / removeNode / addBranch) — pass',
    '`execution_id` and `by_node_id: current_node_id` when you do.',
  ];
  if (inv.toolWhitelist && inv.toolWhitelist.length > 0) {
    lines.push('', `## Allowed tools (whitelist)`, `Only use: ${inv.toolWhitelist.join(', ')}`);
  }
  lines.push('', '## Task', inv.prompt);
  return lines.join('\n');
}
