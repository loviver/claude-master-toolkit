export interface AgentInvocation {
  subagent_type?: string;
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku' | 'inherit';
  toolWhitelist?: string[];
  run_in_background?: boolean;
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

// Default bridge: returns a stub result. Real adapter (Claude Code Agent tool)
// is wired in src/server/lib/ when the executor runs inside the CLI/server.
export class NullAgentBridge implements AgentBridge {
  async invoke(inv: AgentInvocation): Promise<AgentResult> {
    return {
      output: {
        invoked: true,
        subagent_type: inv.subagent_type,
        prompt: inv.prompt.slice(0, 120),
      },
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
