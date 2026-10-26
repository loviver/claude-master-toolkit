import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { HookHandler } from '../runtime/types.js';
import { getAdapter } from '../../shared/agents/index.js';
import { lastTurnTokens } from '../lib/transcript.js';
import { contextLimit, eventModel } from '../lib/context.js';
import { contextPct } from '../guards/context-budget-guard.js';
import { purgeStale } from '../lib/state.js';
import { ctkAvailable, ctkOut } from '../lib/proc.js';

/** Newest transcript of THIS project that is not the session now starting. */
function previousSession(agent: string, cwd: string, currentId: string): string | undefined {
  if (agent !== 'claude-code') return undefined; // other agents lay transcripts out differently
  const dir = join(getAdapter('claude-code').transcriptsRoot(homedir()), cwd.replace(/\//g, '-'));
  if (!existsSync(dir)) return undefined;
  let best: { p: string; m: number } | undefined;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl') || f === `${currentId}.jsonl`) continue;
    const p = join(dir, f);
    const m = statSync(p).mtimeMs;
    if (!best || m > best.m) best = { p, m };
  }
  return best?.p;
}

export const sessionStartHandler: HookHandler = (e) => {
  try {
    purgeStale(7);
  } catch {
    /* best effort */
  }
  const out: string[] = [];

  const prev = previousSession(e.agent, e.cwd, e.sessionId);
  const tokens = lastTurnTokens(prev);
  if (tokens > 0) {
    const model = eventModel(e);
    const limit = contextLimit(model);
    const pct = contextPct(tokens, limit);
    if (pct >= 60) {
      const cost = ctkOut(['cost', '--quiet'], e.cwd);
      const rec =
        pct >= 85
          ? '/clear (new task) — this session is near saturation'
          : pct >= 70
            ? '/compact (continuing same work) or /clear (new task)'
            : 'monitor usage; /compact if approaching 70%';
      out.push(
        [
          '',
          '⚠  Context Guardian — prior session in this project',
          `   Accumulated tokens: ${tokens.toLocaleString('en-US')} (${pct}% of ${limit} window)`,
          ...(cost ? [`   Est. realized cost: $${cost} (${model})`] : []),
          `   Recommendation: ${rec}`,
          '   Note: Claude cache TTL (5 min) is NOT context expiry — tokens persist.',
          '',
        ].join('\n'),
      );
    }
  }

  if (ctkAvailable()) {
    out.push(
      'ctk MCP active — tools: ctk_understand, ctk_find, ctk_deps, ctk_callers, ctk_slice, ctk_recall, ctk_record, ctk_brief_read, ctk_brief_validate. Prefer over Read.' + (e.agent === 'claude-code' ? ' Use /delegate for Agent calls.' : ''),
    );
    const recent = ctkOut(['--json', 'mem', 'trace', '--limit', '3']) ?? ctkOut(['--json', 'pandorica', 'recent', '--limit', '3']);
    let p =
      'Pandorica v2 active — mem_* tools (FTS5 + cost correlation): mem_save / mem_recall / mem_context / mem_trace / mem_session / mem_stats. Legacy aliases: pandorica_save/_search/_context/_session_summary/_recent. SAVE PROACTIVELY after decisions, bugfixes, non-obvious discoveries.';
    if (recent) p += `\n   Recent memories (this project): ${recent.slice(0, 300)}`;
    out.push(p);
  }

  return out.length ? { kind: 'context', text: out.join('\n') } : { kind: 'noop' };
};
